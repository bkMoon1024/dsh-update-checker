// Host-half tests that need real sockets: the loopback trust fence and the
// node:http → fetch bridge. Everything runs on 127.0.0.1 with ephemeral ports.
import http from 'node:http';
import { isTrustedLoopbackRequest, httpBridge } from '../index.js';

const results = [];
function check(name, condition, detail = '') {
  results.push(!!condition);
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// --- trust fence -----------------------------------------------------------
const req = (headers) => ({ headers });
check('fence: loopback host', isTrustedLoopbackRequest(req({ host: '127.0.0.1:56185' })) === true);
check('fence: localhost', isTrustedLoopbackRequest(req({ host: 'localhost' })) === true);
check('fence: ipv6 loopback', isTrustedLoopbackRequest(req({ host: '[::1]:56185' })) === true);
check('fence: 127/8 loopback alias', isTrustedLoopbackRequest(req({ host: '127.8.9.10:56185' })) === true);
check('fence: 127.example is not loopback', isTrustedLoopbackRequest(req({ host: '127.example' })) === false);
check('fence: userinfo host rejected', isTrustedLoopbackRequest(req({ host: '127.0.0.1:56185@evil.example' })) === false);
check('fence: suffix attack rejected', isTrustedLoopbackRequest(req({ host: '127.0.0.1.evil.example' })) === false);
check('fence: non-loopback rejected', isTrustedLoopbackRequest(req({ host: '10.0.0.5:56185' })) === false);
check('fence: cross-site rejected', isTrustedLoopbackRequest(req({ host: '127.0.0.1:1', 'sec-fetch-site': 'cross-site' })) === false);
check('fence: same-origin passes', isTrustedLoopbackRequest(req({ host: '127.0.0.1:56185', origin: 'http://127.0.0.1:56185' })) === true);
check('fence: foreign origin rejected', isTrustedLoopbackRequest(req({ host: '127.0.0.1:56185', origin: 'http://evil.example' })) === false);
check('fence: missing host rejected', isTrustedLoopbackRequest({ headers: {} }) === false);
check('fence: host with path rejected', isTrustedLoopbackRequest(req({ host: '127.0.0.1/dsh-update-checker' })) === false);
check('fence: ipv6 same-origin passes', isTrustedLoopbackRequest(req({ host: '[::1]:56185', origin: 'http://[::1]:56185' })) === true);
check('fence: null origin rejected', isTrustedLoopbackRequest(req({ host: '127.0.0.1:56185', origin: 'null' })) === false);
check('fence: default-port origin canonicalizes', isTrustedLoopbackRequest(req({ host: 'localhost:80', origin: 'http://localhost' })) === true);

// --- helpers ---------------------------------------------------------------
function readBody(res) {
  return new Promise((resolve) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    res.on('error', () => resolve(''));
  });
}

function request(port, { path = '/dsh-update-checker/check.run', body = '{}', headers = {}, method = 'POST' } = {}) {
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path,
      headers: { 'content-type': 'application/json', ...headers },
    }, async (res) => {
      resolve({ status: res.statusCode, headers: res.headers, body: await readBody(res) });
    });
    req.on('error', (error) => resolve({ status: 0, error: error.code || error.message, body: '' }));
    req.end(body);
  });
}

function startBridge(fetchHandler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      void httpBridge(req, res, fetchHandler, 1024);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const jsonHandler = (payload = { ok: true }) => ({
  fetch: async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }),
});

// --- normal round trip -----------------------------------------------------
{
  const seen = [];
  const { server, port } = await startBridge({
    fetch: async (requestValue) => {
      seen.push({ url: requestValue.url, method: requestValue.method, body: await requestValue.text() });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  try {
    const response = await request(port, { body: '{"rpcId":"1","method":"check.run","payload":{}}' });
    check('bridge: 200 round trip', response.status === 200 && response.body.includes('"ok":true'), JSON.stringify(response));
    check('bridge: internal origin injected', seen.length === 1 && seen[0].url.startsWith('http://dsh.internal/dsh-update-checker/'), seen[0]?.url);
    check('bridge: body and method forwarded', seen[0]?.method === 'POST' && seen[0]?.body.includes('check.run'), JSON.stringify(seen[0]));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// --- Host header must not shape the Request --------------------------------
{
  const seen = [];
  const { server, port } = await startBridge({
    fetch: async (requestValue) => {
      seen.push(requestValue.url);
      return new Response('ok', { status: 200 });
    },
  });
  try {
    const response = await request(port, { headers: { host: '127.0.0.1:1@evil.example' } });
    check('bridge: userinfo Host does not throw', response.status === 200 && response.body === 'ok', JSON.stringify(response));
    check('bridge: Host ignored in Request URL', seen[0] === 'http://dsh.internal/dsh-update-checker/check.run', seen[0]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// --- handler failures never leak their text --------------------------------
{
  const { server, port } = await startBridge({ fetch: async () => { throw new Error('secret C:/Users/me/path'); } });
  try {
    const response = await request(port);
    check('bridge: handler throw → 500', response.status === 500, JSON.stringify(response));
    check('bridge: 500 body is generic', response.body === 'update check failed', response.body);
    check('bridge: 500 body has no internal detail', !response.body.includes('secret') && !response.body.includes('C:/Users'), response.body);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// --- declared oversized body → 413 and no handler call ----------------------
{
  let called = false;
  const { server, port } = await startBridge({ fetch: async () => { called = true; return new Response('ok'); } });
  try {
    const response = await request(port, { body: 'x'.repeat(2000) });
    check('bridge: declared oversized body rejected', response.status === 413, JSON.stringify(response));
    check('bridge: oversized body never dispatched', called === false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// --- streamed oversized body (no content-length) → 413 ---------------------
{
  let called = false;
  const { server, port } = await startBridge({ fetch: async () => { called = true; return new Response('ok'); } });
  try {
    const result = await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/x', headers: { 'content-type': 'application/json' } });
      req.on('response', async (res) => resolve({ status: res.statusCode, body: await readBody(res) }));
      req.on('error', (error) => resolve({ status: 0, error: error.code }));
      req.write('y'.repeat(400));
      req.write('y'.repeat(400));
      req.write('y'.repeat(400));
      req.end();
    });
    check('bridge: streamed oversized body rejected', result.status === 413, JSON.stringify(result));
    check('bridge: streamed oversized body never dispatched', called === false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// --- client disconnect while the handler is still running ------------------
{
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  let slowCalled = 0;
  const { server, port } = await startBridge({
    fetch: async () => {
      slowCalled += 1;
      if (slowCalled === 1) {
        await new Promise((resolve) => setTimeout(resolve, 60));
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('x'.repeat(64 * 1024)));
            controller.enqueue(new TextEncoder().encode('y'.repeat(64 * 1024)));
            controller.close();
          },
        });
        return new Response(stream, { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  try {
    // Fire and immediately abort the client socket.
    await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/x', headers: { 'content-type': 'application/json' } });
      req.on('error', () => resolve());
      req.on('response', (res) => { res.destroy(); resolve(); });
      req.end('{}');
      setTimeout(() => { req.destroy(); resolve(); }, 20);
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const after = await request(port);
    check('bridge: disconnect settles without unhandled rejection', unhandled.length === 0, String(unhandled[0] || 'none'));
    check('bridge: server still serves after a disconnect', after.status === 200, JSON.stringify(after));
  } finally {
    process.off('unhandledRejection', onUnhandled);
    await new Promise((resolve) => server.close(resolve));
  }
}

const failed = results.filter((pass) => !pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

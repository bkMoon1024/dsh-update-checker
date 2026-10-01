/**
 * Standalone end-to-end test for the dsh-update-checker host half.
 *
 * Boots a real @deepseek-ai/cordis Context (from the runtime checkout),
 * provides mock `webServer` (real node:http server with prefix routing),
 * mock `connection` (requestRejection fence), and the REAL `profileContext`
 * (this machine's desktop profile), then loads the plugin module and
 * exercises the mounted HTTP route exactly like the settings page would.
 *
 * Run: node test/harness.mjs
 */
import { createServer, request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

// Machine-specific paths are overridable via env; defaults resolve portably.
const CORDIS_URL = process.env.DSH_CORDIS_PATH
  || 'file:///D:/dsh%20work/_dsh_src/dsh/node_modules/@deepseek-ai/cordis/lib/index.js';
const PLUGIN_URL = new URL('../index.js', import.meta.url).href;
const PROFILE_DIR = process.env.DSH_PROFILE_DIR
  || `C:/Users/${os.userInfo().username}/.dsh/profiles/desktop`;

const { Context } = await import(CORDIS_URL);
const plugin = await import(PLUGIN_URL);

// --- mock webServer: prefix routing over a real HTTP server -----------------
const routes = [];
const server = createServer((req, res) => {
  const route = routes.find((r) => r.kind === 'prefix' && req.url.startsWith(r.path));
  if (route) return route.handler(req, res);
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;
const webServer = {
  port,
  register(route) {
    // same contract as dsh-host-webserver register(): duplicate (kind,path) throws
    if (routes.some((r) => r.kind === route.kind && r.path === route.path)) {
      throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`);
    }
    routes.push(route);
    return () => {
      const i = routes.indexOf(route);
      if (i >= 0) routes.splice(i, 1);
    };
  },
};

// --- mock connection: requestRejection = loopback fence ---------------------
const connection = {
  requestRejection(req) {
    const host = req.headers?.host;
    if (!host) return 403;
    const hostName = host.split(':')[0];
    if (!['127.0.0.1', 'localhost', '::1'].includes(hostName)) return 403;
    if (req.headers['sec-fetch-site'] === 'cross-site') return 403;
    const origin = req.headers.origin;
    if (origin !== undefined) {
      try { if (new URL(origin).host !== host) return 403; } catch { return 403; }
    }
    return undefined;
  },
};

// --- boot cordis, provide services, load plugin ------------------------------
const ctx = new Context();
ctx.provide('webServer', webServer);
ctx.provide('connection', connection);
ctx.provide('profileContext', {
  name: 'desktop',
  dir: PROFILE_DIR,
  home: path.join(os.homedir(), '.dsh'),
});

let applyError = null;
let fiber1 = null;
try {
  fiber1 = await ctx.plugin(plugin);
} catch (error) {
  applyError = error;
}

// wait for activation (route registered)
let activated = false;
for (let i = 0; i < 50; i++) {
  if (routes.some((r) => r.path === '/dsh-update-checker')) { activated = true; break; }
  await sleep(100);
}

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, pass: !!condition, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

check('plugin activated without throw', activated && !applyError, applyError ? String(applyError?.stack ?? applyError) : '');

function envelope(method, payload) {
  return JSON.stringify({ type: 'client-request', rpcId: 'test-' + Math.random().toString(36).slice(2), method, payload });
}

async function post(path, body, headers = {}) {
  return fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

// 0. cold-start check.last: fresh process memory must fall back to the
//    per-profile cache file (or the legacy flat file from <=0.2.0)
if (activated) {
  try {
    const res = await post('/dsh-update-checker/check.last', envelope('check.last', undefined));
    const json = await res.json();
    check('cold check.last reads persisted cache', json?.result?.ok === true && !!json?.result?.value?.at, `at=${json?.result?.value?.at}`);
  } catch (error) {
    check('cold check.last executed', false, String(error));
  }
}

// 1. happy path: check.run against the real profile (live network)
if (activated) {
  let run = null;
  try {
    const res = await post('/dsh-update-checker/check.run', envelope('check.run', undefined));
    const json = await res.json();
    run = json;
    check('check.run HTTP 200 + server-response', res.status === 200 && json.type === 'server-response', `rpcId=${json.rpcId?.slice(0, 12)}`);
    const result = json.result;
    check('check.run result.ok=true', result?.ok === true, result?.ok === true ? `${result.value.rows.length} plugins, counts=${JSON.stringify(result.value.counts)}` : JSON.stringify(result?.error));
    const withNotes = result?.value?.rows?.filter((r) => r.status === 'update' || r.status === 'local-behind') ?? [];
    check('rows carry release notes when outdated', withNotes.every((r) => Array.isArray(r.releases) && r.releases.every((e) => typeof e.body === 'string' && e.body.length <= 65536 + 60)), withNotes.length ? `outdated rows: ${withNotes.map((r) => r.name).join(', ')}` : 'nothing outdated');
  } catch (error) {
    check('check.run executed', false, String(error));
  }

  // 1b. concurrent check.run calls dedup into ONE scan (same completion stamp)
  try {
    const [a, b] = await Promise.all([
      post('/dsh-update-checker/check.run', envelope('check.run', undefined)),
      post('/dsh-update-checker/check.run', envelope('check.run', undefined)),
    ]);
    const [ja, jb] = await Promise.all([a.json(), b.json()]);
    check('concurrent check.run share one scan', ja?.result?.ok === true && jb?.result?.ok === true && ja.result.value.at === jb.result.value.at, `at a=${ja?.result?.value?.at} b=${jb?.result?.value?.at}`);
  } catch (error) {
    check('concurrent check.run executed', false, String(error));
  }

  // 1c. per-profile cache file written at the new location
  try {
    const { readFile } = await import('node:fs/promises');
    const cacheFile = path.join(os.homedir(), '.dsh', 'dsh-update-checker', 'last-desktop.json');
    const cached = JSON.parse(await readFile(cacheFile, 'utf8'));
    check('per-profile cache file persisted', !!cached?.at && Array.isArray(cached?.rows), `${cacheFile}`);
  } catch (error) {
    check('per-profile cache file persisted', false, String(error));
  }

  // 2. cached last result (memory hit after the run above)
  try {
    const res = await post('/dsh-update-checker/check.last', envelope('check.last', undefined));
    const json = await res.json();
    check('check.last returns cached run', json?.result?.ok === true && !!json?.result?.value?.at, `at=${json?.result?.value?.at}`);
  } catch (error) {
    check('check.last executed', false, String(error));
  }

  // 3. protocol negatives
  const wrongMethod = await fetch(baseUrl + '/dsh-update-checker/check.last', { method: 'GET' });
  check('GET rejected 404', wrongMethod.status === 404);

  const badCt = await post('/dsh-update-checker/check.last', 'x', { 'content-type': 'text/plain' });
  check('wrong content-type 415', badCt.status === 415);

  const mismatch = await post('/dsh-update-checker/check.last', envelope('check.run', undefined));
  const mismatchJson = await mismatch.json();
  check('method/endpoint mismatch → bad-request', mismatchJson?.result?.ok === false && mismatchJson?.result?.error?.code === 'bad-request');

  const badEnvelope = await post('/dsh-update-checker/check.last', JSON.stringify({ no: 'envelope' }));
  const badJson = await badEnvelope.json();
  check('invalid envelope → rpcId invalid-request', badJson?.rpcId === 'invalid-request');

  const unknown = await post('/dsh-update-checker/check.nope', envelope('check.nope', undefined));
  const unknownJson = await unknown.json();
  check('unknown endpoint → bad-request', unknownJson?.result?.ok === false && unknownJson?.result?.error?.code === 'bad-request');

  // 4. auth fence: non-loopback Host → 403 (raw http.request: fetch() forbids
  //    forging the Host header, so undici would silently drop the override)
  const fenceStatus = await new Promise((resolve, reject) => {
    const raw = httpRequest(
      `http://127.0.0.1:${port}/dsh-update-checker/check.last`,
      { method: 'POST', headers: { 'content-type': 'application/json', host: 'evil.example.com' } },
      (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); },
    );
    raw.on('error', reject);
    raw.end(envelope('check.last', undefined));
  });
  check('non-loopback Host → 403', fenceStatus === 403, `status=${fenceStatus}`);

  // 5. loopback fallback fence (no requestRejection on the connection mock)
  const saved = connection.requestRejection;
  delete connection.requestRejection;
  const loopbackOk = await post('/dsh-update-checker/check.last', envelope('check.last', undefined));
  check('loopback fallback path works without requestRejection', loopbackOk.status === 200);
  connection.requestRejection = saved;

  // 6. regression (v0.2.1 live-install bug): disposing the plugin fiber must
  //    remove the web route, so a reload registers cleanly. cordis drops the
  //    return value of constructor-form apply; cleanup only works via ctx.effect.
  //    With the old code this throws "webserver: duplicate prefix route".
  if (fiber1) {
    let reloadError = null;
    let routeAfterReload = false;
    let routeGoneBetween = false;
    try {
      await fiber1.dispose();
      routeGoneBetween = !routes.some((r) => r.path === '/dsh-update-checker');
      await ctx.plugin(plugin);
      for (let i = 0; i < 50 && !routes.some((r) => r.path === '/dsh-update-checker'); i++) await sleep(100);
      routeAfterReload = routes.some((r) => r.path === '/dsh-update-checker');
    } catch (error) {
      reloadError = error;
    }
    check('fiber dispose removes route (ctx.effect cleanup ran)', routeGoneBetween, routeGoneBetween ? '' : 'route still registered after dispose');
    check('reload after dispose registers cleanly', !reloadError && routeAfterReload, reloadError ? String(reloadError?.stack ?? reloadError).split('\n').slice(0, 3).join(' | ') : '');
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);

// dispose: plugin cleanup + server close
try { await ctx.dispose(); } catch { /* ignore */ }
server.close();
process.exit(failed.length ? 1 : 0);

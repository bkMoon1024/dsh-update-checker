// Unit tests for lib/http.js — the shared outbound layer. All offline:
// fetch is scripted, the clock is injectable where TTL matters.
import { createHttpLayer, HttpError } from '../lib/http.js';

const results = [];
function check(name, condition, detail = '') {
  results.push(!!condition);
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function jsonResponse(body, { etag, status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { get: (name) => (name.toLowerCase() === 'etag' ? etag ?? null : null) },
    json: async () => body,
  };
}

// 1. fresh-TTL cache: second call hits memory, no second network request
{
  let calls = 0;
  const http = createHttpLayer({ fetch: async () => { calls += 1; return jsonResponse({ v: 1 }); } });
  const a = await http.getJson('https://x.test/a');
  const b = await http.getJson('https://x.test/a');
  check('fresh TTL: single fetch for two calls', calls === 1, `calls=${calls}`);
  check('fresh TTL: same body', a === b && a.v === 1);
  check('fresh TTL: cacheHits counted', http.stats.cacheHits === 1, JSON.stringify(http.stats));
}

// 2. single-flight: concurrent callers share one request
{
  let calls = 0;
  const http = createHttpLayer({
    fetch: async () => { calls += 1; await new Promise((r) => setTimeout(r, 30)); return jsonResponse({ v: 2 }); },
  });
  const [a, b, c] = await Promise.all([
    http.getJson('https://x.test/sf'),
    http.getJson('https://x.test/sf'),
    http.getJson('https://x.test/sf'),
  ]);
  check('single-flight: three concurrent callers → one fetch', calls === 1, `calls=${calls}`);
  check('single-flight: all get the same result', a === b && b === c && a.v === 2);
  check('single-flight: coalesced counted', http.stats.coalesced === 2, JSON.stringify(http.stats));
}

// 3. ETag revalidation: stale entry revalidates with If-None-Match; 304 is quota-free reuse
{
  let calls = 0;
  let seenIfNoneMatch = null;
  let clock = 1000;
  const http = createHttpLayer({
    now: () => clock,
    ttlMs: 100,
    fetch: async (url, { headers } = {}) => {
      calls += 1;
      if (calls === 1) return jsonResponse({ v: 'first' }, { etag: 'W/"a1"' });
      seenIfNoneMatch = headers['if-none-match'] ?? null;
      if (seenIfNoneMatch === 'W/"a1"') {
        const response = jsonResponse(null, { status: 304 });
        response.json = async () => { throw new Error('304 has no body'); };
        return response;
      }
      return jsonResponse({ v: 'second' }, { etag: 'W/"a2"' });
    },
  });
  const first = await http.getJson('https://x.test/etag');
  clock += 200; // entry now stale
  const second = await http.getJson('https://x.test/etag');
  check('etag: stale revalidation sent If-None-Match', seenIfNoneMatch === 'W/"a1"', String(seenIfNoneMatch));
  check('etag: 304 reuses cached body', second === first && second.v === 'first');
  check('etag: notModified counted', http.stats.notModified === 1, JSON.stringify(http.stats));
  // 304 refreshed `at`, so an immediate third call is fresh again (no request)
  const third = await http.getJson('https://x.test/etag');
  check('etag: 304 extends freshness', calls === 2 && third === first, `calls=${calls}`);
}

// 4. ETag changed upstream: 200 with new etag replaces the body
{
  let calls = 0;
  let clock = 0;
  const http = createHttpLayer({
    now: () => clock,
    ttlMs: 50,
    fetch: async (url, { headers } = {}) => {
      calls += 1;
      if (calls === 1) return jsonResponse({ v: 'old' }, { etag: 'W/"o"' });
      return headers['if-none-match'] === 'W/"o"'
        ? jsonResponse({ v: 'new' }, { etag: 'W/"n"' })
        : jsonResponse({ v: 'new-no-cond' }, { etag: 'W/"n"' });
    },
  });
  await http.getJson('https://x.test/change');
  clock += 100;
  const updated = await http.getJson('https://x.test/change');
  check('etag: changed upstream returns new body', updated.v === 'new', JSON.stringify(updated));
}

// 5. concurrency cap: never more than `concurrency` requests in flight
{
  let inFlight = 0;
  let maxInFlight = 0;
  const http = createHttpLayer({
    concurrency: 3,
    fetch: async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      return jsonResponse({ ok: true });
    },
  });
  await Promise.all(Array.from({ length: 10 }, (_, i) => http.getJson(`https://x.test/c${i}`)));
  check('concurrency: capped at limit', maxInFlight === 3, `maxInFlight=${maxInFlight}`);
}

// 6. HTTP errors surface as HttpError with status
{
  const http = createHttpLayer({ fetch: async () => jsonResponse({ message: 'nope' }, { status: 403 }) });
  let caught = null;
  try { await http.getJson('https://x.test/e'); } catch (error) { caught = error; }
  check('http error: HttpError with status', caught instanceof HttpError && caught.status === 403, String(caught));
}

// 7. timeout: a hanging fetch rejects via the per-request timeout
{
  const http = createHttpLayer({
    timeoutMs: 40,
    // faithful to real fetch: rejects when the request signal aborts
    fetch: (url, { signal } = {}) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')));
    }),
  });
  let caught = null;
  try { await http.getJson('https://x.test/hang'); } catch (error) { caught = error; }
  check('timeout: hanging fetch rejects', caught instanceof HttpError, String(caught));
}

// 8. host cooldown: blockHost / hostBlocked round-trip and expiry
{
  let clock = 0;
  const http = createHttpLayer({ now: () => clock });
  check('cooldown: open initially', http.hostBlocked('https://api.github.com/x') === false);
  http.blockHost('api.github.com', 500);
  check('cooldown: blocked while active', http.hostBlocked('https://api.github.com/y') === true);
  check('cooldown: other hosts unaffected', http.hostBlocked('https://cdn.jsdelivr.net/z') === false);
  clock += 600;
  check('cooldown: expires', http.hostBlocked('https://api.github.com/x') === false);
}

// 9. failed request is not cached (next call retries)
{
  let calls = 0;
  const http = createHttpLayer({
    fetch: async () => {
      calls += 1;
      if (calls === 1) return jsonResponse({}, { status: 500 });
      return jsonResponse({ recovered: true });
    },
  });
  let firstError = null;
  try { await http.getJson('https://x.test/retry'); } catch (e) { firstError = e; }
  const second = await http.getJson('https://x.test/retry');
  check('failure not cached: retried and recovered', firstError instanceof HttpError && second.recovered === true, `calls=${calls}`);
}

const failed = results.filter((pass) => !pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

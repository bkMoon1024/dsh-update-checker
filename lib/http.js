/**
 * Outbound HTTP layer for dsh-update-checker.
 *
 * Every registry/CDN/GitHub call goes through one shared layer that provides
 * the four properties a check-only scanner needs to stay stable under the
 * upstream quotas (GitHub anonymous: 60 req/h/IP) and fast on repeat scans:
 *
 *  1. Concurrency cap — one semaphore for ALL outbound requests so a scan
 *     over N plugins x M endpoints cannot open N*M sockets at once.
 *  2. Single-flight — concurrent callers for the same URL share one request
 *     (two plugins pointing at the same GitHub repo cost one releases call).
 *  3. TTL cache + ETag revalidation — responses younger than ttlMs are served
 *     from memory; stale-but-etagged entries revalidate with If-None-Match.
 *     GitHub REST conditional requests that come back 304 do not count
 *     against the rate limit, which is what keeps repeat scans affordable.
 *  4. Host cooldown — after GitHub answers 403/429 the caller can block that
 *     host for a while; blocked hosts fail fast so the per-row fallback chain
 *     (releases → tags → jsDelivr) skips the doomed API hop entirely.
 *
 * The layer is deliberately injectable: tests pass a fake `fetch` and a
 * deterministic `now`. It never throws for cache-miss reasons — errors come
 * from the network/HTTP layer as HttpError with a status code attached.
 */

export class HttpError extends Error {
  constructor(message, { status = 0, url = '', headers = null } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.headers = headers;
  }
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch] fetch implementation (injectable for tests)
 * @param {() => number} [options.now] clock (injectable for tests)
 * @param {number} [options.timeoutMs] per-request timeout
 * @param {number} [options.ttlMs] fresh-window for cached responses
 * @param {number} [options.concurrency] max simultaneous outbound requests
 */
export function createHttpLayer({
  fetch: fetchImpl = globalThis.fetch?.bind(globalThis),
  now = () => Date.now(),
  timeoutMs = 8000,
  ttlMs = 5 * 60_000,
  concurrency = 6,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('createHttpLayer: no fetch implementation available');

  /** @type {Map<string, {at:number, etag:string|null, json:unknown}>} */
  const entries = new Map();
  /** @type {Map<string, Promise<unknown>>} single-flight per URL */
  const inflight = new Map();
  /** @type {Map<string, number>} host → blocked-until timestamp */
  const cooldowns = new Map();

  const stats = { requests: 0, cacheHits: 0, coalesced: 0, revalidations: 0, notModified: 0 };

  // --- semaphore -------------------------------------------------------------
  let active = 0;
  /** @type {Array<() => void>} */
  const waiting = [];

  function acquire() {
    if (active < concurrency) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiting.push(resolve)).then(() => {
      active += 1;
    });
  }

  function release() {
    active -= 1;
    const next = waiting.shift();
    if (next) next();
  }

  /**
   * AbortController wired to a REF'D setTimeout plus the caller's signal.
   * AbortSignal.timeout() alone is not enough for a library: its timer is
   * unref'd, so in a host with an otherwise-drained event loop (a bare
   * script, a test runner) the timeout can never fire. A regular timer
   * keeps the loop alive for the duration of the request, guaranteeing the
   * deadline in any embedding; both timer and listener are cleaned up on
   * settle.
   */
  function requestAbort(signal, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`timeout after ${ms}ms`)), ms);
    let onCallerAbort = null;
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else {
        onCallerAbort = () => controller.abort(signal.reason);
        signal.addEventListener('abort', onCallerAbort, { once: true });
      }
    }
    return {
      signal: controller.signal,
      done() {
        clearTimeout(timer);
        if (onCallerAbort) signal.removeEventListener('abort', onCallerAbort);
      },
    };
  }

  function hostOf(url) {
    try {
      return new URL(url).host;
    } catch {
      return String(url);
    }
  }

  /** Block a host (e.g. 'api.github.com') for `ms`; blocked hosts fail fast. */
  function blockHost(host, ms) {
    const until = now() + ms;
    const current = cooldowns.get(host) ?? 0;
    cooldowns.set(host, Math.max(current, until));
  }

  function hostBlocked(urlOrHost) {
    const host = hostOf(urlOrHost);
    const until = cooldowns.get(host);
    if (until === undefined) return false;
    if (until <= now()) {
      cooldowns.delete(host);
      return false;
    }
    return true;
  }

  async function getJson(url, { headers = {}, signal = null, ttlMs: overrideTtl } = {}) {
    const ttl = overrideTtl ?? ttlMs;

    const cached = entries.get(url);
    if (cached && now() - cached.at < ttl) {
      stats.cacheHits += 1;
      return cached.json;
    }

    const existing = inflight.get(url);
    if (existing) {
      stats.coalesced += 1;
      return existing;
    }

    const request = (async () => {
      await acquire();
      const deadline = requestAbort(signal, timeoutMs);
      try {
        const requestHeaders = { ...headers };
        if (cached?.etag) requestHeaders['if-none-match'] = cached.etag;
        if (cached?.etag) stats.revalidations += 1;
        stats.requests += 1;
        let response;
        try {
          response = await fetchImpl(url, {
            signal: deadline.signal,
            headers: requestHeaders,
          });
        } catch (error) {
          throw new HttpError(error instanceof Error ? error.message : String(error), { url });
        }
        if (response.status === 304 && cached) {
          cached.at = now();
          stats.notModified += 1;
          return cached.json;
        }
        if (!response.ok) {
          let headersSnapshot = null;
          try {
            headersSnapshot = Object.fromEntries(response.headers.entries());
          } catch { /* opaque headers */ }
          throw new HttpError(`${response.status} ${response.statusText || ''}`.trim(), {
            status: response.status,
            url,
            headers: headersSnapshot,
          });
        }
        const etag = (() => { try { return response.headers.get('etag'); } catch { return null; } })();
        const json = await response.json();
        entries.set(url, { at: now(), etag: typeof etag === 'string' && etag.length > 0 ? etag : null, json });
        return json;
      } finally {
        deadline.done();
        release();
      }
    })();

    inflight.set(url, request);
    try {
      return await request;
    } finally {
      inflight.delete(url);
    }
  }

  return { getJson, blockHost, hostBlocked, stats };
}

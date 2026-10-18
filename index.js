/**
 * dsh-update-checker — host half.
 *
 * Settings-page RPC over a dedicated /dsh-update-checker webServer route.
 *
 * Why not ctx.connection.rpc.handle()? On current dsh desktop builds the
 * connection service injects only ['credentials'] and its rpc.handle →
 * register() path touches owner.webServer, which throws
 * "cannot get property \"webServer\" without inject". dsh-pocket hit the
 * same regression (see its lib/web-rpc.js, dsh v0.1.5-alpha.1 note) and
 * switched to mounting its own webServer route. We mirror that proven
 * approach:
 *
 *   1. inject webServer ourselves and register a 'prefix' route for the
 *      channel, replicating the connection /api wire protocol exactly
 *      (client-request envelope → handler → server-response envelope);
 *   2. gate every request through connection.requestRejection(req)
 *      (browser cookie + Host/Origin fence), falling back to a loopback
 *      trust check on builds that lack it;
 *   3. keep rpc.handle only as a legacy/headless fallback for builds
 *      without a usable webServer.
 *
 * The client half (client/client.js) calls this channel through the
 * standard ctx.connection.rpc.call(CHANNEL, endpoint, payload), which
 * POSTs `CHANNEL/endpoint` same-origin — no client changes needed.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCheck } from './lib/checker.js';
import {
  RETRY_BASE_MS,
  START_DELAY_MS,
  ignoreAllPending,
  ignoreFingerprint,
  nextDelayMs,
  pendingFromResult,
  readConfig,
  readReminderState,
  reminderPayload,
  writeConfig,
  writeReminderState,
} from './lib/reminder.js';

export const name = 'dsh-update-checker';

export const inject = ['webServer', 'connection', 'profileContext'];

const CHANNEL = '/dsh-update-checker';
/** RPC request body cap: results are small JSON, 4 MB is generous. */
const BODY_MAX = 4 * 1024 * 1024;
/** endpoint segment characters (aligned with dsh-client-connection). */
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/;
/** rpcId used when the client-request envelope fails validation. */
const INVALID_REQUEST_RPC_ID = 'invalid-request';

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1']);

/** In-memory cache of the last completed run (survives within one host process). */
let lastResult = null;

/**
 * In-flight dedup: concurrent check.run callers (double-click, several
 * windows) share one scan instead of hammering the registries — the GitHub
 * anonymous quota is 60 req/h/IP and one scan can spend 10+ of them.
 * The shared scan runs without any caller's abort signal so one client
 * leaving cannot kill the result for the others; per-fetch timeouts bound it.
 */
let inFlightRun = null;

/**
 * Read-modify-write cycles on the reminder state file are serialized. A
 * background scan finishing at the same moment as an `ignore` click would
 * otherwise write back the pre-ignore snapshot and resurrect a reminder the
 * user just dismissed.
 */
let stateWriteQueue = Promise.resolve();

function withStateLock(task) {
  const run = stateWriteQueue.then(task, task);
  stateWriteQueue = run.then(() => {}, () => {});
  return run;
}

function ok(value) {
  return { ok: true, value };
}

/** Build a dsh rpcErrorSchema-compatible failure envelope. */
function fail(code, message) {
  if (code === 'cancelled') return { ok: false, error: { code: 'cancelled', message, details: {} } };
  return { ok: false, error: { code: 'bad-request', message, details: { issues: [{ message }] } } };
}

/**
 * Per-profile cache file: profiles sharing one ~/.dsh home must not leak
 * each other's plugin sets. Legacy flat filename is read as a fallback.
 */
function lastResultFiles(profileContext) {
  const home = profileContext?.home ?? path.join(os.homedir(), '.dsh');
  const name = profileContext?.name ? String(profileContext.name).replace(/[^A-Za-z0-9._-]+/g, '_') : 'default';
  return [
    path.join(home, 'dsh-update-checker', `last-${name}.json`),
    path.join(home, 'dsh-update-checker-last.json'),
  ];
}

async function persistLast(file, result) {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    // Atomic swap so a crash mid-write can never leave a truncated cache
    // that check.last would happily JSON-parse-fail on next boot.
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(result), 'utf8');
    await fs.rename(tmp, file);
  } catch {
    /* best-effort persistence */
  }
}

/** Extract `<endpoint>` from `${channel}/<endpoint>`; undefined when malformed. */
function endpointFromPath(channel, pathname) {
  if (!pathname.startsWith(`${channel}/`)) return undefined;
  const endpoint = pathname.slice(channel.length + 1);
  if (endpoint.split('/').some((seg) => seg === '' || seg === '.' || seg === '..' || !ENDPOINT_SEGMENT_PATTERN.test(seg))) {
    return undefined;
  }
  return endpoint;
}

/** Serialize a server-response envelope. */
function serverResponseJson(rpcId, result) {
  return JSON.stringify({ type: 'server-response', rpcId, result });
}

/**
 * Minimal trust fence for builds without connection.requestRejection:
 * loopback Host only, reject cross-site fetch and mismatched Origin.
 */
export function isTrustedLoopbackRequest(req) {
  const host = req.headers?.host;
  if (!host) return false;
  const hostName = host.split(':')[0];
  if (!LOOPBACK_HOSTNAMES.has(hostName)) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

/**
 * Wrap an RPC handler into a fetch-shaped handler, replicating the
 * dsh-client-connection /api semantics: 404 (non-POST / bad endpoint),
 * 415 (content type), 400 (non-JSON body), bad-request envelope
 * (invalid envelope / method-endpoint mismatch), 500 (handler throw),
 * 200 + server-response JSON on success.
 */
function rpcFetchHandler(channel, handler) {
  return {
    async fetch(request) {
      const endpoint = endpointFromPath(channel, new URL(request.url).pathname);
      if (request.method !== 'POST' || endpoint === undefined) {
        return new Response('not found', { status: 404 });
      }
      const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
      if (mediaType !== 'application/json') {
        return new Response('content type must be application/json', { status: 415 });
      }
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response('body is not JSON', { status: 400 });
      }
      const rpcId = body && typeof body.rpcId === 'string' ? body.rpcId : INVALID_REQUEST_RPC_ID;
      const method = body && typeof body.method === 'string' ? body.method : null;
      if (rpcId === INVALID_REQUEST_RPC_ID || method === null) {
        return new Response(
          serverResponseJson(INVALID_REQUEST_RPC_ID, {
            ok: false,
            error: { code: 'bad-request', message: 'invalid client-request message', details: { issues: [] } },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (method !== endpoint) {
        return new Response(
          serverResponseJson(rpcId, {
            ok: false,
            error: {
              code: 'bad-request',
              message: `method ${JSON.stringify(method)} does not match endpoint ${JSON.stringify(endpoint)}`,
              details: { issues: [] },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      try {
        const result = await handler(endpoint, body.payload, request.signal);
        return new Response(serverResponseJson(rpcId, result), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      } catch (err) {
        console.error(`dsh-update-checker: rpc ${endpoint} failed: ${err?.stack ?? err}`);
        return new Response(`handler failure: ${String(err)}`, { status: 500 });
      }
    },
  };
}

/**
 * node:http request → fetch-shaped handler → node:http response bridge,
 * aligned with dsh-client-connection: abort on client disconnect, 413 on
 * oversized bodies (declared or streamed), string headers passed through,
 * streamed response writes with backpressure handling.
 */
async function httpBridge(req, res, fetchHandler, maxBodyBytes) {
  const abort = new AbortController();
  res.on('close', () => { if (!res.writableEnded) abort.abort(); });

  const declaredLen = req.headers['content-length'];
  if (declaredLen !== undefined && Number(declaredLen) > maxBodyBytes) {
    res.writeHead(413, { connection: 'close' });
    res.end();
    req.destroy();
    return;
  }
  const chunks = [];
  let received = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    received += chunk.length;
    if (received > maxBodyBytes) { tooLarge = true; break; }
    chunks.push(chunk);
  }
  if (tooLarge) {
    res.writeHead(413, { connection: 'close' });
    res.end();
    req.destroy();
    return;
  }

  const url = `http://${req.headers.host ?? '127.0.0.1'}${req.url}`;
  const init = {
    method: req.method ?? 'GET',
    headers: Object.fromEntries(
      Object.entries(req.headers).filter(([, v]) => typeof v === 'string'),
    ),
    signal: abort.signal,
  };
  if (chunks.length > 0) init.body = Buffer.concat(chunks);
  const request = new Request(url, init);

  const response = await fetchHandler.fetch(request);
  const headers = Object.fromEntries(response.headers.entries());
  res.writeHead(response.status, headers);
  if (response.body === null) { res.end(); return; }
  for await (const chunk of response.body) {
    if (!res.write(chunk)) {
      await new Promise((resolve) => {
        const done = () => { res.off('drain', done); res.off('close', done); resolve(); };
        res.once('drain', done);
        res.once('close', done);
      });
    }
    if (res.writableEnded) break;
  }
  res.end();
}

/**
 * Mount the /dsh-update-checker channel directly onto the webServer this
 * plugin injects. Returns an idempotent cleanup function, or null when the
 * environment has no usable webServer (caller should fall back to
 * rpc.handle).
 */
function mountWebRoute(ctx, { channel, handler }) {
  const webServer = ctx?.webServer;
  if (!webServer || typeof webServer.register !== 'function') return null;
  const connection = ctx?.connection;
  const fetchHandler = rpcFetchHandler(channel, handler);
  const route = {
    kind: 'prefix',
    path: channel,
    handler: async (req, res) => {
      // Prefer the platform fence (401/403 incl. browser cookie auth);
      // must be invoked method-style so it keeps its `this` (dsh-pocket
      // issue #117 documents the bare-function pitfall).
      let rejection;
      if (typeof connection?.requestRejection === 'function') {
        try { rejection = connection.requestRejection(req); } catch { rejection = 403; }
      } else if (!isTrustedLoopbackRequest(req)) {
        rejection = 403;
      }
      if (rejection !== undefined) {
        res.writeHead(rejection, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
        return;
      }
      await httpBridge(req, res, fetchHandler, BODY_MAX);
    },
  };
  const registered = webServer.register(route);
  // register() may return a disposer, Promise<disposer>, or undefined.
  const cleanup = typeof registered === 'function'
    ? () => { try { registered(); } catch { /* already cleaned */ } }
    : (registered && typeof registered.then === 'function')
      ? (() => { let done = false; return async () => { if (done) return; done = true; try { const d = await registered; if (typeof d === 'function') d(); } catch { /* already cleaned */ } }; })()
      : () => {};
  return cleanup;
}

/**
 * Run (or join) one scan for the active profile and fold its result into the
 * reminder state. Shared by the RPC endpoint and the background scheduler so
 * both paths keep the cached result, the persisted snapshot, and the pending
 * update list in sync.
 */
async function ensureCheck(ctx) {
  const profileContext = ctx.profileContext;
  if (!inFlightRun || inFlightRun.dir !== profileContext.dir) {
    let promise;
    promise = runCheck(profileContext.dir)
      .then((result) => {
        // Only clear the marker when it still belongs to this scan: another
        // profile on the same host may have replaced it meanwhile.
        if (inFlightRun?.promise === promise) inFlightRun = null;
        lastResult = result;
        void persistLast(lastResultFiles(profileContext)[0], result);
        return result;
      }, (error) => {
        if (inFlightRun?.promise === promise) inFlightRun = null;
        throw error;
      });
    inFlightRun = { dir: profileContext.dir, promise };
  }
  const result = await inFlightRun.promise;
  await recordReminderResult(ctx, result);
  return result;
}

/** Persist what the latest scan means for the footer reminder. */
async function recordReminderResult(ctx, result) {
  try {
    const profileContext = ctx.profileContext;
    await withStateLock(async () => {
      const state = await readReminderState(profileContext);
      state.lastCheckAt = result.at;
      state.lastError = null;
      state.pending = pendingFromResult(result, state.ignored);
      await writeReminderState(profileContext, state);
    });
  } catch (error) {
    console.error(`dsh-update-checker: reminder state write failed: ${error?.message ?? error}`);
  }
}

async function recordReminderFailure(ctx, error) {
  try {
    const profileContext = ctx.profileContext;
    await withStateLock(async () => {
      const state = await readReminderState(profileContext);
      state.lastError = error instanceof Error ? error.message : String(error);
      await writeReminderState(profileContext, state);
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Background scan loop: one timer, re-armed after each attempt. A scan that
 * throws backs off exponentially (capped at the configured interval) so a
 * broken network or an exhausted GitHub quota is not hammered every minute.
 *
 * Dependencies are injectable so the timer state machine can be tested without
 * a host or a network.
 */
export function startReminderScheduler(ctx, {
  readConfig: readConfigImpl = readConfig,
  scan = ensureCheck,
  recordFailure = recordReminderFailure,
  startDelayMs = START_DELAY_MS,
} = {}) {
  let timer = null;
  let disposed = false;
  let ticking = false;
  let rescheduleRequested = false;
  let failures = 0;

  const arm = (delayMs) => {
    if (disposed) return;
    // Exactly one timer at a time: a reschedule racing a running tick may
    // already have armed one, and two live timers would double the scan rate
    // for the rest of the process lifetime.
    if (timer !== null) { clearTimeout(timer); timer = null; }
    timer = setTimeout(() => { void tick(); }, delayMs);
    // Do not keep the host process alive just for a reminder tick.
    if (typeof timer.unref === 'function') timer.unref();
  };

  /**
   * One scheduled attempt. Every context read happens inside this try: once
   * the fiber is torn down, cordis throws on `ctx.<service>` ("cannot get
   * required service ... in inactive context"), and an exception escaping a
   * setTimeout callback is an unhandled rejection — the host treats that as a
   * fatal load failure and exits.
   */
  const tick = async () => {
    timer = null;
    if (disposed) return;
    ticking = true;
    let intervalMinutes;
    try {
      const config = await readConfigImpl(ctx.profileContext);
      intervalMinutes = config.intervalMinutes;
      if (config.enabled) await scan(ctx);
      failures = 0;
    } catch (error) {
      failures += 1;
      await recordFailure(ctx, error);
    }
    ticking = false;
    // A config change made while the scan was running must win over the
    // interval this tick started with.
    if (rescheduleRequested) {
      rescheduleRequested = false;
      try {
        intervalMinutes = (await readConfigImpl(ctx.profileContext)).intervalMinutes;
      } catch {
        /* torn-down fiber: dispose() follows */
      }
    }
    arm(nextDelayMs({ failures, intervalMinutes }));
  };

  arm(startDelayMs);

  return {
    /** Re-arm after a config change so a new interval takes effect now. */
    reschedule: async () => {
      if (disposed) return;
      failures = 0;
      if (ticking) {
        // The running tick re-reads the config and arms the new interval when
        // it settles; arming here as well would leave two timers behind.
        rescheduleRequested = true;
        return;
      }
      if (timer !== null) { clearTimeout(timer); timer = null; }
      let intervalMinutes;
      try {
        intervalMinutes = (await readConfigImpl(ctx.profileContext)).intervalMinutes;
      } catch {
        /* torn-down fiber: the timer is going away with it */
      }
      arm(nextDelayMs({ intervalMinutes }));
    },
    dispose: () => {
      disposed = true;
      if (timer !== null) { clearTimeout(timer); timer = null; }
    },
  };
}

/** Channel handler: scans, cached results, and the footer reminder state. */
async function handleRpc(ctx, internal, endpoint, payload, signal) {
  if (signal?.aborted) return fail('cancelled', 'The request was cancelled.');
  let profileContext;
  try {
    profileContext = ctx.profileContext;
  } catch {
    // The fiber was torn down (reload/HMR) while this request was in flight.
    return fail('bad-request', 'dsh-update-checker is not active.');
  }
  if (endpoint === 'check.run') {
    // Freshness window: a click within 90s of a completed scan reuses its
    // result instead of burning another ~15 upstream requests (the GitHub
    // API allows only 60 anonymous calls/hour — ~6 rapid clicks would
    // exhaust it and degrade every row to tag-only fallbacks).
    if (
      lastResult
      && lastResult.profileDir === profileContext.dir
      && Date.now() - new Date(lastResult.at).getTime() < 90_000
      && !inFlightRun
    ) {
      return ok(lastResult);
    }
    try {
      return ok(await ensureCheck(ctx));
    } catch (error) {
      return fail('bad-request', error instanceof Error ? error.message : String(error));
    }
  }
  if (endpoint === 'check.last') {
    // Memory hit only within the same profile: a host process serving
    // several profiles must not hand desktop's plugin set to another one.
    if (lastResult && lastResult.profileDir === profileContext.dir) return ok(lastResult);
    for (const file of lastResultFiles(profileContext)) {
      try {
        const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
        // The legacy flat file is shared by every profile on this host; hand
        // it over only when it was written for the profile asking.
        if (parsed && parsed.profileDir === profileContext.dir) return ok(parsed);
      } catch {
        /* try the next candidate */
      }
    }
    return ok(null);
  }
  if (endpoint === 'reminder.state') {
    const [config, state] = await Promise.all([
      readConfig(profileContext),
      readReminderState(profileContext),
    ]);
    return ok(reminderPayload({ config, state, running: inFlightRun !== null }));
  }
  if (endpoint === 'config.set') {
    const previous = await readConfig(profileContext);
    const next = await writeConfig(profileContext, { ...previous, ...(payload ?? {}) });
    void internal.scheduler?.reschedule?.();
    return ok({ config: next });
  }
  if (endpoint === 'reminder.ignore') {
    const mode = payload?.mode === 'all' ? 'all' : 'once';
    const next = await withStateLock(async () => {
      const state = await readReminderState(profileContext);
      const nextState = mode === 'all' ? ignoreAllPending(state) : ignoreFingerprint(state);
      await writeReminderState(profileContext, nextState);
      return nextState;
    });
    const config = await readConfig(profileContext);
    return ok(reminderPayload({ config, state: next, running: inFlightRun !== null }));
  }
  return fail('bad-request', `unknown endpoint ${JSON.stringify(endpoint)}`);
}

export function apply(ctx) {
  // Internal fiber state shared with the RPC handler. Kept off `ctx` on
  // purpose: cordis 4 rejects `ctx.foo = value` for properties that were
  // never declared via `ctx.provide()` ("cannot set property ... without
  // provide"), and the scheduler is private to this plugin anyway.
  const internal = { scheduler: null };
  const handler = (endpoint, payload, signal) => handleRpc(ctx, internal, endpoint, payload, signal);
  const disposers = [];
  const routeCleanup = mountWebRoute(ctx, { channel: CHANNEL, handler });
  if (routeCleanup) {
    disposers.push(routeCleanup);
  } else {
    // Legacy/headless fallback: builds where connection still owns webServer.
    // Some builds expose a connection without a usable rpc.handle (see the
    // module header), and that path throws while touching owner.webServer —
    // losing the RPC channel is bad, but crashing activation is worse.
    try {
      const handleDispose = ctx.connection.rpc.handle(CHANNEL, handler);
      if (typeof handleDispose === 'function') disposers.push(handleDispose);
    } catch (error) {
      console.warn(`dsh-update-checker: no RPC channel available (${error?.message ?? error}); the reminder scheduler still runs`);
    }
  }
  // Register cleanup before arming the timer: if anything after this throws,
  // the fiber must still take the timer down with it — a live timer on a
  // torn-down fiber is exactly the crash this guard exists to prevent.
  disposers.push(() => {
    internal.scheduler?.dispose();
    internal.scheduler = null;
  });
  // cordis runs constructor-form plugins via `new apply(ctx, config)` and only
  // consults `instance[symbols.init]`; a returned disposer is silently dropped
  // (cordis lib/index.js execute: `return instance?.[symbols.init]?.()`), so
  // the web route would leak across HMR fiber replacement and the next
  // activation dies on "duplicate prefix route". Disposers must go through
  // ctx.effect — the pattern dsh-pocket uses (lib/index.js:401-404).
  ctx.effect(() => () => {
    for (const dispose of disposers.reverse()) {
      try { dispose(); } catch { /* already cleaned */ }
    }
  }, 'dsh-update-checker: remove web route');
  internal.scheduler = startReminderScheduler(ctx);
}

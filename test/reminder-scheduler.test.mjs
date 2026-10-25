/**
 * End-to-end test for the background reminder feature: a real cordis Context
 * activates the plugin, the scheduler arms and runs a scan, and the web
 * channel serves `reminder.state` / `reminder.ignore` / `config.set` through
 * the same node:http bridge the host uses.
 *
 * The profile used here declares no third-party dependencies, so a scan
 * resolves offline and never touches the network.
 *
 * Run: node test/reminder-scheduler.test.mjs
 * Skips (exit 0) when the cordis checkout is unavailable.
 */
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  normalizeState,
  readConfig,
  readReminderState,
  statePath,
  writeConfig,
  writeReminderState,
} from '../lib/reminder.js';

import { CORDIS_URL, CORDIS_SKIP_HINT } from './cordis-path.mjs';
const PLUGIN_URL = new URL('../index.js', import.meta.url).href;

let Context;
if (!CORDIS_URL) {
  console.log(CORDIS_SKIP_HINT);
  process.exit(0);
}
try {
  ({ Context } = await import(CORDIS_URL));
} catch (error) {
  console.log(`${CORDIS_SKIP_HINT}
  (import failed: ${error?.message ?? error})`);
  process.exit(0);
}

// Only the 30s boot delay is compressed; the hour-long intervals stay real so
// the scheduler cannot spin during the test.
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const scheduledDelays = [];
/** Timers armed through the wrapper and not yet fired/cleared. */
const liveTimers = new Set();
globalThis.setTimeout = (fn, ms, ...rest) => {
  if (typeof ms === 'number' && ms >= 1_000 && ms < 3_600_000) {
    scheduledDelays.push(ms);
    let handle = null;
    const wrapped = (...args) => { liveTimers.delete(handle); fn(...args); };
    handle = realSetTimeout(wrapped, 40, ...rest);
    liveTimers.add(handle);
    return handle;
  }
  return realSetTimeout(fn, ms, ...rest);
};
globalThis.clearTimeout = (handle) => {
  liveTimers.delete(handle);
  return realClearTimeout(handle);
};

const escaped = [];
process.on('unhandledRejection', (error) => escaped.push(error));
process.on('uncaughtException', (error) => escaped.push(error));

const results = [];
function check(name, condition, detail = '') {
  results.push(!!condition);
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
function eq(actual, expected, label) {
  check(label, JSON.stringify(actual) === JSON.stringify(expected), JSON.stringify(actual));
}

const HOME_DIR = await mkdtemp(path.join(os.tmpdir(), 'dsh-uc-sched-'));
const PROFILE_DIR = path.join(HOME_DIR, 'profiles', 'desktop');
await mkdir(PROFILE_DIR, { recursive: true });
await writeFile(path.join(PROFILE_DIR, 'package.json'), JSON.stringify({
  name: 'test-profile',
  private: true,
  dependencies: {},
}), 'utf8');

const plugin = await import(PLUGIN_URL);
const profileContext = { name: 'desktop', dir: PROFILE_DIR, home: HOME_DIR };

/** Fake node req/res pair driving the registered prefix route. */
async function callRpc(route, endpoint, payload) {
  const body = JSON.stringify({ rpcId: 'test-rpc', method: endpoint, payload });
  const req = Readable.from([Buffer.from(body)]);
  req.method = 'POST';
  req.url = `/dsh-update-checker/${endpoint}`;
  req.headers = {
    host: '127.0.0.1:1234',
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(body)),
  };
  const chunks = [];
  let status = 0;
  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  res.writeHead = (code) => { status = code; return res; };
  await route.handler(req, res);
  if (!res.writableFinished) await once(res, 'finish');
  const text = Buffer.concat(chunks).toString('utf8');
  return { status, body: text ? JSON.parse(text) : null };
}

function valueOf(response) {
  return response.body?.result?.ok ? response.body.result.value : null;
}

const routes = [];
const webServer = {
  register(route) {
    routes.push(route);
    return () => {
      const index = routes.indexOf(route);
      if (index >= 0) routes.splice(index, 1);
    };
  },
};
const connection = { requestRejection: () => undefined };

const ctx = new Context();
ctx.provide('webServer', webServer);
ctx.provide('connection', connection);

let provider = null;
let fiber = null;
try {
  provider = await ctx.plugin({
    name: 'test-profile-context',
    apply(providerCtx) {
      providerCtx.provide('profileContext', profileContext);
    },
  });

  // --- Scenario A: default config, scheduler runs the first scan -----------
  fiber = await ctx.plugin(plugin);
  for (let i = 0; i < 100 && !routes.some((r) => r.path === '/dsh-update-checker'); i++) await sleep(20);
  const route = routes.find((r) => r.path === '/dsh-update-checker');
  check('plugin mounts the reminder channel', !!route);
  check('first scan is scheduled at activation', scheduledDelays.includes(30_000), `delays=${JSON.stringify(scheduledDelays)}`);

  let state = null;
  for (let i = 0; i < 100; i++) {
    state = await readReminderState(profileContext);
    if (state.lastCheckAt) break;
    await sleep(20);
  }
  check('background scan records lastCheckAt', typeof state.lastCheckAt === 'string' && state.lastCheckAt.length > 0, String(state.lastCheckAt));
  eq(state.lastError, null, 'offline scan records no error');
  eq(state.pending, [], 'profile without dependencies has nothing pending');

  const stateResponse = await callRpc(route, 'reminder.state');
  check('reminder.state answers 200', stateResponse.status === 200, String(stateResponse.status));
  const stateValue = valueOf(stateResponse);
  eq(stateValue?.config, { enabled: true, intervalMinutes: 60 }, 'reminder.state returns the default config');
  eq(stateValue?.pending, [], 'reminder.state returns empty pending');
  check('reminder.state carries lastCheckAt', typeof stateValue?.lastCheckAt === 'string', String(stateValue?.lastCheckAt));
  eq(stateValue?.visible, false, 'empty pending is not visible');

  // --- Scenario B: seeded pending set, scans disabled ----------------------
  await fiber.dispose();
  fiber = null;
  await writeConfig(profileContext, { enabled: false, intervalMinutes: 1440 });
  const seededPending = [
    { name: 'alpha', installed: '1.0.0', latest: '1.1.0', kind: 'npm', spec: '^1.0.0', repoUrl: '', pageUrl: '' },
    { name: 'beta', installed: '2.0.0', latest: '2.1.0', kind: 'github', spec: 'github:o/beta', repoUrl: '', pageUrl: '' },
  ];
  await writeReminderState(profileContext, normalizeState({
    profileDir: PROFILE_DIR,
    lastCheckAt: '2026-10-19T00:03:22.000Z',
    lastError: null,
    pending: seededPending,
    ignoredFingerprint: null,
    ignored: {},
  }, PROFILE_DIR));

  fiber = await ctx.plugin(plugin);
  for (let i = 0; i < 100 && !routes.some((r) => r.path === '/dsh-update-checker'); i++) await sleep(20);
  const seededRoute = routes.find((r) => r.path === '/dsh-update-checker');
  await sleep(150);
  const untouched = await readReminderState(profileContext);
  eq(untouched.pending, seededPending, 'disabled schedule leaves the snapshot untouched');

  const seededResponse = await callRpc(seededRoute, 'reminder.state');
  const seededValue = valueOf(seededResponse);
  eq(seededValue?.config, { enabled: false, intervalMinutes: 1440 }, 'disabled config round trips through RPC');
  eq(seededValue?.pending, seededPending, 'persisted pending rows survive the RPC read (0.3.2 bug)');
  eq(seededValue?.visible, true, 'pending updates make the reminder visible');
  eq(seededValue?.fingerprint, 'alpha@1.1.0|beta@2.1.0', 'fingerprint covers name@latest');

  const ignored = valueOf(await callRpc(seededRoute, 'reminder.ignore', { mode: 'once' }));
  eq(ignored?.visible, false, 'ignore once hides the reminder');
  eq(ignored?.fingerprint, 'alpha@1.1.0|beta@2.1.0', 'ignore once keeps the fingerprint');
  eq((await readReminderState(profileContext)).ignoredFingerprint, 'alpha@1.1.0|beta@2.1.0', 'ignore once persists');

  const ignoredAll = valueOf(await callRpc(seededRoute, 'reminder.ignore', { mode: 'all' }));
  eq(ignoredAll?.pending, [], 'ignore all clears pending');
  eq((await readReminderState(profileContext)).ignored, { alpha: '1.1.0', beta: '2.1.0' }, 'ignore all records versions');
  eq((await readReminderState(profileContext)).pending, [], 'ignore all persists');

  const savedConfig = valueOf(await callRpc(seededRoute, 'config.set', { intervalMinutes: 30 }));
  eq(savedConfig?.config, { enabled: false, intervalMinutes: 30 }, 'config.set returns the merged config');
  eq(await readConfig(profileContext), { enabled: false, intervalMinutes: 30 }, 'config.set persists');
  await sleep(120);
  check(
    'config.set reschedules the next scan',
    scheduledDelays.includes(30 * 60_000),
    `delays=${JSON.stringify(scheduledDelays)}`,
  );

  // --- Scenario C: a reschedule during an in-flight scan keeps one timer ---
  await fiber.dispose();
  fiber = null;
  const { startReminderScheduler } = plugin;
  let configChoice = { enabled: true, intervalMinutes: 30 };
  let scanCount = 0;
  let scanEntered;
  const entered = new Promise((resolve) => { scanEntered = resolve; });
  let releaseScan;
  const slowScan = new Promise((resolve) => { releaseScan = resolve; });
  const scheduler = startReminderScheduler({}, {
    readConfig: async () => configChoice,
    scan: async () => { scanCount += 1; scanEntered(); return slowScan; },
    recordFailure: async () => {},
  });
  await Promise.race([entered, sleep(1000)]);
  check('scenario C: the first tick entered the scan', scanCount === 1, `scans=${scanCount}`);
  configChoice = { enabled: true, intervalMinutes: 45 };
  await scheduler.reschedule();
  check('scenario C: a reschedule during a tick arms no second timer', liveTimers.size === 0, `live=${liveTimers.size}`);
  releaseScan({ at: new Date().toISOString(), profileDir: PROFILE_DIR, rows: [] });
  await sleep(10);
  check('scenario C: exactly one timer survives the tick', liveTimers.size === 1, `live=${liveTimers.size}`);
  check('scenario C: the interval changed mid-scan wins', scheduledDelays.at(-1) === 45 * 60_000, `last=${scheduledDelays.at(-1)}`);
  scheduler.dispose();
  check('scenario C: dispose clears the timer', liveTimers.size === 0, `live=${liveTimers.size}`);

  // --- Scenario D: a build whose connection.rpc.handle throws must not crash
  const ctx2 = new Context();
  ctx2.provide('webServer', {});
  ctx2.provide('connection', { rpc: { handle() { throw new Error('cannot get property "webServer" without inject'); } } });
  const provider2 = await ctx2.plugin({
    name: 'test-profile-context-2',
    apply(providerCtx) {
      providerCtx.provide('profileContext', profileContext);
    },
  });
  let bareFiber = null;
  let bareFailure = null;
  try {
    bareFiber = await ctx2.plugin(plugin);
  } catch (error) {
    bareFailure = error;
  }
  check('scenario D: a throwing rpc.handle fallback does not fail activation', bareFailure === null, String(bareFailure?.message ?? ''));
  check('scenario D: the scheduler still arms its first tick', liveTimers.size === 1, `live=${liveTimers.size}`);
  try { await bareFiber?.dispose(); } catch { /* already torn down */ }
  try { await provider2.dispose(); } catch { /* already torn down */ }
  try { await ctx2.dispose(); } catch { /* already torn down */ }
  check('scenario D: teardown clears the timer', liveTimers.size === 0, `live=${liveTimers.size}`);

  check('no rejection escaped the scheduler', escaped.length === 0, escaped.map((error) => String(error?.message ?? error)).join('; '));
} finally {
  try { await fiber?.dispose(); } catch { /* already torn down */ }
  try { await provider?.dispose(); } catch { /* already torn down */ }
  try { await ctx.dispose(); } catch { /* already torn down */ }
  globalThis.setTimeout = realSetTimeout;
  await rm(HOME_DIR, { recursive: true, force: true });
}

const failed = results.filter((result) => !result).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

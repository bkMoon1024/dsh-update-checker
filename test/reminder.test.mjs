// Unit tests for lib/reminder.js: schedule math, pending bookkeeping, and
// the on-disk round trip (no host, no network).
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import {
  DEFAULT_CONFIG,
  INTERVAL_CHOICES,
  START_DELAY_MS,
  RETRY_BASE_MS,
  RETRY_CAP_MS,
  homeOf,
  configPath,
  statePath,
  normalizeInterval,
  normalizeConfig,
  emptyState,
  fingerprintOf,
  pendingFromResult,
  normalizeState,
  nextDelayMs,
  reminderPayload,
  ignoreFingerprint,
  ignoreAllPending,
  pruneIgnored,
  readConfig,
  writeConfig,
  readReminderState,
  writeReminderState,
  writeJsonAtomic,
} from '../lib/reminder.js';

let passed = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) { console.error(`FAIL ${label}: expected ${b}, got ${a}`); process.exit(1); }
  passed += 1;
}

const row = (overrides = {}) => ({
  name: 'dsh-pocket',
  status: 'update',
  installed: '2.10.7',
  latest: '2.10.8',
  kind: 'npm',
  spec: '^2.10.7',
  repoUrl: 'https://github.com/daha1216/dsh-pocket',
  pageUrl: 'https://www.npmjs.com/package/dsh-pocket',
  ...overrides,
});

// --- normalizeInterval / normalizeConfig -----------------------------------
eq(normalizeInterval(60), 60, 'interval passes through');
eq(normalizeInterval(30.4), 30, 'interval rounds');
eq(normalizeInterval(0), 5, 'interval clamps low');
eq(normalizeInterval(99_999), 1440, 'interval clamps high');
eq(normalizeInterval('120'), 120, 'numeric string accepted');
eq(normalizeInterval('soon'), DEFAULT_CONFIG.intervalMinutes, 'garbage falls back');
// Missing/null settings must not become the most aggressive schedule: the old
// Number(null) coercion clamped to 5 minutes and burned the GitHub quota.
eq(normalizeInterval(null), DEFAULT_CONFIG.intervalMinutes, 'null falls back to default');
eq(normalizeInterval(''), DEFAULT_CONFIG.intervalMinutes, 'empty string falls back');
eq(normalizeInterval(undefined), DEFAULT_CONFIG.intervalMinutes, 'undefined falls back');
eq(normalizeInterval(false), DEFAULT_CONFIG.intervalMinutes, 'false falls back');
eq(normalizeInterval(true), DEFAULT_CONFIG.intervalMinutes, 'true falls back');
eq(normalizeInterval([]), DEFAULT_CONFIG.intervalMinutes, 'array falls back');
eq(normalizeInterval(Number.NaN), DEFAULT_CONFIG.intervalMinutes, 'NaN falls back');
eq(normalizeConfig(undefined), { enabled: true, intervalMinutes: 60 }, 'config defaults');
eq(normalizeConfig({ enabled: false }), { enabled: false, intervalMinutes: 60 }, 'config keeps disabled');
eq(normalizeConfig({ intervalMinutes: 1 }), { enabled: true, intervalMinutes: 5 }, 'config clamps interval');
eq(normalizeConfig({ enabled: 'yes' }), { enabled: true, intervalMinutes: 60 }, 'non-boolean enabled ignored');
eq(INTERVAL_CHOICES, [30, 60, 120, 360], 'interval presets');
eq(START_DELAY_MS, 30_000, 'start delay');

// --- fingerprintOf / pendingFromResult ------------------------------------
eq(fingerprintOf([]), '[]', 'empty fingerprint');
eq(
  fingerprintOf([{ name: 'b', latest: '2' }, { name: 'a', latest: '1' }]),
  JSON.stringify([['a', '1'], ['b', '2']]),
  'fingerprint is sorted',
);
eq(
  fingerprintOf([{ name: 'a@1|b', latest: '2' }]) !== fingerprintOf([{ name: 'a', latest: '1|b@2' }]),
  true,
  'fingerprint cannot collide through the separator',
);
eq(
  pendingFromResult({
    rows: [
      row(),
      row({ name: 'local-tool', status: 'local-behind', installed: '0.3.0', latest: 'v0.3.2', kind: 'file', spec: 'file:D:/tools/local-tool', pageUrl: '' }),
      row({ name: 'x', status: 'latest' }),
      row({ name: 'y', status: 'local-ahead' }),
      row({ name: 'z', status: 'local-latest' }),
      row({ name: 'w', status: 'local' }),
    ],
  }, {}),
  [{
    name: 'dsh-pocket',
    installed: '2.10.7',
    latest: '2.10.8',
    kind: 'npm',
    spec: '^2.10.7',
    repoUrl: 'https://github.com/daha1216/dsh-pocket',
    pageUrl: 'https://www.npmjs.com/package/dsh-pocket',
  }, {
    name: 'local-tool',
    installed: '0.3.0',
    latest: 'v0.3.2',
    kind: 'file',
    spec: 'file:D:/tools/local-tool',
    repoUrl: 'https://github.com/daha1216/dsh-pocket',
    pageUrl: '',
  }],
  'pending keeps update and local-behind rows, compacts them, drops the rest',
);
eq(pendingFromResult({ rows: [row()] }, { 'dsh-pocket': '2.10.8' }), [], 'ignored version filtered');
eq(pendingFromResult({ rows: [row()] }, { 'dsh-pocket': '2.10.7' }).length, 1, 'ignored older version kept');
eq(
  pendingFromResult({ rows: [row({ name: 'local-tool', status: 'local-behind', latest: 'v0.3.2' })] }, { 'local-tool': 'v0.3.2' }),
  [],
  'ignored local-behind version filtered like update rows',
);

// --- normalizeState: persisted pending rows survive the read-back ---------
const compactPending = pendingFromResult({ rows: [row()] }, {});
const persisted = {
  profileDir: 'C:/profile',
  lastCheckAt: '2026-10-19T00:03:22.000Z',
  lastError: null,
  pending: compactPending,
  ignoredFingerprint: null,
  ignored: {},
};
const roundTripped = normalizeState(JSON.parse(JSON.stringify(persisted)), 'C:/profile');
eq(roundTripped.pending, compactPending, 'compact pending rows survive JSON round trip');
eq(
  normalizeState({ ...persisted, pending: [row()] }, 'C:/profile').pending,
  compactPending,
  'legacy full scan rows are accepted and compacted',
);
eq(
  normalizeState({ ...persisted, pending: [{ name: 'broken' }, { latest: '1' }, null] }, 'C:/profile').pending,
  [],
  'malformed pending entries dropped',
);
eq(normalizeState(persisted, 'D:/other'), emptyState('D:/other'), 'foreign profileDir resets state');
eq(normalizeState(null, 'C:/profile'), emptyState('C:/profile'), 'missing file resets state');
eq(
  normalizeState({ ...persisted, ignored: { a: '1', b: 2 } }, 'C:/profile').ignored,
  { a: '1' },
  'ignored map keeps string pairs only',
);

// --- reminderPayload: visibility rules ------------------------------------
const compact = (name, latest) => ({
  name, installed: '', latest, kind: '', spec: '', repoUrl: '', pageUrl: '',
});
const pendingTwo = [compact('a', '1'), compact('b', '2')];
const stateWith = (overrides) => normalizeState({ ...persisted, ...overrides }, 'C:/profile');
eq(
  reminderPayload({ config: {}, state: stateWith({ pending: pendingTwo }) }).visible,
  true,
  'pending set is visible',
);
eq(
  reminderPayload({
    config: {},
    state: stateWith({ pending: pendingTwo, ignoredFingerprint: JSON.stringify([['a', '1'], ['b', '2']]) }),
  }).visible,
  false,
  'dismissed fingerprint hides the reminder',
);
eq(
  reminderPayload({
    config: {},
    state: stateWith({ pending: pendingTwo, ignoredFingerprint: 'a@1|b@2' }),
  }).visible,
  false,
  'pre-upgrade fingerprint (sorted name@latest) still dismisses',
);
eq(
  reminderPayload({
    config: {},
    state: stateWith({ pending: pendingTwo, ignoredFingerprint: 'a@1|b@1' }),
  }).visible,
  true,
  'new version reopens the reminder',
);
eq(reminderPayload({ config: {}, state: stateWith({ pending: [] }) }).visible, false, 'empty pending is hidden');
eq(reminderPayload({ config: {}, state: stateWith({ pending: pendingTwo }) }).pending, pendingTwo, 'payload carries pending');
eq(reminderPayload({ config: {}, state: stateWith({}), running: true }).running, true, 'running flag passes through');
eq(
  reminderPayload({ config: { intervalMinutes: 9999 }, state: stateWith({}) }).config,
  { enabled: true, intervalMinutes: 1440 },
  'payload normalizes config',
);

// --- ignore helpers --------------------------------------------------------
const fingerprintState = ignoreFingerprint(stateWith({ pending: pendingTwo }));
eq(fingerprintState.ignoredFingerprint, JSON.stringify([['a', '1'], ['b', '2']]), 'ignore once records fingerprint');
eq(fingerprintState.pending, pendingTwo, 'ignore once keeps pending rows');
const allState = ignoreAllPending(stateWith({ pending: pendingTwo, ignored: { z: '9' } }));
eq(allState.pending, [], 'ignore all clears pending');
eq(allState.ignored, { z: '9', a: '1', b: '2' }, 'ignore all records every version');
eq(allState.ignoredFingerprint, null, 'ignore all clears dismissal fingerprint');

// Dependency names are not identifiers: a plugin literally called __proto__
// must still be dismissible, and bookkeeping must never touch the prototype.
const protoState = ignoreAllPending(stateWith({ pending: [compact('__proto__', '1'), compact('constructor', '2')] }));
eq(protoState.pending, [], 'ignore all clears pending for hostile names');
eq(Object.keys(protoState.ignored).includes('__proto__'), true, 'ignore all stores __proto__ as own data');
eq(protoState.ignored.__proto__, '1', 'ignore all keeps the hostile version');
eq(Object.getPrototypeOf(protoState.ignored) === Object.prototype, true, 'ignore map keeps a normal prototype');
eq(Object.prototype.polluted, undefined, 'ignore bookkeeping does not pollute Object.prototype');

// pruneIgnored: entries for plugins no longer installed must not grow forever.
eq(pruneIgnored({ a: '1', b: '2' }, [{ name: 'a' }]), { a: '1' }, 'prune drops uninstalled names');
eq(pruneIgnored({ a: '1' }, []), {}, 'prune clears when nothing is installed anymore');
eq(pruneIgnored({ a: '1' }, undefined), {}, 'prune treats missing rows as nothing installed');

// --- nextDelayMs: interval and failure backoff ----------------------------
eq(nextDelayMs({}), 60 * 60_000, 'delay defaults to one hour');
eq(nextDelayMs({ intervalMinutes: 30 }), 30 * 60_000, 'delay follows interval');
eq(nextDelayMs({ intervalMinutes: 30, failures: 1 }), RETRY_BASE_MS, 'first failure waits 5m');
eq(nextDelayMs({ intervalMinutes: 30, failures: 2 }), RETRY_BASE_MS * 2, 'second failure doubles');
eq(nextDelayMs({ intervalMinutes: 30, failures: 4 }), 30 * 60_000, 'backoff capped by interval');
eq(nextDelayMs({ intervalMinutes: 1440, failures: 10 }), RETRY_CAP_MS, 'backoff capped at one hour');

// --- file round trip -------------------------------------------------------
const tmpHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-uc-reminder-'));
const profileDir = path.join(tmpHome, 'profiles', 'desktop');
const profileContext = { name: 'desktop', dir: profileDir, home: tmpHome };
try {
  eq(homeOf({}), path.join(os.homedir(), '.dsh'), 'home falls back to ~/.dsh');
  eq(homeOf({ home: tmpHome }), tmpHome, 'home uses profileContext.home');
  eq(
    configPath(profileContext),
    path.join(tmpHome, 'dsh-update-checker', 'config.json'),
    'config path layout',
  );
  eq(
    statePath(profileContext),
    path.join(tmpHome, 'dsh-update-checker', 'reminder-desktop.json'),
    'state path layout',
  );
  eq(
    statePath({ ...profileContext, name: 'work/prod x' }),
    path.join(tmpHome, 'dsh-update-checker', 'reminder-work_prod_x.json'),
    'state path sanitizes profile name',
  );
  eq(statePath({ home: tmpHome }), path.join(tmpHome, 'dsh-update-checker', 'reminder-default.json'), 'state path defaults slug');

  eq(await readConfig(profileContext), { enabled: true, intervalMinutes: 60 }, 'missing config reads as default');
  eq(await writeConfig(profileContext, { enabled: false, intervalMinutes: 2 }), { enabled: false, intervalMinutes: 5 }, 'write clamps and returns config');
  eq(await readConfig(profileContext), { enabled: false, intervalMinutes: 5 }, 'written config reads back');

  const initial = await readReminderState(profileContext);
  eq(initial, emptyState(profileDir), 'missing state reads as empty');
  const writtenState = normalizeState(
    { ...persisted, profileDir, pending: compactPending, lastCheckAt: '2026-10-19T00:03:22.000Z' },
    profileDir,
  );
  eq(await writeReminderState(profileContext, writtenState), writtenState, 'state write returns the state');
  const readBack = await readReminderState(profileContext);
  eq(readBack.pending, compactPending, 'state file round trip keeps pending');
  eq(readBack.lastCheckAt, '2026-10-19T00:03:22.000Z', 'state file round trip keeps lastCheckAt');
  eq(reminderPayload({ config: {}, state: readBack }).visible, true, 'round-tripped state still shows the reminder');

  const leftover = (await readdir(path.join(tmpHome, 'dsh-update-checker'))).filter((name) => name.endsWith('.tmp'));
  eq(leftover, [], 'atomic writes leave no temp files');

  // Write failures must surface instead of reporting success with an
  // unchanged file; the old code returned the new config from memory.
  const blocker = path.join(tmpHome, 'blocker');
  await writeFile(blocker, 'x', 'utf8');
  let configFailure = null;
  try {
    await writeConfig({ name: 'desktop', dir: profileDir, home: blocker }, { intervalMinutes: 30 });
  } catch (error) {
    configFailure = error;
  }
  eq(configFailure instanceof Error, true, 'config write failure is surfaced');

  // A failed atomic write must not leave its temp file behind either.
  const dirTarget = path.join(tmpHome, 'dsh-update-checker', 'as-directory.json');
  await mkdir(dirTarget, { recursive: true });
  eq(await writeJsonAtomic(dirTarget, { a: 1 }), false, 'atomic write reports rename failure');
  const failedLeftovers = (await readdir(path.join(tmpHome, 'dsh-update-checker'))).filter((name) => name.endsWith('.tmp'));
  eq(failedLeftovers, [], 'failed atomic write removes its temp file');
} finally {
  await rm(tmpHome, { recursive: true, force: true });
}

console.log(`${passed} assertions passed`);

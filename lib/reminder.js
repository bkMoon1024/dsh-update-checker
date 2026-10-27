/**
 * Background reminder state for dsh-update-checker.
 *
 * Two files under `<home>/dsh-update-checker`:
 *   config.json              schedule shared by every profile on this host
 *   reminder-<profile>.json  last scan snapshot + ignore bookkeeping
 *
 * Everything here is plain JSON/file logic so it can be tested without a
 * host, a clock, or a network.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_CONFIG = Object.freeze({ enabled: true, intervalMinutes: 60 });

/** Interval presets offered by the settings page, in minutes. */
export const INTERVAL_CHOICES = Object.freeze([30, 60, 120, 360]);

const MIN_INTERVAL = 5;
const MAX_INTERVAL = 24 * 60;

/** First background scan waits this long so activation never races boot. */
export const START_DELAY_MS = 30_000;
/** Failure retry backoff: base, cap, and the configured interval as ceiling. */
export const RETRY_BASE_MS = 5 * 60_000;
export const RETRY_CAP_MS = 60 * 60_000;

export function homeOf(profileContext) {
  return profileContext?.home ?? path.join(os.homedir(), '.dsh');
}

function profileSlug(profileContext) {
  const name = profileContext?.name ? String(profileContext.name) : 'default';
  return name.replace(/[^A-Za-z0-9._-]+/g, '_');
}

export function configPath(profileContext) {
  return path.join(homeOf(profileContext), 'dsh-update-checker', 'config.json');
}

export function statePath(profileContext) {
  return path.join(homeOf(profileContext), 'dsh-update-checker', `reminder-${profileSlug(profileContext)}.json`);
}

export function normalizeInterval(value) {
  // Only a real number or a numeric string is meaningful here. Passing null,
  // '', a boolean or an array through Number() produced 0/1 and clamped to
  // the 5-minute floor: a missing or malformed config silently turned into a
  // scan every 5 minutes (12x the default outbound budget).
  let numeric = NaN;
  if (typeof value === 'number') numeric = value;
  else if (typeof value === 'string' && value.trim() !== '') numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_CONFIG.intervalMinutes;
  return Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.round(numeric)));
}

export function normalizeConfig(raw) {
  return {
    enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : DEFAULT_CONFIG.enabled,
    intervalMinutes: normalizeInterval(raw?.intervalMinutes),
  };
}

export function emptyState(profileDir) {
  return {
    profileDir,
    lastCheckAt: null,
    lastError: null,
    pending: [],
    ignoredFingerprint: null,
    ignored: {},
  };
}

/**
 * Rows that carry actionable update information. `local-behind` joined
 * `update` in v0.4.0: file:/link: installs have no marketplace upgrade path,
 * so the sidebar badge was the one channel that never surfaced them — the
 * settings list showed "有更新" while the badge stayed silent.
 */
const ACTIONABLE_STATUSES = new Set(['update', 'local-behind']);

function isUpdateRow(row) {
  return row !== null
    && typeof row === 'object'
    && ACTIONABLE_STATUSES.has(row.status)
    && typeof row.name === 'string'
    && typeof row.latest === 'string'
    && row.latest.length > 0;
}

/**
 * Persisted pending rows are compact rows: `compactRow` wrote them without a
 * `status`, so the scan-row predicate above cannot read them back.
 */
function isPendingRow(row) {
  return row !== null
    && typeof row === 'object'
    && typeof row.name === 'string'
    && typeof row.latest === 'string'
    && row.latest.length > 0;
}

function compactRow(row) {
  return {
    name: row.name,
    installed: typeof row.installed === 'string' ? row.installed : '',
    latest: row.latest,
    kind: typeof row.kind === 'string' ? row.kind : '',
    spec: typeof row.spec === 'string' ? row.spec : '',
    repoUrl: typeof row.repoUrl === 'string' ? row.repoUrl : '',
    pageUrl: typeof row.pageUrl === 'string' ? row.pageUrl : '',
  };
}

/**
 * Notification identity of a pending set: sorted `name@latest` pairs. A new
 * upstream version anywhere changes it, which is exactly when a dismissed
 * reminder should come back.
 *
 * JSON-encoded rather than joined with '|': plugin names and upstream tags
 * come from package.json and git tags, so a name containing the separator
 * could collide with a different pending set and hide a reminder.
 */
export function fingerprintOf(rows) {
  // Keep name and version as separate elements: joining them with "@" and "|"
  // let two different plugin sets produce the same string (names may contain
  // both characters), which would hide a real reminder.
  const pairs = (rows ?? [])
    .filter((row) => row && typeof row.name === 'string')
    .map((row) => [row.name, String(row.latest ?? '')])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return JSON.stringify(pairs);
}

/**
 * Fingerprint shape written by older versions: `name@latest` joined with '|'.
 * Only used to keep an existing "ignore once" dismissal across the upgrade;
 * new writes always use the collision-free JSON shape.
 */
function legacyFingerprintOf(rows) {
  return (rows ?? [])
    .filter((row) => row && typeof row.name === 'string')
    .map((row) => `${row.name}@${String(row.latest ?? '')}`)
    .sort()
    .join('|');
}

/** Update rows a scan turned up, minus versions the user already ignored. */
export function pendingFromResult(result, ignored) {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  return rows
    .filter(isUpdateRow)
    .filter((row) => ignored?.[row.name] !== row.latest)
    .map(compactRow);
}

export function normalizeState(raw, profileDir) {
  if (!raw || typeof raw !== 'object' || raw.profileDir !== profileDir) return emptyState(profileDir);
  const ignored = {};
  if (raw.ignored && typeof raw.ignored === 'object') {
    for (const [name, version] of Object.entries(raw.ignored)) {
      if (typeof name === 'string' && typeof version === 'string') setIgnoredEntry(ignored, name, version);
    }
  }
  return {
    profileDir,
    lastCheckAt: typeof raw.lastCheckAt === 'string' ? raw.lastCheckAt : null,
    lastError: typeof raw.lastError === 'string' ? raw.lastError : null,
    pending: Array.isArray(raw.pending) ? raw.pending.filter(isPendingRow).map(compactRow) : [],
    ignoredFingerprint: typeof raw.ignoredFingerprint === 'string' ? raw.ignoredFingerprint : null,
    ignored,
  };
}

/**
 * Assign one ignore entry as an own data property. `ignored[name] = version`
 * on a dependency literally named "__proto__" writes to the prototype chain
 * instead of the map, so "ignore all" would silently keep reminding about it.
 */
function setIgnoredEntry(ignored, name, version) {
  Object.defineProperty(ignored, name, {
    value: version,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/**
 * Drop ignore entries for plugins the latest scan no longer reports (removed
 * or renamed dependencies). Without this the map only ever grows and a plugin
 * reinstalled later inherits a stale "ignored" version.
 */
export function pruneIgnored(ignored, rows) {
  const names = new Set((Array.isArray(rows) ? rows : []).map((row) => row?.name).filter((name) => typeof name === 'string'));
  const next = {};
  for (const [name, version] of Object.entries(ignored ?? {})) {
    if (names.has(name)) setIgnoredEntry(next, name, version);
  }
  return next;
}

/** Delay before the next scheduled scan, in milliseconds. */
export function nextDelayMs({ failures = 0, intervalMinutes = DEFAULT_CONFIG.intervalMinutes } = {}) {
  const intervalMs = normalizeInterval(intervalMinutes) * 60_000;
  if (!(failures > 0)) return intervalMs;
  return Math.min(intervalMs, RETRY_CAP_MS, RETRY_BASE_MS * 2 ** (failures - 1));
}

/**
 * Wire shape for `reminder.state`. `visible` is computed host-side so the
 * footer entry and the settings page cannot disagree about it.
 *
 * A dismissed reminder stays dismissed until the pending set changes: the
 * fingerprint covers `name@latest`, so one new upstream version anywhere
 * brings the entry back — including for versions the user ignored one by one.
 */
export function reminderPayload({ config, state, running = false }) {
  const normalizedConfig = normalizeConfig(config);
  const pending = state?.pending ?? [];
  const fingerprint = fingerprintOf(pending);
  const dismissed = state?.ignoredFingerprint;
  // Accept the legacy string shape too, otherwise an "ignore once" dismissal
  // stored by an older version reappears after the upgrade.
  const stillDismissed = dismissed != null
    && (fingerprint === dismissed || legacyFingerprintOf(pending) === dismissed);
  return {
    config: normalizedConfig,
    visible: pending.length > 0 && !stillDismissed,
    fingerprint,
    pending,
    profileDir: state?.profileDir ?? null,
    lastCheckAt: state?.lastCheckAt ?? null,
    lastError: state?.lastError ?? null,
    running,
  };
}

/** Dismiss the current pending set as a whole (the footer's "ignore once"). */
export function ignoreFingerprint(state) {
  return { ...state, ignoredFingerprint: fingerprintOf(state?.pending ?? []) };
}

/** Dismiss every pending plugin at its current upstream version. */
export function ignoreAllPending(state) {
  const ignored = { ...(state?.ignored ?? {}) };
  for (const row of state?.pending ?? []) setIgnoredEntry(ignored, row.name, row.latest);
  return { ...state, ignored, ignoredFingerprint: null, pending: [] };
}

export async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Collision-free temp suffix: overlapping writers must not rename each other's file. */
let tempCounter = 0;
function tempSuffix() {
  tempCounter += 1;
  return `${process.pid}.${Date.now().toString(36)}${tempCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function writeJsonAtomic(file, value) {
  const tmp = `${file}.${tempSuffix()}.tmp`;
  try {
    // 0700/0600: reminder state carries the plugin inventory and update list.
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await fs.writeFile(tmp, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tmp, file);
    await fs.chmod(file, 0o600).catch(() => {});
    return true;
  } catch {
    // A crash or failed rename must not leave a per-pid temp file behind.
    await fs.unlink(tmp).catch(() => {});
    return false;
  }
}

export async function readConfig(profileContext) {
  return normalizeConfig(await readJson(configPath(profileContext)));
}

export async function writeConfig(profileContext, config) {
  const normalized = normalizeConfig(config);
  // writeJsonAtomic only reports success. Returning the new config after a
  // failed write confirmed a setting the footer never actually saw ("保存成功"
  // followed by a scan at the old interval).
  if (!(await writeJsonAtomic(configPath(profileContext), normalized))) {
    throw new Error('failed to write the reminder config');
  }
  return normalized;
}

export async function readReminderState(profileContext) {
  const raw = await readJson(statePath(profileContext));
  return normalizeState(raw, profileContext?.dir);
}

export async function writeReminderState(profileContext, state) {
  if (!(await writeJsonAtomic(statePath(profileContext), state))) {
    throw new Error('failed to write the reminder state');
  }
  return state;
}

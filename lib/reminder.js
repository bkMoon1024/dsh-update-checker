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
  const numeric = typeof value === 'number' ? value : Number(value);
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
 */
export function fingerprintOf(rows) {
  return (rows ?? [])
    .map((row) => `${row.name}@${row.latest}`)
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
      if (typeof name === 'string' && typeof version === 'string') ignored[name] = version;
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
  return {
    config: normalizedConfig,
    visible: pending.length > 0 && fingerprint !== state?.ignoredFingerprint,
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
  for (const row of state?.pending ?? []) ignored[row.name] = row.latest;
  return { ...state, ignored, ignoredFingerprint: null, pending: [] };
}

export async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

export async function writeJsonAtomic(file, value) {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value), 'utf8');
    await fs.rename(tmp, file);
    return true;
  } catch {
    return false;
  }
}

export async function readConfig(profileContext) {
  return normalizeConfig(await readJson(configPath(profileContext)));
}

export async function writeConfig(profileContext, config) {
  const normalized = normalizeConfig(config);
  await writeJsonAtomic(configPath(profileContext), normalized);
  return normalized;
}

export async function readReminderState(profileContext) {
  const raw = await readJson(statePath(profileContext));
  return normalizeState(raw, profileContext?.dir);
}

export async function writeReminderState(profileContext, state) {
  await writeJsonAtomic(statePath(profileContext), state);
  return state;
}

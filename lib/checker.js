/**
 * Update-check core for dsh-update-checker.
 *
 * Reads the profile's package.json dependencies, classifies each third-party
 * install spec (npm range / github ref / file path), then asks the npm
 * registry and GitHub (with a jsDelivr tag fallback) what the latest upstream
 * is and which releases sit between the installed version and it. Check only:
 * nothing here installs, writes, or mutates the profile.
 *
 * All network access goes through lib/http.js (single-flight + TTL/ETag cache
 * + concurrency cap + host cooldown), shared across scans inside one host
 * process: a re-check minutes later revalidates cheaply (GitHub 304s are
 * quota-free) instead of re-spending the anonymous 60 req/h budget.
 *
 * npm rows take a dist-tags fast path (~200B) and only pull the abbreviated
 * packument when a version actually moved — the packument of an active
 * package is megabytes and used to dominate every scan.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHttpLayer, HttpError } from './http.js';

const NPM_REGISTRIES = ['https://registry.npmjs.org/', 'https://registry.npmmirror.com/'];
/**
 * Public npm content CDNs, asked only after every registry failed for a reason
 * other than "this package does not exist".
 *
 * Why: some corporate networks terminate TLS for chosen hosts and answer with
 * a certificate signed by a CA the Node runtime does not trust. Requests to
 * registry.npmjs.org then die with UNABLE_TO_VERIFY_LEAF_SIGNATURE while
 * api.github.com keeps working, so every npm plugin looks broken although
 * nothing about them changed. These CDNs serve a plain package.json from an
 * unrelated domain (usually outside the interception policy), which answers
 * the only question the dist-tags fast path asks: what is the latest version.
 */
const NPM_CDN_FALLBACKS = ['https://unpkg.com/', 'https://cdn.jsdelivr.net/npm/'];
/** npm package-name shape: optional @scope/ plus name. Refusing anything else
 *  keeps a hostile manifest key from steering the CDN path (`..` traversal, or
 *  a `?` that would turn the rest of the URL into a query). */
const NPM_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
/** After a transport failure, skip this CDN host for a while: an unreachable
 *  CDN is unreachable for every remaining row of the same scan. */
const CDN_COOLDOWN_MS = 60_000;
const GITHUB_API_HOST = 'api.github.com';
/** Per-request timeout: normal registry/CDN latency is <2s; 8s is 4x headroom
 *  while keeping a worst-case offline chain (npm fallback + GitHub→CDN) ≈40s. */
const FETCH_TIMEOUT_MS = 8000;
const MAX_RELEASES = 30;
/** Cap one release body so a pathological upstream changelog cannot blow up
 *  the RPC response or the settings page. ~64K chars ≈ largest real bodies. */
const MAX_RELEASE_BODY_CHARS = 16384;

/** Lazily-created process-wide layer; reused across scans and profiles. */
let sharedLayer = null;
function defaultLayer() {
  if (!sharedLayer) sharedLayer = createHttpLayer({ timeoutMs: FETCH_TIMEOUT_MS });
  return sharedLayer;
}

/**
 * Release the process-wide response cache. Called when the plugin fiber is
 * torn down: the cache would otherwise outlive the plugin for the rest of the
 * host process (hundreds of packuments, release notes included).
 */
export function disposeHttpCache() {
  sharedLayer?.dispose?.();
}

/**
 * Parse a version string into semver parts, or null when not semver-like.
 * Tolerant of real-world tags: a leading v/V, two-segment versions ("1.2" →
 * 1.2.0) and a fourth numeric segment ("1.2.3.4" → extra=4), both of which
 * GitHub tags use often enough that strict 3-segment parsing turned rows
 * into "unknown" and hid available updates.
 */
function parseSemver(version) {
  let text = String(version ?? '').trim();
  if (text.startsWith('v') || text.startsWith('V')) text = text.slice(1);
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
    extra: match[4] !== undefined ? Number(match[4]) : null,
    // Raw digit strings for comparison. Number() rounds at 2^53, so two
    // distinct 20-digit segments compared equal and "1.0.9007199254740993"
    // reported the same version as ...992 (and 1.0.01 as 1.0.1).
    raw: [match[1], match[2] ?? '0', match[3] ?? '0', match[4] ?? '0'],
    pre: match[5] ? match[5].split('.') : [],
  };
}

/** Compare non-negative integer strings exactly, without Number() rounding. */
function compareNumericStrings(a, b) {
  const x = a.replace(/^0+(?=\d)/, '');
  const y = b.replace(/^0+(?=\d)/, '');
  if (x.length !== y.length) return x.length < y.length ? -1 : 1;
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Semver comparison: -1 / 0 / 1, or null when either side is not semver. */
export function compareVersions(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 4; i += 1) {
    const comparison = compareNumericStrings(pa.raw[i], pb.raw[i]);
    if (comparison !== 0) return comparison;
  }
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
  if (pa.pre.length === 0) return 1;
  if (pb.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      // Semver numeric identifiers have no leading zeros, but tolerate them
      // here; compare as integers rather than losing precision through
      // Number().
      const comparison = compareNumericStrings(x, y);
      if (comparison !== 0) return comparison;
    } else if (xNum) return -1;
    else if (yNum) return 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Increment a decimal digit string exactly (Number() rounds above 2^53). */
function incrementDecimal(digits) {
  try { return (BigInt(digits) + 1n).toString(); } catch { return digits; }
}

/**
 * Minimal range parser for `#semver:<range>` GitHub refs. Supports the
 * single-comparator forms pnpm/npm write in manifests (exact, ^, ~, >=, >,
 * <=, <, =, wildcards). Compound ranges ("^1 || ^2") intentionally fall
 * through to the caller's conservative path.
 *
 * Components stay digit strings: parsing them through Number() reintroduced
 * the precision loss compareVersions exists to avoid, which broke self
 * satisfaction for large version numbers.
 */
function parseSemverRange(range) {
  const text = String(range ?? '').trim();
  if (text === '' || text === '*' || text === 'x' || text === 'X') return { op: 'any' };
  const match = /^(\^|~|>=|<=|>|<|=)?\s*v?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text);
  if (!match) return null;
  const segs = [match[2], match[3], match[4], match[5]].map((part) => (
    part === undefined || /[xX*]/.test(part) ? null : part
  ));
  // "1.x.3" and "1..3" are not range shapes "=1.2" is: let the caller fall
  // back instead of silently ignoring a component.
  if (segs[1] === null && (segs[2] !== null || segs[3] !== null)) return null;
  if (segs[2] === null && segs[3] !== null) return null;
  const op = match[1] ?? '=';
  return {
    op,
    segs,
    pre: op === '=' || op === '^' || op === '~' || op === '>=' || op === '>' || op === '<=' || op === '<'
      ? match[6] ?? ''
      : '',
    // Only the plain operator can express a prefix ("1.2.x"). npm treats a
    // missing minor/patch on "=" as a range, never as an exact version.
    wildcard: op === '=' && (segs[1] === null || segs[2] === null || segs[3] === null),
  };
}

/** Does `version` satisfy a single-comparator semver range? */
function rangeSatisfies(version, range) {
  const parsed = parseSemver(version);
  const spec = parseSemverRange(range);
  if (!parsed || !spec) return false;
  if (spec.op === 'any') return true;
  const [major, minor, patch, extra] = spec.segs;
  const base = [major, minor ?? '0', patch ?? '0', extra ?? '0']
    .slice(0, extra === null ? 3 : 4)
    .join('.') + (spec.pre ? `-${spec.pre}` : '');
  const cmp = (bound) => compareVersions(version, bound);
  if (spec.op === '=') {
    if (spec.wildcard) {
      if (compareNumericStrings(parsed.raw[0], major) !== 0) return false;
      if (minor !== null && compareNumericStrings(parsed.raw[1], minor) !== 0) return false;
      if (patch !== null && compareNumericStrings(parsed.raw[2], patch) !== 0) return false;
      return true;
    }
    return cmp(base) === 0;
  }
  if (spec.op === '>=') return cmp(base) >= 0;
  if (spec.op === '<') return cmp(base) < 0;
  if (spec.op === '>') {
    // npm compares the *next* release when the precision is lower:
    // >1.2 → >=1.3.0, >1 → >=2.0.0.
    if (minor === null) return cmp(`${incrementDecimal(major)}.0.0`) >= 0;
    if (patch === null) return cmp(`${major}.${incrementDecimal(minor)}.0`) >= 0;
    return cmp(base) > 0;
  }
  if (spec.op === '<=') {
    if (minor === null) return cmp(`${incrementDecimal(major)}.0.0`) < 0;
    if (patch === null) return cmp(`${major}.${incrementDecimal(minor)}.0`) < 0;
    return cmp(base) <= 0;
  }
  if (spec.op === '^') {
    if (cmp(base) < 0) return false;
    // npm caret semantics: ^0.2.3 → <0.3.0, ^0.0.3 → <0.0.4,
    // ^0.0 → <0.1.0, ^0 → <1.0.0.
    let upper;
    if (compareNumericStrings(major, '0') !== 0) upper = `${incrementDecimal(major)}.0.0`;
    else if (minor !== null && compareNumericStrings(minor, '0') !== 0) upper = `0.${incrementDecimal(minor)}.0`;
    else if (patch !== null) upper = `0.0.${incrementDecimal(patch)}`;
    else upper = minor === '0' ? '0.1.0' : '1.0.0';
    return cmp(upper) < 0;
  }
  if (spec.op === '~') {
    if (cmp(base) < 0) return false;
    const upper = minor === null ? `${incrementDecimal(major)}.0.0` : `${major}.${incrementDecimal(minor)}.0`;
    return cmp(upper) < 0;
  }
  return false;
}

/** Extract {owner, repo} from the usual repository.url spellings, or null. */
export function githubRepoFromUrl(url) {
  if (typeof url !== 'string') return null;
  let raw = url.trim();
  if (raw.length === 0) return null;
  // Strip fragment/query and trailing slashes first: repository URLs copied
  // from a browser ("https://github.com/o/r?tab=readme-ov-file") and npm's
  // own canonical git URLs ("git+ssh://git@github.com/o/r.git") used to fall
  // through every pattern, silently dropping release notes and file:/link:
  // upstream checks.
  raw = raw.split('#')[0].split('?')[0].replace(/\/+$/, '');
  const patterns = [
    /^git\+https:\/\/(?:[^@/\s]+@)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i,
    /^git\+ssh:\/\/(?:[^@/\s]+@)?github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i,
    /^(?:ssh|git):\/\/(?:[^@/\s]+@)?github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i,
    // Optional userinfo: npm records private-repo installs as
    // git+https://git@github.com/o/r and https://user:pass@github.com/o/r.
    /^https?:\/\/(?:[^@/\s]+@)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i,
    /^github:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i,
    /^(?:[^@/\s]+@)?github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(raw);
    if (match) return { owner: match[1], repo: match[2].replace(/\.git$/i, '') };
  }
  return null;
}

/**
 * Classify a dependency spec into where the package comes from.
 * @returns {{kind: 'npm'|'github'|'file'|'git'|'tarball'|'unknown'} & object}
 */
export function parseSpec(spec) {
  const text = String(spec ?? '').trim();
  let match;
  if ((match = /^github:([^/\s]+)\/([^#\s]+?)(?:\.git)?(?:#(.+))?$/.exec(text))) {
    return { kind: 'github', owner: match[1], repo: match[2], ref: match[3] };
  }
  // Any git-ish transport, github or not: normalise first, then classify.
  // Canonical git URLs (git+ssh://git@github.com/o/r.git, ssh://, git://,
  // git@github.com:o/r.git) used to be classified as plain 'git' and never
  // checked at all, so those rows sat at "unknown" forever.
  if ((match = /^(?:git\+ssh|git\+https|ssh|git):\/\/([^#\s]+)(?:#(.+))?$/.exec(text))) {
    const repo = githubRepoFromUrl(text.split('#')[0]);
    if (repo) return { kind: 'github', owner: repo.owner, repo: repo.repo, ref: match[2] };
  }
  if ((match = /^(?:[^@/\s]+@)?github\.com:([^/\s]+)\/([^#\s]+?)(?:\.git)?(?:#(.+))?$/.exec(text))) {
    return { kind: 'github', owner: match[1], repo: match[2], ref: match[3] };
  }
  if (/^git(\+|:)/.test(text)) return { kind: 'git', spec: text };
  if (/^https:\/\/([^/\s]+)\//.test(text) && githubRepoFromUrl(text.split('#')[0])) {
    const repo = githubRepoFromUrl(text.split('#')[0]);
    const ref = text.includes('#') ? text.split('#')[1] : undefined;
    return { kind: 'github', owner: repo.owner, repo: repo.repo, ref };
  }
  if (/^file:/.test(text)) return { kind: 'file', path: text.slice(5) };
  if (/^link:/i.test(text)) return { kind: 'file', path: text.slice(5) };
  if ((match = /^npm:(@[^@\s]+|[^@\s]+)@(.+)$/.exec(text))) {
    return { kind: 'npm', pkg: match[1], range: match[2] };
  }
  // Alias without a version ("alias": "npm:real-name") is valid and tracks
  // `latest`.
  if ((match = /^npm:(@[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*|[A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(text))) {
    return { kind: 'npm', pkg: match[1], range: 'latest' };
  }
  if (/^https?:\/\//.test(text)) return { kind: 'tarball', spec: text };
  // npm accepts a leading v/V on exact versions and ranges ("v1.2.3").
  if (/^(?:[\^~>=<*\s]|\d|[xX]|[vV]\d)/.test(text) || text === 'latest' || text === 'next') {
    return { kind: 'npm', pkg: null, range: text };
  }
  return { kind: 'unknown', spec: text };
}

// --- outbound helpers (all through the shared layer) -------------------------

/** CDN request URL for a package, or null when the name cannot be trusted. */
function cdnPackageUrl(base, name) {
  return NPM_NAME_PATTERN.test(name) ? `${base}${name}/package.json` : null;
}

/**
 * Ask each CDN in turn for the package's published package.json and read its
 * `version` — what a well-formed publish puts behind the `latest` dist-tag.
 * Returns a dist-tags-shaped object so callers need no special case; the extra
 * `source` field is for tests and debugging, not for the row.
 */
async function fetchLatestFromCdn(name, signal, http) {
  let lastError = new Error('no CDN tried');
  for (const base of NPM_CDN_FALLBACKS) {
    const url = cdnPackageUrl(base, name);
    if (!url || http.hostBlocked(url)) continue;
    try {
      const pkg = await http.getJson(url, { signal });
      if (typeof pkg?.version === 'string' && pkg.version.length > 0) {
        return { latest: pkg.version, source: new URL(base).host };
      }
      lastError = new Error('CDN package.json has no version');
    } catch (error) {
      lastError = error;
      // status 0 is the transport layer (DNS/TLS/timeout): that host is down
      // for every row, so stop paying its timeout over and over.
      if (error instanceof HttpError && error.status === 0) {
        http.blockHost(new URL(base).host, CDN_COOLDOWN_MS);
      }
    }
  }
  throw lastError;
}

/** Tiny authoritative "what is latest" doc (~200B) — the npm fast path. */
async function fetchDistTags(name, signal, http) {
  let lastError = new Error('no registry tried');
  let authoritativeMiss = false;
  for (const registry of NPM_REGISTRIES) {
    const url = `${registry}-/package/${encodeURIComponent(name)}/dist-tags`;
    if (http.hostBlocked(url)) continue;
    try {
      const tags = await http.getJson(url, { signal });
      if (tags && typeof tags === 'object' && typeof tags.latest === 'string') return tags;
      lastError = new Error('registry dist-tags malformed');
    } catch (error) {
      lastError = error;
      // A 404 means the package name does not exist on the public registry.
      // Do not ask the mirror about it: that disclosed private/renamed names
      // to a second host for no benefit. A CDN fallback would disclose the
      // same name to a third host, so it is skipped on the same answer.
      if (error instanceof HttpError && error.status === 404) {
        authoritativeMiss = true;
        break;
      }
    }
  }
  // Every registry failed without answering for the name — an environment
  // problem (TLS interception, DNS, outage), not a missing package.
  if (!authoritativeMiss) {
    try {
      return await fetchLatestFromCdn(name, signal, http);
    } catch {
      /* keep the registry error: it is the one that explains the row */
    }
  }
  throw lastError;
}

/** Ask each public registry in turn for the package's abbreviated packument. */
async function fetchPackument(name, signal, http) {
  let lastError = new Error('no registry tried');
  for (const registry of NPM_REGISTRIES) {
    try {
      // Abbreviated packument: keeps dist-tags and versions[].repository but
      // skips per-version metadata — billion-context drops from ~6.3MB to
      // ~2.2MB. Only fetched now when a version actually moved. Encode the
      // name like the dist-tags path does: a raw "foo?bar" or "foo#frag" key
      // used to shift the request path/query on the registry.
      return await http.getJson(registry + encodeURIComponent(name), {
        headers: { accept: 'application/vnd.npm.install-v1+json' },
        signal,
      });
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError && error.status === 404) break;
    }
  }
  throw lastError;
}

function capReleaseBody(text) {
  if (text.length <= MAX_RELEASE_BODY_CHARS) return text;
  return `${text.slice(0, MAX_RELEASE_BODY_CHARS)}\n… (${text.length} chars, truncated)`;
}

/** Cooldown after a GitHub 403/429: honor x-ratelimit-reset, clamped sane. */
function githubCooldownMs(error, now = Date.now()) {
  const reset = Number(error?.headers?.['x-ratelimit-reset']);
  if (Number.isFinite(reset) && reset > 0) {
    const ms = reset * 1000 - now;
    if (ms > 0) return Math.min(Math.max(ms + 1000, 30_000), 10 * 60_000);
  }
  return 60_000;
}

function githubHeaders() {
  const headers = { 'user-agent': 'dsh-update-checker', 'x-github-api-version': '2022-11-28' };
  // Optional token: anonymous GitHub API allows only 60 requests/hour/IP, and
  // a single scan of a profile with several GitHub-installed plugins can spend
  // a good part of that. Any token raises the limit without changing behavior.
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (typeof token === 'string' && token.trim().length > 0) headers.authorization = `Bearer ${token.trim()}`;
  return headers;
}

/**
 * GitHub releases, newest first. Falls back to the GitHub tags listing, then
 * to jsDelivr's tag listing, when the API is unreachable, has no releases, or
 * is rate-limited (403/429 blocks the API host for later rows, which skip it
 * entirely); fallbacks return tags only, without release notes.
 */
async function fetchGithubReleases(owner, repo, signal, http) {
  const headers = githubHeaders();
  let apiFailed = http.hostBlocked(`https://${GITHUB_API_HOST}/`);
  if (!apiFailed) {
    try {
      const releases = await http.getJson(
        `https://${GITHUB_API_HOST}/repos/${owner}/${repo}/releases?per_page=100`,
        { headers, signal },
      );
      if (Array.isArray(releases) && releases.length > 0) {
        return {
          source: 'github',
          entries: releases.map((release) => ({
            tag: release.tag_name ?? '',
            name: typeof release.name === 'string' && release.name.length > 0 ? release.name : release.tag_name,
            date: release.published_at ?? '',
            body: capReleaseBody(typeof release.body === 'string' ? release.body : ''),
            url: release.html_url ?? '',
            prerelease: release.prerelease === true,
          })),
        };
      }
    } catch (error) {
      // unreachable, 5xx, 403/429 rate limit: degrade to tag-based fallbacks
      apiFailed = true;
      if (error instanceof HttpError && (error.status === 403 || error.status === 429)) {
        http.blockHost(GITHUB_API_HOST, githubCooldownMs(error));
      }
    }
  }
  const tagEntry = (tag) => ({ tag: String(tag), name: String(tag), date: '', body: '', url: `https://github.com/${owner}/${repo}/releases/tag/${tag}`, prerelease: parseSemver(tag)?.pre.length > 0 });
  if (!apiFailed) {
    try {
      const tags = await http.getJson(`https://${GITHUB_API_HOST}/repos/${owner}/${repo}/tags?per_page=100`, { headers, signal });
      if (Array.isArray(tags) && tags.length > 0) {
        return { source: 'tags', entries: tags.map((tag) => tagEntry(tag.name)) };
      }
      if (Array.isArray(tags) && tags.length === 0) {
        // The tags API answered 200 with zero tags: jsDelivr mirrors the same
        // git tags and cannot know more — skip the extra round-trip (~3s per
        // tag-less repo on the fallback chain).
        return { source: 'tags', entries: [] };
      }
    } catch {
      /* fall through to jsdelivr */
    }
  }
  const tags = await http.getJson(
    `https://data.jsdelivr.com/v1/package/gh/${owner}/${repo}`,
    { headers: { 'user-agent': 'dsh-update-checker' }, signal },
  );
  const versions = Array.isArray(tags?.versions) ? tags.versions : [];
  return { source: 'jsdelivr', entries: versions.map(tagEntry) };
}

/**
 * Prerelease by flag OR by tag shape: authors forget to tick GitHub's
 * prerelease checkbox on -rc/-beta tags often enough that flag-only filtering
 * leaks them into "latest stable".
 */
function isPrereleaseEntry(entry) {
  if (entry.prerelease === true) return true;
  const parsed = parseSemver(entry.tag);
  return parsed !== null && parsed.pre.length > 0;
}

/** Pick the newest non-prerelease entry, falling back to the first entry. */
function latestStableEntry(entries) {
  if (entries.length === 0) return null;
  return entries.find((entry) => !isPrereleaseEntry(entry)) ?? entries[0];
}

/**
 * Version declared by the repo's default-branch package.json, for github
 * installs whose upstream never cut a tag or release.
 */
async function fetchBranchPackageVersion(owner, repo, signal, http) {
  try {
    if (http.hostBlocked(`https://${GITHUB_API_HOST}/`)) return null;
    const meta = await http.getJson(`https://${GITHUB_API_HOST}/repos/${owner}/${repo}`, { headers: githubHeaders(), signal });
    const branch = typeof meta?.default_branch === 'string' ? meta.default_branch : 'HEAD';
    const pkg = await http.getJson(`https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/package.json`, { signal });
    return typeof pkg?.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

/** Non-prerelease releases in (fromVersion, toVersion], oldest to newest, capped. */
function releasesBetween(entries, currentVersion, latestVersion) {
  const picked = [];
  for (const entry of entries) {
    if (isPrereleaseEntry(entry)) continue;
    const above = compareVersions(entry.tag, currentVersion);
    const upTo = compareVersions(entry.tag, latestVersion);
    if (above === null || upTo === null) continue;
    if (above > 0 && upTo <= 0) picked.push(entry);
  }
  picked.sort((a, b) => compareVersions(a.tag, b.tag));
  return picked.slice(-MAX_RELEASES);
}

/**
 * Releases newer than the installed ref, in GitHub's newest-first order,
 * stopping once the installed version is reached. Tags need not be semver, so
 * a non-semver pair falls back to exact tag equality; comparing versions
 * instead of strings also matches tags whose "v" prefix differs from the
 * installed ref (the common upstream `v1.2.3` vs manifest `1.2.3` case).
 */
function releasesAfterTag(entries, currentRef) {
  if (!currentRef) return entries.slice(0, MAX_RELEASES);
  const picked = [];
  for (const entry of entries) {
    const comparison = compareVersions(entry.tag, currentRef);
    if (comparison !== null ? comparison <= 0 : entry.tag === currentRef) break;
    picked.push(entry);
    if (picked.length >= MAX_RELEASES) break;
  }
  return picked;
}

async function readJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The profile manifest is required for a meaningful scan. A malformed or
 * unreadable one used to be indistinguishable from "this profile has no
 * dependencies": the scan resolved to zero rows, check.last persisted it with
 * a fresh lastCheckAt, and the reminder state cleared lastError — silently
 * hiding every plugin. Missing file still means "no dependencies" (a fresh
 * profile), which is legitimate.
 */
async function readRequiredJsonFile(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw new Error('cannot read the profile package.json');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('the profile package.json is not valid JSON');
  }
}

/**
 * Dependency keys are interpolated into node_modules/<name>/package.json.
 * Only npm-shaped names are read: a hand-edited manifest key like
 * "../../../../home/<user>/.ssh/id_rsa" would otherwise make the scanner read
 * (and partially expose) an arbitrary JSON file outside the profile.
 */
const DEPENDENCY_NAME_PATTERN = /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isValidDependencyName(name) {
  return typeof name === 'string'
    && name.length > 0
    && name.length <= 214
    && DEPENDENCY_NAME_PATTERN.test(name);
}

/**
 * The profile's declared exact version pin ("0.1.180", no range/operator):
 * what a fresh `pnpm install` puts on disk. node_modules can drift past the
 * pin when a package self-updates in place; comparing against the drift
 * hides available updates, so the declaration is authoritative when present.
 */
export function declaredExactPin(spec) {
  const text = String(spec ?? '').trim();
  // Only a full x.y.z (optionally 4-segment/tagged) pin is exact. A bare "1"
  // or "1.2" is a semver RANGE in npm (>=1.0.0 <2.0.0 / >=1.2.0 <1.3.0), so
  // treating it as the installed version compared the range floor against the
  // latest release and reported a permanent update for every such plugin.
  // npm also accepts a leading v/V on exact versions ("v1.2.3"); the pin is
  // the version itself, so return it normalized.
  const match = /^[vV]?(\d+\.\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/.exec(text);
  if (!match) return '';
  return match[1];
}

/** The profile's third-party dependencies with their installed manifests (parallel reads). */
async function collectPlugins(profileDir) {
  const manifest = await readRequiredJsonFile(join(profileDir, 'package.json'));
  const dependencies = manifest?.dependencies;
  if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) return [];
  const rows = await Promise.all(Object.entries(dependencies).map(async ([name, spec]) => {
    if (name.startsWith('@deepseek-ai/')) return null;
    // Never let a manifest key escape node_modules.
    if (!isValidDependencyName(name)) return null;
    const installed = await readJsonFile(join(profileDir, 'node_modules', name, 'package.json'));
    const pin = declaredExactPin(spec);
    return {
      name,
      spec: String(spec),
      installedVersion: pin || (typeof installed?.version === 'string' ? installed.version : ''),
      description: typeof installed?.description === 'string' ? installed.description : '',
      homepage: typeof installed?.homepage === 'string' ? installed.homepage : '',
      repositoryUrl: typeof installed?.repository === 'string'
        ? installed.repository
        : installed?.repository?.url ?? '',
    };
  }));
  return rows.filter((row) => row !== null);
}

function npmPageUrl(name) {
  return `https://www.npmjs.com/package/${name}`;
}

/** Release notes for an npm row that has updates, best-effort. */
async function npmReleaseNotes(plugin, row, signal, http) {
  const repo = githubRepoFromUrl(row.repoUrl);
  if (!repo) return;
  try {
    const { entries, source } = await fetchGithubReleases(repo.owner, repo.repo, signal, http);
    row.releases = releasesBetween(entries, plugin.installedVersion, row.latest);
    row.releasesSource = source;
    if (row.releases.length === 0 && source === 'jsdelivr') {
      // jsDelivr entries are plain tags: re-filter including prereleases
      // (their order is still newest-first by git tag).
      row.releases = entries.filter((entry) => {
        const above = compareVersions(entry.tag, plugin.installedVersion);
        const upTo = compareVersions(entry.tag, row.latest);
        return above !== null && upTo !== null && above > 0 && upTo <= 0;
      }).slice(-MAX_RELEASES);
    }
  } catch {
    /* release notes are best-effort; the version comparison stands */
  }
}

async function checkNpmPlugin(plugin, signal, http) {
  const packageName = plugin.specInfo.pkg ?? plugin.name;

  // Fast path: dist-tags (~200B) settles "already latest" for the common
  // case with one tiny request and zero packument megabytes.
  let latest = null;
  try {
    latest = (await fetchDistTags(packageName, signal, http))?.latest ?? null;
  } catch { /* fall through to the packument path */ }
  if (latest) {
    const comparison = compareVersions(plugin.installedVersion, latest);
    if (comparison !== null && comparison >= 0) {
      return {
        kind: 'npm',
        packageName,
        latest,
        latestDate: '',
        repoUrl: plugin.repositoryUrl || '',
        pageUrl: npmPageUrl(packageName),
        releases: [],
        releasesSource: '',
        status: 'latest',
      };
    }
  }

  // Moved (or unknown) — abbreviated packument for the authoritative latest
  // and the upstream repository URL for release notes.
  let packument = null;
  let packumentError = null;
  try {
    packument = await fetchPackument(packageName, signal, http);
  } catch (error) {
    packumentError = error;
  }
  const authoritative = packument?.['dist-tags']?.latest;
  if (!latest && !authoritative) {
    throw packumentError ?? new Error('registry lists no latest version');
  }
  const effectiveLatest = authoritative ?? latest;
  const versionInfo = packument?.versions?.[effectiveLatest] ?? {};
  const repoUrl = typeof versionInfo.repository === 'string'
    ? versionInfo.repository
    : versionInfo.repository?.url ?? plugin.repositoryUrl;
  const row = {
    kind: 'npm',
    packageName,
    latest: effectiveLatest,
    latestDate: '',
    repoUrl: repoUrl || '',
    pageUrl: npmPageUrl(packageName),
    releases: [],
    releasesSource: '',
  };
  const comparison = compareVersions(plugin.installedVersion, effectiveLatest);
  if (comparison === null) {
    row.status = plugin.installedVersion === effectiveLatest ? 'latest' : 'unknown';
  } else {
    row.status = comparison < 0 ? 'update' : 'latest';
  }
  if (row.status === 'update') {
    await npmReleaseNotes(plugin, row, signal, http);
  }
  return row;
}

async function checkGithubPlugin(plugin, signal, http) {
  const { owner, repo, ref } = plugin.specInfo;
  const { entries, source } = await fetchGithubReleases(owner, repo, signal, http);
  const latestEntry = latestStableEntry(entries);
  const row = {
    kind: 'github',
    repoUrl: `https://github.com/${owner}/${repo}`,
    pageUrl: `https://github.com/${owner}/${repo}/releases`,
    releasesSource: source,
    releases: [],
    latest: latestEntry?.tag ?? '',
    latestDate: latestEntry?.date ?? '',
  };
  if (!latestEntry) {
    const branchVersion = await fetchBranchPackageVersion(owner, repo, signal, http);
    if (branchVersion) {
      row.latest = branchVersion;
      const comparison = compareVersions(plugin.installedVersion, branchVersion);
      row.status = comparison === null
        ? (plugin.installedVersion === branchVersion ? 'latest' : 'unknown')
        : comparison < 0 ? 'update' : 'latest';
    } else {
      // no releases and no readable branch package.json — nothing comparable
      row.status = 'unknown';
    }
    return row;
  }
  if (!ref || parseSemver(ref) === null) {
    // `#semver:^1.2.0` pins the install to a version RANGE: comparing it with
    // the newest tag recommended a breaking major for a range the user
    // deliberately capped. Resolve the range against the available releases
    // and compare with the highest satisfying tag instead.
    const semverRange = typeof ref === 'string' && ref.startsWith('semver:') ? ref.slice(7).trim() : '';
    if (semverRange !== '') {
      const candidates = entries.filter((entry) => (
        !isPrereleaseEntry(entry) && rangeSatisfies(entry.tag, semverRange)
      ));
      const target = candidates.reduce((best, entry) => (
        !best || compareVersions(entry.tag, best.tag) > 0 ? entry : best
      ), null);
      if (target) {
        row.latest = target.tag;
        row.latestDate = target.date ?? '';
        const inRange = compareVersions(plugin.installedVersion, target.tag);
        if (inRange === null) {
          row.status = plugin.installedVersion === target.tag ? 'latest' : 'unknown';
        } else if (inRange < 0) {
          row.status = 'update';
          row.releases = releasesBetween(entries, plugin.installedVersion, target.tag);
        } else {
          row.status = 'latest';
        }
        return row;
      }
      // A `semver:` ref we cannot resolve to a stable tag must not fall back
      // to the newest tag: that is exactly the breaking-major nudge this path
      // exists to prevent (upstream dropped the range, or it is a compound
      // shape the parser does not support). Report "unknown" instead.
      row.status = 'unknown';
      return row;
    }
    // No pinned version, or a branch/commit ref that cannot be ordered against
    // tags: the ref is unorderable, but the installed version still is. Compare
    // it with the newest tag so an outdated install surfaces as an update;
    // only an unorderable installed version keeps reporting branch tracking,
    // which stays out of the attention filter.
    const installedComparison = compareVersions(plugin.installedVersion, latestEntry.tag);
    if (installedComparison === null) {
      row.status = 'branch';
      row.releases = [latestEntry];
    } else if (installedComparison < 0) {
      row.status = 'update';
      row.releases = releasesAfterTag(entries, plugin.installedVersion);
    } else {
      row.status = 'latest';
    }
    return row;
  }
  const comparison = compareVersions(ref, latestEntry.tag);
  if (comparison === null) {
    row.status = ref === latestEntry.tag ? 'latest' : 'unknown';
    row.releases = releasesAfterTag(entries, ref);
  } else if (comparison < 0) {
    row.status = 'update';
    row.releases = releasesAfterTag(entries, ref);
  } else {
    row.status = 'latest';
  }
  return row;
}

async function checkFilePlugin(plugin, signal, http) {
  const row = {
    kind: 'file',
    repoUrl: '',
    pageUrl: '',
    releases: [],
    releasesSource: '',
    latest: '',
    latestDate: '',
    status: 'local',
  };
  const repo = githubRepoFromUrl(plugin.repositoryUrl);
  if (!repo) return row;
  row.repoUrl = `https://github.com/${repo.owner}/${repo.repo}`;
  row.pageUrl = `${row.repoUrl}/releases`;
  try {
    const { entries, source } = await fetchGithubReleases(repo.owner, repo.repo, signal, http);
    const latestEntry = latestStableEntry(entries);
    if (!latestEntry) {
      const branchVersion = await fetchBranchPackageVersion(repo.owner, repo.repo, signal, http);
      if (branchVersion) {
        row.latest = branchVersion;
        const comparison = compareVersions(plugin.installedVersion, branchVersion);
        row.status = comparison === null
          ? (plugin.installedVersion === branchVersion ? 'local-latest' : 'local')
          : comparison < 0 ? 'local-behind' : comparison > 0 ? 'local-ahead' : 'local-latest';
      }
      return row;
    }
    row.latest = latestEntry.tag;
    row.latestDate = latestEntry.date;
    row.releasesSource = source;
    const comparison = compareVersions(plugin.installedVersion, latestEntry.tag);
    if (comparison === null) {
      row.status = 'local';
    } else if (comparison < 0) {
      row.status = 'local-behind';
      row.releases = releasesAfterTag(entries, plugin.installedVersion);
      if (row.releases.length === 0) row.releases = [latestEntry];
    } else if (comparison > 0) {
      // The local build is newer than the newest upstream tag: nothing to
      // update to, but it does not "match upstream" either.
      row.status = 'local-ahead';
    } else {
      row.status = 'local-latest';
    }
  } catch {
    /* local install: upstream info stays blank when unreachable */
  }
  return row;
}

/** Check one dependency, always resolving to a displayable row. */
async function checkOne(plugin, signal, http) {
  const row = {
    name: plugin.name,
    spec: plugin.spec,
    installed: plugin.installedVersion,
    description: plugin.description,
    homepage: plugin.homepage,
  };
  try {
    plugin.specInfo = parseSpec(plugin.spec);
    const { kind } = plugin.specInfo;
    let checked;
    if (kind === 'npm') checked = await checkNpmPlugin(plugin, signal, http);
    else if (kind === 'github') checked = await checkGithubPlugin(plugin, signal, http);
    else if (kind === 'file') checked = await checkFilePlugin(plugin, signal, http);
    else if (kind === 'git') checked = { kind, status: 'unknown', latest: '', releases: [], repoUrl: '', pageUrl: '', releasesSource: '', latestDate: '' };
    else checked = { kind: kind === 'tarball' ? 'tarball' : 'unknown', status: 'unknown', latest: '', releases: [], repoUrl: '', pageUrl: '', releasesSource: '', latestDate: '' };
    Object.assign(row, checked);
  } catch (error) {
    row.kind = row.kind ?? 'unknown';
    row.status = 'error';
    row.latest = row.latest ?? '';
    row.releases = row.releases ?? [];
    row.repoUrl = row.repoUrl ?? '';
    row.pageUrl = row.pageUrl ?? '';
    row.releasesSource = row.releasesSource ?? '';
    row.latestDate = row.latestDate ?? '';
    row.error = error instanceof Error ? error.message : String(error);
  }
  return row;
}

const STATUS_ORDER = { update: 0, 'local-behind': 1, error: 2, unknown: 3, latest: 4, 'local-latest': 4, 'local-ahead': 4, branch: 5, local: 6 };

function statsDelta(before, after) {
  const delta = {};
  for (const key of Object.keys(after)) delta[key] = after[key] - (before[key] ?? 0);
  return delta;
}

/**
 * Run the full check across every third-party profile dependency.
 * @param {string} profileDir
 * @param {AbortSignal} [signal] caller abort (the shared in-flight run in
 *   index.js intentionally passes none)
 * @param {ReturnType<typeof createHttpLayer>} [http] injectable layer for tests
 */
export async function runCheck(profileDir, signal, http = defaultLayer()) {
  const statsBefore = { ...http.stats };
  const plugins = await collectPlugins(profileDir);
  const rows = await Promise.all(plugins.map((plugin) => checkOne(plugin, signal, http)));
  rows.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.name.localeCompare(b.name));
  const counts = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return {
    at: new Date().toISOString(),
    profileDir,
    counts,
    rows,
    stats: statsDelta(statsBefore, http.stats),
  };
}

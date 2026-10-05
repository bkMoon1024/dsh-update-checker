/**
 * Update-check core for dsh-update-checker.
 *
 * Reads the profile's package.json dependencies, classifies each third-party
 * install spec (npm range / github ref / file path), then asks the npm
 * registry and GitHub (with a jsDelivr tag fallback) what the latest upstream
 * is and which releases sit between the installed version and it. Check only:
 * nothing here installs, writes, or mutates the profile.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const NPM_REGISTRIES = ['https://registry.npmjs.org/', 'https://registry.npmmirror.com/'];
/** Per-request timeout: normal registry/CDN latency is <2s; 8s is 4x headroom
 *  while keeping a worst-case offline chain (npm fallback + GitHub→CDN) ≈40s. */
const FETCH_TIMEOUT_MS = 8000;
const MAX_RELEASES = 30;
/** Cap one release body so a pathological upstream changelog cannot blow up
 *  the RPC response or the settings page. ~64K chars ≈ largest real bodies. */
const MAX_RELEASE_BODY_CHARS = 16384;

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
    pre: match[5] ? match[5].split('.') : [],
  };
}

/** Semver comparison: -1 / 0 / 1, or null when either side is not semver. */
export function compareVersions(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  for (const key of ['major', 'minor', 'patch']) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }
  const extraA = pa.extra ?? 0;
  const extraB = pb.extra ?? 0;
  if (extraA !== extraB) return extraA < extraB ? -1 : 1;
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
      const diff = Number(x) - Number(y);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    } else if (xNum) return -1;
    else if (yNum) return 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Extract {owner, repo} from the usual repository.url spellings, or null. */
export function githubRepoFromUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return null;
  const raw = url.split('#')[0];
  const patterns = [
    /^git\+https:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?$/i,
    /^git\+ssh:\/\/git@github\.com:([^/\s]+)\/([^/\s#?]+?)(?:\.git)?$/i,
    /^https:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?$/i,
    /^github:([^/\s]+)\/([^/\s#?]+?)(?:\.git)?$/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(raw);
    if (match) return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
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
  if ((match = /^git\+https:\/\/([^/\s]+)\/([^#\s]+)(?:#(.+))?$/.exec(text))) {
    const repo = githubRepoFromUrl(`https://${match[1]}/${match[2]}`);
    if (repo) return { kind: 'github', owner: repo.owner, repo: repo.repo, ref: match[3] };
    return { kind: 'git', spec: text };
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
  if (/^https?:\/\//.test(text)) return { kind: 'tarball', spec: text };
  if (/^(?:[\^~>=<*\s]|\d|x)/.test(text) || text === 'latest' || text === 'next') {
    return { kind: 'npm', pkg: null, range: text };
  }
  return { kind: 'unknown', spec: text };
}

function withTimeout(signal, ms) {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  try {
    return AbortSignal.any([signal, timeout]);
  } catch {
    return timeout;
  }
}

async function fetchJson(url, headers, signal) {
  const response = await fetch(url, {
    signal: withTimeout(signal, FETCH_TIMEOUT_MS),
    headers: { accept: 'application/json', ...headers },
  });
  if (!response.ok) {
    const error = new Error(`${response.status} ${response.statusText || ''}`.trim());
    error.status = response.status;
    throw error;
  }
  return response.json();
}

/** Ask each public registry in turn for the package's packument. */
async function fetchPackument(name, signal) {
  let lastError = new Error('no registry tried');
  for (const registry of NPM_REGISTRIES) {
    try {
      // Abbreviated packument: keeps dist-tags and versions[].repository but
      // skips per-version metadata — billion-context drops from ~6.3MB to
      // ~2.2MB. Top-level `time` is absent, so latestDate becomes '' (the
      // settings page does not display it).
      return await fetchJson(registry + name, { accept: 'application/vnd.npm.install-v1+json' }, signal);
    } catch (error) {
      lastError = error;
      if (error?.status === 404) break;
    }
  }
  throw lastError;
}

function capReleaseBody(text) {
  if (text.length <= MAX_RELEASE_BODY_CHARS) return text;
  return `${text.slice(0, MAX_RELEASE_BODY_CHARS)}\n… (${text.length} chars, truncated)`;
}

/**
 * GitHub releases, newest first. Falls back to the GitHub tags listing, then
 * to jsDelivr's tag listing, when the API is unreachable, has no releases, or
 * is rate-limited (the tags API shares the rate limit, so 403/429 skips it);
 * fallbacks return tags only, without release notes.
 */
async function fetchGithubReleases(owner, repo, signal) {
  const headers = { 'user-agent': 'dsh-update-checker', 'x-github-api-version': '2022-11-28' };
  let apiFailed = false;
  try {
    const releases = await fetchJson(
      `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100`,
      headers,
      signal,
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
  } catch {
    // unreachable, 5xx, 403/429 rate limit: degrade to tag-based fallbacks
    apiFailed = true;
  }
  const tagEntry = (tag) => ({ tag: String(tag), name: String(tag), date: '', body: '', url: `https://github.com/${owner}/${repo}/releases/tag/${tag}`, prerelease: parseSemver(tag)?.pre.length > 0 });
  if (!apiFailed) {
    try {
      const tags = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/tags?per_page=100`, headers, signal);
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
      /* fall through to jsDelivr */
    }
  }
  const tags = await fetchJson(
    `https://data.jsdelivr.com/v1/package/gh/${owner}/${repo}`,
    { 'user-agent': 'dsh-update-checker' },
    signal,
  );
  const versions = Array.isArray(tags?.versions) ? tags.versions : [];
  return { source: 'jsdelivr', entries: versions.map(tagEntry) };
}

/** Pick the newest non-prerelease entry, falling back to the first entry. */
function latestStableEntry(entries) {
  if (entries.length === 0) return null;
  return entries.find((entry) => !entry.prerelease) ?? entries[0];
}

/**
 * Version declared by the repo's default-branch package.json, for github
 * installs whose upstream never cut a tag or release.
 */
async function fetchBranchPackageVersion(owner, repo, signal) {
  const headers = { 'user-agent': 'dsh-update-checker', 'x-github-api-version': '2022-11-28' };
  try {
    const meta = await fetchJson(`https://api.github.com/repos/${owner}/${repo}`, headers, signal);
    const branch = typeof meta?.default_branch === 'string' ? meta.default_branch : 'HEAD';
    const pkg = await fetchJson(`https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/package.json`, {}, signal);
    return typeof pkg?.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

/**
 * Releases covering (currentVersion, latestVersion], oldest to newest, capped.
 * Entries whose tag is not semver are skipped, since their order is unknown.
 */
function releasesBetween(entries, currentVersion, latestVersion) {
  const picked = [];
  for (const entry of entries) {
    if (entry.prerelease) continue;
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
 * stopping at the current tag. Used for github: installs where the ref is a
 * tag; tags need not be semver.
 */
function releasesAfterTag(entries, currentRef) {
  const picked = [];
  for (const entry of entries) {
    if (currentRef && entry.tag === currentRef) break;
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
 * The profile's declared exact version pin ("0.1.180", no range/operator):
 * what a fresh `pnpm install` puts on disk. node_modules can drift past the
 * pin when a package self-updates in place; comparing against the drift
 * hides available updates, so the declaration is authoritative when present.
 */
export function declaredExactPin(spec) {
  const text = String(spec ?? '').trim();
  if (!/^\d+(?:\.\d+){0,3}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(text)) return '';
  return text;
}

/** The profile's third-party dependencies with their installed manifests. */
async function collectPlugins(profileDir) {
  const manifest = await readJsonFile(join(profileDir, 'package.json'));
  const dependencies = manifest?.dependencies;
  if (!dependencies || typeof dependencies !== 'object') return [];
  const rows = [];
  for (const [name, spec] of Object.entries(dependencies)) {
    if (name.startsWith('@deepseek-ai/')) continue;
    const installed = await readJsonFile(join(profileDir, 'node_modules', name, 'package.json'));
    const pin = declaredExactPin(spec);
    rows.push({
      name,
      spec: String(spec),
      installedVersion: pin || (typeof installed?.version === 'string' ? installed.version : ''),
      description: typeof installed?.description === 'string' ? installed.description : '',
      homepage: typeof installed?.homepage === 'string' ? installed.homepage : '',
      repositoryUrl: typeof installed?.repository === 'string'
        ? installed.repository
        : installed?.repository?.url ?? '',
    });
  }
  return rows;
}

function npmPageUrl(name) {
  return `https://www.npmjs.com/package/${name}`;
}

async function checkNpmPlugin(plugin, signal) {
  const packageName = plugin.specInfo.pkg ?? plugin.name;
  const packument = await fetchPackument(packageName, signal);
  const latest = packument?.['dist-tags']?.latest ?? null;
  if (!latest) throw new Error('registry lists no latest version');
  const versionInfo = packument?.versions?.[latest] ?? {};
  const repoUrl = typeof versionInfo.repository === 'string'
    ? versionInfo.repository
    : versionInfo.repository?.url ?? plugin.repositoryUrl;
  const row = {
    kind: 'npm',
    packageName,
    latest,
    latestDate: packument?.time?.[latest] ?? '',
    repoUrl: repoUrl || '',
    pageUrl: npmPageUrl(packageName),
    releases: [],
    releasesSource: '',
  };
  const comparison = compareVersions(plugin.installedVersion, latest);
  if (comparison === null) {
    row.status = plugin.installedVersion === latest ? 'latest' : 'unknown';
  } else {
    row.status = comparison < 0 ? 'update' : 'latest';
  }
  if (row.status === 'update') {
    const repo = githubRepoFromUrl(row.repoUrl);
    if (repo) {
      try {
        const { entries, source } = await fetchGithubReleases(repo.owner, repo.repo, signal);
        row.releases = releasesBetween(entries, plugin.installedVersion, latest);
        row.releasesSource = source;
        if (row.releases.length === 0 && source === 'jsdelivr') {
          row.releases = entries.filter((entry) => {
            const above = compareVersions(entry.tag, plugin.installedVersion);
            const upTo = compareVersions(entry.tag, latest);
            return above !== null && upTo !== null && above > 0 && upTo <= 0;
          }).slice(-MAX_RELEASES);
        }
      } catch {
        /* release notes are best-effort; the version comparison stands */
      }
    }
  }
  return row;
}

async function checkGithubPlugin(plugin, signal) {
  const { owner, repo, ref } = plugin.specInfo;
  const { entries, source } = await fetchGithubReleases(owner, repo, signal);
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
    const branchVersion = await fetchBranchPackageVersion(owner, repo, signal);
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
  if (!ref) {
    row.status = 'branch';
    row.releases = [latestEntry];
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

async function checkFilePlugin(plugin, signal) {
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
    const { entries, source } = await fetchGithubReleases(repo.owner, repo.repo, signal);
    const latestEntry = latestStableEntry(entries);
    if (!latestEntry) {
      const branchVersion = await fetchBranchPackageVersion(repo.owner, repo.repo, signal);
      if (branchVersion) {
        row.latest = branchVersion;
        const comparison = compareVersions(plugin.installedVersion, branchVersion);
        row.status = comparison === null
          ? (plugin.installedVersion === branchVersion ? 'local-latest' : 'local')
          : comparison < 0 ? 'local-behind' : 'local-latest';
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
      row.releases = releasesAfterTag(entries, `v${plugin.installedVersion}`);
      if (row.releases.length === 0) row.releases = [latestEntry];
    } else {
      // equal to, or AHEAD of, the newest upstream tag: nothing to update to
      row.status = 'local-latest';
    }
  } catch {
    /* local install: upstream info stays blank when unreachable */
  }
  return row;
}

/** Check one dependency, always resolving to a displayable row. */
async function checkOne(plugin, signal) {
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
    if (kind === 'npm') checked = await checkNpmPlugin(plugin, signal);
    else if (kind === 'github') checked = await checkGithubPlugin(plugin, signal);
    else if (kind === 'file') checked = await checkFilePlugin(plugin, signal);
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

const STATUS_ORDER = { update: 0, 'local-behind': 1, error: 2, branch: 3, unknown: 4, local: 5, 'local-latest': 6, latest: 7 };

/** Run the full check across every third-party profile dependency. */
export async function runCheck(profileDir, signal) {
  const plugins = await collectPlugins(profileDir);
  const rows = await Promise.all(plugins.map((plugin) => checkOne(plugin, signal)));
  rows.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.name.localeCompare(b.name));
  const counts = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return {
    at: new Date().toISOString(),
    profileDir,
    counts,
    rows,
  };
}

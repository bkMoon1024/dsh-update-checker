// Integration test for lib/checker.js runCheck(): a temp profile directory
// plus a scripted fetch layer (real createHttpLayer, fake network). Verifies
// the dist-tags fast path, packument fallback, release-note collection,
// skip rules, sort order, per-run stats and the cross-run response cache.
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHttpLayer } from '../lib/http.js';
import { runCheck } from '../lib/checker.js';

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

// --- scripted network ---------------------------------------------------------
const hits = new Map();
const routes = new Map([
  // current-pkg: dist-tags says latest → fast path, done (never a packument)
  ['https://registry.npmjs.org/-/package/current-pkg/dist-tags', () => jsonResponse({ latest: '1.0.0' })],
  // outdated-pkg: dist-tags → 1.1.0, packument carries the repo, releases v1.0.0+v1.1.0
  ['https://registry.npmjs.org/-/package/outdated-pkg/dist-tags', () => jsonResponse({ latest: '1.1.0' })],
  ['https://registry.npmjs.org/outdated-pkg', () => jsonResponse({
    'dist-tags': { latest: '1.1.0' },
    versions: { '1.1.0': { repository: { url: 'git+https://github.com/me/outdated.git' } } },
  }, { etag: 'W/"outdated-pkg"' })],
  ['https://api.github.com/repos/me/outdated/releases?per_page=100', () => jsonResponse([
    { tag_name: 'v1.1.0', name: 'v1.1.0', published_at: '2026-10-05T00:00:00Z', body: 'fixes', html_url: 'https://github.com/me/outdated/releases/v1.1.0', prerelease: false },
    { tag_name: 'v1.1.0-rc.1', name: 'rc', published_at: '2026-10-04T00:00:00Z', body: 'rc', html_url: '', prerelease: false },
    { tag_name: 'v1.0.0', name: 'v1.0.0', published_at: '2026-09-01T00:00:00Z', body: 'initial', html_url: '', prerelease: false },
  ], { etag: 'W/"outdated-rel"' })],
  // gh-plugin: github ref v1.0.0, newest release v1.2.0 (with a prerelease on top)
  ['https://api.github.com/repos/me/ghrepo/releases?per_page=100', () => jsonResponse([
    { tag_name: 'v1.3.0-beta.1', name: 'beta', published_at: '2026-10-04T00:00:00Z', body: 'beta', html_url: '', prerelease: true },
    { tag_name: 'v1.2.0', name: 'v1.2.0', published_at: '2026-10-01T00:00:00Z', body: 'big one', html_url: '', prerelease: false },
    { tag_name: 'v1.0.0', name: 'v1.0.0', published_at: '2026-06-01T00:00:00Z', body: 'base', html_url: '', prerelease: false },
  ], { etag: 'W/"gh-rel"' })],
  // local-plugin: file install whose manifest points at a repo, upstream v2.0.0
  ['https://api.github.com/repos/me/localrepo/releases?per_page=100', () => jsonResponse([
    { tag_name: 'v2.0.0', name: 'v2.0.0', published_at: '2026-09-20T00:00:00Z', body: 'two', html_url: '', prerelease: false },
    { tag_name: 'v1.5.0', name: 'v1.5.0', published_at: '2026-01-01T00:00:00Z', body: '', html_url: '', prerelease: false },
  ])],
  // ahead-plugin: local build (2.5.0) is newer than upstream v2.0.0
  ['https://api.github.com/repos/me/aheadrepo/releases?per_page=100', () => jsonResponse([
    { tag_name: 'v2.0.0', name: 'v2.0.0', published_at: '2026-09-20T00:00:00Z', body: 'two', html_url: '', prerelease: false },
    { tag_name: 'v1.0.0', name: 'v1.0.0', published_at: '2026-01-01T00:00:00Z', body: '', html_url: '', prerelease: false },
  ])],
  // equal-plugin: local build is exactly upstream v2.0.0
  ['https://api.github.com/repos/me/equalrepo/releases?per_page=100', () => jsonResponse([
    { tag_name: 'v2.0.0', name: 'v2.0.0', published_at: '2026-09-20T00:00:00Z', body: 'two', html_url: '', prerelease: false },
  ])],
  // nov-prefix-plugin: upstream tags have no "v" prefix; notes must stop at 2.0.0
  ['https://api.github.com/repos/me/novrepo/releases?per_page=100', () => jsonResponse([
    { tag_name: '2.0.0', name: '2.0.0', published_at: '2026-09-20T00:00:00Z', body: 'two', html_url: '', prerelease: false },
    { tag_name: '0.5.0', name: '0.5.0', published_at: '2026-01-01T00:00:00Z', body: '', html_url: '', prerelease: false },
  ])],
  // gh-branch: github spec tracks a branch (#main), not a tag
  ['https://api.github.com/repos/me/ghbranch/releases?per_page=100', () => jsonResponse([
    { tag_name: 'v1.0.0', name: 'v1.0.0', published_at: '2026-09-20T00:00:00Z', body: 'one', html_url: '', prerelease: false },
  ])],
  // gh-noref: github install without a ref, installed version behind the newest tag
  ['https://api.github.com/repos/me/ghnoref/releases?per_page=100', () => jsonResponse([
    { tag_name: 'v1.2.0', name: 'v1.2.0', published_at: '2026-10-10T00:00:00Z', body: 'two', html_url: '', prerelease: false },
    { tag_name: 'v1.1.0', name: 'v1.1.0', published_at: '2026-09-10T00:00:00Z', body: 'one', html_url: '', prerelease: false },
  ])],
  // gh-noref-current: github install without a ref that already matches the newest tag
  ['https://api.github.com/repos/me/ghcurrent/releases?per_page=100', () => jsonResponse([
    { tag_name: 'v2.0.0', name: 'v2.0.0', published_at: '2026-09-20T00:00:00Z', body: '', html_url: '', prerelease: false },
  ])],
  // gh-unordered: no ref and a non-semver installed version → branch tracking
  ['https://api.github.com/repos/me/ghdev/releases?per_page=100', () => jsonResponse([
    { tag_name: 'v1.0.0', name: 'v1.0.0', published_at: '2026-09-20T00:00:00Z', body: '', html_url: '', prerelease: false },
  ])],
  // gh-semver: github spec pinned to a semver range (#semver:^1.0.0) — the
  // range must cap the recommendation at v1.4.0, not the v2.0.0 major.
  ['https://api.github.com/repos/me/ghsemver/releases?per_page=100', () => jsonResponse([
    { tag_name: 'v2.0.0', name: 'v2.0.0', published_at: '2026-10-10T00:00:00Z', body: 'major', html_url: '', prerelease: false },
    { tag_name: 'v1.4.0', name: 'v1.4.0', published_at: '2026-09-10T00:00:00Z', body: 'minor', html_url: '', prerelease: false },
    { tag_name: 'v1.0.0', name: 'v1.0.0', published_at: '2026-01-10T00:00:00Z', body: 'base', html_url: '', prerelease: false },
  ])],
  // gh-nomatch: #semver:^9.0.0 matches no published tag — the row stays
  // "unknown" instead of recommending the newest (breaking) major.
  ['https://api.github.com/repos/me/ghnomatch/releases?per_page=100', () => jsonResponse([
    { tag_name: 'v2.0.0', name: 'v2.0.0', published_at: '2026-10-10T00:00:00Z', body: 'major', html_url: '', prerelease: false },
    { tag_name: 'v1.4.0', name: 'v1.4.0', published_at: '2026-09-10T00:00:00Z', body: 'minor', html_url: '', prerelease: false },
  ])],
  // fallback-pkg: dist-tags 404 on the primary registry → packument still works
  ['https://registry.npmjs.org/-/package/fallback-pkg/dist-tags', () => jsonResponse({ error: 'not found' }, { status: 404 })],
  ['https://registry.npmmirror.com/-/package/fallback-pkg/dist-tags', () => jsonResponse({ error: 'not found' }, { status: 404 })],
  ['https://registry.npmjs.org/fallback-pkg', () => jsonResponse({
    'dist-tags': { latest: '0.2.0' },
    versions: { '0.2.0': {} },
  })],
  // dead-pkg: every route 500 → row-level error, scan survives
  ['https://registry.npmjs.org/-/package/dead-pkg/dist-tags', () => jsonResponse({}, { status: 500 })],
  ['https://registry.npmmirror.com/-/package/dead-pkg/dist-tags', () => jsonResponse({}, { status: 500 })],
  ['https://registry.npmjs.org/dead-pkg', () => jsonResponse({}, { status: 500 })],
  ['https://registry.npmmirror.com/dead-pkg', () => jsonResponse({}, { status: 500 })],
  // dead-pkg exhausts the CDN chain too, so it stays an error row
  ['https://unpkg.com/dead-pkg/package.json', () => jsonResponse({}, { status: 500 })],
  ['https://cdn.jsdelivr.net/npm/dead-pkg/package.json', () => jsonResponse({}, { status: 500 })],
  // cdn-only-pkg: both registries fail at the transport layer — the corporate
  // TLS-interception shape — while the CDN answers, so the row still resolves.
  ['https://registry.npmjs.org/-/package/cdn-only-pkg/dist-tags', () => { throw new TypeError('fetch failed'); }],
  ['https://registry.npmmirror.com/-/package/cdn-only-pkg/dist-tags', () => { throw new TypeError('fetch failed'); }],
  ['https://unpkg.com/cdn-only-pkg/package.json', () => jsonResponse({ name: 'cdn-only-pkg', version: '3.0.0' })],
  // @scope/cdn-pkg: same failure for a scoped name. The CDN path must keep the
  // "@scope/name" slash: an encoded %40scope%2Fname 404s on unpkg/jsDelivr.
  ['https://registry.npmjs.org/-/package/%40scope%2Fcdn-pkg/dist-tags', () => { throw new TypeError('fetch failed'); }],
  ['https://registry.npmmirror.com/-/package/%40scope%2Fcdn-pkg/dist-tags', () => { throw new TypeError('fetch failed'); }],
  ['https://unpkg.com/@scope/cdn-pkg/package.json', () => jsonResponse({ name: '@scope/cdn-pkg', version: '1.2.0' })],
]);

const seenAuth = [];
async function fakeFetch(url, init) {
  hits.set(url, (hits.get(url) ?? 0) + 1);
  if (url.startsWith('https://api.github.com/')) seenAuth.push(init?.headers?.authorization ?? '');
  const route = routes.get(url);
  if (!route) return jsonResponse({ message: `unexpected url ${url}` }, { status: 404 });
  return route();
}

// --- temp profile ----------------------------------------------------------------
const profileDir = await mkdtemp(path.join(tmpdir(), 'dsh-uc-'));
async function stub(name, manifest) {
  await mkdir(path.join(profileDir, 'node_modules', name), { recursive: true });
  await writeFile(path.join(profileDir, 'node_modules', name, 'package.json'), JSON.stringify(manifest));
}
await stub('current-pkg', { name: 'current-pkg', version: '1.0.0', description: 'current' });
await stub('outdated-pkg', { name: 'outdated-pkg', version: '0.9.0', description: 'outdated' });
await stub('gh-plugin', { name: 'gh-plugin', version: '1.0.0', description: 'github install' });
await stub('local-plugin', { name: 'local-plugin', version: '1.5.0', description: 'local', repository: { url: 'git+https://github.com/me/localrepo.git' } });
await stub('ahead-plugin', { name: 'ahead-plugin', version: '2.5.0', description: 'ahead', repository: { url: 'git+https://github.com/me/aheadrepo.git' } });
await stub('equal-plugin', { name: 'equal-plugin', version: '2.0.0', description: 'equal', repository: { url: 'git+https://github.com/me/equalrepo.git' } });
await stub('nov-prefix-plugin', { name: 'nov-prefix-plugin', version: '1.0.0', description: 'no v prefix', repository: { url: 'git+https://github.com/me/novrepo.git' } });
await stub('gh-branch', { name: 'gh-branch', version: '0.0.0', description: 'branch ref' });
await stub('gh-noref', { name: 'gh-noref', version: '1.0.0', description: 'github no ref' });
await stub('gh-noref-current', { name: 'gh-noref-current', version: '2.0.0', description: 'github no ref current' });
await stub('gh-unordered', { name: 'gh-unordered', version: 'dev', description: 'github no ref unorderable' });
await stub('gh-semver', { name: 'gh-semver', version: '1.2.0', description: 'semver range install' });
await stub('gh-nomatch', { name: 'gh-nomatch', version: '1.2.0', description: 'semver range install with no matching tag' });
await stub('fallback-pkg', { name: 'fallback-pkg', version: '0.1.0', description: 'dist-tags dead' });
await stub('dead-pkg', { name: 'dead-pkg', version: '0.0.1', description: 'all 500' });
await stub('cdn-only-pkg', { name: 'cdn-only-pkg', version: '2.0.0', description: 'registries unreachable' });
await stub('@scope/cdn-pkg', { name: '@scope/cdn-pkg', version: '1.0.0', description: 'scoped, registries unreachable' });
await writeFile(path.join(profileDir, 'package.json'), JSON.stringify({
  name: 'profile',
  private: true,
  dependencies: {
    '@deepseek-ai/skip-me': '1.0.0',
    'current-pkg': '1.0.0',
    'outdated-pkg': '0.9.0',
    'gh-plugin': 'github:me/ghrepo#v1.0.0',
    'local-plugin': 'link:D:/dev/local-plugin',
    'ahead-plugin': 'link:D:/dev/ahead-plugin',
    'equal-plugin': 'link:D:/dev/equal-plugin',
    'nov-prefix-plugin': 'link:D:/dev/nov-prefix-plugin',
    'gh-branch': 'github:me/ghbranch#main',
    'gh-noref': 'github:me/ghnoref',
    'gh-noref-current': 'github:me/ghcurrent',
    'gh-unordered': 'github:me/ghdev',
    'gh-semver': 'github:me/ghsemver#semver:^1.0.0',
    'gh-nomatch': 'github:me/ghnomatch#semver:^9.0.0',
    'fallback-pkg': '0.1.0',
    'dead-pkg': '0.0.1',
    'cdn-only-pkg': '2.0.0',
    '@scope/cdn-pkg': '1.0.0',
  },
}, null, 2));

// --- run ---------------------------------------------------------------------------
// Token support: a GITHUB_TOKEN in the host environment must reach the API as
// a bearer header. Restored right after the first scan so the second run (cache
// only) sees the normal environment.
const savedToken = process.env.GITHUB_TOKEN;
process.env.GITHUB_TOKEN = 'test-token-123';
const http = createHttpLayer({ fetch: fakeFetch });
const result = await runCheck(profileDir, null, http);
if (savedToken === undefined) delete process.env.GITHUB_TOKEN;
else process.env.GITHUB_TOKEN = savedToken;

const byName = Object.fromEntries(result.rows.map((row) => [row.name, row]));

check('skip @deepseek-ai/* deps', result.rows.length === 17, `rows=${result.rows.map((r) => r.name).join(',')}`);
check('current-pkg → latest via dist-tags fast path', byName['current-pkg']?.status === 'latest' && byName['current-pkg'].latest === '1.0.0');
check('fast path fetched no packument for current-pkg', !hits.has('https://registry.npmjs.org/current-pkg'), [...hits.keys()].join(' '));
check('outdated-pkg → update', byName['outdated-pkg']?.status === 'update' && byName['outdated-pkg'].latest === '1.1.0');
check('outdated-pkg notes: v1.0.0+v1.1.0 only (prerelease-tagged rc skipped)', byName['outdated-pkg']?.releases?.map((r) => r.tag).join(',') === 'v1.0.0,v1.1.0', JSON.stringify(byName['outdated-pkg']?.releases?.map((r) => r.tag)));
check('gh-plugin → update past v1.0.0 (prerelease excluded from latest)', byName['gh-plugin']?.status === 'update' && byName['gh-plugin'].latest === 'v1.2.0');
check('gh-plugin releases newest-first through v1.0.0 (prereleases kept in notes)', byName['gh-plugin']?.releases?.map((r) => r.tag).join(',') === 'v1.3.0-beta.1,v1.2.0', JSON.stringify(byName['gh-plugin']?.releases?.map((r) => r.tag)));
check('local-plugin → local-behind vs v2.0.0', byName['local-plugin']?.status === 'local-behind' && byName['local-plugin'].latest === 'v2.0.0');
check('ahead-plugin → local-ahead (installed newer than upstream)', byName['ahead-plugin']?.status === 'local-ahead' && byName['ahead-plugin'].latest === 'v2.0.0');
check('equal-plugin → local-latest', byName['equal-plugin']?.status === 'local-latest');
check('nov-prefix-plugin notes stop at installed version despite no v prefix', byName['nov-prefix-plugin']?.status === 'local-behind' && byName['nov-prefix-plugin']?.releases?.map((r) => r.tag).join(',') === '2.0.0', JSON.stringify(byName['nov-prefix-plugin']?.releases?.map((r) => r.tag)));
check('gh-branch (branch ref, installed version orderable) → update', byName['gh-branch']?.status === 'update' && byName['gh-branch'].releases?.map((r) => r.tag).join(',') === 'v1.0.0', JSON.stringify(byName['gh-branch']?.releases?.map((r) => r.tag)));
check('gh-noref (no ref) → update past installed 1.0.0', byName['gh-noref']?.status === 'update' && byName['gh-noref'].latest === 'v1.2.0' && byName['gh-noref'].releases?.map((r) => r.tag).join(',') === 'v1.2.0,v1.1.0', JSON.stringify(byName['gh-noref']?.releases?.map((r) => r.tag)));
check('gh-noref-current (no ref, installed == newest tag) → latest', byName['gh-noref-current']?.status === 'latest' && byName['gh-noref-current'].latest === 'v2.0.0');
check('gh-unordered (non-semver installed) → branch, not update', byName['gh-unordered']?.status === 'branch' && byName['gh-unordered'].releases?.length === 1);
check('gh-semver (#semver:^1.0.0) caps the target below the 2.0.0 major', byName['gh-semver']?.status === 'update' && byName['gh-semver'].latest === 'v1.4.0' && byName['gh-semver'].releases?.map((r) => r.tag).join(',') === 'v1.4.0', JSON.stringify({ status: byName['gh-semver']?.status, latest: byName['gh-semver']?.latest, releases: byName['gh-semver']?.releases?.map((r) => r.tag) }));
check('gh-nomatch (range with no matching tag) → unknown, not newest major', byName['gh-nomatch']?.status === 'unknown', JSON.stringify({ status: byName['gh-nomatch']?.status, latest: byName['gh-nomatch']?.latest }));
check('GITHUB_TOKEN forwarded as bearer header', seenAuth.length > 0 && seenAuth.every((value) => value === 'Bearer test-token-123'), seenAuth.join('|'));
check('fallback-pkg survives dist-tags 404 via packument', byName['fallback-pkg']?.status === 'update' && byName['fallback-pkg'].latest === '0.2.0');
check('dead-pkg → error row, scan survives', byName['dead-pkg']?.status === 'error' && typeof byName['dead-pkg'].error === 'string');
check('cdn-only-pkg → update via CDN when both registries fail', byName['cdn-only-pkg']?.status === 'update' && byName['cdn-only-pkg'].latest === '3.0.0', JSON.stringify({ status: byName['cdn-only-pkg']?.status, latest: byName['cdn-only-pkg']?.latest }));
check('scoped name keeps its slash on the CDN path', byName['@scope/cdn-pkg']?.status === 'update' && byName['@scope/cdn-pkg'].latest === '1.2.0' && !hits.has('https://unpkg.com/%40scope%2Fcdn-pkg/package.json'), JSON.stringify({ status: byName['@scope/cdn-pkg']?.status, latest: byName['@scope/cdn-pkg']?.latest }));
check('a registry 404 never reaches the CDN fallback', !hits.has('https://unpkg.com/fallback-pkg/package.json') && !hits.has('https://cdn.jsdelivr.net/npm/fallback-pkg/package.json'), [...hits.keys()].filter((url) => url.includes('fallback-pkg')).join(' '));

const statuses = result.rows.map((row) => row.status);
check('sort: update rows before local-behind before error', statuses.indexOf('update') === 0 && statuses.lastIndexOf('update') < statuses.indexOf('local-behind') && statuses.indexOf('local-behind') < statuses.indexOf('error'), statuses.join(','));
check('counts summarize statuses', result.counts.update === 8 && result.counts['local-behind'] === 2 && result.counts.error === 1 && result.counts.latest === 2 && result.counts['local-ahead'] === 1 && result.counts['local-latest'] === 1 && result.counts.branch === 1 && result.counts.unknown === 1, JSON.stringify(result.counts));
check('stats attached with request counts', typeof result.stats.requests === 'number' && result.stats.requests > 0, JSON.stringify(result.stats));

const firstRunRequests = result.stats.requests;

// --- second run on the same layer: successes cached, only failed URLs retried ----
const successUrls = [
  'https://registry.npmjs.org/-/package/current-pkg/dist-tags',
  'https://registry.npmjs.org/-/package/outdated-pkg/dist-tags',
  'https://registry.npmjs.org/outdated-pkg',
  'https://api.github.com/repos/me/outdated/releases?per_page=100',
  'https://api.github.com/repos/me/ghrepo/releases?per_page=100',
  'https://api.github.com/repos/me/localrepo/releases?per_page=100',
  'https://api.github.com/repos/me/aheadrepo/releases?per_page=100',
  'https://api.github.com/repos/me/equalrepo/releases?per_page=100',
  'https://api.github.com/repos/me/novrepo/releases?per_page=100',
  'https://api.github.com/repos/me/ghbranch/releases?per_page=100',
  'https://api.github.com/repos/me/ghsemver/releases?per_page=100',
  'https://api.github.com/repos/me/ghnomatch/releases?per_page=100',
  'https://registry.npmjs.org/fallback-pkg',
];
const result2 = await runCheck(profileDir, null, http);
const retried = [...hits.entries()].filter(([url, count]) => count > 1).map(([url]) => url);
check('second scan: successful URLs served from TTL cache (1 hit each)', successUrls.every((url) => hits.get(url) === 1), JSON.stringify(successUrls.filter((url) => hits.get(url) !== 1)));
check('second scan: only failed URLs retried', retried.every((url) => !successUrls.includes(url)) && retried.some((url) => url.includes('dead-pkg')), retried.join(' '));
// A 404 on the primary registry must not be forwarded to the npmmirror mirror.
check('dist-tags 404 is not mirrored', !hits.has('https://registry.npmmirror.com/-/package/fallback-pkg/dist-tags'), [...hits.keys()].filter((url) => url.includes('fallback-pkg')).join(' '));
check('second scan: identical statuses', JSON.stringify(result2.rows.map((r) => r.status)) === JSON.stringify(result.rows.map((r) => r.status)));

// --- manifest errors are not "a profile with no plugins" -------------------
{
  const badDir = await mkdtemp(path.join(tmpdir(), 'dsh-uc-bad-'));
  await writeFile(path.join(badDir, 'package.json'), '{ this is not json');
  let malformed = null;
  try {
    await runCheck(badDir, null, createHttpLayer({ fetch: fakeFetch }));
  } catch (error) {
    malformed = error;
  }
  check('malformed profile manifest fails the scan', malformed instanceof Error && /not valid JSON/.test(malformed.message), String(malformed));
  await rm(badDir, { recursive: true, force: true });

  const freshDir = await mkdtemp(path.join(tmpdir(), 'dsh-uc-fresh-'));
  const fresh = await runCheck(freshDir, null, createHttpLayer({ fetch: fakeFetch }));
  check('missing manifest still means no plugins', fresh.rows.length === 0, JSON.stringify(fresh.rows));
  await rm(freshDir, { recursive: true, force: true });
}

// --- dependency keys are not filesystem paths -------------------------------
{
  const hostileDir = await mkdtemp(path.join(tmpdir(), 'dsh-uc-hostile-'));
  await mkdir(path.join(hostileDir, 'node_modules', 'current-pkg'), { recursive: true });
  await writeFile(
    path.join(hostileDir, 'node_modules', 'current-pkg', 'package.json'),
    JSON.stringify({ name: 'current-pkg', version: '1.0.0' }),
  );
  await writeFile(path.join(hostileDir, 'package.json'), JSON.stringify({
    name: 'hostile',
    dependencies: {
      '../../../../home/me/.ssh/id_rsa': '1.0.0',
      '..\\\\..\\\\secrets': '1.0.0',
      'current-pkg': '1.0.0',
    },
  }));
  const hostile = await runCheck(hostileDir, null, http);
  check('hostile dependency names are never scanned', hostile.rows.map((row) => row.name).join(',') === 'current-pkg', hostile.rows.map((row) => row.name).join(','));
  await rm(hostileDir, { recursive: true, force: true });
}

await rm(profileDir, { recursive: true, force: true });

const failed = results.filter((pass) => !pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

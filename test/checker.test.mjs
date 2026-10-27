// Unit tests for lib/checker.js pure functions (no network).
import { compareVersions, parseSpec, declaredExactPin, githubRepoFromUrl } from '../lib/checker.js';
import { readFileSync } from 'node:fs';

let passed = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) { console.error(`FAIL ${label}: expected ${b}, got ${a}`); process.exit(1); }
  passed += 1;
}

// compareVersions: core ordering
eq(compareVersions('0.1.180', '0.1.181'), -1, 'patch lower');
eq(compareVersions('0.1.181', '0.1.181'), 0, 'equal');
eq(compareVersions('1.0.0', '0.9.9'), 1, 'major higher');
// tolerance: v prefix, two-segment, four-segment
eq(compareVersions('v1.2.3', '1.2.3'), 0, 'v prefix equal');
eq(compareVersions('1.2', '1.2.0'), 0, 'two-segment normalizes');
eq(compareVersions('1.2', '1.2.1'), -1, 'two-segment lower');
eq(compareVersions('1.2.3.4', '1.2.3'), 1, 'four-segment higher');
eq(compareVersions('1.2.3.4', '1.2.3.5'), -1, 'four-segment compare');
eq(compareVersions('1.2.3.4', '1.2.4'), -1, 'four-segment vs higher patch');
// prerelease ordering
eq(compareVersions('1.0.0-alpha', '1.0.0'), -1, 'prerelease below release');
eq(compareVersions('1.0.0-alpha', '1.0.0-beta'), -1, 'prerelease lexical');
// non-semver
eq(compareVersions('main', '1.0.0'), null, 'non-semver null');
eq(compareVersions('', '1.0.0'), null, 'empty null');
// numeric segments must not lose precision or leading zeros
eq(compareVersions('1.0.9007199254740993', '1.0.9007199254740992'), 1, 'large segment precision');
eq(compareVersions('99999999999999999999.0.0', '99999999999999999998.0.0'), 1, 'huge segment precision');
eq(compareVersions('1.0.01', '1.0.1'), 0, 'leading zero equal');
eq(compareVersions('1.0.0-1', '1.0.0-alpha'), -1, 'prerelease numeric below alnum');
eq(compareVersions('1.0.0-alpha', '1.0.0-alpha.1'), -1, 'longer prerelease wins');
eq(compareVersions('1.0.901', '1.0.900'), 1, 'patch above');
eq(compareVersions('1.0.0-2', '1.0.0-10'), -1, 'prerelease numeric order');

// parseSpec
eq(parseSpec('github:daha1216/dsh-retrace'), { kind: 'github', owner: 'daha1216', repo: 'dsh-retrace', ref: undefined }, 'github no ref');
eq(parseSpec('github:HaoyueQin/x#v0.5.2'), { kind: 'github', owner: 'HaoyueQin', repo: 'x', ref: 'v0.5.2' }, 'github with ref');
eq(parseSpec('github:daha1216/dsh-retrace.git'), { kind: 'github', owner: 'daha1216', repo: 'dsh-retrace', ref: undefined }, 'github .git suffix');
eq(parseSpec('file:D:/dsh work/dsh-watcher'), { kind: 'file', path: 'D:/dsh work/dsh-watcher' }, 'file spec');
eq(parseSpec('link:D:/dsh work/skills-manager'), { kind: 'file', path: 'D:/dsh work/skills-manager' }, 'link spec treated as file');
eq(parseSpec('link:D:/dsh work/dsh-update-checker'), { kind: 'file', path: 'D:/dsh work/dsh-update-checker' }, 'link spec self');
eq(parseSpec('npm:billion-context@0.1.180'), { kind: 'npm', pkg: 'billion-context', range: '0.1.180' }, 'npm alias spec');
eq(parseSpec('npm:@scope/pkg@^1.2.3'), { kind: 'npm', pkg: '@scope/pkg', range: '^1.2.3' }, 'scoped npm alias');
eq(parseSpec('npm:billion-context'), { kind: 'npm', pkg: 'billion-context', range: 'latest' }, 'bare npm alias');
eq(parseSpec('0.1.180'), { kind: 'npm', pkg: null, range: '0.1.180' }, 'exact pin is npm');
eq(parseSpec('v0.1.180'), { kind: 'npm', pkg: null, range: 'v0.1.180' }, 'v-prefixed pin is npm');
eq(parseSpec('V1.0.0'), { kind: 'npm', pkg: null, range: 'V1.0.0' }, 'V-prefixed pin is npm');
eq(parseSpec('^0.1.180'), { kind: 'npm', pkg: null, range: '^0.1.180' }, 'caret range is npm');
eq(parseSpec('latest'), { kind: 'npm', pkg: null, range: 'latest' }, 'latest tag is npm');
eq(parseSpec('workspace:*'), { kind: 'unknown', spec: 'workspace:*' }, 'workspace unknown');
// canonical git URLs from real manifests still resolve to GitHub
eq(parseSpec('git+ssh://git@github.com:o/r.git#v1.0.0'), { kind: 'github', owner: 'o', repo: 'r', ref: 'v1.0.0' }, 'git+ssh scp form');
eq(parseSpec('git+ssh://git@github.com/o/r.git'), { kind: 'github', owner: 'o', repo: 'r', ref: undefined }, 'git+ssh path form');
eq(parseSpec('git+https://git@github.com/o/r.git'), { kind: 'github', owner: 'o', repo: 'r', ref: undefined }, 'git+https userinfo form');
eq(parseSpec('ssh://git@github.com/o/r.git'), { kind: 'github', owner: 'o', repo: 'r', ref: undefined }, 'ssh url');
eq(parseSpec('git://github.com/o/r.git'), { kind: 'github', owner: 'o', repo: 'r', ref: undefined }, 'git protocol url');
eq(parseSpec('git@github.com:o/r.git'), { kind: 'github', owner: 'o', repo: 'r', ref: undefined }, 'bare scp form');
eq(parseSpec('git+ssh://git@gitlab.com/o/r.git'), { kind: 'git', spec: 'git+ssh://git@gitlab.com/o/r.git' }, 'non-github git stays git');
// documented github: shorthand with semver range
eq(parseSpec('github:o/r#semver:^1.2.0').ref, 'semver:^1.2.0', 'semver range ref kept');

// declaredExactPin: only full versions are opaque pins; "1" / "1.2" are ranges
eq(declaredExactPin('0.1.180'), '0.1.180', 'plain pin');
eq(declaredExactPin(' 2.10.6 '), '2.10.6', 'trimmed pin');
eq(declaredExactPin('1.2'), '', 'minor-only range is not a pin');
eq(declaredExactPin('1'), '', 'major-only range is not a pin');
eq(declaredExactPin('1.2.3-beta.1'), '1.2.3-beta.1', 'prerelease pin');
eq(declaredExactPin('v1.2.3'), '1.2.3', 'v-prefixed pin accepted');
eq(declaredExactPin('^0.1.180'), '', 'range is not a pin');
eq(declaredExactPin('~1.2'), '', 'tilde is not a pin');
eq(declaredExactPin('>=1.0.0'), '', 'gte is not a pin');
eq(declaredExactPin('latest'), '', 'dist-tag is not a pin');
eq(declaredExactPin('1.x'), '', 'wildcard is not a pin');
eq(declaredExactPin('link:D:/x'), '', 'link is not a pin');
eq(declaredExactPin(''), '', 'empty is not a pin');

// githubRepoFromUrl sanity
const repo = githubRepoFromUrl('git+https://github.com/daha1216/dsh-retrace.git');
eq(repo && repo.owner === 'daha1216' && repo.repo === 'dsh-retrace', true, 'repo url parse');
eq(githubRepoFromUrl('https://github.com/o/r/'), { owner: 'o', repo: 'r' }, 'trailing slash');
eq(githubRepoFromUrl('https://github.com/o/r?tab=readme'), { owner: 'o', repo: 'r' }, 'query stripped');
eq(githubRepoFromUrl('https://github.com/o/r.git#readme'), { owner: 'o', repo: 'r' }, 'git suffix + fragment');
eq(githubRepoFromUrl('https://www.github.com/o/r'), { owner: 'o', repo: 'r' }, 'www host');
eq(githubRepoFromUrl('git+ssh://git@github.com:o/r.git'), { owner: 'o', repo: 'r' }, 'git+ssh repo');
eq(githubRepoFromUrl('git+https://git@github.com/o/r.git'), { owner: 'o', repo: 'r' }, 'userinfo https repo');
eq(githubRepoFromUrl('https://user:pass@github.com/o/r'), { owner: 'o', repo: 'r' }, 'userinfo password repo');
eq(githubRepoFromUrl('git@github.com:o/r'), { owner: 'o', repo: 'r' }, 'scp repo');
eq(githubRepoFromUrl('https://gitlab.com/o/r'), null, 'non-github null');
eq(githubRepoFromUrl(''), null, 'empty null');

// Static sanity: the abbreviated packument accept header is present
const src = readFileSync(new URL('../lib/checker.js', import.meta.url), 'utf8');
eq(src.includes('application/vnd.npm.install-v1+json'), true, 'abbreviated accept header present');
eq(src.includes('vnd.npm.install-v1'), true, 'header string intact');

console.log(`${passed} assertions passed`);

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

// parseSpec
eq(parseSpec('github:daha1216/dsh-retrace'), { kind: 'github', owner: 'daha1216', repo: 'dsh-retrace', ref: undefined }, 'github no ref');
eq(parseSpec('github:HaoyueQin/x#v0.5.2'), { kind: 'github', owner: 'HaoyueQin', repo: 'x', ref: 'v0.5.2' }, 'github with ref');
eq(parseSpec('github:daha1216/dsh-retrace.git'), { kind: 'github', owner: 'daha1216', repo: 'dsh-retrace', ref: undefined }, 'github .git suffix');
eq(parseSpec('file:D:/dsh work/dsh-watcher'), { kind: 'file', path: 'D:/dsh work/dsh-watcher' }, 'file spec');
eq(parseSpec('link:D:/dsh work/skills-manager'), { kind: 'file', path: 'D:/dsh work/skills-manager' }, 'link spec treated as file');
eq(parseSpec('link:D:/dsh work/dsh-update-checker'), { kind: 'file', path: 'D:/dsh work/dsh-update-checker' }, 'link spec self');
eq(parseSpec('npm:billion-context@0.1.180'), { kind: 'npm', pkg: 'billion-context', range: '0.1.180' }, 'npm alias spec');
eq(parseSpec('0.1.180'), { kind: 'npm', pkg: null, range: '0.1.180' }, 'exact pin is npm');
eq(parseSpec('^0.1.180'), { kind: 'npm', pkg: null, range: '^0.1.180' }, 'caret range is npm');
eq(parseSpec('latest'), { kind: 'npm', pkg: null, range: 'latest' }, 'latest tag is npm');
eq(parseSpec('workspace:*'), { kind: 'unknown', spec: 'workspace:*' }, 'workspace unknown');

// declaredExactPin: the profile declaration beats node_modules drift
eq(declaredExactPin('0.1.180'), '0.1.180', 'plain pin');
eq(declaredExactPin(' 2.10.6 '), '2.10.6', 'trimmed pin');
eq(declaredExactPin('1'), '1', 'major-only pin');
eq(declaredExactPin('1.2.3-beta.1'), '1.2.3-beta.1', 'prerelease pin');
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

// Static sanity: the abbreviated packument accept header is present
const src = readFileSync(new URL('../lib/checker.js', import.meta.url), 'utf8');
eq(src.includes('application/vnd.npm.install-v1+json'), true, 'abbreviated accept header present');
eq(src.includes('vnd.npm.install-v1'), true, 'header string intact');

console.log(`${passed} assertions passed`);

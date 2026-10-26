/**
 * Tests for the one-click batch update: the prompt the plugin hands to the AI,
 * which rows count as updatable, and the handover into a *new* conversation
 * (start session → fill the composer → never submit).
 *
 * Run: node test/batch-update.test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const clientSource = readFileSync(join(here, '..', 'client', 'client.js'), 'utf8');

let captured = null;
globalThis.window = { __ModuleLoader__: { load(mod) { captured = mod; } } };
await import(new URL('../client/client.js', import.meta.url).href);

if (!captured || captured.id !== 'dsh-update-checker') throw new Error('module not captured');
const reactStub = { createElement: (...args) => args, Fragment: 'Fragment' };
const plugin = captured.factory((name) => reactStub);
const {
  buildBatchPrompt,
  isActionable,
  fillComposerDraft,
  draftInNewSession,
} = plugin._internals;

const results = [];
function check(name, condition, detail = '') {
  results.push(!!condition);
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// A tiny translator: the real one binds locale namespaces, but the prompt only
// needs the templates, so echoing the key with %s substituted is faithful.
const templates = {
  batchUpdatePrompt: '帮我更新这些检测到新版本的 DSH 插件，逐个更新，完成后告诉我每个插件的结果。',
  batchUpdateProfile: 'profile：%s，插件装在该 profile 下。',
};
const t = (key) => templates[key] ?? key;

// --- 1. which rows the batch covers --------------------------------------
check('update rows are actionable', isActionable({ status: 'update' }) === true);
check('local-behind rows are actionable', isActionable({ status: 'local-behind' }) === true);
for (const status of ['latest', 'local-latest', 'local-ahead', 'local', 'branch', 'error', 'unknown']) {
  check(`${status} rows are not actionable`, isActionable({ status }) === false);
}
check('missing row is not actionable', isActionable(undefined) === false);

// --- 2. the prompt itself ------------------------------------------------
const rows = [
  { name: 'dsh-pocket', status: 'update', installed: '3.0.1', latest: 'v3.0.2', spec: 'file:C:/csh/dsh-pocket-pure' },
  { name: 'dsh-watcher', status: 'local-behind', installed: '0.7.0', latest: 'v0.7.1', spec: 'file:D:/dsh work/dsh-watcher' },
];
const prompt = buildBatchPrompt(rows, t, 'C:\\Users\\daha\\.dsh\\profiles\\desktop');
check('prompt opens with the request', prompt.startsWith(templates.batchUpdatePrompt));
check('prompt numbers every row', prompt.includes('1. dsh-pocket') && prompt.includes('2. dsh-watcher'));
check('prompt carries installed → latest', prompt.includes('3.0.1 → v3.0.2') && prompt.includes('0.7.0 → v0.7.1'));
check('prompt carries the install spec', prompt.includes('file:C:/csh/dsh-pocket-pure') && prompt.includes('file:D:/dsh work/dsh-watcher'));
check('prompt names the profile slug only', prompt.includes('profile：desktop') && !prompt.includes('C:\\Users'), prompt.split('\n')[1]);

const noProfile = buildBatchPrompt(rows, t, '');
check('no profile line without a profile dir', !noProfile.includes('profile：'), noProfile);
check('rows without spec still render', buildBatchPrompt([{ name: 'x', installed: '1', latest: '2' }], t, '').includes('1. x  1 → 2'));
check('missing versions degrade to ?', buildBatchPrompt([{ name: 'x' }], t, '').includes('x  ? → ?'));

// --- 3. the handover never submits --------------------------------------
/** A composer stub that records what the plugin asked of it. */
function actionsStub(overrides = {}) {
  const calls = [];
  const actions = {
    calls,
    setDraft: (text) => { calls.push(['setDraft', text]); },
    submit: () => { calls.push(['submit']); },
    ...overrides,
  };
  return actions;
}

const setClipboard = (value) => Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });

/**
 * A uiSession adapter stub: `current` starts on the old session and switches to
 * the new one when the workspace's startSession is called, mirroring the host
 * (creation is async, the binding lands a tick later).
 */
function hostStub({ sessionActions, submitThrows = false } = {}) {
  const oldActions = actionsStub();
  const nextActions = sessionActions ?? actionsStub();
  const listeners = new Set();
  let key = 'old-session';
  const source = {
    getSnapshot: () => ({
      key,
      props: { inputActions: key === 'old-session' ? oldActions : nextActions },
    }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const uiSession = { adapter: { current: source } };
  const uiWorkspace = {
    startSessionCalls: 0,
    startSession() {
      this.startSessionCalls += 1;
      // The host mounts the new session asynchronously, so the binding only
      // flips after startSession() returns.
      setTimeout(() => {
        key = 'new-session';
        for (const listener of [...listeners]) listener();
      }, 0);
      return Promise.resolve();
    },
  };
  return {
    ctx: { get: (name) => (name === 'uiSession' ? uiSession : name === 'uiWorkspace' ? uiWorkspace : undefined) },
    oldActions,
    nextActions,
    uiWorkspace,
    submitThrows,
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

{
  const host = hostStub();
  setClipboard({ clipboard: { writeText: () => undefined } });
  const outcome = draftInNewSession(host.ctx, 'update them');
  check('batch handover starts a new conversation', host.uiWorkspace.startSessionCalls === 1, `outcome=${outcome}`);
  check('batch handover reports session', outcome === 'session');
  check('draft does not land in the old session', host.oldActions.calls.length === 0, JSON.stringify(host.oldActions.calls));
  await wait(10);
  check('draft lands in the new session', host.nextActions.calls[0]?.[0] === 'setDraft' && host.nextActions.calls[0]?.[1] === 'update them');
  check('batch handover never submits', !host.nextActions.calls.some((call) => call[0] === 'submit'), JSON.stringify(host.nextActions.calls));
}

// A host whose new session has no composer yet: the draft is still owed, and
// must not be dropped onto the previous conversation's composer.
{
  const host = hostStub({ sessionActions: { calls: [] } });
  setClipboard({});
  const outcome = draftInNewSession(host.ctx, 'x');
  check('no composer in the new session still reports session', outcome === 'session', `outcome=${outcome}`);
  check('no composer means no stray draft', host.oldActions.calls.length === 0 && host.nextActions.calls.length === 0);
}

// No workspace navigation (older host, or the service is not exposed): fall
// back to filling the composer that is already open.
{
  const actions = actionsStub();
  const ctx = { get: (name) => (name === 'uiSession' ? { adapter: { current: { getSnapshot: () => ({ key: 's', props: { inputActions: actions } }) } } } : undefined) };
  setClipboard({});
  check('no workspace service falls back to the open composer', draftInNewSession(ctx, 'y') === 'draft');
  check('fallback fills the open composer', actions.calls[0]?.[0] === 'setDraft' && actions.calls.length === 1);
}

// Nothing at all: no session, no workspace, no clipboard.
{
  setClipboard({});
  check('no host surface reports none', draftInNewSession({ get: () => undefined }, 'z') === 'none');
}

check('fillComposerDraft never starts a session', (() => {
  const host = hostStub();
  setClipboard({});
  fillComposerDraft(host.ctx, 'w');
  return host.uiWorkspace.startSessionCalls === 0;
})());

// --- 4. both languages carry the new keys -------------------------------
for (const key of ['batchUpdate', 'batchUpdateHint', 'batchUpdateSent', 'batchUpdateDraft', 'batchUpdateEmpty', 'batchUpdatePrompt', 'batchUpdateProfile']) {
  const hits = (clientSource.match(new RegExp(`\\n\\s+${key}:`, 'g')) ?? []).length;
  check(`i18n key ${key} in zh+en`, hits === 2, `count=${hits}`);
}

// --- 5. wiring: the buttons exist and the batch path opens a session ----
check('reminder panel has the batch button',
  /onClick: updateAll,\s*\n\s*\}, t\('batchUpdate'\)\)/.test(clientSource));
check('reminder panel batch path drafts into a new session',
  /const outcome = sendAi\(buildBatchPrompt\(pending, t, state\?\.profileDir\)\)/.test(clientSource));
check('settings page has the batch button',
  /\$\{t\('batchUpdate'\)\} \(\$\{actionable\.length\}\)/.test(clientSource));
check('settings page batch path drafts into a new session',
  /const outcome = sendAi\(buildBatchPrompt\(actionable, t, data\?\.profileDir\)\)/.test(clientSource));
check('batch button is wired to draftInNewSession',
  /const sendAi = \(text\) => draftInNewSession\(ctx, text\);/.test(clientSource));
check('both slots receive sendAi',
  (clientSource.match(/inject: \(\) => \(\{ rpcCall, t, askAi, sendAi \}\)/g) ?? []).length === 2);
check('the old submit path is gone',
  !/sendComposerText/.test(clientSource));

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exitCode = 1;

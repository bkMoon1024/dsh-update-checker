/**
 * Tests for the one-click batch update: the prompt the plugin hands to the AI,
 * which rows count as updatable, and the composer handover (setDraft + submit).
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
  sendComposerText,
  fillComposerDraft,
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

// --- 3. composer handover: setDraft then submit --------------------------
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
const withActions = (actions) => ({
  get: (name) => (name === 'uiSession' ? { adapter: { current: { getSnapshot: () => ({ props: { inputActions: actions } }) } } } : undefined),
});

const ok = actionsStub();
check('sendComposerText reports sent', sendComposerText(withActions(ok), 'hello') === 'sent');
check('sendComposerText drafts first', ok.calls[0]?.[0] === 'setDraft' && ok.calls[0]?.[1] === 'hello');
check('sendComposerText submits after', ok.calls[1]?.[0] === 'submit' && ok.calls.length === 2);

const noSubmit = actionsStub({ submit: undefined });
check('no submit channel degrades to draft', sendComposerText(withActions(noSubmit), 'x') === 'draft');

const throwingSubmit = actionsStub({ submit: () => { throw new Error('busy'); } });
check('submit that throws keeps the draft', sendComposerText(withActions(throwingSubmit), 'x') === 'draft');

const setClipboard = (value) => Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });

const throwingDraft = actionsStub({ setDraft: () => { throw new Error('no editor'); } });
setClipboard({ clipboard: { writeText: () => undefined } });
check('draft that throws falls back to clipboard', sendComposerText(withActions(throwingDraft), 'x') === 'clipboard');
check('fillComposerDraft never submits', fillComposerDraft(withActions(actionsStub()), 'y') === 'draft');

const none = { get: () => undefined };
setClipboard({});
check('no session and no clipboard reports none', sendComposerText(none, 'x') === 'none');

// --- 4. both languages carry the new keys -------------------------------
for (const key of ['batchUpdate', 'batchUpdateHint', 'batchUpdateSent', 'batchUpdateDraft', 'batchUpdateEmpty', 'batchUpdatePrompt', 'batchUpdateProfile']) {
  const hits = (clientSource.match(new RegExp(`\\n\\s+${key}:`, 'g')) ?? []).length;
  check(`i18n key ${key} in zh+en`, hits === 2, `count=${hits}`);
}

// --- 5. wiring: the buttons exist and the batch path sends --------------
check('reminder panel has the batch button',
  /onClick: updateAll,\s*\n\s*\}, t\('batchUpdate'\)\)/.test(clientSource));
check('reminder panel batch path sends, not just drafts',
  /const outcome = sendAi\(buildBatchPrompt\(pending, t, state\?\.profileDir\)\)/.test(clientSource));
check('settings page has the batch button',
  /\$\{t\('batchUpdate'\)\} \(\$\{actionable\.length\}\)/.test(clientSource));
check('settings page batch path sends',
  /const outcome = sendAi\(buildBatchPrompt\(actionable, t, data\?\.profileDir\)\)/.test(clientSource));
check('batch button is wired to sendComposerText',
  /const sendAi = \(text\) => sendComposerText\(ctx, text\);/.test(clientSource));
check('both slots receive sendAi',
  (clientSource.match(/inject: \(\) => \(\{ rpcCall, t, askAi, sendAi \}\)/g) ?? []).length === 2);

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exitCode = 1;

// Offline render harness: execute the client module, capture its slot
// registrations, and render them to text with a React stub.
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');

// Minimal React stub. `useState` reads from a seed queue so a component can be
// rendered once in a chosen state (the effects never run, so nothing would
// otherwise move it out of its initial state).
function createElement(type, props, ...children) {
  return { type, props: props ?? {}, children: children.flat(Infinity) };
}
let stateSeed = null;
function seedStates(values, render) {
  stateSeed = values.slice();
  try {
    return render();
  } finally {
    stateSeed = null;
  }
}
const React = {
  createElement,
  useState: (initial) => {
    const value = stateSeed && stateSeed.length > 0
      ? stateSeed.shift()
      : (typeof initial === 'function' ? initial() : initial);
    return [value, () => {}];
  },
  useEffect: () => {},
  useMemo: (fn) => fn(),
};

// DOM stubs for apply()
const styleEl = { el: null, removed: false };
const documentStub = {
  getElementById: () => null,
  createElement: () => ({ id: '', textContent: '', style: {}, remove() { styleEl.removed = true; } }),
  head: { appendChild: (el) => { styleEl.el = el; styleEl.removed = false; } },
  addEventListener: () => {},
  removeEventListener: () => {},
};

const registrations = new Map();
const disposers = [];
const ctx = {
  locale: { bind: () => () => undefined, register: () => () => {} },
  // Faithful cordis ctx.effect: run fn now; a returned function becomes the dispose hook.
  effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); return d; },
  connection: { rpc: { call: async () => ({ ok: true, value: { at: new Date().toISOString(), rows: [] } }) } },
  slots: {
    register: (meta, comp) => { registrations.set(meta.name, { meta, comp }); return {}; },
    inject: (slot, callback) => { callback(); },
  },
};

let moduleExports = null;
const loader = { load: (reg) => { moduleExports = reg.factory((spec) => { if (spec === 'react') return React; throw new Error('unexpected require ' + spec); }); } };
globalThis.window = { __ModuleLoader__: loader };
globalThis.document = documentStub;
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true });

new Function(src)();

if (!moduleExports) throw new Error('module did not execute');
moduleExports.apply(ctx);

const settings = registrations.get('settings.section');
const footer = registrations.get('sidebar.footer.action');
if (!settings) throw new Error('no settings.section registration captured');
if (!footer) throw new Error('no sidebar.footer.action registration captured');
if (footer.meta.id !== 'update-reminder') throw new Error('footer registration id mismatch: ' + footer.meta.id);

// Style lifecycle assertions (regression: style must stay mounted during runtime, removed only on dispose)
if (!styleEl.el) throw new Error('style element was never appended to head');
if (styleEl.removed) throw new Error('style element was removed immediately after apply — ctx.effect cleanup must return () => element.remove(), not run it');
if (styleEl.el.id !== 'dsh-update-checker-style') throw new Error('style element id mismatch: ' + styleEl.el.id);
if (!styleEl.el.textContent.includes('.dsh-uc-page')) throw new Error('style textContent missing page rules');
for (const required of ['.dsh-uc-reminder-btn', '.dsh-uc-reminder-panel', '.dsh-uc-row-update', '.dsh-uc-settings-card']) {
  if (!styleEl.el.textContent.includes(required)) throw new Error('style textContent missing ' + required);
}
for (const d of disposers) d();
if (!styleEl.removed) throw new Error('disposers did not remove the style element');
console.log('registered:', JSON.stringify([...registrations.values()].map((r) => ({ name: r.meta.name, id: r.meta.id, order: r.meta.order }))));

// text extractor
function toText(node, out = []) {
  if (node == null || node === false || node === true) return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const n of node) toText(n, out); return out; }
  if (typeof node === 'object' && node.type) {
    if (typeof node.type === 'function') { toText(node.type(node.props), out); return out; }
    toText(node.children, out);
  }
  return out;
}

const mockRows = [
  { name: 'dsh-update-checker', status: 'update', installed: '0.2.4', latest: '0.2.5', spec: '^0.2', description: '检查插件更新', error: null, kind: 'github', repoUrl: 'https://github.com/a/b', pageUrl: '', homepage: '', releasesSource: 'api', releases: [{ tag: 'v0.2.5', date: '2026-10-01', url: 'https://github.com/a/b/releases/v0.2.5', body: '## 修复\n- 中文内容 **加粗** `code`\n- 列表项' }] },
  { name: '@local/skills-manager', status: 'latest', installed: '0.1.0', latest: '0.1.0', spec: 'link:...', description: 'Skill manager', error: null, kind: 'file', repoUrl: '', pageUrl: '', homepage: '', releasesSource: '', releases: [] },
  { name: 'broken-pkg', status: 'error', installed: '?', latest: '?', spec: '', description: '', error: 'registry 503', kind: 'npm', repoUrl: '', pageUrl: '', homepage: '', releasesSource: 'jsdelivr', releases: [] },
];
const rpc = async () => ({ at: new Date().toISOString(), rows: mockRows, stats: { requests: 3, cacheHits: 1 } });

const Page = settings.comp;
const pageInject = settings.meta.inject();
const t = pageInject.t;

// Page state order: running, data, loadingCache, error, notice, filter, sortMode, openNames
const pageText = seedStates([false, { at: new Date().toISOString(), rows: mockRows, stats: { requests: 3, cacheHits: 1 } }, false, '', '', 'all', 'status', new Set()],
  () => toText(createElement(Page, { rpcCall: rpc, t, askAi: pageInject.askAi })).join(' | '));
console.log('--- RENDERED PAGE ---');
console.log(pageText);
console.log('--- CHECKS ---');
console.log('contains 插件更新:', pageText.includes('插件更新'));
console.log('contains update action 更新:', pageText.includes('更新'));
console.log('contains 展开全部 or collapse:', /展开|全部/.test(pageText));
console.log('contains garbled markers:', /[ÃÂ�]/.test(pageText));
if (!pageText.includes('插件更新')) throw new Error('page header missing');
if (!pageText.includes('更新')) throw new Error('page lost the update action label');
if (/[ÃÂ�]/.test(pageText)) throw new Error('page text has mojibake');

// --- Footer reminder entry -------------------------------------------------
const footerInject = footer.meta.inject();
console.log('footer inject keys:', Object.keys(footerInject).sort().join(','));
for (const key of ['askAi', 'rpcCall', 't']) {
  if (typeof footerInject[key] !== 'function') throw new Error(`footer inject missing ${key}`);
}
const Reminder = footer.comp;
const pendingPayload = {
  config: { enabled: true, intervalMinutes: 60 },
  visible: true,
  fingerprint: 'dsh-pocket@2.10.8',
  pending: [{ name: 'dsh-pocket', installed: '2.10.7', latest: '2.10.8', kind: 'npm', spec: '^2', repoUrl: '', pageUrl: '' }],
  lastCheckAt: new Date().toISOString(),
  lastError: null,
  running: false,
};

// No reminder state yet: the entry renders nothing, so the footer stays clean
// for users who never turn the feature on.
const emptyText = seedStates([null, false, null, false],
  () => toText(createElement(Reminder, { wide: true, ...footerInject })).join('')).trim();
if (emptyText !== '') throw new Error('footer entry must render nothing before reminder.state resolves, got: ' + JSON.stringify(emptyText));

// Collapsed entry: label + count.
const collapsed = seedStates([pendingPayload, false, null, false],
  () => toText(createElement(Reminder, { wide: true, ...footerInject })).join(' | '));
console.log('footer collapsed:', JSON.stringify(collapsed));
if (!collapsed.includes('插件更新')) throw new Error('footer entry missing its label');
if (!collapsed.includes('1')) throw new Error('footer entry missing the pending count');

// Open panel: plugin row, both ignore modes, and the manual check button.
const panel = seedStates([pendingPayload, true, { left: 12, bottom: 80 }, false],
  () => toText(createElement(Reminder, { wide: true, ...footerInject })).join(' | '));
console.log('footer panel:', JSON.stringify(panel));
for (const expected of ['dsh-pocket', '2.10.7', '2.10.8', '忽略本次提醒', '全部忽略', '立即检查', '更新']) {
  if (!panel.includes(expected)) throw new Error('footer panel missing ' + expected);
}

// Collapsed sidebar (rail): no label text, icon only.
const rail = seedStates([pendingPayload, false, null, false],
  () => toText(createElement(Reminder, { wide: false, ...footerInject })).join('')).trim();
if (rail !== '') throw new Error('rail entry must stay icon-only, got: ' + JSON.stringify(rail));

// PluginRow action: an update row offers the button, an up-to-date row does not.
const rowSource = src.slice(src.indexOf('function PluginRow'), src.indexOf('function Skeleton'));
if (!rowSource.includes('onAskAi')) throw new Error('PluginRow lost its onAskAi wiring');
if (!/isUpdate \? h\('button'/.test(rowSource)) throw new Error('PluginRow update button is not gated on status=update');
if (!rowSource.includes("t('updateAction')")) throw new Error('PluginRow update button label missing');
console.log('plugin row action: gated on update status, label =', t('updateAction'));

// --- Composer prefill ------------------------------------------------------
const internals = moduleExports._internals;
if (typeof internals.fillComposerDraft !== 'function') throw new Error('fillComposerDraft is not exported for testing');
let drafted = null;
const fakeCtx = {
  get: (name) => (name === 'uiSession'
    ? { adapter: { current: { getSnapshot: () => ({ props: { inputActions: { setDraft: (value) => { drafted = value; } } } }) } } }
    : undefined),
};
const outcome = internals.fillComposerDraft(fakeCtx, t('askAiPrompt').replace('%s', 'dsh-pocket'));
if (outcome !== 'draft') throw new Error('expected draft outcome, got ' + outcome);
if (drafted !== '帮我更新 dsh-pocket 插件即可') throw new Error('unexpected draft text: ' + drafted);
console.log('composer prefill:', JSON.stringify(drafted));

// The service is also reachable as ctx.uiSession when ctx.get is unavailable.
let draftedViaProperty = null;
const propertyCtx = {
  uiSession: { adapter: { current: { getSnapshot: () => ({ props: { inputActions: { setDraft: (value) => { draftedViaProperty = value; } } } }) } } },
};
if (internals.fillComposerDraft(propertyCtx, 'x') !== 'draft' || draftedViaProperty !== 'x') {
  throw new Error('ctx.uiSession fallback did not reach setDraft');
}

// No session: falls back to the clipboard when available, otherwise reports none.
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN', clipboard: { writeText: async () => {} } }, configurable: true });
const copied = internals.fillComposerDraft({ get: () => undefined }, '帮我更新 dsh-pocket 插件即可');
if (copied !== 'clipboard') throw new Error('expected clipboard fallback, got ' + copied);
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true });
const nothing = internals.fillComposerDraft({ get: () => undefined }, 'x');
if (nothing !== 'none') throw new Error('expected none outcome, got ' + nothing);
console.log('prefill fallbacks: clipboard + none ok');

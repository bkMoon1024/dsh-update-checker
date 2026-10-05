// Offline render harness: execute the client module, capture Page, render to text.
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');

// Minimal React stub
function createElement(type, props, ...children) {
  return { type, props: props ?? {}, children: children.flat(Infinity) };
}
const React = { createElement, useState: () => [null, () => {}], useEffect: () => {}, useMemo: (fn) => fn() };

// DOM stubs for apply()
const styleEl = { el: null, removed: false };
const documentStub = {
  getElementById: () => null,
  createElement: () => {
    const el = { id: '', textContent: '', style: {}, remove() { styleEl.removed = true; } };
    return el;
  },
  head: { appendChild: (el) => { styleEl.el = el; styleEl.removed = false; } },
};

let registration = null;
const disposers = [];
const ctx = {
  locale: { bind: () => () => undefined, register: () => () => {} },
  // Faithful cordis ctx.effect: run fn now; a returned function becomes the dispose hook.
  effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); return d; },
  connection: { rpc: { call: async () => ({ ok: true, value: { at: new Date().toISOString(), rows: [] } }) } },
  slots: {
    register: (meta, comp) => { registration = { meta, comp }; return {}; },
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
if (!registration) throw new Error('no settings.section registration captured');
// Style lifecycle assertions (regression: style must stay mounted during runtime, removed only on dispose)
if (!styleEl.el) throw new Error('style element was never appended to head');
if (styleEl.removed) throw new Error('style element was removed immediately after apply — ctx.effect cleanup must return () => element.remove(), not run it');
if (styleEl.el.id !== 'dsh-update-checker-style') throw new Error('style element id mismatch: ' + styleEl.el.id);
if (!styleEl.el.textContent.includes('.dsh-uc-page')) throw new Error('style textContent missing page rules');
for (const d of disposers) d();
if (!styleEl.removed) throw new Error('disposers did not remove the style element');
console.log('registered:', JSON.stringify({ name: registration.meta.name, id: registration.meta.id, order: registration.meta.order, label: registration.meta.label() }));

// Render with mock data exercising every branch
const dict = {};
const mockRows = [
  { name: 'dsh-update-checker', status: 'update', installed: '0.2.4', latest: '0.2.5', spec: '^0.2', description: '检查插件更新', error: null, kind: 'github', repoUrl: 'https://github.com/a/b', pageUrl: '', homepage: '', releasesSource: 'api', releases: [{ tag: 'v0.2.5', date: '2026-10-01', url: 'https://github.com/a/b/releases/v0.2.5', body: '## 修复\n- 中文内容 **加粗** `code`\n- 列表项' }] },
  { name: '@local/skills-manager', status: 'latest', installed: '0.1.0', latest: '0.1.0', spec: 'link:...', description: 'Skill manager', error: null, kind: 'file', repoUrl: '', pageUrl: '', homepage: '', releasesSource: '', releases: [] },
  { name: 'broken-pkg', status: 'error', installed: '?', latest: '?', spec: '', description: '', error: 'registry 503', kind: 'npm', repoUrl: '', pageUrl: '', homepage: '', releasesSource: 'jsdelivr', releases: [] },
];
const rpc = async (ep) => ({ at: new Date().toISOString(), rows: mockRows });

// text extractor
function toText(node, depth = 0, out = []) {
  if (node == null || node === false || node === true) return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const n of node) toText(n, depth, out); return out; }
  if (typeof node === 'object' && node.type) {
    if (typeof node.type === 'function') {
      // component: call with props (hooks are stubs)
      toText(node.type(node.props), depth, out);
      return out;
    }
    toText(node.children, depth + 1, out);
  }
  return out;
}

const Page = registration.comp;
const t = registration.meta.inject().t;
const tree = createElement(Page, { rpcCall: rpc, t });
const text = toText(tree).join(' | ');
console.log('--- RENDERED TEXT ---');
console.log(text);
console.log('--- CHECKS ---');
console.log('contains 插件更新:', text.includes('插件更新'));
console.log('contains 展开全部 or collapse:', /展开|全部/.test(text));
console.log('contains garbled markers:', /[ÃÂ�]/.test(text));

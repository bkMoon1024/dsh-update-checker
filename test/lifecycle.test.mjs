/**
 * Regression test for the 0.3.2 host-crash chain (2026-10-18).
 *
 * Root cause, in order:
 *   1. `apply()` wrote `ctx.reminderScheduler = scheduler`. cordis 4 rejects
 *      writes to properties that were never declared via `ctx.provide()`
 *      ("cannot set property ... without provide"), so activation threw;
 *   2. the reminder timer had already been armed, while the disposer meant to
 *      clear it was registered further down — it never ran;
 *   3. the orphaned timer later read `ctx.profileContext` on the dead fiber,
 *      and the resulting rejection escaped a setTimeout callback, which the
 *      host turns into a fatal load failure and `exit 1`.
 *
 * This test boots a real @deepseek-ai/cordis Context (same checkout the
 * existing harness uses, overridable via DSH_CORDIS_PATH), activates the
 * plugin, then makes its context inactive by removing the `profileContext`
 * service and waits for the reminder tick. Activation must succeed and no
 * rejection may escape.
 *
 * Run: node test/lifecycle.test.mjs
 * Skips (exit 0) when the cordis checkout is unavailable, so it stays usable
 * outside this machine.
 */
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const CORDIS_URL = process.env.DSH_CORDIS_PATH
  || 'file:///D:/dsh%20work/_dsh_src/dsh/node_modules/@deepseek-ai/cordis/lib/index.js';
const PLUGIN_URL = new URL('../index.js', import.meta.url).href;

let Context;
try {
  ({ Context } = await import(CORDIS_URL));
} catch {
  console.log(`SKIP  cordis checkout not found at ${CORDIS_URL} (set DSH_CORDIS_PATH to run)`);
  process.exit(0);
}

// Compress the 30s first-tick delay so the crash path is observable in <1s.
const realSetTimeout = globalThis.setTimeout;
const scheduledDelays = [];
globalThis.setTimeout = (fn, ms, ...rest) => {
  if (typeof ms === 'number' && ms >= 1_000) {
    scheduledDelays.push(ms);
    return realSetTimeout(fn, 40, ...rest);
  }
  return realSetTimeout(fn, ms, ...rest);
};

// An escaping rejection is what killed the host; record instead of dying.
const escaped = [];
process.on('unhandledRejection', (error) => escaped.push(error));
process.on('uncaughtException', (error) => escaped.push(error));

const HOME_DIR = await mkdtemp(path.join(os.tmpdir(), 'dsh-uc-life-'));
const plugin = await import(PLUGIN_URL);

const routes = [];
const webServer = {
  register(route) {
    routes.push(route);
    return () => {
      const index = routes.indexOf(route);
      if (index >= 0) routes.splice(index, 1);
    };
  },
};
const connection = { requestRejection: () => undefined };

const ctx = new Context();
ctx.provide('webServer', webServer);
ctx.provide('connection', connection);

// profileContext comes from its own fiber so it can be taken away later.
const provider = await ctx.plugin({
  name: 'test-profile-context',
  apply(providerCtx) {
    providerCtx.provide('profileContext', {
      name: 'desktop',
      dir: path.join(HOME_DIR, 'profile'),
      home: HOME_DIR,
    });
  },
});

const results = [];
function check(name, condition, detail = '') {
  results.push(!!condition);
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

let fiber = null;
let applyError = null;
try {
  fiber = await ctx.plugin(plugin);
} catch (error) {
  applyError = error;
}
for (let i = 0; i < 50 && !routes.some((r) => r.path === '/dsh-update-checker'); i++) await sleep(20);

check(
  'plugin activates on cordis 4 (no ctx property assignment)',
  !applyError && routes.some((r) => r.path === '/dsh-update-checker'),
  applyError ? String(applyError?.message ?? applyError) : '',
);
check(
  'reminder timer armed at activation',
  scheduledDelays.some((ms) => ms >= 30_000),
  `delays=${JSON.stringify(scheduledDelays)}`,
);

// Make the plugin's context inactive the same way a torn-down fiber does:
// the service it injects disappears while its fiber still exists.
await provider.dispose();
await sleep(300);

check(
  'no rejection escapes after the context goes inactive',
  escaped.length === 0,
  escaped.map((error) => String(error?.stack ?? error).split('\n').slice(0, 2).join(' | ')).join(' ;; '),
);

let disposeError = null;
try {
  await fiber?.dispose();
} catch (error) {
  disposeError = error;
}
check('fiber disposes cleanly', !disposeError, disposeError ? String(disposeError?.message ?? disposeError) : '');
check('web route removed on dispose', !routes.some((r) => r.path === '/dsh-update-checker'));

try { await ctx.dispose(); } catch { /* already torn down */ }
globalThis.setTimeout = realSetTimeout;
await rm(HOME_DIR, { recursive: true, force: true });

const failed = results.filter((result) => !result).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

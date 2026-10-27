// Source guards for the reminder panel's "check now" button. The panel is a
// hook-based component registered into a host slot, so it cannot be rendered
// offline; these assertions pin the wiring that makes a click observable:
// a forced scan, a visible elapsed time, and a reset that cannot wedge.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const client = readFileSync(join(here, '..', 'client', 'client.js'), 'utf8');
const index = readFileSync(join(here, '..', 'index.js'), 'utf8');

const results = [];
function check(name, condition, detail = '') {
  results.push(!!condition);
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// 1. the panel asks for a fresh scan instead of taking the 90s cache
check('panel sends force:true', /rpcCall\('check\.run', \{ force: true \}\)/.test(client));
check('settings page sends force:true',
  (client.match(/rpcCall\('check\.run', \{ force: true \}\)/g) ?? []).length === 2,
  `count=${(client.match(/rpcCall\('check\.run', \{ force: true \}\)/g) ?? []).length}`);
check('server honours the force flag', /const force = payload\?\.force === true;/.test(index));
check('server applies a burst floor to forced re-checks',
  /const freshMs = force \? FORCE_FLOOR_MS : FRESH_WINDOW_MS;/.test(index));

// 2. the button cannot stay disabled: elapsed ticker + watchdog + reset
const checkNow = client.slice(client.indexOf('const checkNow = async () => {'));
const body = checkNow.slice(0, checkNow.indexOf('\n      };'));
check('elapsed seconds are rendered while busy', /setElapsed\(Math\.round\(/.test(body));
check('watchdog clears busy', /const watchdog = setTimeout\(\(\) => \{[\s\S]*?setBusy\(false\);/.test(body));
check('watchdog is cancelled on the normal path', /clearTimeout\(watchdog\);/.test(body));
check('ticker is cancelled on the normal path', /clearInterval\(ticker\);/.test(body));
check('late run cannot clobber a newer one', /activeRunRef\.current !== runToken\) return;/.test(body));
check('unmount clears both timers', /return \(\) => \{\s*\n\s*mountedRef\.current = false;[\s\S]*?clearInterval\(tickerRef\.current\)[\s\S]*?clearTimeout\(watchdogRef\.current\)/.test(client));
check('late responses cannot set state after unmount', /if \(!mountedRef\.current\) return;/.test(body));
check('busy is reset after the call', /setNote\(failure \|\| t\('reminderCheckedNow'\)\);/.test(body));
check('button label shows elapsed time',
  /t\('reminderCheckingElapsed'\)\.replace\('%ds', String\(elapsed\)\)/.test(client));

// 3. feedback line: last check time or the outcome of this click
check('status line is rendered', /className: 'dsh-uc-reminder-panel-note', role: 'status'/.test(client));
check('status line falls back to the last check time', /reminderLastAt'\)\.replace\('%s', formatRelative\(state\.lastCheckAt/.test(client));

// 4. both languages carry the new keys
for (const key of ['reminderCheckingElapsed', 'reminderCheckFailed', 'reminderCheckTimeout', 'reminderCheckedNow']) {
  const hits = (client.match(new RegExp(`${key}:`, 'g')) ?? []).length;
  check(`i18n key ${key} in zh+en`, hits === 2, `count=${hits}`);
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exitCode = 1;

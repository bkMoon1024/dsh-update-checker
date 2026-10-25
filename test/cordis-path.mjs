/**
 * Resolve the @deepseek-ai/cordis entry used by the harness-backed tests.
 *
 * There is deliberately NO built-in absolute default. A hardcoded developer
 * path (D:/dsh work/_dsh_src/...) used to live in this file, so on every other
 * machine the import threw and the test printed SKIP while exiting 0 — the
 * suite looked green although lifecycle and reminder-scheduler never ran.
 *
 * Resolution order:
 *   1. DSH_CORDIS_PATH (explicit override, unchanged)
 *   2. ordinary module resolution from this repository
 *   3. null — callers must print an explicit "did not run" line
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export function resolveCordisUrl() {
  const fromEnv = process.env.DSH_CORDIS_PATH;
  if (fromEnv) return fromEnv;
  try {
    const require = createRequire(import.meta.url);
    return pathToFileURL(require.resolve('@deepseek-ai/cordis')).href;
  } catch {
    return null;
  }
}

export const CORDIS_URL = resolveCordisUrl();

export const CORDIS_SKIP_HINT =
  'SKIP (not run): @deepseek-ai/cordis is not resolvable from this checkout. '
  + 'Set DSH_CORDIS_PATH to a cordis lib/index.js to actually run this test. '
  + 'This is a skip, not a pass.';

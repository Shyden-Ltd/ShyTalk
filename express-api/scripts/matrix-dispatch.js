/**
 * matrix-dispatch.js
 *
 * Runs a journey scenario across the per-target browser matrix
 * (`scripts/browser-allowlist.js`) — one dispatch per browser cell,
 * results aggregated.
 *
 * Used by manual-qa-runner.js when `--matrix` is passed. The runner
 * provides the per-cell dispatch callback; this module owns the
 * iteration + result aggregation. Extracted to its own module so unit
 * tests can pin matrix behaviour without spawning the runner subprocess.
 *
 * Per-cell outcomes:
 *   - 'pass'     — dispatch returned truthy
 *   - 'fail'     — dispatch returned falsy or threw a non-init error
 *   - 'skip'     — dispatch threw an "init" error (driver couldn't
 *                  bootstrap; usually means the device or browser app
 *                  isn't connected/installed). The matrix continues
 *                  rather than aborting because the operator wants the
 *                  other cells exercised even when one device is offline.
 *
 * An "init" error is signalled by the dispatch callback throwing an
 * Error with `err.code === 'DRIVER_INIT_FAILED'` OR `err.message`
 * containing one of the actionable strings the drivers emit
 * (`no Android device attached`, `no connected iPhone`,
 * `WDA_TEAM_ID env var is required`, `adb not found`,
 * `Appium /session failed`, `connectOverCDP`). Tests pin the matcher.
 */

const INIT_ERROR_SIGNATURES = [
  // Android-cdp-helpers
  /\[android-cdp-helpers\]/i,
  /adb not found/i,
  /no Android device attached/i,
  /Android device is unauthorised/i,
  /adb forward failed/i,
  // Mobile chrome/samsung/edge — connectOverCDP failure
  /connectOverCDP\(http/i,
  /0 contexts/i,
  // iOS appium / Safari / WebKit wrappers
  /no connected iPhone found/i,
  /WDA_TEAM_ID env var is required/i,
  /Appium \/session failed/i,
  /no WEBVIEW_ context/i,
  /browser ".*" is not supported/i,
];

function isInitError(err) {
  if (!err) return false;
  if (err.code === 'DRIVER_INIT_FAILED') return true;
  const message = String(err.message || err);
  return INIT_ERROR_SIGNATURES.some((rx) => rx.test(message));
}

/**
 * Runs the matrix and returns aggregated results.
 *
 *   const result = await runMatrix({
 *     browsers: ['chromium', 'mobile-chrome-android'],
 *     dispatchOne: async ({ browser }) => { ...; return true; },
 *   });
 *   // result.summary === '2 pass / 0 fail / 0 skip'
 *   // result.cells === [{ browser: 'chromium', outcome: 'pass', ... }, ...]
 *
 * Returns:
 *   {
 *     cells: Array<{ browser, outcome, error?, durationMs }>,
 *     totals: { pass, fail, skip },
 *     summary: string,        // e.g. "5 pass / 2 fail / 1 skip"
 *     ok: boolean,            // true iff 0 fails (skips don't count)
 *   }
 *
 * `failFast` (default false) — if true, stops on the first 'fail'
 * outcome. Skips continue regardless because they mean "device not
 * connected" not "test failure".
 *
 * `onCellStart` / `onCellEnd` (optional) — callbacks for progress
 * reporting (operator-facing log lines from the runner).
 *
 * `nowMs` (test-only) — clock injection for deterministic durations.
 */
async function runMatrix({
  browsers,
  dispatchOne,
  failFast = false,
  onCellStart,
  onCellEnd,
  nowMs = () => Date.now(),
} = {}) {
  if (!Array.isArray(browsers)) {
    throw new Error('runMatrix: `browsers` must be an array of browser slugs');
  }
  if (typeof dispatchOne !== 'function') {
    throw new Error('runMatrix: `dispatchOne` callback is required');
  }
  if (browsers.length === 0) {
    throw new Error(
      'runMatrix: `browsers` is empty — check the target allowlist or omit --matrix.',
    );
  }

  const cells = [];
  let stopped = false;

  for (const browser of browsers) {
    if (stopped) {
      cells.push({ browser, outcome: 'skip', error: 'matrix aborted by failFast', durationMs: 0 });
      continue;
    }
    if (typeof onCellStart === 'function') onCellStart({ browser });
    const t0 = nowMs();
    let outcome;
    let error;
    try {
      const result = await dispatchOne({ browser });
      outcome = result ? 'pass' : 'fail';
    } catch (e) {
      if (isInitError(e)) {
        outcome = 'skip';
        error = e.message;
      } else {
        outcome = 'fail';
        error = e.message;
      }
    }
    const durationMs = Math.max(0, nowMs() - t0);
    const cell = { browser, outcome, durationMs };
    if (error) cell.error = error;
    cells.push(cell);
    if (typeof onCellEnd === 'function') onCellEnd(cell);
    if (failFast && outcome === 'fail') stopped = true;
  }

  const totals = cells.reduce(
    (acc, c) => {
      acc[c.outcome] = (acc[c.outcome] || 0) + 1;
      return acc;
    },
    { pass: 0, fail: 0, skip: 0 },
  );

  const summary = `${totals.pass} pass / ${totals.fail} fail / ${totals.skip} skip`;
  return { cells, totals, summary, ok: totals.fail === 0 };
}

/**
 * Render the matrix result as a human-readable text table for the
 * runner's end-of-run log line. Compact format:
 *
 *   ┌─────────────────────────┬────────┬──────────┐
 *   │ browser                  │ outcome │ ms      │
 *   ├─────────────────────────┼────────┼──────────┤
 *   │ chromium                 │ pass    │     842 │
 *   │ mobile-chrome-android    │ skip    │       0 │
 *   └─────────────────────────┴────────┴──────────┘
 *   Matrix: 1 pass / 0 fail / 1 skip
 *
 * Returns a multi-line string. Callers print it directly (no embedded
 * ANSI / colour — matches the runner's plain-text log conventions).
 */
function formatMatrixResult({ cells, summary }) {
  const lines = [];
  const widest = Math.max(7, ...cells.map((c) => c.browser.length));
  const sep = `${'-'.repeat(widest + 2)}+--------+----------`;
  lines.push(sep);
  lines.push(`${'browser'.padEnd(widest + 2)}| outcome | ms`);
  lines.push(sep);
  for (const c of cells) {
    const ms = String(c.durationMs).padStart(8);
    lines.push(`${c.browser.padEnd(widest + 2)}| ${c.outcome.padEnd(7)}|${ms}`);
  }
  lines.push(sep);
  lines.push(`Matrix: ${summary}`);
  return lines.join('\n');
}

module.exports = {
  INIT_ERROR_SIGNATURES,
  isInitError,
  runMatrix,
  formatMatrixResult,
};

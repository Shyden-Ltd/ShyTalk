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
  // bailAfter — stop the matrix after N failures (or timeouts —
  // counted the same way failFast counts them). 0 = no bail (run all).
  // Strictly additive to failFast: both gates checked; whichever
  // triggers first stops the matrix. failFast=true is equivalent in
  // effect to bailAfter=1, but kept as a distinct flag for backward
  // compatibility and operator readability.
  bailAfter = 0,
  // retry — per-cell in-run retry on fail/timeout. 0 = no retry
  // (backward compat). N > 0 = up to N retries (so N+1 total attempts
  // per cell). Skip outcomes are NEVER retried (skip = "no device
  // connected", retrying won't help). failFast / bailAfter count
  // FINAL failures only — interim failures that recover via retry
  // do NOT trigger the gate. Cross-run retry-failed (--retry-failed
  // <report.json>) is independent and operates on a PRIOR run.
  retry = 0,
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
  let failureCount = 0;
  // First-fire wins: preserves the original "matrix aborted by failFast"
  // sentinel when failFast triggers, and surfaces the bail count
  // explicitly when --bail triggers. Operators reading per-cell
  // skip-error logs see which gate stopped the run.
  let abortReason = '';

  for (const browser of browsers) {
    if (stopped) {
      cells.push({ browser, outcome: 'skip', error: abortReason, durationMs: 0 });
      continue;
    }
    if (typeof onCellStart === 'function') onCellStart({ browser });
    const t0 = nowMs();
    let outcome;
    let error;
    let attempts = 0;
    const maxAttempts = retry + 1;
    // Per-cell retry loop: try once + up to `retry` more times on
    // fail/timeout. Pass or skip break out immediately (skip = no
    // device, not a flake). Error is re-assigned each attempt so the
    // final cell.error reflects the last attempt's message.
    while (attempts < maxAttempts) {
      attempts++;
      // outcome + error are reassigned by try/catch below in every
      // code path, so no defensive reset needed (ESLint no-useless-
      // assignment would flag it). The previous iteration's values are
      // immediately overwritten; the final iteration's values are what
      // gets recorded in `cell` after the loop.
      error = undefined;
      try {
        const result = await dispatchOne({ browser });
        outcome = result ? 'pass' : 'fail';
      } catch (e) {
        // 'CELL_TIMEOUT' is set by the runner's spawnSync wrapper when
        // the per-cell process exceeded --cell-timeout. Surfaces as its
        // own outcome (NOT 'fail') so the operator can distinguish hangs
        // from assertion failures in the summary.
        if (e && e.code === 'CELL_TIMEOUT') {
          outcome = 'timeout';
          error = e.message;
        } else if (isInitError(e)) {
          outcome = 'skip';
          error = e.message;
        } else {
          outcome = 'fail';
          error = e.message;
        }
      }
      // Pass or skip → done, no retry needed.
      if (outcome === 'pass' || outcome === 'skip') break;
    }
    const durationMs = Math.max(0, nowMs() - t0);
    const cell = { browser, outcome, durationMs };
    // Error preserved only on non-pass outcomes — a passing retry
    // clears any prior-attempt errors so the report doesn't false-alarm.
    if (error && outcome !== 'pass') cell.error = error;
    // attempts/retries recorded only when > 1 — preserves backward
    // compatibility with the field-shape pre-retry (existing tests don't
    // expect attempts/retries to exist on single-attempt cells).
    if (attempts > 1) {
      cell.attempts = attempts;
      cell.retries = attempts - 1;
    }
    cells.push(cell);
    if (typeof onCellEnd === 'function') onCellEnd(cell);
    // Increment failure count first — both failFast and bailAfter
    // gates use the same definition (real failure or hang, not skip).
    if (outcome === 'fail' || outcome === 'timeout') failureCount++;
    // failFast aborts on real failures (timeouts included — a hang
    // can also mask other cells from running in time, so fail-fast on
    // timeout is the safer default).
    if (failFast && (outcome === 'fail' || outcome === 'timeout')) {
      stopped = true;
      if (!abortReason) abortReason = 'matrix aborted by failFast';
    }
    // bailAfter aborts after the configured failure count is hit.
    // bailAfter=1 is equivalent in effect to failFast=true; both can
    // be set together with no conflict.
    if (bailAfter > 0 && failureCount >= bailAfter) {
      stopped = true;
      if (!abortReason) {
        abortReason = `matrix aborted by --bail ${bailAfter} after ${failureCount} failure(s)`;
      }
    }
  }

  const totals = cells.reduce(
    (acc, c) => {
      acc[c.outcome] = (acc[c.outcome] || 0) + 1;
      return acc;
    },
    { pass: 0, fail: 0, skip: 0, timeout: 0 },
  );

  // Summary string: 3-segment shape when no timeouts (preserves the
  // pre-timeout-feature format for existing CI consumers); 4-segment
  // when any timeout occurred so the operator sees it at a glance.
  const summary =
    totals.timeout > 0
      ? `${totals.pass} pass / ${totals.fail} fail / ${totals.skip} skip / ${totals.timeout} timeout`
      : `${totals.pass} pass / ${totals.fail} fail / ${totals.skip} skip`;
  // ok is false when there's any non-skip failure type — fail OR
  // timeout. A pure-skip run (no devices connected) still returns ok.
  return { cells, totals, summary, ok: totals.fail === 0 && totals.timeout === 0 };
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

/**
 * Render the matrix result as JSON. Same shape as runMatrix() returns
 * plus a top-level `format: 'matrix-v1'` discriminator + ISO timestamp,
 * so CI dashboards can identify the schema version.
 *
 *   {
 *     format: 'matrix-v1',
 *     generatedAt: '2026-05-30T18:42:00.000Z',
 *     summary: '...',
 *     ok: true,
 *     totals: { pass, fail, skip },
 *     cells: [{ browser, outcome, durationMs, error? }],
 *   }
 *
 * `nowIso` is injectable for tests (deterministic timestamps).
 */
function formatMatrixResultJson(result, { nowIso = () => new Date().toISOString() } = {}) {
  const payload = {
    format: 'matrix-v1',
    generatedAt: nowIso(),
    summary: result.summary,
    ok: result.ok,
    totals: result.totals,
    cells: result.cells,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Render the matrix result as JUnit XML — the canonical format CI
 * dashboards (Jenkins / GitHub Actions test reporter / GitLab /
 * CircleCI / etc.) consume.
 *
 * One <testsuite> per matrix run, one <testcase> per cell. `outcome`
 * maps to JUnit semantics:
 *   - 'pass'  → no failure/skipped tag
 *   - 'fail'  → <failure message="...">
 *   - 'skip'  → <skipped message="...">
 *
 * Special chars in browser slugs / error messages are XML-escaped so
 * the output is well-formed. Suite-level `tests`/`failures`/`skipped`
 * counts pinned for reporter compatibility.
 *
 * `nowIso` injectable for tests.
 */
function formatMatrixResultJunit(result, { nowIso = () => new Date().toISOString() } = {}) {
  const escape = (s) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  const totalMs = result.cells.reduce((acc, c) => acc + (c.durationMs || 0), 0);
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>'];
  lines.push(
    // Timeouts count as failures for the JUnit suite-level total (they
    // render as <failure type="MatrixCellTimeout"/> per-testcase) — so
    // CI dashboards' overall pass/fail signal treats them as red.
    `<testsuite name="qa-matrix" tests="${result.cells.length}" failures="${result.totals.fail + (result.totals.timeout || 0)}" skipped="${result.totals.skip}" time="${(totalMs / 1000).toFixed(3)}" timestamp="${escape(nowIso())}">`,
  );
  for (const c of result.cells) {
    const timeSec = ((c.durationMs || 0) / 1000).toFixed(3);
    lines.push(`  <testcase classname="qa-matrix" name="${escape(c.browser)}" time="${timeSec}">`);
    if (c.outcome === 'fail') {
      lines.push(
        `    <failure message="${escape(c.error || 'matrix cell failed')}" type="MatrixCellFailure"/>`,
      );
    } else if (c.outcome === 'timeout') {
      // Timeouts map to <failure> (not <skipped>) in JUnit semantics —
      // they're a deterministic failure, not a "we didn't run it". The
      // `type` attribute distinguishes them from assertion failures so
      // dashboards can colour-code or group separately.
      lines.push(
        `    <failure message="${escape(c.error || 'matrix cell timed out')}" type="MatrixCellTimeout"/>`,
      );
    } else if (c.outcome === 'skip') {
      lines.push(`    <skipped message="${escape(c.error || 'matrix cell skipped')}"/>`);
    }
    lines.push('  </testcase>');
  }
  lines.push('</testsuite>');
  return lines.join('\n');
}

module.exports = {
  INIT_ERROR_SIGNATURES,
  isInitError,
  runMatrix,
  formatMatrixResult,
  formatMatrixResultJson,
  formatMatrixResultJunit,
};

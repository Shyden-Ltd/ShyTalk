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
 * (`no Android device attached`, `no physical iPhone found`,
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
  // iOS appium / Safari / WebKit wrappers. These drivers now ALSO set
  // err.code = 'DRIVER_INIT_FAILED' (checked first in isInitError), so this string is
  // defense-in-depth — keep it matching the drivers' actual "no physical iPhone found".
  /no physical iPhone found/i,
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

// Reserved single-cell exit code for "a driver could not bootstrap"
// (no device / browser app / env var). 0 = pass, 1 = findings, 2 =
// runtime error are all taken by the runner's documented contract; the
// per-cell dispatcher translates THIS code back into a
// DRIVER_INIT_FAILED throw so a real `--matrix` run classifies the
// cell 'skip' instead of collapsing it into 'fail' (SHY-0095 inc-2).
const EXIT_DRIVER_INIT_FAILED = 3;

// SHY-0255. Success used to be the runner's DEFAULT exit state: main()
// ends in an explicit `process.exit(findings ? 1 : 0)`, but nothing
// guaranteed that line was reached. When an awaited driver call never
// settled — a device that went away mid-run — the event loop drained and
// Node exited 0, because that is what Node does. The cell dispatcher
// classifies on `code === 0`, so "the process stopped existing" and
// "every journey passed" produced the same record. Run
// 20260730-005554-local reported `firefox/webkit/edge: pass` for three
// cells that had each printed 12 FAIL scenarios and then nothing for two
// hours while the host slept.
//
// These two codes make the absence of a result impossible to mistake for
// a result. Both are outside the 0/1/2/3 contract, so the matrix
// classifies them 'fail' — deliberately NOT EXIT_DRIVER_INIT_FAILED,
// which would grant the 'skip' amnesty to a cell that genuinely died.
const EXIT_RUNNER_INCOMPLETE = 4;
const EXIT_RUNNER_NO_FEATURES = 5;

/**
 * Arms the "a run that did not finish is not a pass" guard on a process.
 *
 * Seeds the exit code with EXIT_RUNNER_INCOMPLETE so falling off the end
 * of main() can never be 0, and reports the cause on drain. Every genuine
 * completion path already calls process.exit() explicitly, which
 * overrides the seed — so this is a FLOOR under abnormal termination, not
 * a ceiling on success.
 *
 * `beforeExit` fires only when the loop drains with nothing left to do —
 * never after an explicit process.exit() — so it is exactly the "we
 * stopped without deciding anything" signal.
 */
function installIncompleteRunGuard(proc = process) {
  proc.exitCode = EXIT_RUNNER_INCOMPLETE;
  proc.once('beforeExit', () => {
    if (proc.exitCode !== EXIT_RUNNER_INCOMPLETE) return;
    // process.stderr.write, not console.error — the repo convention for
    // diagnostics emitted from a loaded module rather than a CLI main.
    proc.stderr.write(
      'RUNNER_INCOMPLETE the run ended without finishing — the event loop drained ' +
        'while work was still pending. The usual cause is a driver call that never ' +
        'settled because its device went away mid-run (USB suspended, host slept, ' +
        'Appium or adb died). Exiting ' +
        EXIT_RUNNER_INCOMPLETE +
        ' so this cell is recorded as a failure rather than a pass.\n',
    );
  });
}

/**
 * Classifies a main() crash into the exit code + stderr label the
 * single-cell process should die with. Init failures get the reserved
 * exit code; everything else keeps the historical RUNNER_CRASH exit 2.
 */
function classifyCrashExit(err) {
  if (isInitError(err)) {
    return { exitCode: EXIT_DRIVER_INIT_FAILED, label: 'DRIVER_INIT_FAILED' };
  }
  return { exitCode: 2, label: 'RUNNER_CRASH' };
}

/**
 * Maps a browser slug to the physical resource its cell contends for, so the parallel
 * driver can serialise same-resource cells while running different resources concurrently.
 * The matrix slug shape is `<browser>-<platform>` (e.g. `mobile-safari-ios`,
 * `mobile-chrome-android`) plus the native `ios`/`android` cells and bare desktop browsers.
 *   - anything containing `android` → the one Android device
 *   - anything containing `ios`     → the one iPhone
 *   - everything else (chromium/firefox/webkit/edge) → the Mac (desktop browsers)
 * Two iOS cells therefore never drive the same iPhone at once, while iOS + Android + Mac
 * all progress in parallel.
 */
function defaultResourceKey(browser) {
  const b = String(browser).toLowerCase();
  if (b.includes('android')) return 'android';
  if (b.includes('ios')) return 'iphone';
  return 'mac';
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
  // parallel — when true, cells are dispatched PER-DEVICE-SERIAL, CROSS-DEVICE-PARALLEL:
  // grouped by `resourceKey(browser)`, each group's cells run sequentially (so two cells
  // never drive the same iPhone/Android at once) while all groups run concurrently (iOS +
  // Android + Mac progress simultaneously). Default false = the original strict-sequential
  // behaviour (backward-compatible; every existing test omits it). failFast/bailAfter still
  // apply: once a gate trips, no NEW cell is dispatched, but cells already in flight in
  // other groups finish.
  parallel = false,
  // resourceKey — maps a browser slug to the physical resource its cell contends for.
  resourceKey = defaultResourceKey,
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

  let stopped = false;
  let failureCount = 0;
  // First-fire wins: preserves the original "matrix aborted by failFast"
  // sentinel when failFast triggers, and surfaces the bail count
  // explicitly when --bail triggers. Operators reading per-cell
  // skip-error logs see which gate stopped the run.
  let abortReason = '';

  // Runs ONE cell (onCellStart → retry loop → cell record → onCellEnd) and returns it.
  // Pure per-cell work; the shared failFast/bailAfter gates are applied by the caller via
  // `applyGates` after each cell, so the sequential and parallel drivers below share
  // identical outcome semantics.
  async function runOneCell(browser) {
    if (typeof onCellStart === 'function') onCellStart({ browser });
    const t0 = nowMs();
    let outcome;
    let error;
    let attempts = 0;
    const maxAttempts = retry + 1;
    // Per-cell retry loop: try once + up to `retry` more times on fail/timeout. Pass or
    // skip break out immediately (skip = no device, not a flake).
    while (attempts < maxAttempts) {
      attempts++;
      error = undefined;
      try {
        const result = await dispatchOne({ browser });
        outcome = result ? 'pass' : 'fail';
      } catch (e) {
        // 'CELL_TIMEOUT' → 'timeout' (distinct from 'fail' so hangs are visible);
        // DRIVER_INIT_FAILED / init signatures → 'skip' (no device); else → 'fail'.
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
      if (outcome === 'pass' || outcome === 'skip') break;
    }
    const durationMs = Math.max(0, nowMs() - t0);
    const cell = { browser, outcome, durationMs };
    // Error preserved only on non-pass outcomes — a passing retry clears prior-attempt
    // errors so the report doesn't false-alarm.
    if (error && outcome !== 'pass') cell.error = error;
    // attempts/retries recorded only when > 1 — preserves the pre-retry field shape.
    if (attempts > 1) {
      cell.attempts = attempts;
      cell.retries = attempts - 1;
    }
    if (typeof onCellEnd === 'function') onCellEnd(cell);
    return cell;
  }

  // Applies the failFast/bailAfter gates after a cell completes. Single-threaded JS keeps
  // the shared-counter updates race-free even under the parallel driver (no await between
  // the read and the write here).
  function applyGates(cell) {
    if (cell.outcome === 'fail' || cell.outcome === 'timeout') failureCount++;
    if (failFast && (cell.outcome === 'fail' || cell.outcome === 'timeout')) {
      stopped = true;
      if (!abortReason) abortReason = 'matrix aborted by failFast';
    }
    if (bailAfter > 0 && failureCount >= bailAfter) {
      stopped = true;
      if (!abortReason) {
        abortReason = `matrix aborted by --bail ${bailAfter} after ${failureCount} failure(s)`;
      }
    }
  }

  const skipCell = (browser) => ({ browser, outcome: 'skip', error: abortReason, durationMs: 0 });

  let cells;
  if (!parallel) {
    // Strict-sequential (original behaviour): one cell at a time, in order.
    cells = [];
    for (const browser of browsers) {
      if (stopped) {
        cells.push(skipCell(browser));
        continue;
      }
      const cell = await runOneCell(browser);
      cells.push(cell);
      applyGates(cell);
    }
  } else {
    // Per-device-serial, cross-device-parallel: one async worker per resource group runs
    // that group's cells in order; all workers run concurrently. Output is reassembled to
    // the input `browsers` order so the report + every downstream consumer is unchanged.
    const groups = new Map();
    for (const browser of browsers) {
      const key = resourceKey(browser);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(browser);
    }
    const cellByBrowser = new Map();
    await Promise.all(
      [...groups.values()].map(async (groupBrowsers) => {
        for (const browser of groupBrowsers) {
          if (stopped) {
            cellByBrowser.set(browser, skipCell(browser));
            continue;
          }
          const cell = await runOneCell(browser);
          cellByBrowser.set(browser, cell);
          applyGates(cell);
        }
      }),
    );
    cells = browsers.map((browser) => cellByBrowser.get(browser));
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
  EXIT_DRIVER_INIT_FAILED,
  EXIT_RUNNER_INCOMPLETE,
  EXIT_RUNNER_NO_FEATURES,
  installIncompleteRunGuard,
  classifyCrashExit,
  defaultResourceKey,
  runMatrix,
  formatMatrixResult,
  formatMatrixResultJson,
  formatMatrixResultJunit,
};

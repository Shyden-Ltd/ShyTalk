/**
 * driver-health-check.js
 *
 * Diagnostic command for the runner's `--check-drivers` flag.
 *
 * For each browser slug in the supplied list, the helper calls the
 * matching driver-factory function. If the factory returns a driver,
 * the helper closes it cleanly and records 'ok'. If the factory throws
 * with an init-error signature (no device, missing env var, server
 * unreachable, etc.), the helper records 'skip' with the actionable
 * error message. Any other throw is recorded as 'fail'.
 *
 * This is the fastest way for the operator to verify every device +
 * server + env-var is in place BEFORE running a full --matrix journey
 * (which can take 5-10 minutes per cell). A typical health-check run
 * takes ~10s total for 12 cells.
 *
 * The matrix-dispatch's `isInitError` matcher is reused here so the
 * skip-vs-fail classification stays consistent between the two
 * commands.
 */

const { isInitError } = require('./matrix-dispatch');

/**
 * Runs the health check (or smoke check, with smokeMethod set).
 *
 *   // --check-drivers mode: bootstrap + close only
 *   const result = await runHealthCheck({
 *     browsers: ['chromium', 'mobile-chrome-android'],
 *     factories: { chromium: createChromiumDriver, ... },
 *     baseURL: 'http://localhost:8888',
 *   });
 *
 *   // --smoke mode: bootstrap + one real method call + close
 *   const smoked = await runHealthCheck({
 *     browsers: ['chromium'],
 *     factories: { chromium: createChromiumDriver },
 *     smokeMethod: 'webUiDump',
 *   });
 *
 * Returns:
 *   {
 *     cells: Array<{ browser, outcome: 'ok' | 'fail' | 'skip', error?, durationMs }>,
 *     totals: { ok, fail, skip },
 *     summary: string,
 *     ok: boolean,        // true iff zero fails (skips don't count)
 *   }
 *
 * Required args:
 *   - browsers — array of browser slugs to health-check
 *   - factories — object mapping browser slug → async () => driver
 *
 * Optional:
 *   - baseURL — passed through to each factory (default localhost:8888)
 *   - smokeMethod — name of a method to call on the driver after
 *     bootstrap. If present + driver implements it, the method is
 *     called (any throw downgrades outcome to 'fail' with a
 *     "smoke method <X> failed" message). If driver does NOT implement
 *     it, outcome is 'fail' with "smoke method <X> not implemented".
 *     If undefined, no smoke call is made (matches --check-drivers).
 *   - onCellStart / onCellEnd — progress callbacks
 *   - nowMs — clock injection for tests
 */
async function runHealthCheck({
  browsers,
  factories,
  baseURL = 'http://localhost:8888',
  smokeMethod,
  onCellStart,
  onCellEnd,
  nowMs = () => Date.now(),
  // processStats — injected for tests (default: process.memoryUsage()).
  // Returns an object with at least a `rss` field in bytes. Used to
  // sample per-cell peak RSS (gap C4). Operator sees which cells push
  // process memory the highest, useful for catching driver leaks.
  // Sampling is best-effort and parent-process-scoped: matrix-dispatch
  // subprocesses are NOT captured (would require IPC).
  processStats = () => process.memoryUsage(),
} = {}) {
  if (!Array.isArray(browsers)) {
    throw new Error('runHealthCheck: `browsers` must be an array of browser slugs');
  }
  if (browsers.length === 0) {
    throw new Error('runHealthCheck: `browsers` is empty');
  }
  if (!factories || typeof factories !== 'object') {
    throw new Error('runHealthCheck: `factories` must be an object mapping slug → factory fn');
  }

  const cells = [];
  for (const browser of browsers) {
    if (typeof onCellStart === 'function') onCellStart({ browser });
    const t0 = nowMs();
    let outcome;
    let error;
    // Phase metrics — declared at cell scope so they survive the
    // factory/else branching and reach the cell-building block below.
    let cellBootstrapMs;
    let cellSmokeMs;
    let cellCloseMs;
    // Peak RSS sampled at cell start and each phase boundary. Records
    // the highest RSS observed during this cell's execution. Stays
    // undefined when the cell doesn't reach the factory branch (e.g.
    // no factory registered for slug).
    let cellPeakRssBytes;
    const samplePeakRss = () => {
      try {
        const stats = processStats();
        if (stats && typeof stats.rss === 'number') {
          if (cellPeakRssBytes === undefined || stats.rss > cellPeakRssBytes) {
            cellPeakRssBytes = stats.rss;
          }
        }
      } catch (_e) {
        /* swallow — RSS sampling is best-effort, never fails the cell */
      }
    };
    const factory = factories[browser];
    if (typeof factory !== 'function') {
      outcome = 'fail';
      error = `no factory registered for browser slug "${browser}"`;
    } else {
      let driver;
      // Phase timing (gap C5): bootstrap / smoke / close ms each recorded
      // when their phase executes. Operator can identify which phase
      // dominates the cell's total wall time. Phases that don't run
      // leave their field undefined (NOT 0 — a 0 would falsely imply
      // the phase ran instantly).
      let bootstrapMs;
      let smokeMs;
      let closeMs;
      // Cell-start RSS sample — establishes the baseline before any
      // phase runs. Each phase boundary updates the peak.
      samplePeakRss();
      const tBoot = nowMs();
      try {
        driver = await factory({ baseURL });
        bootstrapMs = Math.max(0, nowMs() - tBoot);
        samplePeakRss();
        outcome = 'ok';
      } catch (e) {
        bootstrapMs = Math.max(0, nowMs() - tBoot);
        samplePeakRss();
        if (isInitError(e)) {
          outcome = 'skip';
          error = e.message;
        } else {
          outcome = 'fail';
          error = e.message;
        }
      }
      // Smoke call: only when bootstrap succeeded + smokeMethod was
      // requested. A driver that bootstraps cleanly but can't service
      // its own method is broken at runtime — separate from init
      // failures (which are 'skip'-classified above).
      if (outcome === 'ok' && smokeMethod && driver) {
        if (typeof driver[smokeMethod] !== 'function') {
          outcome = 'fail';
          error = `smoke method "${smokeMethod}" not implemented on driver`;
        } else {
          // tSmoke captured INSIDE the else branch so the not-
          // implemented path doesn't consume a nowMs() tick that
          // never feeds a phase-timing field. Keeps tick-count
          // analysis predictable for tests that inject nowMs.
          const tSmoke = nowMs();
          try {
            await driver[smokeMethod]();
            smokeMs = Math.max(0, nowMs() - tSmoke);
            // Sample RSS after smoke success — driver may have allocated
            // significant memory during the method call (e.g. screenshot
            // buffers, DOM dumps). Without this sample, a memory spike
            // during smoke that's freed during close would be invisible
            // (the post-close sample wouldn't see it).
            samplePeakRss();
          } catch (e) {
            smokeMs = Math.max(0, nowMs() - tSmoke);
            // Sample after smoke fail too — failure path may have left
            // dangling allocations that the operator wants to detect.
            samplePeakRss();
            outcome = 'fail';
            error = `smoke method "${smokeMethod}" failed: ${e.message}`;
          }
        }
      }
      // Best-effort close — never let a close error change the
      // health-check outcome (the bootstrap succeeded, that's the point).
      if (driver && typeof driver.close === 'function') {
        const tClose = nowMs();
        try {
          await driver.close();
          closeMs = Math.max(0, nowMs() - tClose);
        } catch (_e) {
          closeMs = Math.max(0, nowMs() - tClose);
          /* swallow close errors */
        }
      }
      // Final RSS sample — captures any close-phase memory growth.
      samplePeakRss();
      // Hoist phase metrics to cell scope so the cell-builder below
      // can pick them up after the factory/else branching closes.
      cellBootstrapMs = bootstrapMs;
      cellSmokeMs = smokeMs;
      cellCloseMs = closeMs;
    }
    const durationMs = Math.max(0, nowMs() - t0);
    const cell = { browser, outcome, durationMs };
    if (error) cell.error = error;
    if (cellBootstrapMs !== undefined) cell.bootstrapMs = cellBootstrapMs;
    if (cellSmokeMs !== undefined) cell.smokeMs = cellSmokeMs;
    if (cellCloseMs !== undefined) cell.closeMs = cellCloseMs;
    if (cellPeakRssBytes !== undefined) cell.peakRssBytes = cellPeakRssBytes;
    cells.push(cell);
    if (typeof onCellEnd === 'function') onCellEnd(cell);
  }

  const totals = cells.reduce(
    (acc, c) => {
      acc[c.outcome] = (acc[c.outcome] || 0) + 1;
      return acc;
    },
    { ok: 0, fail: 0, skip: 0 },
  );

  const summary = `${totals.ok} ok / ${totals.fail} fail / ${totals.skip} skip`;
  return { cells, totals, summary, ok: totals.fail === 0 };
}

/**
 * Render the health-check result as a compact text table. Mirrors the
 * shape of formatMatrixResult so the operator sees consistent output.
 * `label` defaults to "Health" — set to "Smoke" when called from the
 * --smoke flag so the summary line matches the operator's mental model.
 */
function formatHealthCheckResult({ cells, summary }, { label = 'Health' } = {}) {
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
  lines.push(`${label}: ${summary}`);
  return lines.join('\n');
}

module.exports = {
  runHealthCheck,
  formatHealthCheckResult,
};

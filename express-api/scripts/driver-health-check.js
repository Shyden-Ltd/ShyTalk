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
 * Runs the health check.
 *
 *   const result = await runHealthCheck({
 *     browsers: ['chromium', 'mobile-chrome-android'],
 *     factories: { chromium: createChromiumDriver, ... },
 *     baseURL: 'http://localhost:8888',
 *   });
 *   // result.summary === '1 ok / 0 fail / 1 skip'
 *   // result.cells === [{ browser: 'chromium', outcome: 'ok', durationMs }, ...]
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
 *   - onCellStart / onCellEnd — progress callbacks
 *   - nowMs — clock injection for tests
 */
async function runHealthCheck({
  browsers,
  factories,
  baseURL = 'http://localhost:8888',
  onCellStart,
  onCellEnd,
  nowMs = () => Date.now(),
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
    const factory = factories[browser];
    if (typeof factory !== 'function') {
      outcome = 'fail';
      error = `no factory registered for browser slug "${browser}"`;
    } else {
      let driver;
      try {
        driver = await factory({ baseURL });
        outcome = 'ok';
      } catch (e) {
        if (isInitError(e)) {
          outcome = 'skip';
          error = e.message;
        } else {
          outcome = 'fail';
          error = e.message;
        }
      }
      // Best-effort close — never let a close error change the
      // health-check outcome (the bootstrap succeeded, that's the point).
      if (driver && typeof driver.close === 'function') {
        try {
          await driver.close();
        } catch (_e) {
          /* swallow close errors */
        }
      }
    }
    const durationMs = Math.max(0, nowMs() - t0);
    const cell = { browser, outcome, durationMs };
    if (error) cell.error = error;
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
 */
function formatHealthCheckResult({ cells, summary }) {
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
  lines.push(`Health: ${summary}`);
  return lines.join('\n');
}

module.exports = {
  runHealthCheck,
  formatHealthCheckResult,
};

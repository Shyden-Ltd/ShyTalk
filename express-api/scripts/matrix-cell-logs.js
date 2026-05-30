/**
 * matrix-cell-logs.js
 *
 * Helpers for capturing each `--matrix` cell's subprocess stdio into a
 * per-cell log file. Used by the runner's `--report-dir <path>` flag.
 *
 * When the operator runs the matrix without `--report-dir`, cells'
 * stdio is `inherit`ed to the runner's terminal (current behaviour —
 * good for interactive use). When `--report-dir` is set, each cell's
 * stdio lands in `<dir>/<browser-slug>.log` so a failed cell leaves a
 * debuggable artifact behind. The fail-fast case + the device-offline
 * skip case both still write log files (with whatever output the
 * subprocess produced before exiting).
 *
 * The helpers here cover:
 *   - resolveCellLogPath: deterministic per-cell filename inside the
 *     dir. Browser slugs are filesystem-safe (alphanumerics + hyphens),
 *     so no escape needed; the helper still pins the join + extension.
 *   - ensureReportDir: idempotent mkdir-p for the target dir.
 *   - buildSpawnStdio: returns the stdio array spawnSync wants. For
 *     'inherit' mode (no log dir) it's just 'inherit'. For 'capture'
 *     mode it's three pipes; the helper also returns the write streams
 *     so the runner can pipe stdout+stderr into the log file + tee to
 *     the operator's terminal at the same time.
 *
 * Filesystem operations are injectable via fsImpl so tests can run
 * without writing real files.
 */

const path = require('path');
const realFs = require('fs');

/**
 * Returns the absolute path the cell's log should live at. Browser
 * slugs are already filesystem-safe by the allowlist convention
 * (`mobile-chrome-android` etc.) so no escaping. Tests pin the
 * trailing `.log` extension + the join shape.
 */
function resolveCellLogPath(dir, browser) {
  if (!dir || typeof dir !== 'string') {
    throw new Error('resolveCellLogPath: `dir` is required (got ' + JSON.stringify(dir) + ')');
  }
  if (!browser || typeof browser !== 'string') {
    throw new Error(
      'resolveCellLogPath: `browser` is required (got ' + JSON.stringify(browser) + ')',
    );
  }
  return path.join(dir, `${browser}.log`);
}

/**
 * Idempotently creates the report directory if it doesn't exist.
 * Mirrors `mkdir -p`. fsImpl injectable for tests.
 *
 * Returns the dir path so callers can chain.
 */
function ensureReportDir(dir, fsImpl = realFs) {
  if (!dir || typeof dir !== 'string') {
    throw new Error('ensureReportDir: `dir` is required (got ' + JSON.stringify(dir) + ')');
  }
  fsImpl.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Writes the cell's combined output (any of stdout + stderr) to the
 * log file. Header is a one-line metadata banner so a future operator
 * grepping multiple log files can identify the cell + outcome at a
 * glance.
 *
 *   $ cat reports/<run>/chromium.log
 *   ## browser=chromium outcome=pass durationMs=842
 *   ## startedAt=2026-05-30T18:42:00.000Z
 *   ## --
 *   <subprocess output …>
 *
 * `nowIso` injectable.
 */
function formatCellLog({ cell, body, nowIso = () => new Date().toISOString() }) {
  const startedAt = cell.startedAt || nowIso();
  const lines = [
    `## browser=${cell.browser} outcome=${cell.outcome || 'unknown'} durationMs=${cell.durationMs || 0}`,
    `## startedAt=${startedAt}`,
    '## --',
    body || '',
  ];
  return lines.join('\n');
}

/**
 * Writes a single cell's log atomically (write whole content; no
 * partial flushes). Returns the absolute path written.
 */
function writeCellLog({ dir, cell, body, fsImpl = realFs, nowIso }) {
  const filePath = resolveCellLogPath(dir, cell.browser);
  const text = formatCellLog({ cell, body, nowIso });
  fsImpl.writeFileSync(filePath, text);
  return filePath;
}

module.exports = {
  resolveCellLogPath,
  ensureReportDir,
  formatCellLog,
  writeCellLog,
};

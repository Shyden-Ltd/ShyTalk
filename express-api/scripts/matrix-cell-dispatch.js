/**
 * matrix-cell-dispatch.js
 *
 * Async per-cell subprocess dispatch for the runner's `--matrix` path.
 *
 * The original dispatch used spawnSync, which blocks the event loop for
 * the entire cell lifetime — under matrix-dispatch's `parallel` mode the
 * per-resource-group workers could therefore never actually overlap
 * (the first group's cell froze every other group mid-await). This
 * module preserves the spawnSync-era contract on top of async spawn:
 *
 *   - resolves `true`/`false` from the cell's exit code (0 = pass)
 *   - throws `code: 'CELL_TIMEOUT'` with the same message shape when the
 *     cell outlives `cellTimeoutMs` (matrix-dispatch classifies it as
 *     outcome 'timeout', distinct from 'fail')
 *   - capture mode buffers the child's stdout/stderr and tees them to
 *     the operator streams in ONE write per stream at cell end — under
 *     parallel dispatch this keeps each cell's output contiguous instead
 *     of interleaving lines from concurrently-running cells (spawnSync
 *     had the same end-of-cell batching, so sequential UX is unchanged)
 *   - capture + reportDir writes the per-cell log via matrix-cell-logs
 *   - inherit mode (no capture) keeps zero-overhead passthrough stdio
 *
 * Extracted from manual-qa-runner.js so the dispatch contract is
 * testable against real spawned subprocesses without booting the whole
 * runner per cell.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { EXIT_DRIVER_INIT_FAILED } = require('./matrix-dispatch');

/**
 * Builds the `dispatchOne({ browser })` callback the runner hands to
 * runMatrix. All collaborators are injectable for tests but default to
 * the real thing; the spawned cell is ALWAYS a real subprocess.
 */
// Per-stream capture ceiling. spawnSync enforced a maxBuffer (default 1 MiB,
// ENOBUFS past it — a crash); the async path instead keeps the HEAD of the
// output and appends a truncation notice, so a runaway cell can neither grow
// the runner's heap unboundedly nor kill its own cell record.
const DEFAULT_MAX_CAPTURE_BYTES = 64 * 1024 * 1024;

// Collects a child stream up to `limit` bytes (head-biased) and reports
// whether anything was dropped.
/**
 * Collect a cell's output, and MIRROR IT LIVE if a sink is given.
 *
 * The buffered-only version made a hung cell a black box precisely when you
 * needed to see inside it. On the 2026-08-01 run, `chromium.log`,
 * `firefox.log` and `webkit.log` existed — those cells had finished — while
 * the two device cells, the ones actually stuck, had no log at all, because
 * the log is written when the child closes.
 *
 * So the two things you want during a stall — what the cell is doing, and how
 * long it has been doing it — were exactly the two things unavailable. The
 * live mirror is what makes the next stall diagnosable without waiting two
 * hours for the cell timeout.
 *
 * @param {import('stream').Readable} stream
 * @param {number} limit byte cap for the in-memory copy
 * @param {(chunk: Buffer) => void} [sink] receives every chunk, uncapped
 */
function cappedCollector(stream, limit, sink) {
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  stream.on('data', (c) => {
    if (sink) {
      // Mirrored BEFORE the cap check: the tail of a long-running cell is the
      // part that says where it stopped, and capping it away loses precisely
      // the evidence a stall investigation needs.
      try {
        sink(c);
      } catch {
        /* a failed mirror must never take down the run it is observing */
      }
    }
    if (bytes >= limit) {
      truncated = true;
      return;
    }
    const room = limit - bytes;
    if (c.length > room) {
      chunks.push(c.subarray(0, room));
      bytes += room;
      truncated = true;
    } else {
      chunks.push(c);
      bytes += c.length;
    }
  });
  return () => {
    let text = Buffer.concat(chunks).toString('utf8');
    if (truncated) text += `\n[capture truncated at ${limit} bytes]\n`;
    return text;
  };
}

function createCellDispatcher({
  runnerPath,
  baseArgv,
  nodePath = process.execPath,
  cellTimeoutMs,
  captureStdio = false,
  maxCaptureBytes = DEFAULT_MAX_CAPTURE_BYTES,
  reportDir = null,
  cellLogs = null,
  out = process.stdout,
  err = process.stderr,
  env = process.env,
} = {}) {
  if (typeof runnerPath !== 'string' || runnerPath.trim() === '') {
    throw new Error(
      'createCellDispatcher: `runnerPath` is required (got ' + JSON.stringify(runnerPath) + ')',
    );
  }
  if (!Array.isArray(baseArgv)) {
    throw new Error(
      'createCellDispatcher: `baseArgv` must be an array (got ' + JSON.stringify(baseArgv) + ')',
    );
  }

  return async function dispatchOne({ browser }) {
    const cellArgs = [...baseArgv, '--browser', browser];
    const spawnOpts = {
      stdio: captureStdio ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      env,
    };
    // spawn's `timeout` option kills the child with `killSignal` once
    // exceeded; the 'close' event then reports (code: null, signal:
    // 'SIGTERM'). Translated to a CELL_TIMEOUT throw below so
    // matrix-dispatch classifies the cell as 'timeout', not 'fail'.
    if (cellTimeoutMs) {
      spawnOpts.timeout = cellTimeoutMs;
      spawnOpts.killSignal = 'SIGTERM';
    }

    const child = spawn(nodePath, [runnerPath, ...cellArgs], spawnOpts);
    let readStdout = () => '';
    let readStderr = () => '';
    // Live mirror, so a RUNNING cell can be inspected. Without it the only
    // log appears when the cell closes, which is never for a hung one — the
    // exact case worth looking at. Appended to `<cell>.live.log`, kept
    // separate from the formatted `<cell>.log` the run writes at the end so
    // neither can corrupt the other.
    let liveFd = null;
    if (captureStdio && reportDir) {
      try {
        liveFd = fs.openSync(path.join(reportDir, `${browser}.live.log`), 'a');
      } catch {
        /* diagnostics are best-effort; never fail a cell over its own log */
      }
    }
    const mirror = liveFd === null ? undefined : (chunk) => fs.writeSync(liveFd, chunk);
    if (captureStdio) {
      readStdout = cappedCollector(child.stdout, maxCaptureBytes, mirror);
      readStderr = cappedCollector(child.stderr, maxCaptureBytes, mirror);
    }

    const { code, signal } = await new Promise((resolve, reject) => {
      // 'error' fires when the process could not be spawned at all
      // (e.g. ENOENT node binary) — 'close' may never follow, so the
      // promise must settle here. spawnSync surfaced timeouts as
      // error.code === 'ETIMEDOUT'; async spawn signals them via the
      // close event instead, but the translation is kept for parity in
      // case a platform surfaces the kill as an error.
      child.once('error', (e) => {
        if (e && e.code === 'ETIMEDOUT') {
          reject(cellTimeoutError(cellTimeoutMs));
        } else {
          reject(e);
        }
      });
      child.once('close', (exitCode, exitSignal) =>
        resolve({ code: exitCode, signal: exitSignal }),
      );
    });

    if (liveFd !== null) {
      // Released as soon as the cell ends, whatever the outcome — a leaked
      // descriptor per cell would exhaust the runner's limit on a long matrix.
      try {
        fs.closeSync(liveFd);
      } catch {
        /* already gone */
      }
      liveFd = null;
    }

    const timedOut = code === null && signal === 'SIGTERM' && Boolean(cellTimeoutMs);
    const initFailed = code === EXIT_DRIVER_INIT_FAILED;
    if (captureStdio) {
      const stdout = readStdout();
      const stderr = readStderr();
      // One write per stream per cell — atomic tee blocks under
      // parallel dispatch (see module docstring). Timed-out and
      // init-failed cells flush too: a hung cell is the failure mode
      // MOST in need of a debug trail (and under --parallel capture is
      // forced, so without this flush its output would simply vanish),
      // and the log file keeps the matrix-cell-logs promise that
      // device-offline skips leave a debuggable artifact behind.
      if (stdout) out.write(stdout);
      if (stderr) err.write(stderr);
      if (reportDir && cellLogs) {
        cellLogs.writeCellLog({
          dir: reportDir,
          cell: {
            browser,
            outcome: timedOut ? 'timeout' : initFailed ? 'skip' : code === 0 ? 'pass' : 'fail',
            durationMs: 0, // not measured here; runMatrix sets it on its own cell record
          },
          body: stdout + (stderr ? `\n---STDERR---\n${stderr}` : ''),
        });
      }
    }

    if (timedOut) {
      throw cellTimeoutError(cellTimeoutMs);
    }

    if (initFailed) {
      // The single-cell process signalled "driver could not bootstrap"
      // via the reserved exit code (its main() catch classifies init
      // errors — see classifyCrashExit). Rethrow as a coded error so
      // runMatrix classifies the cell 'skip', not 'fail'.
      const e = new Error(
        `cell ${browser}: driver init failed (device/browser app/env not available) — subprocess exit ${EXIT_DRIVER_INIT_FAILED}`,
      );
      e.code = 'DRIVER_INIT_FAILED';
      throw e;
    }

    return code === 0;
  };
}

function cellTimeoutError(cellTimeoutMs) {
  const e = new Error(`cell timed out after ${Math.round(cellTimeoutMs / 1000)}s`);
  e.code = 'CELL_TIMEOUT';
  return e;
}

module.exports = { createCellDispatcher };

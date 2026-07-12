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

/**
 * Builds the `dispatchOne({ browser })` callback the runner hands to
 * runMatrix. All collaborators are injectable for tests but default to
 * the real thing; the spawned cell is ALWAYS a real subprocess.
 */
function createCellDispatcher({
  runnerPath,
  baseArgv,
  nodePath = process.execPath,
  cellTimeoutMs,
  captureStdio = false,
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
    const stdoutChunks = [];
    const stderrChunks = [];
    if (captureStdio) {
      child.stdout.on('data', (c) => stdoutChunks.push(c));
      child.stderr.on('data', (c) => stderrChunks.push(c));
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

    if (code === null && signal === 'SIGTERM' && cellTimeoutMs) {
      // Parity with the spawnSync path: a timed-out cell throws before
      // any tee/log write (runMatrix records the timeout on its own
      // cell record).
      throw cellTimeoutError(cellTimeoutMs);
    }

    if (captureStdio) {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      // One write per stream per cell — atomic tee blocks under
      // parallel dispatch (see module docstring).
      if (stdout) out.write(stdout);
      if (stderr) err.write(stderr);
      if (reportDir && cellLogs) {
        cellLogs.writeCellLog({
          dir: reportDir,
          cell: {
            browser,
            outcome: code === 0 ? 'pass' : 'fail',
            durationMs: 0, // not measured here; runMatrix sets it on its own cell record
          },
          body: stdout + (stderr ? `\n---STDERR---\n${stderr}` : ''),
        });
      }
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

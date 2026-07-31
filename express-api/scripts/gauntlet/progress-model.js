/**
 * Gauntlet progress model — turns the runner's existing log output into a
 * structured view of what is done, what is running, and what is still to do.
 *
 * Operator 2026-07-31: "right now i have no visibility of what it's done and
 * still to do." A `tail -f` shows what has happened; it cannot show what has
 * NOT happened yet, which over a multi-hour sequential matrix is most of it.
 *
 * Deliberately a parser over signals the runner ALREADY emits. A gauntlet that
 * gains a new way to fail in order to be watchable is a bad trade.
 */

// Cell dispatch: `[matrix] → dispatching chromium` or `[web] → chromium`.
const CELL_START = /^\[[^\]]+\]\s+→\s+(?:dispatching\s+)?(\S+)\s*$/;
// Cell completion: `[matrix] ← chromium: passed (48210ms)`.
const CELL_END = /^\[[^\]]+\]\s+←\s+(\S+?):\s+(\S+)\s+\((\d+)ms\)/;

/**
 * A cell's outcome maps to one of three resolved states.
 *
 * `skip` is deliberately NOT a failure — it means the cell never ran (no
 * matching device, unsupported browser). Found on the first real run: three
 * Android cells reported `skip` and showed as FAILED, inflating the failure
 * count on the very dashboard meant to make progress honest.
 */
function stateForOutcome(outcome) {
  if (outcome === 'passed') return 'passed';
  if (outcome === 'skip' || outcome === 'skipped') return 'skipped';
  return 'failed';
}

/** Extract dispatched and completed cells from raw log text. */
function parseMatrixLog(logText) {
  const started = [];
  const finished = [];

  for (const line of String(logText || '').split('\n')) {
    const trimmed = line.trim();

    const end = CELL_END.exec(trimmed);
    if (end) {
      finished.push({ browser: end[1], outcome: end[2], durationMs: Number(end[3]) });
      continue;
    }

    const start = CELL_START.exec(trimmed);
    if (start) started.push(start[1]);
  }

  return { started, finished };
}

/**
 * Combine the plan (every cell the matrix intends to run) with the log (what
 * has actually happened) into one view.
 *
 * @param {object} input
 * @param {string[]} input.planned   Every browser slug the run intends to cover.
 * @param {string} input.logText     Raw gauntlet log.
 * @param {string} [input.sentinel]  'DONE' | 'FAIL' | undefined.
 * @param {boolean} [input.pidAlive] Whether the run process still exists.
 * @param {boolean} [input.started]  Whether the run was ever launched.
 */
function buildProgress({ planned = [], logText = '', sentinel, pidAlive = true, started = false }) {
  const { started: dispatched, finished } = parseMatrixLog(logText);

  const outcomeByBrowser = new Map();
  for (const cell of finished) outcomeByBrowser.set(cell.browser, cell);

  const cellFor = (browser, unplanned) => {
    const done = outcomeByBrowser.get(browser);
    if (done) {
      return {
        browser,
        state: stateForOutcome(done.outcome),
        outcome: done.outcome,
        durationMs: done.durationMs,
        ...(unplanned ? { unplanned: true } : {}),
      };
    }
    const state = dispatched.includes(browser) ? 'running' : 'pending';
    return { browser, state, ...(unplanned ? { unplanned: true } : {}) };
  };

  const cells = planned.map((b) => cellFor(b, false));

  // A cell the log reports but the plan never contained means the plan is
  // wrong. Surfacing it is the point — hiding it would make the dashboard
  // quietly disagree with reality.
  for (const browser of [...dispatched, ...finished.map((f) => f.browser)]) {
    if (!planned.includes(browser) && !cells.some((c) => c.browser === browser)) {
      cells.push(cellFor(browser, true));
    }
  }

  const counts = {
    total: cells.length,
    passed: cells.filter((c) => c.state === 'passed').length,
    failed: cells.filter((c) => c.state === 'failed').length,
    skipped: cells.filter((c) => c.state === 'skipped').length,
    running: cells.filter((c) => c.state === 'running').length,
    pending: cells.filter((c) => c.state === 'pending').length,
  };

  // Finished cells only. A running cell is not partial credit — counting it as
  // progress is how a stalled run looks like it is still advancing. A SKIPPED
  // cell is resolved though: it will never run, so excluding it would stop the
  // bar ever reaching 100% and leave the operator waiting for a finished run.
  const done = counts.passed + counts.failed + counts.skipped;
  const percent = counts.total === 0 ? 0 : Math.round((done / counts.total) * 100);

  return { cells, counts, percent, state: overallState({ sentinel, pidAlive, started }) };
}

/**
 * The sentinel file is the authority on completion, never the counts: a matrix
 * can look finished mid-flight simply because the remaining cells have not
 * dispatched yet.
 */
function overallState({ sentinel, pidAlive, started }) {
  if (sentinel === 'DONE') return 'done';
  if (sentinel === 'FAIL') return 'failed';
  // Dead with no sentinel is its own state. Reporting it as "running" is what
  // lets a crashed run sit there looking healthy for hours.
  if (started && !pidAlive) return 'died';
  return 'running';
}

/** Human elapsed time. Clock skew must never render as a negative duration. */
function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(Number(ms) || 0) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = Math.floor(total % 60);
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

module.exports = { parseMatrixLog, buildProgress, formatElapsed };

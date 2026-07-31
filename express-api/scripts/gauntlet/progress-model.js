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

/**
 * How long a dispatched cell may show no artifact before it is called stalled.
 * Driver init and app install legitimately take a while, so this is generous —
 * but the 2026-07-31 hang sat silent for 35 minutes, well past any grace.
 */
const DEFAULT_STALLED_AFTER_MS = 5 * 60 * 1000;

// The runner writes scenario-N/screenshot-<browser>-<persona>.png. Browser
// slugs are hyphenated (`mobile-firefox-android`), and so are some personas,
// so anchor on the known prefix and take the LONGEST browser match rather than
// splitting on '-' — which would read `mobile-firefox-android` as `mobile`.
const SCREENSHOT = /^screenshot-(.+)-[^-]+\.png$/;

/**
 * Count scenarios per browser from artifact filenames, and record when each
 * browser last produced anything.
 *
 * Distinct scenario DIRECTORIES are the unit: one scenario commonly writes
 * several screenshots (one per persona), so counting files would inflate it.
 *
 * @param {Array<{dir:string,file:string,mtimeMs:number}>} artifacts
 * @param {string[]} [knownBrowsers] Slugs to disambiguate against.
 */
function attributeScenarios(artifacts, knownBrowsers = []) {
  const byBrowser = {};
  const seen = {};

  for (const a of artifacts) {
    const match = SCREENSHOT.exec(a.file);
    if (!match) continue;

    // `screenshot-mobile-firefox-android-Lena.png` -> capture is
    // `mobile-firefox-android`; if a persona itself contains a hyphen the
    // known-browser list resolves it, otherwise the capture stands.
    let browser = match[1];
    const known = knownBrowsers.filter((b) => browser === b || browser.startsWith(`${b}-`));
    if (known.length) browser = known.sort((x, y) => y.length - x.length)[0];

    byBrowser[browser] ||= { scenarios: 0, lastActivityMs: 0 };
    seen[browser] ||= new Set();
    if (!seen[browser].has(a.dir)) {
      seen[browser].add(a.dir);
      byBrowser[browser].scenarios += 1;
    }
    if (a.mtimeMs > byBrowser[browser].lastActivityMs) {
      byBrowser[browser].lastActivityMs = a.mtimeMs;
    }
  }
  return byBrowser;
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
function buildProgress({
  planned = [],
  logText = '',
  sentinel,
  pidAlive = true,
  started = false,
  scenarioStats = {},
  now = Date.now(),
  dispatchedAtMs = null,
  stalledAfterMs = DEFAULT_STALLED_AFTER_MS,
}) {
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
    if (!dispatched.includes(browser)) {
      return { browser, state: 'pending', ...(unplanned ? { unplanned: true } : {}) };
    }

    // Dispatched but unfinished. "Running" and "hung" look identical from the
    // log alone — which is how three dead cells reported `running` for 35
    // minutes on 2026-07-31 while the operator watched the phone do nothing.
    // Artifact recency is the discriminator.
    const stats = scenarioStats[browser];
    const lastSignal = stats?.lastActivityMs || dispatchedAtMs || now;
    const idleMs = now - lastSignal;
    const state = idleMs > stalledAfterMs ? 'stalled' : 'running';

    return {
      browser,
      state,
      scenarios: stats?.scenarios || 0,
      idleMs: Math.max(0, idleMs),
      ...(unplanned ? { unplanned: true } : {}),
    };
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
    stalled: cells.filter((c) => c.state === 'stalled').length,
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

/**
 * Backoff for the dashboard's reconnect loop.
 *
 * Capped deliberately: unbounded exponential backoff is indistinguishable from
 * giving up, and a viewer that reconnects ten minutes late is no use to someone
 * standing at a phone waiting to see whether it is being driven.
 */
function retryDelayMs(attempt) {
  const n = Math.max(1, Number(attempt) || 1);
  return Math.min(10000, 500 * 2 ** (n - 1));
}

module.exports = {
  DEFAULT_STALLED_AFTER_MS,
  retryDelayMs,
  parseMatrixLog,
  attributeScenarios,
  buildProgress,
  formatElapsed,
};

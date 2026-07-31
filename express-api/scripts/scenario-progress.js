/**
 * Per-scenario live progress stream (SHY-0263).
 *
 * Operator 2026-07-31, on the gauntlet dashboard: "the scenarios should also
 * include the name, so we can see exactly which scenario was tested. the
 * expandable list should show ALL scenarios, with icons to represent all the
 * different cells and devices, icons should be red for fail, green for pass or
 * gray for pending."
 *
 * The runner had been deliberately left untouched — a multi-hour gauntlet
 * should not gain new ways to fail just so it can be watched. Two facts forced
 * the change:
 *
 *   1. `matrix-cell-logs.js` writes each cell's log with writeFileSync, ONCE,
 *      at cell end. Nothing per-scenario is observable while a cell runs.
 *   2. Screenshot artifacts exist only when a webDriver does, so NATIVE device
 *      cells produce none. The artifact-based progress built first was blind to
 *      exactly the cells that matter most, and reported them "stalled" whether
 *      or not they were.
 *
 * An append-only JSONL line per scenario is observable live, works for every
 * cell type, and — being a fire-and-forget append — cannot change cell
 * behaviour or fail a run.
 */
const fs = require('fs');
const path = require('path');

const VALID_STATUS = new Set(['pass', 'fail', 'skipped', 'pending']);

/**
 * One JSON object per line. JSON.stringify escapes newlines, so a record can
 * never be torn in two — which is what lets an error message containing a stack
 * trace travel safely on a single line.
 *
 * `error` / `failedStep` / `reason` are the DIAGNOSIS. Without them a finished
 * run says which scenarios failed and never why: chromium once reported 106
 * failures with no surviving record of the cause, because the per-cell log
 * holds names only (operator 2026-08-01: "fix the failure reasons not being
 * saved"). Undefined fields are dropped by JSON.stringify, so a passing record
 * stays exactly as small as it was.
 */
function formatProgressLine({
  browser,
  file,
  scenario,
  status,
  durationMs,
  error,
  failedStep,
  reason,
  at = Date.now(),
}) {
  return `${JSON.stringify({
    browser,
    file,
    scenario,
    status,
    durationMs,
    error,
    failedStep,
    reason,
    at,
  })}\n`;
}

/**
 * Parse a JSONL progress stream.
 *
 * Tolerant by design: the dashboard polls this file while the runner is
 * appending to it, so a torn final line is expected, not exceptional. Dropping
 * the whole stream over one bad record would blank the view at random.
 */
function parseProgressStream(text) {
  if (!text) return [];
  const records = [];
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && parsed.scenario) records.push(parsed);
    } catch {
      // Torn or junk line — skip it, keep everything else.
    }
  }
  return records;
}

/** Append a scenario result. Never throws: progress reporting must not break a run. */
function appendProgress(streamPath, record) {
  if (!streamPath) return;
  try {
    fs.appendFileSync(streamPath, formatProgressLine(record));
  } catch {
    // Disk full, dir removed mid-run, permissions — none of it is worth
    // failing a gauntlet cell over.
  }
}

/** Every scenario in the journey corpus, in file order, with its name. */
function readCorpus(journeyDir) {
  const corpus = [];
  let files;
  try {
    files = fs
      .readdirSync(journeyDir)
      .filter((f) => f.endsWith('.feature'))
      .sort();
  } catch {
    return corpus;
  }
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(path.join(journeyDir, file), 'utf8');
    } catch {
      continue;
    }
    // Steps are retained so the dashboard can work out which cells a scenario
    // even applies to — Background steps count, since they run for every
    // scenario in the file and can themselves bind a platform.
    const background = [];
    let current = null;
    let inBackground = false;
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('Background:')) {
        inBackground = true;
        current = null;
        continue;
      }
      if (trimmed.startsWith('Scenario:')) {
        inBackground = false;
        current = {
          file,
          scenario: trimmed.slice('Scenario:'.length).trim(),
          steps: [...background],
        };
        corpus.push(current);
        continue;
      }
      // Split on the first space rather than a `(kind)\s+(.+)$` pattern —
      // that shape backtracks super-linearly on long step text.
      const space = trimmed.indexOf(' ');
      if (space < 0) continue;
      const kind = trimmed.slice(0, space);
      if (!['Given', 'When', 'Then', 'And', 'But'].includes(kind)) continue;
      const step = { kind, text: trimmed.slice(space + 1).trim() };
      if (inBackground) background.push(step);
      else if (current) current.steps.push(step);
    }
  }
  return corpus;
}

// NUL joins the composite key because it is the one character that can appear
// in neither a filename nor a Gherkin scenario name — so `a.feature` + `b|c`
// can never collide with `a.feature|b` + `c`. Written as the ESCAPE, never as
// a literal byte: a raw NUL in source trips the check-source-is-text guard and
// makes the file unreadable in most editors, which is how it was caught here.
const key = (file, scenario) => `${file}\u0000${scenario}`;

/**
 * Build the scenario × cell grid.
 *
 * EVERY corpus scenario appears, whether or not it has run — a list that only
 * shows what has happened cannot answer "what is still to be tested". Untouched
 * combinations are `pending`, never blank, so nothing reads as passed by
 * omission.
 */
function buildScenarioMatrix({ corpus = [], cells = [], records = [] }) {
  // Last write wins, so a retry supersedes the failure that triggered it.
  const byKey = new Map();
  for (const r of records) {
    const status = VALID_STATUS.has(r.status) ? r.status : 'skipped';
    byKey.set(`${key(r.file, r.scenario)}\u0000${r.browser}`, status);
  }

  return corpus.map((entry, index) => {
    const results = {};
    const summary = { pass: 0, fail: 0, skipped: 0, pending: 0 };
    for (const cell of cells) {
      const status = byKey.get(`${key(entry.file, entry.scenario)}\u0000${cell}`) || 'pending';
      results[cell] = status;
      summary[status] += 1;
    }
    return { index, file: entry.file, scenario: entry.scenario, results, summary };
  });
}

/**
 * Combine the two activity signals a cell can produce.
 *
 * COUNTS come from the JSONL: one record per scenario, written by every cell
 * type. Screenshot counts are not scenario counts (a scenario writes one per
 * persona) and native cells write none at all.
 *
 * RECENCY is the newest of either: screenshots tick per scenario for web cells,
 * while the JSONL arrives in per-feature-file bursts, so either alone
 * under-reports how recently a cell did something — which is what made the
 * dashboard call a working cell stalled.
 */
function mergeCellActivity({ records = [], artifactStats = {} }) {
  const merged = {};

  for (const [browser, stats] of Object.entries(artifactStats)) {
    merged[browser] = {
      scenarios: stats.scenarios || 0,
      lastActivityMs: stats.lastActivityMs || 0,
    };
  }

  const jsonlCounts = {};
  for (const r of records) {
    if (!r.browser) continue;
    jsonlCounts[r.browser] = (jsonlCounts[r.browser] || 0) + 1;
    merged[r.browser] ||= { scenarios: 0, lastActivityMs: 0 };
    if ((r.at || 0) > merged[r.browser].lastActivityMs)
      merged[r.browser].lastActivityMs = r.at || 0;
  }
  for (const [browser, count] of Object.entries(jsonlCounts)) {
    merged[browser].scenarios = count;
  }

  return merged;
}

module.exports = {
  mergeCellActivity,
  formatProgressLine,
  parseProgressStream,
  appendProgress,
  readCorpus,
  buildScenarioMatrix,
};

#!/usr/bin/env node
/* eslint-disable no-console -- operator-facing CLI; console output is the interface. */
/**
 * Gauntlet progress dashboard — a live desktop view of the journey matrix.
 *
 * Operator 2026-07-31: "right now i have no visibility of what it's done and
 * still to do. so i want the gauntlet to have some sort of UI to appear here on
 * the desktop showing progress."
 *
 * READ-ONLY by design. It watches the run directory and never writes to it,
 * never signals the runner, and never touches a device. If this server dies the
 * gauntlet is completely unaffected — which is the only acceptable relationship
 * between a progress viewer and a multi-hour run it is watching.
 *
 * Usage:
 *   node scripts/gauntlet/progress-server.js [--run-dir DIR] [--port 4310] [--open]
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  buildProgress,
  attributeScenarios,
  scenarioProgress,
  formatElapsed,
  retryDelayMs,
} = require('./progress-model');
/**
 * `capsFor` — what each matrix cell can drive — is asked of the registry, never
 * re-derived. This file used to carry its own copy of the rule
 * (`cell.endsWith('-android') → ['web','android']`), which is how the dashboard
 * came to show app scenarios under `chrome·A 🤖 samsung·A 🤖 edge·A 🤖
 * firefox·A` — four columns for one phone. It agreed with the runner's identical
 * mistake, so nothing looked wrong. Two copies of one rule is how they drift.
 */
const { allowedCellsFor, capsFor, phaseOf, PHASES } = require('../matrix-cells');

const GAUNTLET_TMP = process.env.GAUNTLET_TMP || '/tmp/shytalk-gauntlet';
const DEFAULT_PORT = Number(process.env.GAUNTLET_UI_PORT || 4310);
const MAX_BIND_ATTEMPTS = 30;
const JOURNEY_DIR = path.resolve(__dirname, '../../../journey-tests');
const {
  readCorpus,
  parseProgressStream,
  buildScenarioMatrix,
  mergeCellActivity,
} = require('../scenario-progress');
const { applicableCells, requiredPlatforms, GATING_PLATFORMS } = require('../scenario-surface');
const { buildFailureDetail } = require('./failure-detail');

/**
 * WEB, APP, or CROSS-OVER?
 *
 * Operator 2026-08-01: "split up the scenarios into web scenarios and app
 * scenarios. app scenarios only show the devices that they will run on. whereas
 * the web scenarios will show all browsers on all devices including desktop."
 * Then: "it needs to be very clear if a scenario is web scenario, app scenario
 * or a scenario that crosses over between web and app."
 *
 * Three kinds, because collapsing cross-over into "app" hides the case that
 * matters most: a journey that sends a gift on the phone and checks it on the
 * web needs ONE cell holding both surfaces at once, and those are the first
 * scenarios to break when device wiring slips.
 *
 * Derived from `requiredPlatforms` + `GATING_PLATFORMS` rather than restated, so
 * the split cannot drift from the rule the runner actually gates on.
 */
function classifyScenario(steps) {
  const required = requiredPlatforms(steps);
  const deviceSurfaces = [...required].filter((p) => GATING_PLATFORMS.has(p)).sort();
  // Browser-only, or no surface at all (pure API/state) — every cell has a
  // browser, so either way it runs everywhere.
  if (!deviceSurfaces.length) return { kind: 'web', platforms: [] };
  return { kind: required.has('web') ? 'cross' : 'app', platforms: deviceSurfaces };
}

// The corpus does not change mid-run, so read it once.
const CORPUS = readCorpus(JOURNEY_DIR);

/**
 * Scenarios in the journey corpus — the denominator every cell walks.
 * Counted once at startup; the corpus does not change mid-run.
 */
const CORPUS_SCENARIOS = CORPUS.length;

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

/**
 * Newest run directory from EITHER launcher, or null when none exists yet.
 *
 * There are two, and they write to different places:
 *
 *   gauntlet.sh          /tmp/shytalk-gauntlet/<name>
 *   /run-journeys skill  /tmp/run-journeys-<runId>
 *
 * This looked only in the first, so a dashboard started with no arguments during
 * a `/run-journeys` matrix rendered an empty shell — a live multi-hour run with
 * a viewer insisting nothing was happening. The operator had to know to pass
 * `--run-dir`, which is precisely the knowledge a default should carry.
 *
 * A directory counts as a run because it CONTAINS A `log`, not because of its
 * name. Both launchers write one, and /tmp is full of other people's
 * directories — returning one of those would make the dashboard render a
 * confident view of something unrelated. Keying on the path shape would also
 * mean re-fixing this the next time a run lands somewhere new.
 *
 * Neither source wins by being special, only by being NEWER: a finished
 * gauntlet.sh run from yesterday must not hide the matrix running right now.
 */
// `/tmp` literally, NOT `os.tmpdir()`. On macOS os.tmpdir() is the per-user
// `/var/folders/**/T` directory, while run.sh writes `/tmp/run-journeys-<id>`
// as a hard-coded path — so the default looked in the wrong place entirely and
// auto-discovery silently fell back to whatever gauntlet.sh had left behind.
const RUN_JOURNEYS_TMP = process.env.RUN_JOURNEYS_TMP || '/tmp';
const RUN_JOURNEYS_PREFIX = 'run-journeys-';

function candidateRunDirs() {
  const found = [];

  // 1. gauntlet.sh — every child of its tmp root.
  try {
    for (const e of fs.readdirSync(GAUNTLET_TMP, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== 'latest') found.push(path.join(GAUNTLET_TMP, e.name));
    }
  } catch {
    // No gauntlet.sh runs on this machine yet — not an error.
  }

  // 2. /run-journeys — siblings in tmp, matched by prefix.
  try {
    for (const e of fs.readdirSync(RUN_JOURNEYS_TMP, { withFileTypes: true })) {
      if (!e.name.startsWith(RUN_JOURNEYS_PREFIX)) continue;
      found.push(path.join(RUN_JOURNEYS_TMP, e.name));
    }
  } catch {
    // Unreadable tmp — fall through to whatever source 1 found.
  }

  return found;
}

/**
 * Real directories, each appearing ONCE.
 *
 * `/run-journeys` maintains `run-journeys-latest -> run-journeys-<id>`, so the
 * same run is reachable by two names. Returning the symlink makes the dashboard
 * report the run id as "latest"; returning both makes one run look like two.
 *
 * Resolved with `realpathSync` and de-duplicated rather than excluded by name or
 * by `isDirectory()`. Both of those "worked" only by accident: mutation-testing
 * showed that removing either changed no test outcome, because the surviving
 * check happened to cover the case and the tie between a symlink and its target
 * was then broken by readdir ORDER. A guard that passes on luck is not a guard —
 * collapsing the two paths to one is correct by construction.
 */
function resolveRuns(dirs) {
  const byRealPath = new Map();
  for (const dir of dirs) {
    try {
      const real = fs.realpathSync(dir);
      if (!fs.statSync(real).isDirectory()) continue;
      if (!byRealPath.has(real)) byRealPath.set(real, real);
    } catch {
      // Vanished between readdir and stat — a finished run being cleaned up.
    }
  }
  return [...byRealPath.values()];
}

function latestRunDir() {
  // Ranked by the LOG's mtime, not the directory's.
  //
  // A live run appends to `log` continuously but writes its per-cell output into
  // `report/`, and a child write does not touch the parent's mtime — so the
  // directory looks frozen at creation time for the entire run. Ranking by it
  // put a FINISHED run from the previous day ahead of the matrix running right
  // now, which is the exact opposite of what a progress dashboard is for.
  const runs = resolveRuns(candidateRunDirs())
    .map((dir) => {
      try {
        return { dir, at: fs.statSync(path.join(dir, 'log')).mtimeMs };
      } catch {
        // No log — not a run. /tmp is full of other people's directories.
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.at - a.at);
  return runs.length ? runs[0].dir : null;
}

const readFile = (p) => {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
};

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Absolute paths only — never a bare command name resolved through PATH. A
 * writable PATH entry would let an attacker choose what this runs, and it is
 * also simply more predictable under launchd/nohup where PATH is minimal.
 */
const XCRUN = '/usr/bin/xcrun';
const ADB_CANDIDATES = [
  process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'platform-tools/adb'),
  process.env.ANDROID_SDK_ROOT && path.join(process.env.ANDROID_SDK_ROOT, 'platform-tools/adb'),
  path.join(process.env.HOME || '', 'Library/Android/sdk/platform-tools/adb'),
  '/opt/homebrew/bin/adb',
  '/usr/local/bin/adb',
].filter(Boolean);

const adbPath = () => ADB_CANDIDATES.find((p) => fs.existsSync(p)) || null;

/** Device presence, so the dashboard can show iOS sitting idle while chromium runs. */
function devices() {
  const out = { android: [], ios: [] };
  const adbBin = adbPath();
  try {
    if (!adbBin) throw new Error('adb not found');
    const adb = execFileSync(adbBin, ['devices'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    out.android = adb
      .split('\n')
      .slice(1)
      .filter((l) => l.trim().endsWith('device'))
      .map((l) => l.split(/\s+/)[0]);
  } catch {
    /* adb absent or no devices — reported as empty, never guessed */
  }
  try {
    const dc = execFileSync(XCRUN, ['devicectl', 'list', 'devices'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    out.ios = dc
      .split('\n')
      .filter((l) => /iPhone|iPad/i.test(l) && /available|connected/i.test(l))
      .map((l) => l.trim().split(/\s{2,}/)[0]);
  } catch {
    /* devicectl absent — reported as empty */
  }
  return out;
}

/**
 * Scan the report dir for per-scenario artifacts.
 *
 * The runner writes scenario-N/screenshot-<browser>-<persona>.png as each
 * scenario completes, so this gives live per-cell scenario counts AND the
 * recency signal that distinguishes a working cell from a hung one.
 */
function scanScenarioArtifacts(reportDir) {
  const artifacts = [];
  let dirs;
  try {
    dirs = fs.readdirSync(reportDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return artifacts;
  }
  for (const d of dirs) {
    let files;
    try {
      files = fs.readdirSync(path.join(reportDir, d.name));
    } catch {
      continue;
    }
    for (const file of files) {
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(path.join(reportDir, d.name, file)).mtimeMs;
      } catch {
        /* file vanished mid-scan — skip it */
      }
      artifacts.push({ dir: d.name, file, mtimeMs });
    }
  }
  return artifacts;
}

/**
 * What each device is ACTUALLY doing right now.
 *
 * Operator 2026-07-31: "i can see both devices are connected but no evidence of
 * what they're actually doing." Presence is not activity — the phone can sit on
 * the launcher, or thrash one screen forever, and "connected" looks identical.
 */
function deviceActivity() {
  const activity = { android: null, ios: null };
  const adbBin = adbPath();
  if (adbBin) {
    try {
      const out = execFileSync(adbBin, ['shell', 'dumpsys', 'activity', 'activities'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000,
      });
      const line = out.split('\n').find((l) => l.includes('topResumedActivity'));
      // Tokenise rather than pattern-match: two adjacent greedy classes around
      // a '/' backtrack super-linearly, and the line is arbitrarily long.
      const token = (line || '').split(/\s+/).find((t) => t.includes('/') && t.includes('.'));
      const [pkg, act] = token ? token.split('/') : [];
      if (pkg && act) {
        activity.android = {
          package: pkg,
          screen: act.replace(/^.*\./, ''),
          isShyTalk: pkg.startsWith('com.shyden.shytalk'),
          isLauncher: /launcher/i.test(pkg),
        };
      }
    } catch {
      /* device asleep or adb busy — reported as null, never guessed */
    }
  }
  return activity;
}

function snapshot(runDir) {
  if (!runDir || !fs.existsSync(runDir)) {
    return { runId: null, state: 'no-run', counts: null, cells: [], log: '', devices: devices() };
  }

  const logText = readFile(path.join(runDir, 'log'));
  const pid = Number(readFile(path.join(runDir, 'pid')).trim()) || null;
  const sentinel = fs.existsSync(path.join(runDir, 'DONE'))
    ? 'DONE'
    : fs.existsSync(path.join(runDir, 'FAIL'))
      ? 'FAIL'
      : undefined;

  // The matrix plan. `local` is the full device+browser fan-out.
  const target = process.env.GAUNTLET_TARGET || 'local';
  const planned = allowedCellsFor(target);

  const reportDir = path.join(runDir, 'report');
  const artifacts = scanScenarioArtifacts(reportDir);
  const artifactStats = attributeScenarios(artifacts, planned);

  // Per-scenario detail, newest first: which cell ran it, when, and which
  // personas it captured. This is the expandable view — "what each scenario
  // was run against" — built from artifacts already on disk.
  const scenarioRows = [];
  const byDir = new Map();
  for (const a of artifacts) {
    const m = /^screenshot-(.+)-([^-]+)\.png$/.exec(a.file);
    if (!m) continue;
    let browser = m[1];
    const known = planned.filter((b) => browser === b || browser.startsWith(`${b}-`));
    if (known.length) browser = known.sort((x, y) => y.length - x.length)[0];
    const persona = m[2];
    if (!byDir.has(a.dir))
      byDir.set(a.dir, { dir: a.dir, browser, personas: new Set(), mtimeMs: 0 });
    const row = byDir.get(a.dir);
    row.personas.add(persona);
    if (a.mtimeMs > row.mtimeMs) row.mtimeMs = a.mtimeMs;
  }
  for (const row of byDir.values()) {
    scenarioRows.push({
      index: Number((/scenario-(\d+)/.exec(row.dir) || [])[1] ?? -1),
      dir: row.dir,
      browser: row.browser,
      personas: [...row.personas].sort(),
      atMs: row.mtimeMs,
    });
  }
  scenarioRows.sort((a, b) => b.atMs - a.atMs);

  let dispatchedAtMs = null;
  try {
    dispatchedAtMs = fs.statSync(path.join(runDir, 'log')).birthtimeMs || null;
  } catch {
    /* keep null */
  }

  // Authoritative per-scenario results. Artifacts are web-only; this stream is
  // emitted by every cell type, so it is what the counters must be built from.
  const progressRecords = parseProgressStream(
    readFile(path.join(reportDir, 'scenario-progress.jsonl')),
  );
  const capsByCell = Object.fromEntries(planned.map((c) => [c, capsFor(c)]));
  const scenarioMatrix = buildScenarioMatrix({
    corpus: CORPUS,
    cells: planned,
    records: progressRecords,
  }).map((row) => {
    // 'n/a' is NOT 'pending'. Rendering an Android-only scenario as pending on
    // chromium promises work that will never happen.
    const applicable = applicableCells(
      CORPUS[row.index] ? CORPUS[row.index].steps || [] : [],
      capsByCell,
    );
    // OBSERVATION BEATS PREDICTION.
    //
    // Operator 2026-08-01: "if the scenario is APP ios or APP android, why is
    // there a dot indicator in chrome and safari columns? doesn't make sense."
    //
    // It did not make sense, and the prediction was the thing at fault. The
    // corpus names a surface in steps that need no device: "Receipt replay
    // attack" is a pure API scenario whose only Android mention is a
    // `is signed in on Android` Given that mints a token. requiredPlatforms
    // called it APP/android; every cell then ran it and reported a real result,
    // so the badge contradicted its own row.
    //
    // A cell that actually PASSED or FAILED a scenario has proved it can run
    // it — that is evidence, where the step text is only a guess. Skips are not
    // evidence either way (a skip is what "cannot run" looks like), so only
    // pass/fail promote a cell.
    for (const cell of planned) {
      if (row.results[cell] === 'pass' || row.results[cell] === 'fail') applicable[cell] = true;
    }
    const results = { ...row.results };
    const summary = { ...row.summary, na: 0 };
    for (const cell of planned) {
      // A skip on a cell that can never run this scenario IS n/a — showing it
      // as a skip marker implies work was declined, when none was ever possible.
      if (!applicable[cell] && (results[cell] === 'pending' || results[cell] === 'skipped')) {
        summary[results[cell]] -= 1;
        results[cell] = 'na';
        summary.na += 1;
      }
    }
    // kind/platforms drive the web-vs-app split in the UI. An app row renders
    // only the device columns it can ever run on; a web row spans every cell.
    let { kind, platforms } = classifyScenario(
      CORPUS[row.index] ? CORPUS[row.index].steps || [] : [],
    );
    // Same correction applied to the LABEL. If a web-only cell has actually run
    // this scenario, it needs no device, whatever its step text implied — so it
    // is a WEB scenario and the badge must say so rather than argue with the
    // row beneath it.
    const ranOnWebOnlyCell = planned.some(
      (c) => capsByCell[c].length === 1 && (row.results[c] === 'pass' || row.results[c] === 'fail'),
    );
    if (ranOnWebOnlyCell) {
      kind = 'web';
      platforms = [];
    }
    return { ...row, results, summary, applicable, kind, platforms };
  });
  // A scenario counts as done when a cell has reported a real result for it.
  const scenarioResultsDone = scenarioMatrix.reduce(
    (n, row) => n + (row.summary.pass + row.summary.fail + row.summary.skipped),
    0,
  );
  // The honest denominator: only combinations that CAN run. Counting all
  // 226 x 12 claimed 2712 when just 948 are reachable.
  const scenarioResultsTotal = scenarioMatrix.reduce(
    (n, row) => n + (planned.length - row.summary.na),
    0,
  );

  // Counts from the JSONL (every cell writes it), recency from whichever signal
  // is newer. Using artifacts alone reported working mobile/native cells as
  // "0 scenarios, stalled" — twice.
  const scenarioStats = mergeCellActivity({ records: progressRecords, artifactStats });

  const progress = buildProgress({
    planned,
    logText,
    sentinel,
    pidAlive: pidAlive(pid),
    started: Boolean(pid),
    scenarioStats,
    dispatchedAtMs,
  });

  let startedAt = null;
  try {
    startedAt = fs.statSync(runDir).birthtimeMs || fs.statSync(runDir).ctimeMs;
  } catch {
    /* keep null */
  }

  return {
    runId: path.basename(runDir),
    runDir,
    pid,
    startedAt,
    elapsed: startedAt ? formatElapsed(Date.now() - startedAt) : null,
    ...progress,
    // Last 60 lines only — the dashboard is a status view, not a log viewer.
    log: logText.split('\n').slice(-60).join('\n'),
    devices: devices(),
    deviceActivity: deviceActivity(),
    scenariosDone: scenarioResultsDone,
    scenarioProgress: scenarioProgress({
      done: scenarioResultsDone,
      perCellTotal: scenarioResultsTotal,
      cellsTotal: 1,
      elapsedMs: startedAt ? Date.now() - startedAt : 0,
    }),
    corpusScenarios: CORPUS_SCENARIOS,
    // Web-vs-app split, so the operator can see at a glance how much of the
    // corpus needs a device at all. Counted from the same classification the
    // rows carry, never separately.
    scenarioKinds: scenarioMatrix.reduce(
      (acc, r) => {
        acc[r.kind] += 1;
        for (const p of r.platforms) acc.byPlatform[p] = (acc.byPlatform[p] || 0) + 1;
        return acc;
      },
      { web: 0, app: 0, cross: 0, byPlatform: {} },
    ),
    scenarioRows: scenarioRows.slice(0, 300),
    // The full scenario x cell grid: EVERY corpus scenario, with a per-cell
    // result. Fed by the runner's JSONL stream, which is the only signal that
    // exists for native device cells.
    cellNames: planned,
    matrix: scenarioMatrix,
    // WHICH ENVIRONMENT IS UNDER TEST. Operator 2026-08-01: "we also need to be
    // able to see the environment under test. I.E. local or dev." A dashboard
    // that looks identical for local and dev is how a green board gets read as
    // a dev result when it was localhost all along.
    target,
    // THREE LISTS, each with only its own columns. Operator: "scenarios should
    // be split up into 3 separate lists... first list, only - show only the
    // apps. second list, web only, show only the browsers. third list, cross
    // over, show the browsers used and device used for the app side."
    //
    // The lists line up with the cells because `phaseOf` and `classifyScenario`
    // now speak the same vocabulary — app/web/cross. Under the old matrix every
    // cell was a browser cell, so an APP scenario had nowhere to render but the
    // browser columns, and the board showed `chrome·A 🤖 samsung·A 🤖 edge·A 🤖
    // firefox·A` for work that runs on ONE phone.
    phases: PHASES.map((phase) => {
      const cells = planned.filter((c) => phaseOf(c) === phase);
      const rows = scenarioMatrix.filter((r) => r.kind === phase);
      // Counted from THIS PHASE'S CELLS, never from `row.summary`.
      //
      // `row.summary` is the whole-matrix tally for that scenario — all 16
      // cells. Reusing it made the phase status answer a different question
      // than the one asked: on the very first dispatch, with only the app
      // phase running, the board showed `web: red` and `cross: running` for
      // phases whose cells had not been touched. The failures it was reading
      // belonged to other cells entirely.
      //
      // Same correction the dashboard's per-phase table already makes. A tally
      // is only meaningful over the set the question is about.
      const totals = { pass: 0, fail: 0, skipped: 0, pending: 0 };
      for (const r of rows) {
        for (const cell of cells) {
          const state = r.results[cell] || 'pending';
          // 'na' is neither work done nor work owed — this cell can never run
          // this scenario, so counting it would make the phase permanently
          // "pending" and never green.
          if (state !== 'na' && totals[state] !== undefined) totals[state] += 1;
        }
      }
      return { phase, cells, scenarios: rows.length, totals, status: phaseStatus(totals) };
    }),
    // EVERY FAILURE, WITH ITS DIAGNOSIS. Operator 2026-08-01: the failures view
    // "must include all the information the scenarios currently show. but also
    // more details, including all steps, the exact step that failed and any
    // screenshots. it must also show expected vs actual".
    //
    // Built from the same progress stream the grid reads, so a red cross and
    // its explanation can never disagree. Newest first: on a long run the
    // failure you care about is the one that just happened.
    failures: progressRecords
      .filter((r) => r.status === 'fail')
      .map((r) =>
        buildFailureDetail({
          record: r,
          steps: (CORPUS.find((c) => c.file === r.file && c.scenario === r.scenario) || {}).steps,
          reportDir,
        }),
      )
      .sort((a, b) => (b.at || 0) - (a.at || 0)),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * A phase's verdict from what its scenarios have actually reported.
 *
 * Ordered so the worst honest answer wins: a single fail makes the phase red no
 * matter how much passed, and "green" requires that nothing is still pending —
 * otherwise a phase reads as complete while most of its work has not run.
 */
function phaseStatus(totals) {
  if (totals.fail > 0) return 'red';
  if (totals.pending > 0) return totals.pass + totals.skipped > 0 ? 'running' : 'pending';
  if (totals.pass + totals.skipped > 0) return 'green';
  return 'pending';
}

const DASHBOARD = fs.readFileSync(path.join(__dirname, 'progress-dashboard.html'), 'utf8');

function main() {
  const port = Number(arg('--port', DEFAULT_PORT));
  const fixedRunDir = arg('--run-dir', null);

  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/progress')) {
      let body;
      try {
        body = JSON.stringify(snapshot(fixedRunDir || latestRunDir()));
      } catch (err) {
        // Degrade, never 500 into a blank dashboard.
        body = JSON.stringify({ state: 'no-run', counts: null, cells: [], error: err.message });
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(body);
      return;
    }
    // Failure screenshots. Read-only, and confined to the CURRENT run's report
    // directory — the path is resolved and then checked against that root, so a
    // `..` traversal cannot turn a progress viewer into a file server. Only the
    // image types the runner writes are served, because a viewer that will
    // return any file type is a viewer that will eventually return a token.
    if (req.url.startsWith('/api/artifact')) {
      const runDir = fixedRunDir || latestRunDir();
      const rel = new URL(req.url, 'http://127.0.0.1').searchParams.get('path') || '';
      const root = runDir ? path.resolve(path.join(runDir, 'report')) : null;
      const abs = root ? path.resolve(path.join(root, rel)) : null;
      const inside = abs && !path.relative(root, abs).startsWith('..');
      const ext = abs ? path.extname(abs).toLowerCase() : '';
      const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
      if (!inside || !TYPES[ext] || !fs.existsSync(abs)) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': TYPES[ext], 'cache-control': 'no-store' });
      fs.createReadStream(abs).pipe(res);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(DASHBOARD);
  });

  // Bind to loopback only: this exposes device serials and run paths, and has
  // no business being reachable from the network.
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`[gauntlet-ui] dashboard on ${url}`);
    // Report the RUN, not the search root. This printed `GAUNTLET_TMP` — one of
    // two places it looks, and not the one it had just chosen — so the banner
    // named a directory the dashboard was not showing. Saying "no run found yet"
    // out loud also beats an empty page with a confident path under it.
    const watching = fixedRunDir || latestRunDir();
    console.log(
      watching
        ? `[gauntlet-ui] watching ${watching}`
        : `[gauntlet-ui] no run found yet in ${GAUNTLET_TMP} or ${RUN_JOURNEYS_TMP}/${RUN_JOURNEYS_PREFIX}* — will pick one up as soon as it starts`,
    );
    if (process.argv.includes('--open')) {
      try {
        execFileSync('/usr/bin/open', [url], { stdio: 'ignore' });
      } catch {
        console.log('[gauntlet-ui] could not auto-open a browser; visit the URL above');
      }
    }
  });

  // Self-repair: a busy port is usually a previous instance still shutting
  // down, so retry instead of exiting. Exiting here is what left the operator
  // staring at "progress server unreachable" with nothing recovering.
  let bindAttempts = 0;
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      bindAttempts += 1;
      if (bindAttempts > MAX_BIND_ATTEMPTS) {
        console.error(
          `[gauntlet-ui] port ${port} still busy after ${bindAttempts} tries — giving up`,
        );
        process.exit(0);
      }
      const wait = retryDelayMs(bindAttempts);
      console.error(`[gauntlet-ui] port ${port} busy, retrying in ${wait}ms (${bindAttempts})`);
      setTimeout(() => server.listen(port, '127.0.0.1'), wait);
      return;
    }
    console.error(`[gauntlet-ui] server error: ${err.message}`);
  });

  // A snapshot can throw on a half-written artifact mid-scan. Log and keep
  // serving — the viewer must outlive transient filesystem races.
  process.on('uncaughtException', (err) => {
    console.error(`[gauntlet-ui] recovered from: ${err.message}`);
  });
}

if (require.main === module) main();

module.exports = { snapshot, latestRunDir };

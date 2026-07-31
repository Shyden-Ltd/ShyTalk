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
  formatElapsed,
  retryDelayMs,
} = require('./progress-model');
const { allowedBrowsersFor } = require('../browser-allowlist');

const GAUNTLET_TMP = process.env.GAUNTLET_TMP || '/tmp/shytalk-gauntlet';
const DEFAULT_PORT = Number(process.env.GAUNTLET_UI_PORT || 4310);
const MAX_BIND_ATTEMPTS = 30;

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

/** Newest run directory, or null when none exists yet. */
function latestRunDir() {
  try {
    const entries = fs
      .readdirSync(GAUNTLET_TMP, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'latest')
      .map((e) => path.join(GAUNTLET_TMP, e.name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return entries[0] || null;
  } catch {
    return null;
  }
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
  const planned = allowedBrowsersFor(process.env.GAUNTLET_TARGET || 'local');

  const reportDir = path.join(runDir, 'report');
  const artifacts = scanScenarioArtifacts(reportDir);
  const scenarioStats = attributeScenarios(artifacts, planned);

  let dispatchedAtMs = null;
  try {
    dispatchedAtMs = fs.statSync(path.join(runDir, 'log')).birthtimeMs || null;
  } catch {
    /* keep null */
  }

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
    scenariosDone: Object.values(scenarioStats).reduce((n, v) => n + v.scenarios, 0),
    generatedAt: new Date().toISOString(),
  };
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
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(DASHBOARD);
  });

  // Bind to loopback only: this exposes device serials and run paths, and has
  // no business being reachable from the network.
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`[gauntlet-ui] dashboard on ${url}`);
    console.log(`[gauntlet-ui] watching ${fixedRunDir || GAUNTLET_TMP}`);
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

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

const { buildProgress, formatElapsed } = require('./progress-model');
const { allowedBrowsersFor } = require('../browser-allowlist');

const GAUNTLET_TMP = process.env.GAUNTLET_TMP || '/tmp/shytalk-gauntlet';
const DEFAULT_PORT = Number(process.env.GAUNTLET_UI_PORT || 4310);

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

  const progress = buildProgress({
    planned,
    logText,
    sentinel,
    pidAlive: pidAlive(pid),
    started: Boolean(pid),
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
    generatedAt: new Date().toISOString(),
  };
}

const DASHBOARD = fs.readFileSync(path.join(__dirname, 'progress-dashboard.html'), 'utf8');

function main() {
  const port = Number(arg('--port', DEFAULT_PORT));
  const fixedRunDir = arg('--run-dir', null);

  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/progress')) {
      const body = JSON.stringify(snapshot(fixedRunDir || latestRunDir()));
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

  server.on('error', (err) => {
    // Never take the gauntlet down over the viewer failing to bind.
    console.error(`[gauntlet-ui] could not start: ${err.message}`);
    process.exit(0);
  });
}

if (require.main === module) main();

module.exports = { snapshot, latestRunDir };

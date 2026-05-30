/**
 * Web driver: Mobile Firefox on Android via Marionette + Geckodriver.
 *
 * Firefox doesn't speak CDP — its remote-debugging protocol is Marionette,
 * Mozilla's own RPC. Geckodriver is Mozilla's W3C-WebDriver-compliant
 * bridge that wraps Marionette so external tools can drive Firefox via
 * the standard /session + /url + /execute/sync REST surface.
 *
 * For **Firefox on Android** (Firefox 113+, including the standard
 * Play Store release channel), geckodriver supports an `androidPackage`
 * capability that handles all the adb-side plumbing internally — it
 * forwards Marionette's port (typically 2828) over adb, launches the
 * app via `am start`, and exposes a local HTTP endpoint on the chosen
 * port (default 4444).
 *
 * Wire-up
 * -------
 * 1. Operator installs geckodriver (`brew install geckodriver`).
 * 2. Operator installs Firefox on the Android device from the Play
 *    Store + enables USB debugging.
 * 3. Operator opens Firefox → about:config → set `marionette.enabled`
 *    to true (one-time per app install).
 * 4. Driver spawns `geckodriver --port <chosen> --host 127.0.0.1`.
 * 5. Driver POSTs /session with `androidPackage: org.mozilla.firefox`
 *    + `androidActivity: org.mozilla.fenix.IntentReceiverActivity`.
 *    Geckodriver brokers the adb-side launch + Marionette connection.
 * 6. Driver uses standard W3C WebDriver endpoints for navigation +
 *    page-text extraction.
 *
 * Method-naming contract: mirrors web-playwright-driver.js. Runner
 * matchers swap transparently.
 *
 * Local-matrix only — operator policy 2026-05-30 keeps dev/prod to
 * Chromium-only-plus-Chrome-on-Android.
 */

/* eslint-disable no-console -- driver methods log diagnostics for the
   manual QA runner (operator-facing CLI), not application code. */

const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');

const FIREFOX_ANDROID_PACKAGE = 'org.mozilla.firefox';
const FIREFOX_ANDROID_ACTIVITY = 'org.mozilla.fenix.IntentReceiverActivity';

/**
 * Default geckodriver binary locations. Mirrors android-cdp-helpers
 * pattern. Walks the list in order; first that exists wins.
 */
const KNOWN_GECKODRIVER_PATHS = [
  '/opt/homebrew/bin/geckodriver', // Apple Silicon Homebrew
  '/usr/local/bin/geckodriver', // Intel Mac Homebrew + Linux
  '/usr/bin/geckodriver',
];

function resolveGeckodriverPath(fsImpl = fs) {
  for (const p of KNOWN_GECKODRIVER_PATHS) {
    try {
      if (fsImpl.existsSync(p)) return p;
    } catch (_e) {
      /* keep walking */
    }
  }
  return 'geckodriver';
}

/**
 * Pick a free TCP port. Same shape as android-cdp-helpers' helper —
 * inlined here so the firefox driver doesn't take a hard dep on the
 * Android-CDP module (it's a different transport family).
 */
function pickFreePort(netImpl = net) {
  return new Promise((resolve, reject) => {
    const srv = netImpl.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Wait for geckodriver to be ready by polling its /status endpoint.
 * Returns when /status returns 2xx with `ready: true`; rejects on
 * timeout.
 *
 * `nowMs` + `sleepMs` are injectable for tests (no real wall-clock
 * waits in unit tests).
 */
async function waitForGeckodriverReady({
  port,
  fetchImpl,
  timeoutMs = 30000,
  nowMs = () => Date.now(),
  sleepMs = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const deadline = nowMs() + timeoutMs;
  let lastErr = null;
  while (nowMs() < deadline) {
    try {
      const r = await fetchImpl(`http://127.0.0.1:${port}/status`);
      if (r.ok) {
        const body = await r.json();
        if (body && body.value && body.value.ready === true) return true;
      }
      lastErr = `status ${r.status}`;
    } catch (e) {
      lastErr = e.message;
    }
    await sleepMs(100);
  }
  throw new Error(
    `geckodriver on port ${port} did not become ready within ${timeoutMs}ms (last: ${lastErr || 'no response'}). Confirm \`geckodriver\` is on PATH + Firefox is installed on the Android device.`,
  );
}

/**
 * Driver factory.
 *
 *   const driver = await createMobileFirefoxAndroidDriver({ baseURL });
 *   await driver.webRefreshRoomsList('Alice');
 *   await driver.close();
 *
 * Injectable deps (test-only):
 *   - geckodriverPath, spawnImpl — replace child_process.spawn
 *   - fetchImpl — replace HTTP client
 *   - pickPort — deterministic port selection
 *   - waitForReady — replace the readiness poll
 */
async function createMobileFirefoxAndroidDriver({
  baseURL = 'http://localhost:8888',
  geckodriverPath,
  spawnImpl = spawn,
  fetchImpl = globalThis.fetch,
  pickPort = () => pickFreePort(),
  waitForReady = waitForGeckodriverReady,
} = {}) {
  const gecko = geckodriverPath || resolveGeckodriverPath();
  const port = await pickPort();

  // Spawn geckodriver as a detached child so it can outlive any errors
  // in our own setup; on driver.close() we send SIGTERM + wait.
  let geckoProc;
  try {
    geckoProc = spawnImpl(gecko, ['--port', String(port), '--host', '127.0.0.1'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    throw new Error(
      `[mobile-firefox-android-driver] failed to spawn geckodriver at "${gecko}": ${e.message}. Install geckodriver (\`brew install geckodriver\`).`,
      { cause: e },
    );
  }

  // Surface geckodriver-side errors on stderr to the runner's stderr so
  // the operator can debug. We don't propagate them as test failures —
  // geckodriver writes lots of non-fatal info to stderr.
  if (geckoProc.stderr) {
    geckoProc.stderr.on('data', (chunk) => {
      // Best-effort log; never throw from a stream listener.
      try {
        process.stderr.write(`[geckodriver] ${chunk}`);
      } catch (_e) {
        /* swallow */
      }
    });
  }

  // If geckodriver exits before we can connect, fail fast with a clear
  // error rather than hanging in waitForReady.
  let earlyExitErr = null;
  if (geckoProc.on) {
    geckoProc.on('exit', (code, signal) => {
      if (code !== 0 && code !== null) {
        earlyExitErr = `geckodriver exited early with code=${code} signal=${signal}`;
      }
    });
  }

  try {
    await waitForReady({ port, fetchImpl });
  } catch (e) {
    // Best-effort cleanup of the geckodriver process.
    try {
      if (geckoProc && typeof geckoProc.kill === 'function') geckoProc.kill('SIGTERM');
    } catch (_e) {
      /* swallow */
    }
    const reason = earlyExitErr || e.message;
    throw new Error(`[mobile-firefox-android-driver] geckodriver not ready: ${reason}`, {
      cause: e,
    });
  }

  let _sessionId = null;
  async function ensureSession() {
    if (_sessionId) return _sessionId;
    const caps = {
      capabilities: {
        alwaysMatch: {
          browserName: 'firefox',
          'moz:firefoxOptions': {
            androidPackage: FIREFOX_ANDROID_PACKAGE,
            androidActivity: FIREFOX_ANDROID_ACTIVITY,
          },
        },
      },
    };
    const r = await fetchImpl(`http://127.0.0.1:${port}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(caps),
    });
    if (!r.ok) {
      throw new Error(
        `geckodriver /session failed (${r.status}): ${(await r.text()).slice(0, 500)}. Confirm Firefox is installed on the Android device + USB debugging is enabled + \`marionette.enabled\` is true in Firefox's about:config.`,
      );
    }
    const body = await r.json();
    _sessionId = body.value?.sessionId || body.sessionId;
    if (!_sessionId) {
      throw new Error(
        `geckodriver /session returned no sessionId: ${JSON.stringify(body).slice(0, 500)}`,
      );
    }
    return _sessionId;
  }

  async function navigateTo(url) {
    const sid = await ensureSession();
    const r = await fetchImpl(`http://127.0.0.1:${port}/session/${sid}/url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!r.ok) {
      throw new Error(
        `geckodriver /url failed (${r.status}) for ${url}: ${(await r.text()).slice(0, 300)}`,
      );
    }
  }

  async function getPageText() {
    const sid = await ensureSession();
    const r = await fetchImpl(`http://127.0.0.1:${port}/session/${sid}/execute/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        script: 'return document.body.innerText || "";',
        args: [],
      }),
    });
    if (!r.ok) {
      throw new Error(
        `geckodriver /execute/sync failed (${r.status}): ${(await r.text()).slice(0, 300)}`,
      );
    }
    const body = await r.json();
    return body.value || '';
  }

  const driver = {
    _port: port,
    _baseURL: baseURL,
    _geckoProc: geckoProc,
    _geckodriverPath: gecko,
  };

  driver.webRefreshRoomsList = async (_name) => {
    try {
      await navigateTo(`${baseURL.replace(/\/$/, '')}/rooms`);
      return true;
    } catch (e) {
      console.error(
        `[mobile-firefox-android-driver] webRefreshRoomsList(${_name}) failed: ${e.message}`,
      );
      return false;
    }
  };

  driver.webUiDump = async () => {
    try {
      return await getPageText();
    } catch (e) {
      console.error(`[mobile-firefox-android-driver] webUiDump failed: ${e.message}`);
      return '';
    }
  };

  driver.close = async () => {
    if (_sessionId) {
      try {
        await fetchImpl(`http://127.0.0.1:${port}/session/${_sessionId}`, { method: 'DELETE' });
      } catch (_e) {
        /* best-effort */
      }
      _sessionId = null;
    }
    if (geckoProc && typeof geckoProc.kill === 'function') {
      try {
        geckoProc.kill('SIGTERM');
      } catch (_e) {
        /* swallow */
      }
    }
  };

  return driver;
}

// Canonical method surface — pinned by driver-contract.test.js.
const WEB_MOBILE_METHOD_NAMES = ['webRefreshRoomsList', 'webUiDump'];

function listMethods() {
  return [...WEB_MOBILE_METHOD_NAMES].sort();
}

module.exports = {
  KNOWN_GECKODRIVER_PATHS,
  FIREFOX_ANDROID_PACKAGE,
  FIREFOX_ANDROID_ACTIVITY,
  resolveGeckodriverPath,
  pickFreePort,
  WEB_MOBILE_METHOD_NAMES,
  listMethods,
  waitForGeckodriverReady,
  createMobileFirefoxAndroidDriver,
};

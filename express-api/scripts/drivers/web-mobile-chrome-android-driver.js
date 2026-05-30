/* global document */
/**
 * Web driver: Mobile Chrome on Android via CDP-over-adb.
 *
 * Drives the actual Chrome browser running on the operator's connected
 * Android device — not Playwright's "Pixel 5 emulation" (which is just
 * desktop Chromium with mobile UA/viewport). That distinction matters
 * for the matrix-completeness rule: local validation requires real
 * Android × Mobile Chrome coverage, not a fake.
 *
 * Wire-up
 * -------
 * 1. Operator enables USB debugging on the Android device.
 * 2. Operator enables Chrome → chrome://flags → "Enable command line on
 *    non-rooted devices" + restarts Chrome (one-time per device).
 *    Alternative: open Chrome → settings → Developer options → enable
 *    "USB Web debugging".
 * 3. Driver runs `adb forward tcp:<port> localabstract:chrome_devtools_remote`
 *    so localhost:<port> tunnels into Chrome's CDP socket on the device.
 * 4. Driver calls `playwright.chromium.connectOverCDP(endpointURL)` to
 *    attach Playwright to the remote browser.
 * 5. Driver uses Playwright's Page API the same way as web-playwright-
 *    driver.js — methods are pin-compatible so the runner can swap.
 *
 * Method-naming contract: mirrors `web-playwright-driver.js`. The runner
 * doesn't care which driver it gets — they expose the same surface so
 * scenarios run unchanged across Mac × {chromium, firefox, webkit, edge}
 * and Android × Mobile Chrome.
 *
 * Failure modes (all return false + log, never throw):
 *   - adb not on PATH → "adb not found; install platform-tools"
 *   - no device attached → "no Android device; check `adb devices`"
 *   - Chrome not running on device → "Chrome not running; launch it
 *     manually + enable USB Web debugging"
 *   - CDP port already forwarded by another tool → use SO_REUSEPORT
 *     pattern: pick next free port, log the chosen port.
 *
 * The driver uses `execFileSync('/usr/bin/adb', ...)` on macOS;
 * platform-tools is installed at a fixed Apple-Homebrew location.
 * Tests inject a custom `adbPath` so cross-platform CI doesn't require
 * a real adb.
 */

/* eslint-disable no-console -- driver methods log diagnostics for the
   manual QA runner (operator-facing CLI), not application code. */

const path = require('path');
const { execFileSync: realExecFileSync } = require('child_process');
const net = require('net');

/**
 * Default adb binary location. The Homebrew + Android SDK both install
 * adb to /usr/local/bin or /opt/homebrew/bin; preferring the latter on
 * Apple Silicon Macs. Falls back to the bare `adb` (PATH lookup) only
 * for non-macOS test environments.
 *
 * For sonarjs/no-os-command-from-path compliance, the resolution is
 * lazy: we walk a list of known absolute paths, return the first that
 * exists, and only fall back to the bare name if every absolute path is
 * absent — which only happens in CI mocks anyway.
 */
const KNOWN_ADB_PATHS = [
  '/opt/homebrew/bin/adb', // Apple Silicon Homebrew
  '/usr/local/bin/adb', // Intel Mac Homebrew + Linux
  '/usr/bin/adb', // some Linux distros
];

function resolveAdbPath(fsImpl = require('fs')) {
  for (const p of KNOWN_ADB_PATHS) {
    try {
      if (fsImpl.existsSync(p)) return p;
    } catch (_e) {
      /* keep walking */
    }
  }
  return 'adb';
}

let _playwright;
function loadPlaywright() {
  if (_playwright) return _playwright;
  try {
    _playwright = require('playwright');
    return _playwright;
  } catch (bareErr) {
    if (bareErr.code !== 'MODULE_NOT_FOUND') throw bareErr;
  }
  const repoRoot = path.resolve(__dirname, '../../..');
  const playwrightPath = path.join(repoRoot, 'node_modules', 'playwright');
  _playwright = require(playwrightPath);
  return _playwright;
}

/**
 * Pick a free TCP port in the localhost range. Used so concurrent
 * dispatches (or stale adb forward entries) don't collide on a fixed
 * 9222. Returns a Promise<number>.
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
 * Set up the adb port-forward `localhost:<port>` → device's
 * chrome_devtools_remote unix socket. Returns the chosen port + a
 * cleanup function that removes the forward.
 *
 * `adbPath` defaults to resolveAdbPath(); `execFileSync` defaults to
 * the real Node primitive but is injectable for tests.
 *
 * Throws if adb is missing or no device is attached — those are
 * actionable operator errors that should not be swallowed.
 */
async function bootstrapAdbForward({
  adbPath,
  execFileSync = realExecFileSync,
  pickPort = () => pickFreePort(),
} = {}) {
  const adb = adbPath || resolveAdbPath();
  // Sanity: at least one device. Empty `adb devices` output → operator
  // forgot to plug in / authorise USB debugging.
  let devicesOut;
  try {
    devicesOut = execFileSync(adb, ['devices'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new Error(
        `[mobile-chrome-android-driver] adb not found at "${adb}". Install Android platform-tools (Homebrew: \`brew install android-platform-tools\`).`,
        { cause: e },
      );
    }
    throw new Error(`[mobile-chrome-android-driver] adb invocation failed: ${e.message}`, {
      cause: e,
    });
  }
  // `adb devices` output shape:
  //   List of devices attached
  //   ABCDEF12<TAB>device
  const lines = String(devicesOut)
    .split('\n')
    .filter((l) => /\t(device|unauthorized)\b/.test(l));
  if (lines.length === 0) {
    throw new Error(
      '[mobile-chrome-android-driver] no Android device attached. Check `adb devices` and ensure USB debugging is authorised on the device.',
    );
  }
  const unauthorised = lines.filter((l) => /\tunauthorized\b/.test(l));
  if (unauthorised.length === lines.length) {
    throw new Error(
      '[mobile-chrome-android-driver] Android device is unauthorised. Tap "Allow USB debugging" on the device when prompted.',
    );
  }

  const port = await pickPort();
  try {
    execFileSync(adb, ['forward', `tcp:${port}`, 'localabstract:chrome_devtools_remote'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    throw new Error(
      `[mobile-chrome-android-driver] adb forward failed: ${e.message}. Make sure Chrome is open on the device + USB Web debugging is enabled in chrome://flags.`,
      { cause: e },
    );
  }

  const removeForward = () => {
    try {
      execFileSync(adb, ['forward', '--remove', `tcp:${port}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (_e) {
      /* best-effort cleanup */
    }
  };
  return { port, removeForward };
}

/**
 * Driver factory.
 *
 *   const driver = await createMobileChromeAndroidDriver({ baseURL });
 *   ctx.webDriver = driver;
 *   await driver.webRefreshRoomsList('Alice');
 *   await driver.close();
 *
 * Injectable deps (test-only):
 *   - adbPath, execFileSync — replace adb interaction
 *   - playwrightImpl — replace playwright module
 *   - pickPort — deterministic port selection
 */
async function createMobileChromeAndroidDriver({
  baseURL = 'http://localhost:8888',
  adbPath,
  execFileSync,
  playwrightImpl,
  pickPort,
} = {}) {
  const { port, removeForward } = await bootstrapAdbForward({
    adbPath,
    execFileSync,
    pickPort,
  });

  const pw = playwrightImpl || loadPlaywright();
  const endpointURL = `http://127.0.0.1:${port}`;
  let browser;
  try {
    browser = await pw.chromium.connectOverCDP(endpointURL);
  } catch (e) {
    removeForward();
    throw new Error(
      `[mobile-chrome-android-driver] connectOverCDP(${endpointURL}) failed: ${e.message}. Confirm Chrome is open on the device + chrome://inspect/#devices lists it from your Mac.`,
      { cause: e },
    );
  }

  // CDP-attached browsers expose the existing tabs as contexts. We don't
  // create new ones (Mobile Chrome can have at most one window of tabs;
  // a new BrowserContext is silently ignored). Per-persona isolation is
  // approximated by per-persona Page within the existing context — good
  // enough for j09's single-persona web flows; future PR can stretch
  // this once we have multi-persona web Android scenarios.
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    removeForward();
    await browser.close().catch(() => {});
    throw new Error(
      '[mobile-chrome-android-driver] CDP returned 0 contexts — Chrome may be in incognito-only mode. Switch to a normal tab + retry.',
    );
  }
  const ctx = contexts[0];

  const pages = new Map();

  async function pageFor(name) {
    if (pages.has(name)) return pages.get(name);
    const page = await ctx.newPage();
    pages.set(name, page);
    return page;
  }

  const driver = {
    _browser: browser,
    _ctx: ctx,
    _port: port,
    _baseURL: baseURL,
    _pages: pages,
    pageFor,
  };

  // webRefreshRoomsList — same contract as the desktop web driver.
  driver.webRefreshRoomsList = async (name) => {
    try {
      const page = await pageFor(name);
      await page.goto(`${baseURL.replace(/\/$/, '')}/rooms`);
      return true;
    } catch (e) {
      console.error(
        `[mobile-chrome-android-driver] webRefreshRoomsList(${name}) failed: ${e.message}`,
      );
      return false;
    }
  };

  // webUiDump — visible text content for assertion matchers. Same shape
  // as the desktop driver so matchers can swap drivers transparently.
  driver.webUiDump = async () => {
    try {
      const page = await pageFor('default');
      if (!page.url() || page.url() === 'about:blank')
        await page.goto(`${baseURL.replace(/\/$/, '')}/`);
      // Note: await before return so the try/catch actually catches a
      // rejected evaluate (a bare `return page.evaluate(...)` escapes
      // the catch since the rejection happens after this function's
      // microtask boundary).
      return await page.evaluate(() => document.body.innerText || '');
    } catch (e) {
      console.error(`[mobile-chrome-android-driver] webUiDump failed: ${e.message}`);
      return '';
    }
  };

  driver.close = async () => {
    for (const p of pages.values()) {
      try {
        await p.close();
      } catch (_e) {
        /* best-effort */
      }
    }
    try {
      await browser.close();
    } catch (_e) {
      /* best-effort — CDP-attached close can race with device-side teardown */
    }
    removeForward();
  };

  return driver;
}

module.exports = {
  KNOWN_ADB_PATHS,
  resolveAdbPath,
  pickFreePort,
  bootstrapAdbForward,
  createMobileChromeAndroidDriver,
};

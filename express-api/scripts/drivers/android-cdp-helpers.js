/**
 * Shared CDP-over-adb plumbing used by Android mobile-browser drivers
 * (Mobile Chrome, Samsung Internet, Mobile Edge — every Chromium-fork
 * browser that exposes a Chrome DevTools Protocol unix socket on
 * Android exposes it via `localabstract:<socket-name>`).
 *
 * Each browser ships its own socket name (Chrome: `chrome_devtools_remote`,
 * Samsung: `com.sec.android.app.sbrowser_devtools_remote`, Edge:
 * `com.microsoft.emmx_devtools_remote`). The bootstrap flow is otherwise
 * identical:
 *   1. Pick a free local TCP port.
 *   2. `adb forward tcp:<port> localabstract:<socket-name>` so
 *      `localhost:<port>` tunnels into the device's CDP socket.
 *   3. Hand the port back to the driver, which then
 *      `playwright.chromium.connectOverCDP(`http://127.0.0.1:<port>`)`s
 *      to the browser-on-device.
 *
 * Extracted from web-mobile-chrome-android-driver.js so the Samsung +
 * Edge drivers can reuse it without copy-paste. The chrome driver itself
 * still re-exports these helpers for backwards-compatibility with any
 * test or downstream that imports from it.
 */

const { execFileSync: realExecFileSync } = require('child_process');
const net = require('net');

/**
 * Default adb binary locations. Tried in priority order; first that
 * exists wins. The Homebrew + Android SDK both install adb to
 * /usr/local/bin or /opt/homebrew/bin; preferring the latter on Apple
 * Silicon. PATH fallback (`'adb'`) keeps CI mocks happy when no
 * absolute path exists in the test fs.
 */
const KNOWN_ADB_PATHS = [
  '/opt/homebrew/bin/adb', // Apple Silicon Homebrew
  '/usr/local/bin/adb', // Intel Mac Homebrew + Linux
  '/usr/bin/adb', // some Linux distros
];

/**
 * Default CDP socket name for stock Chrome on Android. Other browsers
 * override via the `socketName` parameter to bootstrapAdbForward.
 */
const DEFAULT_CDP_SOCKET = 'chrome_devtools_remote';

function resolveAdbPath(fsImpl = require('fs')) {
  for (const p of KNOWN_ADB_PATHS) {
    try {
      if (fsImpl.existsSync(p)) return p;
    } catch (_e) {
      /* keep walking; permission errors don't disqualify other paths */
    }
  }
  return 'adb';
}

/**
 * Picks a free TCP port via net.createServer({port:0}) + close. Returns
 * a Promise<number>. Used so concurrent dispatches + stale adb-forward
 * entries don't collide on a fixed port.
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
 * Sets up the adb port-forward `localhost:<port>` → device's
 * <socketName> unix socket. Returns the chosen port + a cleanup
 * function that removes the forward.
 *
 * Caller supplies `socketName` (e.g. 'chrome_devtools_remote' for
 * Chrome, 'com.sec.android.app.sbrowser_devtools_remote' for Samsung).
 *
 * Throws if adb is missing or no device is attached — those are
 * actionable operator errors that should not be swallowed.
 *
 * Args:
 *   socketName        — required string, the unix abstract socket name
 *                       on the device side (no 'localabstract:' prefix).
 *   adbPath           — absolute path to adb; defaults to resolveAdbPath().
 *   execFileSync      — child_process.execFileSync (injectable for tests).
 *   pickPort          — port-picking fn (injectable for tests).
 *   browserNameHint   — operator-facing string for error messages (e.g.
 *                       'Chrome' / 'Samsung Internet'); defaults to
 *                       'the browser'.
 */
async function bootstrapAdbForward({
  socketName = DEFAULT_CDP_SOCKET,
  adbPath,
  execFileSync = realExecFileSync,
  pickPort = () => pickFreePort(),
  browserNameHint = 'the browser',
} = {}) {
  if (!socketName || typeof socketName !== 'string') {
    throw new Error(
      `bootstrapAdbForward: socketName is required (got ${JSON.stringify(socketName)}).`,
    );
  }
  const adb = adbPath || resolveAdbPath();
  let devicesOut;
  try {
    devicesOut = execFileSync(adb, ['devices'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new Error(
        `[android-cdp-helpers] adb not found at "${adb}". Install Android platform-tools (Homebrew: \`brew install android-platform-tools\`).`,
        { cause: e },
      );
    }
    throw new Error(`[android-cdp-helpers] adb invocation failed: ${e.message}`, { cause: e });
  }
  // `adb devices` output shape:
  //   List of devices attached
  //   ABCDEF12<TAB>device
  const lines = String(devicesOut)
    .split('\n')
    .filter((l) => /\t(device|unauthorized)\b/.test(l));
  if (lines.length === 0) {
    throw new Error(
      '[android-cdp-helpers] no Android device attached. Check `adb devices` and ensure USB debugging is authorised on the device.',
    );
  }
  const unauthorised = lines.filter((l) => /\tunauthorized\b/.test(l));
  if (unauthorised.length === lines.length) {
    throw new Error(
      '[android-cdp-helpers] Android device is unauthorised. Tap "Allow USB debugging" on the device when prompted.',
    );
  }

  const port = await pickPort();
  try {
    execFileSync(adb, ['forward', `tcp:${port}`, `localabstract:${socketName}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    throw new Error(
      `[android-cdp-helpers] adb forward failed: ${e.message}. Make sure ${browserNameHint} is open on the device + USB Web debugging is enabled.`,
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

module.exports = {
  KNOWN_ADB_PATHS,
  DEFAULT_CDP_SOCKET,
  resolveAdbPath,
  pickFreePort,
  bootstrapAdbForward,
};

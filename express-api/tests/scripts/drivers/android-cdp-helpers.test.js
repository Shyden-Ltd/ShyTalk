/**
 * android-cdp-helpers.test.js
 *
 * Tests for the shared CDP-over-adb helpers used by the Chrome / Samsung
 * Internet / Mobile Edge drivers. Covers what the per-driver test files
 * don't: the `socketName` parameter, the `browserNameHint` parameter for
 * error-message customisation, and the DEFAULT_CDP_SOCKET pin.
 *
 * Path-walking + port-picking + happy/sad device states are exercised
 * thoroughly in web-mobile-chrome-android-driver.test.js (PR #900). This
 * file focuses on what the refactor newly enabled.
 */

const path = require('path');
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const {
  KNOWN_ADB_PATHS,
  DEFAULT_CDP_SOCKET,
  resolveAdbPath,
  pickFreePort,
  bootstrapAdbForward,
} = require(path.join(REPO_ROOT, 'express-api/scripts/drivers/android-cdp-helpers'));

function makeExecFileSyncMock({ devicesOutput = 'List of devices attached\nABC\tdevice\n' } = {}) {
  return jest.fn((bin, args) => {
    if (args[0] === 'devices') return devicesOutput;
    if (args[0] === 'forward') return '';
    return '';
  });
}

describe('android-cdp-helpers — DEFAULT_CDP_SOCKET', () => {
  test('is the chrome socket name (Chrome is the default browser)', () => {
    expect(DEFAULT_CDP_SOCKET).toBe('chrome_devtools_remote');
  });
});

describe('android-cdp-helpers — KNOWN_ADB_PATHS', () => {
  test('exports the Apple-Silicon-first list', () => {
    expect(KNOWN_ADB_PATHS[0]).toBe('/opt/homebrew/bin/adb');
    expect(KNOWN_ADB_PATHS).toContain('/usr/local/bin/adb');
    expect(KNOWN_ADB_PATHS).toContain('/usr/bin/adb');
  });
});

describe('android-cdp-helpers — resolveAdbPath', () => {
  test('returns the first existing path from KNOWN_ADB_PATHS', () => {
    const fs = { existsSync: (p) => p === '/usr/local/bin/adb' };
    expect(resolveAdbPath(fs)).toBe('/usr/local/bin/adb');
  });

  test("falls back to bare 'adb' when none of the known paths exist", () => {
    const fs = { existsSync: () => false };
    expect(resolveAdbPath(fs)).toBe('adb');
  });
});

describe('android-cdp-helpers — pickFreePort (real net)', () => {
  test('returns a valid numeric port via real net.createServer', async () => {
    const port = await pickFreePort();
    expect(typeof port).toBe('number');
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
  });
});

describe('android-cdp-helpers — bootstrapAdbForward socketName customisation', () => {
  test('uses the chrome socket name when socketName defaults', async () => {
    const execFileSync = makeExecFileSyncMock();
    await bootstrapAdbForward({
      adbPath: '/opt/homebrew/bin/adb',
      execFileSync,
      pickPort: async () => 9000,
    });
    expect(execFileSync).toHaveBeenCalledWith(
      '/opt/homebrew/bin/adb',
      ['forward', 'tcp:9000', 'localabstract:chrome_devtools_remote'],
      expect.any(Object),
    );
  });

  test('uses the Samsung Internet socket name when supplied', async () => {
    const execFileSync = makeExecFileSyncMock();
    await bootstrapAdbForward({
      socketName: 'com.sec.android.app.sbrowser_devtools_remote',
      adbPath: '/opt/homebrew/bin/adb',
      execFileSync,
      pickPort: async () => 9001,
    });
    expect(execFileSync).toHaveBeenCalledWith(
      '/opt/homebrew/bin/adb',
      ['forward', 'tcp:9001', 'localabstract:com.sec.android.app.sbrowser_devtools_remote'],
      expect.any(Object),
    );
  });

  test('uses the Mobile Edge socket name when supplied', async () => {
    const execFileSync = makeExecFileSyncMock();
    await bootstrapAdbForward({
      socketName: 'com.microsoft.emmx_devtools_remote',
      adbPath: '/opt/homebrew/bin/adb',
      execFileSync,
      pickPort: async () => 9002,
    });
    expect(execFileSync).toHaveBeenCalledWith(
      '/opt/homebrew/bin/adb',
      ['forward', 'tcp:9002', 'localabstract:com.microsoft.emmx_devtools_remote'],
      expect.any(Object),
    );
  });

  // Note: `undefined` is not in this list because JS destructuring
  // defaults apply for undefined — the helper falls back to
  // DEFAULT_CDP_SOCKET (= chrome socket), which is the desired behaviour
  // for backwards-compat with chrome-driver callers that pass no
  // socketName. The rejection guard catches the other falsy + non-string
  // values that DON'T trigger the default.
  test.each([null, '', 0, false, {}, []])('rejects non-string socketName: %p', async (badValue) => {
    const execFileSync = makeExecFileSyncMock();
    await expect(
      bootstrapAdbForward({
        socketName: badValue,
        adbPath: '/opt/homebrew/bin/adb',
        execFileSync,
        pickPort: async () => 9000,
      }),
    ).rejects.toThrow(/socketName is required/);
  });

  test('undefined socketName falls back to DEFAULT_CDP_SOCKET (chrome)', async () => {
    const execFileSync = makeExecFileSyncMock();
    await bootstrapAdbForward({
      socketName: undefined,
      adbPath: '/opt/homebrew/bin/adb',
      execFileSync,
      pickPort: async () => 9000,
    });
    expect(execFileSync).toHaveBeenCalledWith(
      '/opt/homebrew/bin/adb',
      ['forward', 'tcp:9000', 'localabstract:chrome_devtools_remote'],
      expect.any(Object),
    );
  });
});

describe('android-cdp-helpers — bootstrapAdbForward browserNameHint', () => {
  test('default browserNameHint surfaces "the browser" in adb-forward error', async () => {
    const execFileSync = jest.fn((bin, args) => {
      if (args[0] === 'devices') return 'List of devices attached\nABC\tdevice\n';
      throw new Error('socket bind failure');
    });
    await expect(
      bootstrapAdbForward({
        adbPath: '/opt/homebrew/bin/adb',
        execFileSync,
        pickPort: async () => 9000,
      }),
    ).rejects.toThrow(/Make sure the browser is open/);
  });

  test('custom browserNameHint surfaces in the adb-forward error', async () => {
    const execFileSync = jest.fn((bin, args) => {
      if (args[0] === 'devices') return 'List of devices attached\nABC\tdevice\n';
      throw new Error('socket bind failure');
    });
    await expect(
      bootstrapAdbForward({
        socketName: 'samsung_devtools_remote',
        browserNameHint: 'Samsung Internet',
        adbPath: '/opt/homebrew/bin/adb',
        execFileSync,
        pickPort: async () => 9000,
      }),
    ).rejects.toThrow(/Make sure Samsung Internet is open/);
  });
});

describe('android-cdp-helpers — bootstrapAdbForward error prefixes', () => {
  test('adb-not-found error mentions android-cdp-helpers prefix', async () => {
    const execFileSync = jest.fn(() => {
      const e = new Error('spawn adb ENOENT');
      e.code = 'ENOENT';
      throw e;
    });
    await expect(
      bootstrapAdbForward({
        adbPath: '/nope',
        execFileSync,
        pickPort: async () => 9000,
      }),
    ).rejects.toThrow(/\[android-cdp-helpers\] adb not found/);
  });

  test('no-device error mentions android-cdp-helpers prefix', async () => {
    const execFileSync = jest.fn(() => 'List of devices attached\n\n');
    await expect(
      bootstrapAdbForward({
        adbPath: '/opt/homebrew/bin/adb',
        execFileSync,
        pickPort: async () => 9000,
      }),
    ).rejects.toThrow(/\[android-cdp-helpers\] no Android device/);
  });
});

describe('android-cdp-helpers — bootstrapAdbForward returns port + removeForward', () => {
  test('happy path: returns { port, removeForward }', async () => {
    const execFileSync = makeExecFileSyncMock();
    const r = await bootstrapAdbForward({
      adbPath: '/opt/homebrew/bin/adb',
      execFileSync,
      pickPort: async () => 9001,
    });
    expect(r.port).toBe(9001);
    expect(typeof r.removeForward).toBe('function');
  });

  test('removeForward calls adb forward --remove with the chosen port', async () => {
    const execFileSync = makeExecFileSyncMock();
    const { removeForward } = await bootstrapAdbForward({
      adbPath: '/opt/homebrew/bin/adb',
      execFileSync,
      pickPort: async () => 9001,
    });
    removeForward();
    expect(execFileSync).toHaveBeenCalledWith(
      '/opt/homebrew/bin/adb',
      ['forward', '--remove', 'tcp:9001'],
      expect.any(Object),
    );
  });
});

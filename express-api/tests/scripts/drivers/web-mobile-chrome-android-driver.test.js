/**
 * web-mobile-chrome-android-driver.test.js
 *
 * Tests the Mobile Chrome on Android driver. Injects mock adb (via
 * execFileSync) + mock playwright + mock fs so no real Android device,
 * adb binary, or Chromium is required.
 *
 * Coverage areas:
 *   - resolveAdbPath: walks the known-paths list, falls back to bare.
 *   - pickFreePort: returns an integer port; cleanup happens.
 *   - bootstrapAdbForward: device-attached / unauthorised / no-device /
 *     adb-missing branches; `adb forward` arg shape; cleanup function.
 *   - createMobileChromeAndroidDriver: factory wiring, methods exist,
 *     CDP endpoint construction, failure modes (no contexts), close
 *     cleanup, webRefreshRoomsList trailing-slash handling.
 */

jest.mock(
  'playwright',
  () => ({
    chromium: { connectOverCDP: jest.fn() },
  }),
  { virtual: true },
);

const path = require('path');
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const {
  KNOWN_ADB_PATHS,
  resolveAdbPath,
  pickFreePort,
  bootstrapAdbForward,
  createMobileChromeAndroidDriver,
} = require(path.join(REPO_ROOT, 'express-api/scripts/drivers/web-mobile-chrome-android-driver'));

// Helpers ─────────────────────────────────────────────────────────────

function makeFsExistsMock(existingPaths) {
  return {
    existsSync: (p) => existingPaths.has(p),
  };
}

function makeExecFileSyncMock({ devicesOutput = '', forwardOk = true } = {}) {
  return jest.fn((bin, args) => {
    if (args[0] === 'devices') return devicesOutput;
    if (args[0] === 'forward' && args[1] === '--remove') return '';
    if (args[0] === 'forward') {
      if (!forwardOk) throw new Error('cannot bind to socket');
      return '';
    }
    return '';
  });
}

function makePagesByPersona(personas) {
  const pages = {};
  for (const name of personas) {
    pages[name] = {
      url: jest.fn(() => 'about:blank'),
      goto: jest.fn(async () => {}),
      evaluate: jest.fn(async () => ''),
      close: jest.fn(),
    };
  }
  return pages;
}

function makePlaywrightConnectOverCDPMock(pages) {
  let pageIdx = 0;
  const orderedPages = Object.values(pages);
  const ctx = {
    newPage: jest.fn(async () => {
      const p = orderedPages[pageIdx] ?? orderedPages[orderedPages.length - 1];
      pageIdx += 1;
      return p;
    }),
  };
  const browser = {
    contexts: jest.fn(() => [ctx]),
    close: jest.fn(async () => {}),
  };
  return {
    chromium: {
      connectOverCDP: jest.fn(async () => browser),
    },
  };
}

// resolveAdbPath ─────────────────────────────────────────────────────

describe('resolveAdbPath', () => {
  test('returns /opt/homebrew/bin/adb when it exists (Apple Silicon preferred)', () => {
    const fs = makeFsExistsMock(new Set(['/opt/homebrew/bin/adb', '/usr/local/bin/adb']));
    expect(resolveAdbPath(fs)).toBe('/opt/homebrew/bin/adb');
  });

  test('falls back to /usr/local/bin/adb when /opt/homebrew/bin/adb missing', () => {
    const fs = makeFsExistsMock(new Set(['/usr/local/bin/adb']));
    expect(resolveAdbPath(fs)).toBe('/usr/local/bin/adb');
  });

  test('falls back to /usr/bin/adb when both Homebrew paths missing', () => {
    const fs = makeFsExistsMock(new Set(['/usr/bin/adb']));
    expect(resolveAdbPath(fs)).toBe('/usr/bin/adb');
  });

  test("falls back to bare 'adb' when none of the known paths exist (CI mocks)", () => {
    const fs = makeFsExistsMock(new Set());
    expect(resolveAdbPath(fs)).toBe('adb');
  });

  test('survives fs.existsSync throwing (e.g. permission denied) per-path', () => {
    const fs = {
      existsSync: (p) => {
        if (p === '/opt/homebrew/bin/adb') throw new Error('EACCES');
        return p === '/usr/local/bin/adb';
      },
    };
    expect(resolveAdbPath(fs)).toBe('/usr/local/bin/adb');
  });

  test('KNOWN_ADB_PATHS preserves Apple-Silicon-first priority ordering', () => {
    expect(KNOWN_ADB_PATHS[0]).toBe('/opt/homebrew/bin/adb');
    expect(KNOWN_ADB_PATHS).toContain('/usr/local/bin/adb');
    expect(KNOWN_ADB_PATHS).toContain('/usr/bin/adb');
  });
});

// pickFreePort ──────────────────────────────────────────────────────

describe('pickFreePort', () => {
  test('returns a numeric port via the real net implementation', async () => {
    const port = await pickFreePort();
    expect(typeof port).toBe('number');
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
  });

  test('returns the port from the injected net mock when supplied', async () => {
    const fakeServer = {
      unref: jest.fn(),
      on: jest.fn(),
      listen: jest.fn((_p, _host, cb) => cb()),
      close: jest.fn((cb) => cb()),
      address: () => ({ port: 51234 }),
    };
    const netImpl = { createServer: () => fakeServer };
    const port = await pickFreePort(netImpl);
    expect(port).toBe(51234);
  });

  test('rejects when the listen server errors before binding', async () => {
    const fakeServer = {
      unref: jest.fn(),
      _handlers: {},
      on: function (evt, fn) {
        this._handlers[evt] = fn;
      },
      listen: function () {
        this._handlers.error(new Error('EADDRINUSE'));
      },
      close: jest.fn(),
      address: jest.fn(),
    };
    const netImpl = { createServer: () => fakeServer };
    await expect(pickFreePort(netImpl)).rejects.toThrow(/EADDRINUSE/);
  });
});

// bootstrapAdbForward ────────────────────────────────────────────────

describe('bootstrapAdbForward', () => {
  test('happy path: device attached → forwards CDP socket, returns port + cleanup', async () => {
    const execFileSync = makeExecFileSyncMock({
      devicesOutput: 'List of devices attached\nABCDEF12\tdevice\n',
    });
    const { port, removeForward } = await bootstrapAdbForward({
      adbPath: '/opt/homebrew/bin/adb',
      execFileSync,
      pickPort: async () => 9333,
    });
    expect(port).toBe(9333);
    expect(typeof removeForward).toBe('function');
    expect(execFileSync).toHaveBeenCalledWith(
      '/opt/homebrew/bin/adb',
      ['devices'],
      expect.any(Object),
    );
    expect(execFileSync).toHaveBeenCalledWith(
      '/opt/homebrew/bin/adb',
      ['forward', 'tcp:9333', 'localabstract:chrome_devtools_remote'],
      expect.any(Object),
    );
  });

  test('removeForward invokes adb forward --remove with the chosen port', async () => {
    const execFileSync = makeExecFileSyncMock({
      devicesOutput: 'List of devices attached\nABCDEF12\tdevice\n',
    });
    const { removeForward } = await bootstrapAdbForward({
      adbPath: '/opt/homebrew/bin/adb',
      execFileSync,
      pickPort: async () => 9333,
    });
    removeForward();
    expect(execFileSync).toHaveBeenCalledWith(
      '/opt/homebrew/bin/adb',
      ['forward', '--remove', 'tcp:9333'],
      expect.any(Object),
    );
  });

  test('removeForward swallows errors so cleanup is best-effort', async () => {
    let callCount = 0;
    const execFileSync = jest.fn((bin, args) => {
      callCount += 1;
      if (callCount === 1) return 'List of devices attached\nABC\tdevice\n';
      if (args[0] === 'forward' && args[1] !== '--remove') return '';
      throw new Error('forward already removed');
    });
    const { removeForward } = await bootstrapAdbForward({
      adbPath: '/opt/homebrew/bin/adb',
      execFileSync,
      pickPort: async () => 9333,
    });
    expect(() => removeForward()).not.toThrow();
  });

  test('throws actionable error when adb is missing (ENOENT)', async () => {
    const execFileSync = jest.fn(() => {
      const e = new Error('spawn adb ENOENT');
      e.code = 'ENOENT';
      throw e;
    });
    await expect(
      bootstrapAdbForward({
        adbPath: '/nope/adb',
        execFileSync,
        pickPort: async () => 9333,
      }),
    ).rejects.toThrow(/adb not found.*platform-tools/);
  });

  test('non-ENOENT adb error surfaces as generic adb-invocation error', async () => {
    const execFileSync = jest.fn(() => {
      throw new Error('permission denied');
    });
    await expect(
      bootstrapAdbForward({
        adbPath: '/opt/homebrew/bin/adb',
        execFileSync,
        pickPort: async () => 9333,
      }),
    ).rejects.toThrow(/adb invocation failed: permission denied/);
  });

  test('throws when no devices attached (empty list)', async () => {
    const execFileSync = makeExecFileSyncMock({ devicesOutput: 'List of devices attached\n\n' });
    await expect(
      bootstrapAdbForward({
        adbPath: '/opt/homebrew/bin/adb',
        execFileSync,
        pickPort: async () => 9333,
      }),
    ).rejects.toThrow(/no Android device attached/);
  });

  test('throws when the only device is unauthorised', async () => {
    const execFileSync = makeExecFileSyncMock({
      devicesOutput: 'List of devices attached\nABCDEF12\tunauthorized\n',
    });
    await expect(
      bootstrapAdbForward({
        adbPath: '/opt/homebrew/bin/adb',
        execFileSync,
        pickPort: async () => 9333,
      }),
    ).rejects.toThrow(/unauthorised.*Allow USB debugging/);
  });

  test('proceeds when mix of unauthorised + authorised devices present', async () => {
    const execFileSync = makeExecFileSyncMock({
      devicesOutput: 'List of devices attached\nABC\tunauthorized\nDEF\tdevice\n',
    });
    const r = await bootstrapAdbForward({
      adbPath: '/opt/homebrew/bin/adb',
      execFileSync,
      pickPort: async () => 9333,
    });
    expect(r.port).toBe(9333);
  });

  test('throws actionable error when adb forward itself fails', async () => {
    const execFileSync = makeExecFileSyncMock({
      devicesOutput: 'List of devices attached\nABC\tdevice\n',
      forwardOk: false,
    });
    await expect(
      bootstrapAdbForward({
        adbPath: '/opt/homebrew/bin/adb',
        execFileSync,
        pickPort: async () => 9333,
      }),
    ).rejects.toThrow(/adb forward failed.*USB Web debugging/);
  });

  test('uses resolveAdbPath default when no adbPath supplied (smoke)', async () => {
    // We can't easily intercept resolveAdbPath's fs check without
    // making it injectable into bootstrapAdbForward; the test just
    // verifies the call doesn't blow up at the default-resolution step
    // when execFileSync is mocked to error cleanly.
    const execFileSync = jest.fn(() => {
      const e = new Error('spawn adb ENOENT');
      e.code = 'ENOENT';
      throw e;
    });
    await expect(bootstrapAdbForward({ execFileSync, pickPort: async () => 9333 })).rejects.toThrow(
      /adb not found/,
    );
  });
});

// createMobileChromeAndroidDriver ────────────────────────────────────

describe('createMobileChromeAndroidDriver', () => {
  test('returns a driver with the expected method surface', async () => {
    const execFileSync = makeExecFileSyncMock({
      devicesOutput: 'List of devices attached\nABC\tdevice\n',
    });
    const pages = makePagesByPersona(['Alice']);
    const playwrightImpl = makePlaywrightConnectOverCDPMock(pages);
    const driver = await createMobileChromeAndroidDriver({
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9333,
    });
    expect(typeof driver.webRefreshRoomsList).toBe('function');
    expect(typeof driver.webUiDump).toBe('function');
    expect(typeof driver.close).toBe('function');
    expect(driver._port).toBe(9333);
  });

  test('connectOverCDP is called with 127.0.0.1:<port> endpoint URL', async () => {
    const execFileSync = makeExecFileSyncMock({
      devicesOutput: 'List of devices attached\nABC\tdevice\n',
    });
    const pages = makePagesByPersona(['Alice']);
    const playwrightImpl = makePlaywrightConnectOverCDPMock(pages);
    await createMobileChromeAndroidDriver({
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9444,
    });
    expect(playwrightImpl.chromium.connectOverCDP).toHaveBeenCalledWith('http://127.0.0.1:9444');
  });

  test('webRefreshRoomsList navigates to <baseURL>/rooms on the persona Page', async () => {
    const execFileSync = makeExecFileSyncMock({
      devicesOutput: 'List of devices attached\nABC\tdevice\n',
    });
    const pages = makePagesByPersona(['Alice']);
    const playwrightImpl = makePlaywrightConnectOverCDPMock(pages);
    const driver = await createMobileChromeAndroidDriver({
      baseURL: 'http://localhost:8888',
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9333,
    });
    const ok = await driver.webRefreshRoomsList('Alice');
    expect(ok).toBe(true);
    expect(pages.Alice.goto).toHaveBeenCalledWith('http://localhost:8888/rooms');
  });

  test('webRefreshRoomsList trailing slash collapses (no `//rooms`)', async () => {
    const execFileSync = makeExecFileSyncMock({
      devicesOutput: 'List of devices attached\nABC\tdevice\n',
    });
    const pages = makePagesByPersona(['Alice']);
    const playwrightImpl = makePlaywrightConnectOverCDPMock(pages);
    const driver = await createMobileChromeAndroidDriver({
      baseURL: 'http://localhost:8888/',
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9333,
    });
    await driver.webRefreshRoomsList('Alice');
    expect(pages.Alice.goto).toHaveBeenCalledWith('http://localhost:8888/rooms');
  });

  test('webRefreshRoomsList page.goto rejection → returns false (no unhandled)', async () => {
    const execFileSync = makeExecFileSyncMock({
      devicesOutput: 'List of devices attached\nABC\tdevice\n',
    });
    const pages = makePagesByPersona(['Alice']);
    pages.Alice.goto = jest.fn(async () => {
      throw new Error('net::ERR_INTERNET_DISCONNECTED');
    });
    const playwrightImpl = makePlaywrightConnectOverCDPMock(pages);
    const driver = await createMobileChromeAndroidDriver({
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9333,
    });
    const ok = await driver.webRefreshRoomsList('Alice');
    expect(ok).toBe(false);
  });

  test('subsequent webRefreshRoomsList for the same persona reuses the Page', async () => {
    const execFileSync = makeExecFileSyncMock({
      devicesOutput: 'List of devices attached\nABC\tdevice\n',
    });
    const pages = makePagesByPersona(['Alice']);
    const playwrightImpl = makePlaywrightConnectOverCDPMock(pages);
    const driver = await createMobileChromeAndroidDriver({
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9333,
    });
    await driver.webRefreshRoomsList('Alice');
    await driver.webRefreshRoomsList('Alice');
    expect(pages.Alice.goto).toHaveBeenCalledTimes(2);
  });

  test('webUiDump navigates to baseURL when page is at about:blank', async () => {
    const execFileSync = makeExecFileSyncMock({
      devicesOutput: 'List of devices attached\nABC\tdevice\n',
    });
    const pages = makePagesByPersona(['default']);
    pages.default.evaluate = jest.fn(async () => 'Hello ShyTalk');
    const playwrightImpl = makePlaywrightConnectOverCDPMock(pages);
    const driver = await createMobileChromeAndroidDriver({
      baseURL: 'http://localhost:8888',
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9333,
    });
    const text = await driver.webUiDump();
    expect(text).toBe('Hello ShyTalk');
    expect(pages.default.goto).toHaveBeenCalledWith('http://localhost:8888/');
  });

  test('webUiDump returns empty string on evaluate rejection', async () => {
    const execFileSync = makeExecFileSyncMock({
      devicesOutput: 'List of devices attached\nABC\tdevice\n',
    });
    const pages = makePagesByPersona(['default']);
    pages.default.evaluate = jest.fn(async () => {
      throw new Error('CDP gone');
    });
    const playwrightImpl = makePlaywrightConnectOverCDPMock(pages);
    const driver = await createMobileChromeAndroidDriver({
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9333,
    });
    const text = await driver.webUiDump();
    expect(text).toBe('');
  });

  test('connectOverCDP rejection → cleanup forward + actionable error', async () => {
    const execFileSync = makeExecFileSyncMock({
      devicesOutput: 'List of devices attached\nABC\tdevice\n',
    });
    const playwrightImpl = {
      chromium: {
        connectOverCDP: jest.fn(async () => {
          throw new Error('ECONNREFUSED');
        }),
      },
    };
    await expect(
      createMobileChromeAndroidDriver({
        execFileSync,
        playwrightImpl,
        pickPort: async () => 9333,
      }),
    ).rejects.toThrow(/connectOverCDP.*ECONNREFUSED.*chrome:\/\/inspect/);
    // Cleanup forward must have been called even though the bootstrap failed
    expect(execFileSync).toHaveBeenCalledWith(
      expect.any(String),
      ['forward', '--remove', 'tcp:9333'],
      expect.any(Object),
    );
  });

  test('zero contexts on attached browser → actionable error + forward cleanup', async () => {
    const execFileSync = makeExecFileSyncMock({
      devicesOutput: 'List of devices attached\nABC\tdevice\n',
    });
    const browser = { contexts: () => [], close: jest.fn(async () => {}) };
    const playwrightImpl = {
      chromium: { connectOverCDP: jest.fn(async () => browser) },
    };
    await expect(
      createMobileChromeAndroidDriver({
        execFileSync,
        playwrightImpl,
        pickPort: async () => 9333,
      }),
    ).rejects.toThrow(/0 contexts.*incognito-only/);
    expect(browser.close).toHaveBeenCalled();
  });

  test('close removes the adb forward + closes browser + pages', async () => {
    const execFileSync = makeExecFileSyncMock({
      devicesOutput: 'List of devices attached\nABC\tdevice\n',
    });
    const pages = makePagesByPersona(['Alice', 'Bob']);
    const playwrightImpl = makePlaywrightConnectOverCDPMock(pages);
    const driver = await createMobileChromeAndroidDriver({
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9333,
    });
    await driver.webRefreshRoomsList('Alice');
    await driver.webRefreshRoomsList('Bob');
    await driver.close();
    expect(pages.Alice.close).toHaveBeenCalledTimes(1);
    expect(pages.Bob.close).toHaveBeenCalledTimes(1);
    expect(driver._browser.close).toHaveBeenCalledTimes(1);
    expect(execFileSync).toHaveBeenCalledWith(
      expect.any(String),
      ['forward', '--remove', 'tcp:9333'],
      expect.any(Object),
    );
  });

  test('close swallows page-close + browser-close errors (best-effort)', async () => {
    const execFileSync = makeExecFileSyncMock({
      devicesOutput: 'List of devices attached\nABC\tdevice\n',
    });
    const pages = makePagesByPersona(['Alice']);
    pages.Alice.close = jest.fn(() => Promise.reject(new Error('already closed')));
    const playwrightImpl = makePlaywrightConnectOverCDPMock(pages);
    playwrightImpl.chromium.connectOverCDP = jest.fn(async () => ({
      contexts: () => [
        {
          newPage: async () => pages.Alice,
        },
      ],
      close: jest.fn(() => Promise.reject(new Error('CDP gone'))),
    }));
    const driver = await createMobileChromeAndroidDriver({
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9333,
    });
    await driver.webRefreshRoomsList('Alice');
    await expect(driver.close()).resolves.toBeUndefined();
  });
});

/**
 * web-mobile-edge-android-driver.test.js
 *
 * Tests for the Mobile Edge on Android driver. Mock execFileSync +
 * playwright + bootstrap helper so no real Android device or adb is
 * required.
 *
 * Coverage areas:
 *   - EDGE_CDP_SOCKET constant pin
 *   - createMobileEdgeAndroidDriver factory wiring
 *   - bootstrapAdbForward invoked with Edge's socket name
 *   - connectOverCDP endpoint URL
 *   - 0-contexts → InPrivate-mode hint + forward cleanup
 *   - webRefreshRoomsList / webUiDump method behaviour
 *   - close cleans forward + browser + pages
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
const { EDGE_CDP_SOCKET, createMobileEdgeAndroidDriver } = require(
  path.join(REPO_ROOT, 'express-api/scripts/drivers/web-mobile-edge-android-driver'),
);

// Helpers ─────────────────────────────────────────────────────────────

function makeExecFileSyncMock({ devicesOutput = 'List of devices attached\nABC\tdevice\n' } = {}) {
  return jest.fn((bin, args) => {
    if (args[0] === 'devices') return devicesOutput;
    if (args[0] === 'forward') return '';
    return '';
  });
}

function makePages(personas) {
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

function makePlaywrightMock(pages) {
  let pageIdx = 0;
  const ordered = Object.values(pages);
  const ctx = {
    newPage: jest.fn(async () => {
      const p = ordered[pageIdx] ?? ordered[ordered.length - 1];
      pageIdx += 1;
      return p;
    }),
  };
  const browser = {
    contexts: jest.fn(() => [ctx]),
    close: jest.fn(async () => {}),
  };
  return {
    chromium: { connectOverCDP: jest.fn(async () => browser) },
  };
}

// EDGE_CDP_SOCKET ────────────────────────────────────────────────────

describe('EDGE_CDP_SOCKET', () => {
  test('is the Mobile Edge devtools socket name', () => {
    expect(EDGE_CDP_SOCKET).toBe('com.microsoft.emmx_devtools_remote');
  });
});

// createMobileEdgeAndroidDriver ──────────────────────────────────────

describe('createMobileEdgeAndroidDriver', () => {
  test('returns a driver with the expected method surface', async () => {
    const execFileSync = makeExecFileSyncMock();
    const pages = makePages(['Alice']);
    const playwrightImpl = makePlaywrightMock(pages);
    const driver = await createMobileEdgeAndroidDriver({
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9777,
    });
    expect(typeof driver.webRefreshRoomsList).toBe('function');
    expect(typeof driver.webUiDump).toBe('function');
    expect(typeof driver.close).toBe('function');
    expect(driver._port).toBe(9777);
  });

  test('adb forward targets the Edge CDP socket name', async () => {
    const execFileSync = makeExecFileSyncMock();
    const pages = makePages(['Alice']);
    const playwrightImpl = makePlaywrightMock(pages);
    await createMobileEdgeAndroidDriver({
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9777,
    });
    expect(execFileSync).toHaveBeenCalledWith(
      expect.any(String),
      ['forward', 'tcp:9777', `localabstract:${EDGE_CDP_SOCKET}`],
      expect.any(Object),
    );
  });

  test('does NOT use Chrome or Samsung socket names (so all three drivers can co-exist)', async () => {
    const execFileSync = makeExecFileSyncMock();
    const pages = makePages(['Alice']);
    const playwrightImpl = makePlaywrightMock(pages);
    await createMobileEdgeAndroidDriver({
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9777,
    });
    const forwardCalls = execFileSync.mock.calls.filter((c) => c[1][0] === 'forward');
    for (const c of forwardCalls) {
      const arg = c[1].join(' ');
      expect(arg).not.toContain('localabstract:chrome_devtools_remote');
      expect(arg).not.toContain('localabstract:com.sec.android.app.sbrowser_devtools_remote');
    }
  });

  test('connectOverCDP is called with the chosen port', async () => {
    const execFileSync = makeExecFileSyncMock();
    const pages = makePages(['Alice']);
    const playwrightImpl = makePlaywrightMock(pages);
    await createMobileEdgeAndroidDriver({
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9888,
    });
    expect(playwrightImpl.chromium.connectOverCDP).toHaveBeenCalledWith('http://127.0.0.1:9888');
  });

  test('webRefreshRoomsList navigates to <baseURL>/rooms', async () => {
    const execFileSync = makeExecFileSyncMock();
    const pages = makePages(['Alice']);
    const playwrightImpl = makePlaywrightMock(pages);
    const driver = await createMobileEdgeAndroidDriver({
      baseURL: 'http://localhost:8888',
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9777,
    });
    const ok = await driver.webRefreshRoomsList('Alice');
    expect(ok).toBe(true);
    expect(pages.Alice.goto).toHaveBeenCalledWith('http://localhost:8888/rooms');
  });

  test('webRefreshRoomsList trailing slash collapses', async () => {
    const execFileSync = makeExecFileSyncMock();
    const pages = makePages(['Alice']);
    const playwrightImpl = makePlaywrightMock(pages);
    const driver = await createMobileEdgeAndroidDriver({
      baseURL: 'http://localhost:8888/',
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9777,
    });
    await driver.webRefreshRoomsList('Alice');
    expect(pages.Alice.goto).toHaveBeenCalledWith('http://localhost:8888/rooms');
  });

  test('webRefreshRoomsList goto rejection → returns false', async () => {
    const execFileSync = makeExecFileSyncMock();
    const pages = makePages(['Alice']);
    pages.Alice.goto = jest.fn(async () => {
      throw new Error('net::ERR_INTERNET_DISCONNECTED');
    });
    const playwrightImpl = makePlaywrightMock(pages);
    const driver = await createMobileEdgeAndroidDriver({
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9777,
    });
    expect(await driver.webRefreshRoomsList('Alice')).toBe(false);
  });

  test('webUiDump returns innerText', async () => {
    const execFileSync = makeExecFileSyncMock();
    const pages = makePages(['default']);
    pages.default.evaluate = jest.fn(async () => 'Edge says hello');
    const playwrightImpl = makePlaywrightMock(pages);
    const driver = await createMobileEdgeAndroidDriver({
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9777,
    });
    expect(await driver.webUiDump()).toBe('Edge says hello');
  });

  test('webUiDump returns "" on evaluate rejection (await-before-return catches it)', async () => {
    const execFileSync = makeExecFileSyncMock();
    const pages = makePages(['default']);
    pages.default.evaluate = jest.fn(async () => {
      throw new Error('CDP gone');
    });
    const playwrightImpl = makePlaywrightMock(pages);
    const driver = await createMobileEdgeAndroidDriver({
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9777,
    });
    expect(await driver.webUiDump()).toBe('');
  });

  test('connectOverCDP rejection → Edge-specific error + forward cleanup', async () => {
    const execFileSync = makeExecFileSyncMock();
    const playwrightImpl = {
      chromium: {
        connectOverCDP: jest.fn(async () => {
          throw new Error('ECONNREFUSED');
        }),
      },
    };
    await expect(
      createMobileEdgeAndroidDriver({
        execFileSync,
        playwrightImpl,
        pickPort: async () => 9777,
      }),
    ).rejects.toThrow(/connectOverCDP.*ECONNREFUSED.*Mobile Edge.*USB Web Debugging/);
    expect(execFileSync).toHaveBeenCalledWith(
      expect.any(String),
      ['forward', '--remove', 'tcp:9777'],
      expect.any(Object),
    );
  });

  test('0 contexts → InPrivate-mode hint error + forward cleanup', async () => {
    const execFileSync = makeExecFileSyncMock();
    const browser = { contexts: () => [], close: jest.fn(async () => {}) };
    const playwrightImpl = {
      chromium: { connectOverCDP: jest.fn(async () => browser) },
    };
    await expect(
      createMobileEdgeAndroidDriver({
        execFileSync,
        playwrightImpl,
        pickPort: async () => 9777,
      }),
    ).rejects.toThrow(/0 contexts.*InPrivate/);
    expect(browser.close).toHaveBeenCalled();
  });

  test('close removes the adb forward + closes browser + pages', async () => {
    const execFileSync = makeExecFileSyncMock();
    const pages = makePages(['Alice', 'Bob']);
    const playwrightImpl = makePlaywrightMock(pages);
    const driver = await createMobileEdgeAndroidDriver({
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9777,
    });
    await driver.webRefreshRoomsList('Alice');
    await driver.webRefreshRoomsList('Bob');
    await driver.close();
    expect(pages.Alice.close).toHaveBeenCalledTimes(1);
    expect(pages.Bob.close).toHaveBeenCalledTimes(1);
    expect(driver._browser.close).toHaveBeenCalledTimes(1);
    expect(execFileSync).toHaveBeenCalledWith(
      expect.any(String),
      ['forward', '--remove', 'tcp:9777'],
      expect.any(Object),
    );
  });

  test('close swallows page-close + browser-close errors (best-effort)', async () => {
    const execFileSync = makeExecFileSyncMock();
    const pages = makePages(['Alice']);
    pages.Alice.close = jest.fn(() => Promise.reject(new Error('already closed')));
    const playwrightImpl = makePlaywrightMock(pages);
    playwrightImpl.chromium.connectOverCDP = jest.fn(async () => ({
      contexts: () => [{ newPage: async () => pages.Alice }],
      close: jest.fn(() => Promise.reject(new Error('CDP gone'))),
    }));
    const driver = await createMobileEdgeAndroidDriver({
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9777,
    });
    await driver.webRefreshRoomsList('Alice');
    await expect(driver.close()).resolves.toBeUndefined();
  });
});

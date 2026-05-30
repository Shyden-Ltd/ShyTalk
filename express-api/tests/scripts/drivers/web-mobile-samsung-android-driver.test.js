/**
 * web-mobile-samsung-android-driver.test.js
 *
 * Tests the Samsung Internet on Android driver. Mock execFileSync +
 * playwright + bootstrap helper so no real Android device or adb is
 * required.
 *
 * Coverage areas:
 *   - SAMSUNG_CDP_SOCKET constant pin
 *   - createMobileSamsungAndroidDriver factory wiring
 *   - bootstrapAdbForward invoked with Samsung's socket name
 *   - connectOverCDP endpoint URL
 *   - 0-contexts → actionable error + forward cleanup
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
const { SAMSUNG_CDP_SOCKET, createMobileSamsungAndroidDriver } = require(
  path.join(REPO_ROOT, 'express-api/scripts/drivers/web-mobile-samsung-android-driver'),
);

// Helpers ─────────────────────────────────────────────────────────────

function makeExecFileSyncMock({
  devicesOutput = 'List of devices attached\nABC\tdevice\n',
  forwardOk = true,
} = {}) {
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

// SAMSUNG_CDP_SOCKET ─────────────────────────────────────────────────

describe('SAMSUNG_CDP_SOCKET', () => {
  test('is the Samsung Internet devtools socket name', () => {
    expect(SAMSUNG_CDP_SOCKET).toBe('com.sec.android.app.sbrowser_devtools_remote');
  });
});

// createMobileSamsungAndroidDriver ───────────────────────────────────

describe('createMobileSamsungAndroidDriver', () => {
  test('returns a driver with the expected method surface', async () => {
    const execFileSync = makeExecFileSyncMock();
    const pages = makePages(['Alice']);
    const playwrightImpl = makePlaywrightMock(pages);
    const driver = await createMobileSamsungAndroidDriver({
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9555,
    });
    expect(typeof driver.webRefreshRoomsList).toBe('function');
    expect(typeof driver.webUiDump).toBe('function');
    expect(typeof driver.close).toBe('function');
    expect(driver._port).toBe(9555);
  });

  test('adb forward targets the Samsung Internet CDP socket name', async () => {
    const execFileSync = makeExecFileSyncMock();
    const pages = makePages(['Alice']);
    const playwrightImpl = makePlaywrightMock(pages);
    await createMobileSamsungAndroidDriver({
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9555,
    });
    expect(execFileSync).toHaveBeenCalledWith(
      expect.any(String),
      ['forward', 'tcp:9555', `localabstract:${SAMSUNG_CDP_SOCKET}`],
      expect.any(Object),
    );
  });

  test('does NOT use the Chrome socket name (so Chrome + Samsung sessions can co-exist)', async () => {
    const execFileSync = makeExecFileSyncMock();
    const pages = makePages(['Alice']);
    const playwrightImpl = makePlaywrightMock(pages);
    await createMobileSamsungAndroidDriver({
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9555,
    });
    const forwardCalls = execFileSync.mock.calls.filter((c) => c[1][0] === 'forward');
    const usedChromeSocket = forwardCalls.some((c) =>
      c[1].includes('localabstract:chrome_devtools_remote'),
    );
    expect(usedChromeSocket).toBe(false);
  });

  test('connectOverCDP is called with the chosen port', async () => {
    const execFileSync = makeExecFileSyncMock();
    const pages = makePages(['Alice']);
    const playwrightImpl = makePlaywrightMock(pages);
    await createMobileSamsungAndroidDriver({
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9666,
    });
    expect(playwrightImpl.chromium.connectOverCDP).toHaveBeenCalledWith('http://127.0.0.1:9666');
  });

  test('webRefreshRoomsList navigates to <baseURL>/rooms', async () => {
    const execFileSync = makeExecFileSyncMock();
    const pages = makePages(['Alice']);
    const playwrightImpl = makePlaywrightMock(pages);
    const driver = await createMobileSamsungAndroidDriver({
      baseURL: 'http://localhost:8888',
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9555,
    });
    const ok = await driver.webRefreshRoomsList('Alice');
    expect(ok).toBe(true);
    expect(pages.Alice.goto).toHaveBeenCalledWith('http://localhost:8888/rooms');
  });

  test('webRefreshRoomsList trailing slash collapses', async () => {
    const execFileSync = makeExecFileSyncMock();
    const pages = makePages(['Alice']);
    const playwrightImpl = makePlaywrightMock(pages);
    const driver = await createMobileSamsungAndroidDriver({
      baseURL: 'http://localhost:8888/',
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9555,
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
    const driver = await createMobileSamsungAndroidDriver({
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9555,
    });
    const ok = await driver.webRefreshRoomsList('Alice');
    expect(ok).toBe(false);
  });

  test('subsequent webRefreshRoomsList for the same persona reuses the Page', async () => {
    const execFileSync = makeExecFileSyncMock();
    const pages = makePages(['Alice']);
    const playwrightImpl = makePlaywrightMock(pages);
    const driver = await createMobileSamsungAndroidDriver({
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9555,
    });
    await driver.webRefreshRoomsList('Alice');
    await driver.webRefreshRoomsList('Alice');
    expect(pages.Alice.goto).toHaveBeenCalledTimes(2);
  });

  test('webUiDump returns innerText from the default Page', async () => {
    const execFileSync = makeExecFileSyncMock();
    const pages = makePages(['default']);
    pages.default.evaluate = jest.fn(async () => 'Samsung says hi');
    const playwrightImpl = makePlaywrightMock(pages);
    const driver = await createMobileSamsungAndroidDriver({
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9555,
    });
    expect(await driver.webUiDump()).toBe('Samsung says hi');
  });

  test('webUiDump returns "" on evaluate rejection (await before return semantics)', async () => {
    const execFileSync = makeExecFileSyncMock();
    const pages = makePages(['default']);
    pages.default.evaluate = jest.fn(async () => {
      throw new Error('CDP gone');
    });
    const playwrightImpl = makePlaywrightMock(pages);
    const driver = await createMobileSamsungAndroidDriver({
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9555,
    });
    expect(await driver.webUiDump()).toBe('');
  });

  test('connectOverCDP rejection → cleanup forward + actionable error', async () => {
    const execFileSync = makeExecFileSyncMock();
    const playwrightImpl = {
      chromium: {
        connectOverCDP: jest.fn(async () => {
          throw new Error('ECONNREFUSED');
        }),
      },
    };
    await expect(
      createMobileSamsungAndroidDriver({
        execFileSync,
        playwrightImpl,
        pickPort: async () => 9555,
      }),
    ).rejects.toThrow(/connectOverCDP.*ECONNREFUSED.*Samsung Internet.*USB Debugging of WebViews/);
    expect(execFileSync).toHaveBeenCalledWith(
      expect.any(String),
      ['forward', '--remove', 'tcp:9555'],
      expect.any(Object),
    );
  });

  test('0 contexts on attached browser → Secret Mode hint error + forward cleanup', async () => {
    const execFileSync = makeExecFileSyncMock();
    const browser = { contexts: () => [], close: jest.fn(async () => {}) };
    const playwrightImpl = {
      chromium: { connectOverCDP: jest.fn(async () => browser) },
    };
    await expect(
      createMobileSamsungAndroidDriver({
        execFileSync,
        playwrightImpl,
        pickPort: async () => 9555,
      }),
    ).rejects.toThrow(/0 contexts.*Secret Mode/);
    expect(browser.close).toHaveBeenCalled();
  });

  test('close removes the adb forward + closes browser + pages', async () => {
    const execFileSync = makeExecFileSyncMock();
    const pages = makePages(['Alice', 'Bob']);
    const playwrightImpl = makePlaywrightMock(pages);
    const driver = await createMobileSamsungAndroidDriver({
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9555,
    });
    await driver.webRefreshRoomsList('Alice');
    await driver.webRefreshRoomsList('Bob');
    await driver.close();
    expect(pages.Alice.close).toHaveBeenCalledTimes(1);
    expect(pages.Bob.close).toHaveBeenCalledTimes(1);
    expect(driver._browser.close).toHaveBeenCalledTimes(1);
    expect(execFileSync).toHaveBeenCalledWith(
      expect.any(String),
      ['forward', '--remove', 'tcp:9555'],
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
    const driver = await createMobileSamsungAndroidDriver({
      execFileSync,
      playwrightImpl,
      pickPort: async () => 9555,
    });
    await driver.webRefreshRoomsList('Alice');
    await expect(driver.close()).resolves.toBeUndefined();
  });
});

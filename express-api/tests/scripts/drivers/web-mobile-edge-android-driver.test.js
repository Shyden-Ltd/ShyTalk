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

// takeScreenshot — behavioral delegation (gap C3, reviewer I-NEW-1) ──

describe('createMobileEdgeAndroidDriver — takeScreenshot delegation', () => {
  const helper = require(
    path.join(REPO_ROOT, 'express-api/scripts/drivers/driver-screenshot-helper'),
  );

  test('routes to takeScreenshotForPages with populated pages Map + slug', async () => {
    const spy = jest.spyOn(helper, 'takeScreenshotForPages').mockResolvedValue(['/mock/edge.png']);
    try {
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

      const result = await driver.takeScreenshot('/tmp/edge-out');

      expect(spy).toHaveBeenCalledTimes(1);
      const [pagesArg, outputDirArg, slugArg] = spy.mock.calls[0];
      expect(outputDirArg).toBe('/tmp/edge-out');
      expect(slugArg).toBe('mobile-edge-android');
      expect(pagesArg instanceof Map).toBe(true);
      expect(pagesArg.size).toBe(2);
      expect(pagesArg.has('Alice')).toBe(true);
      expect(pagesArg.has('Bob')).toBe(true);
      expect(result).toEqual(['/mock/edge.png']);
    } finally {
      spy.mockRestore();
    }
  });

  test('takeScreenshot before any webRefreshRoomsList → forwards empty pages Map, returns []', async () => {
    // Reviewer round-3 I-2 — pre-bootstrap case.
    const spy = jest.spyOn(helper, 'takeScreenshotForPages').mockResolvedValue([]);
    try {
      const execFileSync = makeExecFileSyncMock();
      const pages = makePages(['Alice']);
      const playwrightImpl = makePlaywrightMock(pages);
      const driver = await createMobileEdgeAndroidDriver({
        execFileSync,
        playwrightImpl,
        pickPort: async () => 9777,
      });
      const result = await driver.takeScreenshot('/tmp/empty-out');
      expect(result).toEqual([]);
      expect(spy).toHaveBeenCalledTimes(1);
      const [pagesArg] = spy.mock.calls[0];
      expect(pagesArg instanceof Map).toBe(true);
      expect(pagesArg.size).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});

// webSignIn (SHY-0328) ───────────────────────────────────────────────

describe('createMobileEdgeAndroidDriver — webSignIn (SHY-0328)', () => {
  // Wiring coverage. driver-contract.test.js compares the method-name constant
  // to itself and driver-interface-pin.test.js counts string literals, so a
  // wrong pageFor/baseURL/label reaching the shared factory was undetectable.

  const SAVED_PW = process.env.PERSONAS_PASSWORD;
  const SECRET = 'mobile-edge-android-driver-credential';

  beforeEach(() => {
    process.env.PERSONAS_PASSWORD = SECRET;
  });
  afterEach(() => {
    if (SAVED_PW === undefined) delete process.env.PERSONAS_PASSWORD;
    else process.env.PERSONAS_PASSWORD = SAVED_PW;
  });

  /** Like makePages, plus the waitForFunction the sign-in sequence needs.
   *  Local so the shared helper other tests rely on is untouched. */
  function makeSignInPages(names, { evaluateResult = { ok: true } } = {}) {
    const pages = {};
    for (const name of names) {
      pages[name] = {
        url: jest.fn(() => 'about:blank'),
        goto: jest.fn(async () => {}),
        evaluate: jest.fn(async () => evaluateResult),
        waitForFunction: jest.fn(async () => true),
        close: jest.fn(),
      };
    }
    return pages;
  }

  async function driverFor(pages) {
    return createMobileEdgeAndroidDriver({
      execFileSync: makeExecFileSyncMock(),
      playwrightImpl: makePlaywrightMock(pages),
      pickPort: async () => 9777,
    });
  }

  test('signs the persona in through this driver’s own page', async () => {
    const pages = makeSignInPages(['Alice']);
    const driver = await driverFor(pages);

    expect(await driver.webSignIn('Alice')).toBe(true);
    expect(pages.Alice.goto).toHaveBeenCalledWith('http://localhost:8888/roadmap.html');
    expect(pages.Alice.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      email: 'adult-power@shytalk.dev',
      secret: SECRET,
    });
  });

  test('waits for a real currentUser, not merely for sign-in to resolve', async () => {
    const pages = makeSignInPages(['Alice']);
    const driver = await driverFor(pages);

    await driver.webSignIn('Alice');

    const waited = pages.Alice.waitForFunction.mock.calls.map((c) => String(c[0]));
    expect(waited.some((f) => f.includes('signInWithEmail'))).toBe(true);
    expect(waited.some((f) => f.includes('currentUser'))).toBe(true);
  });

  test('returns FALSE when Firebase rejects the credentials', async () => {
    const pages = makeSignInPages(['Alice'], {
      evaluateResult: { ok: false, error: 'INVALID_PASSWORD' },
    });
    const driver = await driverFor(pages);
    expect(await driver.webSignIn('Alice')).toBe(false);
  });

  test('returns FALSE for an unknown persona without opening a page', async () => {
    const pages = makeSignInPages(['Alice']);
    const driver = await driverFor(pages);

    expect(await driver.webSignIn('Nobody')).toBe(false);
    expect(pages.Alice.goto).not.toHaveBeenCalled();
  });

  test('returns FALSE when PERSONAS_PASSWORD is unset rather than signing in blank', async () => {
    delete process.env.PERSONAS_PASSWORD;
    const pages = makeSignInPages(['Alice']);
    const driver = await driverFor(pages);

    expect(await driver.webSignIn('Alice')).toBe(false);
    expect(pages.Alice.goto).not.toHaveBeenCalled();
  });

  test('returns FALSE when the page THROWS during sign-in, rather than propagating', async () => {
    // The 20s waitForFunction can reject on a real device (navigation timeout,
    // network drop). makeWebSignIn catches and returns false; nothing in the
    // repo exercised that catch until now. A throw escaping here would abort
    // the whole scenario instead of failing one step.
    const pages = makeSignInPages(['Alice']);
    pages.Alice.waitForFunction = jest.fn(async () => {
      throw new Error('Timeout 20000ms exceeded');
    });
    const driver = await driverFor(pages);

    expect(await driver.webSignIn('Alice')).toBe(false);
  });

  test('switching persona A->B signs B in on B’s OWN page with B’s credentials', async () => {
    // pageFor caches one page per persona name, so the second call runs against
    // a different cached page while the factory closure is shared. A stale
    // closure would re-authenticate as Alice and the journey would pass while
    // acting as the wrong user.
    const pages = makeSignInPages(['Alice', 'Marcus']);
    const driver = await driverFor(pages);

    await driver.webSignIn('Alice');
    await driver.webSignIn('Marcus');

    expect(pages.Alice.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      email: 'adult-power@shytalk.dev',
      secret: SECRET,
    });
    expect(pages.Marcus.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      email: 'minor-power@shytalk.dev',
      secret: SECRET,
    });
  });

  test('is re-entrant — the SAME persona signed in twice both succeed', async () => {
    const pages = makeSignInPages(['Alice']);
    const driver = await driverFor(pages);

    expect(await driver.webSignIn('Alice')).toBe(true);
    expect(await driver.webSignIn('Alice')).toBe(true);
    expect(pages.Alice.evaluate).toHaveBeenCalledTimes(2);
  });
});

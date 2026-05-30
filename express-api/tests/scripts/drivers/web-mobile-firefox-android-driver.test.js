/**
 * web-mobile-firefox-android-driver.test.js
 *
 * Tests for the Mobile Firefox on Android driver. Mock spawn +
 * fetchImpl + fs + waitForReady so no real geckodriver / Firefox /
 * Android device is required.
 *
 * Coverage areas:
 *   - FIREFOX_ANDROID_PACKAGE / ACTIVITY constant pins
 *   - resolveGeckodriverPath path-walking + fallback
 *   - pickFreePort real net + mocked
 *   - waitForGeckodriverReady: polls /status, retries on non-2xx +
 *     throws on missing ready=true, hits timeout cleanly
 *   - createMobileFirefoxAndroidDriver: spawn invocation, session
 *     bootstrap with androidPackage cap, page navigation, close
 *     terminates geckodriver
 *   - Edge cases: spawn throws, geckodriver exits early,
 *     waitForReady rejects, /session non-2xx
 */

const path = require('path');
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const {
  KNOWN_GECKODRIVER_PATHS,
  FIREFOX_ANDROID_PACKAGE,
  FIREFOX_ANDROID_ACTIVITY,
  resolveGeckodriverPath,
  pickFreePort,
  waitForGeckodriverReady,
  createMobileFirefoxAndroidDriver,
} = require(path.join(REPO_ROOT, 'express-api/scripts/drivers/web-mobile-firefox-android-driver'));

// Helpers ─────────────────────────────────────────────────────────────

function makeJsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function makeTextResponse(text, status = 500) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => ({ value: { error: text } }),
  };
}

function makeFetchMock(handlers) {
  const calls = [];
  const fetchImpl = jest.fn(async (url, opts = {}) => {
    calls.push({ url, opts });
    for (const h of handlers) {
      if (h.match(url, opts)) return h.respond(url, opts);
    }
    return makeJsonResponse({ value: { error: 'unmocked endpoint' } }, 404);
  });
  fetchImpl.calls = calls;
  return fetchImpl;
}

function defaultHandlers({ sessionId = 'sess-firefox', textValue = 'Hello Firefox' } = {}) {
  return [
    {
      match: (url) => url.endsWith('/status'),
      respond: () => makeJsonResponse({ value: { ready: true } }),
    },
    {
      match: (url, opts) => url.endsWith('/session') && opts.method === 'POST',
      respond: () => makeJsonResponse({ value: { sessionId } }),
    },
    {
      match: (url, opts) => url.endsWith(`/session/${sessionId}/url`) && opts.method === 'POST',
      respond: () => makeJsonResponse({ value: null }),
    },
    {
      match: (url, opts) =>
        url.endsWith(`/session/${sessionId}/execute/sync`) && opts.method === 'POST',
      respond: () => makeJsonResponse({ value: textValue }),
    },
    {
      match: (url, opts) => url.endsWith(`/session/${sessionId}`) && opts.method === 'DELETE',
      respond: () => makeJsonResponse({ value: null }),
    },
  ];
}

function makeSpawnMock({ killImpl = jest.fn(), exitCode = null } = {}) {
  const proc = {
    kill: killImpl,
    stderr: { on: jest.fn() },
    on: jest.fn((evt, fn) => {
      if (evt === 'exit' && exitCode !== null) {
        // Simulate early exit synchronously after the listener attaches.
        setImmediate(() => fn(exitCode, null));
      }
    }),
  };
  const spawnImpl = jest.fn(() => proc);
  spawnImpl._proc = proc;
  return spawnImpl;
}

// Constants ──────────────────────────────────────────────────────────

describe('FIREFOX_ANDROID_PACKAGE / ACTIVITY constants', () => {
  test('package is org.mozilla.firefox (Play Store release channel)', () => {
    expect(FIREFOX_ANDROID_PACKAGE).toBe('org.mozilla.firefox');
  });

  test('activity is the Fenix IntentReceiverActivity', () => {
    expect(FIREFOX_ANDROID_ACTIVITY).toBe('org.mozilla.fenix.IntentReceiverActivity');
  });
});

describe('KNOWN_GECKODRIVER_PATHS', () => {
  test('lists Apple-Silicon Homebrew path first', () => {
    expect(KNOWN_GECKODRIVER_PATHS[0]).toBe('/opt/homebrew/bin/geckodriver');
    expect(KNOWN_GECKODRIVER_PATHS).toContain('/usr/local/bin/geckodriver');
  });
});

// resolveGeckodriverPath ─────────────────────────────────────────────

describe('resolveGeckodriverPath', () => {
  test('returns the first existing path from the known list', () => {
    const fs = { existsSync: (p) => p === '/usr/local/bin/geckodriver' };
    expect(resolveGeckodriverPath(fs)).toBe('/usr/local/bin/geckodriver');
  });

  test("falls back to bare 'geckodriver' when no path exists", () => {
    const fs = { existsSync: () => false };
    expect(resolveGeckodriverPath(fs)).toBe('geckodriver');
  });

  test('survives fs.existsSync throwing per-path', () => {
    const fs = {
      existsSync: (p) => {
        if (p === '/opt/homebrew/bin/geckodriver') throw new Error('EACCES');
        return p === '/usr/local/bin/geckodriver';
      },
    };
    expect(resolveGeckodriverPath(fs)).toBe('/usr/local/bin/geckodriver');
  });
});

// pickFreePort ──────────────────────────────────────────────────────

describe('pickFreePort', () => {
  test('returns a numeric port via real net', async () => {
    const port = await pickFreePort();
    expect(typeof port).toBe('number');
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
  });

  test('returns the port from the injected net mock', async () => {
    const fakeServer = {
      unref: jest.fn(),
      on: jest.fn(),
      listen: jest.fn((_p, _host, cb) => cb()),
      close: jest.fn((cb) => cb()),
      address: () => ({ port: 4444 }),
    };
    const netImpl = { createServer: () => fakeServer };
    expect(await pickFreePort(netImpl)).toBe(4444);
  });
});

// waitForGeckodriverReady ────────────────────────────────────────────

describe('waitForGeckodriverReady', () => {
  test('resolves when /status returns ready:true', async () => {
    const fetchImpl = makeFetchMock([
      {
        match: (url) => url.endsWith('/status'),
        respond: () => makeJsonResponse({ value: { ready: true } }),
      },
    ]);
    await expect(
      waitForGeckodriverReady({
        port: 4444,
        fetchImpl,
        timeoutMs: 1000,
        nowMs: () => 0,
        sleepMs: async () => {},
      }),
    ).resolves.toBe(true);
  });

  test('retries when /status returns ready:false, then succeeds', async () => {
    let calls = 0;
    const fetchImpl = jest.fn(async () => {
      calls += 1;
      if (calls < 3) return makeJsonResponse({ value: { ready: false } });
      return makeJsonResponse({ value: { ready: true } });
    });
    let t = 0;
    await waitForGeckodriverReady({
      port: 4444,
      fetchImpl,
      timeoutMs: 5000,
      nowMs: () => {
        t += 50;
        return t;
      },
      sleepMs: async () => {},
    });
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  test('retries on fetch rejection (geckodriver not yet listening)', async () => {
    let calls = 0;
    const fetchImpl = jest.fn(async () => {
      calls += 1;
      if (calls < 2) throw new Error('ECONNREFUSED');
      return makeJsonResponse({ value: { ready: true } });
    });
    let t = 0;
    await waitForGeckodriverReady({
      port: 4444,
      fetchImpl,
      timeoutMs: 5000,
      nowMs: () => {
        t += 50;
        return t;
      },
      sleepMs: async () => {},
    });
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  test('throws actionable error after timeout (last error included)', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    let t = 0;
    await expect(
      waitForGeckodriverReady({
        port: 4444,
        fetchImpl,
        timeoutMs: 200,
        nowMs: () => {
          const v = t;
          t += 50;
          return v;
        },
        sleepMs: async () => {},
      }),
    ).rejects.toThrow(/did not become ready.*ECONNREFUSED/);
  });

  test('treats non-2xx /status as "not ready yet" (retry path)', async () => {
    let calls = 0;
    const fetchImpl = jest.fn(async () => {
      calls += 1;
      if (calls < 2) return makeJsonResponse({}, 500);
      return makeJsonResponse({ value: { ready: true } });
    });
    let t = 0;
    await waitForGeckodriverReady({
      port: 4444,
      fetchImpl,
      timeoutMs: 5000,
      nowMs: () => {
        t += 50;
        return t;
      },
      sleepMs: async () => {},
    });
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});

// createMobileFirefoxAndroidDriver — happy path ─────────────────────

describe('createMobileFirefoxAndroidDriver — happy path', () => {
  test('returns a driver with the expected method surface', async () => {
    const spawnImpl = makeSpawnMock();
    const fetchImpl = makeFetchMock(defaultHandlers());
    const driver = await createMobileFirefoxAndroidDriver({
      geckodriverPath: '/opt/homebrew/bin/geckodriver',
      spawnImpl,
      fetchImpl,
      pickPort: async () => 4444,
      waitForReady: async () => true,
    });
    expect(typeof driver.webRefreshRoomsList).toBe('function');
    expect(typeof driver.webUiDump).toBe('function');
    expect(typeof driver.close).toBe('function');
    expect(driver._port).toBe(4444);
    expect(driver._geckodriverPath).toBe('/opt/homebrew/bin/geckodriver');
  });

  test('spawn called with --port + --host args', async () => {
    const spawnImpl = makeSpawnMock();
    const fetchImpl = makeFetchMock(defaultHandlers());
    await createMobileFirefoxAndroidDriver({
      geckodriverPath: '/usr/local/bin/geckodriver',
      spawnImpl,
      fetchImpl,
      pickPort: async () => 4455,
      waitForReady: async () => true,
    });
    expect(spawnImpl).toHaveBeenCalledWith(
      '/usr/local/bin/geckodriver',
      ['--port', '4455', '--host', '127.0.0.1'],
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }),
    );
  });

  test('/session POST includes Firefox-on-Android caps (browserName + moz:firefoxOptions)', async () => {
    const spawnImpl = makeSpawnMock();
    const fetchImpl = makeFetchMock(defaultHandlers());
    const driver = await createMobileFirefoxAndroidDriver({
      geckodriverPath: '/opt/homebrew/bin/geckodriver',
      spawnImpl,
      fetchImpl,
      pickPort: async () => 4444,
      waitForReady: async () => true,
    });
    await driver.webRefreshRoomsList('Alice');
    const sessionCall = fetchImpl.calls.find(
      (c) => c.url.endsWith('/session') && c.opts.method === 'POST',
    );
    const body = JSON.parse(sessionCall.opts.body);
    const caps = body.capabilities.alwaysMatch;
    expect(caps.browserName).toBe('firefox');
    expect(caps['moz:firefoxOptions']).toEqual({
      androidPackage: FIREFOX_ANDROID_PACKAGE,
      androidActivity: FIREFOX_ANDROID_ACTIVITY,
    });
  });

  test('webRefreshRoomsList navigates to <baseURL>/rooms', async () => {
    const spawnImpl = makeSpawnMock();
    const fetchImpl = makeFetchMock(defaultHandlers());
    const driver = await createMobileFirefoxAndroidDriver({
      geckodriverPath: '/opt/homebrew/bin/geckodriver',
      spawnImpl,
      fetchImpl,
      baseURL: 'http://localhost:8888',
      pickPort: async () => 4444,
      waitForReady: async () => true,
    });
    const ok = await driver.webRefreshRoomsList('Alice');
    expect(ok).toBe(true);
    const urlCall = fetchImpl.calls.find((c) => c.url.includes('/url') && c.opts.method === 'POST');
    expect(JSON.parse(urlCall.opts.body)).toEqual({ url: 'http://localhost:8888/rooms' });
  });

  test('webRefreshRoomsList trailing slash collapses', async () => {
    const spawnImpl = makeSpawnMock();
    const fetchImpl = makeFetchMock(defaultHandlers());
    const driver = await createMobileFirefoxAndroidDriver({
      geckodriverPath: '/opt/homebrew/bin/geckodriver',
      spawnImpl,
      fetchImpl,
      baseURL: 'http://localhost:8888/',
      pickPort: async () => 4444,
      waitForReady: async () => true,
    });
    await driver.webRefreshRoomsList('Alice');
    const urlCall = fetchImpl.calls.find((c) => c.url.includes('/url') && c.opts.method === 'POST');
    expect(JSON.parse(urlCall.opts.body)).toEqual({ url: 'http://localhost:8888/rooms' });
  });

  test('webUiDump returns innerText via /execute/sync', async () => {
    const spawnImpl = makeSpawnMock();
    const fetchImpl = makeFetchMock(defaultHandlers({ textValue: 'Firefox text' }));
    const driver = await createMobileFirefoxAndroidDriver({
      geckodriverPath: '/opt/homebrew/bin/geckodriver',
      spawnImpl,
      fetchImpl,
      pickPort: async () => 4444,
      waitForReady: async () => true,
    });
    expect(await driver.webUiDump()).toBe('Firefox text');
    const execCall = fetchImpl.calls.find((c) => c.url.includes('/execute/sync'));
    const body = JSON.parse(execCall.opts.body);
    expect(body.script).toMatch(/document\.body\.innerText/);
  });

  test('session is cached across subsequent web ops', async () => {
    const spawnImpl = makeSpawnMock();
    const fetchImpl = makeFetchMock(defaultHandlers());
    const driver = await createMobileFirefoxAndroidDriver({
      geckodriverPath: '/opt/homebrew/bin/geckodriver',
      spawnImpl,
      fetchImpl,
      pickPort: async () => 4444,
      waitForReady: async () => true,
    });
    await driver.webRefreshRoomsList('Alice');
    await driver.webRefreshRoomsList('Alice');
    const sessionPosts = fetchImpl.calls.filter(
      (c) => c.url.endsWith('/session') && c.opts.method === 'POST',
    );
    expect(sessionPosts).toHaveLength(1);
  });
});

// createMobileFirefoxAndroidDriver — failure modes ───────────────────

describe('createMobileFirefoxAndroidDriver — failure modes', () => {
  test('spawn throws → actionable error mentioning install hint', async () => {
    const spawnImpl = jest.fn(() => {
      throw new Error('spawn ENOENT');
    });
    await expect(
      createMobileFirefoxAndroidDriver({
        geckodriverPath: '/nope/geckodriver',
        spawnImpl,
        fetchImpl: makeFetchMock([]),
        pickPort: async () => 4444,
        waitForReady: async () => true,
      }),
    ).rejects.toThrow(/failed to spawn geckodriver.*brew install geckodriver/);
  });

  test('waitForReady rejects → kills geckodriver + actionable error', async () => {
    const killImpl = jest.fn();
    const spawnImpl = makeSpawnMock({ killImpl });
    await expect(
      createMobileFirefoxAndroidDriver({
        geckodriverPath: '/opt/homebrew/bin/geckodriver',
        spawnImpl,
        fetchImpl: makeFetchMock([]),
        pickPort: async () => 4444,
        waitForReady: async () => {
          throw new Error('timed out');
        },
      }),
    ).rejects.toThrow(/geckodriver not ready.*timed out/);
    expect(killImpl).toHaveBeenCalledWith('SIGTERM');
  });

  test('/session non-2xx → webRefreshRoomsList returns false (no unhandled rejection)', async () => {
    const spawnImpl = makeSpawnMock();
    const fetchImpl = makeFetchMock([
      {
        match: (url) => url.endsWith('/status'),
        respond: () => makeJsonResponse({ value: { ready: true } }),
      },
      {
        match: (url, opts) => url.endsWith('/session') && opts.method === 'POST',
        respond: () => makeTextResponse('Firefox not installed', 500),
      },
    ]);
    const driver = await createMobileFirefoxAndroidDriver({
      geckodriverPath: '/opt/homebrew/bin/geckodriver',
      spawnImpl,
      fetchImpl,
      pickPort: async () => 4444,
      waitForReady: async () => true,
    });
    expect(await driver.webRefreshRoomsList('Alice')).toBe(false);
  });

  test('/url non-2xx → webRefreshRoomsList returns false', async () => {
    const spawnImpl = makeSpawnMock();
    const fetchImpl = makeFetchMock([
      {
        match: (url, opts) => /\/session\/sess-firefox\/url$/.test(url) && opts.method === 'POST',
        respond: () => makeTextResponse('navigation timeout', 500),
      },
      ...defaultHandlers(),
    ]);
    const driver = await createMobileFirefoxAndroidDriver({
      geckodriverPath: '/opt/homebrew/bin/geckodriver',
      spawnImpl,
      fetchImpl,
      pickPort: async () => 4444,
      waitForReady: async () => true,
    });
    expect(await driver.webRefreshRoomsList('Alice')).toBe(false);
  });

  test('webUiDump returns "" when /execute/sync fails', async () => {
    const spawnImpl = makeSpawnMock();
    const fetchImpl = makeFetchMock([
      {
        match: (url) => url.includes('/execute/sync'),
        respond: () => makeTextResponse('script timeout', 500),
      },
      ...defaultHandlers(),
    ]);
    const driver = await createMobileFirefoxAndroidDriver({
      geckodriverPath: '/opt/homebrew/bin/geckodriver',
      spawnImpl,
      fetchImpl,
      pickPort: async () => 4444,
      waitForReady: async () => true,
    });
    expect(await driver.webUiDump()).toBe('');
  });

  test('legacy top-level sessionId is accepted', async () => {
    const spawnImpl = makeSpawnMock();
    const fetchImpl = makeFetchMock([
      {
        match: (url) => url.endsWith('/status'),
        respond: () => makeJsonResponse({ value: { ready: true } }),
      },
      {
        match: (url, opts) => url.endsWith('/session') && opts.method === 'POST',
        respond: () => makeJsonResponse({ sessionId: 'legacy-sess' }),
      },
      {
        match: (url) => url.endsWith('/session/legacy-sess/url'),
        respond: () => makeJsonResponse({ value: null }),
      },
    ]);
    const driver = await createMobileFirefoxAndroidDriver({
      geckodriverPath: '/opt/homebrew/bin/geckodriver',
      spawnImpl,
      fetchImpl,
      pickPort: async () => 4444,
      waitForReady: async () => true,
    });
    expect(await driver.webRefreshRoomsList('Alice')).toBe(true);
  });

  test('/session response missing sessionId at all → returns false', async () => {
    const spawnImpl = makeSpawnMock();
    const fetchImpl = makeFetchMock([
      {
        match: (url) => url.endsWith('/status'),
        respond: () => makeJsonResponse({ value: { ready: true } }),
      },
      {
        match: (url, opts) => url.endsWith('/session') && opts.method === 'POST',
        respond: () => makeJsonResponse({ value: {} }),
      },
    ]);
    const driver = await createMobileFirefoxAndroidDriver({
      geckodriverPath: '/opt/homebrew/bin/geckodriver',
      spawnImpl,
      fetchImpl,
      pickPort: async () => 4444,
      waitForReady: async () => true,
    });
    expect(await driver.webRefreshRoomsList('Alice')).toBe(false);
  });
});

// close ─────────────────────────────────────────────────────────────

describe('close', () => {
  test('DELETEs /session/<id> + kills geckodriver process', async () => {
    const killImpl = jest.fn();
    const spawnImpl = makeSpawnMock({ killImpl });
    const fetchImpl = makeFetchMock(defaultHandlers());
    const driver = await createMobileFirefoxAndroidDriver({
      geckodriverPath: '/opt/homebrew/bin/geckodriver',
      spawnImpl,
      fetchImpl,
      pickPort: async () => 4444,
      waitForReady: async () => true,
    });
    await driver.webRefreshRoomsList('Alice');
    await driver.close();
    expect(fetchImpl.calls.find((c) => c.opts.method === 'DELETE')).toBeDefined();
    expect(killImpl).toHaveBeenCalledWith('SIGTERM');
  });

  test('close before any session: no DELETE, but geckodriver still killed', async () => {
    const killImpl = jest.fn();
    const spawnImpl = makeSpawnMock({ killImpl });
    const fetchImpl = makeFetchMock(defaultHandlers());
    const driver = await createMobileFirefoxAndroidDriver({
      geckodriverPath: '/opt/homebrew/bin/geckodriver',
      spawnImpl,
      fetchImpl,
      pickPort: async () => 4444,
      waitForReady: async () => true,
    });
    await driver.close();
    expect(fetchImpl.calls.filter((c) => c.opts.method === 'DELETE')).toHaveLength(0);
    expect(killImpl).toHaveBeenCalledWith('SIGTERM');
  });

  test('close swallows DELETE network errors + kill errors (best-effort)', async () => {
    const killImpl = jest.fn(() => {
      throw new Error('process gone');
    });
    const spawnImpl = makeSpawnMock({ killImpl });
    const fetchImpl = makeFetchMock([
      {
        match: (_url, opts) => opts.method === 'DELETE',
        respond: () => {
          throw new Error('socket closed');
        },
      },
      ...defaultHandlers(),
    ]);
    const driver = await createMobileFirefoxAndroidDriver({
      geckodriverPath: '/opt/homebrew/bin/geckodriver',
      spawnImpl,
      fetchImpl,
      pickPort: async () => 4444,
      waitForReady: async () => true,
    });
    await driver.webRefreshRoomsList('Alice');
    await expect(driver.close()).resolves.toBeUndefined();
  });
});

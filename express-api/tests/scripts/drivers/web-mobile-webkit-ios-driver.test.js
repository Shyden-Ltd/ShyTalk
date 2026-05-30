/**
 * web-mobile-webkit-ios-driver.test.js
 *
 * Tests for the shared Chrome iOS / Firefox iOS / Edge iOS driver
 * (parameterised by browser slug). All three browsers share the same
 * underlying WebKit transport; the driver differs only in the
 * `appium:bundleId` capability and operator-facing app name.
 *
 * Coverage areas:
 *   - WEBKIT_BROWSERS constant pins per-browser bundleId + appName.
 *   - isSupportedBrowser / supportedBrowsersList exports.
 *   - createMobileWebkitIosDriver input validation (unknown browser,
 *     no iPhone, missing WDA_TEAM_ID).
 *   - Session bootstrap: bundleId per browser, NO browserName:safari
 *     capability, sessionId extraction from both response shapes.
 *   - Webview context switching: GET /contexts, POST /context with the
 *     WEBVIEW_<n> name, error when no webview context available.
 *   - webRefreshRoomsList: ensures webview switch before navigation,
 *     POST /url shape, trailing-slash collapse, failure → false.
 *   - webUiDump: /execute/sync invocation, failure → ''.
 *   - close: DELETE session + clear webview-context cache.
 */

const path = require('path');
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const {
  DEFAULT_APPIUM_BASE_URL,
  WEBKIT_BROWSERS,
  isSupportedBrowser,
  supportedBrowsersList,
  createMobileWebkitIosDriver,
} = require(path.join(REPO_ROOT, 'express-api/scripts/drivers/web-mobile-webkit-ios-driver'));

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

function defaultHandlers({
  sessionId = 'sess-iosbrowser',
  contexts = ['NATIVE_APP', 'WEBVIEW_1'],
  textValue = 'Hello iOS webkit',
} = {}) {
  return [
    {
      match: (url, opts) => url.endsWith('/session') && opts.method === 'POST',
      respond: () => makeJsonResponse({ value: { sessionId } }),
    },
    {
      match: (url, opts) =>
        url.endsWith(`/session/${sessionId}/contexts`) && (!opts.method || opts.method === 'GET'),
      respond: () => makeJsonResponse({ value: contexts }),
    },
    {
      match: (url, opts) => url.endsWith(`/session/${sessionId}/context`) && opts.method === 'POST',
      respond: () => makeJsonResponse({ value: null }),
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

// WEBKIT_BROWSERS constant ───────────────────────────────────────────

describe('WEBKIT_BROWSERS', () => {
  test('contains chrome with the correct App Store bundleId', () => {
    expect(WEBKIT_BROWSERS.chrome).toEqual({
      bundleId: 'com.google.chrome.ios',
      appName: 'Chrome iOS',
    });
  });

  test('contains firefox with the correct App Store bundleId', () => {
    expect(WEBKIT_BROWSERS.firefox).toEqual({
      bundleId: 'org.mozilla.ios.Firefox',
      appName: 'Firefox iOS',
    });
  });

  test('contains edge with the correct App Store bundleId', () => {
    expect(WEBKIT_BROWSERS.edge).toEqual({
      bundleId: 'com.microsoft.msedge.ios',
      appName: 'Edge iOS',
    });
  });

  test('every entry has bundleId + appName (no degenerate config)', () => {
    for (const [_browser, config] of Object.entries(WEBKIT_BROWSERS)) {
      expect(typeof config.bundleId).toBe('string');
      expect(config.bundleId.length).toBeGreaterThan(0);
      expect(typeof config.appName).toBe('string');
      expect(config.appName.length).toBeGreaterThan(0);
      // Sanity: bundleId looks like reverse-DNS
      expect(config.bundleId).toMatch(/^[a-z]+(\.[a-z]+)+/i);
    }
  });
});

describe('isSupportedBrowser / supportedBrowsersList', () => {
  test('isSupportedBrowser returns true for chrome/firefox/edge', () => {
    expect(isSupportedBrowser('chrome')).toBe(true);
    expect(isSupportedBrowser('firefox')).toBe(true);
    expect(isSupportedBrowser('edge')).toBe(true);
  });

  test('isSupportedBrowser returns false for unknown values', () => {
    expect(isSupportedBrowser('safari')).toBe(false);
    expect(isSupportedBrowser('opera')).toBe(false);
    expect(isSupportedBrowser('')).toBe(false);
    expect(isSupportedBrowser(null)).toBe(false);
    expect(isSupportedBrowser(undefined)).toBe(false);
  });

  test('isSupportedBrowser is hasOwnProperty-safe (returns false for prototype keys)', () => {
    // Inherited properties like 'toString' / 'constructor' must NOT count as
    // supported browsers — a `for-in`-style implementation would; this one
    // uses Object.prototype.hasOwnProperty.call which skips inherited keys.
    expect(isSupportedBrowser('toString')).toBe(false);
    expect(isSupportedBrowser('constructor')).toBe(false);
    expect(isSupportedBrowser('hasOwnProperty')).toBe(false);
  });

  test('supportedBrowsersList returns sorted browser names', () => {
    expect(supportedBrowsersList()).toEqual(['chrome', 'edge', 'firefox']);
  });
});

describe('DEFAULT_APPIUM_BASE_URL', () => {
  test('matches the Safari + native iOS driver defaults', () => {
    expect(DEFAULT_APPIUM_BASE_URL).toBe('http://localhost:4723');
  });
});

// createMobileWebkitIosDriver — input validation ─────────────────────

describe('createMobileWebkitIosDriver — input validation', () => {
  test('throws on unknown browser slug', async () => {
    await expect(
      createMobileWebkitIosDriver({
        browser: 'safari',
        wdaTeamId: 'TEAM',
        selectUdidImpl: () => 'UDID',
        fetchImpl: makeFetchMock([]),
      }),
    ).rejects.toThrow(/not supported.*chrome, edge, firefox/);
  });

  test('throws when no iPhone is connected', async () => {
    await expect(
      createMobileWebkitIosDriver({
        browser: 'chrome',
        wdaTeamId: 'TEAM',
        selectUdidImpl: () => null,
        fetchImpl: makeFetchMock([]),
      }),
    ).rejects.toThrow(/no connected iPhone found/);
  });

  test('throws when WDA_TEAM_ID is missing', async () => {
    await expect(
      createMobileWebkitIosDriver({
        browser: 'firefox',
        wdaTeamId: undefined,
        selectUdidImpl: () => 'UDID',
        fetchImpl: makeFetchMock([]),
      }),
    ).rejects.toThrow(/WDA_TEAM_ID env var is required/);
  });

  test('input-validation errors mention the requested browser slug', async () => {
    // Each error should reference the browser so operator can tell
    // which session's bootstrap failed when multiple drivers are open.
    await expect(
      createMobileWebkitIosDriver({
        browser: 'edge',
        wdaTeamId: undefined,
        selectUdidImpl: () => 'UDID',
        fetchImpl: makeFetchMock([]),
      }),
    ).rejects.toThrow(/edge/);
  });

  test('returned driver exposes the expected methods + per-browser metadata', async () => {
    const driver = await createMobileWebkitIosDriver({
      browser: 'firefox',
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID-firefox',
      fetchImpl: makeFetchMock([]),
    });
    expect(typeof driver.webRefreshRoomsList).toBe('function');
    expect(typeof driver.webUiDump).toBe('function');
    expect(typeof driver.close).toBe('function');
    expect(driver._browser).toBe('firefox');
    expect(driver._bundleId).toBe('org.mozilla.ios.Firefox');
    expect(driver._appName).toBe('Firefox iOS');
  });
});

// Session bootstrap — bundleId per browser ───────────────────────────

describe('Session bootstrap', () => {
  test.each([
    ['chrome', 'com.google.chrome.ios'],
    ['firefox', 'org.mozilla.ios.Firefox'],
    ['edge', 'com.microsoft.msedge.ios'],
  ])('%s uses bundleId %s in /session POST', async (browser, bundleId) => {
    const fetchImpl = makeFetchMock(defaultHandlers());
    const driver = await createMobileWebkitIosDriver({
      browser,
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    await driver.webRefreshRoomsList('Alice');
    const sessionCall = fetchImpl.calls.find((c) => c.url.endsWith('/session'));
    const body = JSON.parse(sessionCall.opts.body);
    const caps = body.capabilities.alwaysMatch;
    expect(caps['appium:bundleId']).toBe(bundleId);
    // Critical pin: NO browserName:safari capability — that would
    // launch Safari instead of the requested browser app.
    expect(caps['appium:browserName']).toBeUndefined();
  });

  test('session cache: subsequent calls reuse the sessionId', async () => {
    const fetchImpl = makeFetchMock(defaultHandlers());
    const driver = await createMobileWebkitIosDriver({
      browser: 'chrome',
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    await driver.webRefreshRoomsList('Alice');
    await driver.webRefreshRoomsList('Alice');
    const sessionPosts = fetchImpl.calls.filter(
      (c) => c.url.endsWith('/session') && c.opts.method === 'POST',
    );
    expect(sessionPosts).toHaveLength(1);
  });

  test('legacy top-level sessionId shape is accepted', async () => {
    const fetchImpl = makeFetchMock([
      {
        match: (url, opts) => url.endsWith('/session') && opts.method === 'POST',
        respond: () => makeJsonResponse({ sessionId: 'legacy-sess' }),
      },
      {
        match: (url) => url.endsWith('/session/legacy-sess/contexts'),
        respond: () => makeJsonResponse({ value: ['NATIVE_APP', 'WEBVIEW_1'] }),
      },
      {
        match: (url, opts) =>
          url.endsWith('/session/legacy-sess/context') && opts.method === 'POST',
        respond: () => makeJsonResponse({ value: null }),
      },
      {
        match: (url, opts) => url.endsWith('/session/legacy-sess/url') && opts.method === 'POST',
        respond: () => makeJsonResponse({ value: null }),
      },
    ]);
    const driver = await createMobileWebkitIosDriver({
      browser: 'edge',
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    expect(await driver.webRefreshRoomsList('Alice')).toBe(true);
  });

  test('/session non-2xx → driver returns false (no unhandled rejection)', async () => {
    const fetchImpl = makeFetchMock([
      {
        match: (url, opts) => url.endsWith('/session') && opts.method === 'POST',
        respond: () => makeTextResponse('Could not launch app', 500),
      },
    ]);
    const driver = await createMobileWebkitIosDriver({
      browser: 'chrome',
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    expect(await driver.webRefreshRoomsList('Alice')).toBe(false);
  });

  test('/session error message mentions the appName so operator knows which app failed', async () => {
    const fetchImpl = makeFetchMock([
      {
        match: (url, opts) => url.endsWith('/session') && opts.method === 'POST',
        respond: () => makeTextResponse('bundle not found', 500),
      },
    ]);
    const driver = await createMobileWebkitIosDriver({
      browser: 'firefox',
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await driver.webRefreshRoomsList('Alice');
    const logged = spy.mock.calls.map((c) => c[0]).join('\n');
    expect(logged).toMatch(/Firefox iOS/);
    spy.mockRestore();
  });
});

// Webview context switching ─────────────────────────────────────────

describe('Webview context switching', () => {
  test('first webRefreshRoomsList triggers GET /contexts + POST /context (WEBVIEW_1)', async () => {
    const fetchImpl = makeFetchMock(defaultHandlers());
    const driver = await createMobileWebkitIosDriver({
      browser: 'chrome',
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    await driver.webRefreshRoomsList('Alice');
    const ctxGet = fetchImpl.calls.find((c) => c.url.endsWith('/contexts'));
    expect(ctxGet).toBeDefined();
    const ctxPost = fetchImpl.calls.find(
      (c) => c.url.endsWith('/context') && c.opts.method === 'POST',
    );
    expect(ctxPost).toBeDefined();
    expect(JSON.parse(ctxPost.opts.body)).toEqual({ name: 'WEBVIEW_1' });
  });

  test('webview context is cached across subsequent web ops (no re-switch)', async () => {
    const fetchImpl = makeFetchMock(defaultHandlers());
    const driver = await createMobileWebkitIosDriver({
      browser: 'chrome',
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    await driver.webRefreshRoomsList('Alice');
    await driver.webRefreshRoomsList('Alice');
    await driver.webUiDump();
    const ctxPosts = fetchImpl.calls.filter(
      (c) => c.url.endsWith('/context') && c.opts.method === 'POST',
    );
    expect(ctxPosts).toHaveLength(1);
  });

  test('uses the first WEBVIEW_<n> context when multiple are listed', async () => {
    const fetchImpl = makeFetchMock(
      defaultHandlers({ contexts: ['NATIVE_APP', 'WEBVIEW_3', 'WEBVIEW_7'] }),
    );
    const driver = await createMobileWebkitIosDriver({
      browser: 'chrome',
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    await driver.webRefreshRoomsList('Alice');
    const ctxPost = fetchImpl.calls.find(
      (c) => c.url.endsWith('/context') && c.opts.method === 'POST',
    );
    expect(JSON.parse(ctxPost.opts.body)).toEqual({ name: 'WEBVIEW_3' });
  });

  test('no WEBVIEW_ context available → returns false with actionable error log', async () => {
    const fetchImpl = makeFetchMock(defaultHandlers({ contexts: ['NATIVE_APP'] }));
    const driver = await createMobileWebkitIosDriver({
      browser: 'chrome',
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const ok = await driver.webRefreshRoomsList('Alice');
    expect(ok).toBe(false);
    const logged = spy.mock.calls.map((c) => c[0]).join('\n');
    expect(logged).toMatch(/no WEBVIEW_ context/);
    expect(logged).toMatch(/Web Inspector ON/);
    spy.mockRestore();
  });

  test('non-2xx GET /contexts → returns false', async () => {
    const fetchImpl = makeFetchMock([
      {
        match: (url, opts) => url.endsWith('/session') && opts.method === 'POST',
        respond: () => makeJsonResponse({ value: { sessionId: 'sess-iosbrowser' } }),
      },
      {
        match: (url) => url.endsWith('/contexts'),
        respond: () => makeTextResponse('not authorised', 500),
      },
    ]);
    const driver = await createMobileWebkitIosDriver({
      browser: 'chrome',
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    expect(await driver.webRefreshRoomsList('Alice')).toBe(false);
  });

  test('non-2xx POST /context (switch) → returns false', async () => {
    const fetchImpl = makeFetchMock([
      {
        match: (url, opts) => url.endsWith('/session') && opts.method === 'POST',
        respond: () => makeJsonResponse({ value: { sessionId: 'sess-iosbrowser' } }),
      },
      {
        match: (url) => url.endsWith('/contexts'),
        respond: () => makeJsonResponse({ value: ['NATIVE_APP', 'WEBVIEW_1'] }),
      },
      {
        match: (url, opts) => url.endsWith('/context') && opts.method === 'POST',
        respond: () => makeTextResponse('switch failed', 500),
      },
    ]);
    const driver = await createMobileWebkitIosDriver({
      browser: 'chrome',
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    expect(await driver.webRefreshRoomsList('Alice')).toBe(false);
  });
});

// webRefreshRoomsList ───────────────────────────────────────────────

describe('webRefreshRoomsList', () => {
  test('navigates to <baseURL>/rooms', async () => {
    const fetchImpl = makeFetchMock(defaultHandlers());
    const driver = await createMobileWebkitIosDriver({
      browser: 'chrome',
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      baseURL: 'http://localhost:8888',
      fetchImpl,
    });
    await driver.webRefreshRoomsList('Alice');
    const urlCall = fetchImpl.calls.find((c) => c.url.endsWith('/url') && c.opts.method === 'POST');
    expect(JSON.parse(urlCall.opts.body)).toEqual({ url: 'http://localhost:8888/rooms' });
  });

  test('trailing slash collapses', async () => {
    const fetchImpl = makeFetchMock(defaultHandlers());
    const driver = await createMobileWebkitIosDriver({
      browser: 'chrome',
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      baseURL: 'http://localhost:8888/',
      fetchImpl,
    });
    await driver.webRefreshRoomsList('Alice');
    const urlCall = fetchImpl.calls.find((c) => c.url.endsWith('/url') && c.opts.method === 'POST');
    expect(JSON.parse(urlCall.opts.body)).toEqual({ url: 'http://localhost:8888/rooms' });
  });

  test('/url non-2xx → returns false', async () => {
    const fetchImpl = makeFetchMock([
      {
        match: (url, opts) => url.endsWith('/url') && opts.method === 'POST',
        respond: () => makeTextResponse('webkit failed', 500),
      },
      ...defaultHandlers(),
    ]);
    const driver = await createMobileWebkitIosDriver({
      browser: 'chrome',
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    expect(await driver.webRefreshRoomsList('Alice')).toBe(false);
  });
});

// webUiDump ─────────────────────────────────────────────────────────

describe('webUiDump', () => {
  test('returns innerText from /execute/sync', async () => {
    const fetchImpl = makeFetchMock(defaultHandlers({ textValue: 'Hello Webkit' }));
    const driver = await createMobileWebkitIosDriver({
      browser: 'edge',
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    expect(await driver.webUiDump()).toBe('Hello Webkit');
  });

  test('returns "" on /execute/sync failure', async () => {
    const fetchImpl = makeFetchMock([
      {
        match: (url) => url.includes('/execute/sync'),
        respond: () => makeTextResponse('CDP timeout', 500),
      },
      ...defaultHandlers(),
    ]);
    const driver = await createMobileWebkitIosDriver({
      browser: 'chrome',
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    expect(await driver.webUiDump()).toBe('');
  });

  test('returns "" when /execute/sync value is null', async () => {
    const fetchImpl = makeFetchMock([
      {
        match: (url) => url.includes('/execute/sync'),
        respond: () => makeJsonResponse({ value: null }),
      },
      ...defaultHandlers(),
    ]);
    const driver = await createMobileWebkitIosDriver({
      browser: 'chrome',
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    expect(await driver.webUiDump()).toBe('');
  });
});

// close ─────────────────────────────────────────────────────────────

describe('close', () => {
  test('DELETEs /session/<id> after a session was created', async () => {
    const fetchImpl = makeFetchMock(defaultHandlers());
    const driver = await createMobileWebkitIosDriver({
      browser: 'chrome',
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    await driver.webRefreshRoomsList('Alice');
    await driver.close();
    const del = fetchImpl.calls.find((c) => c.opts.method === 'DELETE');
    expect(del).toBeDefined();
  });

  test('no-ops when no session exists', async () => {
    const fetchImpl = makeFetchMock(defaultHandlers());
    const driver = await createMobileWebkitIosDriver({
      browser: 'chrome',
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    await driver.close();
    expect(fetchImpl.calls.filter((c) => c.opts.method === 'DELETE')).toHaveLength(0);
  });

  test('swallows DELETE network errors (best-effort)', async () => {
    const fetchImpl = makeFetchMock([
      {
        match: (_url, opts) => opts.method === 'DELETE',
        respond: () => {
          throw new Error('Appium gone');
        },
      },
      ...defaultHandlers(),
    ]);
    const driver = await createMobileWebkitIosDriver({
      browser: 'chrome',
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    await driver.webRefreshRoomsList('Alice');
    await expect(driver.close()).resolves.toBeUndefined();
  });

  test('after close, next web op re-bootstraps a session + webview context', async () => {
    const fetchImpl = makeFetchMock(defaultHandlers());
    const driver = await createMobileWebkitIosDriver({
      browser: 'chrome',
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    await driver.webRefreshRoomsList('Alice');
    await driver.close();
    await driver.webRefreshRoomsList('Alice');
    const sessionPosts = fetchImpl.calls.filter(
      (c) => c.url.endsWith('/session') && c.opts.method === 'POST',
    );
    expect(sessionPosts).toHaveLength(2); // re-bootstrapped
  });
});

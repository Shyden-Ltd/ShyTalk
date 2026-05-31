/**
 * web-mobile-safari-ios-driver.test.js
 *
 * Tests the Mobile Safari iOS driver. The driver delegates udid
 * selection to ios-appium-driver's exported selectUdid; we inject a
 * mock selectUdidImpl to avoid needing a real /usr/bin/xcrun.
 * fetchImpl is mocked so no real Appium server / iPhone is needed.
 *
 * Coverage areas:
 *   - createMobileSafariIosDriver input validation (udid missing,
 *     WDA_TEAM_ID missing).
 *   - Session bootstrap: POST /session with browserName:safari + the
 *     other XCUITest caps; sessionId extraction from both response
 *     shapes (W3C value.sessionId + legacy sessionId).
 *   - webRefreshRoomsList: navigates to <baseURL>/rooms; trailing-slash
 *     collapse; failure → returns false.
 *   - webUiDump: invokes /execute/sync with the innerText script;
 *     failure → returns ''.
 *   - close: DELETEs session; session-not-yet-started no-op; swallows
 *     network errors.
 */

const path = require('path');
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const { DEFAULT_APPIUM_BASE_URL, createMobileSafariIosDriver } = require(
  path.join(REPO_ROOT, 'express-api/scripts/drivers/web-mobile-safari-ios-driver'),
);

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

function defaultHandlers({ sessionId = 'sess-abc', textValue = 'Hello' } = {}) {
  return [
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

// createMobileSafariIosDriver — input validation ──────────────────────

describe('createMobileSafariIosDriver — input validation', () => {
  test('throws when no iPhone is connected (selectUdid returns null)', async () => {
    await expect(
      createMobileSafariIosDriver({
        wdaTeamId: 'TEAM123',
        selectUdidImpl: () => null,
        fetchImpl: makeFetchMock([]),
      }),
    ).rejects.toThrow(/no connected iPhone found.*xcrun devicectl/);
  });

  test('throws when WDA_TEAM_ID is missing', async () => {
    await expect(
      createMobileSafariIosDriver({
        wdaTeamId: undefined,
        selectUdidImpl: () => 'ABCDEFG-12345678',
        fetchImpl: makeFetchMock([]),
      }),
    ).rejects.toThrow(/WDA_TEAM_ID env var is required/);
  });

  test('preferred udid is forwarded to selectUdidImpl', async () => {
    const selectUdidImpl = jest.fn((p) => p);
    await createMobileSafariIosDriver({
      wdaTeamId: 'TEAM123',
      udid: 'PREFERRED-UDID',
      selectUdidImpl,
      fetchImpl: makeFetchMock([]),
    });
    expect(selectUdidImpl).toHaveBeenCalledWith('PREFERRED-UDID');
  });

  test('returned driver exposes the expected methods', async () => {
    const driver = await createMobileSafariIosDriver({
      wdaTeamId: 'TEAM123',
      selectUdidImpl: () => 'UDID',
      fetchImpl: makeFetchMock([]),
    });
    expect(typeof driver.webRefreshRoomsList).toBe('function');
    expect(typeof driver.webUiDump).toBe('function');
    expect(typeof driver.close).toBe('function');
  });
});

// Session bootstrap ──────────────────────────────────────────────────

describe('createMobileSafariIosDriver — session bootstrap', () => {
  test('POSTs /session with browserName=safari + xcodeOrgId capabilities', async () => {
    const fetchImpl = makeFetchMock(defaultHandlers());
    const driver = await createMobileSafariIosDriver({
      wdaTeamId: 'TEAM123',
      selectUdidImpl: () => 'UDID-A',
      fetchImpl,
    });
    await driver.webRefreshRoomsList('Alice');
    const sessionCall = fetchImpl.calls.find((c) => c.url.endsWith('/session'));
    expect(sessionCall).toBeDefined();
    const body = JSON.parse(sessionCall.opts.body);
    const caps = body.capabilities.alwaysMatch;
    expect(caps.platformName).toBe('iOS');
    expect(caps['appium:automationName']).toBe('XCUITest');
    expect(caps['appium:browserName']).toBe('safari');
    expect(caps['appium:udid']).toBe('UDID-A');
    expect(caps['appium:xcodeOrgId']).toBe('TEAM123');
    // No bundleId — Safari mode doesn't take an app target.
    expect(caps['appium:bundleId']).toBeUndefined();
  });

  test('subsequent calls reuse the cached sessionId (no second /session POST)', async () => {
    const fetchImpl = makeFetchMock(defaultHandlers());
    const driver = await createMobileSafariIosDriver({
      wdaTeamId: 'TEAM123',
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

  test('falls back to top-level sessionId when value.sessionId is missing (legacy resp)', async () => {
    const fetchImpl = makeFetchMock([
      {
        match: (url, opts) => url.endsWith('/session') && opts.method === 'POST',
        respond: () => makeJsonResponse({ sessionId: 'legacy-sess' }),
      },
      {
        match: (url) => url.endsWith('/session/legacy-sess/url'),
        respond: () => makeJsonResponse({ value: null }),
      },
    ]);
    const driver = await createMobileSafariIosDriver({
      wdaTeamId: 'TEAM123',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    const ok = await driver.webRefreshRoomsList('Alice');
    expect(ok).toBe(true);
  });

  test('throws actionable error when /session returns non-2xx', async () => {
    const fetchImpl = makeFetchMock([
      {
        match: (url, opts) => url.endsWith('/session') && opts.method === 'POST',
        respond: () => makeTextResponse('Cannot create session: WDA not installed', 500),
      },
    ]);
    const driver = await createMobileSafariIosDriver({
      wdaTeamId: 'TEAM123',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    const ok = await driver.webRefreshRoomsList('Alice');
    expect(ok).toBe(false);
  });

  test('throws when /session returns no sessionId at all (degenerate body)', async () => {
    const fetchImpl = makeFetchMock([
      {
        match: (url, opts) => url.endsWith('/session') && opts.method === 'POST',
        respond: () => makeJsonResponse({ value: {} }),
      },
    ]);
    const driver = await createMobileSafariIosDriver({
      wdaTeamId: 'TEAM123',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    const ok = await driver.webRefreshRoomsList('Alice');
    expect(ok).toBe(false);
  });

  test('honours injected appiumBaseUrl over the default', async () => {
    const fetchImpl = makeFetchMock(defaultHandlers());
    const driver = await createMobileSafariIosDriver({
      wdaTeamId: 'TEAM123',
      selectUdidImpl: () => 'UDID',
      appiumBaseUrl: 'http://localhost:7777',
      fetchImpl,
    });
    await driver.webRefreshRoomsList('Alice');
    expect(fetchImpl.calls[0].url).toBe('http://localhost:7777/session');
  });

  test('DEFAULT_APPIUM_BASE_URL points at localhost:4723', () => {
    expect(DEFAULT_APPIUM_BASE_URL).toBe('http://localhost:4723');
  });
});

// webRefreshRoomsList ────────────────────────────────────────────────

describe('webRefreshRoomsList', () => {
  test('POSTs /session/<id>/url with <baseURL>/rooms', async () => {
    const fetchImpl = makeFetchMock(defaultHandlers());
    const driver = await createMobileSafariIosDriver({
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      baseURL: 'http://localhost:8888',
      fetchImpl,
    });
    const ok = await driver.webRefreshRoomsList('Alice');
    expect(ok).toBe(true);
    const urlCall = fetchImpl.calls.find((c) => c.url.includes('/url'));
    expect(JSON.parse(urlCall.opts.body)).toEqual({ url: 'http://localhost:8888/rooms' });
  });

  test('trailing slash collapses (no `//rooms`)', async () => {
    const fetchImpl = makeFetchMock(defaultHandlers());
    const driver = await createMobileSafariIosDriver({
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      baseURL: 'http://localhost:8888/',
      fetchImpl,
    });
    await driver.webRefreshRoomsList('Alice');
    const urlCall = fetchImpl.calls.find((c) => c.url.includes('/url'));
    expect(JSON.parse(urlCall.opts.body)).toEqual({ url: 'http://localhost:8888/rooms' });
  });

  test('returns false when /url returns non-2xx (no unhandled rejection)', async () => {
    // Custom handler ahead of defaultHandlers — first-match-wins in
    // makeFetchMock, so a failing /url handler must precede the success
    // one from defaultHandlers.
    const fetchImpl = makeFetchMock([
      {
        match: (url, opts) => /\/session\/sess-abc\/url$/.test(url) && opts.method === 'POST',
        respond: () => makeTextResponse('webkit: navigation timed out', 500),
      },
      ...defaultHandlers(),
    ]);
    const driver = await createMobileSafariIosDriver({
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    const ok = await driver.webRefreshRoomsList('Alice');
    expect(ok).toBe(false);
  });
});

// webUiDump ─────────────────────────────────────────────────────────

describe('webUiDump', () => {
  test('invokes /execute/sync with the innerText script + returns the value', async () => {
    const fetchImpl = makeFetchMock(defaultHandlers({ textValue: 'Welcome to ShyTalk' }));
    const driver = await createMobileSafariIosDriver({
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    const text = await driver.webUiDump();
    expect(text).toBe('Welcome to ShyTalk');
    const execCall = fetchImpl.calls.find((c) => c.url.includes('/execute/sync'));
    expect(execCall).toBeDefined();
    const body = JSON.parse(execCall.opts.body);
    expect(body.script).toMatch(/document\.body\.innerText/);
    expect(body.args).toEqual([]);
  });

  test('returns empty string when /execute/sync fails', async () => {
    const fetchImpl = makeFetchMock([
      // Custom failing /execute/sync ahead of defaults — first-match-wins.
      {
        match: (url) => url.includes('/execute/sync'),
        respond: () => makeTextResponse('CDP timeout', 500),
      },
      ...defaultHandlers(),
    ]);
    const driver = await createMobileSafariIosDriver({
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    expect(await driver.webUiDump()).toBe('');
  });

  test('returns empty string when /execute/sync value is missing', async () => {
    const fetchImpl = makeFetchMock([
      // Custom value:null handler ahead of defaults — first-match-wins.
      {
        match: (url) => url.includes('/execute/sync'),
        respond: () => makeJsonResponse({ value: null }),
      },
      ...defaultHandlers(),
    ]);
    const driver = await createMobileSafariIosDriver({
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
    const driver = await createMobileSafariIosDriver({
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    await driver.webRefreshRoomsList('Alice');
    await driver.close();
    const del = fetchImpl.calls.find((c) => c.opts.method === 'DELETE');
    expect(del).toBeDefined();
    expect(del.url).toMatch(/\/session\/sess-abc$/);
  });

  test('no-ops when called before any session exists (fast-path)', async () => {
    const fetchImpl = makeFetchMock(defaultHandlers());
    const driver = await createMobileSafariIosDriver({
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    await driver.close();
    // No POST /session because we never called webXxx; no DELETE either.
    expect(fetchImpl.calls.filter((c) => c.opts.method === 'DELETE')).toHaveLength(0);
  });

  test('swallows DELETE-side network errors so cleanup is best-effort', async () => {
    const fetchImpl = makeFetchMock([
      ...defaultHandlers(),
      {
        match: (_url, opts) => opts.method === 'DELETE',
        respond: () => {
          throw new Error('Appium server gone');
        },
      },
    ]);
    const driver = await createMobileSafariIosDriver({
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    await driver.webRefreshRoomsList('Alice');
    await expect(driver.close()).resolves.toBeUndefined();
  });

  test('second close after first is a no-op (sessionId cleared)', async () => {
    const fetchImpl = makeFetchMock(defaultHandlers());
    const driver = await createMobileSafariIosDriver({
      wdaTeamId: 'TEAM',
      selectUdidImpl: () => 'UDID',
      fetchImpl,
    });
    await driver.webRefreshRoomsList('Alice');
    await driver.close();
    await driver.close();
    expect(fetchImpl.calls.filter((c) => c.opts.method === 'DELETE')).toHaveLength(1);
  });
});

// takeScreenshot — behavioral delegation (gap C3, reviewer I2) ────────

describe('createMobileSafariIosDriver — takeScreenshot delegation', () => {
  const helperPath = path.join(REPO_ROOT, 'express-api/scripts/drivers/driver-screenshot-helper');
  const helper = require(helperPath);

  test('routes to takeScreenshotViaAppium with Appium URL + session + slug', async () => {
    const spy = jest
      .spyOn(helper, 'takeScreenshotViaAppium')
      .mockResolvedValue(['/mock/safari.png']);
    try {
      const fetchImpl = makeFetchMock(defaultHandlers({ sessionId: 'sess-xyz' }));
      const driver = await createMobileSafariIosDriver({
        wdaTeamId: 'TEAM123',
        selectUdidImpl: () => 'UDID',
        fetchImpl,
      });
      // Establish session via a normal driver call so _sessionId is set.
      await driver.webRefreshRoomsList('Alice');

      const result = await driver.takeScreenshot('/tmp/report');

      expect(spy).toHaveBeenCalledTimes(1);
      const [args] = spy.mock.calls[0];
      expect(args.appiumBaseUrl).toBe(DEFAULT_APPIUM_BASE_URL);
      expect(args.sessionId).toBe('sess-xyz');
      expect(args.fetchImpl).toBe(fetchImpl);
      expect(args.outputDir).toBe('/tmp/report');
      expect(args.slug).toBe('mobile-safari-ios');
      expect(result).toEqual(['/mock/safari.png']);
    } finally {
      spy.mockRestore();
    }
  });

  test('sessionId is null when called before session-establishment', async () => {
    // Drift-catch: if a future refactor pre-establishes the session
    // eagerly in the factory, this test fails — which is fine, the
    // sessionId field will be set; but the assertion then needs an
    // update. Today, _sessionId starts null until first method call.
    const spy = jest.spyOn(helper, 'takeScreenshotViaAppium').mockResolvedValue([]);
    try {
      const driver = await createMobileSafariIosDriver({
        wdaTeamId: 'TEAM123',
        selectUdidImpl: () => 'UDID',
        fetchImpl: makeFetchMock([]),
      });
      await driver.takeScreenshot('/tmp/out');
      expect(spy.mock.calls[0][0].sessionId).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

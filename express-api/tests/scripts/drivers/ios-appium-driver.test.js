/**
 * ios-appium-driver — driver-method unit tests
 *
 * Mocks: execFileSync (for udid selection) + fetch (for Appium HTTP).
 * No live Appium server, no iPhone needed for these tests. Each test
 * pins one method's protocol-level interaction with the Appium
 * WebDriver REST API.
 */

const path = require('path');

jest.mock('child_process', () => ({
  execFileSync: jest.fn(),
}));

const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const { createIosDriver, listMethods, selectUdid, IOS_METHOD_NAMES } = require(
  path.join(REPO_ROOT, 'express-api/scripts/drivers/ios-appium-driver'),
);

const STUB_UDID = '74563FF8-D1FC-567D-A6C1-7C8C3CEFE0C6';
const STUB_DEVICECTL_OUTPUT = [
  'Name            Hostname                        Identifier                             State                Model',
  '-------------   -----------------------------   ------------------------------------   ------------------   ----',
  `Sean's iPhone   Seans-iPhone.coredevice.local   ${STUB_UDID}   available (paired)   iPhone Air (iPhone18,4)`,
].join('\n');

function makeFetchMock({ sessionId = 'session-abc' } = {}) {
  return jest.fn(async (url, opts) => {
    if (url.endsWith('/session') && opts.method === 'POST') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ value: { sessionId } }),
        text: async () => '',
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ value: '' }),
      text: async () => '',
    };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  execFileSync.mockReturnValue(STUB_DEVICECTL_OUTPUT);
});

describe('ios-appium-driver — selectUdid', () => {
  test('returns the preferred udid when one is supplied', () => {
    expect(selectUdid('explicit-udid-123')).toBe('explicit-udid-123');
  });

  test('parses the standard devicectl table format', () => {
    execFileSync.mockReturnValue(STUB_DEVICECTL_OUTPUT);
    expect(selectUdid()).toBe(STUB_UDID);
  });

  test('parses the legacy 8-16 dash-separated UDID format', () => {
    const legacyUdid = '00008110-001A2B3C4D5E6F70';
    execFileSync.mockReturnValue(`Some Device   host.local   ${legacyUdid}   connected   iPhone X`);
    expect(selectUdid()).toBe(legacyUdid);
  });

  test('returns null when no device shows available/connected state', () => {
    execFileSync.mockReturnValue('Name            Hostname     Identifier   State   Model\n');
    expect(selectUdid()).toBeNull();
  });

  test('returns null when execFileSync throws (devicectl missing / Xcode not installed)', () => {
    execFileSync.mockImplementation(() => {
      throw new Error('xcrun: not found');
    });
    expect(selectUdid()).toBeNull();
  });

  test('uses execFileSync (no shell), passing absolute /usr/bin/xcrun + args as an array', () => {
    selectUdid();
    expect(execFileSync).toHaveBeenCalledWith(
      '/usr/bin/xcrun',
      ['devicectl', 'list', 'devices'],
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'ignore'] }),
    );
  });
});

describe('ios-appium-driver — createIosDriver', () => {
  test('throws actionable error when no device is connected', async () => {
    execFileSync.mockReturnValue('Name   State   Model\n');
    await expect(
      createIosDriver({ wdaTeamId: 'TEAM123', fetchImpl: makeFetchMock() }),
    ).rejects.toThrow(/no connected iPhone found/);
  });

  test('throws actionable error when WDA_TEAM_ID is missing', async () => {
    delete process.env.WDA_TEAM_ID;
    await expect(createIosDriver({ fetchImpl: makeFetchMock(), target: 'dev' })).rejects.toThrow(
      /WDA_TEAM_ID env var is required/,
    );
  });

  test('returns a driver object with the expected methods', async () => {
    const driver = await createIosDriver({
      wdaTeamId: 'TEAM123',
      fetchImpl: makeFetchMock(),
    });
    expect(typeof driver.iosLaunchApp).toBe('function');
    expect(typeof driver.iosUiDump).toBe('function');
    expect(typeof driver.iosTap).toBe('function');
    expect(typeof driver.iosTapByTag).toBe('function');
    expect(typeof driver.iosPersonaSignIn).toBe('function');
    expect(typeof driver.close).toBe('function');
    expect(driver._udid).toBe(STUB_UDID);
  });

  test('target="local" → bundleId com.shyden.shytalk.local', async () => {
    const driver = await createIosDriver({
      wdaTeamId: 'TEAM123',
      fetchImpl: makeFetchMock(),
      target: 'local',
    });
    expect(driver._bundleId).toBe('com.shyden.shytalk.local');
  });

  test('target="prod" → bundleId com.shyden.shytalk (no suffix)', async () => {
    const driver = await createIosDriver({
      wdaTeamId: 'TEAM123',
      fetchImpl: makeFetchMock(),
      target: 'prod',
    });
    expect(driver._bundleId).toBe('com.shyden.shytalk');
  });

  test('explicit bundleId overrides target', async () => {
    const driver = await createIosDriver({
      wdaTeamId: 'TEAM123',
      fetchImpl: makeFetchMock(),
      target: 'dev',
      bundleId: 'com.example.custom',
    });
    expect(driver._bundleId).toBe('com.example.custom');
  });
});

describe('ios-appium-driver — session bootstrap', () => {
  test('first method call opens an Appium session with the right capabilities', async () => {
    const fetchMock = makeFetchMock();
    const driver = await createIosDriver({
      wdaTeamId: 'TEAM-MY-TEAM',
      fetchImpl: fetchMock,
      target: 'dev',
    });
    await driver.iosUiDump();
    const sessionCall = fetchMock.mock.calls.find(
      ([url, opts]) => url.endsWith('/session') && opts.method === 'POST',
    );
    expect(sessionCall).toBeDefined();
    const caps = JSON.parse(sessionCall[1].body);
    expect(caps.capabilities.alwaysMatch).toMatchObject({
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
      'appium:udid': STUB_UDID,
      'appium:bundleId': 'com.shyden.shytalk.dev',
      'appium:xcodeOrgId': 'TEAM-MY-TEAM',
    });
  });

  test('session id is reused across multiple method calls (cache)', async () => {
    const fetchMock = makeFetchMock({ sessionId: 'cached-sid' });
    const driver = await createIosDriver({ wdaTeamId: 'T', fetchImpl: fetchMock });
    await driver.iosUiDump();
    await driver.iosUiDump();
    const sessionCalls = fetchMock.mock.calls.filter(
      ([url, opts]) => url.endsWith('/session') && opts.method === 'POST',
    );
    expect(sessionCalls).toHaveLength(1);
  });

  test('Appium /session returning non-2xx → throws with diagnostic body snippet', async () => {
    const fetchMock = jest.fn(async (url) => {
      if (url.endsWith('/session')) {
        return {
          ok: false,
          status: 500,
          text: async () => 'WDA install failed: signing identity not found',
        };
      }
      return { ok: true, status: 200, json: async () => ({ value: '' }), text: async () => '' };
    });
    const driver = await createIosDriver({ wdaTeamId: 'T', fetchImpl: fetchMock });
    await expect(driver.iosUiDump()).resolves.toBe(''); // iosUiDump swallows
    // Direct method that doesn't swallow should rethrow.
    await expect(driver.iosLaunchApp()).rejects.toThrow(/Appium \/session failed \(500\)/);
    await expect(driver.iosLaunchApp()).rejects.toThrow(/Is the Appium server running/);
  });
});

describe('ios-appium-driver — iosUiDump', () => {
  test('GETs /session/<sid>/source and returns the value field', async () => {
    const fakeXml =
      '<XCUIElementTypeApplication><XCUIElementTypeButton/></XCUIElementTypeApplication>';
    const fetchMock = jest.fn(async (url, opts) => {
      if (url.endsWith('/session') && opts.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ value: { sessionId: 'sid-1' } }),
          text: async () => '',
        };
      }
      if (url.endsWith('/session/sid-1/source') && opts.method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ value: fakeXml }),
          text: async () => '',
        };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    });
    const driver = await createIosDriver({ wdaTeamId: 'T', fetchImpl: fetchMock });
    expect(await driver.iosUiDump()).toBe(fakeXml);
  });

  test('returns empty string when /source returns non-2xx (no throw)', async () => {
    const fetchMock = jest.fn(async (url, opts) => {
      if (url.endsWith('/session') && opts.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ value: { sessionId: 'sid-1' } }),
          text: async () => '',
        };
      }
      if (url.includes('/source')) return { ok: false, status: 500 };
      return { ok: true, json: async () => ({}) };
    });
    const driver = await createIosDriver({ wdaTeamId: 'T', fetchImpl: fetchMock });
    expect(await driver.iosUiDump()).toBe('');
  });
});

describe('ios-appium-driver — iosTap', () => {
  test('POSTs W3C pointer actions for the given coordinates', async () => {
    const fetchMock = makeFetchMock({ sessionId: 'sid-tap' });
    const driver = await createIosDriver({ wdaTeamId: 'T', fetchImpl: fetchMock });
    const ok = await driver.iosTap(200, 400);
    expect(ok).toBe(true);
    const actionCall = fetchMock.mock.calls.find(([url]) =>
      url.endsWith('/session/sid-tap/actions'),
    );
    expect(actionCall).toBeDefined();
    const body = JSON.parse(actionCall[1].body);
    expect(body.actions[0].type).toBe('pointer');
    expect(body.actions[0].actions[0]).toEqual({
      type: 'pointerMove',
      duration: 0,
      x: 200,
      y: 400,
    });
  });
});

describe('ios-appium-driver — iosTapByTag', () => {
  test('happy path: finds element by accessibility id, clicks it', async () => {
    const fetchMock = jest.fn(async (url, opts) => {
      if (url.endsWith('/session') && opts.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ value: { sessionId: 'sid-tap-tag' } }),
          text: async () => '',
        };
      }
      if (url.endsWith('/session/sid-tap-tag/element') && opts.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            value: { 'element-6066-11e4-a52e-4f735466cecf': 'element-42' },
          }),
          text: async () => '',
        };
      }
      if (url.endsWith('/session/sid-tap-tag/element/element-42/click')) {
        return { ok: true, status: 200, text: async () => '' };
      }
      return { ok: false, status: 404 };
    });
    const driver = await createIosDriver({ wdaTeamId: 'T', fetchImpl: fetchMock });
    expect(await driver.iosTapByTag('persona_picker_open')).toBe(true);
    const findCall = fetchMock.mock.calls.find(
      ([url, opts]) => url.endsWith('/element') && opts.method === 'POST',
    );
    expect(JSON.parse(findCall[1].body)).toEqual({
      using: 'accessibility id',
      value: 'persona_picker_open',
    });
  });

  test('element-not-found → returns false (no throw)', async () => {
    const fetchMock = jest.fn(async (url, opts) => {
      if (url.endsWith('/session') && opts.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ value: { sessionId: 'sid' } }),
          text: async () => '',
        };
      }
      if (url.endsWith('/element')) {
        return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
      }
      return { ok: false, status: 404 };
    });
    const driver = await createIosDriver({ wdaTeamId: 'T', fetchImpl: fetchMock });
    expect(await driver.iosTapByTag('missing_tag')).toBe(false);
  });

  test('accepts legacy ELEMENT response shape (pre-W3C)', async () => {
    const fetchMock = jest.fn(async (url, opts) => {
      if (url.endsWith('/session') && opts.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ value: { sessionId: 'sid' } }),
          text: async () => '',
        };
      }
      if (url.endsWith('/element') && opts.method === 'POST') {
        // Older response shape — ELEMENT instead of W3C uuid key.
        return {
          ok: true,
          status: 200,
          json: async () => ({ value: { ELEMENT: 'el-legacy' } }),
          text: async () => '',
        };
      }
      if (url.endsWith('/element/el-legacy/click')) {
        return { ok: true, status: 200, text: async () => '' };
      }
      return { ok: false, status: 404 };
    });
    const driver = await createIosDriver({ wdaTeamId: 'T', fetchImpl: fetchMock });
    expect(await driver.iosTapByTag('legacy_tag')).toBe(true);
  });
});

describe('ios-appium-driver — iosPersonaSignIn', () => {
  test('rejects non-P-NN persona id', async () => {
    const driver = await createIosDriver({ wdaTeamId: 'T', fetchImpl: makeFetchMock() });
    await expect(driver.iosPersonaSignIn('Theo', 'rooms')).rejects.toThrow(
      /requires a P-NN persona id/,
    );
    await expect(driver.iosPersonaSignIn('Adam', 'rooms')).rejects.toThrow(
      /ephemeral personas P-01\/P-03 sign up via the prod flow/,
    );
  });
});

describe('ios-appium-driver — close', () => {
  test('DELETEs the session if one was created', async () => {
    const fetchMock = makeFetchMock({ sessionId: 'sid-close' });
    const driver = await createIosDriver({ wdaTeamId: 'T', fetchImpl: fetchMock });
    await driver.iosUiDump();
    await driver.close();
    const deleteCall = fetchMock.mock.calls.find(
      ([url, opts]) => url.endsWith('/session/sid-close') && opts.method === 'DELETE',
    );
    expect(deleteCall).toBeDefined();
  });

  test('no-op if no session was ever created (lazy bootstrap was never triggered)', async () => {
    const fetchMock = makeFetchMock();
    const driver = await createIosDriver({ wdaTeamId: 'T', fetchImpl: fetchMock });
    await driver.close();
    const deleteCalls = fetchMock.mock.calls.filter(([, opts]) => opts?.method === 'DELETE');
    expect(deleteCalls).toHaveLength(0);
  });
});

describe('ios-appium-driver — method registry', () => {
  test('listMethods returns deduped sorted method names', () => {
    const names = listMethods();
    expect(names).toEqual([...names].sort());
    expect(new Set(names).size).toBe(names.length);
  });

  test('IOS_METHOD_NAMES includes the core lifecycle methods', () => {
    expect(IOS_METHOD_NAMES).toEqual(
      expect.arrayContaining([
        'iosLaunchApp',
        'iosUiDump',
        'iosTap',
        'iosTapByTag',
        'iosPersonaSignIn',
      ]),
    );
  });

  test('every method-name in IOS_METHOD_NAMES is wired on the driver instance', async () => {
    const driver = await createIosDriver({ wdaTeamId: 'T', fetchImpl: makeFetchMock() });
    for (const methodName of IOS_METHOD_NAMES) {
      expect(typeof driver[methodName]).toBe('function');
    }
  });
});

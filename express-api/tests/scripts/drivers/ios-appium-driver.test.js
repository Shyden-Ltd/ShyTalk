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

// ── Real captured `xcrun xctrace list devices` output (2026-07-12) ──
// iPhone Air (iPhone18,4) / iOS 27, Xcode 27 CoreDevice toolchain. THIS is the source
// Appium's XCUITest `appium:udid` needs: the 8-16-hex HARDWARE UDID. Appium REJECTS the
// CoreDevice UUID that `xcrun devicectl list devices` prints — real 2026-07-11 journey
// failure: `Unknown device or simulator UDID: '74563FF8-D1FC-567D-A6C1-7C8C3CEFE0C6'`.
// Parser rules these fixtures prove:
//   • the Mac host has NO `(osver)` paren → excluded (never mistaken for a device)
//   • every Simulator shares the `(osver) (udid)` shape → the `== Simulators ==` section
//     must be split off, else a run with no real device returns a simulator UDID
//   • on iOS 26/27 a drivable wired iPhone routinely appears under `== Devices Offline ==`
//     in xctrace's legacy view → the offline section MUST be included (excluding it
//     returned null + failed the whole iOS matrix, 2026-07-02).
const HARDWARE_UDID = '00008150-000954D90A20401C';
const XCTRACE_IPHONE_OFFLINE_SECTION = [
  '== Devices ==',
  'Shyden’s MacBook (65EA33F3-7472-5CCD-AF6A-6DCEA99ACF50)',
  '',
  '== Devices Offline ==',
  `Sean’s iPhone (27.0) (${HARDWARE_UDID})`,
  '',
  '== Simulators ==',
  'iPhone 17 Pro Simulator (27.0) (BD7F2244-A299-4176-B76E-7D851B8F897A)',
  'iPhone Air Simulator (27.0) (22C6D10D-E5B8-4CA4-9D85-7CC85DB45DF8)',
].join('\n');
const XCTRACE_IPHONE_ONLINE_SECTION = [
  '== Devices ==',
  'Shyden’s MacBook (65EA33F3-7472-5CCD-AF6A-6DCEA99ACF50)',
  `Sean’s iPhone (27.0) (${HARDWARE_UDID})`,
  '',
  '== Simulators ==',
  'iPhone Air Simulator (27.0) (22C6D10D-E5B8-4CA4-9D85-7CC85DB45DF8)',
].join('\n');
const XCTRACE_NO_REAL_DEVICE = [
  '== Devices ==',
  'Shyden’s MacBook (65EA33F3-7472-5CCD-AF6A-6DCEA99ACF50)',
  '',
  '== Simulators ==',
  'iPhone Air Simulator (27.0) (22C6D10D-E5B8-4CA4-9D85-7CC85DB45DF8)',
  'iPhone 17 Pro Simulator (27.0) (BD7F2244-A299-4176-B76E-7D851B8F897A)',
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
  // Default device query resolves to the real iPhone's HARDWARE UDID via xctrace.
  execFileSync.mockReturnValue(XCTRACE_IPHONE_OFFLINE_SECTION);
});

// SHY-0095 increment 1 — selectUdid must return the HARDWARE UDID that Appium accepts,
// derived from `xctrace`. (The former devicectl-based block that pinned the CoreDevice
// UUID Appium rejects at runtime has been removed — it was a false test encoding the
// bug; the `does NOT return the CoreDevice UUID` case below is its regression guard.)
describe('ios-appium-driver — selectUdid (xctrace HARDWARE UDID — SHY-0095)', () => {
  test('returns the hardware UDID for a device in the online "== Devices ==" section', () => {
    execFileSync.mockReturnValue(XCTRACE_IPHONE_ONLINE_SECTION);
    expect(selectUdid()).toBe(HARDWARE_UDID);
  });

  test('returns the hardware UDID when the device is under "== Devices Offline ==" (iOS 26/27 legacy view)', () => {
    execFileSync.mockReturnValue(XCTRACE_IPHONE_OFFLINE_SECTION);
    expect(selectUdid()).toBe(HARDWARE_UDID);
  });

  test('excludes the Mac host line (no OS-version paren) — never returns the Mac UUID', () => {
    execFileSync.mockReturnValue(XCTRACE_NO_REAL_DEVICE);
    // Mac present + simulators only, no real iPhone → null, NEVER the Mac's 65EA… UUID.
    expect(selectUdid()).toBeNull();
  });

  test('never returns a Simulator UDID when no real device is connected', () => {
    execFileSync.mockReturnValue(XCTRACE_NO_REAL_DEVICE);
    const result = selectUdid();
    // A simulator shares the `(osver) (udid)` shape; the parser must have split the
    // `== Simulators ==` section off, so a no-real-device run is null, not a sim UDID.
    expect(result).not.toBe('22C6D10D-E5B8-4CA4-9D85-7CC85DB45DF8');
    expect(result).toBeNull();
  });

  test('invokes `xcrun xctrace list devices` (NOT devicectl, whose Identifier Appium rejects)', () => {
    execFileSync.mockReturnValue(XCTRACE_IPHONE_OFFLINE_SECTION);
    selectUdid();
    expect(execFileSync).toHaveBeenCalledWith(
      '/usr/bin/xcrun',
      ['xctrace', 'list', 'devices'],
      // Pin the bounded timeout too — a bare stdio-only assert would pass even if the
      // timeout were dropped (R2 gap).
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }),
    );
  });

  test('still honours an explicitly-supplied preferred udid (no device query)', () => {
    expect(selectUdid('00008150-EXPLICIT')).toBe('00008150-EXPLICIT');
    expect(execFileSync).not.toHaveBeenCalled();
  });

  test('returns null AND logs a diagnostic (never silent) when xctrace throws', () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    execFileSync.mockImplementation(() => {
      throw new Error('xcrun: not found');
    });
    expect(selectUdid()).toBeNull();
    // Distinguishes "xctrace errored" from "no device" — the observability gap R1 flagged.
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringMatching(/selectUdid: .*xctrace list devices.* failed: xcrun: not found/),
    );
    errSpy.mockRestore();
  });

  // Regression guard for the reverted-to-devicectl bug: fed devicectl's table (whose
  // Identifier column is the CoreDevice UUID Appium rejects), selectUdid must NOT return
  // that UUID. Goes RED if selectUdid is switched back to `devicectl list devices`.
  test('does NOT return the CoreDevice UUID (devicectl output must never yield a match)', () => {
    execFileSync.mockReturnValue(STUB_DEVICECTL_OUTPUT);
    const result = selectUdid();
    expect(result).not.toBe(STUB_UDID); // 74563FF8-… — the rejected CoreDevice UUID
    expect(result).toBeNull();
  });

  // ── Edge cases closed after R1 review (each verified against the live regex) ──

  test('a device name with an embedded decoy `(N) (hex)` pair still returns the REAL trailing UDID', () => {
    // The `$`-anchored device-line regex resolves to the LAST pair on the line, so a
    // name carrying version-like text can never shadow the real hardware UDID.
    execFileSync.mockReturnValue(
      `== Devices ==\nWeird Name (1.0) (DEADBE) Phone (27.0) (${HARDWARE_UDID})`,
    );
    expect(selectUdid()).toBe(HARDWARE_UDID);
  });

  test('with two real devices listed, returns the FIRST in xctrace order', () => {
    execFileSync.mockReturnValue(
      [
        '== Devices ==',
        'Phone A (27.0) (00008150-AAAAAAAAAAAAAAAA)',
        'Phone B (27.0) (00008150-BBBBBBBBBBBBBBBB)',
      ].join('\n'),
    );
    expect(selectUdid()).toBe('00008150-AAAAAAAAAAAAAAAA');
  });

  test('tolerates trailing whitespace after the closing UDID paren', () => {
    execFileSync.mockReturnValue(`== Devices ==\nSean’s iPhone (27.0) (${HARDWARE_UDID})   `);
    expect(selectUdid()).toBe(HARDWARE_UDID);
  });

  test('a whitespace-only preferred udid is ignored → falls through to auto-detect', () => {
    execFileSync.mockReturnValue(XCTRACE_IPHONE_OFFLINE_SECTION);
    expect(selectUdid('   ')).toBe(HARDWARE_UDID);
    expect(execFileSync).toHaveBeenCalled(); // did NOT short-circuit on the blank value
  });

  test('an empty-string preferred udid is ignored → falls through to auto-detect', () => {
    execFileSync.mockReturnValue(XCTRACE_IPHONE_OFFLINE_SECTION);
    expect(selectUdid('')).toBe(HARDWARE_UDID);
    expect(execFileSync).toHaveBeenCalled();
  });

  test('a padded preferred udid is returned trimmed (never handed to Appium with spaces)', () => {
    expect(selectUdid('  00008150-000954D90A20401C  ')).toBe(HARDWARE_UDID);
    expect(execFileSync).not.toHaveBeenCalled();
  });
});

describe('ios-appium-driver — createIosDriver', () => {
  test('throws actionable error (naming xctrace) + DRIVER_INIT_FAILED code when no device', async () => {
    execFileSync.mockReturnValue('Name   State   Model\n');
    const err = await createIosDriver({ wdaTeamId: 'TEAM123', fetchImpl: makeFetchMock() }).catch(
      (e) => e,
    );
    expect(err.message).toMatch(/no physical iPhone found via `xcrun xctrace list devices`/);
    // The code is what matrix-dispatch's isInitError uses to SKIP (not FAIL) the cell —
    // pinned here so a message reword can never again silently break that classification.
    expect(err.code).toBe('DRIVER_INIT_FAILED');
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
    expect(driver._udid).toBe(HARDWARE_UDID);
  });

  test('target="local" → bundleId com.shyden.shytalk (iOS uses ONE bundle id across configs)', async () => {
    const driver = await createIosDriver({
      wdaTeamId: 'TEAM123',
      fetchImpl: makeFetchMock(),
      target: 'local',
    });
    // iOS has a single PRODUCT_BUNDLE_IDENTIFIER for every config (Debug / Debug-Dev /
    // Debug-Local / Release) — the build config, via AppEnvironment, selects the backend,
    // NOT a suffixed bundle id (unlike Android's per-flavor ids). Confirmed in pbxproj.
    expect(driver._bundleId).toBe('com.shyden.shytalk');
  });

  test('target="dev" → bundleId com.shyden.shytalk (single iOS bundle id)', async () => {
    const driver = await createIosDriver({
      wdaTeamId: 'TEAM123',
      fetchImpl: makeFetchMock(),
      target: 'dev',
    });
    expect(driver._bundleId).toBe('com.shyden.shytalk');
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
      'appium:udid': HARDWARE_UDID,
      'appium:bundleId': 'com.shyden.shytalk',
      'appium:xcodeOrgId': 'TEAM-MY-TEAM',
      // The real signing cert is "Apple Development" (modern name); "Apple Developer"
      // matches no cert and fails the WDA rebuild (real 2026-07-12 code-65 failure).
      'appium:xcodeSigningId': 'Apple Development',
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

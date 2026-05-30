/**
 * ios-driver-loader.test.js — routing-decision unit tests
 *
 * The loader is the single place that decides which iOS driver
 * implementation (appium vs devicectl) the runner uses for a given
 * `--driver` flag + env state. Tests cover:
 *   - shouldLoadIos: the 4 accepted flag values + every "skip" value.
 *   - pickIosMode: each flag × env permutation.
 *   - loadIosUiDriver: full integration — appium path, devicectl path,
 *     all-fallback warning, all-with-env appium path, factory absence
 *     error, target/cfg forwarding, target unset, and the no-iOS skip.
 *
 * Factories are injected as plain async fns — no jest.mock plumbing
 * required, so the tests are fast and survive Jest module-cache quirks.
 */

const path = require('path');
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const { APPIUM_FALLBACK_WARNING, shouldLoadIos, pickIosMode, loadIosUiDriver } = require(
  path.join(REPO_ROOT, 'express-api/scripts/drivers/ios-driver-loader'),
);

describe('ios-driver-loader — shouldLoadIos', () => {
  test.each(['devicectl', 'simctl', 'appium', 'all'])('returns true for --driver %s', (driver) => {
    expect(shouldLoadIos(driver)).toBe(true);
  });

  test.each(['android', 'adb', 'web', 'playwright', 'mcp', '', null, undefined])(
    'returns false for --driver %p',
    (driver) => {
      expect(shouldLoadIos(driver)).toBe(false);
    },
  );
});

describe('ios-driver-loader — pickIosMode', () => {
  test('appium when driver=appium (regardless of WDA_TEAM_ID)', () => {
    expect(pickIosMode('appium', {})).toBe('appium');
    expect(pickIosMode('appium', { WDA_TEAM_ID: 'ABCD123456' })).toBe('appium');
  });

  test('devicectl when driver=devicectl (env ignored)', () => {
    expect(pickIosMode('devicectl', {})).toBe('devicectl');
    expect(pickIosMode('devicectl', { WDA_TEAM_ID: 'ABCD123456' })).toBe('devicectl');
  });

  test('devicectl when driver=simctl (legacy alias, env ignored)', () => {
    expect(pickIosMode('simctl', {})).toBe('devicectl');
    expect(pickIosMode('simctl', { WDA_TEAM_ID: 'ABCD123456' })).toBe('devicectl');
  });

  test('all + WDA_TEAM_ID set → appium', () => {
    expect(pickIosMode('all', { WDA_TEAM_ID: 'ABCD123456' })).toBe('appium');
  });

  test('all + WDA_TEAM_ID missing → devicectl', () => {
    expect(pickIosMode('all', {})).toBe('devicectl');
  });

  test('all + WDA_TEAM_ID empty string → devicectl (falsy guard)', () => {
    // Falsy values must not count as "set" — accidental `export WDA_TEAM_ID=`
    // in a rc file shouldn't promote the runner to appium mode.
    expect(pickIosMode('all', { WDA_TEAM_ID: '' })).toBe('devicectl');
  });

  test('all + env undefined → devicectl (no NPE)', () => {
    expect(pickIosMode('all', undefined)).toBe('devicectl');
  });
});

describe('ios-driver-loader — loadIosUiDriver', () => {
  test('returns null for non-iOS drivers (skip path)', async () => {
    const r = await loadIosUiDriver({
      driver: 'android',
      target: 'local',
      env: { WDA_TEAM_ID: 'ABCD123456' },
      createAppiumDriver: jest.fn(),
      createDevicectlDriver: jest.fn(),
    });
    expect(r).toBeNull();
  });

  test('appium mode invokes createAppiumDriver with target, returns mode=appium', async () => {
    const fakeIosDriver = { iosLaunchApp: jest.fn(), close: jest.fn() };
    const createAppiumDriver = jest.fn(async () => fakeIosDriver);
    const createDevicectlDriver = jest.fn();
    const r = await loadIosUiDriver({
      driver: 'appium',
      target: 'dev',
      env: { WDA_TEAM_ID: 'ABCD123456' },
      createAppiumDriver,
      createDevicectlDriver,
    });
    expect(r).toEqual({ iosDriver: fakeIosDriver, mode: 'appium' });
    expect(createAppiumDriver).toHaveBeenCalledWith({ target: 'dev' });
    expect(createDevicectlDriver).not.toHaveBeenCalled();
  });

  test('appium mode forwards undefined target without crashing', async () => {
    const createAppiumDriver = jest.fn(async () => ({ close: jest.fn() }));
    await loadIosUiDriver({
      driver: 'appium',
      target: undefined,
      env: {},
      createAppiumDriver,
      createDevicectlDriver: jest.fn(),
    });
    expect(createAppiumDriver).toHaveBeenCalledWith({ target: undefined });
  });

  test('devicectl mode invokes createDevicectlDriver with empty cfg, returns mode=devicectl', async () => {
    const fakeIosDriver = { iosLaunchApp: jest.fn(), close: jest.fn() };
    const createDevicectlDriver = jest.fn(async () => fakeIosDriver);
    const createAppiumDriver = jest.fn();
    const r = await loadIosUiDriver({
      driver: 'devicectl',
      target: 'local',
      env: {},
      createAppiumDriver,
      createDevicectlDriver,
    });
    expect(r).toEqual({ iosDriver: fakeIosDriver, mode: 'devicectl' });
    expect(createDevicectlDriver).toHaveBeenCalledWith({});
    expect(createAppiumDriver).not.toHaveBeenCalled();
  });

  test('simctl alias → devicectl path', async () => {
    const fakeIosDriver = { close: jest.fn() };
    const createDevicectlDriver = jest.fn(async () => fakeIosDriver);
    const r = await loadIosUiDriver({
      driver: 'simctl',
      target: 'local',
      env: {},
      createAppiumDriver: jest.fn(),
      createDevicectlDriver,
    });
    expect(r.mode).toBe('devicectl');
    expect(createDevicectlDriver).toHaveBeenCalledTimes(1);
  });

  test('all + WDA_TEAM_ID set → appium path, no warn', async () => {
    const createAppiumDriver = jest.fn(async () => ({ close: jest.fn() }));
    const warn = jest.fn();
    const r = await loadIosUiDriver({
      driver: 'all',
      target: 'local',
      env: { WDA_TEAM_ID: 'ABCD123456' },
      warn,
      createAppiumDriver,
      createDevicectlDriver: jest.fn(),
    });
    expect(r.mode).toBe('appium');
    expect(warn).not.toHaveBeenCalled();
  });

  test('all + WDA_TEAM_ID missing → devicectl + emits the fallback warning', async () => {
    const createDevicectlDriver = jest.fn(async () => ({ close: jest.fn() }));
    const warn = jest.fn();
    const r = await loadIosUiDriver({
      driver: 'all',
      target: 'local',
      env: {},
      warn,
      createAppiumDriver: jest.fn(),
      createDevicectlDriver,
    });
    expect(r.mode).toBe('devicectl');
    expect(warn).toHaveBeenCalledWith(APPIUM_FALLBACK_WARNING);
  });

  test('--driver devicectl does NOT emit the all-fallback warning (only --driver all does)', async () => {
    // Operator opted into devicectl explicitly — no warning. Only the
    // implicit --driver all fallback to devicectl should warn, because
    // that's the case where the operator expected appium and silently
    // didn't get it.
    const warn = jest.fn();
    await loadIosUiDriver({
      driver: 'devicectl',
      target: 'local',
      env: {},
      warn,
      createAppiumDriver: jest.fn(),
      createDevicectlDriver: jest.fn(async () => ({ close: jest.fn() })),
    });
    expect(warn).not.toHaveBeenCalled();
  });

  test('appium mode without createAppiumDriver throws actionable error', async () => {
    await expect(
      loadIosUiDriver({
        driver: 'appium',
        target: 'local',
        env: { WDA_TEAM_ID: 'ABCD123456' },
        createAppiumDriver: undefined,
        createDevicectlDriver: jest.fn(),
      }),
    ).rejects.toThrow(/createAppiumDriver factory is required/);
  });

  test('devicectl mode without createDevicectlDriver throws actionable error', async () => {
    await expect(
      loadIosUiDriver({
        driver: 'devicectl',
        target: 'local',
        env: {},
        createAppiumDriver: jest.fn(),
        createDevicectlDriver: undefined,
      }),
    ).rejects.toThrow(/createDevicectlDriver factory is required/);
  });

  test('factory rejection propagates (runner can catch + log)', async () => {
    const createAppiumDriver = jest.fn(async () => {
      throw new Error('Appium server not reachable on http://localhost:4723');
    });
    await expect(
      loadIosUiDriver({
        driver: 'appium',
        target: 'local',
        env: { WDA_TEAM_ID: 'ABCD123456' },
        createAppiumDriver,
        createDevicectlDriver: jest.fn(),
      }),
    ).rejects.toThrow(/Appium server not reachable/);
  });

  test('defaults: env defaults to process.env, warn defaults to console.error', async () => {
    // Smoke-test the defaults: when env+warn aren't passed, the loader
    // reads from process.env and writes to console.error. We verify by
    // setting process.env.WDA_TEAM_ID and observing the routing.
    const prev = process.env.WDA_TEAM_ID;
    process.env.WDA_TEAM_ID = 'TEAMID12345';
    try {
      const createAppiumDriver = jest.fn(async () => ({ close: jest.fn() }));
      const r = await loadIosUiDriver({
        driver: 'all',
        target: 'local',
        createAppiumDriver,
        createDevicectlDriver: jest.fn(),
      });
      expect(r.mode).toBe('appium');
    } finally {
      if (prev === undefined) delete process.env.WDA_TEAM_ID;
      else process.env.WDA_TEAM_ID = prev;
    }
  });

  test('default warn writes to process.stderr (verified via spy)', async () => {
    // Pair test for the previous one — when env lacks WDA_TEAM_ID and
    // warn is omitted, the loader should write the fallback warning to
    // process.stderr (not console.error; see ios-driver-loader.js
    // docstring for why).
    const prev = process.env.WDA_TEAM_ID;
    delete process.env.WDA_TEAM_ID;
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await loadIosUiDriver({
        driver: 'all',
        target: 'local',
        createAppiumDriver: jest.fn(),
        createDevicectlDriver: jest.fn(async () => ({ close: jest.fn() })),
      });
      // Newline-terminated for canonical stderr line semantics.
      expect(spy).toHaveBeenCalledWith(`${APPIUM_FALLBACK_WARNING}\n`);
    } finally {
      spy.mockRestore();
      if (prev !== undefined) process.env.WDA_TEAM_ID = prev;
    }
  });

  test('called with no args → returns null (no crash on partial use)', async () => {
    const r = await loadIosUiDriver();
    expect(r).toBeNull();
  });
});

describe('ios-driver-loader — APPIUM_FALLBACK_WARNING shape', () => {
  test('mentions both WDA_TEAM_ID and Appium so operator can self-diagnose', () => {
    // The warning is the operator's only signal that they're silently
    // running with stubbed UI. It must name the two things to fix.
    expect(APPIUM_FALLBACK_WARNING).toMatch(/WDA_TEAM_ID/);
    expect(APPIUM_FALLBACK_WARNING).toMatch(/Appium/i);
  });

  test('includes [runner] prefix so logs are grep-able', () => {
    expect(APPIUM_FALLBACK_WARNING).toMatch(/^\[runner\]/);
  });
});

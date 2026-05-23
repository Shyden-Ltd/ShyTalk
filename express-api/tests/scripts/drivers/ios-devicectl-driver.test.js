jest.mock('child_process');
const { execSync } = require('child_process');

const {
  createIosDriver,
  listMethods,
  selectUdid,
  IOS_METHOD_NAMES,
} = require('../../../scripts/drivers/ios-devicectl-driver');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ios-devicectl-driver — selectUdid', () => {
  test('honours preferred UDID without invoking devicectl', () => {
    const result = selectUdid('00008110-001A2B3C4D5E6F70');
    expect(result).toBe('00008110-001A2B3C4D5E6F70');
    expect(execSync).not.toHaveBeenCalled();
  });

  test('extracts UDID — legacy 8-16 format with "connected" state', () => {
    execSync.mockReturnValueOnce(
      'Name           Hostname     Identifier                          State      Model\n' +
        'iPhone (Yuki)  iPhone.local 00008110-001A2B3C4D5E6F70           connected  iPhone16,2\n',
    );
    expect(selectUdid()).toBe('00008110-001A2B3C4D5E6F70');
  });

  test('extracts UDID — RFC-4122 8-4-4-4-12 UUID with "available (paired)" state (Xcode 15+)', () => {
    // This is the REAL devicectl output on macOS 14 / Xcode 15+ —
    // verified empirically against `xcrun devicectl list devices`
    // on a paired iPhone. PR #787 R0 reviewer flagged this format
    // gap; this test pins the production case.
    execSync.mockReturnValueOnce(
      'Name            Hostname                        Identifier                             State                Model\n' +
        '-------------   -----------------------------   ------------------------------------   ------------------   ----\n' +
        "Sean's iPhone   Seans-iPhone.coredevice.local   74563FF8-D1FC-567D-A6C1-7C8C3CEFE0C6   available (paired)   iPhone Air (iPhone18,4)\n",
    );
    expect(selectUdid()).toBe('74563FF8-D1FC-567D-A6C1-7C8C3CEFE0C6');
  });

  test('extracts UDID — RFC-4122 with "available (connected)" parenthetical', () => {
    execSync.mockReturnValueOnce(
      'Name   Hostname   Identifier                             State                  Model\n' +
        'Phone  Phone.local 11111111-2222-3333-4444-555555555555  available (connected)  iPhone16,1\n',
    );
    expect(selectUdid()).toBe('11111111-2222-3333-4444-555555555555');
  });

  test('extracts UDID — picks FIRST device when multiple are listed', () => {
    execSync.mockReturnValueOnce(
      'Name    Hostname     Identifier                             State                Model\n' +
        'iPhoneA host1.local 11111111-1111-1111-1111-111111111111  available (paired)   iPhone16,1\n' +
        'iPhoneB host2.local 22222222-2222-2222-2222-222222222222  available (paired)   iPhone16,2\n',
    );
    expect(selectUdid()).toBe('11111111-1111-1111-1111-111111111111');
  });

  test('returns null when devicectl shows no connected device', () => {
    execSync.mockReturnValueOnce('Name  Hostname  Identifier  State  Model\n' + '(no devices)\n');
    expect(selectUdid()).toBe(null);
  });

  test('returns null when devicectl throws', () => {
    execSync.mockImplementationOnce(() => {
      throw new Error('xcrun: command not found');
    });
    expect(selectUdid()).toBe(null);
  });

  test('returns null when devicectl emits headers only (empty device list)', () => {
    execSync.mockReturnValueOnce(
      'Name   Hostname   Identifier   State   Model\n' +
        '----   --------   ----------   -----   -----\n',
    );
    expect(selectUdid()).toBe(null);
  });
});

describe('ios-devicectl-driver — listMethods', () => {
  test('returns the IOS_METHOD_NAMES sorted + deduped', () => {
    const methods = listMethods();
    expect(methods).toEqual([...new Set(IOS_METHOD_NAMES)].sort());
  });

  test('every name starts with "ios"', () => {
    for (const name of listMethods()) {
      expect(name.startsWith('ios')).toBe(true);
    }
  });

  test('matches the simctl driver method-name surface (1:1 contract)', () => {
    const { listMethods: simctlList } = require('../../../scripts/drivers/ios-simctl-driver');
    expect(listMethods()).toEqual(simctlList());
  });
});

describe('ios-devicectl-driver — createIosDriver factory', () => {
  test('returns driver object when no device connected (does not throw)', async () => {
    execSync.mockImplementationOnce(() => {
      throw new Error('xcrun: command not found');
    });
    const driver = await createIosDriver({});
    expect(driver).toBeDefined();
    expect(driver._udid).toBe(null);
  });

  test('honours preferred UDID without listing devices', async () => {
    const driver = await createIosDriver({ udid: 'PREFERRED-UDID-123' });
    expect(driver._udid).toBe('PREFERRED-UDID-123');
    expect(execSync).not.toHaveBeenCalled();
  });

  test('uses first connected device when no UDID preferred', async () => {
    execSync.mockReturnValueOnce(
      'Name           Hostname     Identifier                          State      Model\n' +
        'iPhone (Yuki)  iPhone.local 00008110-001A2B3C4D5E6F70           connected  iPhone16,2\n',
    );
    const driver = await createIosDriver({});
    expect(driver._udid).toBe('00008110-001A2B3C4D5E6F70');
  });

  test('exposes a close() that resolves cleanly', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    await expect(driver.close()).resolves.toBeUndefined();
  });

  test('no-arg invocation works (factory default `{}`)', async () => {
    // The factory's `{ udid: preferred } = {}` default must accept
    // bare `createIosDriver()`. The runner calls `createIosDriver({})`
    // but the public API surface also supports no-arg.
    execSync.mockImplementationOnce(() => {
      throw new Error('xcrun: command not found');
    });
    const driver = await createIosDriver();
    expect(driver).toBeDefined();
    expect(driver._udid).toBe(null);
  });

  test('factory: devicectl succeeds but returns no devices → _udid = null', async () => {
    // The "no device matched" path through createIosDriver — distinct
    // from the throw path. Pin that the factory tolerates a clean
    // empty-device-list response.
    execSync.mockReturnValueOnce(
      'Name   Hostname   Identifier   State   Model\n' +
        '----   --------   ----------   -----   -----\n',
    );
    const driver = await createIosDriver({});
    expect(driver._udid).toBe(null);
  });
});

describe('ios-devicectl-driver — iosUiDump', () => {
  test('returns empty string in scaffold state (WDA not yet wired)', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    const dump = await driver.iosUiDump();
    expect(dump).toBe('');
  });
});

describe('ios-devicectl-driver — every IOS_METHOD_NAMES entry resolves to a function', () => {
  // This contract test guards against typos in the method-name array
  // (e.g. a name in IOS_METHOD_NAMES that doesn't get registered on
  // the driver instance) and pins that every stub returns false in
  // the scaffold state.
  test.each(listMethods())('driver.%s is a function returning false', async (methodName) => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(typeof driver[methodName]).toBe('function');
    // All stubs return false until subsequent PRs replace them with
    // foundation presence-check implementations.
    const result = await driver[methodName]('arg1', 'arg2', 'arg3');
    expect(result).toBe(false);
  });
});

describe('ios-devicectl-driver — stub call-arity tolerance', () => {
  // Stubs accept any number of args (0, 1, 2, 3, 4). Pin this so a
  // future refactor that adds arg-validation to the stub loop doesn't
  // accidentally break callers that pass varying arg counts.
  test('iosShowsUserCard accepts 0 args', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosShowsUserCard()).toBe(false);
  });

  test('iosShowsToastAndNavigates accepts 4 args', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosShowsToastAndNavigates('a', 'b', 'c', 100)).toBe(false);
  });

  test('iosShowsCountBadge accepts null/undefined args', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosShowsCountBadge(null, undefined, '')).toBe(false);
  });
});

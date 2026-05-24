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

describe('ios-devicectl-driver — iosAdminShowsAppealText', () => {
  // Wake 89 — `<Name>'s <Plat> Admin UI shows <Other>'s appeal with
  // the text` (j11:73). Same matcher as Android PR #762; iOS variant.
  //
  // Foundation strategy: presence-check on `adminAppeal_*` XCUITest
  // identifier PREFIX. No iOS admin surface exists today; returns
  // false in real journeys. Tests use injected mock iosUiDump.
  //
  // XCUITest dump format (when WDA lands):
  //   <XCUIElementTypeOther identifier="adminAppeal_appealText" name="..." />
  // The regex matches any XCUIElementType\w+ with identifier prefix.
  //
  // Both args (_viewer, _target) accepted-and-ignored.
  function driverWithDump(xml) {
    return createIosDriver({ udid: 'X' }).then((d) => {
      d.iosUiDump = async () => xml;
      return d;
    });
  }

  test('adminAppeal_appealText present → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminAppeal_appealText" />',
    );
    expect(await driver.iosAdminShowsAppealText('Mod', 'Selma')).toBe(true);
  });

  test('adminAppeal_panel present → true (any suffix matches prefix)', async () => {
    const driver = await driverWithDump('<XCUIElementTypeButton identifier="adminAppeal_panel" />');
    expect(await driver.iosAdminShowsAppealText('Mod', 'Selma')).toBe(true);
  });

  test('absent (no admin surface) → false', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosAdminShowsAppealText('Mod', 'Selma')).toBe(false);
  });

  test('empty dump → false (default scaffold state)', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    // Default iosUiDump returns '' — every presence-check returns false.
    expect(await driver.iosAdminShowsAppealText('Mod', 'Selma')).toBe(false);
  });

  test('non-self-closing tag form → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminAppeal_appealText"><XCUIElementTypeStaticText name="Text" /></XCUIElementTypeOther>',
    );
    expect(await driver.iosAdminShowsAppealText('Mod', 'Selma')).toBe(true);
  });

  test('left-boundary — pre_adminAppeal_X does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="pre_adminAppeal_appealText" />',
    );
    expect(await driver.iosAdminShowsAppealText('Mod', 'Selma')).toBe(false);
  });

  test('right-boundary — adminAppeal_appealTextExtra still matches (prefix contract)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminAppeal_appealTextExtra" />',
    );
    expect(await driver.iosAdminShowsAppealText('Mod', 'Selma')).toBe(true);
  });

  test('confusable prefix — admin_appeal does NOT match (no underscore-after-prefix)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="admin_appealSummary" />',
    );
    expect(await driver.iosAdminShowsAppealText('Mod', 'Selma')).toBe(false);
  });

  test('different-attribute (name= instead of identifier=) does NOT match', async () => {
    // Pin: the regex requires `identifier=`, not `name=`. Android's
    // resource-id sibling has a similar attribute-specificity guard.
    const driver = await driverWithDump('<XCUIElementTypeOther name="adminAppeal_appealText" />');
    expect(await driver.iosAdminShowsAppealText('Mod', 'Selma')).toBe(false);
  });

  test('iosUiDump throws → rejects (propagates; no try/catch in foundation)', async () => {
    // iOS foundation methods do NOT swallow iosUiDump errors — propagation
    // is the chosen contract. This differs from the Android sibling which
    // wraps androidUiDump in try/catch and returns false. Documented as a
    // driver-level decision: WDA / XCTest errors should surface to the
    // runner so journey authors can see real connectivity failures.
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('WDA: connection lost');
    };
    await expect(driver.iosAdminShowsAppealText('Mod', 'Selma')).rejects.toThrow();
  });

  test('viewer accepted-and-ignored — Bea passes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminAppeal_appealText" />',
    );
    expect(await driver.iosAdminShowsAppealText('Bea', 'Selma')).toBe(true);
  });

  test('null viewer → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminAppeal_appealText" />',
    );
    expect(await driver.iosAdminShowsAppealText(null, 'Selma')).toBe(true);
  });

  test('undefined viewer → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminAppeal_appealText" />',
    );
    expect(await driver.iosAdminShowsAppealText(undefined, 'Selma')).toBe(true);
  });

  test('empty viewer → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminAppeal_appealText" />',
    );
    expect(await driver.iosAdminShowsAppealText('', 'Selma')).toBe(true);
  });

  test('whitespace viewer → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminAppeal_appealText" />',
    );
    expect(await driver.iosAdminShowsAppealText('   ', 'Selma')).toBe(true);
  });

  test('null target → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminAppeal_appealText" />',
    );
    expect(await driver.iosAdminShowsAppealText('Mod', null)).toBe(true);
  });

  test('undefined target → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminAppeal_appealText" />',
    );
    expect(await driver.iosAdminShowsAppealText('Mod', undefined)).toBe(true);
  });

  test('empty target → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminAppeal_appealText" />',
    );
    expect(await driver.iosAdminShowsAppealText('Mod', '')).toBe(true);
  });

  test('whitespace target → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminAppeal_appealText" />',
    );
    expect(await driver.iosAdminShowsAppealText('Mod', '   ')).toBe(true);
  });

  test('different target still passes (foundation does not match specific user)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminAppeal_appealText" />',
    );
    expect(await driver.iosAdminShowsAppealText('Mod', 'Theo')).toBe(true);
  });

  test('first-match contract — two adminAppeal_* nodes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminAppeal_appealText" />' +
        '<XCUIElementTypeOther identifier="adminAppeal_panel" />',
    );
    expect(await driver.iosAdminShowsAppealText('Mod', 'Selma')).toBe(true);
  });
});

describe('ios-devicectl-driver — iosAdminShowsDashboardCounters', () => {
  // Wake 105 — `<Name>'s <Plat> Admin UI shows the dashboard with
  // counters: N reports, N verifications, N appeals` (j12). Mirrors
  // Android sibling #763's pattern.
  //
  // Foundation: presence-check on `adminDashboard_*` XCUITest
  // identifier PREFIX. Both args (_viewer, _counters) accepted-and-
  // ignored. The _counters object structure (reports/verifications/
  // appeals) is NOT validated — that needs per-counter testTags +
  // text-extraction.
  function driverWithDump(xml) {
    return createIosDriver({ udid: 'X' }).then((d) => {
      d.iosUiDump = async () => xml;
      return d;
    });
  }

  const sampleCounters = { reports: 5, verifications: 2, appeals: 1 };

  test('adminDashboard_reportsCounter present → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminDashboard_reportsCounter" />',
    );
    expect(await driver.iosAdminShowsDashboardCounters('Mod', sampleCounters)).toBe(true);
  });

  test('adminDashboard_verificationsCounter present → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminDashboard_verificationsCounter" />',
    );
    expect(await driver.iosAdminShowsDashboardCounters('Mod', sampleCounters)).toBe(true);
  });

  test('absent → false', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosAdminShowsDashboardCounters('Mod', sampleCounters)).toBe(false);
  });

  test('empty dump → false', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosAdminShowsDashboardCounters('Mod', sampleCounters)).toBe(false);
  });

  test('non-self-closing tag form → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminDashboard_reportsCounter"><XCUIElementTypeStaticText name="5" /></XCUIElementTypeOther>',
    );
    expect(await driver.iosAdminShowsDashboardCounters('Mod', sampleCounters)).toBe(true);
  });

  test('left-boundary — pre_adminDashboard_X does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="pre_adminDashboard_reportsCounter" />',
    );
    expect(await driver.iosAdminShowsDashboardCounters('Mod', sampleCounters)).toBe(false);
  });

  test('right-boundary — adminDashboard_reportsCounterExtra still matches', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminDashboard_reportsCounterExtra" />',
    );
    expect(await driver.iosAdminShowsDashboardCounters('Mod', sampleCounters)).toBe(true);
  });

  test('confusable prefix — admin_dashboardSummary does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="admin_dashboardSummary" />',
    );
    expect(await driver.iosAdminShowsDashboardCounters('Mod', sampleCounters)).toBe(false);
  });

  test('attribute-specificity — name= does NOT trigger', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther name="adminDashboard_reportsCounter" />',
    );
    expect(await driver.iosAdminShowsDashboardCounters('Mod', sampleCounters)).toBe(false);
  });

  test('iosUiDump throws → rejects', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('WDA lost');
    };
    await expect(driver.iosAdminShowsDashboardCounters('Mod', sampleCounters)).rejects.toThrow();
  });

  test('viewer accepted-and-ignored — Bea passes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminDashboard_reportsCounter" />',
    );
    expect(await driver.iosAdminShowsDashboardCounters('Bea', sampleCounters)).toBe(true);
  });

  test('null viewer → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminDashboard_reportsCounter" />',
    );
    expect(await driver.iosAdminShowsDashboardCounters(null, sampleCounters)).toBe(true);
  });

  test('undefined viewer → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminDashboard_reportsCounter" />',
    );
    expect(await driver.iosAdminShowsDashboardCounters(undefined, sampleCounters)).toBe(true);
  });

  test('empty viewer → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminDashboard_reportsCounter" />',
    );
    expect(await driver.iosAdminShowsDashboardCounters('', sampleCounters)).toBe(true);
  });

  test('whitespace viewer → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminDashboard_reportsCounter" />',
    );
    expect(await driver.iosAdminShowsDashboardCounters('   ', sampleCounters)).toBe(true);
  });

  test('null counters → true (accepted-and-ignored)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminDashboard_reportsCounter" />',
    );
    expect(await driver.iosAdminShowsDashboardCounters('Mod', null)).toBe(true);
  });

  test('undefined counters → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminDashboard_reportsCounter" />',
    );
    expect(await driver.iosAdminShowsDashboardCounters('Mod', undefined)).toBe(true);
  });

  test('empty object counters → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminDashboard_reportsCounter" />',
    );
    expect(await driver.iosAdminShowsDashboardCounters('Mod', {})).toBe(true);
  });

  test('partial counters → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminDashboard_reportsCounter" />',
    );
    expect(await driver.iosAdminShowsDashboardCounters('Mod', { reports: 5, appeals: 1 })).toBe(
      true,
    );
  });

  test('large counters → true (foundation does not validate values)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminDashboard_reportsCounter" />',
    );
    expect(
      await driver.iosAdminShowsDashboardCounters('Mod', {
        reports: 9999999,
        verifications: 0,
        appeals: -1,
      }),
    ).toBe(true);
  });

  test('first-match contract — two adminDashboard_* nodes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminDashboard_reportsCounter" />' +
        '<XCUIElementTypeOther identifier="adminDashboard_appealsCounter" />',
    );
    expect(await driver.iosAdminShowsDashboardCounters('Mod', sampleCounters)).toBe(true);
  });
});

describe('ios-devicectl-driver — iosAdminShowsStat', () => {
  // Wake 106 — `<Name>'s <Plat> Admin UI shows the "<X>" stat` (j12).
  // Mirrors Android PR #764. Foundation: presence-check on
  // `adminStat_*` XCUITest identifier PREFIX.
  function driverWithDump(xml) {
    return createIosDriver({ udid: 'X' }).then((d) => {
      d.iosUiDump = async () => xml;
      return d;
    });
  }

  test('adminStat_dailyActiveUsers present → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminStat_dailyActiveUsers" />',
    );
    expect(await driver.iosAdminShowsStat('Mod', 'Daily Active Users')).toBe(true);
  });

  test('adminStat_reportsResolved present → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminStat_reportsResolved" />',
    );
    expect(await driver.iosAdminShowsStat('Mod', 'Reports Resolved Today')).toBe(true);
  });

  test('absent → false', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosAdminShowsStat('Mod', 'X')).toBe(false);
  });

  test('empty dump → false', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosAdminShowsStat('Mod', 'X')).toBe(false);
  });

  test('non-self-closing tag form → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminStat_dailyActiveUsers"><XCUIElementTypeStaticText name="1234" /></XCUIElementTypeOther>',
    );
    expect(await driver.iosAdminShowsStat('Mod', 'X')).toBe(true);
  });

  test('left-boundary — pre_adminStat_X does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="pre_adminStat_dailyActiveUsers" />',
    );
    expect(await driver.iosAdminShowsStat('Mod', 'X')).toBe(false);
  });

  test('right-boundary — adminStat_dailyActiveUsersExtra still matches', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminStat_dailyActiveUsersExtra" />',
    );
    expect(await driver.iosAdminShowsStat('Mod', 'X')).toBe(true);
  });

  test('confusable prefix — admin_statSummary does NOT match', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="admin_statSummary" />');
    expect(await driver.iosAdminShowsStat('Mod', 'X')).toBe(false);
  });

  test('attribute-specificity — name= does NOT trigger', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther name="adminStat_dailyActiveUsers" />',
    );
    expect(await driver.iosAdminShowsStat('Mod', 'X')).toBe(false);
  });

  test('iosUiDump throws → rejects', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('WDA lost');
    };
    await expect(driver.iosAdminShowsStat('Mod', 'X')).rejects.toThrow();
  });

  test('viewer accepted-and-ignored — Bea passes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminStat_dailyActiveUsers" />',
    );
    expect(await driver.iosAdminShowsStat('Bea', 'X')).toBe(true);
  });

  test('null viewer → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminStat_dailyActiveUsers" />',
    );
    expect(await driver.iosAdminShowsStat(null, 'X')).toBe(true);
  });

  test('undefined viewer → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminStat_dailyActiveUsers" />',
    );
    expect(await driver.iosAdminShowsStat(undefined, 'X')).toBe(true);
  });

  test('empty viewer → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminStat_dailyActiveUsers" />',
    );
    expect(await driver.iosAdminShowsStat('', 'X')).toBe(true);
  });

  test('whitespace viewer → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminStat_dailyActiveUsers" />',
    );
    expect(await driver.iosAdminShowsStat('   ', 'X')).toBe(true);
  });

  test('null statName → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminStat_dailyActiveUsers" />',
    );
    expect(await driver.iosAdminShowsStat('Mod', null)).toBe(true);
  });

  test('undefined statName → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminStat_dailyActiveUsers" />',
    );
    expect(await driver.iosAdminShowsStat('Mod', undefined)).toBe(true);
  });

  test('empty statName → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminStat_dailyActiveUsers" />',
    );
    expect(await driver.iosAdminShowsStat('Mod', '')).toBe(true);
  });

  test('whitespace statName → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminStat_dailyActiveUsers" />',
    );
    expect(await driver.iosAdminShowsStat('Mod', '   ')).toBe(true);
  });

  test('different statName still passes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminStat_dailyActiveUsers" />',
    );
    expect(await driver.iosAdminShowsStat('Mod', 'Some Other Stat')).toBe(true);
  });

  test('first-match contract — two adminStat_* nodes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="adminStat_dailyActiveUsers" />' +
        '<XCUIElementTypeOther identifier="adminStat_reportsResolved" />',
    );
    expect(await driver.iosAdminShowsStat('Mod', 'X')).toBe(true);
  });
});

describe('ios-devicectl-driver — iosAlsoShowsInParticipantsList', () => {
  // Wake 103 — `<Name>'s <Plat> UI also shows <Other> in the
  // participants list` (j09). Mirrors Android PR #765.
  function driverWithDump(xml) {
    return createIosDriver({ udid: 'X' }).then((d) => {
      d.iosUiDump = async () => xml;
      return d;
    });
  }

  test('participantsList_userTile present → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="participantsList_userTile" />',
    );
    expect(await driver.iosAlsoShowsInParticipantsList('Alice', 'Bao')).toBe(true);
  });

  test('participantsList_container present → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="participantsList_container" />',
    );
    expect(await driver.iosAlsoShowsInParticipantsList('Alice', 'Bao')).toBe(true);
  });

  test('absent → false', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosAlsoShowsInParticipantsList('Alice', 'Bao')).toBe(false);
  });

  test('empty dump → false', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosAlsoShowsInParticipantsList('Alice', 'Bao')).toBe(false);
  });

  test('non-self-closing tag form → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="participantsList_userTile"><XCUIElementTypeStaticText name="Bao" /></XCUIElementTypeOther>',
    );
    expect(await driver.iosAlsoShowsInParticipantsList('Alice', 'Bao')).toBe(true);
  });

  test('left-boundary — pre_participantsList_X does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="pre_participantsList_userTile" />',
    );
    expect(await driver.iosAlsoShowsInParticipantsList('Alice', 'Bao')).toBe(false);
  });

  test('right-boundary — participantsList_userTileExtra still matches', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="participantsList_userTileExtra" />',
    );
    expect(await driver.iosAlsoShowsInParticipantsList('Alice', 'Bao')).toBe(true);
  });

  test('confusable prefix — participants_listItem does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="participants_listItem" />',
    );
    expect(await driver.iosAlsoShowsInParticipantsList('Alice', 'Bao')).toBe(false);
  });

  test('attribute-specificity — name= does NOT trigger', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther name="participantsList_userTile" />',
    );
    expect(await driver.iosAlsoShowsInParticipantsList('Alice', 'Bao')).toBe(false);
  });

  test('iosUiDump throws → rejects', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('WDA lost');
    };
    await expect(driver.iosAlsoShowsInParticipantsList('Alice', 'Bao')).rejects.toThrow();
  });

  test('viewer accepted-and-ignored — Ines passes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="participantsList_userTile" />',
    );
    expect(await driver.iosAlsoShowsInParticipantsList('Ines', 'Bao')).toBe(true);
  });

  test('null viewer → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="participantsList_userTile" />',
    );
    expect(await driver.iosAlsoShowsInParticipantsList(null, 'Bao')).toBe(true);
  });

  test('undefined viewer → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="participantsList_userTile" />',
    );
    expect(await driver.iosAlsoShowsInParticipantsList(undefined, 'Bao')).toBe(true);
  });

  test('empty viewer → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="participantsList_userTile" />',
    );
    expect(await driver.iosAlsoShowsInParticipantsList('', 'Bao')).toBe(true);
  });

  test('whitespace viewer → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="participantsList_userTile" />',
    );
    expect(await driver.iosAlsoShowsInParticipantsList('   ', 'Bao')).toBe(true);
  });

  test('null other → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="participantsList_userTile" />',
    );
    expect(await driver.iosAlsoShowsInParticipantsList('Alice', null)).toBe(true);
  });

  test('undefined other → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="participantsList_userTile" />',
    );
    expect(await driver.iosAlsoShowsInParticipantsList('Alice', undefined)).toBe(true);
  });

  test('empty other → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="participantsList_userTile" />',
    );
    expect(await driver.iosAlsoShowsInParticipantsList('Alice', '')).toBe(true);
  });

  test('whitespace other → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="participantsList_userTile" />',
    );
    expect(await driver.iosAlsoShowsInParticipantsList('Alice', '   ')).toBe(true);
  });

  test('different other still passes (foundation does not match specific user)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="participantsList_userTile" />',
    );
    expect(await driver.iosAlsoShowsInParticipantsList('Alice', 'NotInList')).toBe(true);
  });

  test('first-match contract — two participantsList_* nodes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="participantsList_userTile" />' +
        '<XCUIElementTypeOther identifier="participantsList_container" />',
    );
    expect(await driver.iosAlsoShowsInParticipantsList('Alice', 'Bao')).toBe(true);
  });
});

describe('ios-devicectl-driver — iosApproveSeatRequest', () => {
  // Wake 86 — `<Name> on <Plat> approves <Other>'s seat request`
  // (j17:51). Mirrors Android PR #766.
  function driverWithDump(xml) {
    return createIosDriver({ udid: 'X' }).then((d) => {
      d.iosUiDump = async () => xml;
      return d;
    });
  }

  test('seatRequest_approveButton present → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="seatRequest_approveButton" />',
    );
    expect(await driver.iosApproveSeatRequest('Alice', 'Bao')).toBe(true);
  });

  test('seatRequest_pendingPanel present → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="seatRequest_pendingPanel" />',
    );
    expect(await driver.iosApproveSeatRequest('Alice', 'Bao')).toBe(true);
  });

  test('absent → false', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosApproveSeatRequest('Alice', 'Bao')).toBe(false);
  });

  test('empty dump → false', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosApproveSeatRequest('Alice', 'Bao')).toBe(false);
  });

  test('non-self-closing tag form → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="seatRequest_approveButton"><XCUIElementTypeStaticText name="Approve" /></XCUIElementTypeButton>',
    );
    expect(await driver.iosApproveSeatRequest('Alice', 'Bao')).toBe(true);
  });

  test('left-boundary — pre_seatRequest_X does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="pre_seatRequest_approveButton" />',
    );
    expect(await driver.iosApproveSeatRequest('Alice', 'Bao')).toBe(false);
  });

  test('right-boundary — seatRequest_approveButtonExtra still matches', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="seatRequest_approveButtonExtra" />',
    );
    expect(await driver.iosApproveSeatRequest('Alice', 'Bao')).toBe(true);
  });

  test('confusable prefix — seat_requestApprove does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="seat_requestApprove" />',
    );
    expect(await driver.iosApproveSeatRequest('Alice', 'Bao')).toBe(false);
  });

  test('attribute-specificity — name= does NOT trigger', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther name="seatRequest_approveButton" />',
    );
    expect(await driver.iosApproveSeatRequest('Alice', 'Bao')).toBe(false);
  });

  test('iosUiDump throws → rejects', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('WDA lost');
    };
    await expect(driver.iosApproveSeatRequest('Alice', 'Bao')).rejects.toThrow();
  });

  test('host accepted-and-ignored — Ines passes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="seatRequest_approveButton" />',
    );
    expect(await driver.iosApproveSeatRequest('Ines', 'Bao')).toBe(true);
  });

  test('null host → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="seatRequest_approveButton" />',
    );
    expect(await driver.iosApproveSeatRequest(null, 'Bao')).toBe(true);
  });

  test('undefined host → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="seatRequest_approveButton" />',
    );
    expect(await driver.iosApproveSeatRequest(undefined, 'Bao')).toBe(true);
  });

  test('empty host → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="seatRequest_approveButton" />',
    );
    expect(await driver.iosApproveSeatRequest('', 'Bao')).toBe(true);
  });

  test('whitespace host → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="seatRequest_approveButton" />',
    );
    expect(await driver.iosApproveSeatRequest('   ', 'Bao')).toBe(true);
  });

  test('null requester → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="seatRequest_approveButton" />',
    );
    expect(await driver.iosApproveSeatRequest('Alice', null)).toBe(true);
  });

  test('undefined requester → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="seatRequest_approveButton" />',
    );
    expect(await driver.iosApproveSeatRequest('Alice', undefined)).toBe(true);
  });

  test('empty requester → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="seatRequest_approveButton" />',
    );
    expect(await driver.iosApproveSeatRequest('Alice', '')).toBe(true);
  });

  test('whitespace requester → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="seatRequest_approveButton" />',
    );
    expect(await driver.iosApproveSeatRequest('Alice', '   ')).toBe(true);
  });

  test('different requester still passes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="seatRequest_approveButton" />',
    );
    expect(await driver.iosApproveSeatRequest('Alice', 'NotInRequest')).toBe(true);
  });

  test('first-match contract — two seatRequest_* nodes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="seatRequest_approveButton" />' +
        '<XCUIElementTypeOther identifier="seatRequest_pendingPanel" />',
    );
    expect(await driver.iosApproveSeatRequest('Alice', 'Bao')).toBe(true);
  });
});

describe('ios-devicectl-driver — iosContinuesNormallyInRoom', () => {
  // Wake 90 — `<Name>'s <Plat> UI continues normally in the room`
  // (j10). Composite predicate: IN room AND NOT on warning screen.
  function driverWithDump(xml) {
    return createIosDriver({ udid: 'X' }).then((d) => {
      d.iosUiDump = async () => xml;
      return d;
    });
  }

  test('room marker present + no warning → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="room_seatGrid" />');
    expect(await driver.iosContinuesNormallyInRoom('Alice')).toBe(true);
  });

  test('warning marker present (even with room) → false (warning beats room)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="room_seatGrid" />' +
        '<XCUIElementTypeOther identifier="warning_title" />',
    );
    expect(await driver.iosContinuesNormallyInRoom('Alice')).toBe(false);
  });

  test('warning marker only → false', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="warning_title" />');
    expect(await driver.iosContinuesNormallyInRoom('Alice')).toBe(false);
  });

  test('absent (no room, no warning) → false', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosContinuesNormallyInRoom('Alice')).toBe(false);
  });

  test('empty dump → false', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosContinuesNormallyInRoom('Alice')).toBe(false);
  });

  test('bare room marker (no package qualifier) → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="room_chatInput" />');
    expect(await driver.iosContinuesNormallyInRoom('Alice')).toBe(true);
  });

  test('non-self-closing tag form room marker → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="room_seatGrid"><XCUIElementTypeStaticText name="Bao" /></XCUIElementTypeOther>',
    );
    expect(await driver.iosContinuesNormallyInRoom('Alice')).toBe(true);
  });

  test('left-boundary — pre_room_X does NOT match', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="pre_room_seatGrid" />');
    expect(await driver.iosContinuesNormallyInRoom('Alice')).toBe(false);
  });

  test('left-boundary — pre_warning_X does NOT count as warning', async () => {
    // A confusable warning prefix should NOT block, then the room
    // check decides. Here neither room nor warning present (only
    // `pre_warning_X`) → false on room axis.
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="pre_warning_title" />');
    expect(await driver.iosContinuesNormallyInRoom('Alice')).toBe(false);
  });

  test('right-boundary — room_seatGridExtra still matches (prefix contract)', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="room_seatGridExtra" />');
    expect(await driver.iosContinuesNormallyInRoom('Alice')).toBe(true);
  });

  test('confusable room prefix — rooms_listItem does NOT match', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="rooms_listItem" />');
    expect(await driver.iosContinuesNormallyInRoom('Alice')).toBe(false);
  });

  test('attribute-specificity — name= for room does NOT trigger', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther name="room_seatGrid" />');
    expect(await driver.iosContinuesNormallyInRoom('Alice')).toBe(false);
  });

  test('iosUiDump throws → rejects', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('WDA lost');
    };
    await expect(driver.iosContinuesNormallyInRoom('Alice')).rejects.toThrow();
  });

  test('name accepted-and-ignored — Ines passes', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="room_seatGrid" />');
    expect(await driver.iosContinuesNormallyInRoom('Ines')).toBe(true);
  });

  test('null name → true (with room marker)', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="room_seatGrid" />');
    expect(await driver.iosContinuesNormallyInRoom(null)).toBe(true);
  });

  test('undefined name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="room_seatGrid" />');
    expect(await driver.iosContinuesNormallyInRoom(undefined)).toBe(true);
  });

  test('empty name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="room_seatGrid" />');
    expect(await driver.iosContinuesNormallyInRoom('')).toBe(true);
  });

  test('whitespace name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="room_seatGrid" />');
    expect(await driver.iosContinuesNormallyInRoom('   ')).toBe(true);
  });

  test('first-match contract — two room_* markers', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="room_seatGrid" />' +
        '<XCUIElementTypeOther identifier="room_chatInput" />',
    );
    expect(await driver.iosContinuesNormallyInRoom('Alice')).toBe(true);
  });
});

describe('ios-devicectl-driver — iosDisablesInput', () => {
  // Wake 89 — `<Name>'s <Plat> UI disables the <X> input` (j11:50).
  // Two-step: INPUT_TAGS lookup → tag presence → enabled="false" scan.
  function driverWithDump(xml) {
    return createIosDriver({ udid: 'X' }).then((d) => {
      d.iosUiDump = async () => xml;
      return d;
    });
  }

  test('chat input with enabled="false" → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeTextField identifier="room_chatInput" enabled="false" />',
    );
    expect(await driver.iosDisablesInput('Theo', 'chat')).toBe(true);
  });

  test('chat input with enabled="true" → false', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeTextField identifier="room_chatInput" enabled="true" />',
    );
    expect(await driver.iosDisablesInput('Theo', 'chat')).toBe(false);
  });

  test('chat input without enabled attribute → false (defensive)', async () => {
    const driver = await driverWithDump('<XCUIElementTypeTextField identifier="room_chatInput" />');
    expect(await driver.iosDisablesInput('Theo', 'chat')).toBe(false);
  });

  test('unmapped input name "comment" → false (FAIL-loud)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeTextField identifier="room_chatInput" enabled="false" />',
    );
    expect(await driver.iosDisablesInput('Theo', 'comment')).toBe(false);
  });

  test('input testTag absent → false', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="main_roomsTab" enabled="false" />',
    );
    expect(await driver.iosDisablesInput('Theo', 'chat')).toBe(false);
  });

  test('empty dump → false', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosDisablesInput('Theo', 'chat')).toBe(false);
  });

  test('empty inputName → false', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeTextField identifier="room_chatInput" enabled="false" />',
    );
    expect(await driver.iosDisablesInput('Theo', '')).toBe(false);
  });

  test('whitespace inputName → false', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeTextField identifier="room_chatInput" enabled="false" />',
    );
    expect(await driver.iosDisablesInput('Theo', '   ')).toBe(false);
  });

  test('null inputName → false', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeTextField identifier="room_chatInput" enabled="false" />',
    );
    expect(await driver.iosDisablesInput('Theo', null)).toBe(false);
  });

  test('undefined inputName → false', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeTextField identifier="room_chatInput" enabled="false" />',
    );
    expect(await driver.iosDisablesInput('Theo', undefined)).toBe(false);
  });

  test('case-insensitive inputName — "CHAT" maps to chat', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeTextField identifier="room_chatInput" enabled="false" />',
    );
    expect(await driver.iosDisablesInput('Theo', 'CHAT')).toBe(true);
  });

  test('left-boundary — pre_room_chatInput does NOT match (package-qualified absent on iOS)', async () => {
    // iOS XCUITest has no package qualifier, but the regex still
    // anchors at `identifier="`. Pin that pre_X doesn't match.
    const driver = await driverWithDump(
      '<XCUIElementTypeTextField identifier="pre_room_chatInput" enabled="false" />',
    );
    expect(await driver.iosDisablesInput('Theo', 'chat')).toBe(false);
  });

  test('right-boundary — room_chatInput_extra does NOT match (exact tag)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeTextField identifier="room_chatInput_extra" enabled="false" />',
    );
    expect(await driver.iosDisablesInput('Theo', 'chat')).toBe(false);
  });

  test('attribute-order tolerance — enabled before identifier still works', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeTextField enabled="false" identifier="room_chatInput" />',
    );
    expect(await driver.iosDisablesInput('Theo', 'chat')).toBe(true);
  });

  test('compound enabled attribute — pre-enabled="false" does NOT trigger', async () => {
    // Boundary guard: `(?<![\w-])enabled="false"` blocks compound
    // attribute names like `pre-enabled`. Pin to match Android sibling.
    const driver = await driverWithDump(
      '<XCUIElementTypeTextField identifier="room_chatInput" pre-enabled="false" />',
    );
    expect(await driver.iosDisablesInput('Theo', 'chat')).toBe(false);
  });

  test('iosUiDump throws → rejects', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('WDA lost');
    };
    await expect(driver.iosDisablesInput('Theo', 'chat')).rejects.toThrow();
  });

  test('name accepted-and-ignored — Bao passes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeTextField identifier="room_chatInput" enabled="false" />',
    );
    expect(await driver.iosDisablesInput('Bao', 'chat')).toBe(true);
  });

  test('null name → true (name accepted-and-ignored)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeTextField identifier="room_chatInput" enabled="false" />',
    );
    expect(await driver.iosDisablesInput(null, 'chat')).toBe(true);
  });

  test('undefined name → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeTextField identifier="room_chatInput" enabled="false" />',
    );
    expect(await driver.iosDisablesInput(undefined, 'chat')).toBe(true);
  });

  test('empty name → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeTextField identifier="room_chatInput" enabled="false" />',
    );
    expect(await driver.iosDisablesInput('', 'chat')).toBe(true);
  });

  test('whitespace name → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeTextField identifier="room_chatInput" enabled="false" />',
    );
    expect(await driver.iosDisablesInput('   ', 'chat')).toBe(true);
  });
});

describe('ios-devicectl-driver — iosIsNoLongerInVoiceRoom', () => {
  // Wake 105 — `<Name>'s <Plat> UI is no longer in the voice room`.
  // Inverse of iosIsStillInRoom. CRITICAL defensive: empty dump
  // returns false (can't confirm gone).
  function driverWithDump(xml) {
    return createIosDriver({ udid: 'X' }).then((d) => {
      d.iosUiDump = async () => xml;
      return d;
    });
  }

  test('no room marker → true (user is gone)', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosIsNoLongerInVoiceRoom('Alice')).toBe(true);
  });

  test('room marker present → false (still in room)', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="room_seatGrid" />');
    expect(await driver.iosIsNoLongerInVoiceRoom('Alice')).toBe(false);
  });

  test("empty dump → false (CRITICAL: can't confirm gone)", async () => {
    const driver = await createIosDriver({ udid: 'X' });
    // Empty dump must NOT incorrectly report user-has-left. Pin the
    // defensive behaviour explicitly.
    expect(await driver.iosIsNoLongerInVoiceRoom('Alice')).toBe(false);
  });

  test('different screen → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosIsNoLongerInVoiceRoom('Alice')).toBe(true);
  });

  test('non-self-closing room tag still detected → false', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="room_seatGrid"><XCUIElementTypeStaticText name="Bao" /></XCUIElementTypeOther>',
    );
    expect(await driver.iosIsNoLongerInVoiceRoom('Alice')).toBe(false);
  });

  test('left-boundary — pre_room_X does NOT count as in-room', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="pre_room_seatGrid" />');
    expect(await driver.iosIsNoLongerInVoiceRoom('Alice')).toBe(true);
  });

  test('right-boundary — room_seatGridExtra still counts as in-room', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="room_seatGridExtra" />');
    expect(await driver.iosIsNoLongerInVoiceRoom('Alice')).toBe(false);
  });

  test('confusable prefix — rooms_listItem does NOT count as in-room', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="rooms_listItem" />');
    expect(await driver.iosIsNoLongerInVoiceRoom('Alice')).toBe(true);
  });

  test('attribute-specificity — name="room_X" does NOT count', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther name="room_seatGrid" />');
    expect(await driver.iosIsNoLongerInVoiceRoom('Alice')).toBe(true);
  });

  test('iosUiDump throws → rejects', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('WDA lost');
    };
    await expect(driver.iosIsNoLongerInVoiceRoom('Alice')).rejects.toThrow();
  });

  test('name accepted-and-ignored — Ines passes', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosIsNoLongerInVoiceRoom('Ines')).toBe(true);
  });

  test('null name → true (with non-room dump)', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosIsNoLongerInVoiceRoom(null)).toBe(true);
  });

  test('undefined name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosIsNoLongerInVoiceRoom(undefined)).toBe(true);
  });

  test('empty name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosIsNoLongerInVoiceRoom('')).toBe(true);
  });

  test('whitespace name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosIsNoLongerInVoiceRoom('   ')).toBe(true);
  });
});

describe('ios-devicectl-driver — iosIsStillInRoom', () => {
  // Wake 84 — `<Name>'s <Plat> UI is still in the room`.
  function driverWithDump(xml) {
    return createIosDriver({ udid: 'X' }).then((d) => {
      d.iosUiDump = async () => xml;
      return d;
    });
  }

  test('room marker present → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="room_seatGrid" />');
    expect(await driver.iosIsStillInRoom('Alice')).toBe(true);
  });

  test('no room marker → false', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosIsStillInRoom('Alice')).toBe(false);
  });

  test('empty dump → false', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosIsStillInRoom('Alice')).toBe(false);
  });

  test('non-self-closing tag form → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="room_seatGrid"><XCUIElementTypeStaticText name="Bao" /></XCUIElementTypeOther>',
    );
    expect(await driver.iosIsStillInRoom('Alice')).toBe(true);
  });

  test('left-boundary — pre_room_X does NOT match', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="pre_room_seatGrid" />');
    expect(await driver.iosIsStillInRoom('Alice')).toBe(false);
  });

  test('right-boundary — room_seatGridExtra still matches', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="room_seatGridExtra" />');
    expect(await driver.iosIsStillInRoom('Alice')).toBe(true);
  });

  test('confusable prefix — rooms_listItem does NOT match', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="rooms_listItem" />');
    expect(await driver.iosIsStillInRoom('Alice')).toBe(false);
  });

  test('attribute-specificity — name= does NOT trigger', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther name="room_seatGrid" />');
    expect(await driver.iosIsStillInRoom('Alice')).toBe(false);
  });

  test('iosUiDump throws → rejects', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('WDA lost');
    };
    await expect(driver.iosIsStillInRoom('Alice')).rejects.toThrow();
  });

  test('name accepted-and-ignored — Ines passes', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="room_seatGrid" />');
    expect(await driver.iosIsStillInRoom('Ines')).toBe(true);
  });

  test('null name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="room_seatGrid" />');
    expect(await driver.iosIsStillInRoom(null)).toBe(true);
  });

  test('undefined name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="room_seatGrid" />');
    expect(await driver.iosIsStillInRoom(undefined)).toBe(true);
  });

  test('empty name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="room_seatGrid" />');
    expect(await driver.iosIsStillInRoom('')).toBe(true);
  });

  test('whitespace name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="room_seatGrid" />');
    expect(await driver.iosIsStillInRoom('   ')).toBe(true);
  });

  test('first-match contract — two room_* markers', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="room_seatGrid" />' +
        '<XCUIElementTypeOther identifier="room_chatInput" />',
    );
    expect(await driver.iosIsStillInRoom('Alice')).toBe(true);
  });
});

describe('ios-devicectl-driver — iosJoinEventRoom', () => {
  // Wake 86 — `<P1> on <plat1> and <P2> on <plat2> both join the
  // event room` (j16). Presence-check on `roomList_roomCard_*` PREFIX.
  function driverWithDump(xml) {
    return createIosDriver({ udid: 'X' }).then((d) => {
      d.iosUiDump = async () => xml;
      return d;
    });
  }

  test('roomList_roomCard_eventRoom123 present → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="roomList_roomCard_eventRoom123" />',
    );
    expect(await driver.iosJoinEventRoom('Selma')).toBe(true);
  });

  test('roomList_roomCard_abc-def present → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="roomList_roomCard_abc-def" />',
    );
    expect(await driver.iosJoinEventRoom('Selma')).toBe(true);
  });

  test('absent → false', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosJoinEventRoom('Selma')).toBe(false);
  });

  test('empty dump → false', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosJoinEventRoom('Selma')).toBe(false);
  });

  test('non-self-closing tag form → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="roomList_roomCard_x"><XCUIElementTypeStaticText name="Event Room" /></XCUIElementTypeButton>',
    );
    expect(await driver.iosJoinEventRoom('Selma')).toBe(true);
  });

  test('left-boundary — pre_roomList_roomCard_X does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="pre_roomList_roomCard_x" />',
    );
    expect(await driver.iosJoinEventRoom('Selma')).toBe(false);
  });

  test('right-boundary — roomList_roomCard_xExtra still matches (prefix contract)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="roomList_roomCard_xExtra" />',
    );
    expect(await driver.iosJoinEventRoom('Selma')).toBe(true);
  });

  test('confusable prefix — roomList_room_card does NOT match', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="roomList_room_card" />');
    expect(await driver.iosJoinEventRoom('Selma')).toBe(false);
  });

  test('similar-but-distinct — roomList_header does NOT match', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="roomList_header" />');
    expect(await driver.iosJoinEventRoom('Selma')).toBe(false);
  });

  test('attribute-specificity — name= does NOT trigger', async () => {
    const driver = await driverWithDump('<XCUIElementTypeButton name="roomList_roomCard_x" />');
    expect(await driver.iosJoinEventRoom('Selma')).toBe(false);
  });

  test('iosUiDump throws → rejects', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('WDA lost');
    };
    await expect(driver.iosJoinEventRoom('Selma')).rejects.toThrow();
  });

  test('name accepted-and-ignored — Tariq passes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="roomList_roomCard_x" />',
    );
    expect(await driver.iosJoinEventRoom('Tariq')).toBe(true);
  });

  test('null name → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="roomList_roomCard_x" />',
    );
    expect(await driver.iosJoinEventRoom(null)).toBe(true);
  });

  test('undefined name → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="roomList_roomCard_x" />',
    );
    expect(await driver.iosJoinEventRoom(undefined)).toBe(true);
  });

  test('empty name → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="roomList_roomCard_x" />',
    );
    expect(await driver.iosJoinEventRoom('')).toBe(true);
  });

  test('whitespace name → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="roomList_roomCard_x" />',
    );
    expect(await driver.iosJoinEventRoom('   ')).toBe(true);
  });

  test('first-match contract — two roomList_roomCard_* nodes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="roomList_roomCard_a" />' +
        '<XCUIElementTypeButton identifier="roomList_roomCard_b" />',
    );
    expect(await driver.iosJoinEventRoom('Selma')).toBe(true);
  });
});

describe('ios-devicectl-driver — iosNavigatesBackToTab', () => {
  // Wake 95 — `<Name>'s <Plat> UI navigates back to the <tab> tab`.
  // Foundation: presence-check on `main_*Tab` identifier suffix.
  function driverWithDump(xml) {
    return createIosDriver({ udid: 'X' }).then((d) => {
      d.iosUiDump = async () => xml;
      return d;
    });
  }

  test('main_roomsTab present → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosNavigatesBackToTab('Alice', 'rooms')).toBe(true);
  });

  test('main_messagesTab present → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_messagesTab" />');
    expect(await driver.iosNavigatesBackToTab('Alice', 'messages')).toBe(true);
  });

  test('main_walletTab present → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_walletTab" />');
    expect(await driver.iosNavigatesBackToTab('Alice', 'wallet')).toBe(true);
  });

  test('absent (no nav bar) → false', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosNavigatesBackToTab('Alice', 'rooms')).toBe(false);
  });

  test('empty dump → false', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosNavigatesBackToTab('Alice', 'rooms')).toBe(false);
  });

  test('non-self-closing form → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="main_roomsTab"><XCUIElementTypeStaticText name="Rooms" /></XCUIElementTypeOther>',
    );
    expect(await driver.iosNavigatesBackToTab('Alice', 'rooms')).toBe(true);
  });

  test('left-boundary — pre_main_roomsTab does NOT match', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="pre_main_roomsTab" />');
    expect(await driver.iosNavigatesBackToTab('Alice', 'rooms')).toBe(false);
  });

  test('right-boundary — main_roomsTabExtra does NOT match (Tab" anchors right)', async () => {
    // The regex requires `Tab"` at the end, so `Extra` suffix after
    // `Tab` does NOT match — the closing `"` anchors the right side.
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTabExtra" />');
    expect(await driver.iosNavigatesBackToTab('Alice', 'rooms')).toBe(false);
  });

  test('confusable prefix — mainPage_tab does NOT match', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="mainPage_tab" />');
    expect(await driver.iosNavigatesBackToTab('Alice', 'rooms')).toBe(false);
  });

  test('attribute-specificity — name= does NOT trigger', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther name="main_roomsTab" />');
    expect(await driver.iosNavigatesBackToTab('Alice', 'rooms')).toBe(false);
  });

  test('iosUiDump throws → rejects', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('WDA lost');
    };
    await expect(driver.iosNavigatesBackToTab('Alice', 'rooms')).rejects.toThrow();
  });

  test('name accepted-and-ignored — Bao passes', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosNavigatesBackToTab('Bao', 'rooms')).toBe(true);
  });

  test('null name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosNavigatesBackToTab(null, 'rooms')).toBe(true);
  });

  test('undefined name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosNavigatesBackToTab(undefined, 'rooms')).toBe(true);
  });

  test('empty name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosNavigatesBackToTab('', 'rooms')).toBe(true);
  });

  test('whitespace name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosNavigatesBackToTab('   ', 'rooms')).toBe(true);
  });

  test('null tab → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosNavigatesBackToTab('Alice', null)).toBe(true);
  });

  test('undefined tab → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosNavigatesBackToTab('Alice', undefined)).toBe(true);
  });

  test('empty tab → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosNavigatesBackToTab('Alice', '')).toBe(true);
  });

  test('whitespace tab → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosNavigatesBackToTab('Alice', '   ')).toBe(true);
  });

  test('different tab still passes (foundation does not verify specific tab)', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosNavigatesBackToTab('Alice', 'AnyTabName')).toBe(true);
  });

  test('first-match contract — two main_*Tab nodes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="main_roomsTab" />' +
        '<XCUIElementTypeOther identifier="main_messagesTab" />',
    );
    expect(await driver.iosNavigatesBackToTab('Alice', 'rooms')).toBe(true);
  });
});

describe('ios-devicectl-driver — iosNavigatesToPath', () => {
  // Wake 99 — `<Name>'s <Plat> UI navigates to "<Path>"`. Generic
  // path-based navigation. PATH_TAGS scaffold with prefix-resolver.
  function driverWithDump(xml) {
    return createIosDriver({ udid: 'X' }).then((d) => {
      d.iosUiDump = async () => xml;
      return d;
    });
  }

  test('"/" exact match → main_roomsTab present → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosNavigatesToPath('Alice', '/')).toBe(true);
  });

  test('"/profile" exact match → profile_displayName present → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosNavigatesToPath('Alice', '/profile')).toBe(true);
  });

  test('"/profile/42" longest-prefix → profile_displayName present → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosNavigatesToPath('Alice', '/profile/42')).toBe(true);
  });

  test('"/messages" exact → main_messagesTab present → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_messagesTab" />');
    expect(await driver.iosNavigatesToPath('Alice', '/messages')).toBe(true);
  });

  test('"/wallet" exact → wallet_balance present → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="wallet_balance" />');
    expect(await driver.iosNavigatesToPath('Alice', '/wallet')).toBe(true);
  });

  test('"/settings" exact → securitySettingsScreen present → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="securitySettingsScreen" />',
    );
    expect(await driver.iosNavigatesToPath('Alice', '/settings')).toBe(true);
  });

  test('"/" exact does NOT prefix-match other paths', async () => {
    // CRITICAL pin: "/" must be exact-match-only. If "/" were treated
    // as a prefix, every path would match. Use a dump WITHOUT
    // main_roomsTab to verify the path-resolver returns null for
    // unmapped paths even when "/" could greedily prefix them.
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    // "/unknown" should NOT resolve to "/" → main_roomsTab.
    expect(await driver.iosNavigatesToPath('Alice', '/unknown')).toBe(false);
  });

  test('unmapped path returns false (FAIL-loud)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosNavigatesToPath('Alice', '/unmapped/path')).toBe(false);
  });

  test('mapped path + tag absent → false', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosNavigatesToPath('Alice', '/profile')).toBe(false);
  });

  test('empty dump → false (mapped path)', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosNavigatesToPath('Alice', '/profile')).toBe(false);
  });

  test('empty path → false', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosNavigatesToPath('Alice', '')).toBe(false);
  });

  test('whitespace path → false', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosNavigatesToPath('Alice', '   ')).toBe(false);
  });

  test('null path → false', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosNavigatesToPath('Alice', null)).toBe(false);
  });

  test('undefined path → false', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosNavigatesToPath('Alice', undefined)).toBe(false);
  });

  test('non-string path (number) → false', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosNavigatesToPath('Alice', 123)).toBe(false);
  });

  test('iosUiDump throws → rejects', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('WDA lost');
    };
    await expect(driver.iosNavigatesToPath('Alice', '/')).rejects.toThrow();
  });

  test('name accepted-and-ignored — Bao passes', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosNavigatesToPath('Bao', '/')).toBe(true);
  });

  test('null name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosNavigatesToPath(null, '/')).toBe(true);
  });

  test('undefined name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosNavigatesToPath(undefined, '/')).toBe(true);
  });

  test('left-boundary — pre_main_roomsTab does NOT match', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="pre_main_roomsTab" />');
    expect(await driver.iosNavigatesToPath('Alice', '/')).toBe(false);
  });

  test('attribute-specificity — name= does NOT trigger', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther name="main_roomsTab" />');
    expect(await driver.iosNavigatesToPath('Alice', '/')).toBe(false);
  });

  test('path trimmed before resolve — leading/trailing whitespace', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosNavigatesToPath('Alice', '  /  ')).toBe(true);
  });
});

describe('ios-devicectl-driver — iosNavigatesToProfileScreen', () => {
  // Wake 101 — `<Name>'s <Plat> UI navigates to <Other>'s profile
  // screen`. Foundation: presence-check on `profile_*` identifier.
  function driverWithDump(xml) {
    return createIosDriver({ udid: 'X' }).then((d) => {
      d.iosUiDump = async () => xml;
      return d;
    });
  }

  test('profile_displayName present → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosNavigatesToProfileScreen('Alice', 'Bob')).toBe(true);
  });

  test('profile_avatar present → true (any suffix)', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="profile_avatar" />');
    expect(await driver.iosNavigatesToProfileScreen('Alice', 'Bob')).toBe(true);
  });

  test('absent → false', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosNavigatesToProfileScreen('Alice', 'Bob')).toBe(false);
  });

  test('empty dump → false', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosNavigatesToProfileScreen('Alice', 'Bob')).toBe(false);
  });

  test('non-self-closing form → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName"><XCUIElementTypeStaticText name="Bob" /></XCUIElementTypeOther>',
    );
    expect(await driver.iosNavigatesToProfileScreen('Alice', 'Bob')).toBe(true);
  });

  test('left-boundary — pre_profile_X does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="pre_profile_displayName" />',
    );
    expect(await driver.iosNavigatesToProfileScreen('Alice', 'Bob')).toBe(false);
  });

  test('right-boundary — profile_displayNameExtra still matches', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayNameExtra" />',
    );
    expect(await driver.iosNavigatesToProfileScreen('Alice', 'Bob')).toBe(true);
  });

  test('confusable prefix — profileSettings_panel does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profileSettings_panel" />',
    );
    expect(await driver.iosNavigatesToProfileScreen('Alice', 'Bob')).toBe(false);
  });

  test('attribute-specificity — name= does NOT trigger', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther name="profile_displayName" />');
    expect(await driver.iosNavigatesToProfileScreen('Alice', 'Bob')).toBe(false);
  });

  test('iosUiDump throws → rejects', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('WDA lost');
    };
    await expect(driver.iosNavigatesToProfileScreen('Alice', 'Bob')).rejects.toThrow();
  });

  test('name accepted-and-ignored — Bao passes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosNavigatesToProfileScreen('Bao', 'Bob')).toBe(true);
  });

  test('null name → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosNavigatesToProfileScreen(null, 'Bob')).toBe(true);
  });

  test('undefined name → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosNavigatesToProfileScreen(undefined, 'Bob')).toBe(true);
  });

  test('empty name → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosNavigatesToProfileScreen('', 'Bob')).toBe(true);
  });

  test('whitespace name → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosNavigatesToProfileScreen('   ', 'Bob')).toBe(true);
  });

  test('null target → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosNavigatesToProfileScreen('Alice', null)).toBe(true);
  });

  test('undefined target → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosNavigatesToProfileScreen('Alice', undefined)).toBe(true);
  });

  test('empty target → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosNavigatesToProfileScreen('Alice', '')).toBe(true);
  });

  test('whitespace target → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosNavigatesToProfileScreen('Alice', '   ')).toBe(true);
  });

  test('different target still passes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosNavigatesToProfileScreen('Alice', 'NotInProfile')).toBe(true);
  });

  test('first-match contract — two profile_* nodes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />' +
        '<XCUIElementTypeOther identifier="profile_avatar" />',
    );
    expect(await driver.iosNavigatesToProfileScreen('Alice', 'Bob')).toBe(true);
  });
});

describe('ios-devicectl-driver — iosNavigatesToRoomScreen', () => {
  // Wake 101 — `<Name>'s <Plat> UI navigates to the room screen`.
  // Foundation: presence-check on `room_*` identifier PREFIX.
  function driverWithDump(xml) {
    return createIosDriver({ udid: 'X' }).then((d) => {
      d.iosUiDump = async () => xml;
      return d;
    });
  }

  test('room_seatGrid present → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="room_seatGrid" />');
    expect(await driver.iosNavigatesToRoomScreen('Alice')).toBe(true);
  });

  test('room_chatInput present → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="room_chatInput" />');
    expect(await driver.iosNavigatesToRoomScreen('Alice')).toBe(true);
  });

  test('absent → false', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosNavigatesToRoomScreen('Alice')).toBe(false);
  });

  test('empty dump → false', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosNavigatesToRoomScreen('Alice')).toBe(false);
  });

  test('non-self-closing form → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="room_seatGrid"><XCUIElementTypeStaticText name="Seat" /></XCUIElementTypeOther>',
    );
    expect(await driver.iosNavigatesToRoomScreen('Alice')).toBe(true);
  });

  test('left-boundary — pre_room_X does NOT match', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="pre_room_seatGrid" />');
    expect(await driver.iosNavigatesToRoomScreen('Alice')).toBe(false);
  });

  test('right-boundary — room_seatGridExtra still matches', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="room_seatGridExtra" />');
    expect(await driver.iosNavigatesToRoomScreen('Alice')).toBe(true);
  });

  test('confusable prefix — rooms_listItem does NOT match', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="rooms_listItem" />');
    expect(await driver.iosNavigatesToRoomScreen('Alice')).toBe(false);
  });

  test('attribute-specificity — name= does NOT trigger', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther name="room_seatGrid" />');
    expect(await driver.iosNavigatesToRoomScreen('Alice')).toBe(false);
  });

  test('iosUiDump throws → rejects', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('WDA lost');
    };
    await expect(driver.iosNavigatesToRoomScreen('Alice')).rejects.toThrow();
  });

  test('name accepted-and-ignored — Bao passes', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="room_seatGrid" />');
    expect(await driver.iosNavigatesToRoomScreen('Bao')).toBe(true);
  });

  test('null name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="room_seatGrid" />');
    expect(await driver.iosNavigatesToRoomScreen(null)).toBe(true);
  });

  test('undefined name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="room_seatGrid" />');
    expect(await driver.iosNavigatesToRoomScreen(undefined)).toBe(true);
  });

  test('empty name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="room_seatGrid" />');
    expect(await driver.iosNavigatesToRoomScreen('')).toBe(true);
  });

  test('whitespace name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="room_seatGrid" />');
    expect(await driver.iosNavigatesToRoomScreen('   ')).toBe(true);
  });

  test('first-match contract — two room_* nodes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="room_seatGrid" />' +
        '<XCUIElementTypeOther identifier="room_chatInput" />',
    );
    expect(await driver.iosNavigatesToRoomScreen('Alice')).toBe(true);
  });
});

describe('ios-devicectl-driver — iosNavigatesToWarningScreen', () => {
  // Wake 101 — `<Name>'s <Plat> UI navigates to the warning screen`.
  // Foundation: presence-check on `warning_*` identifier PREFIX.
  function driverWithDump(xml) {
    return createIosDriver({ udid: 'X' }).then((d) => {
      d.iosUiDump = async () => xml;
      return d;
    });
  }

  test('warning_title present → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="warning_title" />');
    expect(await driver.iosNavigatesToWarningScreen('Alice')).toBe(true);
  });

  test('warning_acknowledgeButton present → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="warning_acknowledgeButton" />',
    );
    expect(await driver.iosNavigatesToWarningScreen('Alice')).toBe(true);
  });

  test('absent → false', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosNavigatesToWarningScreen('Alice')).toBe(false);
  });

  test('empty dump → false', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosNavigatesToWarningScreen('Alice')).toBe(false);
  });

  test('non-self-closing form → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="warning_title"><XCUIElementTypeStaticText name="Warning" /></XCUIElementTypeOther>',
    );
    expect(await driver.iosNavigatesToWarningScreen('Alice')).toBe(true);
  });

  test('left-boundary — pre_warning_X does NOT match', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="pre_warning_title" />');
    expect(await driver.iosNavigatesToWarningScreen('Alice')).toBe(false);
  });

  test('right-boundary — warning_titleExtra still matches', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="warning_titleExtra" />');
    expect(await driver.iosNavigatesToWarningScreen('Alice')).toBe(true);
  });

  test('confusable prefix — warnings_listItem does NOT match', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="warnings_listItem" />');
    expect(await driver.iosNavigatesToWarningScreen('Alice')).toBe(false);
  });

  test('attribute-specificity — name= does NOT trigger', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther name="warning_title" />');
    expect(await driver.iosNavigatesToWarningScreen('Alice')).toBe(false);
  });

  test('iosUiDump throws → rejects', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('WDA lost');
    };
    await expect(driver.iosNavigatesToWarningScreen('Alice')).rejects.toThrow();
  });

  test('name accepted-and-ignored — Bao passes', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="warning_title" />');
    expect(await driver.iosNavigatesToWarningScreen('Bao')).toBe(true);
  });

  test('null name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="warning_title" />');
    expect(await driver.iosNavigatesToWarningScreen(null)).toBe(true);
  });

  test('undefined name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="warning_title" />');
    expect(await driver.iosNavigatesToWarningScreen(undefined)).toBe(true);
  });

  test('empty name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="warning_title" />');
    expect(await driver.iosNavigatesToWarningScreen('')).toBe(true);
  });

  test('whitespace name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="warning_title" />');
    expect(await driver.iosNavigatesToWarningScreen('   ')).toBe(true);
  });

  test('first-match contract — two warning_* nodes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="warning_title" />' +
        '<XCUIElementTypeButton identifier="warning_acknowledgeButton" />',
    );
    expect(await driver.iosNavigatesToWarningScreen('Alice')).toBe(true);
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

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

describe('ios-devicectl-driver — iosOpenProfileAndTap', () => {
  // Wake 88 — `<Name> on <Plat> opens <Other>'s profile and taps
  // "<X>"` (j11:33). Mirrors Android PR #767.
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
    expect(await driver.iosOpenProfileAndTap('Greta', 'Raul', 'Block')).toBe(true);
  });

  test('profile_avatar present → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="profile_avatar" />');
    expect(await driver.iosOpenProfileAndTap('Greta', 'Raul', 'Report')).toBe(true);
  });

  test('absent → false', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosOpenProfileAndTap('Greta', 'Raul', 'Block')).toBe(false);
  });

  test('empty dump → false', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosOpenProfileAndTap('Greta', 'Raul', 'Block')).toBe(false);
  });

  test('non-self-closing → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName"><XCUIElementTypeStaticText name="Raul" /></XCUIElementTypeOther>',
    );
    expect(await driver.iosOpenProfileAndTap('Greta', 'Raul', 'Block')).toBe(true);
  });

  test('left-boundary — pre_profile_X does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="pre_profile_displayName" />',
    );
    expect(await driver.iosOpenProfileAndTap('Greta', 'Raul', 'Block')).toBe(false);
  });

  test('right-boundary — profile_displayNameExtra still matches', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayNameExtra" />',
    );
    expect(await driver.iosOpenProfileAndTap('Greta', 'Raul', 'Block')).toBe(true);
  });

  test('confusable prefix — profileSettings_panel does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profileSettings_panel" />',
    );
    expect(await driver.iosOpenProfileAndTap('Greta', 'Raul', 'Block')).toBe(false);
  });

  test('attribute-specificity — name= does NOT trigger', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther name="profile_displayName" />');
    expect(await driver.iosOpenProfileAndTap('Greta', 'Raul', 'Block')).toBe(false);
  });

  test('iosUiDump throws → rejects', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('WDA lost');
    };
    await expect(driver.iosOpenProfileAndTap('Greta', 'Raul', 'Block')).rejects.toThrow();
  });

  test('actor accepted-and-ignored — Bao passes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileAndTap('Bao', 'Raul', 'Block')).toBe(true);
  });

  test('null actor → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileAndTap(null, 'Raul', 'Block')).toBe(true);
  });

  test('undefined actor → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileAndTap(undefined, 'Raul', 'Block')).toBe(true);
  });

  test('empty actor → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileAndTap('', 'Raul', 'Block')).toBe(true);
  });

  test('whitespace actor → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileAndTap('   ', 'Raul', 'Block')).toBe(true);
  });

  test('null target → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileAndTap('Greta', null, 'Block')).toBe(true);
  });

  test('undefined target → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileAndTap('Greta', undefined, 'Block')).toBe(true);
  });

  test('empty target → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileAndTap('Greta', '', 'Block')).toBe(true);
  });

  test('whitespace target → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileAndTap('Greta', '   ', 'Block')).toBe(true);
  });

  test('null button → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileAndTap('Greta', 'Raul', null)).toBe(true);
  });

  test('undefined button → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileAndTap('Greta', 'Raul', undefined)).toBe(true);
  });

  test('empty button → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileAndTap('Greta', 'Raul', '')).toBe(true);
  });

  test('whitespace button → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileAndTap('Greta', 'Raul', '   ')).toBe(true);
  });

  test('different button still passes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileAndTap('Greta', 'Raul', 'AnyButton')).toBe(true);
  });

  test('first-match contract — two profile_* nodes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />' +
        '<XCUIElementTypeOther identifier="profile_avatar" />',
    );
    expect(await driver.iosOpenProfileAndTap('Greta', 'Raul', 'Block')).toBe(true);
  });
});

describe('ios-devicectl-driver — iosOpenProfileFrom', () => {
  // Wake 88 — `<Name> on <Plat> opens <Other>'s profile from the <X>`
  // (j17:71, j18:49). Mirrors Android sibling. `_source` is the surface
  // (room|PM|inbox|...); accepted-and-ignored at foundation tier.
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
    expect(await driver.iosOpenProfileFrom('Greta', 'Raul', 'room')).toBe(true);
  });

  test('profile_avatar present → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="profile_avatar" />');
    expect(await driver.iosOpenProfileFrom('Greta', 'Raul', 'chat')).toBe(true);
  });

  test('absent → false', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosOpenProfileFrom('Greta', 'Raul', 'room')).toBe(false);
  });

  test('empty dump → false', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosOpenProfileFrom('Greta', 'Raul', 'room')).toBe(false);
  });

  test('non-self-closing → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName"><XCUIElementTypeStaticText name="Raul" /></XCUIElementTypeOther>',
    );
    expect(await driver.iosOpenProfileFrom('Greta', 'Raul', 'room')).toBe(true);
  });

  test('left-boundary — pre_profile_X does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="pre_profile_displayName" />',
    );
    expect(await driver.iosOpenProfileFrom('Greta', 'Raul', 'room')).toBe(false);
  });

  test('right-boundary — profile_displayNameExtra still matches', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayNameExtra" />',
    );
    expect(await driver.iosOpenProfileFrom('Greta', 'Raul', 'room')).toBe(true);
  });

  test('confusable prefix — profileSettings_panel does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profileSettings_panel" />',
    );
    expect(await driver.iosOpenProfileFrom('Greta', 'Raul', 'room')).toBe(false);
  });

  test('attribute-specificity — name= does NOT trigger', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther name="profile_displayName" />');
    expect(await driver.iosOpenProfileFrom('Greta', 'Raul', 'room')).toBe(false);
  });

  test('iosUiDump throws → rejects', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('WDA lost');
    };
    await expect(driver.iosOpenProfileFrom('Greta', 'Raul', 'room')).rejects.toThrow();
  });

  test('actor accepted-and-ignored — Bao passes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileFrom('Bao', 'Raul', 'room')).toBe(true);
  });

  test('null actor → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileFrom(null, 'Raul', 'room')).toBe(true);
  });

  test('undefined actor → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileFrom(undefined, 'Raul', 'room')).toBe(true);
  });

  test('empty actor → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileFrom('', 'Raul', 'room')).toBe(true);
  });

  test('whitespace actor → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileFrom('   ', 'Raul', 'room')).toBe(true);
  });

  test('null target → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileFrom('Greta', null, 'room')).toBe(true);
  });

  test('undefined target → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileFrom('Greta', undefined, 'room')).toBe(true);
  });

  test('empty target → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileFrom('Greta', '', 'room')).toBe(true);
  });

  test('whitespace target → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileFrom('Greta', '   ', 'room')).toBe(true);
  });

  test('null source → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileFrom('Greta', 'Raul', null)).toBe(true);
  });

  test('undefined source → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileFrom('Greta', 'Raul', undefined)).toBe(true);
  });

  test('empty source → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileFrom('Greta', 'Raul', '')).toBe(true);
  });

  test('whitespace source → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileFrom('Greta', 'Raul', '   ')).toBe(true);
  });

  test('different source still passes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpenProfileFrom('Greta', 'Raul', 'search')).toBe(true);
  });

  test('first-match contract — two profile_* nodes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />' +
        '<XCUIElementTypeOther identifier="profile_avatar" />',
    );
    expect(await driver.iosOpenProfileFrom('Greta', 'Raul', 'room')).toBe(true);
  });
});

describe('ios-devicectl-driver — iosOpensTab', () => {
  // Wake 92 — `<Name> [P-NN] (cohort) opens the <tab> tab on iOS`.
  // Sister to iosNavigatesBackToTab (Wake 95); same `main_*Tab`
  // presence-check. Both args (_name, _tab) accepted-and-ignored.
  function driverWithDump(xml) {
    return createIosDriver({ udid: 'X' }).then((d) => {
      d.iosUiDump = async () => xml;
      return d;
    });
  }

  test('main_roomsTab present → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosOpensTab('Marcus', 'rooms')).toBe(true);
  });

  test('main_messagesTab present → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_messagesTab" />');
    expect(await driver.iosOpensTab('Marcus', 'messages')).toBe(true);
  });

  test('main_walletTab present → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_walletTab" />');
    expect(await driver.iosOpensTab('Marcus', 'wallet')).toBe(true);
  });

  test('absent (no nav bar) → false', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_displayName" />',
    );
    expect(await driver.iosOpensTab('Marcus', 'rooms')).toBe(false);
  });

  test('empty dump → false', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosOpensTab('Marcus', 'rooms')).toBe(false);
  });

  test('non-self-closing form → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="main_roomsTab"><XCUIElementTypeStaticText name="Rooms" /></XCUIElementTypeOther>',
    );
    expect(await driver.iosOpensTab('Marcus', 'rooms')).toBe(true);
  });

  test('left-boundary — pre_main_roomsTab does NOT match', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="pre_main_roomsTab" />');
    expect(await driver.iosOpensTab('Marcus', 'rooms')).toBe(false);
  });

  test('right-boundary — main_roomsTabExtra does NOT match (Tab" anchors right)', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTabExtra" />');
    expect(await driver.iosOpensTab('Marcus', 'rooms')).toBe(false);
  });

  test('confusable prefix — mainPage_tab does NOT match', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="mainPage_tab" />');
    expect(await driver.iosOpensTab('Marcus', 'rooms')).toBe(false);
  });

  test('attribute-specificity — name= does NOT trigger', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther name="main_roomsTab" />');
    expect(await driver.iosOpensTab('Marcus', 'rooms')).toBe(false);
  });

  test('iosUiDump throws → rejects', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('WDA lost');
    };
    await expect(driver.iosOpensTab('Marcus', 'rooms')).rejects.toThrow();
  });

  test('name accepted-and-ignored — Bao passes', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosOpensTab('Bao', 'rooms')).toBe(true);
  });

  test('null name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosOpensTab(null, 'rooms')).toBe(true);
  });

  test('undefined name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosOpensTab(undefined, 'rooms')).toBe(true);
  });

  test('empty name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosOpensTab('', 'rooms')).toBe(true);
  });

  test('whitespace name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosOpensTab('   ', 'rooms')).toBe(true);
  });

  test('null tab → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosOpensTab('Marcus', null)).toBe(true);
  });

  test('undefined tab → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosOpensTab('Marcus', undefined)).toBe(true);
  });

  test('empty tab → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosOpensTab('Marcus', '')).toBe(true);
  });

  test('whitespace tab → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosOpensTab('Marcus', '   ')).toBe(true);
  });

  test('different tab still passes (foundation does not verify specific tab)', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosOpensTab('Marcus', 'AnyTabName')).toBe(true);
  });

  test('first-match contract — two main_*Tab nodes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="main_roomsTab" />' +
        '<XCUIElementTypeOther identifier="main_messagesTab" />',
    );
    expect(await driver.iosOpensTab('Marcus', 'rooms')).toBe(true);
  });
});

describe('ios-devicectl-driver — iosRefreshLanguageRail', () => {
  // Wake 87 — `<Name> on <Plat> refreshes the language rail` (j17:78).
  // Foundation: presence-check on `languageRail_*` identifier PREFIX.
  // No such identifier exists in commonMain yet — returns false today.
  function driverWithDump(xml) {
    return createIosDriver({ udid: 'X' }).then((d) => {
      d.iosUiDump = async () => xml;
      return d;
    });
  }

  test('languageRail_container present → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="languageRail_container" />',
    );
    expect(await driver.iosRefreshLanguageRail('Marcus')).toBe(true);
  });

  test('languageRail_refreshButton present → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="languageRail_refreshButton" />',
    );
    expect(await driver.iosRefreshLanguageRail('Marcus')).toBe(true);
  });

  test('absent (rail not built) → false', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosRefreshLanguageRail('Marcus')).toBe(false);
  });

  test('empty dump → false', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosRefreshLanguageRail('Marcus')).toBe(false);
  });

  test('non-self-closing form → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="languageRail_container"><XCUIElementTypeStaticText name="EN" /></XCUIElementTypeOther>',
    );
    expect(await driver.iosRefreshLanguageRail('Marcus')).toBe(true);
  });

  test('left-boundary — pre_languageRail_X does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="pre_languageRail_container" />',
    );
    expect(await driver.iosRefreshLanguageRail('Marcus')).toBe(false);
  });

  test('right-boundary — languageRail_containerExtra still matches', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="languageRail_containerExtra" />',
    );
    expect(await driver.iosRefreshLanguageRail('Marcus')).toBe(true);
  });

  test('confusable prefix — languageRailExtras_panel does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="languageRailExtras_panel" />',
    );
    expect(await driver.iosRefreshLanguageRail('Marcus')).toBe(false);
  });

  test('attribute-specificity — name= does NOT trigger', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther name="languageRail_container" />');
    expect(await driver.iosRefreshLanguageRail('Marcus')).toBe(false);
  });

  test('iosUiDump throws → rejects', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('WDA lost');
    };
    await expect(driver.iosRefreshLanguageRail('Marcus')).rejects.toThrow();
  });

  test('name accepted-and-ignored — Bao passes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="languageRail_container" />',
    );
    expect(await driver.iosRefreshLanguageRail('Bao')).toBe(true);
  });

  test('null name → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="languageRail_container" />',
    );
    expect(await driver.iosRefreshLanguageRail(null)).toBe(true);
  });

  test('undefined name → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="languageRail_container" />',
    );
    expect(await driver.iosRefreshLanguageRail(undefined)).toBe(true);
  });

  test('empty name → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="languageRail_container" />',
    );
    expect(await driver.iosRefreshLanguageRail('')).toBe(true);
  });

  test('whitespace name → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="languageRail_container" />',
    );
    expect(await driver.iosRefreshLanguageRail('   ')).toBe(true);
  });

  test('first-match contract — two languageRail_* nodes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="languageRail_container" />' +
        '<XCUIElementTypeButton identifier="languageRail_refreshButton" />',
    );
    expect(await driver.iosRefreshLanguageRail('Marcus')).toBe(true);
  });
});

describe('ios-devicectl-driver — iosReplacesFollowButton', () => {
  // Wake 102 — `<Name>'s <Plat> UI replaces follow button with "<X>"`.
  // Foundation: capture profile_followButton tag, scan label/name/value
  // attrs for case-insensitive exact match against buttonId.
  function driverWithDump(xml) {
    return createIosDriver({ udid: 'X' }).then((d) => {
      d.iosUiDump = async () => xml;
      return d;
    });
  }

  test('label="Follow" matches "Follow" → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="profile_followButton" label="Follow" />',
    );
    expect(await driver.iosReplacesFollowButton('Alice', 'Follow')).toBe(true);
  });

  test('name="Following" matches "Following" → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="profile_followButton" name="Following" />',
    );
    expect(await driver.iosReplacesFollowButton('Alice', 'Following')).toBe(true);
  });

  test('value="Unfollow" matches "Unfollow" → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="profile_followButton" value="Unfollow" />',
    );
    expect(await driver.iosReplacesFollowButton('Alice', 'Unfollow')).toBe(true);
  });

  test('label="Follow back" matches "Follow back" → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="profile_followButton" label="Follow back" />',
    );
    expect(await driver.iosReplacesFollowButton('Alice', 'Follow back')).toBe(true);
  });

  test('label="Follow" matches "follow" (lowercase) → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="profile_followButton" label="Follow" />',
    );
    expect(await driver.iosReplacesFollowButton('Alice', 'follow')).toBe(true);
  });

  test('label="follow" matches "FOLLOW" (uppercase) → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="profile_followButton" label="follow" />',
    );
    expect(await driver.iosReplacesFollowButton('Alice', 'FOLLOW')).toBe(true);
  });

  test('label="Follow back" does NOT match "Follow" (overlap-prefix discipline)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="profile_followButton" label="Follow back" />',
    );
    expect(await driver.iosReplacesFollowButton('Alice', 'Follow')).toBe(false);
  });

  test('label="Following" does NOT match "Follow" (overlap-prefix discipline)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="profile_followButton" label="Following" />',
    );
    expect(await driver.iosReplacesFollowButton('Alice', 'Follow')).toBe(false);
  });

  test('label="Follow" does NOT match "Follow back" (overlap-prefix discipline)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="profile_followButton" label="Follow" />',
    );
    expect(await driver.iosReplacesFollowButton('Alice', 'Follow back')).toBe(false);
  });

  test('value="Following" does NOT match "Follow" (overlap-prefix via value attr)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="profile_followButton" value="Following" />',
    );
    expect(await driver.iosReplacesFollowButton('Alice', 'Follow')).toBe(false);
  });

  test('attr-scan continues past mismatched name to match value', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="profile_followButton" name="Unrelated" value="Follow" />',
    );
    expect(await driver.iosReplacesFollowButton('Alice', 'Follow')).toBe(true);
  });

  test('profile_followButton absent → false', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="profile_otherButton" label="Follow" />',
    );
    expect(await driver.iosReplacesFollowButton('Alice', 'Follow')).toBe(false);
  });

  test('empty dump → false', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosReplacesFollowButton('Alice', 'Follow')).toBe(false);
  });

  test('tag present without any label attr → false', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="profile_followButton" />',
    );
    expect(await driver.iosReplacesFollowButton('Alice', 'Follow')).toBe(false);
  });

  test('tag present with non-matching label → false', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="profile_followButton" label="Unrelated" />',
    );
    expect(await driver.iosReplacesFollowButton('Alice', 'Follow')).toBe(false);
  });

  test('identifier value itself is NOT taken as a label candidate', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="profile_followButton" />',
    );
    expect(await driver.iosReplacesFollowButton('Alice', 'profile_followButton')).toBe(false);
  });

  test('label mismatches but name matches → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="profile_followButton" label="Unrelated" name="Follow" />',
    );
    expect(await driver.iosReplacesFollowButton('Alice', 'Follow')).toBe(true);
  });

  // Input-rejection tests use a throwing iosUiDump to PROVE the
  // buttonId guard early-returns before any dump fetch — a future
  // reorder that pulls the dump before validating buttonId would
  // surface the throw and fail these tests.
  test('null buttonId → false, iosUiDump not called', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('must not be called');
    };
    expect(await driver.iosReplacesFollowButton('Alice', null)).toBe(false);
  });

  test('undefined buttonId → false, iosUiDump not called', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('must not be called');
    };
    expect(await driver.iosReplacesFollowButton('Alice', undefined)).toBe(false);
  });

  test('empty buttonId → false, iosUiDump not called', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('must not be called');
    };
    expect(await driver.iosReplacesFollowButton('Alice', '')).toBe(false);
  });

  test('whitespace buttonId → false, iosUiDump not called', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('must not be called');
    };
    expect(await driver.iosReplacesFollowButton('Alice', '   ')).toBe(false);
  });

  test('null name → still evaluates buttonId', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="profile_followButton" label="Follow" />',
    );
    expect(await driver.iosReplacesFollowButton(null, 'Follow')).toBe(true);
  });

  test('undefined name → still evaluates buttonId', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="profile_followButton" label="Follow" />',
    );
    expect(await driver.iosReplacesFollowButton(undefined, 'Follow')).toBe(true);
  });

  test('empty name → still evaluates buttonId', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="profile_followButton" label="Follow" />',
    );
    expect(await driver.iosReplacesFollowButton('', 'Follow')).toBe(true);
  });

  test('whitespace name → still evaluates buttonId', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="profile_followButton" label="Follow" />',
    );
    expect(await driver.iosReplacesFollowButton('   ', 'Follow')).toBe(true);
  });

  test('label="Follow" on a DIFFERENT tag (no profile_followButton) → false', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="profile_otherButton" label="Follow" />',
    );
    expect(await driver.iosReplacesFollowButton('Alice', 'Follow')).toBe(false);
  });

  test('left-boundary — pre_profile_followButton does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="pre_profile_followButton" label="Follow" />',
    );
    expect(await driver.iosReplacesFollowButton('Alice', 'Follow')).toBe(false);
  });

  test('right-boundary — profile_followButtonExtra does NOT match (closing quote anchors)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeButton identifier="profile_followButtonExtra" label="Follow" />',
    );
    expect(await driver.iosReplacesFollowButton('Alice', 'Follow')).toBe(false);
  });

  test('iosUiDump throws → rejects', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('WDA lost');
    };
    await expect(driver.iosReplacesFollowButton('Alice', 'Follow')).rejects.toThrow();
  });
});

describe('ios-devicectl-driver — iosShowsBalanceViaListener', () => {
  // Wake 100 — `<Name>'s <Plat> UI shows the new "<X>" balance via
  // Firestore listener`. Foundation: capture wallet_balance tag, scan
  // label/name/value attrs for balance with word-boundary protection.
  function driverWithDump(xml) {
    return createIosDriver({ udid: 'X' }).then((d) => {
      d.iosUiDump = async () => xml;
      return d;
    });
  }

  // Happy paths across each label-bearing attribute.
  test('label="5,000" matches "5,000" → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText identifier="wallet_balance" label="5,000" />',
    );
    expect(await driver.iosShowsBalanceViaListener('Alice', '5,000')).toBe(true);
  });

  test('name="$5,000" matches "$5,000" → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText identifier="wallet_balance" name="$5,000" />',
    );
    expect(await driver.iosShowsBalanceViaListener('Alice', '$5,000')).toBe(true);
  });

  test('value="5,000" matches "5,000" → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText identifier="wallet_balance" value="5,000" />',
    );
    expect(await driver.iosShowsBalanceViaListener('Alice', '5,000')).toBe(true);
  });

  // Substring tolerance with padding (label-style and currency-prefix).
  test('label="Balance: 5,000 coins" matches "5,000" → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText identifier="wallet_balance" label="Balance: 5,000 coins" />',
    );
    expect(await driver.iosShowsBalanceViaListener('Alice', '5,000')).toBe(true);
  });

  test('value="$5,000" matches "5,000" (currency prefix tolerated)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText identifier="wallet_balance" value="$5,000" />',
    );
    expect(await driver.iosShowsBalanceViaListener('Alice', '5,000')).toBe(true);
  });

  // Numeric-prefix collision: "45,000" must NOT match "5,000".
  test('label="45,000" does NOT match "5,000" (prefix collision)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText identifier="wallet_balance" label="45,000" />',
    );
    expect(await driver.iosShowsBalanceViaListener('Alice', '5,000')).toBe(false);
  });

  // Numeric-suffix collision: "5,0000" must NOT match "5,000".
  test('label="5,0000" does NOT match "5,000" (suffix collision)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText identifier="wallet_balance" label="5,0000" />',
    );
    expect(await driver.iosShowsBalanceViaListener('Alice', '5,000')).toBe(false);
  });

  // Decimal point literal protection.
  test('balance "1,234.56" matches "1,234.56" exactly', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText identifier="wallet_balance" label="1,234.56" />',
    );
    expect(await driver.iosShowsBalanceViaListener('Alice', '1,234.56')).toBe(true);
  });

  test('balance "1,234.56" does NOT match label "1,234X56" (regex-escape protects .)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText identifier="wallet_balance" label="1,234X56" />',
    );
    expect(await driver.iosShowsBalanceViaListener('Alice', '1,234.56')).toBe(false);
  });

  // Asymmetric boundary discipline (mirrors Android sibling): the LEFT
  // boundary excludes both \w and hyphen, but the RIGHT boundary only
  // excludes \w. Hyphen-suffix is therefore tolerated as a label
  // separator ("5,000-coin minimum" still matches "5,000"). Underscore-
  // suffix is REJECTED because underscore IS a word char.
  test('label="5,000-coin" still matches "5,000" (hyphen tolerated on right)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText identifier="wallet_balance" label="5,000-coin" />',
    );
    expect(await driver.iosShowsBalanceViaListener('Alice', '5,000')).toBe(true);
  });

  test('label="5,000_extra" does NOT match "5,000" (underscore is \\w)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText identifier="wallet_balance" label="5,000_extra" />',
    );
    expect(await driver.iosShowsBalanceViaListener('Alice', '5,000')).toBe(false);
  });

  test('label="extra-5,000" does NOT match "5,000" (hyphen blocked on LEFT only)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText identifier="wallet_balance" label="extra-5,000" />',
    );
    expect(await driver.iosShowsBalanceViaListener('Alice', '5,000')).toBe(false);
  });

  // Tag absence.
  test('wallet_balance absent → false', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText identifier="profile_displayName" label="5,000" />',
    );
    expect(await driver.iosShowsBalanceViaListener('Alice', '5,000')).toBe(false);
  });

  test('empty dump → false', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosShowsBalanceViaListener('Alice', '5,000')).toBe(false);
  });

  test('tag present but no label/name/value attrs → false', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText identifier="wallet_balance" />',
    );
    expect(await driver.iosShowsBalanceViaListener('Alice', '5,000')).toBe(false);
  });

  test('tag present with non-matching label → false', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText identifier="wallet_balance" label="0" />',
    );
    expect(await driver.iosShowsBalanceViaListener('Alice', '5,000')).toBe(false);
  });

  // identifier value itself never leaks as a label candidate (\bidentifier=
  // is excluded from attrRx alternation).
  test('balance "wallet_balance" does NOT match identifier value itself', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText identifier="wallet_balance" />',
    );
    expect(await driver.iosShowsBalanceViaListener('Alice', 'wallet_balance')).toBe(false);
  });

  // Cross-tag scan-confinement.
  test('label="5,000" on a DIFFERENT tag → false', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText identifier="other_widget" label="5,000" />',
    );
    expect(await driver.iosShowsBalanceViaListener('Alice', '5,000')).toBe(false);
  });

  // Boundary checks on identifier.
  test('left-boundary — pre_wallet_balance does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText identifier="pre_wallet_balance" label="5,000" />',
    );
    expect(await driver.iosShowsBalanceViaListener('Alice', '5,000')).toBe(false);
  });

  test('right-boundary — wallet_balanceExtra does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText identifier="wallet_balanceExtra" label="5,000" />',
    );
    expect(await driver.iosShowsBalanceViaListener('Alice', '5,000')).toBe(false);
  });

  // attr-scan continues past mismatched name to match value.
  test('label mismatches but value matches → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText identifier="wallet_balance" label="Wallet" value="5,000" />',
    );
    expect(await driver.iosShowsBalanceViaListener('Alice', '5,000')).toBe(true);
  });

  // Input-rejection isolation: throwing iosUiDump proves guard short-
  // circuits before any dump fetch.
  test('null balance → false, iosUiDump not called', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('must not be called');
    };
    expect(await driver.iosShowsBalanceViaListener('Alice', null)).toBe(false);
  });

  test('undefined balance → false, iosUiDump not called', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('must not be called');
    };
    expect(await driver.iosShowsBalanceViaListener('Alice', undefined)).toBe(false);
  });

  test('empty balance → false, iosUiDump not called', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('must not be called');
    };
    expect(await driver.iosShowsBalanceViaListener('Alice', '')).toBe(false);
  });

  test('whitespace balance → false, iosUiDump not called', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('must not be called');
    };
    expect(await driver.iosShowsBalanceViaListener('Alice', '   ')).toBe(false);
  });

  // name (first arg) accepted-and-ignored.
  test('null name → still evaluates balance', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText identifier="wallet_balance" label="5,000" />',
    );
    expect(await driver.iosShowsBalanceViaListener(null, '5,000')).toBe(true);
  });

  test('undefined name → still evaluates balance', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText identifier="wallet_balance" label="5,000" />',
    );
    expect(await driver.iosShowsBalanceViaListener(undefined, '5,000')).toBe(true);
  });

  test('empty name → still evaluates balance', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText identifier="wallet_balance" label="5,000" />',
    );
    expect(await driver.iosShowsBalanceViaListener('', '5,000')).toBe(true);
  });

  test('whitespace name → still evaluates balance', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText identifier="wallet_balance" label="5,000" />',
    );
    expect(await driver.iosShowsBalanceViaListener('   ', '5,000')).toBe(true);
  });

  test('iosUiDump throws → rejects', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('WDA lost');
    };
    await expect(driver.iosShowsBalanceViaListener('Alice', '5,000')).rejects.toThrow();
  });

  // Contract pins (R1 from review):
  // - Padded balance is NOT trimmed before regex construction. ' 5,000'
  //   passes the !balance.trim() guard but the regex then looks for
  //   the literal ' 5,000' substring, which won't match label="5,000".
  //   Mirrors Android sibling behavior.
  test('padded balance " 5,000" does not match trimmed label "5,000" (no trim before regex)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText identifier="wallet_balance" label="5,000" />',
    );
    expect(await driver.iosShowsBalanceViaListener('Alice', ' 5,000')).toBe(false);
  });

  // - The \b on \b(?:label|name|value)= guards against compound attribute
  //   names like accessibilityLabel=. iOS XCUITest WDA dumps use plain
  //   label= but the guard is defence-in-depth.
  test('accessibilityLabel="5,000" does NOT match (\\b guards compound attr name)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText identifier="wallet_balance" accessibilityLabel="5,000" />',
    );
    expect(await driver.iosShowsBalanceViaListener('Alice', '5,000')).toBe(false);
  });
});

describe('ios-devicectl-driver — iosShowsBanner', () => {
  // Wake 97 — `<Name>'s <Plat> UI shows a "<X>" banner`. Foundation:
  // substring scan across any node's label/name/value attr.
  function driverWithDump(xml) {
    return createIosDriver({ udid: 'X' }).then((d) => {
      d.iosUiDump = async () => xml;
      return d;
    });
  }

  // Happy paths — each label-bearing attribute.
  test('label= carries banner → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText label="Connection lost — retrying" />',
    );
    expect(await driver.iosShowsBanner('Adam', 'Connection lost')).toBe(true);
  });

  test('name= carries banner → true (icon-only banner)', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther name="You are offline" />');
    expect(await driver.iosShowsBanner('Adam', 'You are offline')).toBe(true);
  });

  test('value= carries banner → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther value="Reconnecting in 5 seconds" />',
    );
    expect(await driver.iosShowsBanner('Adam', 'Reconnecting')).toBe(true);
  });

  // Substring tolerance — banner with dynamic suffix.
  test('substring match — banner with dynamic suffix → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText label="Connection lost — retrying in 5 minutes" />',
    );
    expect(await driver.iosShowsBanner('Adam', 'Connection lost')).toBe(true);
  });

  // Regex-meta chars in banner must be treated literally.
  test('banner with parens "(retry)" matches literally', async () => {
    const driver = await driverWithDump('<XCUIElementTypeStaticText label="Failed (retry)" />');
    expect(await driver.iosShowsBanner('Adam', '(retry)')).toBe(true);
  });

  test('banner with dot "v1.2" matches literal dot (not any-char)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText label="Update to v1.2 available" />',
    );
    expect(await driver.iosShowsBanner('Adam', 'v1.2')).toBe(true);
  });

  test('banner "v1.2" does NOT match label "v1X2" (regex-escape protects dot)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText label="Update to v1X2 available" />',
    );
    expect(await driver.iosShowsBanner('Adam', 'v1.2')).toBe(false);
  });

  // Compound-attribute name protection (the \b guard).
  test('accessibilityLabel= does NOT trigger (\\b guards compound attr names)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText accessibilityLabel="Connection lost" />',
    );
    expect(await driver.iosShowsBanner('Adam', 'Connection lost')).toBe(false);
  });

  test('hint= does NOT trigger (only label/name/value scanned)', async () => {
    const driver = await driverWithDump('<XCUIElementTypeStaticText hint="Connection lost" />');
    expect(await driver.iosShowsBanner('Adam', 'Connection lost')).toBe(false);
  });

  // identifier= specifically must not be scanned (different attribute).
  test('identifier="Connection lost" does NOT match (not in attr alternation)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText identifier="Connection lost" />',
    );
    expect(await driver.iosShowsBanner('Adam', 'Connection lost')).toBe(false);
  });

  // Direct \b pin for name= against compound attrs (typename=, filename=).
  test('typename="Connection lost" does NOT match (\\b blocks compound)', async () => {
    const driver = await driverWithDump('<XCUIElementTypeStaticText typename="Connection lost" />');
    expect(await driver.iosShowsBanner('Adam', 'Connection lost')).toBe(false);
  });

  test('somevalue="Connection lost" does NOT match (\\b blocks compound)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeStaticText somevalue="Connection lost" />',
    );
    expect(await driver.iosShowsBanner('Adam', 'Connection lost')).toBe(false);
  });

  // Cross-tag scan — banner can be on any element type.
  test('banner on XCUIElementTypeButton element → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeButton label="Update available" />');
    expect(await driver.iosShowsBanner('Adam', 'Update available')).toBe(true);
  });

  test('banner on XCUIElementTypeImage element with name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeImage name="Connection lost" />');
    expect(await driver.iosShowsBanner('Adam', 'Connection lost')).toBe(true);
  });

  // Tag absence / empty dump.
  test('banner not present → false', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther label="Something else" />');
    expect(await driver.iosShowsBanner('Adam', 'Connection lost')).toBe(false);
  });

  test('empty dump → false', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosShowsBanner('Adam', 'Connection lost')).toBe(false);
  });

  // Case sensitivity — banner is a substring match, not case-insensitive.
  test('case mismatch — "connection lost" lowercase does NOT match "Connection lost"', async () => {
    const driver = await driverWithDump('<XCUIElementTypeStaticText label="Connection lost" />');
    expect(await driver.iosShowsBanner('Adam', 'connection lost')).toBe(false);
  });

  // Input-rejection isolation: throwing iosUiDump proves guard short-
  // circuits before any dump fetch.
  test('null banner → false, iosUiDump not called', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('must not be called');
    };
    expect(await driver.iosShowsBanner('Adam', null)).toBe(false);
  });

  test('undefined banner → false, iosUiDump not called', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('must not be called');
    };
    expect(await driver.iosShowsBanner('Adam', undefined)).toBe(false);
  });

  test('empty banner → false, iosUiDump not called', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('must not be called');
    };
    expect(await driver.iosShowsBanner('Adam', '')).toBe(false);
  });

  test('whitespace banner → false, iosUiDump not called', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('must not be called');
    };
    expect(await driver.iosShowsBanner('Adam', '   ')).toBe(false);
  });

  // name (first arg) accepted-and-ignored.
  test('null name → still evaluates banner', async () => {
    const driver = await driverWithDump('<XCUIElementTypeStaticText label="Connection lost" />');
    expect(await driver.iosShowsBanner(null, 'Connection lost')).toBe(true);
  });

  test('undefined name → still evaluates banner', async () => {
    const driver = await driverWithDump('<XCUIElementTypeStaticText label="Connection lost" />');
    expect(await driver.iosShowsBanner(undefined, 'Connection lost')).toBe(true);
  });

  test('empty name → still evaluates banner', async () => {
    const driver = await driverWithDump('<XCUIElementTypeStaticText label="Connection lost" />');
    expect(await driver.iosShowsBanner('', 'Connection lost')).toBe(true);
  });

  test('whitespace name → still evaluates banner', async () => {
    const driver = await driverWithDump('<XCUIElementTypeStaticText label="Connection lost" />');
    expect(await driver.iosShowsBanner('   ', 'Connection lost')).toBe(true);
  });

  test('iosUiDump throws → rejects', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('WDA lost');
    };
    await expect(driver.iosShowsBanner('Adam', 'Connection lost')).rejects.toThrow();
  });
});

describe('ios-devicectl-driver — iosShowsBeansPerWeekChart', () => {
  // Wake 87 — `<Name>'s <Plat> UI shows a chart of beans earned per
  // week`. Foundation: presence-check on `beansChart_*` identifier.
  function driverWithDump(xml) {
    return createIosDriver({ udid: 'X' }).then((d) => {
      d.iosUiDump = async () => xml;
      return d;
    });
  }

  test('beansChart_container present → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="beansChart_container" />',
    );
    expect(await driver.iosShowsBeansPerWeekChart('Marcus')).toBe(true);
  });

  test('beansChart_weekBar present → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="beansChart_weekBar" />');
    expect(await driver.iosShowsBeansPerWeekChart('Marcus')).toBe(true);
  });

  test('absent → false', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosShowsBeansPerWeekChart('Marcus')).toBe(false);
  });

  test('empty dump → false', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosShowsBeansPerWeekChart('Marcus')).toBe(false);
  });

  test('non-self-closing form → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="beansChart_container"><XCUIElementTypeStaticText name="Mon: 12" /></XCUIElementTypeOther>',
    );
    expect(await driver.iosShowsBeansPerWeekChart('Marcus')).toBe(true);
  });

  test('left-boundary — pre_beansChart_X does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="pre_beansChart_container" />',
    );
    expect(await driver.iosShowsBeansPerWeekChart('Marcus')).toBe(false);
  });

  test('right-boundary — beansChart_containerExtra still matches', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="beansChart_containerExtra" />',
    );
    expect(await driver.iosShowsBeansPerWeekChart('Marcus')).toBe(true);
  });

  test('confusable prefix — beansChartExtras_panel does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="beansChartExtras_panel" />',
    );
    expect(await driver.iosShowsBeansPerWeekChart('Marcus')).toBe(false);
  });

  test('attribute-specificity — name= does NOT trigger', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther name="beansChart_container" />');
    expect(await driver.iosShowsBeansPerWeekChart('Marcus')).toBe(false);
  });

  test('iosUiDump throws → rejects', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('WDA lost');
    };
    await expect(driver.iosShowsBeansPerWeekChart('Marcus')).rejects.toThrow();
  });

  test('name accepted-and-ignored — Bao passes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="beansChart_container" />',
    );
    expect(await driver.iosShowsBeansPerWeekChart('Bao')).toBe(true);
  });

  test('null name → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="beansChart_container" />',
    );
    expect(await driver.iosShowsBeansPerWeekChart(null)).toBe(true);
  });

  test('undefined name → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="beansChart_container" />',
    );
    expect(await driver.iosShowsBeansPerWeekChart(undefined)).toBe(true);
  });

  test('empty name → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="beansChart_container" />',
    );
    expect(await driver.iosShowsBeansPerWeekChart('')).toBe(true);
  });

  test('whitespace name → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="beansChart_container" />',
    );
    expect(await driver.iosShowsBeansPerWeekChart('   ')).toBe(true);
  });

  test('first-match contract — two beansChart_* nodes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="beansChart_container" />' +
        '<XCUIElementTypeOther identifier="beansChart_weekBar" />',
    );
    expect(await driver.iosShowsBeansPerWeekChart('Marcus')).toBe(true);
  });
});

describe('ios-devicectl-driver — iosShowsContributorsList', () => {
  // Wake 92 — `<Name>'s <Plat> UI shows the list of contributors with
  // amounts`. Foundation: presence-check giftWall_grid identifier.
  function driverWithDump(xml) {
    return createIosDriver({ udid: 'X' }).then((d) => {
      d.iosUiDump = async () => xml;
      return d;
    });
  }

  test('giftWall_grid present → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="giftWall_grid" />');
    expect(await driver.iosShowsContributorsList('Marcus')).toBe(true);
  });

  test('absent → false', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosShowsContributorsList('Marcus')).toBe(false);
  });

  test('empty dump → false', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosShowsContributorsList('Marcus')).toBe(false);
  });

  test('non-self-closing form → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="giftWall_grid"><XCUIElementTypeStaticText name="Bao: 100" /></XCUIElementTypeOther>',
    );
    expect(await driver.iosShowsContributorsList('Marcus')).toBe(true);
  });

  test('left-boundary — pre_giftWall_grid does NOT match', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="pre_giftWall_grid" />');
    expect(await driver.iosShowsContributorsList('Marcus')).toBe(false);
  });

  test('right-boundary — giftWall_gridExtra does NOT match (closing quote anchors)', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="giftWall_gridExtra" />');
    expect(await driver.iosShowsContributorsList('Marcus')).toBe(false);
  });

  test('confusable prefix — giftWallExtras_grid does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="giftWallExtras_grid" />',
    );
    expect(await driver.iosShowsContributorsList('Marcus')).toBe(false);
  });

  test('attribute-specificity — name= does NOT trigger', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther name="giftWall_grid" />');
    expect(await driver.iosShowsContributorsList('Marcus')).toBe(false);
  });

  test('iosUiDump throws → rejects', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('WDA lost');
    };
    await expect(driver.iosShowsContributorsList('Marcus')).rejects.toThrow();
  });

  test('name accepted-and-ignored — Bao passes', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="giftWall_grid" />');
    expect(await driver.iosShowsContributorsList('Bao')).toBe(true);
  });

  test('null name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="giftWall_grid" />');
    expect(await driver.iosShowsContributorsList(null)).toBe(true);
  });

  test('undefined name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="giftWall_grid" />');
    expect(await driver.iosShowsContributorsList(undefined)).toBe(true);
  });

  test('empty name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="giftWall_grid" />');
    expect(await driver.iosShowsContributorsList('')).toBe(true);
  });

  test('whitespace name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="giftWall_grid" />');
    expect(await driver.iosShowsContributorsList('   ')).toBe(true);
  });
});

describe('ios-devicectl-driver — iosShowsCountBadge', () => {
  // Wake 98 — `<Name>'s <Plat> UI shows a +N in the "<X>" count`.
  // Foundation: presence-check countBadge_* identifier PREFIX.
  function driverWithDump(xml) {
    return createIosDriver({ udid: 'X' }).then((d) => {
      d.iosUiDump = async () => xml;
      return d;
    });
  }

  test('countBadge_followersDelta present → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="countBadge_followersDelta" />',
    );
    expect(await driver.iosShowsCountBadge('Greta', 1, 'Followers')).toBe(true);
  });

  test('countBadge_likesDelta present → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="countBadge_likesDelta" />',
    );
    expect(await driver.iosShowsCountBadge('Greta', 3, 'Likes')).toBe(true);
  });

  test('absent → false', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosShowsCountBadge('Greta', 1, 'Followers')).toBe(false);
  });

  test('empty dump → false', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosShowsCountBadge('Greta', 1, 'Followers')).toBe(false);
  });

  test('non-self-closing form → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="countBadge_followersDelta"><XCUIElementTypeStaticText name="+1" /></XCUIElementTypeOther>',
    );
    expect(await driver.iosShowsCountBadge('Greta', 1, 'Followers')).toBe(true);
  });

  test('left-boundary — pre_countBadge_X does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="pre_countBadge_followersDelta" />',
    );
    expect(await driver.iosShowsCountBadge('Greta', 1, 'Followers')).toBe(false);
  });

  test('right-boundary — countBadge_followersDeltaExtra still matches', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="countBadge_followersDeltaExtra" />',
    );
    expect(await driver.iosShowsCountBadge('Greta', 1, 'Followers')).toBe(true);
  });

  test('confusable prefix — countBadgeExtras_panel does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="countBadgeExtras_panel" />',
    );
    expect(await driver.iosShowsCountBadge('Greta', 1, 'Followers')).toBe(false);
  });

  test('attribute-specificity — name= does NOT trigger', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther name="countBadge_followersDelta" />',
    );
    expect(await driver.iosShowsCountBadge('Greta', 1, 'Followers')).toBe(false);
  });

  test('iosUiDump throws → rejects', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('WDA lost');
    };
    await expect(driver.iosShowsCountBadge('Greta', 1, 'Followers')).rejects.toThrow();
  });

  // All 3 args accepted-and-ignored at foundation tier.
  test('null name → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="countBadge_followersDelta" />',
    );
    expect(await driver.iosShowsCountBadge(null, 1, 'Followers')).toBe(true);
  });

  test('undefined name → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="countBadge_followersDelta" />',
    );
    expect(await driver.iosShowsCountBadge(undefined, 1, 'Followers')).toBe(true);
  });

  test('empty name → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="countBadge_followersDelta" />',
    );
    expect(await driver.iosShowsCountBadge('', 1, 'Followers')).toBe(true);
  });

  test('whitespace name → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="countBadge_followersDelta" />',
    );
    expect(await driver.iosShowsCountBadge('   ', 1, 'Followers')).toBe(true);
  });

  test('null delta → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="countBadge_followersDelta" />',
    );
    expect(await driver.iosShowsCountBadge('Greta', null, 'Followers')).toBe(true);
  });

  test('undefined delta → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="countBadge_followersDelta" />',
    );
    expect(await driver.iosShowsCountBadge('Greta', undefined, 'Followers')).toBe(true);
  });

  test('0 delta → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="countBadge_followersDelta" />',
    );
    expect(await driver.iosShowsCountBadge('Greta', 0, 'Followers')).toBe(true);
  });

  test('null label → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="countBadge_followersDelta" />',
    );
    expect(await driver.iosShowsCountBadge('Greta', 1, null)).toBe(true);
  });

  test('undefined label → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="countBadge_followersDelta" />',
    );
    expect(await driver.iosShowsCountBadge('Greta', 1, undefined)).toBe(true);
  });

  test('empty label → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="countBadge_followersDelta" />',
    );
    expect(await driver.iosShowsCountBadge('Greta', 1, '')).toBe(true);
  });

  test('whitespace label → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="countBadge_followersDelta" />',
    );
    expect(await driver.iosShowsCountBadge('Greta', 1, '   ')).toBe(true);
  });

  test('first-match contract — two countBadge_* nodes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="countBadge_followersDelta" />' +
        '<XCUIElementTypeOther identifier="countBadge_likesDelta" />',
    );
    expect(await driver.iosShowsCountBadge('Greta', 1, 'Followers')).toBe(true);
  });
});

describe('ios-devicectl-driver — iosShowsEditedBodyWithTag', () => {
  // Wake 103 — `<Name>'s <Plat> UI shows the edited body "<X>" with
  // an "<Y>" tag`. Foundation: presence-check editedBody_* identifier.
  function driverWithDump(xml) {
    return createIosDriver({ udid: 'X' }).then((d) => {
      d.iosUiDump = async () => xml;
      return d;
    });
  }

  test('editedBody_msg123 present → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="editedBody_msg123" />');
    expect(await driver.iosShowsEditedBodyWithTag('Greta', 'hi', 'edited')).toBe(true);
  });

  test('editedBody_badge present → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="editedBody_badge" />');
    expect(await driver.iosShowsEditedBodyWithTag('Greta', 'hi', 'edited')).toBe(true);
  });

  test('absent → false', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosShowsEditedBodyWithTag('Greta', 'hi', 'edited')).toBe(false);
  });

  test('empty dump → false', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosShowsEditedBodyWithTag('Greta', 'hi', 'edited')).toBe(false);
  });

  test('non-self-closing form → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="editedBody_msg123"><XCUIElementTypeStaticText name="hi (edited)" /></XCUIElementTypeOther>',
    );
    expect(await driver.iosShowsEditedBodyWithTag('Greta', 'hi', 'edited')).toBe(true);
  });

  test('left-boundary — pre_editedBody_X does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="pre_editedBody_msg123" />',
    );
    expect(await driver.iosShowsEditedBodyWithTag('Greta', 'hi', 'edited')).toBe(false);
  });

  test('right-boundary — editedBody_msg123Extra still matches', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="editedBody_msg123Extra" />',
    );
    expect(await driver.iosShowsEditedBodyWithTag('Greta', 'hi', 'edited')).toBe(true);
  });

  test('confusable prefix — editedBodyExtras_panel does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="editedBodyExtras_panel" />',
    );
    expect(await driver.iosShowsEditedBodyWithTag('Greta', 'hi', 'edited')).toBe(false);
  });

  test('attribute-specificity — name= does NOT trigger', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther name="editedBody_msg123" />');
    expect(await driver.iosShowsEditedBodyWithTag('Greta', 'hi', 'edited')).toBe(false);
  });

  test('iosUiDump throws → rejects', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('WDA lost');
    };
    await expect(driver.iosShowsEditedBodyWithTag('Greta', 'hi', 'edited')).rejects.toThrow();
  });

  test('null name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="editedBody_msg123" />');
    expect(await driver.iosShowsEditedBodyWithTag(null, 'hi', 'edited')).toBe(true);
  });

  test('undefined name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="editedBody_msg123" />');
    expect(await driver.iosShowsEditedBodyWithTag(undefined, 'hi', 'edited')).toBe(true);
  });

  test('empty name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="editedBody_msg123" />');
    expect(await driver.iosShowsEditedBodyWithTag('', 'hi', 'edited')).toBe(true);
  });

  test('whitespace name → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="editedBody_msg123" />');
    expect(await driver.iosShowsEditedBodyWithTag('   ', 'hi', 'edited')).toBe(true);
  });

  test('null body → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="editedBody_msg123" />');
    expect(await driver.iosShowsEditedBodyWithTag('Greta', null, 'edited')).toBe(true);
  });

  test('undefined body → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="editedBody_msg123" />');
    expect(await driver.iosShowsEditedBodyWithTag('Greta', undefined, 'edited')).toBe(true);
  });

  test('empty body → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="editedBody_msg123" />');
    expect(await driver.iosShowsEditedBodyWithTag('Greta', '', 'edited')).toBe(true);
  });

  test('whitespace body → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="editedBody_msg123" />');
    expect(await driver.iosShowsEditedBodyWithTag('Greta', '   ', 'edited')).toBe(true);
  });

  test('null tag → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="editedBody_msg123" />');
    expect(await driver.iosShowsEditedBodyWithTag('Greta', 'hi', null)).toBe(true);
  });

  test('undefined tag → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="editedBody_msg123" />');
    expect(await driver.iosShowsEditedBodyWithTag('Greta', 'hi', undefined)).toBe(true);
  });

  test('empty tag → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="editedBody_msg123" />');
    expect(await driver.iosShowsEditedBodyWithTag('Greta', 'hi', '')).toBe(true);
  });

  test('whitespace tag → true', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="editedBody_msg123" />');
    expect(await driver.iosShowsEditedBodyWithTag('Greta', 'hi', '   ')).toBe(true);
  });

  test('first-match contract — two editedBody_* nodes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="editedBody_msg123" />' +
        '<XCUIElementTypeOther identifier="editedBody_badge" />',
    );
    expect(await driver.iosShowsEditedBodyWithTag('Greta', 'hi', 'edited')).toBe(true);
  });
});

describe('ios-devicectl-driver — iosShowsFrozenBanner', () => {
  // Wake 99 — `<Name>'s <Plat> UI[ opens conversation "<X>"] shows the
  // frozen-banner element <suffix>`. Foundation: presence-check exact
  // privateChat_frozenBanner identifier.
  function driverWithDump(xml) {
    return createIosDriver({ udid: 'X' }).then((d) => {
      d.iosUiDump = async () => xml;
      return d;
    });
  }

  test('privateChat_frozenBanner present → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="privateChat_frozenBanner" />',
    );
    expect(await driver.iosShowsFrozenBanner('Greta', 'conv1', 'with text "frozen"')).toBe(true);
  });

  test('absent → false', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther identifier="main_roomsTab" />');
    expect(await driver.iosShowsFrozenBanner('Greta', null, 'with text "frozen"')).toBe(false);
  });

  test('empty dump → false', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    expect(await driver.iosShowsFrozenBanner('Greta', null, 'with text "frozen"')).toBe(false);
  });

  test('non-self-closing form → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="privateChat_frozenBanner"><XCUIElementTypeStaticText name="Conversation frozen" /></XCUIElementTypeOther>',
    );
    expect(await driver.iosShowsFrozenBanner('Greta', null, 'with text "frozen"')).toBe(true);
  });

  test('left-boundary — pre_privateChat_frozenBanner does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="pre_privateChat_frozenBanner" />',
    );
    expect(await driver.iosShowsFrozenBanner('Greta', null, 'X')).toBe(false);
  });

  test('right-boundary — privateChat_frozenBannerExtra does NOT match (exact-match anchor)', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="privateChat_frozenBannerExtra" />',
    );
    expect(await driver.iosShowsFrozenBanner('Greta', null, 'X')).toBe(false);
  });

  test('confusable — privateChatExtras_frozenBanner does NOT match', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="privateChatExtras_frozenBanner" />',
    );
    expect(await driver.iosShowsFrozenBanner('Greta', null, 'X')).toBe(false);
  });

  test('attribute-specificity — name= does NOT trigger', async () => {
    const driver = await driverWithDump('<XCUIElementTypeOther name="privateChat_frozenBanner" />');
    expect(await driver.iosShowsFrozenBanner('Greta', null, 'X')).toBe(false);
  });

  test('iosUiDump throws → rejects', async () => {
    const driver = await createIosDriver({ udid: 'X' });
    driver.iosUiDump = async () => {
      throw new Error('WDA lost');
    };
    await expect(
      driver.iosShowsFrozenBanner('Greta', null, 'with text "frozen"'),
    ).rejects.toThrow();
  });

  test('null viewer → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="privateChat_frozenBanner" />',
    );
    expect(await driver.iosShowsFrozenBanner(null, null, 'X')).toBe(true);
  });

  test('undefined viewer → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="privateChat_frozenBanner" />',
    );
    expect(await driver.iosShowsFrozenBanner(undefined, null, 'X')).toBe(true);
  });

  test('empty viewer → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="privateChat_frozenBanner" />',
    );
    expect(await driver.iosShowsFrozenBanner('', null, 'X')).toBe(true);
  });

  test('whitespace viewer → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="privateChat_frozenBanner" />',
    );
    expect(await driver.iosShowsFrozenBanner('   ', null, 'X')).toBe(true);
  });

  test('null convId → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="privateChat_frozenBanner" />',
    );
    expect(await driver.iosShowsFrozenBanner('Greta', null, 'X')).toBe(true);
  });

  test('undefined convId → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="privateChat_frozenBanner" />',
    );
    expect(await driver.iosShowsFrozenBanner('Greta', undefined, 'X')).toBe(true);
  });

  test('non-empty convId still passes', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="privateChat_frozenBanner" />',
    );
    expect(await driver.iosShowsFrozenBanner('Greta', 'conv-id-99', 'X')).toBe(true);
  });

  test('null suffix → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="privateChat_frozenBanner" />',
    );
    expect(await driver.iosShowsFrozenBanner('Greta', null, null)).toBe(true);
  });

  test('undefined suffix → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="privateChat_frozenBanner" />',
    );
    expect(await driver.iosShowsFrozenBanner('Greta', null, undefined)).toBe(true);
  });

  test('empty suffix → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="privateChat_frozenBanner" />',
    );
    expect(await driver.iosShowsFrozenBanner('Greta', null, '')).toBe(true);
  });

  test('whitespace suffix → true', async () => {
    const driver = await driverWithDump(
      '<XCUIElementTypeOther identifier="privateChat_frozenBanner" />',
    );
    expect(await driver.iosShowsFrozenBanner('Greta', null, '   ')).toBe(true);
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

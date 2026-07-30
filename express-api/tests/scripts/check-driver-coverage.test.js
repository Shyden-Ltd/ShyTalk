/**
 * check-driver-coverage.test.js — SHY-0259
 *
 * Every driver wires its whole `listMethods()` surface to a stub that logs
 * `stub:<name>` and returns false, then real implementations override the
 * ones that exist. A method nobody implemented therefore RESOLVES: the
 * matcher finds it, the step is reached, and the driver quietly announces it
 * did nothing.
 *
 * That is worse than a missing method. Missing fails loudly as "not
 * configured"; a stub returns `false`, which reads as "the product did not do
 * the thing" — a harness gap wearing a product failure's clothes.
 *
 * This gate is itself a gate, so it gets the same treatment the others did:
 * real parser, real drivers, real assertions.
 */
const path = require('path');

const checker = require(path.resolve(__dirname, '../../../scripts/check-driver-coverage.js'));
const { implementedMethods, scanDrivers, reachedMethods, verdict } = checker;

describe('finding implementations in a driver', () => {
  test('a plain assignment counts as implemented', () => {
    expect([...implementedMethods('driver.androidTap = async () => true;')]).toContain(
      'androidTap',
    );
  });

  test('the stub loop itself does NOT count as implementing anything', () => {
    // `driver[methodName] = …` is how every method becomes a stub. Counting
    // it as an implementation would make the gate report perfect coverage
    // on a driver that implements nothing at all.
    const src = `
      for (const methodName of listMethods()) {
        driver[methodName] = async () => false;
      }
    `;
    expect([...implementedMethods(src)]).toEqual([]);
  });

  test('a method named in a COMMENT is not an implementation', () => {
    // The reason this is parsed rather than grepped.
    const src = `
      // driver.androidNotDoneYet = async () => true;
      driver.androidReallyDone = async () => true;
    `;
    const found = [...implementedMethods(src)];
    expect(found).toContain('androidReallyDone');
    expect(found).not.toContain('androidNotDoneYet');
  });

  test('a method named in a STRING is not an implementation', () => {
    const src = "const msg = 'driver.androidFake = ...'; driver.androidReal = async () => 1;";
    const found = [...implementedMethods(src)];
    expect(found).toContain('androidReal');
    expect(found).not.toContain('androidFake');
  });

  test('an unparseable driver is reported, never silently treated as complete', () => {
    expect(() => implementedMethods('driver. = = =')).toThrow(/could not parse/);
  });
});

describe('finding the runner’s dispatch sites', () => {
  const reached = reachedMethods();

  test('it finds methods called through ctx.uiDriver / ctx.webDriver', () => {
    expect(reached.size).toBeGreaterThan(50);
    expect(reached).toContain('androidUiDump');
  });

  test('it finds methods selected as literals for per-platform dispatch', () => {
    // The runner picks a method name by platform, then applies it as
    // driver[methodName]. A member-access-only scan would miss every one.
    expect(reached).toContain('webAdminShowsStat');
  });
});

describe('scanning the real drivers', () => {
  const report = scanDrivers();

  test('it scans real drivers and counts the work', () => {
    // A zero from an empty scan is the failure mode this gate exists to
    // prevent, so the count is asserted rather than assumed.
    expect(report.driversScanned).toBeGreaterThan(5);
    expect(report.noDriversFound).toBe(false);
    expect(report.drivers.every((d) => d.declared > 0)).toBe(true);
  });

  test('methods with real implementations are not reported as stubs', () => {
    const android = report.drivers.find((d) => d.driver === 'android-adb-driver.js');
    expect(android).toBeDefined();
    // Implemented in this session and demonstrably driving a real device.
    expect(android.stubs).not.toContain('androidIsFlavorInstalled');
    expect(android.stubs).not.toContain('androidLaunchFlavorFirstRun');
    expect(android.stubs).not.toContain('androidUiDump');
  });

  test('the dispatchable subset is a subset of the total', () => {
    expect(report.reachedStubs).toBeLessThanOrEqual(report.totalStubs);
    for (const d of report.drivers) {
      expect(d.reachedStubs.length).toBeLessThanOrEqual(d.stubs.length);
      for (const m of d.reachedStubs) expect(d.stubs).toContain(m);
    }
  });
});

describe('the ratchet', () => {
  test('more dispatchable stubs than the baseline fails', () => {
    expect(verdict({ reachedStubs: 5, noDriversFound: false }, { reachedStubs: 4 })).toBe(1);
  });

  test('fewer passes', () => {
    expect(verdict({ reachedStubs: 3, noDriversFound: false }, { reachedStubs: 4 })).toBe(0);
  });

  test('no drivers found fails even at zero stubs', () => {
    expect(verdict({ reachedStubs: 0, noDriversFound: true }, { reachedStubs: 4 })).toBe(1);
  });
});

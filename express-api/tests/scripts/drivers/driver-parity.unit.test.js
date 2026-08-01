/**
 * THE RATCHET: every app method exists on BOTH phones.
 *
 * This is the guard on the defect that made the whole journey corpus
 * Android-only. The Android driver had grown to 138 methods while the real iOS
 * driver had 61, so a scenario written "on the app" would run on the iPhone and
 * quietly fail every assertion — and the corpus, quite reasonably, said "on
 * Android" instead. 29% of the app's behaviour was never exercised on iOS.
 *
 * The gap did not open in one commit. It opened one method at a time, each of
 * which was individually reasonable, and nothing failed when it did. That is the
 * DOOR this closes: adding an Android-only method is now a failing test, so the
 * asymmetry cannot accumulate again.
 *
 * WHY STATIC ANALYSIS. Constructing the real iOS driver needs `WDA_TEAM_ID` and
 * a paired iPhone, so a runtime comparison would silently skip in CI — which is
 * precisely where the ratchet has to bite. The measurement is taken at the
 * DEFINITION SITE (`driver.androidX =` / `driver.iosX =` in the source, plus the
 * shared registration both drivers perform unconditionally), so it is exact and
 * needs no hardware.
 */
const fs = require('fs');
const path = require('path');

const { SHARED_METHOD_NAMES } = require('../../../scripts/drivers/app-ui-methods');

const DRIVERS = path.join(__dirname, '../../../scripts/drivers');
const read = (f) => fs.readFileSync(path.join(DRIVERS, f), 'utf8');

/**
 * Method names assigned onto the driver in this file, unprefixed.
 *
 * Anchored on the assignment form `driver.<prefix><Name> =` rather than a
 * substring search: a mention in a comment, a call site, or a string is not a
 * definition, and counting those would report methods that do not exist.
 */
function definedIn(source, prefix) {
  const rx = new RegExp(`\\bdriver\\.${prefix}([A-Z][A-Za-z0-9_]*)\\s*=(?!=)`, 'g');
  return new Set([...source.matchAll(rx)].map((m) => m[1]));
}

const androidSource = read('android-adb-driver.js');
const iosSource = read('ios-appium-driver.js');

// Both drivers register the shared layer unconditionally at the end of their
// factory, so those names exist on both regardless of what either file spells
// out by hand.
const shared = new Set(SHARED_METHOD_NAMES);
const androidMethods = new Set([...definedIn(androidSource, 'android'), ...shared]);
const iosMethods = new Set([...definedIn(iosSource, 'ios'), ...shared]);

/**
 * Names that are legitimately one-platform-only.
 *
 * SHRINK-ONLY. An entry may be removed when the gap is genuinely closed; adding
 * one is how the debt regrows, so a new entry needs a reason that survives being
 * read aloud. "It is hard on iOS" is not one — that is what the refusal path in
 * `app-ui-methods.js` is for.
 */
const ANDROID_ONLY_ALLOWED = new Set([
  // The adb transport itself, not a corpus method. iOS has no analogue and
  // needs none: Appium's HTTP session is its transport.
  'Adb',
]);

const IOS_ONLY_ALLOWED = new Set([
  // Appium session plumbing with no Android counterpart. adb needs no session:
  // it launches with `am start` (androidKillAndRelaunch), presses with `input
  // swipe`, and drops the network with `svc wifi disable`. These three are the
  // Appium-side mechanics of those same capabilities, not extra behaviour.
  'LaunchApp',
  'LongPress',
  'NetworkLinkConditioner',
]);

describe('the two app drivers expose the same surface', () => {
  test('no Android method is missing from iOS', () => {
    const missing = [...androidMethods]
      .filter((m) => !iosMethods.has(m) && !ANDROID_ONLY_ALLOWED.has(m))
      .sort();
    expect(missing).toEqual([]);
  });

  test('no iOS method is missing from Android', () => {
    // Symmetric on purpose. The gap ran one way this time; there is no reason
    // the next one will.
    const missing = [...iosMethods]
      .filter((m) => !androidMethods.has(m) && !IOS_ONLY_ALLOWED.has(m))
      .sort();
    expect(missing).toEqual([]);
  });

  test('the allowlists only hold names that are still one-platform-only', () => {
    // A name that has since landed on both must be REMOVED from the list. Left
    // in, it would silently permit that method to be deleted from one platform
    // again — the ratchet would stop guarding the very thing it was added for.
    const staleAndroid = [...ANDROID_ONLY_ALLOWED].filter((m) => iosMethods.has(m));
    const staleIos = [...IOS_ONLY_ALLOWED].filter((m) => androidMethods.has(m));
    expect({ staleAndroid, staleIos }).toEqual({ staleAndroid: [], staleIos: [] });
  });

  test('the allowlists may only SHRINK', () => {
    // Pinned counts. Raising either is a deliberate act that has to be argued
    // for in a diff, which is the entire mechanism — the gap grew because
    // nothing ever objected.
    expect(ANDROID_ONLY_ALLOWED.size).toBeLessThanOrEqual(1);
    expect(IOS_ONLY_ALLOWED.size).toBeLessThanOrEqual(3);
  });
});

describe('the measurement itself', () => {
  test('definitions are counted, not mentions', () => {
    // The trap this avoids: `includes('androidTapByTag')` is true for a comment,
    // a call site, and a string. Only an assignment defines a method.
    const source = `
      // androidNeverDefined is discussed here
      driver.androidReallyDefined = async () => true;
      await driver.androidCalledNotDefined();
      const s = 'androidInAString';
      if (driver.androidComparedTo === undefined) {}
    `;
    expect([...definedIn(source, 'android')].sort()).toEqual(['ReallyDefined']);
  });

  test('both drivers are actually being read — a typo in a path would empty them', () => {
    // Without this, a bad filename makes both sets empty and every parity
    // assertion above passes vacuously. An absence reported as success is the
    // failure mode this whole file exists to prevent.
    expect(androidMethods.size).toBeGreaterThan(100);
    expect(iosMethods.size).toBeGreaterThan(100);
    expect(shared.size).toBeGreaterThan(50);
  });

  test('the shared layer really is registered by both drivers', () => {
    // The parity above leans on this: shared names are credited to BOTH sets, so
    // if a driver stopped registering them the ratchet would be measuring a
    // promise instead of the code.
    for (const source of [androidSource, iosSource]) {
      expect(source).toContain('createSharedAppMethods(');
      expect(source).toMatch(/Object\.entries\(sharedMethods\)/);
    }
  });
});

/**
 * A cell may only attach a driver for the device IT owns.
 *
 * Operator 2026-08-01: "i still don't ever see the iphone doing anything. the
 * app is open but doesn't seem to move at all" — and earlier, that the Android
 * device was "thrashing on the persona picker, closing the app, and repeating".
 * Both were the same bug.
 *
 * `--driver=all` attached an Android driver to EVERY cell, so all 12 cells drove
 * the one phone. Meanwhile matrix-dispatch groups cells by browser slug
 * (chromium -> mac, mobile-safari-ios -> iphone, mobile-chrome-android ->
 * android) and runs those groups CONCURRENTLY, on the assumption that they
 * contend for different hardware. That assumption was false.
 *
 * Measured consequence: two `adb shell uiautomator dump` processes deadlocked
 * on one phone (the dump needs an exclusive UiAutomation connection), parking
 * three cells at 58 scenarios for eight minutes. And because the iOS cell was
 * among the blocked, it never issued a command to Appium — whose log shows the
 * session dying on `New Command Timeout of 60 seconds expired`, one minute into
 * the run. The iPhone sat with the app open and nothing driving it.
 *
 * This pins the affinity itself. device-lock.unit.test.js pins the safety net
 * for when something finds a new way to break the rule.
 */
const { defaultResourceKey } = require('../../scripts/matrix-dispatch');

// Mirrors the runner's attachment predicate at manual-qa-runner.js. Kept
// deliberately as one expression so a change there without a change here is a
// visible divergence rather than a silent one.
const affinity = (browser) => {
  const cellDevice = browser ? defaultResourceKey(browser) : null;
  return {
    android: cellDevice === null || cellDevice === 'android',
    ios: cellDevice === null || cellDevice === 'iphone',
  };
};

describe('desktop cells own no device', () => {
  for (const slug of ['chromium', 'firefox', 'webkit', 'edge']) {
    it(`${slug} attaches NEITHER an Android nor an iOS driver`, () => {
      // This is the fix. Before it, all four of these drove the phone.
      expect(affinity(slug)).toEqual({ android: false, ios: false });
    });
  }
});

describe('device cells own exactly one device', () => {
  for (const slug of [
    'mobile-chrome-android',
    'mobile-samsung-android',
    'mobile-edge-android',
    'mobile-firefox-android',
  ]) {
    it(`${slug} attaches Android only`, () => {
      expect(affinity(slug)).toEqual({ android: true, ios: false });
    });
  }

  for (const slug of [
    'mobile-safari-ios',
    'mobile-chrome-ios',
    'mobile-firefox-ios',
    'mobile-edge-ios',
  ]) {
    it(`${slug} attaches iOS only — never the Android phone that starved it`, () => {
      expect(affinity(slug)).toEqual({ android: false, ios: true });
    });
  }
});

describe('the whole local matrix', () => {
  const { TARGET_BROWSER_ALLOWLIST } = require('../../scripts/browser-allowlist');

  it('has exactly ONE cell able to drive Android at a time per resource group', () => {
    // The dispatcher serialises within a resource group, so "one group owns
    // Android" is what makes concurrency safe. Counting groups, not cells.
    const groups = new Set(
      TARGET_BROWSER_ALLOWLIST.local.filter((b) => affinity(b).android).map(defaultResourceKey),
    );
    expect([...groups]).toEqual(['android']);
  });

  it('has exactly ONE group able to drive the iPhone', () => {
    const groups = new Set(
      TARGET_BROWSER_ALLOWLIST.local.filter((b) => affinity(b).ios).map(defaultResourceKey),
    );
    expect([...groups]).toEqual(['iphone']);
  });

  it('never lets one cell claim BOTH physical devices', () => {
    // A cell holding both would serialise the two device groups against each
    // other through itself, re-creating the starvation by another route.
    for (const b of TARGET_BROWSER_ALLOWLIST.local) {
      const a = affinity(b);
      expect(a.android && a.ios).toBe(false);
    }
  });
});

describe('a manual single-cell run is unchanged', () => {
  it('attaches BOTH when no --browser is given', () => {
    // There is no matrix and therefore no contention; narrowing here would
    // break ad-hoc `node manual-qa-runner.js --driver=all` debugging.
    expect(affinity(undefined)).toEqual({ android: true, ios: true });
    expect(affinity('')).toEqual({ android: true, ios: true });
  });
});

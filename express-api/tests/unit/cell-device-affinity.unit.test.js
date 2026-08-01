/**
 * A cell may only attach a driver for the app IT is declared to drive.
 *
 * TWO ROUNDS OF THE SAME BUG, and this file pinned the first fix so tightly
 * that it enshrined the second bug as the contract.
 *
 * Round 1 (fixed 2026-08-01 morning). `--driver=all` attached an Android driver
 * to EVERY cell, so all 12 cells drove the one phone. Operator: "i still don't
 * ever see the iphone doing anything" / the Android device is "thrashing on the
 * persona picker, closing the app, and repeating". Two `uiautomator dump`
 * processes deadlocked on one phone; the blocked iOS cell never issued a command
 * to Appium, whose session died on the 60s New Command Timeout.
 *
 * Round 2 (fixed the same afternoon). The narrowing read the cell's device off
 * `defaultResourceKey`, which answers "which hardware does this cell contend
 * for?". `mobile-chrome-android` answers 'android' — correctly, since Chrome for
 * Android runs ON the phone over CDP-over-adb. So all four Android BROWSER cells
 * kept the app driver. Operator: "why is the browser cell carrying the android
 * app driver? that doesn't sound correct. maybe that's been the problem all this
 * time?" It was: 125 device-scenario runs needed, 500 performed.
 *
 * THIS FILE HELPED HIDE ROUND 2, in two distinct ways worth remembering:
 *
 *   1. It RE-IMPLEMENTED the runner's predicate locally ("Mirrors the runner's
 *      attachment predicate … kept deliberately as one expression"). A test that
 *      carries its own copy of production logic asserts on the copy — the exact
 *      failure `tests-must-not-reimplement-helpers.unit.test.js` exists to
 *      prevent, committed hours earlier and not applied here.
 *   2. It asserted `mobile-chrome-android → {android: true}` as DESIRED. The bug
 *      was written down as the expectation, so the fix reddened the test and the
 *      test looked right. When a fix reddens a test, check the TEST.
 *
 * Both are closed the same way: the predicate has ONE definition, in
 * scripts/matrix-cells.js, and this file imports it.
 */
const { drivesApp, isKnownCell, MATRIX_CELLS } = require('../../scripts/matrix-cells');

/**
 * The runner's attachment predicate, IMPORTED not restated.
 *
 * Mirrors manual-qa-runner.js exactly because it calls the same function: an
 * unknown slug (ad-hoc single-cell run, no matrix, no contention) attaches
 * everything; a known cell attaches only what it declares.
 */
const affinity = (cell) => {
  const known = isKnownCell(cell);
  return {
    android: !known || drivesApp(cell, 'android'),
    ios: !known || drivesApp(cell, 'ios'),
  };
};

describe('browser cells drive browsers — and nothing else', () => {
  for (const slug of ['chromium', 'firefox', 'webkit', 'edge']) {
    it(`${slug} attaches NEITHER app driver`, () => {
      expect(affinity(slug)).toEqual({ android: false, ios: false });
    });
  }

  for (const slug of [
    'mobile-chrome-android',
    'mobile-samsung-android',
    'mobile-edge-android',
    'mobile-firefox-android',
  ]) {
    it(`${slug} runs a browser ON the phone but does NOT launch the app`, () => {
      // Round 2, stated as the property that fixes it. This file previously
      // asserted `{android: true}` here — the bug, written down as the contract.
      expect(affinity(slug)).toEqual({ android: false, ios: false });
    });
  }

  for (const slug of [
    'mobile-safari-ios',
    'mobile-chrome-ios',
    'mobile-firefox-ios',
    'mobile-edge-ios',
  ]) {
    it(`${slug} runs a browser ON the iPhone but does NOT launch the app`, () => {
      expect(affinity(slug)).toEqual({ android: false, ios: false });
    });
  }
});

describe('app cells drive exactly one app', () => {
  it('app-android attaches Android only', () => {
    expect(affinity('app-android')).toEqual({ android: true, ios: false });
  });

  it('app-ios attaches iOS only — never the Android phone that starved it', () => {
    expect(affinity('app-ios')).toEqual({ android: false, ios: true });
  });
});

describe('cross-over cells hold one app plus a desktop browser', () => {
  it('cross-android attaches Android only', () => {
    expect(affinity('cross-android')).toEqual({ android: true, ios: false });
  });

  it('cross-ios attaches iOS only', () => {
    expect(affinity('cross-ios')).toEqual({ android: false, ios: true });
  });
});

describe('the whole local matrix', () => {
  const { CELL_SLUGS } = require('../../scripts/matrix-cells');

  it('every cell that attaches an app driver LOCKS that device', () => {
    // Asserted against `resourcesFor` (all of them), not `resourceKeyFor` (the
    // grouping key). A cell driving both phones has one grouping key and two
    // locks; checking the key alone would call that a violation.
    const { resourcesFor } = require('../../scripts/matrix-cells');
    for (const cell of CELL_SLUGS) {
      const a = affinity(cell);
      if (a.android) expect(resourcesFor(cell)).toContain('android');
      if (a.ios) expect(resourcesFor(cell)).toContain('iphone');
    }
  });

  it('only the tri-platform cell claims BOTH physical devices', () => {
    // Holding both was once forbidden outright, because an accidental
    // both-devices cell serialises the two device groups through itself. But 67
    // of the 228 corpus scenarios need Android AND iOS AND web in one journey,
    // and no cell could run a single one of them. `cross-all` is that cell —
    // deliberate, named, and the ONLY one, with the dispatcher locking both
    // resources so nothing else touches either phone while it runs.
    const bothDevices = CELL_SLUGS.filter((c) => affinity(c).android && affinity(c).ios);
    expect(bothDevices).toEqual(['cross-all']);
  });

  it('exactly three cells attach each app driver — app, cross, and cross-all', () => {
    // The count IS the fix. FOUR browser cells silently driving the phone was
    // the bug, and nobody was counting. It is three now, each deliberate: the
    // app-only cell, the one-device cross-over, and the tri-platform cell.
    expect(CELL_SLUGS.filter((c) => affinity(c).android)).toEqual([
      'app-android',
      'cross-android',
      'cross-all',
    ]);
    expect(CELL_SLUGS.filter((c) => affinity(c).ios)).toEqual([
      'app-ios',
      'cross-ios',
      'cross-all',
    ]);
  });

  it('cross-all drives both apps AND a desktop browser', () => {
    const { capsFor, browserFor } = require('../../scripts/matrix-cells');
    expect(affinity('cross-all')).toEqual({ android: true, ios: true });
    expect(capsFor('cross-all')).toEqual(['web', 'android', 'ios']);
    // A desktop browser, not a phone browser: the two phones are already
    // playing the two app actors, so the web actor needs its own machine.
    expect(browserFor('cross-all')).toBe('chromium');
  });

  it('the registry and the predicate cannot disagree', () => {
    // They are the same function. Asserted anyway, because the previous version
    // of this file proved that a locally-copied predicate silently diverges.
    for (const c of MATRIX_CELLS) {
      const a = affinity(c.cell);
      expect(a.android).toBe(c.appDevices.includes('android'));
      expect(a.ios).toBe(c.appDevices.includes('ios'));
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

  it('attaches BOTH for a slug that is not a matrix cell', () => {
    expect(affinity('some-ad-hoc-slug')).toEqual({ android: true, ios: true });
  });
});

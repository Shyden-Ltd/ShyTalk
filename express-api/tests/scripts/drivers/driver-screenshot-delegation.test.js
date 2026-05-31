/**
 * driver-screenshot-delegation.test.js
 *
 * Pins the C3 delegation contract: each of the 7 web/web-mobile
 * drivers must wire `driver.takeScreenshot` to the shared helper.
 *
 * Why a static check?
 *   driver-contract.test.js verifies `*_METHOD_NAMES` matches
 *   listMethods(), and driver-interface-pin.test.js pins the per-driver
 *   COUNT. Neither verifies that a name in the array corresponds to an
 *   actual `driver.<name> = ...` line in the factory body. A regression
 *   that drops the assignment but keeps the array intact would slip
 *   through both pins. This file closes that gap for takeScreenshot
 *   specifically — the runner's per-failure screenshot hook silently
 *   becomes a no-op without it.
 *
 * Why not an instance test?
 *   Building a real driver requires playwright/appium/adb mocks. A
 *   source-text grep is bounded, fast, and catches the exact
 *   regression the hook design depends on.
 *
 * Scope: only takeScreenshot. Generalizing to "every method in
 * *_METHOD_NAMES has a driver.<name> assignment" is a separate
 * framework gap and intentionally out of scope here.
 */

const fs = require('fs');
const path = require('path');

const DRIVERS_DIR = path.resolve(__dirname, '../../../scripts/drivers');

// The 7 drivers that integrate with the C3 hook. Native drivers
// (android-adb / ios-devicectl / ios-simctl / ios-appium) are NOT in
// this list because they don't render web UIs and the C3 hook only
// fires for ctx.webDriver. Adding them later would be a deliberate
// expansion of the hook contract.
const C3_INTEGRATED_DRIVERS = [
  'web-playwright-driver.js',
  'web-mobile-chrome-android-driver.js',
  'web-mobile-samsung-android-driver.js',
  'web-mobile-edge-android-driver.js',
  'web-mobile-firefox-android-driver.js',
  'web-mobile-safari-ios-driver.js',
  'web-mobile-webkit-ios-driver.js',
];

describe('driver-screenshot delegation (C3) — every web driver wires takeScreenshot', () => {
  for (const driverFile of C3_INTEGRATED_DRIVERS) {
    test(`${driverFile} assigns driver.takeScreenshot`, () => {
      const src = fs.readFileSync(path.join(DRIVERS_DIR, driverFile), 'utf8');
      // The literal `driver.takeScreenshot` assignment marker. The
      // regex is bounded (`{0,30}` between `driver.takeScreenshot` and
      // `=`) to allow `driver.takeScreenshot = async ...` shape, and
      // anchors to the assignment so a mere reference doesn't count.
      expect(src).toMatch(/driver\.takeScreenshot\s{0,30}=/);
    });

    test(`${driverFile} requires the screenshot helper`, () => {
      const src = fs.readFileSync(path.join(DRIVERS_DIR, driverFile), 'utf8');
      // The helper is the single source of truth for the file-naming
      // convention (`screenshot-<slug>-<persona>.png`). Drivers MUST
      // delegate to it rather than rolling their own — otherwise the
      // matrix-report parser can't reliably find artifacts by glob.
      expect(src).toMatch(/['"]\.\/driver-screenshot-helper['"]/);
    });

    test(`${driverFile} includes takeScreenshot in WEB_*_METHOD_NAMES`, () => {
      const src = fs.readFileSync(path.join(DRIVERS_DIR, driverFile), 'utf8');
      // Drift-catch: if a future PR removes 'takeScreenshot' from the
      // array but forgets to remove the assignment (or vice versa),
      // listMethods() would lie about the driver's real surface.
      expect(src).toMatch(/['"]takeScreenshot['"]/);
    });
  }
});

describe('driver-screenshot delegation (C3) — native drivers do NOT have takeScreenshot', () => {
  // Invariant: takeScreenshot is web-only (ctx.webDriver hook). If a
  // native driver adds it later, this test surfaces the divergence so
  // the hook contract gets reviewed deliberately (it would need to
  // also hook ctx.androidDriver / ctx.iosDriver).
  const NATIVE_DRIVERS = [
    'android-adb-driver.js',
    'ios-devicectl-driver.js',
    'ios-simctl-driver.js',
    'ios-appium-driver.js',
  ];

  for (const driverFile of NATIVE_DRIVERS) {
    test(`${driverFile} does NOT export takeScreenshot (web-hook only contract)`, () => {
      const src = fs.readFileSync(path.join(DRIVERS_DIR, driverFile), 'utf8');
      expect(src).not.toMatch(/['"]takeScreenshot['"]/);
      expect(src).not.toMatch(/driver\.takeScreenshot\s{0,30}=/);
    });
  }
});

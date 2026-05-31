/**
 * driver-interface-pin.test.js
 *
 * Snapshot pin for per-driver method counts (gap B2). Companion to
 * driver-contract.test.js (which enforces every driver exports
 * `listMethods()` + a `*_METHOD_NAMES` constant + `close()`).
 *
 * This file pins the EXPECTED method count per driver. A driver
 * gaining or losing methods MUST update the expected count
 * deliberately. An accidental drop surfaces as a red test BEFORE
 * the regression reaches main.
 *
 * Categories (see QA_FRAMEWORK_DRIVER_INTERFACE.md):
 *   - Web full-surface: web-playwright-driver
 *   - Native Android full-surface: android-adb-driver
 *   - Native iOS full-surface: ios-devicectl-driver, ios-simctl-driver
 *   - iOS bridge: ios-appium-driver
 *   - Web-mobile wrappers: web-mobile-*-driver (6 drivers × 2 methods)
 *
 * Maintenance:
 *   - ADD a new method to a driver: bump the EXPECTED_COUNT below.
 *   - REMOVE a method: bump down + verify nothing in the runner depends.
 *   - ADD a new driver file: add an entry to EXPECTED_COUNTS (the
 *     "all driver files are present" test surfaces this with a diff).
 *   - REMOVE a driver file: drop the EXPECTED_COUNTS entry.
 */

const fs = require('fs');
const path = require('path');

const DRIVERS_DIR = path.resolve(__dirname, '../../../scripts/drivers');

// EXPECTED method counts per driver. Updated 2026-05-31.
// Drift in EITHER direction surfaces a red test for deliberate review.
const EXPECTED_COUNTS = {
  'web-playwright-driver': 77,
  'android-adb-driver': 72,
  'ios-devicectl-driver': 66,
  'ios-simctl-driver': 66,
  'ios-appium-driver': 11,
  'web-mobile-chrome-android-driver': 2,
  'web-mobile-samsung-android-driver': 2,
  'web-mobile-edge-android-driver': 2,
  'web-mobile-firefox-android-driver': 2,
  'web-mobile-safari-ios-driver': 2,
  'web-mobile-webkit-ios-driver': 2,
};

/**
 * Extract method count from a driver file by counting `*_METHOD_NAMES`
 * array entries. Avoids requiring the driver module (which would pull
 * in playwright + adb + appium dependencies just to count names).
 *
 * Anchored to the `const SOMETHING_METHOD_NAMES = [` declaration so
 * a renamed constant or refactored export doesn't silently pass.
 */
function countMethodsByConstant(driverFile) {
  const text = fs.readFileSync(driverFile, 'utf8');
  // Find the *_METHOD_NAMES array declaration. Pattern matches either:
  //   const FOO_METHOD_NAMES = [ ... ]
  //   exports.FOO_METHOD_NAMES = [ ... ]
  // Allows whitespace between `const`/`exports.` and the identifier.
  // Prefix bound {0,200} is well beyond any realistic identifier so
  // a future weirdly-long prefix surfaces as a count mismatch, not
  // a confusing "regex didn't match" throw.
  const arrayMatch = text.match(
    /(?:const\s{1,5}|exports\.)\w{0,200}METHOD_NAMES\s{0,10}=\s{0,10}\[([\s\S]{0,20000}?)\]/,
  );
  if (!arrayMatch) {
    throw new Error(
      `No *_METHOD_NAMES array found in ${path.basename(driverFile)} — driver-contract.test.js should also fail`,
    );
  }
  const body = arrayMatch[1];
  // Count quoted string entries — single or double quotes, comma-separated.
  // Bounded {1,200} to avoid super-linear backtracking. Dedupe to
  // match the driver's listMethods() semantic. All drivers (after
  // this PR fixed the web-mobile-* asymmetry) use
  // [...new Set(NAMES)].sort() — so duplicates in the array don't
  // double-count. The helper mirrors that contract.
  const entries = body.match(/['"][\w-]{1,200}['"]/g) || [];
  return new Set(entries).size;
}

describe('driver-interface-pin — per-driver method count snapshot (B2)', () => {
  const driverFiles = fs
    .readdirSync(DRIVERS_DIR)
    .filter((f) => f.endsWith('-driver.js') && !f.endsWith('-loader.js'));

  test('all driver files are present in the EXPECTED_COUNTS map', () => {
    // Drift-catch: a new driver added to drivers/ MUST be added to
    // EXPECTED_COUNTS. Conversely, removing a driver MUST update the map.
    const driverNames = driverFiles.map((f) => f.replace(/\.js$/, ''));
    const expectedNames = Object.keys(EXPECTED_COUNTS);
    expect(driverNames.sort()).toEqual(expectedNames.sort());
  });

  for (const driverFile of driverFiles) {
    const driverName = driverFile.replace(/\.js$/, '');
    test(`${driverName} method count matches snapshot`, () => {
      const filePath = path.join(DRIVERS_DIR, driverFile);
      const actualCount = countMethodsByConstant(filePath);
      const expected = EXPECTED_COUNTS[driverName];
      expect(actualCount).toBe(expected);
    });
  }
});

// ── helper unit tests (EC1, EC2) ────────────────────────────────

describe('countMethodsByConstant — error paths', () => {
  const os = require('os');

  test('throws actionable error when *_METHOD_NAMES array is missing (EC1)', () => {
    // Future regex tightening that breaks against a real driver file
    // would manifest as this throw rather than a count mismatch.
    // Pin the throw + its actionable message so debugging is fast.
    const tmp = path.join(os.tmpdir(), `no-method-names-${process.pid}-${Date.now()}-driver.js`);
    fs.writeFileSync(
      tmp,
      `// driver file with no METHOD_NAMES declaration
       module.exports = { createX: async () => ({ close: async () => {} }) };
      `,
    );
    try {
      expect(() => countMethodsByConstant(tmp)).toThrow(/No \*_METHOD_NAMES array found/);
      expect(() => countMethodsByConstant(tmp)).toThrow(
        /driver-contract\.test\.js should also fail/,
      );
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  test('deduplicates repeated entries (matches new Set semantic, EC2)', () => {
    // The web-playwright array deliberately contains
    // `webPairedSessionShowsSameTotals` twice. listMethods() uses
    // `[...new Set(NAMES)].sort()` to dedup; the helper must mirror
    // that or the snapshot count would be off by one.
    const tmp = path.join(os.tmpdir(), `dup-method-names-${process.pid}-${Date.now()}-driver.js`);
    fs.writeFileSync(
      tmp,
      `const FOO_METHOD_NAMES = ['alpha', 'beta', 'alpha', 'gamma']; // 'alpha' twice → dedup count = 3
       module.exports = { FOO_METHOD_NAMES };
      `,
    );
    try {
      expect(countMethodsByConstant(tmp)).toBe(3);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});

describe('driver-interface-pin — categorical invariants', () => {
  test('web-mobile-*-driver count is uniform (all 6 wrappers have same surface)', () => {
    // Invariant: web-mobile wrappers should remain symmetric in
    // method count. Divergence implies one wrapper has a unique
    // method — surface up for deliberate review.
    const webMobileCounts = Object.entries(EXPECTED_COUNTS)
      .filter(([name]) => name.startsWith('web-mobile-'))
      .map(([, count]) => count);
    expect(webMobileCounts.length).toBeGreaterThan(0);
    const distinct = [...new Set(webMobileCounts)];
    expect(distinct).toHaveLength(1);
  });

  test('ios-devicectl-driver + ios-simctl-driver have matching counts', () => {
    // Invariant: these two drivers share the XCUITest harness, so
    // their method surface should stay symmetric. Drift here means
    // one platform got a feature the other didn't — likely a bug.
    expect(EXPECTED_COUNTS['ios-devicectl-driver']).toBe(EXPECTED_COUNTS['ios-simctl-driver']);
  });

  test('full-surface drivers (web-playwright, android-adb) have similar counts (within 20%)', () => {
    // Soft invariant — these two cover the FULL journey surface
    // for their platforms. If web-playwright has 77 methods and
    // android-adb has, say, 30, that's a documentation gap (some
    // web flows don't have Android equivalents). Within 20% is
    // reasonable: web and Android may diverge slightly on
    // platform-specific features (e.g. Web SubmitStarFeedback may
    // differ from Android equivalent).
    const web = EXPECTED_COUNTS['web-playwright-driver'];
    const android = EXPECTED_COUNTS['android-adb-driver'];
    const ratio = Math.min(web, android) / Math.max(web, android);
    expect(ratio).toBeGreaterThanOrEqual(0.8);
  });
});

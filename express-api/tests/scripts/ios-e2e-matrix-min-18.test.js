/**
 * iOS E2E matrix must not test below the deployment target (iOS 18.0).
 *
 * #850 lowered IPHONEOS_DEPLOYMENT_TARGET 26.0 → 18.0. An app with a
 * min-iOS-18.0 cannot install on a pre-18 simulator, so xcodebuild's
 * `test-without-building` fails with "Unable to find a destination matching
 * the provided destination specifier" on 16.4 / 17.5 (observed in the
 * ios-tests dispatch 26463655332, where Build iOS passed but the 16.4/17.5
 * E2E jobs failed with exit 70). The IOS_ALL matrix in ios-tests.yml must
 * therefore list only iOS versions >= 18.0.
 *
 * Pins the invariant so a future edit re-adding a pre-18 row — or a
 * deployment-target change that desyncs from the matrix — is caught here
 * rather than in a ~40-minute CI run.
 */

const fs = require('fs');
const path = require('path');

const WORKFLOW = path.join(__dirname, '../../../.github/workflows/ios-tests.yml');
const MIN_IOS_MAJOR = 18; // matches IPHONEOS_DEPLOYMENT_TARGET = 18.0

describe('iOS E2E matrix vs deployment target', () => {
  let yml;
  beforeAll(() => {
    yml = fs.readFileSync(WORKFLOW, 'utf8');
  });

  test('IOS_ALL lists only iOS versions >= 18.0 (the deployment-target floor)', () => {
    // Every `'ios-version': 'X.Y'` entry in the workflow.
    const versions = [...yml.matchAll(/'ios-version':\s*'(\d+)\.(\d+)'/g)].map((m) => ({
      raw: `${m[1]}.${m[2]}`,
      major: parseInt(m[1], 10),
    }));
    // The matrix must not be empty (catches a botched edit that drops all rows).
    expect(versions.length).toBeGreaterThan(0);
    const belowFloor = versions.filter((v) => v.major < MIN_IOS_MAJOR).map((v) => v.raw);
    expect(belowFloor).toEqual([]);
  });

  test('the specific pre-18 rows removed in the #850 follow-up are absent', () => {
    // Negative pins on the exact versions that broke after the target bump
    // (anchored on the `'ios-version':` key so the explanatory comment that
    // mentions "16.4 / 17.5" in prose does not trip the assertion).
    expect(yml).not.toMatch(/'ios-version':\s*'16\.4'/);
    expect(yml).not.toMatch(/'ios-version':\s*'17\.5'/);
  });
});

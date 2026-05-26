/**
 * iOS deployment target — pinned to 26.0.
 *
 * Operator directive 2026-05-25 ~21:24 BST: bump iOS deployment
 * target from 16.0 to 26.0 to match the Xcode 26.3 simulator
 * runtime CI runs against. Aggressive bump; cuts off pre-iOS-26
 * devices but enables modern Swift 6 concurrency features and
 * matches the actual runtime the app is tested on.
 *
 * Locations bumped (all 5):
 *   1. iosApp/Podfile — `platform :ios, '26.0'`
 *   2. iosApp/Podfile post_install — IPHONEOS_DEPLOYMENT_TARGET = '26.0'
 *      applied to every Pod target's build_configurations
 *   3. iosApp/iosApp.xcodeproj/project.pbxproj — 6 occurrences
 *      across Debug, Release, Debug-Local, Release-Local
 *      configurations on app + tests + UI tests targets
 *   4. iosApp/iosApp/iOSApp.swift line 124 comment — must
 *      reference iOS 26 (was "App's deployment target is iOS 16")
 *   5. iosApp/scripts/add-ui-test-target.rb — must use 26.0
 *      (was '15.0')
 *
 * This test pins ALL five so a future "consistency refactor" that
 * drops one of them leaves us with a mixed-deployment-target setup
 * (which can produce silent linker warnings about object-file
 * version mismatch — exactly the class of warning task #24 is
 * clearing).
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PODFILE = path.join(REPO_ROOT, 'iosApp/Podfile');
const PBXPROJ = path.join(REPO_ROOT, 'iosApp/iosApp.xcodeproj/project.pbxproj');
const IOSAPP_SWIFT = path.join(REPO_ROOT, 'iosApp/iosApp/iOSApp.swift');
const UI_TEST_SCRIPT = path.join(REPO_ROOT, 'iosApp/scripts/add-ui-test-target.rb');

describe('iOS deployment target = 26.0 (pinned across all configs)', () => {
  test("iosApp/Podfile sets platform :ios, '26.0'", () => {
    const src = fs.readFileSync(PODFILE, 'utf8');
    expect(src).toContain("platform :ios, '26.0'");
    // Negative: the legacy 16.0 platform must not survive in
    // any form (a forgotten comment or alt form would silently
    // keep some pod resolution scoped to 16).
    expect(src).not.toContain("platform :ios, '16.0'");
  });

  test('iosApp/Podfile post_install hook bumps IPHONEOS_DEPLOYMENT_TARGET to 26.0', () => {
    const src = fs.readFileSync(PODFILE, 'utf8');
    expect(src).toContain("'IPHONEOS_DEPLOYMENT_TARGET'] = '26.0'");
    expect(src).not.toContain("'IPHONEOS_DEPLOYMENT_TARGET'] = '16.0'");
  });

  test('iosApp.xcodeproj/project.pbxproj has zero `IPHONEOS_DEPLOYMENT_TARGET = 16.0` lines', () => {
    // The bump must reach every XCBuildConfiguration block —
    // missing one would create the object-file-version-mismatch
    // class of linker warning we just cleared.
    const src = fs.readFileSync(PBXPROJ, 'utf8');
    const lines16 = src.split('\n').filter((l) => l.includes('IPHONEOS_DEPLOYMENT_TARGET = 16.0;'));
    expect(lines16).toEqual([]);
  });

  test('iosApp.xcodeproj/project.pbxproj has zero `IPHONEOS_DEPLOYMENT_TARGET = 15.0` lines (R1 C-3 fix)', () => {
    // R1 review C-1+C-3: the iosAppUITests XCBuildConfiguration
    // blocks (committed by an earlier run of add-ui-test-target.rb
    // when the script's initial new_target arg was '15.0') had 2
    // surviving `15.0` lines that the original test missed. Now
    // pinned: any deployment target older than 26.0 in pbxproj is
    // a regression that re-introduces the object-file mismatch.
    const src = fs.readFileSync(PBXPROJ, 'utf8');
    const lines15 = src.split('\n').filter((l) => l.includes('IPHONEOS_DEPLOYMENT_TARGET = 15.0;'));
    expect(lines15).toEqual([]);
  });

  test('iosApp.xcodeproj/project.pbxproj has at least 8 `IPHONEOS_DEPLOYMENT_TARGET = 26.0` lines', () => {
    // 8 occurrences as of R1 fix (2026-05-25): app target (Debug,
    // Release, Debug-Local, Release-Local) + iosAppTests (Debug,
    // Release) + iosAppUITests (Debug, Release). The original PR
    // claimed 6 (missed the 2 UITests configs); R1 fix bumped those
    // 2 from 15.0 → 26.0 so the floor is now 8. The exact count
    // could grow with future targets; pin a lower-bound.
    const src = fs.readFileSync(PBXPROJ, 'utf8');
    const lines26 = src.split('\n').filter((l) => l.includes('IPHONEOS_DEPLOYMENT_TARGET = 26.0;'));
    expect(lines26.length).toBeGreaterThanOrEqual(8);
  });

  test('iosApp/iosApp/iOSApp.swift comment references iOS 26 (not iOS 16)', () => {
    const src = fs.readFileSync(IOSAPP_SWIFT, 'utf8');
    // The pre-bump comment said "App's deployment target is iOS 16".
    // Don't pin the exact wording — only assert "iOS 16" no longer
    // appears AND "iOS 26" (or a more current variant) is present.
    expect(src).not.toContain("App's deployment target is iOS 16");
    expect(src).toContain('iOS 26');
  });

  test("iosApp/scripts/add-ui-test-target.rb uses IPHONEOS_DEPLOYMENT_TARGET = '26.0'", () => {
    const src = fs.readFileSync(UI_TEST_SCRIPT, 'utf8');
    expect(src).toContain("'IPHONEOS_DEPLOYMENT_TARGET'] = '26.0'");
    // Negative: the legacy '15.0' must not survive — the UI test
    // target script previously set 15.0 (older than even the app's
    // pre-bump 16.0). Inconsistency caught here.
    expect(src).not.toContain("'IPHONEOS_DEPLOYMENT_TARGET'] = '15.0'");
  });

  test('iosApp/scripts/add-ui-test-target.rb new_target call uses initial deployment target 26.0 (R1 C-2 fix)', () => {
    // R1 review C-2: line 49 passed '15.0' as the 4th positional
    // argument to `project.new_target(...)`. The xcodeproj gem
    // writes that value into each new XCBuildConfiguration's
    // settings BEFORE the override loop at line ~77 fires. On a
    // clean script run the override wins, but the initial '15.0'
    // value also persisted into the committed pbxproj (caught by
    // the new 15.0-zero-lines test above). Pin the new_target call
    // to '26.0' so even a script-run that skips the override leaves
    // a consistent deployment target.
    const src = fs.readFileSync(UI_TEST_SCRIPT, 'utf8');
    // Match the multi-line `project.new_target(... :ios, '26.0', ...)` form.
    // The `:ios,` line is followed by an optional comment-only line then
    // the deployment-target string. Anchor on `:ios,` to find the call
    // and assert the next non-comment line contains '26.0' (not '15.0').
    const lines = src.split('\n');
    const iosIdx = lines.findIndex((l) => l.trim() === ':ios,');
    expect(iosIdx).toBeGreaterThanOrEqual(0);
    // Walk forward, skipping comment-only lines (Ruby `# ...`), find the
    // first non-comment non-blank line — that's the deployment target.
    let targetLine = '';
    for (let j = iosIdx + 1; j < lines.length; j++) {
      const trimmed = lines[j].trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;
      targetLine = trimmed;
      break;
    }
    expect(targetLine).toBe("'26.0',");
  });
});

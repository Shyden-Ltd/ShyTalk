/**
 * iOS deployment target — pinned to 18.0.
 *
 * History: #840 (operator 2026-05-25) bumped 16.0 → 26.0 to silence an
 * "object built for newer iOS-simulator (17.2) than linked (16.0)" mismatch
 * warning and enable Swift 6. But min-iOS-26 cut off ~all users, so #850
 * (operator 2026-05-26) lowered it to 18.0 — which still clears that
 * mismatch (>= 17.2) and keeps Swift 6 (a language mode), while restoring a
 * 2024-era install base. The app still BUILDS against the iOS 26 SDK.
 *
 * Pins all 5 locations so a partial change is caught — which is exactly what
 * happened on #850's first pass: Podfile + pbxproj were lowered to 18.0 but
 * iOSApp.swift's comment and add-ui-test-target.rb were left at 26.0, leaving
 * the UI-test target generator on a stale 26.0 (object-file-version-mismatch
 * risk). This test now guards every location.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PODFILE = path.join(REPO_ROOT, 'iosApp/Podfile');
const PBXPROJ = path.join(REPO_ROOT, 'iosApp/iosApp.xcodeproj/project.pbxproj');
const IOSAPP_SWIFT = path.join(REPO_ROOT, 'iosApp/iosApp/iOSApp.swift');
const UI_TEST_SCRIPT = path.join(REPO_ROOT, 'iosApp/scripts/add-ui-test-target.rb');

describe('iOS deployment target = 18.0 (pinned across all configs)', () => {
  test("iosApp/Podfile sets platform :ios, '18.0'", () => {
    const src = fs.readFileSync(PODFILE, 'utf8');
    expect(src).toContain("platform :ios, '18.0'");
    expect(src).not.toContain("platform :ios, '16.0'");
    expect(src).not.toContain("platform :ios, '26.0'");
  });

  test('iosApp/Podfile post_install hook sets IPHONEOS_DEPLOYMENT_TARGET to 18.0', () => {
    const src = fs.readFileSync(PODFILE, 'utf8');
    expect(src).toContain("'IPHONEOS_DEPLOYMENT_TARGET'] = '18.0'");
    expect(src).not.toContain("'IPHONEOS_DEPLOYMENT_TARGET'] = '16.0'");
    expect(src).not.toContain("'IPHONEOS_DEPLOYMENT_TARGET'] = '26.0'");
  });

  test('project.pbxproj has no IPHONEOS_DEPLOYMENT_TARGET at 16.0 / 15.0 / 26.0', () => {
    // A surviving non-18.0 deployment target reintroduces the object-file
    // version-mismatch class of linker warning. (CreatedOnToolsVersion = 26.0
    // is Xcode-version metadata, not a deployment target, so it is not matched.)
    const src = fs.readFileSync(PBXPROJ, 'utf8');
    for (const bad of ['16.0', '15.0', '26.0']) {
      const lines = src
        .split('\n')
        .filter((l) => l.includes(`IPHONEOS_DEPLOYMENT_TARGET = ${bad};`));
      expect(lines).toEqual([]);
    }
  });

  test('project.pbxproj has at least 8 `IPHONEOS_DEPLOYMENT_TARGET = 18.0` lines', () => {
    // app target (Debug, Release, Debug-Local, Release-Local) + iosAppTests
    // (Debug, Release) + iosAppUITests (Debug, Release) = 8. Lower-bound pin.
    const src = fs.readFileSync(PBXPROJ, 'utf8');
    const lines18 = src.split('\n').filter((l) => l.includes('IPHONEOS_DEPLOYMENT_TARGET = 18.0;'));
    expect(lines18.length).toBeGreaterThanOrEqual(8);
  });

  test('iosApp/iosApp/iOSApp.swift deployment-target comment references iOS 18', () => {
    const src = fs.readFileSync(IOSAPP_SWIFT, 'utf8');
    expect(src).toContain('deployment target is iOS 18');
    expect(src).not.toContain('deployment target is iOS 16');
    expect(src).not.toContain('deployment target is iOS 26');
  });

  test("iosApp/scripts/add-ui-test-target.rb uses IPHONEOS_DEPLOYMENT_TARGET = '18.0'", () => {
    const src = fs.readFileSync(UI_TEST_SCRIPT, 'utf8');
    expect(src).toContain("'IPHONEOS_DEPLOYMENT_TARGET'] = '18.0'");
    expect(src).not.toContain("'IPHONEOS_DEPLOYMENT_TARGET'] = '26.0'");
    expect(src).not.toContain("'IPHONEOS_DEPLOYMENT_TARGET'] = '15.0'");
  });

  test('add-ui-test-target.rb new_target call uses initial deployment target 18.0', () => {
    // The 4th positional arg to project.new_target is written into each config
    // BEFORE the override loop fires; pin it so a skipped override can't leave
    // a stale value. Walk from the `:ios,` line past comment lines to the value.
    const src = fs.readFileSync(UI_TEST_SCRIPT, 'utf8');
    const lines = src.split('\n');
    const iosIdx = lines.findIndex((l) => l.trim() === ':ios,');
    expect(iosIdx).toBeGreaterThanOrEqual(0);
    let targetLine = '';
    for (let j = iosIdx + 1; j < lines.length; j++) {
      const trimmed = lines[j].trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;
      targetLine = trimmed;
      break;
    }
    expect(targetLine).toBe("'18.0',");
  });
});

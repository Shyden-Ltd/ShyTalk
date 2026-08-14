/**
 * Pins the iOS Debug-Dev Build Configuration file (SHY-0104).
 *
 * `Dev.xcconfig` is the project-level baseConfigurationReference for the
 * Debug-Dev XCBuildConfiguration — the sibling of the Android `dev` product
 * flavor. Debug-Dev runs against the PUBLIC dev backend (shytalk-dev +
 * dev-api) WITH the test-persona picker, so real-iPhone dev gauntlets run
 * without exposing the local emulator stack to the LAN.
 *
 * Its single functional job is to declare `DEV_QA_PERSONAS_PASSWORD` with an
 * EMPTY default — the real value is injected at build time from
 * `~/.shytalk/dev-personas.env` (never committed). An empty default makes a
 * build without the override fail CLOSED (picker hidden). The Release config
 * never defines the var, so the password literal is absent from any IPA.
 *
 * The `DEV_BACKEND` compile condition is stamped onto the Debug-Dev configs
 * by scripts/ios/add-dev-configuration.rb (pbxproj), NOT by this xcconfig —
 * pinned in ios-dev-configuration.test.js.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const XCCONFIG_PATH = path.join(REPO_ROOT, 'iosApp/Configurations/Dev.xcconfig');

describe('iosApp/Configurations/Dev.xcconfig', () => {
  let xcconfigText;

  beforeAll(() => {
    if (!fs.existsSync(XCCONFIG_PATH)) {
      throw new Error(`xcconfig not found at expected path: ${XCCONFIG_PATH}`);
    }
    xcconfigText = fs.readFileSync(XCCONFIG_PATH, 'utf8');
  });

  test('file exists at the expected path', () => {
    expect(fs.existsSync(XCCONFIG_PATH)).toBe(true);
  });

  // The security-critical line: the var is DECLARED (so Info.plist's
  // $(DEV_QA_PERSONAS_PASSWORD) resolves) but its committed value is EMPTY.
  // A non-empty value here would bake the shared credential into the repo.
  // `[ \t]` (NOT `\s`) keeps the match on one line — `\s` would span the
  // newline into the next variable and false-match.
  test('declares DEV_QA_PERSONAS_PASSWORD with an EMPTY default (no committed credential)', () => {
    expect(xcconfigText).toMatch(/^DEV_QA_PERSONAS_PASSWORD[ \t]*=[ \t]*$/m);
  });

  // The committed file must never carry a non-empty password — pin the
  // absence explicitly so a future "convenience" edit that hardcodes the
  // value fails loud. `[ \t]` (NOT `\s`) so the negative match can't leak
  // across the newline onto the following variable's value.
  test('does NOT assign any non-empty value to DEV_QA_PERSONAS_PASSWORD', () => {
    expect(xcconfigText).not.toMatch(/^DEV_QA_PERSONAS_PASSWORD[ \t]*=[ \t]*\S/m);
  });

  // The KMP/Compose framework phase can't infer debug-vs-release from the
  // custom CONFIGURATION name "Debug-Dev", so the build type is pinned here.
  // Debug-Dev is a debug build.
  test('declares KOTLIN_FRAMEWORK_BUILD_TYPE = debug', () => {
    expect(xcconfigText).toMatch(/^KOTLIN_FRAMEWORK_BUILD_TYPE\s*=\s*debug$/m);
  });

  // Exactly two variable declarations (DEV_QA_PERSONAS_PASSWORD +
  // KOTLIN_FRAMEWORK_BUILD_TYPE). A stray key (typo, copy-paste from
  // Local.xcconfig, an experimental setting) would silently land otherwise.
  test('contains exactly two variable declarations', () => {
    const varLines = xcconfigText.match(/^[A-Z_][A-Z0-9_]*\s*=/gm);
    expect(varLines).not.toBeNull();
    expect(varLines.length).toBe(2);
  });

  // Project-level base ref stays standalone: CocoaPods integration is at the
  // TARGET level (Pods-iosApp.debug-dev.xcconfig set by pod install), so this
  // file needs no #include. Catches a premature include copy-pasted in.
  test('contains no #include directives', () => {
    expect(xcconfigText).not.toMatch(/^#include/m);
  });

  // Defensive trip-wire: `${VAR}` (shell) is a silent no-op in Xcode build
  // settings — `$(VAR)` is required. No value line may use the shell form.
  test('no value line uses shell-style ${VAR} expansion', () => {
    const valueLines = xcconfigText.split('\n').filter((l) => /^[A-Z_][A-Z0-9_]*\s*=/.test(l));
    valueLines.forEach((line) => {
      expect(line).not.toMatch(/\$\{[A-Z_]/);
    });
  });

  test('ends with a single trailing newline', () => {
    expect(xcconfigText.endsWith('\n')).toBe(true);
    expect(xcconfigText.endsWith('\n\n')).toBe(false);
  });
});

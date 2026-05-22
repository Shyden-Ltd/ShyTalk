/**
 * iosApp.xcodeproj — Phase 3.3 test-target Local configurations
 *
 * Continuation of Phase 3.2 (PR #717) which added Debug-Local +
 * Release-Local on the PROJECT-level and iosApp-target lists.
 * Phase 3.3 (this PR) extends the same script to also populate:
 *   - iosAppTests target XCConfigurationList
 *   - iosAppUITests target XCConfigurationList
 *
 * Why test targets need Local configs: when iosApp is built with
 * Debug-Local, `xcodebuild test` against that scheme picks the
 * matching test-target configuration — without a Debug-Local
 * config on iosAppTests, Xcode falls back to the
 * defaultConfigurationName (Release), causing the tests to build
 * with different SWIFT_VERSION + entitlements than the app under
 * test. The TestFlight + CocoaPods stack also expects per-config
 * parity across all targets.
 *
 * Out of scope (deferred to later sub-PRs):
 *   - 3.4 — Pods-iosApp.{debug,release}-local.xcconfig generation
 *   - 3.5 — Local scheme + LiveKitBridge.isAllowedURL extension
 *
 * Implementation: same xcodeproj ruby script as 3.2, extended with
 * two more target loops. Self-heal migration branch continues to
 * apply (empty build_settings → cloned from sibling).
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PBXPROJ = path.join(REPO_ROOT, 'iosApp/iosApp.xcodeproj/project.pbxproj');
const ADD_SCRIPT = path.join(REPO_ROOT, 'scripts/ios/add-local-configurations.rb');

// UUIDs of the test-target XCConfigurationLists (verified from the
// committed pbxproj — see existing tests in ios-local-configurations
// .test.js's "test targets are NOT modified in Phase 3.2" assertion).
const IOSAPPTESTS_LIST_UUID = 'A10008002600000000000001';
const IOSAPPUITESTS_LIST_UUID = '08EFC4EBCF29E72CA6FC9F2A';

/**
 * Extract an XCConfigurationList block by its UUID. Line-anchored
 * with leading `\n` per the same fix applied to extractGroupBlock
 * in PR #717. The XCConfigurationList section is small enough that
 * substring-match risk is low, but consistency is cheap.
 */
function extractConfigurationList(pbxproj, uuid) {
  const sectionStart = pbxproj.indexOf('/* Begin XCConfigurationList section */');
  const sectionEnd = pbxproj.indexOf('/* End XCConfigurationList section */');
  if (sectionStart < 0 || sectionEnd < 0) {
    throw new Error('XCConfigurationList section markers not found.');
  }
  const section = pbxproj.slice(sectionStart, sectionEnd);
  const marker = `\n\t\t${uuid} `;
  const markerIdx = section.indexOf(marker);
  if (markerIdx < 0) {
    throw new Error(`XCConfigurationList ${uuid} not found.`);
  }
  const blockStart = markerIdx + 1;
  const blockEnd = section.indexOf('\n\t\t};', blockStart);
  return section.slice(blockStart, blockEnd + '\n\t\t};'.length);
}

/**
 * Find all XCBuildConfiguration blocks by name. Returns array of
 * { uuid, block }. Same helper used in PR #717 — duplicated here
 * to keep this test file self-contained.
 */
function findBuildConfigurationsByName(pbxproj, name) {
  const sectionStart = pbxproj.indexOf('/* Begin XCBuildConfiguration section */');
  const sectionEnd = pbxproj.indexOf('/* End XCBuildConfiguration section */');
  const section = pbxproj.slice(sectionStart, sectionEnd);
  const results = [];
  const blockRegex = /\t\t([0-9A-F]{24}) \/\* ([^*]+?) \*\/ = \{([\s\S]+?)\n\t\t\};/g;
  let m;
  while ((m = blockRegex.exec(section)) !== null) {
    const [, uuid, declaredName, body] = m;
    if (declaredName.trim() === name) {
      results.push({ uuid, block: body });
    }
  }
  return results;
}

describe('iosApp.xcodeproj — Phase 3.3 test-target Local configurations', () => {
  let pbxproj;

  beforeAll(() => {
    pbxproj = fs.readFileSync(PBXPROJ, 'utf8');
  });

  describe('XCConfigurationList membership', () => {
    test('iosAppTests target list now includes Debug-Local', () => {
      const block = extractConfigurationList(pbxproj, IOSAPPTESTS_LIST_UUID);
      expect(block).toMatch(/\* Debug-Local \*\/,/);
    });

    test('iosAppTests target list now includes Release-Local', () => {
      const block = extractConfigurationList(pbxproj, IOSAPPTESTS_LIST_UUID);
      expect(block).toMatch(/\* Release-Local \*\/,/);
    });

    test('iosAppUITests target list now includes Debug-Local', () => {
      const block = extractConfigurationList(pbxproj, IOSAPPUITESTS_LIST_UUID);
      expect(block).toMatch(/\* Debug-Local \*\/,/);
    });

    test('iosAppUITests target list now includes Release-Local', () => {
      const block = extractConfigurationList(pbxproj, IOSAPPUITESTS_LIST_UUID);
      expect(block).toMatch(/\* Release-Local \*\/,/);
    });

    test('iosAppTests defaultConfigurationName remains Release (not changed by 3.3)', () => {
      const block = extractConfigurationList(pbxproj, IOSAPPTESTS_LIST_UUID);
      expect(block).toContain('defaultConfigurationName = Release;');
    });

    test('iosAppUITests defaultConfigurationName remains Release (not changed by 3.3)', () => {
      const block = extractConfigurationList(pbxproj, IOSAPPUITESTS_LIST_UUID);
      expect(block).toContain('defaultConfigurationName = Release;');
    });
  });

  describe('Total count of Local configurations across all lists', () => {
    test('Debug-Local now appears as a name on 4 XCBuildConfigurations (was 2)', () => {
      // 2 from Phase 3.2 (project + iosApp target) + 2 new from
      // Phase 3.3 (iosAppTests + iosAppUITests targets).
      const matches = findBuildConfigurationsByName(pbxproj, 'Debug-Local');
      expect(matches).toHaveLength(4);
    });

    test('Release-Local now appears as a name on 4 XCBuildConfigurations (was 2)', () => {
      const matches = findBuildConfigurationsByName(pbxproj, 'Release-Local');
      expect(matches).toHaveLength(4);
    });
  });

  describe('Build settings inheritance (CocoaPods consistency)', () => {
    // Phase 3.2 review round 4 found that CocoaPods rejects
    // `pod install` if SWIFT_VERSION is inconsistent across configs
    // within the same target. Test-target configs need the same
    // SWIFT_VERSION as their Debug/Release siblings for the same
    // reason. The script's clone_settings_from_sibling helper
    // handles this.
    test('iosAppTests Debug-Local inherits SWIFT_VERSION from iosAppTests Debug', () => {
      const debugLocals = findBuildConfigurationsByName(pbxproj, 'Debug-Local');
      // 4 total — find the iosAppTests one. We identify it by the
      // presence of `BUNDLE_LOADER` or `TEST_HOST` in build_settings
      // — those are iosAppTests-specific.
      const iosAppTestsConfig = debugLocals.find(
        (m) => m.block.includes('BUNDLE_LOADER') || m.block.includes('TEST_HOST'),
      );
      expect(iosAppTestsConfig).toBeDefined();
      expect(iosAppTestsConfig.block).toContain('SWIFT_VERSION = 5.0;');
    });

    test('iosAppUITests Debug-Local inherits SWIFT_VERSION from iosAppUITests Debug', () => {
      const debugLocals = findBuildConfigurationsByName(pbxproj, 'Debug-Local');
      // iosAppUITests configs have `TEST_TARGET_NAME` set.
      const iosAppUITestsConfig = debugLocals.find((m) =>
        m.block.includes('TEST_TARGET_NAME'),
      );
      expect(iosAppUITestsConfig).toBeDefined();
      expect(iosAppUITestsConfig.block).toContain('SWIFT_VERSION = 5.0;');
    });
  });

  describe('Ruby script extension', () => {
    test('script references iosAppTests target', () => {
      const scriptText = fs.readFileSync(ADD_SCRIPT, 'utf8');
      expect(scriptText).toContain('iosAppTests');
    });

    test('script references iosAppUITests target', () => {
      const scriptText = fs.readFileSync(ADD_SCRIPT, 'utf8');
      expect(scriptText).toContain('iosAppUITests');
    });
  });
});

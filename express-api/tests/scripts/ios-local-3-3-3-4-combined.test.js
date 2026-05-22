/**
 * iosApp.xcodeproj + Podfile — Phase 3.3 (test-target configs) and
 * Phase 3.4 (CocoaPods integration) combined.
 *
 * Phase 3.3 alone failed CI: target-level Local configs without a
 * Pods xcconfig base ref can't resolve module dependencies
 * (FirebaseCore, GoogleSignIn, LiveKitClient). Phase 3.4's pod
 * install adds the base refs. The two sub-phases are inseparable
 * for the iOS-local build to be functional, hence one combined PR.
 *
 * Wiring:
 *   - Podfile declares `'Debug-Local' => :debug, 'Release-Local' =>
 *     :release` so CocoaPods generates Pods-iosApp.{debug,release}-
 *     local.xcconfig and sets baseConfigurationReference on the
 *     iosApp target's Local configs.
 *   - scripts/ios/add-local-configurations.rb's
 *     add_local_configs_to_target helper now also adds Local configs
 *     to iosAppTests and iosAppUITests targets. Test targets are NOT
 *     in the Podfile — they inherit module search paths from iosApp
 *     via TEST_HOST/BUNDLE_LOADER/TEST_TARGET_NAME, so no Pods
 *     xcconfig base ref is needed (or wired) on them.
 *
 * Coverage:
 *   - Phase 3.3: 4 test-target Local configs exist with SWIFT_VERSION
 *     inherited from each target's Debug/Release sibling
 *   - Phase 3.4: Podfile config mapping present; iosApp-target Local
 *     configs' baseConfigurationReference points at
 *     Pods-iosApp.{debug,release}-local.xcconfig
 *   - Negative: test-target Local configs have NO base ref (test
 *     targets are not in the Podfile)
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PBXPROJ = path.join(REPO_ROOT, 'iosApp/iosApp.xcodeproj/project.pbxproj');
const PODFILE = path.join(REPO_ROOT, 'iosApp/Podfile');

const IOSAPPTESTS_LIST_UUID = 'A10008002600000000000001';
const IOSAPPUITESTS_LIST_UUID = '08EFC4EBCF29E72CA6FC9F2A';

function extractConfigurationList(pbxproj, uuid) {
  const sectionStart = pbxproj.indexOf('/* Begin XCConfigurationList section */');
  const sectionEnd = pbxproj.indexOf('/* End XCConfigurationList section */');
  if (sectionStart < 0 || sectionEnd < 0) {
    throw new Error('XCConfigurationList section markers not found.');
  }
  const section = pbxproj.slice(sectionStart, sectionEnd);
  const marker = `\n\t\t${uuid} `;
  const markerIdx = section.indexOf(marker);
  if (markerIdx < 0) throw new Error(`XCConfigurationList ${uuid} not found.`);
  // Round 1 m-1: duplicate-UUID guard. Symmetric with the canonical
  // helper in ios-local-configurations.test.js. Throws if the same
  // UUID is declared more than once — silent first-match would be
  // a latent footgun on a future corrupted pbxproj.
  const secondIdx = section.indexOf(marker, markerIdx + 1);
  if (secondIdx >= 0) {
    throw new Error(`XCConfigurationList ${uuid} appears more than once.`);
  }
  const blockStart = markerIdx + 1;
  const blockEnd = section.indexOf('\n\t\t};', blockStart);
  return section.slice(blockStart, blockEnd + '\n\t\t};'.length);
}

function findBuildConfigurationsByName(pbxproj, name) {
  const sectionStart = pbxproj.indexOf('/* Begin XCBuildConfiguration section */');
  const sectionEnd = pbxproj.indexOf('/* End XCBuildConfiguration section */');
  // Round 1 I-3: section-marker guard. Without this, a corrupted
  // pbxproj that lacks the markers silently returns an empty array
  // — every dependent test then fails with `expect(config).toBeDefined()`
  // instead of the clearer "markers not found" diagnostic.
  if (sectionStart < 0 || sectionEnd < 0) {
    throw new Error('XCBuildConfiguration section markers not found.');
  }
  const section = pbxproj.slice(sectionStart, sectionEnd);
  const results = [];
  const blockRegex = /\t\t([0-9A-F]{24}) \/\* ([^*]+?) \*\/ = \{([\s\S]+?)\n\t\t\};/g;
  let m;
  while ((m = blockRegex.exec(section)) !== null) {
    const [, uuid, declaredName, body] = m;
    if (declaredName.trim() === name) results.push({ uuid, block: body });
  }
  return results;
}

describe('iosApp.xcodeproj — Phase 3.3 test-target Local configurations', () => {
  let pbxproj;

  beforeAll(() => {
    pbxproj = fs.readFileSync(PBXPROJ, 'utf8');
  });

  describe('XCConfigurationList membership', () => {
    test('iosAppTests target list includes Debug-Local + Release-Local', () => {
      const block = extractConfigurationList(pbxproj, IOSAPPTESTS_LIST_UUID);
      expect(block).toMatch(/\* Debug-Local \*\/,/);
      expect(block).toMatch(/\* Release-Local \*\/,/);
    });

    test('iosAppUITests target list includes Debug-Local + Release-Local', () => {
      const block = extractConfigurationList(pbxproj, IOSAPPUITESTS_LIST_UUID);
      expect(block).toMatch(/\* Debug-Local \*\/,/);
      expect(block).toMatch(/\* Release-Local \*\/,/);
    });

    test('iosAppTests defaultConfigurationName remains Release', () => {
      const block = extractConfigurationList(pbxproj, IOSAPPTESTS_LIST_UUID);
      expect(block).toContain('defaultConfigurationName = Release;');
    });

    test('iosAppUITests defaultConfigurationName remains Release', () => {
      const block = extractConfigurationList(pbxproj, IOSAPPUITESTS_LIST_UUID);
      expect(block).toContain('defaultConfigurationName = Release;');
    });
  });

  describe('SWIFT_VERSION inheritance (test targets)', () => {
    // Test-target Local configs are identified by their per-target
    // markers: iosAppTests has BUNDLE_LOADER/TEST_HOST; iosAppUITests
    // has TEST_TARGET_NAME. The other two Debug-Local entries are
    // project-level (Local.xcconfig base ref) and iosApp-target
    // (Pods-iosApp.debug-local.xcconfig base ref).
    test('iosAppTests Debug-Local inherits SWIFT_VERSION from Debug', () => {
      const matches = findBuildConfigurationsByName(pbxproj, 'Debug-Local');
      const config = matches.find(
        (m) => m.block.includes('BUNDLE_LOADER') || m.block.includes('TEST_HOST'),
      );
      expect(config).toBeDefined();
      expect(config.block).toContain('SWIFT_VERSION = 5.0;');
    });

    test('iosAppTests Release-Local inherits SWIFT_VERSION from Release', () => {
      const matches = findBuildConfigurationsByName(pbxproj, 'Release-Local');
      const config = matches.find(
        (m) => m.block.includes('BUNDLE_LOADER') || m.block.includes('TEST_HOST'),
      );
      expect(config).toBeDefined();
      expect(config.block).toContain('SWIFT_VERSION = 5.0;');
    });

    test('iosAppUITests Debug-Local inherits SWIFT_VERSION from Debug', () => {
      const matches = findBuildConfigurationsByName(pbxproj, 'Debug-Local');
      const config = matches.find((m) => m.block.includes('TEST_TARGET_NAME'));
      expect(config).toBeDefined();
      expect(config.block).toContain('SWIFT_VERSION = 5.0;');
    });

    test('iosAppUITests Release-Local inherits SWIFT_VERSION from Release', () => {
      const matches = findBuildConfigurationsByName(pbxproj, 'Release-Local');
      const config = matches.find((m) => m.block.includes('TEST_TARGET_NAME'));
      expect(config).toBeDefined();
      expect(config.block).toContain('SWIFT_VERSION = 5.0;');
    });
  });

  describe('Test targets have NO baseConfigurationReference (not in Podfile)', () => {
    // iosAppTests and iosAppUITests are not declared in the Podfile,
    // so pod install does NOT wire a Pods xcconfig as their base
    // ref. They inherit module search paths from iosApp via
    // TEST_HOST/BUNDLE_LOADER/TEST_TARGET_NAME at link time.
    test('iosAppTests Debug-Local has NO baseConfigurationReference', () => {
      const matches = findBuildConfigurationsByName(pbxproj, 'Debug-Local');
      const config = matches.find(
        (m) =>
          (m.block.includes('BUNDLE_LOADER') || m.block.includes('TEST_HOST')) &&
          !m.block.includes('baseConfigurationReference'),
      );
      expect(config).toBeDefined();
    });

    test('iosAppTests Release-Local has NO baseConfigurationReference', () => {
      const matches = findBuildConfigurationsByName(pbxproj, 'Release-Local');
      const config = matches.find(
        (m) =>
          (m.block.includes('BUNDLE_LOADER') || m.block.includes('TEST_HOST')) &&
          !m.block.includes('baseConfigurationReference'),
      );
      expect(config).toBeDefined();
    });

    test('iosAppUITests Debug-Local has NO baseConfigurationReference', () => {
      const matches = findBuildConfigurationsByName(pbxproj, 'Debug-Local');
      const config = matches.find(
        (m) =>
          m.block.includes('TEST_TARGET_NAME') && !m.block.includes('baseConfigurationReference'),
      );
      expect(config).toBeDefined();
    });

    test('iosAppUITests Release-Local has NO baseConfigurationReference', () => {
      const matches = findBuildConfigurationsByName(pbxproj, 'Release-Local');
      const config = matches.find(
        (m) =>
          m.block.includes('TEST_TARGET_NAME') && !m.block.includes('baseConfigurationReference'),
      );
      expect(config).toBeDefined();
    });
  });
});

describe('iosApp.xcodeproj — Phase 3.4 CocoaPods integration', () => {
  let pbxproj;
  let podfileText;

  beforeAll(() => {
    pbxproj = fs.readFileSync(PBXPROJ, 'utf8');
    podfileText = fs.readFileSync(PODFILE, 'utf8');
  });

  describe('Podfile config mapping', () => {
    test('Podfile maps Debug-Local to :debug', () => {
      // CocoaPods needs explicit mapping for non-standard config
      // names so it knows whether to generate debug-style or
      // release-style xcconfigs. Without this, pod install would
      // either skip the new configs or generate broken xcconfigs.
      expect(podfileText).toMatch(/'Debug-Local'\s*=>\s*:debug/);
    });

    test('Podfile maps Release-Local to :release', () => {
      expect(podfileText).toMatch(/'Release-Local'\s*=>\s*:release/);
    });

    test('Podfile declares the project path before the target block', () => {
      // The `project 'iosApp.xcodeproj', mapping...` declaration must
      // come BEFORE `target 'iosApp' do` so CocoaPods picks up the
      // config mapping when parsing the target.
      const projectIdx = podfileText.indexOf("project 'iosApp.xcodeproj'");
      const targetIdx = podfileText.indexOf("target 'iosApp' do");
      expect(projectIdx).toBeGreaterThanOrEqual(0);
      expect(targetIdx).toBeGreaterThan(projectIdx);
    });
  });

  describe('iosApp-target Pods xcconfig wiring', () => {
    test('iosApp Debug-Local baseConfigurationReference targets Pods-iosApp.debug-local.xcconfig', () => {
      const matches = findBuildConfigurationsByName(pbxproj, 'Debug-Local');
      const iosAppTarget = matches.find((m) =>
        m.block.includes('Pods-iosApp.debug-local.xcconfig'),
      );
      expect(iosAppTarget).toBeDefined();
      expect(iosAppTarget.block).toMatch(
        /baseConfigurationReference = [0-9A-F]{24} \/\* Pods-iosApp\.debug-local\.xcconfig \*\/;/,
      );
    });

    test('iosApp Release-Local baseConfigurationReference targets Pods-iosApp.release-local.xcconfig', () => {
      const matches = findBuildConfigurationsByName(pbxproj, 'Release-Local');
      const iosAppTarget = matches.find((m) =>
        m.block.includes('Pods-iosApp.release-local.xcconfig'),
      );
      expect(iosAppTarget).toBeDefined();
      expect(iosAppTarget.block).toMatch(
        /baseConfigurationReference = [0-9A-F]{24} \/\* Pods-iosApp\.release-local\.xcconfig \*\/;/,
      );
    });

    test('Pods-iosApp.debug-local.xcconfig appears as a PBXFileReference in pbxproj', () => {
      // pod install adds the file ref to the Pods project. The
      // iosApp.xcodeproj/project.pbxproj references it via the
      // baseConfigurationReference UUID, so the file ref entry
      // must be present.
      expect(pbxproj).toContain('Pods-iosApp.debug-local.xcconfig');
    });

    test('Pods-iosApp.release-local.xcconfig appears as a PBXFileReference in pbxproj', () => {
      expect(pbxproj).toContain('Pods-iosApp.release-local.xcconfig');
    });
  });
});

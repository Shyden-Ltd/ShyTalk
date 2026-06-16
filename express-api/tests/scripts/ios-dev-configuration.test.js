/**
 * iosApp.xcodeproj — SHY-0104 Debug-Dev build configuration.
 *
 * Adds a `Debug-Dev` XCBuildConfiguration (project + iosApp target) that
 * runs against the public dev backend (shytalk-dev + dev-api) WITH the
 * test-persona picker — the iOS sibling of the Android `dev` flavor. The
 * project-level config base-references Configurations/Dev.xcconfig; the
 * target-level config carries the `DEV_BACKEND` Swift compile condition
 * that selects iOSApp.swift's dev branch. The persona password reaches
 * Swift via the Info.plist `DevQaPersonasPassword` key.
 *
 * Implementation is via the xcodeproj ruby gem
 * (scripts/ios/add-dev-configuration.rb) — the only safe way to mutate
 * project.pbxproj programmatically. The script is idempotent. CocoaPods
 * config-type mapping ('Debug-Dev' => :debug in the Podfile) lets
 * `pod install` generate Pods-iosApp.debug-dev.xcconfig + wire the
 * target-level baseConfigurationReference.
 *
 * These tests pin the END STATE so a future PR (or a manual Xcode edit)
 * that drops the configuration fails loud. Grep-based assertions keep the
 * contract independent of pbxproj line-numbering drift.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PBXPROJ = path.join(REPO_ROOT, 'iosApp/iosApp.xcodeproj/project.pbxproj');
const ADD_SCRIPT = path.join(REPO_ROOT, 'scripts/ios/add-dev-configuration.rb');
const INFO_PLIST = path.join(REPO_ROOT, 'iosApp/iosApp/Info.plist');
const PODFILE = path.join(REPO_ROOT, 'iosApp/Podfile');

// XCConfigurationList UUIDs (stable in the committed pbxproj). Project +
// iosApp anchors match ios-local-configurations.test.js; the test-target
// anchors pin that Debug-Dev was added to ALL targets (the no-gaps fix).
const PROJECT_LIST_UUID = '058558B0273AAA2400C9D062';
const IOSAPP_TARGET_LIST_UUID = '058558B1273AAA2400C9D062';
const IOSTESTS_TARGET_LIST_UUID = 'A10008002600000000000001';
const IOSUITESTS_TARGET_LIST_UUID = '08EFC4EBCF29E72CA6FC9F2A';

function countMatches(text, regex) {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

function findBuildConfigurationsByName(pbxproj, name) {
  const sectionStart = pbxproj.indexOf('/* Begin XCBuildConfiguration section */');
  const sectionEnd = pbxproj.indexOf('/* End XCBuildConfiguration section */');
  if (sectionStart < 0 || sectionEnd < 0) {
    throw new Error('XCBuildConfiguration section markers not found.');
  }
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

function findFileReferenceUuid(pbxproj, fileName) {
  const sectionStart = pbxproj.indexOf('/* Begin PBXFileReference section */');
  const sectionEnd = pbxproj.indexOf('/* End PBXFileReference section */');
  if (sectionStart < 0 || sectionEnd < 0) {
    throw new Error('PBXFileReference section markers not found.');
  }
  const section = pbxproj.slice(sectionStart, sectionEnd);
  const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `\\t\\t([0-9A-F]{24}) /\\* ${escaped} \\*/ = \\{[^}]*path = ${escaped};`,
    'g',
  );
  const matches = [...section.matchAll(regex)];
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(`Multiple PBXFileReference declarations found for ${fileName}.`);
  }
  return matches[0][1];
}

function extractGroupBlock(pbxproj, uuid) {
  const sectionStart = pbxproj.indexOf('/* Begin PBXGroup section */');
  const sectionEnd = pbxproj.indexOf('/* End PBXGroup section */');
  if (sectionStart < 0 || sectionEnd < 0) {
    throw new Error('PBXGroup section markers not found.');
  }
  const section = pbxproj.slice(sectionStart, sectionEnd);
  const startMarker = `\n\t\t${uuid} `;
  const startIdx = section.indexOf(startMarker);
  if (startIdx < 0) {
    throw new Error(`PBXGroup ${uuid} not found.`);
  }
  const blockStart = startIdx + 1;
  const endIdx = section.indexOf('\n\t\t};', blockStart);
  return section.slice(blockStart, endIdx + '\n\t\t};'.length);
}

function extractConfigurationList(pbxproj, uuid) {
  const sectionStart = pbxproj.indexOf('/* Begin XCConfigurationList section */');
  const sectionEnd = pbxproj.indexOf('/* End XCConfigurationList section */');
  if (sectionStart < 0 || sectionEnd < 0) {
    throw new Error('XCConfigurationList section markers not found in pbxproj.');
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

describe('iosApp.xcodeproj — SHY-0104 Debug-Dev build configuration', () => {
  let pbxproj;

  beforeAll(() => {
    pbxproj = fs.readFileSync(PBXPROJ, 'utf8');
  });

  describe('XCBuildConfiguration entries', () => {
    // Project-level + all three targets (iosApp + iosAppTests + iosAppUITests)
    // = 4. EVERY target carries Debug-Dev so CocoaPods' "1 unique SWIFT_VERSION
    // per target" check passes (a managed target lacking the config makes
    // CocoaPods synthesise an empty one) and the scheme builds cleanly under
    // Debug-Dev — the no-gaps fix the Local build-out deferred.
    test('Debug-Dev appears as an XCBuildConfiguration name exactly 4 times (project + 3 targets)', () => {
      const count = countMatches(pbxproj, /\n\t{3}name = "Debug-Dev";/g);
      expect(count).toBe(4);
    });

    test('Dev.xcconfig appears (file ref + group membership + ≥1 base ref)', () => {
      const count = countMatches(pbxproj, / \/\* Dev\.xcconfig \*\//g);
      expect(count).toBeGreaterThanOrEqual(2);
    });

    // SHY-0104 adds ONLY Debug-Dev (no Release-Dev — distributable Release
    // already targets dev sans picker). Pin the absence so a copy-paste
    // from the Local build-out (which added a Release-Local) is caught.
    test('does NOT introduce a Release-Dev configuration', () => {
      expect(countMatches(pbxproj, /\n\t{3}name = "Release-Dev";/g)).toBe(0);
    });
  });

  describe('XCConfigurationList membership', () => {
    test('project-level list includes Debug-Dev', () => {
      const block = extractConfigurationList(pbxproj, PROJECT_LIST_UUID);
      expect(block).toMatch(/\* Debug-Dev \*\/,/);
    });

    test('iosApp target list includes Debug-Dev', () => {
      const block = extractConfigurationList(pbxproj, IOSAPP_TARGET_LIST_UUID);
      expect(block).toMatch(/\* Debug-Dev \*\/,/);
    });

    // The test targets MUST also carry Debug-Dev (the SWIFT_VERSION / no-gaps
    // fix). Asserted by direct list extraction, not just the count=4 proxy, so
    // a future edit that drops one target's membership fails loud.
    test('iosAppTests target list includes Debug-Dev', () => {
      const block = extractConfigurationList(pbxproj, IOSTESTS_TARGET_LIST_UUID);
      expect(block).toMatch(/\* Debug-Dev \*\/,/);
    });

    test('iosAppUITests target list includes Debug-Dev', () => {
      const block = extractConfigurationList(pbxproj, IOSUITESTS_TARGET_LIST_UUID);
      expect(block).toMatch(/\* Debug-Dev \*\/,/);
    });

    test('project-level defaultConfigurationName remains Release (unchanged)', () => {
      const block = extractConfigurationList(pbxproj, PROJECT_LIST_UUID);
      expect(block).toContain('defaultConfigurationName = Release;');
    });

    test('iosApp-target defaultConfigurationName remains Release (unchanged)', () => {
      const block = extractConfigurationList(pbxproj, IOSAPP_TARGET_LIST_UUID);
      expect(block).toContain('defaultConfigurationName = Release;');
    });
  });

  describe('Debug-Dev structural invariants', () => {
    test('project-level Debug-Dev baseConfigurationReference targets the Dev.xcconfig file ref UUID (not Local.xcconfig)', () => {
      const xcconfigUuid = findFileReferenceUuid(pbxproj, 'Dev.xcconfig');
      expect(xcconfigUuid).not.toBeNull();
      expect(xcconfigUuid).toMatch(/^[0-9A-F]{24}$/);

      const matches = findBuildConfigurationsByName(pbxproj, 'Debug-Dev');
      const projectLevel = matches.find((m) => m.block.includes('/* Dev.xcconfig */'));
      expect(projectLevel).toBeDefined();
      expect(projectLevel.block).toContain(
        `baseConfigurationReference = ${xcconfigUuid} /* Dev.xcconfig */;`,
      );
    });

    // The compile condition that flips iOSApp.swift onto its dev branch.
    // Set on the target-level config by the script — a cloned config's own
    // SWIFT_ACTIVE_COMPILATION_CONDITIONS would override an xcconfig value,
    // so the flag lives in the pbxproj, asserted here.
    test('iosApp-target Debug-Dev defines the DEV_BACKEND Swift compile condition', () => {
      const matches = findBuildConfigurationsByName(pbxproj, 'Debug-Dev');
      const iosAppTarget = matches.find((m) => m.block.includes('Pods-iosApp.debug-dev.xcconfig'));
      expect(iosAppTarget).toBeDefined();
      expect(iosAppTarget.block).toMatch(
        /SWIFT_ACTIVE_COMPILATION_CONDITIONS = "?[^;]*DEV_BACKEND/,
      );
    });

    // CocoaPods rejects `pod install` with "up to 1 unique SWIFT_VERSION
    // per target" if Debug-Dev has empty buildSettings — the script clones
    // the Debug sibling so SWIFT_VERSION (and other baselines) carry over.
    test('iosApp-target Debug-Dev inherits SWIFT_VERSION = "5.0" from Debug', () => {
      const matches = findBuildConfigurationsByName(pbxproj, 'Debug-Dev');
      const iosAppTarget = matches.find((m) => m.block.includes('Pods-iosApp.debug-dev.xcconfig'));
      expect(iosAppTarget).toBeDefined();
      expect(iosAppTarget.block).toContain('SWIFT_VERSION = 5.0;');
    });

    test('Dev.xcconfig PBXFileReference has lastKnownFileType = text.xcconfig', () => {
      const fileRefSection = pbxproj.slice(
        pbxproj.indexOf('/* Begin PBXFileReference section */'),
        pbxproj.indexOf('/* End PBXFileReference section */'),
      );
      const declRegex = /[0-9A-F]{24} \/\* Dev\.xcconfig \*\/ = \{([^}]+)\};/;
      const declMatch = fileRefSection.match(declRegex);
      expect(declMatch).not.toBeNull();
      expect(declMatch[1]).toContain('lastKnownFileType = text.xcconfig');
      expect(declMatch[1]).toContain('path = Dev.xcconfig');
    });

    test('Configurations PBXGroup contains Dev.xcconfig', () => {
      const groupSection = pbxproj.slice(
        pbxproj.indexOf('/* Begin PBXGroup section */'),
        pbxproj.indexOf('/* End PBXGroup section */'),
      );
      const headerMatch = groupSection.match(/\t\t([0-9A-F]{24}) \/\* Configurations \*\/ = \{/);
      expect(headerMatch).not.toBeNull();
      const block = extractGroupBlock(pbxproj, headerMatch[1]);
      expect(block).toContain('/* Dev.xcconfig */,');
    });
  });

  describe('Info.plist persona-password injection', () => {
    let plist;
    beforeAll(() => {
      plist = fs.readFileSync(INFO_PLIST, 'utf8');
    });

    // Swift reads Bundle.main.infoDictionary["DevQaPersonasPassword"]. The
    // value is the build setting $(DEV_QA_PERSONAS_PASSWORD): the real
    // password on Debug-Dev (command-line override), empty everywhere else
    // (the var is undefined → literal absent from Release/distributable IPAs).
    test('Info.plist exposes DevQaPersonasPassword = $(DEV_QA_PERSONAS_PASSWORD)', () => {
      expect(plist).toMatch(
        /<key>DevQaPersonasPassword<\/key>\s*<string>\$\(DEV_QA_PERSONAS_PASSWORD\)<\/string>/,
      );
    });

    // The key's value must be the build-setting reference, never a literal.
    test('Info.plist does NOT hardcode a literal persona password', () => {
      const m = plist.match(/<key>DevQaPersonasPassword<\/key>\s*<string>([^<]*)<\/string>/);
      expect(m).not.toBeNull();
      expect(m[1]).toBe('$(DEV_QA_PERSONAS_PASSWORD)');
    });
  });

  describe('Podfile CocoaPods config-type mapping', () => {
    let podfile;
    beforeAll(() => {
      podfile = fs.readFileSync(PODFILE, 'utf8');
    });

    // Without this, CocoaPods can't tell whether Debug-Dev is debug- or
    // release-style and refuses to generate Pods-iosApp.debug-dev.xcconfig.
    test("maps 'Debug-Dev' => :debug", () => {
      expect(podfile).toMatch(/'Debug-Dev'\s*=>\s*:debug/);
    });
  });

  describe('SHY-0104 Swift sources are compiled (target membership)', () => {
    // A file on disk is NOT compiled until it's in a target's Sources build
    // phase. The resolver + its tests would otherwise fail to compile
    // ("cannot find type 'AppBuildVariant' in scope"). xcodeproj writes a
    // PBXBuildFile comment "<file> in Sources" for each source membership.
    test('AppEnvironment.swift is a compiled source (iosApp target)', () => {
      expect(pbxproj).toMatch(/AppEnvironment\.swift in Sources/);
    });

    test('AppEnvironmentTests.swift is a compiled source (iosAppTests target)', () => {
      expect(pbxproj).toMatch(/AppEnvironmentTests\.swift in Sources/);
    });
  });

  describe('Ruby script (scripts/ios/add-dev-configuration.rb)', () => {
    test('script file exists', () => {
      expect(fs.existsSync(ADD_SCRIPT)).toBe(true);
    });

    test('script declares idempotency in a header comment', () => {
      const scriptText = fs.readFileSync(ADD_SCRIPT, 'utf8');
      expect(scriptText).toMatch(/idempotent/i);
    });

    test('script uses the xcodeproj gem (not raw text manipulation)', () => {
      const scriptText = fs.readFileSync(ADD_SCRIPT, 'utf8');
      expect(scriptText).toContain("require 'xcodeproj'");
    });

    test('script references Dev.xcconfig and the DEV_BACKEND condition', () => {
      const scriptText = fs.readFileSync(ADD_SCRIPT, 'utf8');
      expect(scriptText).toContain('Dev.xcconfig');
      expect(scriptText).toContain('DEV_BACKEND');
    });

    // STRUCTURAL idempotency: re-running the script on a project that already
    // has Debug-Dev must be a no-op (no double-add, no Release-Dev, stable
    // file-ref UUID). Skips gracefully where ruby+xcodeproj is unavailable
    // (Linux CI); runs on macOS where the gem is present (via CocoaPods).
    test('script is structurally idempotent — re-run preserves the configuration count', () => {
      const { execFileSync } = require('child_process');
      try {
        // eslint-disable-next-line sonarjs/no-os-command-from-path
        execFileSync('ruby', ['-rxcodeproj', '-e', 'true'], { stdio: 'pipe' });
      } catch (_e) {
        return; // ruby+xcodeproj missing — defer to a macOS runner.
      }

      const before = fs.readFileSync(PBXPROJ, 'utf8');
      const beforeCount = countMatches(before, /\n\t{3}name = "Debug-Dev";/g);
      const beforeUuid = findFileReferenceUuid(before, 'Dev.xcconfig');

      // eslint-disable-next-line sonarjs/no-os-command-from-path
      const stdout = execFileSync('ruby', [ADD_SCRIPT], { cwd: REPO_ROOT, encoding: 'utf8' });
      expect(stdout).toContain('PBXFileReference already present: Dev.xcconfig (no-op)');

      const after = fs.readFileSync(PBXPROJ, 'utf8');
      expect(countMatches(after, /\n\t{3}name = "Debug-Dev";/g)).toBe(beforeCount);
      expect(countMatches(after, /\n\t{3}name = "Release-Dev";/g)).toBe(0);
      expect(findFileReferenceUuid(after, 'Dev.xcconfig')).toBe(beforeUuid);
    });
  });
});

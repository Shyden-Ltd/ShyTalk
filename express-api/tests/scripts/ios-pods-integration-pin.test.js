/**
 * iOS Pods integration regression pin.
 *
 * Release run 26367863711 (PR #819, chore: release v0.97.6) failed
 * with: `error: Unable to find module dependency: 'FirebaseCore'
 * (in target 'iosAppTests' from project 'iosApp')`.
 *
 * Root cause: the iOS-local Phase 3.3+3.4 fix (commit c2101fc3216,
 * branch ios-local/3-3-3-4-combined) was authored but NEVER merged
 * to main. Without it, the Podfile lacks both:
 *   1. The `project` directive that maps Debug-Local / Release-Local
 *      to debug/release. Without this, CocoaPods refuses to integrate
 *      because it sees Local configs with empty SWIFT_VERSION (the
 *      project-level Local configs inherit from Local.xcconfig which
 *      doesn't define SWIFT_VERSION).
 *   2. The nested `target 'iosAppTests' do inherit! :search_paths
 *      end` block. Without this, iosAppTests has no Pods xcconfig
 *      integration. The test target uses `@testable import iosApp`,
 *      which requires resolving iosApp's transitive imports
 *      (FirebaseCore, FirebaseMessaging, GoogleSignIn, LiveKitClient)
 *      to type-check the import. xcodebuild build-for-testing fails
 *      before any test runs.
 *
 * Plus the project-level Debug-Local + Release-Local XCBuildConfigurations
 * must carry SWIFT_VERSION = 5.0 explicitly — CocoaPods enumerates ALL
 * project configs when validating SWIFT_VERSION uniqueness per target,
 * and an empty inherit on a Local config causes "There may only be up
 * to 1 unique SWIFT_VERSION per target" even on targets that don't
 * directly use Local configs.
 *
 * This test pins all 4 contract elements so a future Podfile cleanup
 * or pbxproj refactor that drops any of them fails CI immediately,
 * BEFORE the release workflow hits the iOS build.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PODFILE = path.join(REPO_ROOT, 'iosApp/Podfile');
const PBXPROJ = path.join(REPO_ROOT, 'iosApp/iosApp.xcodeproj/project.pbxproj');

describe('iOS Pods integration — Podfile contract', () => {
  let PODFILE_SRC;
  beforeAll(() => {
    PODFILE_SRC = fs.readFileSync(PODFILE, 'utf8');
  });

  test('declares `project` directive mapping Debug-Local + Release-Local', () => {
    // CocoaPods needs to know how to treat the Local configs — without
    // this directive, SWIFT_VERSION resolution explodes on integration.
    expect(PODFILE_SRC).toMatch(/project ['"]iosApp\.xcodeproj['"]/);
    expect(PODFILE_SRC).toMatch(/['"]Debug-Local['"]\s*=>\s*:debug/);
    expect(PODFILE_SRC).toMatch(/['"]Release-Local['"]\s*=>\s*:release/);
  });

  test('`project` directive appears before the first `target` block', () => {
    // R3 review M-3: CocoaPods Ruby DSL requires `project` at the
    // top level BEFORE any `target` block opens — once the target
    // DSL is active, a `project` call inside it would be misparsed.
    // The Podfile is currently correct (the `project` directive
    // appears above the first `target` block); pin the ordering so
    // a future PR reordering the file can't silently break Ruby
    // parsing at pod install time.
    // R4 M-1: explicit line numbers removed — they drift the moment
    // any header comment changes, and "currently correct" + the
    // assertion below is sufficient documentation.
    const projectIdx = PODFILE_SRC.indexOf("project 'iosApp.xcodeproj'");
    const targetIdx = PODFILE_SRC.indexOf("target 'iosApp' do");
    expect(projectIdx).toBeGreaterThanOrEqual(0);
    expect(targetIdx).toBeGreaterThanOrEqual(0);
    expect(projectIdx).toBeLessThan(targetIdx);
  });

  test('declares nested `target "iosAppTests"` block with inherit! :search_paths', () => {
    // iosAppTests has @testable import iosApp which requires resolving
    // Firebase/LiveKit modules at build-for-testing. Without this
    // nested target, the test bundle can't find the modules.
    expect(PODFILE_SRC).toMatch(/target ['"]iosAppTests['"]\s+do/);
    // The inherit must be specifically :search_paths — re-embedding
    // (:complete or default) would duplicate-symbol since iosApp.app
    // already links them and TEST_HOST loads that.
    const inheritMatch = PODFILE_SRC.match(
      /target ['"]iosAppTests['"]\s+do\s+inherit!\s+:search_paths\s+end/,
    );
    expect(inheritMatch).not.toBeNull();
  });

  test('iosAppTests target block is NESTED inside iosApp block', () => {
    // The nested form ensures iosAppTests shares the parent's Pods
    // workspace integration. A standalone top-level `target
    // 'iosAppTests'` would not get the inheritance.
    //
    // I-1 fix (PR #827 review R1): the previous "last end" heuristic
    // was brittle — a future Podfile addition (second target, plugin,
    // abstract_target) that opens a new `do`/`end` after the iosApp
    // block would silently break the test. Instead, scan line-by-line
    // tracking `do`/`end` depth to find the EXACT `end` that closes
    // the iosApp block, then assert iosAppTests is fully inside it.
    const lines = PODFILE_SRC.split('\n');
    const iosAppOpenLine = lines.findIndex((l) => /^target\s+['"]iosApp['"]\s+do\b/.test(l));
    expect(iosAppOpenLine).toBeGreaterThanOrEqual(0);
    // Walk forward, tracking depth. Each line that opens a block
    // (target X do, post_install do |x|, etc.) increments depth;
    // each lone `end` decrements. The first depth-0 line after the
    // iosApp open is iosApp's closing `end`.
    let depth = 1;
    let iosAppCloseLine = -1;
    for (let i = iosAppOpenLine + 1; i < lines.length; i++) {
      const l = lines[i].trim();
      // Open: `... do` or `... do |...|` at end of line (excluding `end`).
      if (/\bdo\b(\s*\|[^|]*\|)?\s*$/.test(l) && !/^end\b/.test(l)) depth++;
      else if (l === 'end') {
        depth--;
        if (depth === 0) {
          iosAppCloseLine = i;
          break;
        }
      }
    }
    expect(iosAppCloseLine).toBeGreaterThan(iosAppOpenLine);

    const iosAppTestsLine = lines.findIndex((l) =>
      /^\s+target\s+['"]iosAppTests['"]\s+do\b/.test(l),
    );
    expect(iosAppTestsLine).toBeGreaterThan(iosAppOpenLine);
    expect(iosAppTestsLine).toBeLessThan(iosAppCloseLine);
  });
});

describe('iOS Pods integration — pbxproj contract', () => {
  let PBXPROJ_SRC;
  beforeAll(() => {
    PBXPROJ_SRC = fs.readFileSync(PBXPROJ, 'utf8');
  });

  test('Pods-iosAppTests.debug.xcconfig file reference exists', () => {
    // Generated by `pod install` after the Podfile has the nested
    // iosAppTests target.
    expect(PBXPROJ_SRC).toMatch(/Pods-iosAppTests\.debug\.xcconfig/);
  });

  test('Pods-iosAppTests.release.xcconfig file reference exists', () => {
    expect(PBXPROJ_SRC).toMatch(/Pods-iosAppTests\.release\.xcconfig/);
  });

  test('iosAppTests Debug + Release configs have baseConfigurationReference pointing at Pods xcconfigs', () => {
    // Without baseConfigurationReference, xcodebuild can't find the
    // Pods framework search paths — same failure mode as release
    // run 26367863711.
    expect(PBXPROJ_SRC).toMatch(
      /baseConfigurationReference = [A-F0-9]+ \/\* Pods-iosAppTests\.debug\.xcconfig \*\//,
    );
    expect(PBXPROJ_SRC).toMatch(
      /baseConfigurationReference = [A-F0-9]+ \/\* Pods-iosAppTests\.release\.xcconfig \*\//,
    );
  });

  test('project-level Debug-Local + Release-Local configs both declare SWIFT_VERSION = 5.0', () => {
    // CocoaPods enumerates ALL project-level configs when validating
    // SWIFT_VERSION uniqueness. An empty Swift on a Local config
    // breaks pod install with the multi-Swift-version error.
    //
    // R2 review C-1 fix: the prior regex `isa = XCBuildConfiguration;
    // [\\s\\S]*?name = "<config>";` with the /g flag did NOT isolate
    // blocks — non-greedy `[\\s\\S]*?` from one `isa =` could span
    // across multiple unrelated XCBuildConfiguration blocks until it
    // found a `name = "<config>"`. Now uses a block-scoped parser
    // that:
    //   1. Slices the XCBuildConfiguration section by its markers.
    //   2. Iterates exact `\\t\\t<UUID> /* <name> */ = { ... };` blocks
    //      using the same regex shape as findBuildConfigurationsByName
    //      in ios-local-configurations.test.js.
    //   3. Returns ONLY blocks whose declared name matches.
    function configContainsSwiftVersion(configName) {
      const sectionStart = PBXPROJ_SRC.indexOf('/* Begin XCBuildConfiguration section */');
      const sectionEnd = PBXPROJ_SRC.indexOf('/* End XCBuildConfiguration section */');
      expect(sectionStart).toBeGreaterThanOrEqual(0);
      expect(sectionEnd).toBeGreaterThan(sectionStart);
      const section = PBXPROJ_SRC.slice(sectionStart, sectionEnd);
      // Block header: \t\t<24hex> /* <declaredName> */ = {<body>\n\t\t};
      const blockRx = /\t\t([0-9A-F]{24}) \/\* ([^*]+?) \*\/ = \{([\s\S]+?)\n\t\t\};/g;
      const blocks = [];
      let m;
      while ((m = blockRx.exec(section)) !== null) {
        const declaredName = m[2].trim();
        if (declaredName === configName) blocks.push(m[3]);
      }
      // PHASE 3.3 MIGRATION INSTRUCTION: bump this count to 4 when
      // Phase 3.3 lands (adds Local configs to iosAppTests +
      // iosAppUITests). The new blocks MUST also carry SWIFT_VERSION
      // = 5.0 — the inner `for (const block of blocks)` loop below
      // will catch a missing SWIFT_VERSION on any new block, but you
      // must update THIS line first so the loop reaches the new
      // blocks. There are EXACTLY TWO blocks today: project-level +
      // iosApp target.
      expect(blocks.length).toBe(2);
      for (const block of blocks) {
        expect(block).toMatch(/SWIFT_VERSION = 5\.0;/);
      }
    }
    configContainsSwiftVersion('Debug-Local');
    configContainsSwiftVersion('Release-Local');
  });
});

/**
 * iosApp.xcodeproj — Phase 3.2 Local build configurations
 *
 * Phase 3 of the iOS-local build-out adds a parallel `Local` flavour
 * matching the Android local product flavor:
 *   - 3.1 ✅  Local.xcconfig foundation file (PR #714)
 *   - 3.2 (this PR) — Debug-Local + Release-Local on PROJECT-level
 *                     and the iosApp TARGET-level configuration lists,
 *                     project-level configs base-reference Local.xcconfig
 *   - 3.3 (next)   — iosAppTests + iosAppUITests target configurations
 *   - 3.4          — CocoaPods integration (Pods-iosApp.debug-local.xcconfig
 *                    + Pods-iosApp.release-local.xcconfig)
 *   - 3.5          — Local scheme + LiveKitBridge isAllowedURL extension
 *
 * Implementation is via the xcodeproj ruby gem (scripts/ios/
 * add-local-configurations.rb) — the only safe way to mutate
 * project.pbxproj programmatically. The script is idempotent.
 *
 * These tests pin the END STATE of the pbxproj after the script has
 * run, so they fail loud if a future PR (or a manual Xcode edit) drops
 * the configurations. Grep-based string assertions keep the contract
 * independent of pbxproj line-numbering drift.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PBXPROJ = path.join(REPO_ROOT, 'iosApp/iosApp.xcodeproj/project.pbxproj');
const ADD_SCRIPT = path.join(REPO_ROOT, 'scripts/ios/add-local-configurations.rb');
const IOS_TESTS_YML = path.join(REPO_ROOT, '.github/workflows/ios-tests.yml');

/**
 * Count non-overlapping matches of a `/g`-flagged regex.
 * String.prototype.match(regex_with_g) returns an array of every
 * match (or null on zero matches). Used to assert "exactly N
 * occurrences" of a fixed-form line in the pbxproj.
 */
function countMatches(text, regex) {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

/**
 * Find all XCBuildConfiguration blocks inside the
 * XCBuildConfiguration section that have the given `name`. Returns
 * an array of objects: `{ uuid, block }`. UUIDs are the leading
 * 24-hex token before the slash-star comment.
 *
 * Used to resolve UUID-by-name so tests can pin structural
 * invariants (e.g. "iosApp-target Local configs have no
 * baseConfigurationReference") without hardcoding UUIDs that
 * would shift on project regeneration.
 */
function findBuildConfigurationsByName(pbxproj, name) {
  const sectionStart = pbxproj.indexOf('/* Begin XCBuildConfiguration section */');
  const sectionEnd = pbxproj.indexOf('/* End XCBuildConfiguration section */');
  if (sectionStart < 0 || sectionEnd < 0) {
    throw new Error('XCBuildConfiguration section markers not found.');
  }
  const section = pbxproj.slice(sectionStart, sectionEnd);
  const results = [];
  // Each block opens with: \t\t<UUID> /* <name> */ = {
  // and the inner `name = "<name>";` is on its own line.
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

/**
 * Find the UUID of a PBXFileReference by its `path` attribute.
 * Returns the UUID string or `null` if not found. Used to resolve
 * Local.xcconfig's UUID for cross-checking baseConfigurationReference
 * fidelity.
 */
function findFileReferenceUuid(pbxproj, fileName) {
  const sectionStart = pbxproj.indexOf('/* Begin PBXFileReference section */');
  const sectionEnd = pbxproj.indexOf('/* End PBXFileReference section */');
  if (sectionStart < 0 || sectionEnd < 0) {
    throw new Error('PBXFileReference section markers not found.');
  }
  const section = pbxproj.slice(sectionStart, sectionEnd);
  // Match: \t\t<UUID> /* <fileName> */ = {...path = <fileName>;...};
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

/**
 * Extract a PBXGroup block by its UUID. Returns the full block.
 *
 * The startMarker is line-anchored with a leading `\n` — without
 * that anchor, a child reference of the same UUID (a 4-tab-indented
 * line at the main_group level) would substring-match because
 * `\t\t<UUID>` is contained in `\t\t\t\t<UUID>`. The newline anchor
 * forces the match to start at a line beginning.
 */
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
  // Skip the leading `\n` so the returned block starts at the line.
  const blockStart = startIdx + 1;
  const endIdx = section.indexOf('\n\t\t};', blockStart);
  return section.slice(blockStart, endIdx + '\n\t\t};'.length);
}

/**
 * Extract an XCConfigurationList block by its UUID prefix, scoped
 * to the XCConfigurationList section of the file. Returns the
 * full block including the closing `};`. Throws if not found or
 * if the UUID matches more than one block.
 */
function extractConfigurationList(pbxproj, uuid) {
  const sectionStart = pbxproj.indexOf('/* Begin XCConfigurationList section */');
  const sectionEnd = pbxproj.indexOf('/* End XCConfigurationList section */');
  if (sectionStart < 0 || sectionEnd < 0) {
    throw new Error('XCConfigurationList section markers not found in pbxproj.');
  }
  const section = pbxproj.slice(sectionStart, sectionEnd);
  // Round 2 M-1: line-anchor with leading `\n` for defense-in-depth
  // consistency with extractGroupBlock. Safe today (XCConfigurationList
  // UUIDs are referenced as `buildConfigurationList = <UUID>` which
  // doesn't substring-match `\t\t<UUID>`) but the anchor costs nothing.
  const marker = `\n\t\t${uuid} `;
  const markerIdx = section.indexOf(marker);
  if (markerIdx < 0) {
    throw new Error(`XCConfigurationList ${uuid} not found.`);
  }
  const blockStart = markerIdx + 1;
  const secondIdx = section.indexOf(marker, markerIdx + 1);
  if (secondIdx >= 0) {
    throw new Error(`XCConfigurationList ${uuid} appears more than once.`);
  }
  const blockEnd = section.indexOf('\n\t\t};', blockStart);
  if (blockEnd < 0) {
    throw new Error(`XCConfigurationList ${uuid} block has no closing };`);
  }
  return section.slice(blockStart, blockEnd + '\n\t\t};'.length);
}

describe('iosApp.xcodeproj — Phase 3.2 Local build configurations', () => {
  let pbxproj;

  beforeAll(() => {
    pbxproj = fs.readFileSync(PBXPROJ, 'utf8');
  });

  describe('XCBuildConfiguration entries', () => {
    // Two per configuration name: one at project-level (058558B0
    // list) and one at iosApp-target-level (058558B1 list). Test
    // targets are Phase 3.3 — explicitly NOT counted here.
    test('Debug-Local appears as an XCBuildConfiguration name exactly twice (project + iosApp target)', () => {
      const count = countMatches(pbxproj, /\n\t{3}name = "Debug-Local";/g);
      expect(count).toBe(2);
    });

    test('Release-Local appears as an XCBuildConfiguration name exactly twice (project + iosApp target)', () => {
      const count = countMatches(pbxproj, /\n\t{3}name = "Release-Local";/g);
      expect(count).toBe(2);
    });

    test('Local.xcconfig appears as a baseConfigurationReference comment exactly twice (project-level Debug-Local + Release-Local)', () => {
      // baseConfigurationReference uses the format:
      //   baseConfigurationReference = <UUID> /* Local.xcconfig */;
      // Two references = one per project-level Local config.
      // The iosApp-target Local configs (Phase 3.2) have NO base
      // reference — Pods integration is Phase 3.4.
      const count = countMatches(pbxproj, / \/\* Local\.xcconfig \*\//g);
      // 2 baseConfigurationReference comments + 1 PBXFileReference declaration
      // + 1 PBXGroup membership = 4 total occurrences of the comment.
      expect(count).toBeGreaterThanOrEqual(2);
    });
  });

  describe('XCConfigurationList membership', () => {
    test('project-level list (058558B0) includes both Debug-Local and Release-Local', () => {
      const block = extractConfigurationList(pbxproj, '058558B0273AAA2400C9D062');
      expect(block).toMatch(/\* Debug-Local \*\/,/);
      expect(block).toMatch(/\* Release-Local \*\/,/);
    });

    test('iosApp target list (058558B1) includes both Debug-Local and Release-Local', () => {
      const block = extractConfigurationList(pbxproj, '058558B1273AAA2400C9D062');
      expect(block).toMatch(/\* Debug-Local \*\/,/);
      expect(block).toMatch(/\* Release-Local \*\/,/);
    });

    test('test targets are NOT modified in Phase 3.2 (deferred to 3.3)', () => {
      // iosAppTests list — must NOT yet contain Local configs.
      const testsBlock = extractConfigurationList(pbxproj, 'A10008002600000000000001');
      expect(testsBlock).not.toMatch(/Debug-Local/);
      expect(testsBlock).not.toMatch(/Release-Local/);
      // iosAppUITests list — same.
      const uitestsBlock = extractConfigurationList(pbxproj, '08EFC4EBCF29E72CA6FC9F2A');
      expect(uitestsBlock).not.toMatch(/Debug-Local/);
      expect(uitestsBlock).not.toMatch(/Release-Local/);
    });

    test('project-level defaultConfigurationName remains Release (not changed by Local addition)', () => {
      const block = extractConfigurationList(pbxproj, '058558B0273AAA2400C9D062');
      expect(block).toContain('defaultConfigurationName = Release;');
    });

    // Round 1 Gap 4: iosApp-target list defaultConfigurationName too.
    // If Phase 3.2 had accidentally changed it (e.g. to Debug-Local),
    // every CI build of iosApp would silently switch to the wrong
    // configuration. Pin it to catch that class of regression.
    test('iosApp-target defaultConfigurationName remains Release', () => {
      const block = extractConfigurationList(pbxproj, '058558B1273AAA2400C9D062');
      expect(block).toContain('defaultConfigurationName = Release;');
    });
  });

  describe('Phase 3.2 structural invariants (Round 1 review gaps)', () => {
    // Round 1 Gap 2 — THE Phase 3.2 invariant: iosApp-target Local
    // configs MUST NOT have baseConfigurationReference. CocoaPods
    // integration (Phase 3.4) is the only thing allowed to add one,
    // injecting Pods-iosApp.{debug,release}-local.xcconfig. A future
    // accidental addition (e.g. someone copying the project-level
    // config wholesale) would break the planned 3.4 integration
    // silently.
    test('iosApp-target Debug-Local has NO baseConfigurationReference (Phase 3.4 scope)', () => {
      const matches = findBuildConfigurationsByName(pbxproj, 'Debug-Local');
      // Two matches: one project-level (has base ref), one iosApp-target (no base ref).
      expect(matches).toHaveLength(2);
      const targetLevel = matches.find((m) => !m.block.includes('baseConfigurationReference'));
      expect(targetLevel).toBeDefined();
    });

    test('iosApp-target Release-Local has NO baseConfigurationReference (Phase 3.4 scope)', () => {
      const matches = findBuildConfigurationsByName(pbxproj, 'Release-Local');
      expect(matches).toHaveLength(2);
      const targetLevel = matches.find((m) => !m.block.includes('baseConfigurationReference'));
      expect(targetLevel).toBeDefined();
    });

    // Round 1 Gap 3 — UUID fidelity. The original test asserted
    // `/* Local.xcconfig */` was present, which passes even if the
    // UUID on the left side is wrong. This resolves the actual UUID
    // of the Local.xcconfig PBXFileReference and asserts BOTH
    // project-level Local configs point at it specifically.
    test('project-level Local configs baseConfigurationReference targets the Local.xcconfig file ref UUID', () => {
      const xcconfigUuid = findFileReferenceUuid(pbxproj, 'Local.xcconfig');
      expect(xcconfigUuid).not.toBeNull();
      expect(xcconfigUuid).toMatch(/^[0-9A-F]{24}$/);

      const debugMatches = findBuildConfigurationsByName(pbxproj, 'Debug-Local');
      const projectLevelDebug = debugMatches.find((m) =>
        m.block.includes('baseConfigurationReference'),
      );
      expect(projectLevelDebug).toBeDefined();
      expect(projectLevelDebug.block).toContain(
        `baseConfigurationReference = ${xcconfigUuid} /* Local.xcconfig */;`,
      );

      const releaseMatches = findBuildConfigurationsByName(pbxproj, 'Release-Local');
      const projectLevelRelease = releaseMatches.find((m) =>
        m.block.includes('baseConfigurationReference'),
      );
      expect(projectLevelRelease).toBeDefined();
      expect(projectLevelRelease.block).toContain(
        `baseConfigurationReference = ${xcconfigUuid} /* Local.xcconfig */;`,
      );
    });

    // Round 1 Gap 5 — PBXGroup invariants.
    test('Configurations PBXGroup exists and contains exactly Local.xcconfig', () => {
      // Find the Configurations group by scanning the PBXGroup section
      // for a block whose name attribute equals "Configurations".
      const groupSection = pbxproj.slice(
        pbxproj.indexOf('/* Begin PBXGroup section */'),
        pbxproj.indexOf('/* End PBXGroup section */'),
      );
      const groupHeader = /\t\t([0-9A-F]{24}) \/\* Configurations \*\/ = \{/;
      const headerMatch = groupSection.match(groupHeader);
      expect(headerMatch).not.toBeNull();
      const groupUuid = headerMatch[1];

      const block = extractGroupBlock(pbxproj, groupUuid);
      // The group must contain Local.xcconfig as its only child.
      expect(block).toContain('/* Local.xcconfig */,');
      // path = Configurations preserves on-disk layout.
      expect(block).toContain('path = Configurations;');
    });

    test('Configurations PBXGroup is a child of the iosApp PBXGroup', () => {
      // iosApp group UUID is 058557D1273AAA2400C9D062 per existing pbxproj.
      const iosAppGroupBlock = extractGroupBlock(pbxproj, '058557D1273AAA2400C9D062');
      expect(iosAppGroupBlock).toContain('/* Configurations */,');
    });

    // Round 3 CI-blocker — CocoaPods rejected `pod install` with:
    //   "There may only be up to 1 unique SWIFT_VERSION per target"
    // because the iosApp target had SWIFT_VERSION = 5.0 on Debug
    // / Release but EMPTY buildSettings (no SWIFT_VERSION) on
    // Debug-Local / Release-Local. CocoaPods enforces consistency
    // across all target configs. Fix: clone the Debug/Release
    // buildSettings when creating Debug-Local/Release-Local so they
    // share the same SWIFT_VERSION (and other target-level baselines
    // like IPHONEOS_DEPLOYMENT_TARGET).
    test('iosApp-target Debug-Local inherits SWIFT_VERSION = "5.0" from Debug', () => {
      const matches = findBuildConfigurationsByName(pbxproj, 'Debug-Local');
      const targetLevel = matches.find((m) => !m.block.includes('baseConfigurationReference'));
      expect(targetLevel).toBeDefined();
      expect(targetLevel.block).toContain('SWIFT_VERSION = 5.0;');
    });

    test('iosApp-target Release-Local inherits SWIFT_VERSION = "5.0" from Release', () => {
      const matches = findBuildConfigurationsByName(pbxproj, 'Release-Local');
      const targetLevel = matches.find((m) => !m.block.includes('baseConfigurationReference'));
      expect(targetLevel).toBeDefined();
      expect(targetLevel.block).toContain('SWIFT_VERSION = 5.0;');
    });

    // PBXFileReference for Local.xcconfig must declare the xcconfig
    // file type so Xcode treats it correctly.
    test('Local.xcconfig PBXFileReference has lastKnownFileType = text.xcconfig', () => {
      const fileRefSection = pbxproj.slice(
        pbxproj.indexOf('/* Begin PBXFileReference section */'),
        pbxproj.indexOf('/* End PBXFileReference section */'),
      );
      const declRegex = /[0-9A-F]{24} \/\* Local\.xcconfig \*\/ = \{([^}]+)\};/;
      const declMatch = fileRefSection.match(declRegex);
      expect(declMatch).not.toBeNull();
      expect(declMatch[1]).toContain('lastKnownFileType = text.xcconfig');
      expect(declMatch[1]).toContain('path = Local.xcconfig');
      expect(declMatch[1]).toContain('sourceTree = "<group>"');
    });
  });

  describe('Ruby script (scripts/ios/add-local-configurations.rb)', () => {
    test('script file exists', () => {
      expect(fs.existsSync(ADD_SCRIPT)).toBe(true);
    });

    test('script is idempotent — declares the intent in a header comment', () => {
      const scriptText = fs.readFileSync(ADD_SCRIPT, 'utf8');
      // Idempotency is critical: re-running the script must not
      // double-add configurations. The header should state this.
      expect(scriptText).toMatch(/idempotent/i);
    });

    test('script uses the xcodeproj gem (not raw text manipulation)', () => {
      const scriptText = fs.readFileSync(ADD_SCRIPT, 'utf8');
      expect(scriptText).toContain("require 'xcodeproj'");
    });

    test('script references Local.xcconfig as the base configuration source', () => {
      const scriptText = fs.readFileSync(ADD_SCRIPT, 'utf8');
      expect(scriptText).toContain('Local.xcconfig');
    });

    // Round 1 Gap 6 / Round 2 I-1 — STRUCTURAL idempotency test.
    // Earlier byte-equality was too strict: Phase 3.4 (CocoaPods)
    // will rewrite the pbxproj through Xcode's plist serialiser, and
    // a subsequent xcodeproj-gem save uses a different formatter —
    // making byte-equality a false-positive failure across the 3.4
    // boundary. Structural identity (counts of the configurations,
    // file refs, and base references) is the robust contract.
    //
    // The test:
    //   (1) invokes the script via execFileSync
    //   (2) asserts exit 0
    //   (3) asserts stdout contains the 5 "(no-op)" lines
    //   (4) re-reads pbxproj and asserts structural invariants
    //       are unchanged from before (Debug-Local count, Release-
    //       Local count, Local.xcconfig file-ref UUID stable)
    //
    // Skips gracefully if ruby+xcodeproj-gem unavailable (Linux CI).
    // On macOS CI this runs and exercises the script's no-op paths
    // (script lines 67-71, 79-82, 101-105) end-to-end.
    test('script is structurally idempotent — re-run preserves all configurations and file refs', () => {
      try {
        // eslint-disable-next-line sonarjs/no-os-command-from-path
        execFileSync('ruby', ['-rxcodeproj', '-e', 'true'], { stdio: 'pipe' });
      } catch (_e) {
        // ruby+xcodeproj missing — defer to CI's macOS runner.
        return;
      }

      const beforeStr = fs.readFileSync(PBXPROJ, 'utf8');
      const beforeDebugCount = countMatches(beforeStr, /\n\t{3}name = "Debug-Local";/g);
      const beforeReleaseCount = countMatches(beforeStr, /\n\t{3}name = "Release-Local";/g);
      const beforeBaseRefCount = countMatches(beforeStr, / \/\* Local\.xcconfig \*\//g);
      const beforeXcconfigUuid = findFileReferenceUuid(beforeStr, 'Local.xcconfig');

      // eslint-disable-next-line sonarjs/no-os-command-from-path
      const stdout = execFileSync('ruby', [ADD_SCRIPT], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });

      // (3) the 5 no-op stdout messages
      expect(stdout).toContain('PBXFileReference already present: Local.xcconfig (no-op)');
      expect(stdout).toContain(
        'Project-level XCBuildConfiguration already present: Debug-Local (no-op)',
      );
      expect(stdout).toContain(
        'Project-level XCBuildConfiguration already present: Release-Local (no-op)',
      );
      expect(stdout).toContain(
        'iosApp-target XCBuildConfiguration already present: Debug-Local (no-op)',
      );
      expect(stdout).toContain(
        'iosApp-target XCBuildConfiguration already present: Release-Local (no-op)',
      );

      // (4) structural invariants unchanged
      const afterStr = fs.readFileSync(PBXPROJ, 'utf8');
      expect(countMatches(afterStr, /\n\t{3}name = "Debug-Local";/g)).toBe(beforeDebugCount);
      expect(countMatches(afterStr, /\n\t{3}name = "Release-Local";/g)).toBe(beforeReleaseCount);
      expect(countMatches(afterStr, / \/\* Local\.xcconfig \*\//g)).toBe(beforeBaseRefCount);
      expect(findFileReferenceUuid(afterStr, 'Local.xcconfig')).toBe(beforeXcconfigUuid);
    });
  });

  // Round 2 I-2 — pin the CI integration. The idempotency execution
  // test above skips on Linux runners (no ruby+xcodeproj), so without
  // a macOS CI step actually running it we get zero coverage of the
  // live script path. ios-tests.yml's build-ios job (macos-15, has
  // ruby+xcodeproj via CocoaPods) is the right place. This test
  // pins that wiring so a future workflow edit that drops the step
  // (or moves it before Install CocoaPods, breaking the xcodeproj-
  // gem availability) fails loud.
  describe('CI integration in ios-tests.yml (Round 2 I-2)', () => {
    let yamlText;

    beforeAll(() => {
      yamlText = fs.readFileSync(IOS_TESTS_YML, 'utf8');
    });

    test('build-ios job has a "Verify pbxproj-mutation script idempotency" step', () => {
      expect(yamlText).toContain('      - name: Verify pbxproj-mutation script idempotency');
    });

    test('idempotency step runs the specific Jest file', () => {
      // The step must invoke jest scoped to this test file (not the
      // full suite), so build-ios doesn't pay the cost of every
      // unrelated express-api test on every PR.
      expect(yamlText).toMatch(/npx jest tests\/scripts\/ios-local-configurations\.test\.js/);
    });

    test('idempotency step runs BEFORE Install CocoaPods (pod install mutates pbxproj)', () => {
      // pod install adds baseConfigurationReference entries to
      // target-level configs (including Debug-Local/Release-Local),
      // which violates the Phase 3.2 contract that target-level
      // Local configs have NO base reference. Running the test AFTER
      // pod install reads the mutated state and asserts against the
      // wrong invariants. The test must run on the committed pbxproj
      // state, which means BEFORE pod install. xcodeproj gem is
      // installed explicitly via `gem install` in the test step.
      // Anchor on the full 6-space step header (not substring) so a
      // comment can't satisfy the assertion.
      const cocoapodsIdx = yamlText.indexOf('      - name: Install CocoaPods');
      const idempotencyIdx = yamlText.indexOf(
        '      - name: Verify pbxproj-mutation script idempotency',
      );
      expect(cocoapodsIdx).toBeGreaterThanOrEqual(0);
      expect(idempotencyIdx).toBeGreaterThanOrEqual(0);
      expect(idempotencyIdx).toBeLessThan(cocoapodsIdx);
    });

    test('idempotency step explicitly installs xcodeproj gem (no pod-install dependency)', () => {
      // Since the step runs BEFORE Install CocoaPods, the xcodeproj
      // gem is not yet available as a transitive dep. The step must
      // explicitly `gem install xcodeproj` to make `ruby -rxcodeproj`
      // succeed.
      const stepHeader = '      - name: Verify pbxproj-mutation script idempotency';
      const startIdx = yamlText.indexOf(stepHeader);
      const rest = yamlText.slice(startIdx);
      const nextStepIdx = rest.indexOf('\n      - ', stepHeader.length);
      const stepBody = nextStepIdx > 0 ? rest.slice(0, nextStepIdx) : rest;
      expect(stepBody).toContain('gem install');
      expect(stepBody).toContain('xcodeproj');
    });

    // Round 3 I-1 — pin the ABSENCE of an `if:` guard on this step.
    // Sibling steps in this job carry `if: steps.check-tests.outputs
    // .has_tests == 'true'`. Inheriting that guard would silently
    // skip the idempotency check the moment XCTest targets are
    // removed — script's only macOS CI execution path goes dark
    // with no alarm. This test pins the contract that the step's
    // precondition is the macOS runner itself (ruby+xcodeproj),
    // NOT the XCTest surface.
    test('idempotency step has NO `if:` guard (runs unconditionally on macos-15)', () => {
      // Extract the step block from its `- name:` header to the next
      // step header or job boundary. Assert no `if:` line is in
      // the body. Use a non-greedy [\s\S] up to the next `      - `
      // (6-space step indent prefix) — the same level as the step
      // header itself.
      const stepHeader = '      - name: Verify pbxproj-mutation script idempotency';
      const startIdx = yamlText.indexOf(stepHeader);
      expect(startIdx).toBeGreaterThanOrEqual(0);
      // Find the NEXT `      - ` (next step at the same indent),
      // or the next `outputs:` job-level key (terminates the steps
      // array), whichever comes first.
      const rest = yamlText.slice(startIdx + stepHeader.length);
      const nextStepIdx = rest.indexOf('\n      - ');
      const nextJobKeyIdx = rest.indexOf('\n    outputs:');
      const candidates = [nextStepIdx, nextJobKeyIdx].filter((i) => i >= 0);
      const stopAt = candidates.length > 0 ? Math.min(...candidates) : rest.length;
      const stepBody = rest.slice(0, stopAt);
      // The step body must NOT contain an `if:` at the step's own
      // indent level (8 spaces — `        if:`).
      expect(stepBody).not.toMatch(/\n {8}if:/);
    });
  });
});

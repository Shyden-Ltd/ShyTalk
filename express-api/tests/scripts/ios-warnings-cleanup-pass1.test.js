/**
 * iOS Build warnings cleanup — pass 1 (task #24c).
 *
 * After PR #841 (LiveKit SPM migration), the Build iOS warning
 * count dropped from 357 → 36. Two categories of remaining
 * warnings are clearly OUR code and fixable in this pass:
 *
 * 1. LiveKitBridge.swift (2 unique × 8 build targets = 16 hits)
 *    - `non-final class 'LiveKitBridgeImpl' cannot conform to
 *      'Sendable'`
 *    - `stored property 'room' of 'Sendable'-conforming class
 *      'LiveKitBridgeImpl' is mutable`
 *    Both Swift 6 concurrency. Fix: mark class `final` +
 *    `@unchecked Sendable` with documented thread-safety reasoning.
 *
 * 2. `Compile Kotlin Framework` script phase (1 warning)
 *    - `Run script build phase 'Compile Kotlin Framework' will be
 *      run during every build because it does not specify any
 *      outputs.`
 *    Fix: add `outputPaths` declaring the shared.framework
 *    output (the standard `embedAndSignAppleFrameworkForXcode`
 *    output path).
 *
 * Other categories remain for follow-up passes:
 *   - SharedFirebase_databaseChildEventType cinterop (4) —
 *     KMP-side fix, requires shared/build.gradle.kts surgery
 *     OR Kotlin/Native version bump.
 *   - Search-path Metal toolchain (6) — runner-environment.
 *   - Pod-internal warnings (Firebase, gRPC, abseil) — pod bumps
 *     or upstream PRs.
 *   - Run script phases in gRPC/abseil/BoringSSL pods (4) —
 *     Podfile post_install hook to add output paths.
 *
 * Final pass: `OTHER_SWIFT_FLAGS=-warnings-as-errors` +
 * `GCC_TREAT_WARNINGS_AS_ERRORS=YES` once warning count is zero.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const LIVEKIT_BRIDGE = path.join(REPO_ROOT, 'iosApp/iosApp/LiveKitBridge.swift');
const PBXPROJ = path.join(REPO_ROOT, 'iosApp/iosApp.xcodeproj/project.pbxproj');

describe('iOS Build warnings cleanup — pass 1', () => {
  describe('LiveKitBridge.swift: Swift 6 Sendable conformance', () => {
    let src;
    beforeAll(() => {
      src = fs.readFileSync(LIVEKIT_BRIDGE, 'utf8');
    });

    test('class is marked `final` (required for Sendable conformance)', () => {
      // Swift 6: a non-final class cannot conform to Sendable
      // because subclasses could break the safety contract.
      // Marking final lets the @unchecked Sendable conformance
      // actually compile.
      expect(src).toMatch(/^final class LiveKitBridgeImpl\b/m);
    });

    test('class declares `@unchecked Sendable` conformance', () => {
      // The explicit opt-out — author guarantees thread safety
      // via the documented invariants in the class docstring
      // (write-once lifecycle on `room` + `kotlinDelegate`).
      // Swift 6 strict-concurrency mode requires this when a
      // protocol the class adopts (RoomDelegate) is Sendable
      // but the class has mutable stored properties.
      expect(src).toContain('@unchecked Sendable');
    });

    test('thread-safety reasoning is documented in the class docstring', () => {
      // Per the never-suppress rule: `@unchecked Sendable` is the
      // language-idiomatic way to express "I guarantee thread-
      // safety differently", but it MUST come with a documented
      // justification — otherwise it's indistinguishable from a
      // suppression.
      // Match across word-wrap (the docstring breaks mid-phrase
      // due to comment line-length). Use [\s/]+ (any whitespace
      // or comment-prefix slashes) between the two words.
      expect(src).toMatch(/Thread-safety[\s/]+justification/i);
      expect(src).toContain('Koin DI');
      expect(src).toContain('MainActor.run');
    });
  });

  describe('Compile Kotlin Framework script phase has outputPaths', () => {
    let pbxproj;
    beforeAll(() => {
      pbxproj = fs.readFileSync(PBXPROJ, 'utf8');
    });

    test('Compile Kotlin Framework script phase block declares an outputPaths entry', () => {
      // Without an output declaration, xcodebuild can't do
      // dependency analysis on this script and warns:
      //   "will be run during every build because it does not
      //    specify any outputs."
      // The standard `embedAndSignAppleFrameworkForXcode`
      // produces `shared.framework` at the target build dir's
      // Frameworks folder; that's the canonical output to pin.
      const match = pbxproj.match(
        /Compile Kotlin Framework[\s\S]{0,800}outputPaths = \(([\s\S]*?)\);/,
      );
      expect(match).not.toBeNull();
      expect(match[1]).toContain('$(TARGET_BUILD_DIR)/$(FRAMEWORKS_FOLDER_PATH)/shared.framework');
    });

    test('outputPaths is NOT empty (the original problematic state)', () => {
      // Negative: the pre-fix state had `outputPaths = ();` with
      // nothing inside. That's exactly what triggered the warning.
      // Pin that the section has CONTENT.
      const match = pbxproj.match(
        /Compile Kotlin Framework[\s\S]{0,800}outputPaths = \(([\s\S]*?)\);/,
      );
      const inner = match[1].trim();
      expect(inner.length).toBeGreaterThan(0);
    });
  });
});

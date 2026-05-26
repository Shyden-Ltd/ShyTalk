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

    test('class declares `@unchecked Sendable` conformance on the class declaration line', () => {
      // The explicit opt-out — author guarantees thread safety
      // via the documented invariants in the class docstring.
      // Swift 6 strict-concurrency mode requires this when a
      // protocol the class adopts (RoomDelegate) is Sendable
      // but the class has mutable stored properties.
      //
      // R1 review test-gap fix: anchor on the class declaration
      // line specifically. A bare `toContain('@unchecked Sendable')`
      // would also pass if someone moved the conformance to a
      // retroactive extension (`extension LiveKitBridgeImpl:
      // @unchecked Sendable {}`) or mentioned the phrase in a
      // comment — neither of which is the form we want pinned.
      expect(src).toMatch(/^final class LiveKitBridgeImpl[^{]*@unchecked Sendable/m);
    });

    test('`disconnect()` wraps `room = nil` in `MainActor.run` (R1 I-2 fix)', () => {
      // R1 review I-2: the original disconnect() body wrote
      //   `room = nil`
      // directly from inside an unstructured Task, which runs
      // on the cooperative thread pool — a data race against
      // the main-thread write in connect() and any concurrent
      // delegate-callback reads of `room`. Fixed by wrapping
      // the nil-write in `await MainActor.run { self.room = nil }`
      // so it serialises with the connect() write site.
      //
      // Pin the fix so a future "simplification" that removes
      // the MainActor wrapper re-introduces the race silently.
      // Line-by-line scan (no ReDoS-prone regex) to extract the
      // disconnect() body. Find the line that opens the function,
      // walk forward collecting lines until we hit the matching
      // closing brace at the function's indent level.
      const lines = src.split('\n');
      const startIdx = lines.findIndex((l) => l.includes('func disconnect()'));
      expect(startIdx).toBeGreaterThanOrEqual(0);
      const bodyLines = [];
      // The function header starts at indent 4 (`    func ...`),
      // body at indent 8+, closing brace at indent 4.
      for (let i = startIdx + 1; i < lines.length; i++) {
        if (lines[i] === '    }') break;
        bodyLines.push(lines[i]);
      }
      const body = bodyLines.join('\n');
      expect(body).toContain('await MainActor.run');
      expect(body).toContain('self.room = nil');
      // Negative: the bare `room = nil` (8-space indent, no
      // `self.` prefix, outside MainActor.run) was the pre-fix
      // form. Pin it as absent.
      expect(bodyLines).not.toContain('            room = nil');
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

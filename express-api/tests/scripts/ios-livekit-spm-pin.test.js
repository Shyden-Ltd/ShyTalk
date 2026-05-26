/**
 * LiveKit CocoaPods → SPM migration pin.
 *
 * Task #24b (2026-05-26 ~00:10 BST): migrated LiveKitClient from
 * CocoaPods to Swift Package Manager. CocoaPods Trunk pinned the
 * LiveKitClient pod at 2.0.18 (last version LiveKit published to
 * Trunk before switching exclusively to SPM distribution). The
 * 302 actor-isolated Swift 6 warnings observed in PR #835's
 * Build iOS run all came from the old 2.0.18 source; 2.14.1
 * (current latest, available via SPM) cleared the bulk of them.
 *
 * Migration mechanics (executed by ruby scripts/ios/add-livekit-spm.rb):
 *   1. Added XCRemoteSwiftPackageReference to
 *      iosApp/iosApp.xcodeproj/project.pbxproj for
 *      https://github.com/livekit/client-sdk-swift (>= 2.14.1,
 *      upToNextMajorVersion).
 *   2. Added XCSwiftPackageProductDependency for "LiveKitClient"
 *      on the iosApp app target.
 *   3. Wired the product into iosApp's Frameworks build phase
 *      (PBXBuildFile with product_ref pointing at the SPM dep).
 *   4. Removed `pod 'LiveKitClient'` from iosApp/Podfile.
 *   5. Committed iosApp/iosApp.xcworkspace/xcshareddata/swiftpm/
 *      Package.resolved so CI fetches reproducible versions.
 *
 * The iosAppTests target inherits LiveKit via `inherit! :search_paths`
 * in the Podfile (so @testable import iosApp finds LiveKit without
 * re-linking it — same pattern as Firebase/GoogleSignIn).
 *
 * This test pins ALL the contract elements so a future "consolidation"
 * PR that drops one (e.g. removes the SPM dep or re-adds the pod)
 * fails CI loudly with a clear diagnostic.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PODFILE = path.join(REPO_ROOT, 'iosApp/Podfile');
const PBXPROJ = path.join(REPO_ROOT, 'iosApp/iosApp.xcodeproj/project.pbxproj');
const PACKAGE_RESOLVED = path.join(
  REPO_ROOT,
  'iosApp/iosApp.xcworkspace/xcshareddata/swiftpm/Package.resolved',
);
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts/ios/add-livekit-spm.rb');

describe('LiveKit migrated from CocoaPods to SPM', () => {
  describe('Podfile no longer declares LiveKitClient pod', () => {
    let podfile;
    beforeAll(() => {
      podfile = fs.readFileSync(PODFILE, 'utf8');
    });

    test("`pod 'LiveKitClient'` line is removed", () => {
      // Negative: the legacy pod declaration must not survive.
      // CocoaPods Trunk's last LiveKitClient was 2.0.18; keeping
      // the pod would re-install the ancient version alongside
      // the SPM 2.14.1+ and trigger duplicate-symbol link errors.
      //
      // Line-by-line scan (no `\s+`-anchored regex) to avoid the
      // ReDoS-flagged class. Each Podfile line is checked
      // independently for the bare `pod 'LiveKitClient'` form.
      const offendingLines = podfile.split('\n').filter((line) => {
        const trimmed = line.trim();
        return trimmed === "pod 'LiveKitClient'" || trimmed === 'pod "LiveKitClient"';
      });
      expect(offendingLines).toEqual([]);
    });

    test('replacement comment documents the SPM migration', () => {
      // Comment must explain WHERE LiveKit now lives so a future
      // editor doesn't reflexively re-add the pod when they
      // notice it's missing from the Podfile.
      expect(podfile).toMatch(/Swift Package Manager/i);
      expect(podfile).toContain('add-livekit-spm.rb');
    });
  });

  describe('iosApp.xcodeproj has XCRemoteSwiftPackageReference for LiveKit', () => {
    let pbxproj;
    beforeAll(() => {
      pbxproj = fs.readFileSync(PBXPROJ, 'utf8');
    });

    test('references the LiveKit Swift SDK repo URL', () => {
      // The script adds an XCRemoteSwiftPackageReference with this
      // exact URL. The pbxproj plist-style serialisation quotes URLs
      // when they contain `://` so the on-disk form may be
      // `repositoryURL = "https://github.com/livekit/client-sdk-swift";`
      expect(pbxproj).toContain('https://github.com/livekit/client-sdk-swift');
    });

    test('uses upToNextMajorVersion with minimumVersion 2.14.1', () => {
      // Version-range tied to a within-major upgrade so dependabot
      // (or pod outdated equivalent for SPM) can auto-pull 2.x bumps
      // without a major-version review.
      expect(pbxproj).toContain('upToNextMajorVersion');
      expect(pbxproj).toContain('2.14.1');
    });

    test('LiveKit product is wired as XCSwiftPackageProductDependency', () => {
      // The Frameworks build phase needs an entry that references
      // the product, otherwise the linker doesn't see LiveKit.
      //
      // The SPM product is named `LiveKit` (per client-sdk-swift's
      // Package.swift), NOT `LiveKitClient` (that was the CocoaPods
      // spec name). The R1 push used the CocoaPods name and CI's
      // Build iOS failed with `Missing package product 'LiveKitClient'`.
      //
      // R1 review: anchor the `productName = LiveKit` line to an
      // XCSwiftPackageProductDependency block (not a bare substring
      // search that could match a stale entry or a comment).
      expect(pbxproj).toMatch(
        /isa = XCSwiftPackageProductDependency[\s\S]{0,200}productName = LiveKit/,
      );
    });
  });

  describe('Package.resolved is committed with deterministic versions', () => {
    let resolved;
    beforeAll(() => {
      const src = fs.readFileSync(PACKAGE_RESOLVED, 'utf8');
      resolved = JSON.parse(src);
    });

    test('pins LiveKit client-sdk-swift to exactly 2.14.1', () => {
      const lk = resolved.pins.find((p) => p.identity === 'client-sdk-swift');
      expect(lk).toBeDefined();
      // R1 review: exact-pin instead of >= comparison. The earlier
      // semver split via parseInt silently passed pre-release
      // suffixes (`2.14.1-rc.1` would parse the patch as `1` and
      // succeed the >=2.14.1 check, which is wrong). An exact pin
      // forces a deliberate test update on any upgrade — exactly
      // the right friction-level for a load-bearing SPM dep.
      expect(lk.state.version).toBe('2.14.1');
    });

    test('pins LiveKitWebRTC transitive dep (LiveKit core requires it)', () => {
      const webrtc = resolved.pins.find((p) => p.identity === 'webrtc-xcframework');
      expect(webrtc).toBeDefined();
      expect(webrtc.location).toBe('https://github.com/livekit/webrtc-xcframework.git');
    });

    test('pins LiveKitUniFFI transitive dep', () => {
      const uniffi = resolved.pins.find((p) => p.identity === 'livekit-uniffi-xcframework');
      expect(uniffi).toBeDefined();
    });

    test('pins SwiftProtobuf transitive dep', () => {
      const proto = resolved.pins.find((p) => p.identity === 'swift-protobuf');
      expect(proto).toBeDefined();
    });
  });

  describe('add-livekit-spm.rb script is idempotent + properly scoped', () => {
    let script;
    beforeAll(() => {
      script = fs.readFileSync(SCRIPT_PATH, 'utf8');
    });

    test('declares idempotency in the docstring', () => {
      // Idempotency is the contract that lets us re-run the script
      // safely. Pin it in the docstring so a future "simplification"
      // that drops the existence checks fails the test.
      expect(script).toContain('IDEMPOTENT');
    });

    test('checks for existing XCRemoteSwiftPackageReference before adding', () => {
      // The script must find-or-create, not always-create — otherwise
      // re-running it would duplicate the package reference.
      // R1 review fix added a nil-guard intermediate `package_refs`
      // local so the find is on that array, not directly on the
      // `package_references` accessor (which returns nil on a
      // never-touched-by-SPM project and would raise NoMethodError).
      expect(script).toContain('package_refs = project.root_object.package_references || []');
      expect(script).toMatch(/existing_package\s*=\s*package_refs\.find/);
    });

    test('R1 fix: guards `package_references` accessor against nil (fresh-project safety)', () => {
      // Without the `|| []` guard, a freshly-cloned repo whose
      // pbxproj has no SPM section would raise
      // `NoMethodError: undefined method 'find' for nil:NilClass`
      // before any write. Pin the guard.
      expect(script).toContain('|| []');
    });

    test('R1 fix: existing_product check also matches package (not just product_name)', () => {
      // Without `dep.package == package_ref`, a future PR that adds
      // a different SPM package also exporting "LiveKitClient" would
      // silently bind to the wrong package. Pin the dual check.
      expect(script).toContain('dep.product_name == PRODUCT_NAME && dep.package == package_ref');
    });

    test('checks for existing XCSwiftPackageProductDependency before adding', () => {
      expect(script).toMatch(/existing_product\s*=\s*target\.package_product_dependencies\.find/);
    });

    test('checks for existing PBXBuildFile in frameworks phase before adding', () => {
      expect(script).toMatch(/existing_build_file\s*=\s*frameworks_phase\.files\.find/);
    });
  });
});

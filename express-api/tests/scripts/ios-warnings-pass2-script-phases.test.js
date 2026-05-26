/**
 * iOS Build warnings cleanup — pass 2 (task #24c).
 *
 * #842 (pass 1) cleared our-code Swift 6 + the Kotlin-framework script
 * phase. The authoritative #842 Build-iOS log then showed 4 remaining
 * script-phase warnings, one per C/C++ pod:
 *
 *   warning: Run script build phase 'Create Symlinks to Header Folders'
 *   will be run during every build because it does not specify any
 *   outputs. (in target 'gRPC-Core' / 'gRPC-C++' / 'BoringSSL-GRPC' /
 *   'abseil' from project 'Pods')
 *
 * These CocoaPods-generated phases recreate header symlinks idempotently
 * and have no practical declarable output. Xcode's own warning text
 * offers two remedies: (a) add output dependencies, or (b) "configure it
 * to run in every build by unchecking 'Based on dependency analysis'".
 * We take (b) via the Podfile post_install hook, setting
 * `always_out_of_date = '1'` on every Pods-project shell phase that
 * declares no outputs.
 *
 * Per the never-suppress rule this is NOT a suppression: the phases
 * already ran on every build, and (b) is Apple's sanctioned way to
 * declare that as intentional. The hook is deliberately CONDITIONAL on
 * "no outputs" so phases that DO declare outputs (e.g. the Check-Manifest
 * phase) keep their incremental, dependency-analysed behaviour and are
 * never blanket-disabled.
 *
 * Pods/ is gitignored, so the fix and this contract live in the Podfile;
 * CI's `pod install` applies the hook and the Build-iOS warning count
 * drops by 4. Verified locally with `pod install` + Xcodeproj: all 4
 * "Create Symlinks to Header Folders" phases resolve to
 * outputs=0 / alwaysOutOfDate="1"; phases with outputs are untouched.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PODFILE = path.join(REPO_ROOT, 'iosApp/Podfile');

describe('iOS Build warnings cleanup — pass 2 (pod script phases)', () => {
  let podfile;
  beforeAll(() => {
    podfile = fs.readFileSync(PODFILE, 'utf8');
  });

  test('post_install iterates the Pods project shell-script build phases', () => {
    // The hook must walk build_phases of the pods project's targets so it
    // can reach the per-pod "Create Symlinks to Header Folders" phases.
    expect(podfile).toMatch(/post_install do \|installer\|/);
    expect(podfile).toMatch(/installer\.pods_project\.targets\.each do \|target\|/);
    expect(podfile).toMatch(/target\.build_phases\.each do \|phase\|/);
  });

  test('only shell-script phases are considered (guards on isa)', () => {
    // Without the isa guard the loop would try to read output_paths on
    // non-script phases (PBXSourcesBuildPhase etc.) and misbehave. Anchor
    // on the exact early-`next` guard so a future refactor that drops it
    // regresses this test.
    expect(podfile).toMatch(/next unless phase\.isa == ['"]PBXShellScriptBuildPhase['"]/);
  });

  test('always_out_of_date is set to "1" ONLY when the phase has no outputs', () => {
    // The fix proper: mark no-output phases always-out-of-date (the
    // warning's own remedy). Critically it must be CONDITIONAL — applying
    // it to phases that declare outputs would disable their dependency
    // analysis and make them run every build (a performance regression and
    // the opposite of the intent). Pin both the output check and the
    // guarded assignment.
    expect(podfile).toMatch(/output_paths/);
    expect(podfile).toMatch(/output_file_list_paths/);
    // The assignment is guarded by `unless has_outputs` (i.e. only no-output
    // phases). Match across the variable so a blanket unconditional
    // `phase.always_out_of_date = '1'` (no guard) does NOT satisfy it.
    expect(podfile).toMatch(/has_outputs\s*=/);
    expect(podfile).toMatch(/phase\.always_out_of_date = ['"]1['"] unless has_outputs/);
  });

  test('documents that this is intent-declaration, not suppression', () => {
    // Per the never-suppress rule, any "silence the warning" change must
    // carry a justification or it is indistinguishable from suppression.
    expect(podfile).toMatch(/not suppression|NOT suppression/i);
  });
});

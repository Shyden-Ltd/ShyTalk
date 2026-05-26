/**
 * PR Checks iOS E2E gating regression test.
 *
 * The `ios-e2e` job in `.github/workflows/pr-checks.yml` should mirror
 * the `android-e2e` job's gating pattern: run when iOS-relevant code
 * (app/, shared/, iosApp/, gradle files — same set that flips
 * `detect-changes.outputs.app_changed`) actually changes, AND respect
 * the `[skip-ios-e2e]` PR-body marker.
 *
 * Before this test was added, the workflow passed `ios: 'none'` to
 * ios-tests.yml unconditionally, so the iOS E2E job was effectively
 * dead code — its skeleton ran but the device matrix expanded to zero
 * and no actual tests executed. That's an asymmetry with android-e2e
 * (`android: '33-phone'`) without any documented rationale, and it
 * silently dropped iOS coverage on every PR — including PRs that touched
 * iOS files. This test pins the corrected gating in place so a future
 * change can't quietly disable iOS coverage again.
 *
 * Implementation: regex assertions on the raw workflow YAML. A full
 * YAML parser dependency is overkill for the surface we're testing
 * (~30 lines of one job block), and avoids dragging js-yaml into the
 * test runtime just for this.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PR_CHECKS_PATH = path.join(REPO_ROOT, '.github/workflows/pr-checks.yml');

function extractIosE2eJob(yamlText) {
  // Capture the ios-e2e job block: from `  ios-e2e:` to the next
  // top-level job declaration (a line starting with two spaces + word
  // + colon). The lazy `[\s\S]+?` keeps the capture small, and the
  // lookahead anchors on the next job header (`gate:` currently
  // follows `ios-e2e:` in pr-checks.yml). If ios-e2e ever becomes the
  // last job, this match will fail loudly and the test driver will
  // raise the diagnostic below — that's the desired failure mode.
  const match = yamlText.match(/^ {2}ios-e2e:\n([\s\S]+?)(?=^ {2}\w[\w-]*:\n)/m);
  if (!match) {
    throw new Error(
      `Could not locate the ios-e2e job in ${PR_CHECKS_PATH}. The job ` +
        'declaration moved or was deleted — update this test to match.',
    );
  }
  return match[1];
}

describe('pr-checks.yml — ios-e2e job gating', () => {
  let yamlText;
  let iosE2eBlock;

  beforeAll(() => {
    yamlText = fs.readFileSync(PR_CHECKS_PATH, 'utf8');
    iosE2eBlock = extractIosE2eJob(yamlText);
  });

  test('ios-e2e job exists in pr-checks.yml', () => {
    expect(iosE2eBlock).toMatch(/uses:\s+\.\/\.github\/workflows\/ios-tests\.yml/);
  });

  test('passes a non-empty device matrix to ios-tests.yml (not "none")', () => {
    // The literal `ios: 'none'` makes ios-tests.yml resolve to zero
    // devices and the actual E2E job is skipped — leaving the PR
    // checks reporting iOS as green when nothing was actually tested.
    // Anything other than 'none' is acceptable; the test gates against
    // the specific historical regression.
    const iosInputMatch = iosE2eBlock.match(/\bios:\s+'([^']+)'/);
    expect(iosInputMatch).toBeTruthy();
    const iosValue = iosInputMatch[1];
    expect(iosValue).not.toBe('none');
  });

  test('default device is the latest-iOS iPhone (cheapest single matrix entry)', () => {
    // Pin the specific choice so future changes are deliberate. If
    // matrix policy changes (e.g. add iPad or older iOS by default),
    // update this assertion at the same time.
    //
    // Bumped 2026-05-22 from `18.1-iphone` to `26.2-iphone` (the
    // latest iOS runtime pre-installed on macos-15 via Xcode 26.3).
    // See tests/scripts/ios-26-xcode-bump.test.js for the
    // co-required Xcode 26.3 selection in ios-tests.yml.
    expect(iosE2eBlock).toMatch(/\bios:\s+'26\.2-iphone'/);
  });

  test('job-level if-gate uses ios_app_changed + skip-marker (updated 2026-05-25 from app_changed split)', () => {
    // The ios-e2e job fires when iOS-relevant code changes AND
    // the PR-body marker `[skip-ios-e2e]` is not set. Originally
    // gated on `app_changed`; switched to `ios_app_changed`
    // 2026-05-25 so Android-only PRs (and release PRs touching
    // only app/build.gradle.kts) no longer trigger the ~45min
    // iOS pipeline. Without both checks present we either
    // over-fire (every PR including workflow-only) or fail to
    // honour the operator escape hatch.
    expect(iosE2eBlock).toMatch(/needs\.detect-changes\.outputs\.ios_app_changed\s*==\s*'true'/);
    expect(iosE2eBlock).toMatch(/needs\.detect-changes\.outputs\.skip_ios_e2e\s*!=\s*'true'/);
    // Negative: the legacy app_changed reference must NOT appear
    // in this job's if: block — the whole point of the split.
    expect(iosE2eBlock).not.toMatch(/needs\.detect-changes\.outputs\.app_changed/);
  });

  test('parallel mode is on (same as android-e2e)', () => {
    expect(iosE2eBlock).toMatch(/parallel:\s+true/);
  });
});

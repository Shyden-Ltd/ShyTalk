/**
 * Asserts the CI artifact surface needed for autonomous install of
 * dev + local flavors on both Android devices and iPhones.
 *
 * Today's gap (audit 2026-05-21):
 *   - Android dev:    pr-checks.yml uploads `dev-release-apk` ✓
 *   - Android local:  NO local-debug build target in CI → no artifact
 *   - iOS dev:        deploy-dev.yml exports an IPA to $RUNNER_TEMP
 *                     but uploads only to TestFlight, no workflow
 *                     artifact → can't be `gh run download`'d
 *   - iOS local:      no Xcode scheme exists for local flavor →
 *                     deferred; not covered by this test
 *
 * This PR adds the missing two artifact uploads so an AFK operator
 * (or automation) can install fresh Android local / iOS dev builds
 * without manual TestFlight invites or local builds.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PR_CHECKS_PATH = path.join(REPO_ROOT, '.github/workflows/pr-checks.yml');
const DEPLOY_DEV_PATH = path.join(REPO_ROOT, '.github/workflows/deploy-dev.yml');

describe('CI artifact surface for AFK install', () => {
  describe('pr-checks.yml — Android local-flavor APK', () => {
    let yamlText;

    beforeAll(() => {
      yamlText = fs.readFileSync(PR_CHECKS_PATH, 'utf8');
    });

    test('runs assembleLocalDebug somewhere in the workflow', () => {
      // Either alongside the existing assembleDevRelease or in a
      // dedicated step — gradle is happy either way. Both build
      // KMP shared once and reuse it for both flavors.
      expect(yamlText).toMatch(/\bassembleLocalDebug\b/);
    });

    test('uploads the local-debug APK as a workflow artifact', () => {
      // Operator pulls via `gh run download <run-id> -n local-debug-apk`
      // mirroring the existing dev-release-apk download path.
      expect(yamlText).toMatch(/name:\s+local-debug-apk/);
    });
  });

  describe('deploy-dev.yml — iOS dev IPA artifact', () => {
    let yamlText;

    beforeAll(() => {
      yamlText = fs.readFileSync(DEPLOY_DEV_PATH, 'utf8');
    });

    test('uploads the exported IPA as a workflow artifact', () => {
      // The xcodebuild -exportArchive step already writes the IPA to
      // $RUNNER_TEMP/export/*.ipa for the subsequent TestFlight upload
      // step. We just need an actions/upload-artifact step in between
      // (or after) so AFK install can grab it without needing a
      // TestFlight tester invite.
      expect(yamlText).toMatch(/name:\s+dev-ios-ipa/);
    });

    test('IPA artifact path points at the export directory', () => {
      // The export dir is `${{ runner.temp }}/export` (Actions
      // expression syntax — required in `path:` fields where shell
      // env vars like $RUNNER_TEMP are NOT expanded). Asserting the
      // path uses the runner.temp reference avoids a future
      // move-the-IPA-elsewhere change silently breaking this.
      expect(yamlText).toMatch(/name: dev-ios-ipa/);
      expect(yamlText).toMatch(/path:\s+\$\{\{\s*runner\.temp\s*\}\}\/export\/\*\.ipa/);
    });
  });
});

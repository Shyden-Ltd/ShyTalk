/**
 * iOS deploy archive must NOT force a global manual provisioning profile (#8).
 *
 * The #841 LiveKit CocoaPods→SPM migration added SwiftPM resource-bundle
 * targets (SwiftProtobuf_SwiftProtobuf, LiveKit_LiveKit) that "do not support
 * provisioning profiles". Passing PROVISIONING_PROFILE_SPECIFIER /
 * CODE_SIGN_STYLE=Manual as GLOBAL xcodebuild build settings at archive time
 * applied the distribution profile to those targets too and failed the archive
 * (`** ARCHIVE FAILED **`, exit 65) — blocking all iOS dev + prod deploys.
 *
 * The fix archives with AUTOMATIC signing (-allowProvisioningUpdates + the ASC
 * API key so Xcode resolves the app target's profile headlessly), then
 * -exportArchive re-signs for distribution via ExportOptions.plist, which maps
 * the profile per-bundle-ID (com.shyden.shytalk only). This test locks that in
 * so a future edit can't reintroduce the global manual override that breaks the
 * SPM targets.
 */

const fs = require('fs');
const path = require('path');

const WORKFLOWS = ['deploy-dev.yml', 'deploy-prod.yml'];
const workflowPath = (name) => path.join(__dirname, '../../../.github/workflows', name);
const EXPORT_OPTIONS = path.join(__dirname, '../../../iosApp/ExportOptions.plist');

// Strip comment lines so the explanatory comments — which intentionally name
// the very tokens we forbid, to document why — don't cause false matches. We
// assert against the actual xcodebuild commands only.
const stripComments = (yaml) =>
  yaml
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

describe('iOS deploy archive signing (#8 regression guard)', () => {
  test.each(WORKFLOWS)('%s archives with automatic signing, no global manual profile', (name) => {
    const src = stripComments(fs.readFileSync(workflowPath(name), 'utf8'));
    // The global manual override (build settings, `TOKEN=value`) is exactly
    // what broke the SPM resource bundles.
    expect(src).not.toMatch(/PROVISIONING_PROFILE_SPECIFIER=/);
    expect(src).not.toMatch(/CODE_SIGN_STYLE=Manual/);
    // Automatic signing + ASC key so Xcode resolves the app's profile in CI.
    expect(src).toMatch(/-allowProvisioningUpdates/);
  });

  test('ExportOptions.plist still re-signs for distribution, scoped per-bundle-ID', () => {
    const src = fs.readFileSync(EXPORT_OPTIONS, 'utf8');
    // Distribution signing now happens ONLY at export, mapped to the app bundle.
    expect(src).toMatch(/<key>signingStyle<\/key>\s*<string>manual<\/string>/);
    expect(src).toMatch(/com\.shyden\.shytalk/);
    expect(src).toMatch(/ShyTalk App Store Distribution/);
  });
});

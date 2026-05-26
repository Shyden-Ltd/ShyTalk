/**
 * iOS deploy archive signing (#8 regression guard).
 *
 * The #841 LiveKit CocoaPods→SPM migration broke the deploy archive. Three
 * CLI-global signing approaches all fail, because xcodebuild build settings are
 * GLOBAL (they hit every target, including the SwiftPM resource bundles
 * SwiftProtobuf_SwiftProtobuf / LiveKit_LiveKit):
 *   - manual-global (CODE_SIGN_STYLE=Manual + PROVISIONING_PROFILE_SPECIFIER)
 *     forces a profile onto those bundles, which "do not support provisioning
 *     profiles" → ** ARCHIVE FAILED ** (exit 65);
 *   - automatic (-allowProvisioningUpdates) tries to mint an iOS *Development*
 *     profile, which needs registered devices the runner lacks (exit 65);
 *   - unsigned archive + export-resign risks dropping Push entitlements.
 *
 * The fix signs the app PER-TARGET in project.pbxproj (the iosApp Release
 * config: CODE_SIGN_STYLE=Manual + "Apple Distribution" identity + "ShyTalk App
 * Store Distribution" profile). Per-target reaches only the app, so the SPM
 * bundles keep their defaults; the App Store profile needs no devices; and the
 * entitlements (CODE_SIGN_ENTITLEMENTS) are preserved by a real archive sign.
 * -exportArchive then exports for App Store via ExportOptions.plist.
 *
 * Pins: (a) the workflows pass NO global signing override on the archive;
 * (b) the pbxproj app Release config carries the manual distribution signing;
 * (c) ExportOptions still does manual per-bundle-ID distribution.
 */

const fs = require('fs');
const path = require('path');

const WORKFLOWS = ['deploy-dev.yml', 'deploy-prod.yml'];
const workflowPath = (name) => path.join(__dirname, '../../../.github/workflows', name);
const EXPORT_OPTIONS = path.join(__dirname, '../../../iosApp/ExportOptions.plist');
const PBXPROJ = path.join(__dirname, '../../../iosApp/iosApp.xcodeproj/project.pbxproj');

// Strip comment lines so the explanatory comments — which intentionally name
// the forbidden tokens to document why — don't cause false matches.
const stripComments = (yaml) =>
  yaml
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

describe('iOS deploy archive signing (#8 regression guard)', () => {
  test.each(WORKFLOWS)('%s passes no global signing override on the archive', (name) => {
    const src = stripComments(fs.readFileSync(workflowPath(name), 'utf8'));
    // Global build settings hit every target incl. the SPM resource bundles —
    // signing belongs in the pbxproj (per-target), not on the CLI.
    expect(src).not.toMatch(/PROVISIONING_PROFILE_SPECIFIER=/);
    expect(src).not.toMatch(/CODE_SIGN_STYLE=Manual/);
    expect(src).not.toMatch(/CODE_SIGN_IDENTITY=/);
    // -allowProvisioningUpdates is the automatic path that needs devices.
    expect(src).not.toMatch(/-allowProvisioningUpdates/);
  });

  test('iosApp Release config is manual-signed for distribution in pbxproj', () => {
    const src = fs.readFileSync(PBXPROJ, 'utf8');
    expect(src).toMatch(/CODE_SIGN_STYLE = Manual;/);
    expect(src).toMatch(/PROVISIONING_PROFILE_SPECIFIER = "ShyTalk App Store Distribution";/);
    expect(src).toMatch(/CODE_SIGN_IDENTITY = "Apple Distribution";/);
  });

  test('ExportOptions.plist exports for distribution, scoped per-bundle-ID', () => {
    const src = fs.readFileSync(EXPORT_OPTIONS, 'utf8');
    expect(src).toMatch(/<key>signingStyle<\/key>\s*<string>manual<\/string>/);
    expect(src).toMatch(/com\.shyden\.shytalk/);
    expect(src).toMatch(/ShyTalk App Store Distribution/);
  });
});

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

describe('iOS deploy archive timing instrumentation (SHY-0088)', () => {
  // The archive action is a line that is exactly `archive` (the export call's
  // action is the inline `-exportArchive` flag; the smoke job builds with
  // `build`). Walk back from that line to its owning `xcodebuild` line to
  // isolate the archive invocation — so we assert the flag is on IT, not merely
  // somewhere in the file (a whole-file grep would also match the
  // comment-stripped export call). Line-based on purpose: a single span regex
  // across the block backtracks catastrophically (sonarjs/slow-regex).
  const archiveInvocation = (src) => {
    const lines = src.split('\n');
    const end = lines.findIndex((l) => l.trim() === 'archive');
    if (end === -1) return null;
    let start = end;
    while (start >= 0 && !/^\s*xcodebuild\b/.test(lines[start])) start -= 1;
    return start >= 0 ? lines.slice(start, end + 1).join('\n') : null;
  };

  test.each(WORKFLOWS)('%s runs the archive with -showBuildTimingSummary', (name) => {
    const src = stripComments(fs.readFileSync(workflowPath(name), 'utf8'));
    const archive = archiveInvocation(src);
    expect(archive).not.toBeNull();
    expect(archive).toMatch(/-showBuildTimingSummary\b/);
  });

  test.each(WORKFLOWS)(
    '%s puts -showBuildTimingSummary ONLY on the archive, not -exportArchive',
    (name) => {
      const src = stripComments(fs.readFileSync(workflowPath(name), 'utf8'));
      // Exactly one occurrence: combined with the archive-isolation test above,
      // this proves the flag is on the archive call and not duplicated onto the
      // export call (which would time a no-compilation step).
      const occurrences = (src.match(/-showBuildTimingSummary\b/g) || []).length;
      expect(occurrences).toBe(1);
    },
  );

  // SHY-0195: the macOS runner image 20260630.0213.1 stopped inferring a
  // destination from `-sdk iphoneos` alone — `xcodebuild … archive` died with
  // "Found no destinations for the scheme 'iosApp' and action archive"
  // (an EMPTY destination list) on every dev deploy from 2026-07-11. The
  // explicit generic device destination is the canonical, version-proof form;
  // this pins it on the archive invocation of BOTH deploy workflows so the
  // prod workflow's identical latent copy can never regress back either.
  test.each(WORKFLOWS)(
    "%s archives with an explicit -destination 'generic/platform=iOS'",
    (name) => {
      const src = stripComments(fs.readFileSync(workflowPath(name), 'utf8'));
      const archive = archiveInvocation(src);
      expect(archive).not.toBeNull();
      expect(archive).toMatch(/-destination ['"]generic\/platform=iOS['"]/);
    },
  );

  test.each(WORKFLOWS)(
    '%s does not leak -destination onto the -exportArchive call (review SHY-0195 Imp #1)',
    (name) => {
      const src = stripComments(fs.readFileSync(workflowPath(name), 'utf8'));
      // Mirror of the -showBuildTimingSummary exclusivity guard above: the
      // destination belongs to the archive compile only; the export step
      // operates on the finished .xcarchive and takes no destination.
      const exportIdx = src.indexOf('-exportArchive');
      expect(exportIdx).toBeGreaterThan(-1);
      expect(src.slice(exportIdx, exportIdx + 500)).not.toMatch(/-destination\b/);
    },
  );

  // SHY-0195 root cause #2 (verification run 29478170583): runner image
  // 20260630.0213.1 ships the default Xcode WITHOUT the iOS platform runtime
  // (Apple split platform runtimes out of the Xcode bundle) — the archive
  // then dies with "iOS 26.0 is not installed" (exit 70) even with the
  // explicit generic destination; the original "Found no destinations" empty
  // list was the same gap pre-destination. The workflow must assert its own
  // dependency: `sudo xcodebuild -downloadPlatform iOS` BEFORE the archive
  // invocation, so the pipeline is image-proof instead of trusting what the
  // runner pre-installs. Idempotency verified empirically (2026-07-16, review
  // finding #1): on a host with the platform already installed the command
  // exits 0 in <1s — it does NOT share the Metal-Toolchain -importComponent
  // exit-70 "already installed" failure mode. Line-order pin, matching the
  // line-based style above.
  test.each(WORKFLOWS)(
    '%s installs the iOS platform runtime BEFORE the archive invocation, in the same job',
    (name) => {
      const src = stripComments(fs.readFileSync(workflowPath(name), 'utf8'));
      const lines = src.split('\n');
      const installLine = lines.findIndex((l) => /sudo xcodebuild -downloadPlatform iOS\b/.test(l));
      const archiveActionLine = lines.findIndex((l) => l.trim() === 'archive');
      expect(installLine).toBeGreaterThan(-1);
      expect(archiveActionLine).toBeGreaterThan(-1);
      // Walk back from the action line to its owning xcodebuild call (same
      // isolation archiveInvocation uses) so the order pin compares against
      // the REAL archive invocation, not merely any line spelling `archive`.
      let archiveStart = archiveActionLine;
      while (archiveStart >= 0 && !/^\s*xcodebuild\b/.test(lines[archiveStart])) archiveStart -= 1;
      expect(archiveStart).toBeGreaterThan(-1);
      expect(installLine).toBeLessThan(archiveStart);
      // No job boundary in the span: `runs-on:` only ever appears at a job's
      // top level, so its absence proves install + archive live in the SAME
      // job (an install in an earlier job would leave the archive job on a
      // fresh runner without the platform). Per-line test, not an /m span
      // regex, per this file's slow-regex convention.
      const between = lines.slice(installLine + 1, archiveStart);
      expect(between.some((l) => /^\s*runs-on:/.test(l))).toBe(false);
    },
  );

  // Hang-mitigation steps pin their own cap (ios-konan-cache-no-hang.test.js
  // convention): the install step exists to bound a potentially-slow network
  // fetch, so losing its timeout-minutes would only ever resurface as a real
  // multi-hour CI hang.
  test.each(WORKFLOWS)('%s bounds the platform-install step with timeout-minutes: 20', (name) => {
    const src = stripComments(fs.readFileSync(workflowPath(name), 'utf8'));
    const lines = src.split('\n');
    const installLine = lines.findIndex((l) => /sudo xcodebuild -downloadPlatform iOS\b/.test(l));
    expect(installLine).toBeGreaterThan(-1);
    // Scope to the install step's own block (walk to its `- name:` header
    // and to the next step header) so the pin can't drift onto a sibling
    // step's timeout.
    let start = installLine;
    while (start >= 0 && !/^\s*- name:/.test(lines[start])) start -= 1;
    let end = installLine + 1;
    while (end < lines.length && !/^\s*- name:/.test(lines[end])) end += 1;
    expect(start).toBeGreaterThan(-1);
    expect(lines.slice(start, end).join('\n')).toMatch(/timeout-minutes:\s*20\b/);
  });

  // The install step's 20-min cap stacks with the archive step's 50-min cap
  // plus ~35-55 min of other legitimate job overhead (see the job's tuning
  // comment): a slow-but-not-hung worst case can exceed the old 100-min job
  // envelope, which would fire the OPAQUE outer job timeout the step-level
  // fuses exist to pre-empt. ≥120 keeps the step caps as the first fuse.
  const ARCHIVE_JOBS = { 'deploy-dev.yml': 'distribute-ios', 'deploy-prod.yml': 'deploy-ios-prod' };
  test.each(WORKFLOWS)('%s archive job envelope is ≥ 120 min so step fuses fire first', (name) => {
    const src = fs.readFileSync(workflowPath(name), 'utf8');
    const lines = src.split('\n');
    const jobStart = lines.findIndex((l) => new RegExp(`^ {2}${ARCHIVE_JOBS[name]}:\\s*$`).test(l));
    expect(jobStart).toBeGreaterThan(-1);
    let jobEnd = jobStart + 1;
    while (jobEnd < lines.length && !/^ {2}[\w-]+:/.test(lines[jobEnd])) jobEnd += 1;
    const job = lines.slice(jobStart, jobEnd).join('\n');
    const match = job.match(/^ {4}timeout-minutes:[ \t]*(\d+)/m);
    expect(match).not.toBeNull();
    expect(parseInt(match[1], 10)).toBeGreaterThanOrEqual(120);
  });
});

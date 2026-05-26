/**
 * Pins the iOS local-flavor Build Configuration file's existence
 * and key build-setting variables.
 *
 * This file is the foundation of the iOS-local flavor — a sibling of
 * the Android `local` product flavor declared in `app/build.gradle.kts`.
 * Like Android local, it points the app at:
 *   - localhost Express API (port 3000)
 *   - localhost LiveKit signalling (port 7880)
 *   - The `demo-shytalk` Firebase Emulator project (Firestore/Auth)
 *   - The RTDB emulator (port 9000, namespace `demo-shytalk-default-rtdb`)
 *   - A `.local` bundle-id suffix so it can be installed alongside the
 *     dev variant on a single device
 *
 * Phase 3.1 (this PR) adds the file in isolation — it is NOT yet
 * referenced by the Xcode project. Subsequent sub-PRs handle pbxproj
 * surgery (3.2), scheme (3.3), GoogleService-Info + AppDelegate logic
 * (3.4), and CI integration (3.5).
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const XCCONFIG_PATH = path.join(REPO_ROOT, 'iosApp/Configurations/Local.xcconfig');

describe('iosApp/Configurations/Local.xcconfig', () => {
  let xcconfigText;

  beforeAll(() => {
    // Guard rather than assert — keeps the failure origin readable.
    // The named "file exists at the expected path" test below is the
    // canonical existence assertion. If the file is missing, this
    // guard throws with a clear message and Jest reports a setup
    // failure pointing at the right line.
    if (!fs.existsSync(XCCONFIG_PATH)) {
      throw new Error(`xcconfig not found at expected path: ${XCCONFIG_PATH}`);
    }
    xcconfigText = fs.readFileSync(XCCONFIG_PATH, 'utf8');
  });

  test('file exists at the expected path', () => {
    expect(fs.existsSync(XCCONFIG_PATH)).toBe(true);
  });

  // Mirror of Android's `applicationIdSuffix = ".local"`. Allows the
  // local-flavor iOS app to be installed alongside the dev variant
  // on the same physical device for side-by-side comparison.
  test('declares BUNDLE_ID_SUFFIX = .local', () => {
    expect(xcconfigText).toMatch(/^BUNDLE_ID_SUFFIX\s*=\s*\.local$/m);
  });

  // Operator-overridable. Default `localhost` works on iOS Simulator
  // (shares the Mac's network namespace). For a physical iPhone the
  // operator must override to the Mac's local-network IP or mDNS .local
  // hostname at build time:
  //
  //   xcodebuild -configuration Debug-Local LOCAL_HOST=Macbook.local …
  //
  // Documented in the xcconfig's comment block; pinned at the variable
  // value level here.
  test('declares LOCAL_HOST variable (defaults to localhost)', () => {
    expect(xcconfigText).toMatch(/^LOCAL_HOST\s*=\s*localhost$/m);
  });

  // Variable interpolation in xcconfig uses the `$(VAR)` form. NOT
  // `${VAR}` — that's the shell idiom and would be a silent no-op in
  // Xcode build settings (the value would be literal `${LOCAL_HOST}`
  // instead of being expanded).
  test('declares LOCAL_API_BASE_URL pointing at $(LOCAL_HOST):3000', () => {
    expect(xcconfigText).toMatch(/^LOCAL_API_BASE_URL\s*=\s*http:\/\/\$\(LOCAL_HOST\):3000$/m);
  });

  // LiveKit signalling port. The Docker container also exposes 7881
  // and 7882 for WebRTC media — the SFU advertises those back during
  // the signalling handshake, so we only point at 7880 here.
  test('declares LOCAL_LIVEKIT_URL pointing at $(LOCAL_HOST):7880', () => {
    expect(xcconfigText).toMatch(/^LOCAL_LIVEKIT_URL\s*=\s*ws:\/\/\$\(LOCAL_HOST\):7880$/m);
  });

  // Matches the `--project=demo-shytalk` flag in
  // `firebase emulators:start` (local/start.sh Step 2). The `demo-`
  // prefix is Firebase's emulator-only namespace.
  test('declares LOCAL_FIREBASE_PROJECT_ID = demo-shytalk', () => {
    expect(xcconfigText).toMatch(/^LOCAL_FIREBASE_PROJECT_ID\s*=\s*demo-shytalk$/m);
  });

  // RTDB emulator endpoint. Sibling of Android's `RTDB_URL` in
  // app/build.gradle.kts. The `?ns=…` query string is the namespace
  // selector the Firebase RTDB emulator expects.
  test('declares LOCAL_FIREBASE_RTDB_URL pointing at $(LOCAL_HOST):9000 with namespace', () => {
    expect(xcconfigText).toMatch(
      /^LOCAL_FIREBASE_RTDB_URL\s*=\s*http:\/\/\$\(LOCAL_HOST\):9000\?ns=demo-shytalk-default-rtdb$/m,
    );
  });

  // Pin the total variable count so a stray addition (typo, copy-paste,
  // experimental key) doesn't silently land alongside the documented
  // six. Six values × 1 line each, no continuation lines in the
  // current file.
  test('contains exactly six variable declarations', () => {
    const varLines = xcconfigText.match(/^[A-Z_][A-Z0-9_]*\s*=/gm);
    expect(varLines).not.toBeNull();
    expect(varLines.length).toBe(6);
  });

  // Phase 3.2 may add `#include "Pods/Target Support Files/…"` once
  // CocoaPods integration cascades. For Phase 3.1, no #include should
  // exist — the file is standalone. Pinning this catches a premature
  // include sneaking in via copy-paste from another xcconfig.
  test('contains no #include directives in Phase 3.1', () => {
    expect(xcconfigText).not.toMatch(/^#include/m);
  });

  // Xcode's own file editor ends xcconfig files with a trailing
  // newline. A tool that strips it would silently churn the file on
  // every save. Pin it.
  test('ends with a single trailing newline', () => {
    expect(xcconfigText.endsWith('\n')).toBe(true);
    expect(xcconfigText.endsWith('\n\n')).toBe(false);
  });

  // Defensive trip-wire against the most common xcconfig-newbie
  // mistake: writing `${LOCAL_HOST}` (shell expansion) where
  // `$(LOCAL_HOST)` (Xcode build-setting expansion) is required.
  // The shell form is a silent no-op in Xcode — the value becomes
  // the literal `${LOCAL_HOST}` string rather than being substituted.
  // No value line should contain the `${…}` shape.
  test('no value line uses shell-style ${VAR} expansion (xcconfig requires $(VAR))', () => {
    const valueLines = xcconfigText.split('\n').filter((l) => /^[A-Z_][A-Z0-9_]*\s*=/.test(l));
    expect(valueLines.length).toBeGreaterThan(0);
    valueLines.forEach((line) => {
      expect(line).not.toMatch(/\$\{[A-Z_]/);
    });
  });
});

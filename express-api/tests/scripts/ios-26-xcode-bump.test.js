/**
 * ios-tests.yml + pr-checks.yml — iOS 26.2 + Xcode 26.3 bump
 *
 * The macos-15 runner ships with BOTH Xcode 16.x (default) and
 * Xcode 26.x pre-installed. The default `xcode-select` points at
 * 16.4, which caps iOS testing at 18.5. To run iOS 26.2 — the
 * latest available simulator runtime — the workflow must explicitly
 * switch to Xcode 26.3 (matching iOS 26.2's bundled toolchain).
 *
 * Scope of this PR:
 *   - Add iOS 26.2 row to IOS_ALL (iphone form-factor only; ipad
 *     can come later)
 *   - Add `Select Xcode 26.3` step in build-ios (before the KMP
 *     framework build) and in test-ios (before the simulator
 *     runtime install)
 *   - Bump pr-checks default ios input from `18.1-iphone` to
 *     `26.2-iphone`
 *
 * These tests pin the resulting workflow shape so a future runner-
 * image change (e.g. Xcode 26.4 replacing 26.3) is a single-file
 * update rather than a silent dropped-version.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const IOS_TESTS_YML = path.join(REPO_ROOT, '.github/workflows/ios-tests.yml');
const PR_CHECKS_YML = path.join(REPO_ROOT, '.github/workflows/pr-checks.yml');
const XCODE_PATH = '/Applications/Xcode_26.3.app';

describe('ios-tests.yml — iOS 26.2 + Xcode 26.3 bump', () => {
  let yamlText;

  beforeAll(() => {
    yamlText = fs.readFileSync(IOS_TESTS_YML, 'utf8');
  });

  describe('IOS_ALL catalog', () => {
    test('contains an iOS 26.2 iphone entry with iPhone 17 simulator', () => {
      // The simulator name "iPhone 17" is the canonical 2025-model
      // iPhone bundled with the Xcode 26.x toolchain. Pinned by the
      // runner-image readme: actions/runner-images macos-15 docs
      // list iPhone 17 as an iOS 26.2 simulator device.
      expect(yamlText).toMatch(
        /\{\s*'ios-version':\s*'26\.2',\s*'form-factor':\s*'iphone',\s*simulator:\s*'iPhone 17'\s*\}/,
      );
    });
  });

  describe('Xcode 26.3 selection', () => {
    test('build-ios job has a Select Xcode 26.3 step', () => {
      // Anchored on the full 6-space step header so a comment cannot
      // satisfy the assertion.
      expect(yamlText).toContain('      - name: Select Xcode 26.3');
    });

    test('Select Xcode step uses sudo xcode-select with the Xcode 26.3 path', () => {
      const stepHeader = '      - name: Select Xcode 26.3';
      const startIdx = yamlText.indexOf(stepHeader);
      expect(startIdx).toBeGreaterThanOrEqual(0);
      const rest = yamlText.slice(startIdx);
      const nextStepIdx = rest.indexOf('\n      - ', stepHeader.length);
      const stepBody = nextStepIdx > 0 ? rest.slice(0, nextStepIdx) : rest;
      expect(stepBody).toContain('sudo xcode-select');
      expect(stepBody).toContain(XCODE_PATH);
    });

    test('Select Xcode step runs BEFORE the KMP framework build', () => {
      // build-ios uses Xcode 26.3 from the start so the produced
      // .xctest bundle is built against the latest SDK. Otherwise
      // the bundle is built with Xcode 16.4 and the iOS 26.2 sim
      // may not be able to load it (forward-compat is not
      // guaranteed across major Xcode versions).
      const selectIdx = yamlText.indexOf('      - name: Select Xcode 26.3');
      const kmpIdx = yamlText.indexOf('      - name: Build shared KMP framework for iOS Simulator');
      expect(selectIdx).toBeGreaterThanOrEqual(0);
      expect(kmpIdx).toBeGreaterThanOrEqual(0);
      expect(selectIdx).toBeLessThan(kmpIdx);
    });

    test('Select Xcode step appears in test-ios job too', () => {
      // The test-ios matrix runs against iOS 26.2 simulators which
      // only ship inside Xcode 26.x. xcrun simctl uses the active
      // Xcode's runtime catalog, so test-ios must also select 26.3.
      // Count: should be at least 2 occurrences (build-ios + test-ios).
      const matches = yamlText.match(/^ {6}- name: Select Xcode 26\.3$/gm);
      expect(matches).not.toBeNull();
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    // Round 1 I-2: the build-ios body test above used indexOf which
    // only inspects the FIRST occurrence. The test-ios occurrence's
    // body content is unverified by that test. Find the SECOND
    // occurrence explicitly and assert its body too — without this,
    // a refactor that removes `sudo xcode-select ...` from the
    // test-ios step body (but leaves the step header) silently
    // breaks iOS 26.2 sim creation.
    test('test-ios Select Xcode step body has sudo xcode-select with Xcode 26.3 path', () => {
      const stepHeader = '      - name: Select Xcode 26.3';
      const firstIdx = yamlText.indexOf(stepHeader);
      expect(firstIdx).toBeGreaterThanOrEqual(0);
      const secondIdx = yamlText.indexOf(stepHeader, firstIdx + 1);
      expect(secondIdx).toBeGreaterThan(firstIdx);
      const rest = yamlText.slice(secondIdx);
      const nextStepIdx = rest.indexOf('\n      - ', stepHeader.length);
      const stepBody = nextStepIdx > 0 ? rest.slice(0, nextStepIdx) : rest;
      expect(stepBody).toContain('sudo xcode-select');
      expect(stepBody).toContain(XCODE_PATH);
    });

    // Round 1 I-1: ordering of the test-ios Xcode-select step
    // relative to `Download iOS test bundle` is unprotected by the
    // build-ios ordering test (which only knows about `Build shared
    // KMP framework`). A refactor that swaps these two steps in
    // test-ios would silently break iOS 26.2 sim resolution because
    // simctl wouldn't see the 26.x runtime catalog when called by
    // subsequent steps.
    test('Select Xcode step in test-ios runs BEFORE Download iOS test bundle', () => {
      const stepHeader = '      - name: Select Xcode 26.3';
      const firstIdx = yamlText.indexOf(stepHeader);
      const secondIdx = yamlText.indexOf(stepHeader, firstIdx + 1);
      const downloadIdx = yamlText.indexOf('      - name: Download iOS test bundle');
      expect(secondIdx).toBeGreaterThan(0);
      expect(downloadIdx).toBeGreaterThan(0);
      expect(secondIdx).toBeLessThan(downloadIdx);
    });
  });
});

describe('pr-checks.yml — default ios input bump', () => {
  let yamlText;

  beforeAll(() => {
    yamlText = fs.readFileSync(PR_CHECKS_YML, 'utf8');
  });

  test('ios-e2e gate dispatches with ios: 26.2-iphone (was 18.1-iphone)', () => {
    // The previous default `18.1-iphone` capped CI iOS testing at
    // last-year's iOS. Bumping to `26.2-iphone` exercises the
    // latest runtime that the macos-15 runner ships pre-installed.
    expect(yamlText).toMatch(/ios:\s*['"]26\.2-iphone['"]/);
    expect(yamlText).not.toMatch(/ios:\s*['"]18\.1-iphone['"]/);
  });
});

/**
 * deploy-dev.yml ↔ ios-tests.yml — iOS cache share contract.
 *
 * Triggered by: 2026-05-25 observation that PR-branch iOS Build
 * hit cold caches even though main had been building iOS daily via
 * deploy-dev.yml. Cause: deploy-dev's cache steps used different
 * paths AND keys from ios-tests.yml, so PR-branch CI could never
 * restore from main's saved cache.
 *
 * Architectural constraint: deploy-dev builds for `iphoneos` SDK
 * (device, arm64) while ios-tests.yml builds for iOS Simulator
 * (arm64-sim). The two compiled DerivedData trees are NOT
 * interchangeable. So:
 *   - DerivedData cache: stays SEPARATE between the two workflows
 *     (different target = different artifacts)
 *   - Konan toolchain cache: SHARED (already aligned pre-2026-05-25
 *     via identical keys)
 *   - KMP shared framework cache: SEPARATE (device-arm64 framework
 *     ≠ simulator-arm64 framework)
 *   - **CocoaPods spec repos cache: SHARED** (system-wide, target-
 *     independent)
 *   - **CocoaPods Pods cache: SHARED** (Podfile.lock-driven, the
 *     installed Pods are the same regardless of build target)
 *   - **SwiftPM cloned-packages cache: SHARED** (SwiftPM source is
 *     platform-agnostic; the compiled artifacts under DerivedData
 *     are not, but the source tree is)
 *
 * Fix (this PR): mirror the 3 SHAREABLE cache steps from
 * ios-tests.yml into deploy-dev.yml with byte-identical keys
 * (same `runner.os`-scoped restore-key prefix, same hashFiles
 * inputs). Add the `-clonedSourcePackagesDirPath build/ios-spm-packages`
 * flag to deploy-dev's archive xcodebuild so the SwiftPM cache
 * has actual content to save. Update the Install CocoaPods step
 * to skip when iosApp/Pods cache hits AND Podfile.lock unchanged
 * (matching ios-tests.yml's optimisation).
 *
 * Expected impact: ~7-10 min off cold-cache PR iOS Build, made
 * possible by main pushes warming the 3 shared caches.
 *
 * Coverage (12 tests):
 *   - 3 shared cache steps exist in deploy-dev.yml with matching
 *     keys to ios-tests.yml (cocoapods-repos, iosApp/Pods,
 *     ios-spm-packages)
 *   - Each cache step has the same restore-key shape (runner.os
 *     scope, defence-in-depth via positive-scope check)
 *   - Pods cache step has `id: pods-cache` for the install skip
 *   - Install CocoaPods step has `--deployment` + cache-hit skip
 *   - Archive xcodebuild has `-clonedSourcePackagesDirPath`
 *     pointing at build/ios-spm-packages
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DEPLOY_DEV_PATH = path.join(REPO_ROOT, '.github/workflows/deploy-dev.yml');
const IOS_TESTS_PATH = path.join(REPO_ROOT, '.github/workflows/ios-tests.yml');

/**
 * Extract the value of `key:` from a cache step block. Uses
 * line-by-line scanning rather than a `\s+`-anchored regex to
 * avoid ReDoS susceptibility flagged by sonarjs/slow-regex.
 */
function extractCacheKey(stepBlock) {
  for (const line of stepBlock.split('\n')) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('key: ')) {
      return trimmed.slice('key: '.length).trim();
    }
  }
  throw new Error('No `key:` line found in cache step block.');
}

/** Same extractStep as the canonical helper. */
function extractStep(yamlText, stepName) {
  const lines = yamlText.split('\n');
  const stepHeader = `      - name: ${stepName}`;
  const matches = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimEnd() === stepHeader) matches.push(i);
  }
  if (matches.length === 0) {
    throw new Error(
      `Could not find step "${stepName}" in workflow file. ` +
        'Step was renamed, removed, or indentation changed (helper ' +
        'requires 6-space step indent) — update this test to match.',
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous step name "${stepName}": found at lines ${matches
        .map((i) => i + 1)
        .join(', ')}. Use a more specific name or scope to a single job.`,
    );
  }
  const startIdx = matches[0];
  let endIdx = startIdx + 1;
  while (endIdx < lines.length) {
    const trimmed = lines[endIdx].trimEnd();
    if (trimmed.startsWith('      - name:')) break;
    if (trimmed.length > 0 && !trimmed.startsWith(' ')) break;
    endIdx++;
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

describe('deploy-dev.yml ↔ ios-tests.yml — shared iOS caches', () => {
  let deployDevYaml;
  let iosTestsYaml;

  beforeAll(() => {
    deployDevYaml = fs.readFileSync(DEPLOY_DEV_PATH, 'utf8');
    iosTestsYaml = fs.readFileSync(IOS_TESTS_PATH, 'utf8');
  });

  describe('CocoaPods spec repos cache (shared system-wide)', () => {
    let step;
    beforeAll(() => {
      step = extractStep(deployDevYaml, 'Cache CocoaPods spec repos (~/.cocoapods/repos)');
    });

    test('exists in deploy-dev with same SHA as ios-tests', () => {
      expect(step).toContain('actions/cache@27d5ce7f107fe9357f9df03efb73ab90386fccae');
    });

    test('targets ~/.cocoapods/repos', () => {
      expect(step).toContain('~/.cocoapods/repos');
    });

    test('key matches ios-tests.yml exactly (so caches share)', () => {
      // ios-tests.yml key is the canonical form. The whole point of
      // this PR is byte-identical alignment so main's saved cache is
      // restorable on PR branches via GH's default-branch fallback.
      const iosTestsStep = extractStep(
        iosTestsYaml,
        'Cache CocoaPods spec repos (~/.cocoapods/repos)',
      );
      const iosTestsKey = extractCacheKey(iosTestsStep);
      const deployDevKey = extractCacheKey(step);
      expect(deployDevKey).toBe(iosTestsKey);
    });

    test('restore-keys is OS-scoped (cocoapods-repos-${{ runner.os }}-)', () => {
      const lines = step.split('\n');
      const idx = lines.findIndex((l) => l.includes('restore-keys:'));
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(lines[idx + 1]).toContain('cocoapods-repos-${{ runner.os }}-');
    });
  });

  describe('iosApp/Pods cache (shared — gates Install CocoaPods skip)', () => {
    let step;
    beforeAll(() => {
      step = extractStep(deployDevYaml, 'Cache iosApp/Pods');
    });

    test('exists with same SHA as ios-tests', () => {
      expect(step).toContain('actions/cache@27d5ce7f107fe9357f9df03efb73ab90386fccae');
    });

    test('has `id: pods-cache` (required for Install CocoaPods skip-on-hit)', () => {
      // Without id:, the `steps.pods-cache.outputs.cache-hit`
      // reference in the Install CocoaPods step's if: would be
      // empty and `pod install` would run on every push — defeating
      // the optimisation.
      expect(step).toContain('id: pods-cache');
    });

    test('targets iosApp/Pods', () => {
      expect(step).toContain('path: iosApp/Pods');
    });

    test('key matches ios-tests.yml exactly (Podfile.lock-keyed)', () => {
      const iosTestsStep = extractStep(iosTestsYaml, 'Cache iosApp/Pods');
      const iosTestsKey = extractCacheKey(iosTestsStep);
      const deployDevKey = extractCacheKey(step);
      expect(deployDevKey).toBe(iosTestsKey);
      // And both should specifically hash Podfile.lock — the
      // contract that drives Pods reproducibility.
      expect(deployDevKey).toContain("hashFiles('iosApp/Podfile.lock')");
    });
  });

  describe('SwiftPM packages cache (shared — SPM source is platform-agnostic)', () => {
    let step;
    beforeAll(() => {
      step = extractStep(deployDevYaml, 'Cache SwiftPM packages (build/ios-spm-packages)');
    });

    test('exists with same SHA', () => {
      expect(step).toContain('actions/cache@27d5ce7f107fe9357f9df03efb73ab90386fccae');
    });

    test('targets build/ios-spm-packages (matches xcodebuild -clonedSourcePackagesDirPath)', () => {
      expect(step).toContain('path: build/ios-spm-packages');
    });

    test('key matches ios-tests.yml exactly', () => {
      const iosTestsStep = extractStep(
        iosTestsYaml,
        'Cache SwiftPM packages (build/ios-spm-packages)',
      );
      const iosTestsKey = extractCacheKey(iosTestsStep);
      const deployDevKey = extractCacheKey(step);
      expect(deployDevKey).toBe(iosTestsKey);
    });
  });

  describe('Install CocoaPods step honours the Pods cache', () => {
    let step;
    beforeAll(() => {
      step = extractStep(deployDevYaml, 'Install CocoaPods');
    });

    test('skips when pods-cache hits AND no Podfile.lock change', () => {
      // Mirror of the ios-tests.yml optimisation: skip pod install
      // entirely when the cached Pods already match the lock.
      expect(step).toMatch(/steps\.pods-cache\.outputs\.cache-hit\s*!=\s*'true'/);
    });

    test('uses --deployment (lock-mismatch fails loud)', () => {
      // --deployment makes pod install fail on lock-mismatch
      // instead of silently regenerating. Catches stale-lock bugs
      // before they corrupt the cached Pods.
      expect(step).toContain('pod install --deployment');
    });
  });

  describe('archive xcodebuild uses build/ios-spm-packages', () => {
    let step;
    beforeAll(() => {
      step = extractStep(deployDevYaml, 'Build, archive, and export iOS app');
    });

    test('passes -clonedSourcePackagesDirPath pointing at build/ios-spm-packages', () => {
      // Without this flag, xcodebuild ignores the cached SwiftPM
      // directory and re-clones into the default location, so the
      // cache step's path:build/ios-spm-packages saves an empty
      // directory and PR branches restore nothing useful.
      //
      // deploy-dev's xcodebuild runs from inside iosApp/ (`cd iosApp`
      // earlier in the step), so the flag value uses `../build/...`
      // which resolves to the same workspace-root path the cache
      // step references. ios-tests.yml runs from workspace root,
      // so its flag value is bare `build/...`. Accept either form
      // since both resolve to the same location.
      expect(step).toMatch(/-clonedSourcePackagesDirPath\s+(\.\.\/)?build\/ios-spm-packages/);
    });
  });
});

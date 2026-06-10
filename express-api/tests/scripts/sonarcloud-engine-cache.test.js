/**
 * Tests for the SonarCloud scanner-engine cache delivered by SHY-0068
 * (see `.project/stories/SHY-0068-cache-sonar-engine-jar-ci.md`).
 *
 * Why: AWS WAF intermittently blocks GitHub-runner IPs downloading the
 * scanner engine (PR #1049 failures, PR #1001 403 flakes). The real fix
 * is caching `~/.sonar/cache` (SonarSource's documented pattern: an
 * OS-scoped key over an internally-versioned, additive cache dir) — and
 * deleting the `sonarcloud-auto-retry.yml` patch it replaces (operator
 * directive 2026-06-09, feedback-no-auto-retry-workflows).
 *
 * Assertion strategy mirrors deploy-dev-ios-cache-share.test.js (step
 * extraction over raw YAML) + release-workflow-pin.test.js (file-level
 * negative matches). Six separate test blocks per the story's Test Plan
 * so one failure never masks another.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const WORKFLOWS_DIR = path.join(REPO_ROOT, '.github', 'workflows');
const SONARCLOUD_YML = path.join(WORKFLOWS_DIR, 'sonarcloud.yml');
const AUTO_RETRY_YML = path.join(WORKFLOWS_DIR, 'sonarcloud-auto-retry.yml');

// The repo's existing actions/cache pin — asserted EXACTLY so a future
// SHA bump triggers a review of this cache contract too.
const CACHE_ACTION_SHA = '27d5ce7f107fe9357f9df03efb73ab90386fccae';

const yml = () => fs.readFileSync(SONARCLOUD_YML, 'utf-8');

describe('sonarcloud.yml scanner-engine cache (SHY-0068)', () => {
  test('caches ~/.sonar/cache via the exact pinned actions/cache SHA with OS-scoped key + restore-keys', () => {
    const src = yml();
    expect(src).toContain(`uses: actions/cache@${CACHE_ACTION_SHA}`);
    expect(src).toContain('path: ~/.sonar/cache');
    // Run-unique key (immutability workaround: always save fresh) with
    // OS-scoped prefix restore (always restore newest). Line-based checks
    // instead of multiline regex (sonarjs/slow-regex).
    expect(src).toContain('key: ${{ runner.os }}-sonar-${{ github.run_id }}');
    const lines = src.split('\n');
    const rkIdx = lines.findIndex((l) => l.trim() === 'restore-keys: |');
    expect(rkIdx).toBeGreaterThan(-1);
    expect(lines[rkIdx + 1].trim()).toBe('${{ runner.os }}-sonar');
  });

  test('cache restore step sits after checkout and before setup-jdk-gradle', () => {
    const src = yml();
    const checkoutIdx = src.indexOf('actions/checkout@');
    const cacheIdx = src.indexOf(`actions/cache@${CACHE_ACTION_SHA}`);
    const jdkIdx = src.indexOf('./.github/actions/setup-jdk-gradle');
    expect(checkoutIdx).toBeGreaterThan(-1);
    expect(cacheIdx).toBeGreaterThan(-1);
    expect(jdkIdx).toBeGreaterThan(-1);
    expect(cacheIdx).toBeGreaterThan(checkoutIdx);
    expect(cacheIdx).toBeLessThan(jdkIdx);
  });

  test('HIT/MISS observability writes both branches to the step summary via content check', () => {
    const src = yml();
    expect(src).toContain('GITHUB_STEP_SUMMARY');
    // Both branches must exist: with a run-unique key, actions/cache's
    // `cache-hit` output is NEVER 'true' (exact-match only), so the
    // signal must come from a restored-content check, not the output.
    expect(src).toContain('engine-cache: HIT');
    expect(src).toContain('engine-cache: MISS');
    expect(src).not.toContain('outputs.cache-hit');
  });

  test('SONAR_USER_HOME is never set (CI and local pre-push must share ~/.sonar/cache)', () => {
    const src = yml();
    // Match only an actual setting (YAML env key or shell assignment) —
    // the explanatory comment in the cache step may name the variable.
    // Line-based check instead of multiline regex (sonarjs/slow-regex).
    const settingLines = src
      .split('\n')
      .filter((l) => l.trimStart().startsWith('SONAR_USER_HOME:'));
    expect(settingLines).toEqual([]);
    expect(src).not.toContain('SONAR_USER_HOME=');
  });
});

describe('auto-retry patch is gone (feedback-no-auto-retry-workflows)', () => {
  test('sonarcloud-auto-retry.yml no longer exists', () => {
    expect(fs.existsSync(AUTO_RETRY_YML)).toBe(false);
  });

  test('no workflow anywhere contains `gh run rerun` (guards reintroduction)', () => {
    const offenders = fs
      .readdirSync(WORKFLOWS_DIR)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .filter((f) =>
        fs.readFileSync(path.join(WORKFLOWS_DIR, f), 'utf-8').includes('gh run rerun'),
      );
    expect(offenders).toEqual([]);
  });
});

/**
 * deploy-prod.yml — single approval gate + runnable mobile smoke tests (SHY-0084).
 *
 * Three operator-flagged defects, all verified against prod run 27286731472
 * (2026-06-10, FAILED):
 *
 *  1. FOUR separate `environment:` approval gates (prod-backend/web/android/ios)
 *     → ONE release needed four approval clicks. Consolidated to a single
 *     `approve-prod` job on the existing `production` environment that
 *     `deploy-backend-prod` needs; since every other deploy transitively needs
 *     deploy-backend-prod, one approval cascades to all four platforms.
 *
 *  2. Android boot smoke FAILED in ~4 min: the emulator booted, then the inline
 *     verification `script:` died on `set -euo pipefail` because the action runs
 *     `script` via /usr/bin/sh (dash). Fixed by extracting the logic to a
 *     committed bash file invoked with `bash`.
 *
 *  3. iOS boot smoke was CANCELLED at the 20-min job timeout while still
 *     building — "Boot simulator and verify" never ran. Fixed by raising the
 *     timeout so the boot step is reached.
 *
 * These pins fail loudly if a future "CI cleanup" reverts any of the three.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DEPLOY_PROD_YML = path.join(REPO_ROOT, '.github/workflows/deploy-prod.yml');

// Extract a top-level job block: from its `  <job>:` header to the next
// 2-space-indented non-whitespace line (next job) or EOF.
function extractJobBlock(yamlText, jobHeader) {
  const headerIdx = yamlText.indexOf(jobHeader);
  if (headerIdx < 0) return null;
  const after = yamlText.substring(headerIdx).split('\n');
  let endIdx = after.length;
  for (let i = 1; i < after.length; i++) {
    if (/^ {2}\S/.test(after[i])) {
      endIdx = i;
      break;
    }
  }
  return after.slice(0, endIdx).join('\n');
}

describe('SHY-0084: deploy-prod.yml single approval gate', () => {
  let yaml;
  beforeAll(() => {
    yaml = fs.readFileSync(DEPLOY_PROD_YML, 'utf8');
  });

  test('exactly ONE environment: gate exists in the whole workflow', () => {
    const matches = yaml.match(/^[ \t]+environment:[ \t]*\S/gm) || [];
    expect(matches.length).toBe(1);
  });

  test('the single gate targets the existing protected `production` environment', () => {
    const match = yaml.match(/^[ \t]+environment:[ \t]*(\S+)/m);
    expect(match).not.toBeNull();
    expect(match[1]).toBe('production');
  });

  test('none of the four legacy per-platform environments remain', () => {
    for (const env of ['prod-backend', 'prod-web', 'prod-android', 'prod-ios']) {
      expect(yaml).not.toMatch(new RegExp(`environment:[ \\t]*${env}\\b`));
    }
  });

  test('an approve-prod gate job exists on the production environment', () => {
    const block = extractJobBlock(yaml, '  approve-prod:');
    expect(block).not.toBeNull();
    expect(block).toMatch(/^[ \t]+environment:[ \t]*production\b/m);
  });

  test('deploy-backend-prod needs approve-prod (the chokepoint that gates all platforms)', () => {
    const block = extractJobBlock(yaml, '  deploy-backend-prod:');
    expect(block).not.toBeNull();
    const needs = block.match(/^[ \t]+needs:[ \t]*\[([^\]]*)\]/m);
    expect(needs).not.toBeNull();
    expect(needs[1]).toMatch(/\bapprove-prod\b/);
  });

  test('deploy-backend-prod no longer carries its own environment gate', () => {
    const block = extractJobBlock(yaml, '  deploy-backend-prod:');
    expect(block).not.toBeNull();
    expect(block).not.toMatch(/^[ \t]+environment:/m);
  });

  // The security invariant: because the three downstream deploys use
  // `always()` for selective-platform logic, the ONLY thing that blocks them
  // on a DENIED approval is the explicit `needs.approve-prod.result ==
  // 'success'` clause. Pin it on EACH (a future cleanup dropping it from any
  // one would silently let that platform deploy without approval).
  for (const job of ['deploy-web-prod', 'deploy-android-prod', 'deploy-ios-prod']) {
    test(`${job} needs approve-prod`, () => {
      const block = extractJobBlock(yaml, `  ${job}:`);
      expect(block).not.toBeNull();
      const needs = block.match(/^[ \t]+needs:[ \t]*\[([^\]]*)\]/m);
      expect(needs).not.toBeNull();
      expect(needs[1]).toMatch(/\bapprove-prod\b/);
    });

    test(`${job} if: enforces approve-prod success (gate holds under always())`, () => {
      const block = extractJobBlock(yaml, `  ${job}:`);
      expect(block).not.toBeNull();
      expect(block).toMatch(/always\(\)/);
      expect(block).toMatch(/needs\.approve-prod\.result\s*==\s*['"]success['"]/);
    });

    test(`${job} no longer carries its own per-platform environment gate`, () => {
      const block = extractJobBlock(yaml, `  ${job}:`);
      expect(block).not.toBeNull();
      expect(block).not.toMatch(/^[ \t]+environment:/m);
    });
  }
});

describe('SHY-0084: deploy-prod.yml Android boot smoke runs under bash', () => {
  let yaml;
  let androidBlock;
  beforeAll(() => {
    yaml = fs.readFileSync(DEPLOY_PROD_YML, 'utf8');
    androidBlock = extractJobBlock(yaml, '  smoke-test-android:');
  });

  test('the Android smoke calls the committed bash verifier', () => {
    expect(androidBlock).not.toBeNull();
    expect(androidBlock).toContain('scripts/ci/android-smoke-verify.sh');
  });

  test('the dash-incompatible inline constructs are GONE from the smoke job', () => {
    // `set -o pipefail` / `shopt` under /usr/bin/sh were the actual failure.
    expect(androidBlock).not.toMatch(/set -euo pipefail/);
    expect(androidBlock).not.toMatch(/shopt /);
  });

  test('the verifier is invoked with bash (not the action default dash)', () => {
    expect(androidBlock).toMatch(/bash[ \t]+["']?\$\{?GITHUB_WORKSPACE/);
  });

  test('the smoke job checks out the repo so the verifier file is present', () => {
    // The job previously only downloaded the APK artifact — with no checkout
    // the committed script would not exist on disk.
    expect(androidBlock).toMatch(/uses:[ \t]*actions\/checkout@/);
  });

  test('still pinned to ubuntu-22.04 (emulator-boot-stability pin is preserved)', () => {
    expect(androidBlock).toMatch(/^[ \t]+runs-on:[ \t]*ubuntu-22\.04\b/m);
  });
});

describe('SHY-0084: deploy-prod.yml iOS boot smoke reaches the boot step', () => {
  let iosBlock;
  beforeAll(() => {
    const yaml = fs.readFileSync(DEPLOY_PROD_YML, 'utf8');
    iosBlock = extractJobBlock(yaml, '  smoke-test-ios:');
  });

  test('iOS smoke timeout is raised to at least 40 min (was 20, which the build consumed)', () => {
    expect(iosBlock).not.toBeNull();
    const match = iosBlock.match(/^[ \t]+timeout-minutes:[ \t]*(\d+)/m);
    expect(match).not.toBeNull();
    expect(parseInt(match[1], 10)).toBeGreaterThanOrEqual(40);
  });

  test('the "Boot simulator and verify" step still exists (we widen the budget, not drop it)', () => {
    expect(iosBlock).toMatch(/Boot simulator and verify app launches/);
  });
});

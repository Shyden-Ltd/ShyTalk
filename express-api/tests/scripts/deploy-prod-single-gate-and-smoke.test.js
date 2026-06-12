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

  test('the smoke checkout does NOT pin the DEPLOYED ref (verifier is workflow tooling)', () => {
    // Regression guard (run 27388236740): pinning the smoke checkout to the
    // deploy ref (needs.validate-release.outputs.commit-sha) made the bash
    // verifier "No such file" when deploying a tag cut before the script
    // existed. The verifier must come from the workflow's own (default) ref;
    // the deployed APP under test is the downloaded APK artifact.
    const checkoutIdx = androidBlock.indexOf('actions/checkout@');
    expect(checkoutIdx).toBeGreaterThanOrEqual(0);
    // The 4 lines following the checkout must not re-introduce the deploy-ref pin.
    const after = androidBlock.slice(checkoutIdx).split('\n').slice(0, 4).join('\n');
    expect(after).not.toMatch(/ref:\s*\$\{\{\s*needs\.validate-release\.outputs\.commit-sha/);
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

describe('SHY-0087: iOS smoke runs in PARALLEL with the iOS App Store deploy', () => {
  let iosSmokeBlock;
  let iosSmokeNeeds;
  let iosSmokeIf;
  let alertDesyncBlock;
  beforeAll(() => {
    const yaml = fs.readFileSync(DEPLOY_PROD_YML, 'utf8');
    iosSmokeBlock = extractJobBlock(yaml, '  smoke-test-ios:');
    // Parse the needs array + the JOB-LEVEL if (the FIRST `if:` in the block —
    // step-level `if:`s come later). Extracting the if VALUE (not scanning the
    // whole block) is deliberate: the job's explanatory comment legitimately
    // mentions `inputs.ios` / the old deploy gate in prose, and asserting
    // against the comment would false-pass. We pin the actual expression.
    const needsMatch = iosSmokeBlock && iosSmokeBlock.match(/^[ \t]+needs:[ \t]*\[([^\]]*)\]/m);
    iosSmokeNeeds = needsMatch ? needsMatch[1] : null;
    // `(\S.*)` not `(.+)`: anchoring the capture to a non-space first char keeps
    // `[ \t]*` and the capture as disjoint classes (no overlapping quantifiers →
    // no super-linear backtracking; sonarjs/slow-regex). The first char of an
    // `if:` value is always non-space.
    const ifMatch = iosSmokeBlock && iosSmokeBlock.match(/^[ \t]+if:[ \t]*(\S.*)$/m);
    iosSmokeIf = ifMatch ? ifMatch[1] : null;
    alertDesyncBlock = extractJobBlock(yaml, '  alert-desync:');
  });

  // AC (happy path): the serial chain that forced the ~25-min smoke to run
  // AFTER the 56-min deploy is gone — smoke no longer depends on the deploy, so
  // GitHub can schedule the two concurrently. This is THE change that buys the
  // ~25 min off the post-approval critical path.
  test('smoke-test-ios.needs no longer depends on deploy-ios-prod', () => {
    expect(iosSmokeNeeds).not.toBeNull();
    expect(iosSmokeNeeds).not.toMatch(/\bdeploy-ios-prod\b/);
  });

  // AC: it still needs validate-release (it checks out
  // needs.validate-release.outputs.commit-sha to build the same source).
  test('smoke-test-ios.needs still includes validate-release', () => {
    expect(iosSmokeNeeds).not.toBeNull();
    expect(iosSmokeNeeds).toMatch(/\bvalidate-release\b/);
  });

  // SHY-0087 refinement (BDD: "When ... the approval gate is cleared, Then both
  // start"): gate the smoke on approve-prod — NOT the deploy — so it (1) overlaps
  // the deploy post-approval and (2) does NOT burn an expensive (10x-billed)
  // macos-latest runner pre-approval or on a DENIED release. A plain
  // `needs: [validate-release]` would start the smoke before approval.
  test('smoke-test-ios.needs gates on approve-prod (no pre-approval / no-denial runner burn)', () => {
    expect(iosSmokeNeeds).not.toBeNull();
    expect(iosSmokeNeeds).toMatch(/\bapprove-prod\b/);
  });

  test('smoke-test-ios job-level if enforces approve-prod success', () => {
    expect(iosSmokeIf).not.toBeNull();
    expect(iosSmokeIf).toMatch(/needs\.approve-prod\.result\s*==\s*['"]success['"]/);
  });

  // The auto-skip-on-deny/cancel guarantee depends on the ABSENCE of always():
  // GitHub auto-skips a job whose needed gate (approve-prod) was denied/cancelled
  // ONLY when the if has no always(). A well-meaning "make it consistent with the
  // deploy-*-prod jobs" refactor that adds always() would silently let the smoke
  // run — burning a 10x-billed macos-latest runner — on a DENIED release. Pin the
  // absence so that regression fails loudly here. (The deploy jobs DO use
  // always() because they have a success||skipped need; the smoke does not.)
  test('smoke-test-ios job-level if does NOT use always() (auto-skip on deny/cancel is the guard)', () => {
    expect(iosSmokeIf).not.toBeNull();
    expect(iosSmokeIf).not.toMatch(/always\(\)/);
  });

  // AC (edge case): an iOS-DESELECTED release must not run an orphan smoke. The
  // old `deploy-ios-prod.result == 'success'` gate gave this for free
  // (deselected → deploy skipped → not success → smoke skipped); with the deploy
  // dependency gone, inputs.ios must be checked EXPLICITLY in the if.
  test('smoke-test-ios job-level if still gates on inputs.ios (no orphan smoke when iOS deselected)', () => {
    expect(iosSmokeIf).not.toBeNull();
    expect(iosSmokeIf).toMatch(/inputs\.ios/);
  });

  // AC (error path) + regression: the data-less "skip if the deploy died" clause
  // is fully removed from the if. A deploy FAILURE must NOT suppress the smoke —
  // both report independently. If this clause crept back, the smoke would
  // re-serialize behind the deploy and the ~25 min would be lost again.
  test('smoke-test-ios job-level if no longer references the deploy result (truly decoupled)', () => {
    expect(iosSmokeIf).not.toBeNull();
    expect(iosSmokeIf).not.toMatch(/needs\.deploy-ios-prod\.result/);
  });

  // AC: the desync alarm must still cover BOTH the iOS deploy and the iOS smoke
  // — decoupling the smoke from the deploy must NOT drop either from the
  // failure-aggregation job.
  test('alert-desync still needs both deploy-ios-prod and smoke-test-ios', () => {
    expect(alertDesyncBlock).not.toBeNull();
    const needs = alertDesyncBlock.match(/^[ \t]+needs:[ \t]*\[([^\]]*)\]/m);
    expect(needs).not.toBeNull();
    expect(needs[1]).toMatch(/\bdeploy-ios-prod\b/);
    expect(needs[1]).toMatch(/\bsmoke-test-ios\b/);
  });
});

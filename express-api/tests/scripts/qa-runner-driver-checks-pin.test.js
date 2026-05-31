/**
 * qa-runner-driver-checks-pin.test.js
 *
 * Pins the structure of `.github/workflows/qa-runner-driver-checks.yml`
 * and the pr-checks.yml integration that triggers it. Closes gap E4
 * from the QA-runner framework tracker — without this pin, a future
 * PR could silently break the fast driver-feedback loop by:
 *   - removing the workflow file
 *   - removing the `qa-runner-driver-checks` job from pr-checks.yml
 *   - removing the path-filter that triggers it on driver changes
 *   - removing the gate-job dependency that makes it required
 *
 * Pure-test PR — no production code. Reads YAML as text + minimal
 * parsing (no yaml dep required) to assert the structural invariants.
 *
 * Per [feedback-workflow-verify-by-running]: this PIN is not a
 * substitute for dispatching the workflow and observing success.
 * After merge, the workflow runs on PRs touching driver files; the
 * first such PR is the live verification.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const REUSABLE_PATH = path.join(REPO_ROOT, '.github/workflows/qa-runner-driver-checks.yml');
const PR_CHECKS_PATH = path.join(REPO_ROOT, '.github/workflows/pr-checks.yml');

const reusable = fs.readFileSync(REUSABLE_PATH, 'utf8');
const prChecks = fs.readFileSync(PR_CHECKS_PATH, 'utf8');

// ── Reusable workflow shape ────────────────────────────────────────

describe('.github/workflows/qa-runner-driver-checks.yml', () => {
  test('file exists and is non-empty', () => {
    expect(reusable.length).toBeGreaterThan(0);
  });

  test('declares a workflow_call trigger (reusable)', () => {
    expect(reusable).toMatch(/^on:[\s\S]{0,200}?workflow_call:/m);
  });

  test('requires a "ref" input', () => {
    expect(reusable).toMatch(/inputs:[\s\S]{0,200}?ref:/);
    expect(reusable).toMatch(/ref:[\s\S]{0,200}?required:\s*true/);
  });

  test('runs on ubuntu-latest (no self-hosted runners)', () => {
    // [[feedback-no-self-hosted-runners]] HARD policy.
    expect(reusable).toMatch(/runs-on:\s*ubuntu-latest/);
    expect(reusable).not.toMatch(/runs-on:[\s\S]{0,200}?self-hosted/);
  });

  test('caches Playwright browsers keyed on Playwright version', () => {
    // [[feedback-ci-cache-downloads-version-aware]] — newer Playwright
    // must bust the cache automatically. The key must reference the
    // resolved version (steps.pw.outputs.version), not just runner.os.
    expect(reusable).toMatch(/uses:\s*actions\/cache@v4/);
    expect(reusable).toMatch(
      /key:\s*playwright-\$\{\{\s*runner\.os\s*\}\}-\$\{\{\s*steps\.pw\.outputs\.version\s*\}\}/,
    );
  });

  test('installs Playwright browsers with --with-deps for headless WebKit', () => {
    expect(reusable).toMatch(/npx playwright install --with-deps/);
  });

  test('runs the driver-contract test suite', () => {
    expect(reusable).toMatch(/--testPathPattern\s+tests\/scripts\/drivers\//);
  });

  test('runs --check-drivers diagnostic', () => {
    expect(reusable).toMatch(/manual-qa-runner\.js\s+--check-drivers/);
  });

  test('runs --smoke diagnostic with anchored flag + chromium,firefox filter (gap E3)', () => {
    // Anchored regex (--smoke followed by space or end-of-token) so
    // a future typo like --smok or --smokes wouldn't pass the pin.
    // Reviewer-flagged 2026-05-31 — unknown-flag silent-drop risk.
    expect(reusable).toMatch(/--smoke(?:\s|\b)/);
    // Scope: both desktop browsers Playwright provides on ubuntu —
    // chromium AND firefox. Covers the divergent web-playwright code
    // paths without bloating PR CI.
    expect(reusable).toMatch(/--filter\s+chromium,firefox/);
  });

  test('--smoke step has `if: always()` for independent diagnostic', () => {
    // Reviewer-flagged: without if: always(), GitHub Actions skips
    // the --smoke step if --check-drivers above fails. Operator
    // wants the smoke signal regardless — distinguishes
    // bootstrap-only from method-level failures.
    expect(reusable).toMatch(/--smoke[\s\S]{0,500}?if:\s*always\(\)/);
  });

  test('--smoke step selective-swallows ONLY localhost ECONNREFUSED (gap C1)', () => {
    // Reviewer-flagged 2026-05-31 — naive `|| true` would silently
    // mask CLI parser regressions, missing factories, renamed
    // methods (all exit 1). Tightened to grep for the connection
    // error specifically; any other exit-1 propagates.
    expect(reusable).toMatch(/ECONNREFUSED/);
    expect(reusable).toMatch(/net::ERR_CONNECTION_REFUSED/);
    // Anti-pattern check: no bare `|| true` on the runner invocation.
    expect(reusable).not.toMatch(/manual-qa-runner\.js[^\n]{0,200}\|\|\s*true/);
    // Must surface non-connection errors with a clear ::error:: message.
    expect(reusable).toMatch(/::error::--smoke failed with a NON-CONNECTION error/);
  });

  test('grants read-only contents permission', () => {
    // No write needed — this workflow only runs tests + diagnostics.
    expect(reusable).toMatch(/permissions:[\s\S]{0,200}?contents:\s*read/);
  });

  test('has a sensible timeout (≤ 15 minutes)', () => {
    const m = reusable.match(/timeout-minutes:\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(parseInt(m[1], 10)).toBeLessThanOrEqual(15);
  });
});

// ── pr-checks.yml integration ──────────────────────────────────────

describe('.github/workflows/pr-checks.yml — driver-checks integration', () => {
  test('detect-changes emits qa_runner_drivers_changed output', () => {
    expect(prChecks).toMatch(
      /qa_runner_drivers_changed:\s*\$\{\{\s*steps\.changes\.outputs\.qa_runner_drivers_changed\s*\}\}/,
    );
  });

  test('case branch sets QA_RUNNER_DRIVERS=true for express-api/scripts/drivers/**', () => {
    expect(prChecks).toMatch(/express-api\/scripts\/drivers\/\*[\s\S]{0,80}QA_RUNNER_DRIVERS=true/);
  });

  test('case branch ALSO sets BACKEND=true (regression safety — drivers are a backend subset)', () => {
    expect(prChecks).toMatch(/express-api\/scripts\/drivers\/\*[\s\S]{0,120}BACKEND=true/);
  });

  test('driver case branch precedes the generic express-api/* branch', () => {
    const driverIdx = prChecks.indexOf('express-api/scripts/drivers/');
    const genericIdx = prChecks.indexOf('express-api/*|firestore.rules');
    expect(driverIdx).toBeGreaterThan(0);
    expect(genericIdx).toBeGreaterThan(driverIdx);
  });

  test('initializes QA_RUNNER_DRIVERS=false alongside other flags', () => {
    expect(prChecks).toMatch(/QA_RUNNER_DRIVERS=false/);
  });

  test('writes qa_runner_drivers_changed to GITHUB_OUTPUT', () => {
    expect(prChecks).toMatch(/qa_runner_drivers_changed=\$QA_RUNNER_DRIVERS/);
  });

  // Slice the qa-runner-driver-checks job body once so per-assertion
  // regexes can stay anchored and bounded. Avoids the lazy [\s\S]*?
  // pattern that sonarjs/slow-regex flags (super-linear backtracking
  // on adversarial input — not a real risk here but disallowed per
  // [feedback-warnings-are-failures]).
  function jobSection(name) {
    const start = prChecks.indexOf(`${name}:`);
    if (start < 0) return '';
    // A pr-checks job is comfortably under 2KB; clamp the window.
    return prChecks.slice(start, start + 2000);
  }
  const driverJobSection = jobSection('qa-runner-driver-checks');

  test('qa-runner-driver-checks job exists', () => {
    expect(driverJobSection.length).toBeGreaterThan(0);
    expect(prChecks).toMatch(/^\s{1,10}qa-runner-driver-checks:/m);
  });

  test('qa-runner-driver-checks job calls the reusable workflow', () => {
    expect(driverJobSection).toMatch(
      /uses:\s*\.\/\.github\/workflows\/qa-runner-driver-checks\.yml/,
    );
  });

  test('qa-runner-driver-checks job gates on qa_runner_drivers_changed', () => {
    expect(driverJobSection).toMatch(/qa_runner_drivers_changed\s*==\s*'true'/);
  });

  test('qa-runner-driver-checks job passes ref from pull_request.head.sha', () => {
    // [feedback security] — SHA from GitHub API, not attacker-controllable.
    expect(driverJobSection).toMatch(
      /ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/,
    );
  });

  test('gate job includes qa-runner-driver-checks in needs (required check)', () => {
    expect(prChecks).toMatch(/needs:\s*\[[^\]]*qa-runner-driver-checks[^\]]*\]/);
  });

  test('gate job checks qa-runner-driver-checks result in the failure loop', () => {
    expect(prChecks).toMatch(/needs\.qa-runner-driver-checks\.result/);
  });
});

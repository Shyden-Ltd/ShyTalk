'use strict';

/**
 * pr-checks-playwright-scope.test.js — SHY-0339
 *
 * A PR must run ONE browser; a nightly must run ALL of them.
 *
 * Measured 2026-08-18: the last twelve `pr-checks.yml` runs took
 * 1, 65, 147, 184, 72, 8, 7, 1, 22, 11, 44, 82 minutes, several cancelled at
 * timeout, with four of the last six running the full five-project matrix. The
 * projects run in parallel but each pays the whole setup — checkout, JDK,
 * node, npm ci, browser install, apt deps, local services, emulators, seeding,
 * Express — five times per PR.
 *
 * The pairing is the point. Before this story there was NO scheduled browser
 * run anywhere in the repo, so the five projects ran only on PRs. Cutting the
 * PR to chromium WITHOUT a nightly would delete that coverage rather than move
 * it — so this file asserts both halves, and a mutation that drops either one
 * must fail.
 */

const fs = require('fs');
const path = require('path');

const WF = path.join(__dirname, '../../../.github/workflows');
const read = (f) => fs.readFileSync(path.join(WF, f), 'utf8');

/**
 * The `web:` input a caller passes to playwright-tests.yml.
 *
 * Scoped to the JOB that invokes it, rather than matched within a fixed
 * character window of the `uses:` line. A window breaks the moment someone
 * documents the call — which is exactly what happened to the first draft of
 * this helper: the comment explaining WHY the PR runs one browser pushed the
 * `web:` line outside a 200-character lookahead, and the test failed on the
 * change it was written to verify.
 */
function webInputOf(src) {
  const lines = src.split('\n');
  const at = lines.findIndex((l) => l.includes('workflows/playwright-tests.yml'));
  if (at < 0) return null;
  // Read forward to the end of this job's `with:` block — i.e. until a line
  // that is not more-indented than the `uses:` line (or EOF).
  const baseIndent = lines[at].search(/\S/);
  for (let i = at + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') continue;
    // STRICTLY less-indented ends the job. `uses:` and `with:` are
    // SIBLINGS at the same indent, so a `<=` here breaks immediately and
    // finds nothing — which it did on the first attempt.
    if (line.search(/\S/) < baseIndent) break;
    const m = line.match(/^\s*web:\s*(.+)$/);
    if (m) return m[1].trim();
  }
  return null;
}

describe('per-PR browser scope (SHY-0339)', () => {
  test('the PR path requests ONE browser, not all', () => {
    // The defect in one assertion: `web: 'all'` here is ~4 redundant full
    // environment setups on every PR that touches the website.
    expect(webInputOf(read('pr-checks.yml'))).toContain("'chromium'");
    expect(webInputOf(read('pr-checks.yml'))).not.toBe("'all'");
  });

  test('the RELEASE path still requests all browsers', () => {
    // This test was NAMED in the story's Test Plan and then silently dropped,
    // and the behaviour did not exist: `web` was unconditional, so the
    // develop->main promotion PR — the last gate before production — got
    // chromium exactly like a feature PR. Before SHY-0339 "the release runs
    // all five" was true only by ACCIDENT of every PR defaulting to 'all'.
    //
    // It must not depend on whether the nightly happened to run against this
    // exact commit, which matters doubly because a `schedule:` trigger only
    // fires from the DEFAULT branch — so the nightly is inert until this file
    // reaches main via a promotion.
    const web = webInputOf(read('pr-checks.yml'));
    expect(web).toMatch(/github\.base_ref\s*==\s*'main'/);
    expect(web).toContain("'all'");
  });

  test('driver TEST files are treated as tests, not as the shared core', () => {
    // express-api/tests/scripts/drivers/* was matched by the earlier drivers
    // arm and inherited BACKEND=true, so editing a driver test still forced
    // the full client matrix — contradicting this story's own principle on one
    // of the most frequently edited paths in the repo.
    const src = read('pr-checks.yml');
    expect(src).toMatch(
      /express-api\/tests\/scripts\/drivers\/\*\)\s*QA_RUNNER_DRIVERS=true;\s*BACKEND_TESTS=true/,
    );
    // First-match: the test arm must precede the SOURCE drivers arm.
    expect(src.indexOf('express-api/tests/scripts/drivers/*)')).toBeLessThan(
      src.indexOf('express-api/scripts/drivers/*)'),
    );
  });

  test('the nightly can WRITE contents, so its report publish is not a nightly 403', () => {
    // A called workflow cannot exceed the permissions granted at the top of
    // the chain. allure-report pushes to gh-pages; contents: read here would
    // 403 it every night, quietly — allure-report has continue-on-error, so
    // only the report would stop updating while the test verdict still passed.
    expect(read('playwright-nightly.yml')).toMatch(/permissions:[\s\S]{0,600}?contents:\s*write/);
  });

  test('a scheduled nightly run exists and requests ALL browsers', () => {
    // Without this the change is a coverage cut, not a deferral.
    const nightly = read('playwright-nightly.yml');
    expect(nightly).toMatch(/^\s*schedule:/m);
    expect(nightly).toMatch(/cron:/);
    // A quoted literal here, unlike the PR path which is now an expression.
    expect(webInputOf(nightly)).toBe("'all'");
  });

  test('the nightly is dispatchable manually for a specific ref', () => {
    // So a suspected cross-browser issue can be checked immediately rather
    // than waiting for the schedule.
    const nightly = read('playwright-nightly.yml');
    expect(nightly).toMatch(/workflow_dispatch:/);
    expect(nightly).toMatch(/ref:/);
  });

  test('the nightly runs against develop, the integration branch', () => {
    expect(read('playwright-nightly.yml')).toMatch(/develop/);
  });

  // ── A test-file edit must not retest every client (SHY-0339) ────────

  const prChecks = read('pr-checks.yml');

  test('express-api/tests is routed AWAY from the shared-core forcing rule', () => {
    // The SHY-0127 rule reads BACKEND as "the shared core changed, retest every
    // client" and forces APP/ANDROID/IOS/WEB/INTEGRATION on while clearing the
    // E2E skip markers. A file under express-api/tests/** is never shipped to a
    // client and cannot cause a client regression, so it must not set BACKEND.
    expect(prChecks).toMatch(/express-api\/tests\/\*\)\s*BACKEND_TESTS=true/);
  });

  test('the tests arm is matched BEFORE the generic express-api arm', () => {
    // shell `case` is first-match. Placed after, it would never fire.
    const testsAt = prChecks.indexOf('express-api/tests/*)');
    const genericAt = prChecks.indexOf('express-api/*|firestore.rules');
    expect(testsAt).toBeGreaterThan(-1);
    expect(genericAt).toBeGreaterThan(-1);
    expect(testsAt).toBeLessThan(genericAt);
  });

  test('a tests-only change STILL runs the backend suite', () => {
    // Narrowing must not become skipping: the tests themselves have to run.
    expect(prChecks).toMatch(/test-backend:[\s\S]{0,600}?backend_tests_changed == 'true'/);
  });

  test('a tests-only change is NOT classified as workflow-only', () => {
    // workflow_only gates several jobs; letting a tests-only PR claim it would
    // fix one silent skip by introducing another — the SHY-0284 lesson.
    expect(prChecks).toMatch(/BACKEND_TESTS" = "false"/);
  });

  test('runtime backend paths STILL force the full client matrix', () => {
    // The narrowing is deliberately only tests/. src, scripts, package.json and
    // the rules files keep BACKEND=true, because a dependency or config change
    // genuinely can reach a client.
    expect(prChecks).toMatch(
      /express-api\/\*\|firestore\.rules\|database\.rules\.json\)\s*BACKEND=true/,
    );
  });
});

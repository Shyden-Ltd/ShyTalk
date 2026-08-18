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
    const m = line.match(/^\s*web:\s*'([^']+)'/);
    if (m) return m[1];
  }
  return null;
}

describe('per-PR browser scope (SHY-0339)', () => {
  test('the PR path requests ONE browser, not all', () => {
    // The defect in one assertion: `web: 'all'` here is ~4 redundant full
    // environment setups on every PR that touches the website.
    expect(webInputOf(read('pr-checks.yml'))).toBe('chromium');
  });

  test('a scheduled nightly run exists and requests ALL browsers', () => {
    // Without this the change is a coverage cut, not a deferral.
    const nightly = read('playwright-nightly.yml');
    expect(nightly).toMatch(/^\s*schedule:/m);
    expect(nightly).toMatch(/cron:/);
    expect(webInputOf(nightly)).toBe('all');
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
});

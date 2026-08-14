#!/usr/bin/env node
/**
 * check-action-pin-consistency.js — SHY-0284.
 *
 * Fails when one third-party action repo is pinned to more than one SHA
 * anywhere under `.github/` (workflows AND composite actions), i.e. a partial
 * Dependabot bump that moved some refs and left others behind.
 *
 * Why this is a script and not only a Jest test: the SHY-0162 invariant lived
 * solely in express-api/tests/scripts/ci-action-pin-consistency.test.js, and
 * `test-backend` is gated on `backend_changed`. A workflow-only PR — exactly
 * the shape of the Dependabot action bump that causes this drift — skips that
 * suite entirely, so the guard could only ever fire by accident. Both
 * `actions/setup-node` (6.4.0 vs 7.0.0) and `actions/setup-java` (5.6.0 vs
 * 5.7.0) sat split across main for two days before anyone noticed.
 *
 * lint.yml runs this unconditionally, alongside check-action-shas.sh — the
 * job that always runs on workflow-only PRs. Node builtins only: that path is
 * deliberately cheap and does no `npm ci`.
 *
 * Exit: 0 = consistent; 1 = drift or an unpinned ref; 2 = nothing scanned.
 */
const {
  collectAllRefs,
  findUnpinned,
  findInconsistentRepos,
  describeInconsistency,
} = require('./lib/action-pins');

// Below this, the scan found so little that it is far likelier to be broken
// than the repo to be nearly action-free. Reporting "clean" after scanning
// nothing is the failure mode this exists to prevent, so it exits NON-zero
// and says so rather than passing quietly.
const MIN_EXPECTED_REFS = 20;

/**
 * `refs` and both streams are injectable so the exit-code contract and the
 * zero-scan guard are covered by synthetic fixtures rather than by whatever
 * the live tree happens to look like on the day. Defaults are the real thing.
 */
function main({ refs, out = process.stdout, err = process.stderr } = {}) {
  const found = refs === undefined ? collectAllRefs() : refs;

  if (found.length < MIN_EXPECTED_REFS) {
    err.write(
      `check-action-pin-consistency: only ${found.length} action reference(s) found under .github/ ` +
        `(expected at least ${MIN_EXPECTED_REFS}).\n` +
        'The scan is almost certainly broken — a moved directory or a changed `uses:` shape. ' +
        'Refusing to report success on a scan that measured nothing.\n',
    );
    return 2;
  }

  // A count floor alone cannot tell "scanned everything" from "scanned the big
  // directory". `.github/workflows/` holds ~178 refs; `.github/actions/` holds
  // FOUR — and the composites are where the real drift lived. So if recursion
  // into `.github/actions/**` ever broke, the scan would still return ~114
  // refs, clear any sane floor, and report success while blind to exactly the
  // class of bug this guard exists for. Require breadth, not just volume.
  const areas = new Set(found.map((r) => r.file.split('/')[1]).filter(Boolean));
  if (areas.size < 2) {
    err.write(
      `check-action-pin-consistency: every reference came from a single area under .github/ ` +
        `(${[...areas].join(', ') || 'none'}).\n` +
        'Workflows AND composite actions both carry pins, so a single-area result means the walk ' +
        'stopped descending. Refusing to report success on a partial scan.\n',
    );
    return 2;
  }

  const unpinned = findUnpinned(found);
  const inconsistent = findInconsistentRepos(found);

  if (unpinned.length > 0) {
    err.write(
      'Third-party actions must be pinned to a 40-hex commit SHA, not a floating tag:\n' +
        unpinned.map((u) => `  ${u}\n`).join(''),
    );
  }
  if (inconsistent.length > 0) {
    err.write(`${describeInconsistency(inconsistent)}\n`);
  }
  if (unpinned.length > 0 || inconsistent.length > 0) return 1;

  const repos = new Set(found.map((r) => r.repo)).size;
  out.write(
    `✓ ${found.length} action reference(s) across ${repos} action repo(s) — every repo pins exactly one SHA.\n`,
  );
  return 0;
}

module.exports = { main, MIN_EXPECTED_REFS };

// Only exit the process when run as a CLI, so requiring this from a test does
// not kill the test runner.
if (require.main === module) {
  process.exit(main());
}

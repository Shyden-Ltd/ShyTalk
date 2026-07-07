/**
 * SHY-0161: git-flow requires CI + the board sync to fire on `develop`, not
 * just `main`. Static pins so a future edit can't silently narrow the branch
 * filters back to `[main]` — which would leave feature→develop PRs unchecked
 * (no CI, no Pre-Merge Gate) and the board's "In Testing" column un-synced.
 *
 * Static rather than dispatch-and-observe (models sync-roadmap-data-workflow.test.js):
 * actionlint covers YAML syntax; these pin the specific contract bits that
 * would silently regress. Empirical confirmation that a feature→develop PR
 * actually triggers CI is the separate dispatch gate ([[feedback-workflow-verify-by-running]]).
 */
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const wf = (name) => fs.readFileSync(path.join(REPO_ROOT, '.github/workflows', name), 'utf8');
const DEVELOP_BRANCHES = /branches:\s*\[\s*main,\s*develop\s*\]/;

describe('SHY-0161: git-flow workflow triggers include develop', () => {
  test('pr-checks.yml pull_request fires on [main, develop]', () => {
    expect(wf('pr-checks.yml')).toMatch(DEVELOP_BRANCHES);
  });

  test('codeql.yml fires on [main, develop] for BOTH push and pull_request', () => {
    const matches = wf('codeql.yml').match(new RegExp(DEVELOP_BRANCHES, 'g')) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test('sync-stories-to-issues.yml push fires on [main, develop] (board In Testing sync)', () => {
    expect(wf('sync-stories-to-issues.yml')).toMatch(DEVELOP_BRANCHES);
  });

  test('sync-stories-to-issues.yml gates the sidecar commit-back to main only', () => {
    // The commit-back hardcodes branch: "main" + an expectedHeadOid guard, so a
    // develop run must skip it (HEAD-oid mismatch would fail the mutation). The
    // ref-name gate must be present so develop runs still sync the board but do
    // not attempt the commit-back.
    expect(wf('sync-stories-to-issues.yml')).toMatch(/github\.ref_name == 'main'/);
  });
});

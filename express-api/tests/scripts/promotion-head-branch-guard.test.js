/**
 * SHY-0478 (recurrence of SHY-0296) — the promotion head-branch guard.
 *
 * This repository sets `delete_branch_on_merge: true`, and GitHub deletes a
 * merged PR's HEAD branch. A promotion PR's head branch is `develop`, so
 * merging a release deletes the integration branch — silently, at the moment of
 * success. It happened on 2026-08-13 (#1652) and again on 2026-08-27 (#2033).
 *
 * SHY-0296 fixed it by writing a HARD rule into CLAUDE.md. SHY-0358 then
 * deleted CLAUDE.md for unrelated reasons, and the rule went with it. Six days
 * later the same bug destroyed the same branch.
 *
 * Which is the point of this file. The guard is a JOB that fails, and this test
 * is what stops the job quietly disappearing the way the sentence did. Nothing
 * is mocked: it reads the real workflow.
 */

const fs = require('node:fs');
const path = require('node:path');

const WORKFLOW = path.join(__dirname, '..', '..', '..', '.github', 'workflows', 'pr-checks.yml');
const source = () => fs.readFileSync(WORKFLOW, 'utf8');

/** The guard job's block, from its key to the next job at the same indent. */
const guardBlock = () => {
  const src = source();
  const start = src.indexOf('\n  promotion-head-branch:');
  if (start === -1) return '';
  const rest = src.slice(start + 1);
  const next = rest.search(/\n {2}[a-z][a-z0-9-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next);
};

describe('the guard exists at all', () => {
  test('the workflow is real and is the one under test', () => {
    // Non-vacuous: a moved or empty file would make everything below pass.
    expect(fs.existsSync(WORKFLOW)).toBe(true);
    expect(source()).toContain('detect-changes:');
    expect(source().length).toBeGreaterThan(5000);
  });

  test('the promotion-head-branch job is declared', () => {
    // The whole fix. Deleting this job re-opens a defect that has already
    // destroyed the integration branch twice.
    expect(guardBlock().length).toBeGreaterThan(0);
  });
});

describe('what the guard refuses', () => {
  const block = () => guardBlock();

  test('it only runs on PRs targeting main', () => {
    // A promotion is the only PR whose head is a long-lived branch. Running it
    // everywhere would fail every ordinary PR opened from a shared branch.
    expect(block()).toContain("github.base_ref == 'main'");
  });

  test('it refuses develop as a head branch', () => {
    expect(block()).toMatch(/\bdevelop\b/);
  });

  test('it refuses the OTHER long-lived branches too', () => {
    // The hazard is head-branch DELETION, not the name "develop". Any
    // long-lived branch used as a head is destroyed the same way.
    expect(block()).toMatch(/\bmain\b/);
    expect(block()).toMatch(/\bmaster\b/);
  });

  test('it FAILS rather than warning', () => {
    // A warning is a sentence with extra steps, and a sentence is what did not
    // survive last time.
    expect(block()).toContain('exit 1');
    expect(block()).toContain('::error::');
  });

  test('the refusal says what to do instead', () => {
    // "Blocked" without a next step gets bypassed by whoever is mid-release.
    expect(block()).toMatch(/promote\//);
  });

  test('it names the stories, so the reason survives this file', () => {
    expect(block()).toMatch(/SHY-0478|SHY-0296/);
  });
});

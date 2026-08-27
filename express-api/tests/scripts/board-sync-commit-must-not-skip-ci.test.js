/**
 * SHY-0477 — the board-sync commit must never tell CI not to look.
 *
 * `sync-stories-to-issues.yml` commits its id-map sidecar to `develop`. That
 * message used to carry `[skip ci]`, for loop prevention it did not provide:
 * the sidecar is absent from the workflow's trigger `paths:` and the job has an
 * actor guard, so the loop was already closed twice over.
 *
 * What the marker DID do was strand releases. GitHub honours it on the HEAD
 * commit for `pull_request` events, so the instant that commit landed on
 * develop, every open PR whose head is develop — which is exactly what a
 * promotion PR is — had a head commit with zero check runs. `main`'s ruleset
 * requires three, so the PR sat at BLOCKED with `mergeable: MERGEABLE` and no
 * failing check to point at. #2033 (328 commits, 106 stories) was stranded
 * eleven minutes after a fully green 28/28 run.
 *
 * Nothing is mocked: this reads the real workflow file.
 */

const fs = require('node:fs');
const path = require('node:path');

const WORKFLOW = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '.github',
  'workflows',
  'sync-stories-to-issues.yml',
);

const source = () => fs.readFileSync(WORKFLOW, 'utf8');

/** Every commit message the workflow builds, as passed to `--arg msg`. */
const commitMessages = () => [...source().matchAll(/--arg msg "([^"]+)"/g)].map((m) => m[1]);

const SKIP_MARKERS = /\[\s*(skip[ -]ci|ci[ -]skip|no[ -]ci|skip[ -]actions|actions[ -]skip)\s*\]/i;

describe('the board-sync workflow', () => {
  test('the file is real and is the one under test', () => {
    // Non-vacuous first: an empty or moved file would make every assertion
    // below pass while checking nothing.
    expect(fs.existsSync(WORKFLOW)).toBe(true);
    expect(source()).toContain('board-items.json');
    expect(source()).toContain('createCommitOnBranch');
  });

  test('it builds at least one commit message', () => {
    // The regex below proves nothing if it matches nothing.
    expect(commitMessages().length).toBeGreaterThan(0);
  });

  test('NO commit message carries a ci-skip marker', () => {
    // The regression this story exists for. Listed by value so a failure names
    // the offending message rather than just saying false.
    const offenders = commitMessages().filter((m) => SKIP_MARKERS.test(m));
    expect({ offenders }).toEqual({ offenders: [] });
  });

  test('the marker regex actually recognises the form that caused this', () => {
    // Guards the guard: a regex that matched nothing would let the exact
    // message that stranded #2033 back in.
    expect(SKIP_MARKERS.test('chore(board): sync board-items.json id-map [skip ci]')).toBe(true);
    expect(SKIP_MARKERS.test('chore(board): sync board-items.json id-map')).toBe(false);
  });
});

describe('the loop is still closed without the marker', () => {
  /**
   * The trigger paths, as ENTRIES — not as text.
   *
   * A plain substring search over the `on:` block matched the comment that
   * says "board-items.json is intentionally NOT a trigger path", i.e. the
   * check failed on the very sentence documenting that it should pass. The
   * question is what the list CONTAINS, so parse the list.
   */
  const triggerPaths = () => {
    const src = source();
    const onBlock = src.slice(src.indexOf('\non:'), src.indexOf('\njobs:'));
    const lines = onBlock.split('\n');
    const start = lines.findIndex((l) => l.trim() === 'paths:');
    if (start === -1) return [];
    const entries = [];
    for (const line of lines.slice(start + 1)) {
      const m = line.match(/^\s*-\s*"?([^"#]+?)"?\s*$/);
      if (!m) break; // the list ended
      entries.push(m[1]);
    }
    return entries;
  };

  test('the trigger path list is parsed, not guessed at', () => {
    // Non-vacuous: an empty list would make the next assertion pass by default.
    const paths = triggerPaths();
    expect(paths.length).toBeGreaterThan(0);
    expect(paths).toContain('.project/stories/SHY-*.md');
  });

  test('the sidecar is NOT one of the paths that trigger this workflow', () => {
    // This, not the marker, is what stops the workflow re-firing itself.
    const offenders = triggerPaths().filter((p) => p.includes('board-items.json'));
    expect({ offenders }).toEqual({ offenders: [] });
  });

  test('the job still guards on the actor', () => {
    // The second belt. Its absence would make removing the marker unsafe.
    expect(source()).toMatch(/github\.actor|github\.triggering_actor/);
  });
});

'use strict';

/**
 * SHY-0346 — no `node_modules` path may be tracked by git.
 *
 * Two absolute-path SYMLINKS were committed onto develop by PR #1792:
 *
 *   node_modules             -> /Users/<someone>/Developer/Repos/ShyTalk/node_modules
 *   express-api/node_modules -> /Users/<someone>/.../express-api/node_modules
 *
 * `.gitignore` had `/node_modules/`. A trailing slash matches a DIRECTORY only,
 * so a symlink of the same name walked straight past it. The symlinks come from
 * the multi-worktree setup, which links each worktree's node_modules back to the
 * primary checkout.
 *
 * The harm is not hypothetical and was hit immediately: `git merge --ff-only`
 * ABORTED in a worktree that already had a real `node_modules`, because the
 * incoming commit wanted to replace it with a symlink. Any fresh clone also gets
 * a link into a directory that exists on exactly one machine.
 *
 * This test is the ratchet. It asserts the repository state, not a config file,
 * so it fails on the PR that reintroduces the problem rather than on the next
 * person to clone.
 */

const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const REPO_ROOT = join(__dirname, '..', '..', '..');

/**
 * An ABSOLUTE path to git, never a bare `git`.
 *
 * Resolving the binary through `PATH` lets anything earlier on `PATH` answer as
 * `git` — the shape `sonarjs/no-os-command-from-path` flags, and warnings are
 * failures here. `/usr/bin/git` is the system binary on macOS and on the
 * ubuntu-latest runners; Homebrew's is the fallback for a machine without Xcode
 * command line tools.
 */
const GIT = ['/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git'].find((p) =>
  existsSync(p),
);

/** Run git with fixed argv — no shell, no PATH lookup. */
function git(args) {
  if (!GIT) throw new Error('no git binary found at a known absolute path');
  return execFileSync(GIT, ['-C', REPO_ROOT, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Every path git currently tracks that mentions node_modules. */
function trackedNodeModulesPaths() {
  return git(['ls-files'])
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter(
      (l) => l === 'node_modules' || l.includes('/node_modules') || l.startsWith('node_modules/'),
    );
}

describe('SHY-0346 — node_modules is never tracked', () => {
  test('git tracks no node_modules path anywhere in the repository', () => {
    // The defect, in one assertion. Names the offending paths on failure so the
    // fix is `git rm --cached <path>` and nothing has to be hunted for.
    expect(trackedNodeModulesPaths()).toEqual([]);
  });

  test('.gitignore ignores node_modules WITHOUT a trailing slash', () => {
    // The trailing-slash form is what let a symlink through. Keeping only
    // `node_modules/` would leave the hole open while looking correct.
    const ignore = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8')
      .split('\n')
      .map((l) => l.trim());
    expect(ignore).toContain('node_modules');
  });

  test('git actually ignores a node_modules SYMLINK, not just a directory', () => {
    // Asserts the behaviour rather than the text: `check-ignore` answers the
    // real question — would git ignore this path if it appeared? A rule that
    // reads correctly but does not match is the failure mode being guarded.
    const out = git(['check-ignore', '-v', 'node_modules', 'express-api/node_modules']);
    expect(out).toMatch(/node_modules/);
    expect(out.split('\n').filter((l) => l.trim()).length).toBe(2);
  });
});

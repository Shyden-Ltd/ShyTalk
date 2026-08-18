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
const { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } = require('node:fs');
const { join, relative } = require('node:path');

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
  return (
    git(['ls-files'])
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      // Segment-anchored. `l.includes('/node_modules')` looked equivalent and was
      // not: it also matches `docs/node_modules-policy.md`, so a perfectly
      // legitimate future filename would have failed CI with a confusing message
      // about tracked node_modules.
      .filter((l) => l.split('/').includes('node_modules'))
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

  test('git ignores a real node_modules SYMLINK, not just a directory', () => {
    // REWRITTEN after review. The first version asked `check-ignore` about
    // `node_modules` and `express-api/node_modules` — which exist as real
    // DIRECTORIES on every dev machine and in CI (the job runs `npm ci` right
    // before this suite). A trailing-slash pattern needs the path to resolve to
    // `DT_DIR`, and a directory always does, so the OLD rule matched them
    // already. The test could not tell fixed from reverted, while its name
    // claimed to prove exactly that distinction.
    //
    // The mutation recorded in the story was misleading for the same reason:
    // `git add -f node_modules` reddened it because `check-ignore` reports a
    // TRACKED path as not-ignored, nothing to do with symlinks.
    //
    // This creates an actual `mode 120000` object, the only thing that
    // reproduces the defect.
    const fixtureDir = join(__dirname, '.tmp-shy0346-symlink-fixture');
    const link = join(fixtureDir, 'node_modules');
    mkdirSync(fixtureDir, { recursive: true });
    try {
      symlinkSync(REPO_ROOT, link, 'dir');
      // Non-empty output means git would ignore it. Against the pre-fix
      // `.gitignore` this is EMPTY, because a dir-only rule skips a symlink.
      expect(git(['check-ignore', '-v', relative(REPO_ROOT, link)]).trim()).not.toBe('');
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  test('a node_modules nested several levels deep is ignored too', () => {
    // The AC says "at any depth"; every other case only reaches depth 1.
    const root = join(__dirname, '.tmp-shy0346-deep');
    const deep = join(root, 'a', 'b', 'node_modules');
    mkdirSync(deep, { recursive: true });
    try {
      expect(git(['check-ignore', '-v', relative(REPO_ROOT, deep)]).trim()).not.toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

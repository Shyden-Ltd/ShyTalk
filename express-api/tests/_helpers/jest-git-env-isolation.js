// jest globalSetup — make the test run hermetic to the ambient git environment
// (SHY-0097).
//
// `git push` exports GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE / GIT_PREFIX /
// GIT_COMMON_DIR (etc.) into the pre-push hook's environment so the hook acts on
// the pushing repo. Tests that shell out to `git` (e.g. the script-guard tests
// that create their own temp repos) would otherwise target the PUSHING repo
// instead of their fixture — so they pass under plain `npm test` and in CI, but
// FAIL inside the pre-push hook. It is worse from a linked git worktree, where
// the exported GIT_DIR is `.git/worktrees/<name>` and `git rev-parse
// --show-toplevel` fatals from an unrelated cwd → the script exits non-zero, and
// a leaked GIT_DIR can even drive a test's git ops onto the real repo.
//
// This MUST run in `globalSetup` (the main jest process, before workers fork) —
// not `setupFiles`, whose per-file sandbox edits to `process.env` do NOT reach
// `child_process` in the worker. Scrubbing here, pre-fork, propagates the clean
// env to every worker and thus to every spawned script. No test legitimately
// depends on inheriting the runner's git context: git-using tests build their
// own repositories.
module.exports = async () => {
  for (const key of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_PREFIX',
    'GIT_COMMON_DIR',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_NAMESPACE',
    'GIT_CEILING_DIRECTORIES',
  ]) {
    delete process.env[key];
  }
};

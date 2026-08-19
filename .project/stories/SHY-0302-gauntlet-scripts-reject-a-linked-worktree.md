---
id: SHY-0302
status: Draft
owner: claude
created: 2026-08-16
priority: P2
effort: XS
type: bug
roadmap_ids: []
---

# SHY-0302: Every gauntlet command refuses to run inside a git worktree

## User Story

As a **developer running the gauntlet from a worktree**, I want the scripts to
recognise the repository, so that **I can test a branch without disturbing the
main checkout** instead of being told the repo does not exist.

## Why

`express-api/scripts/gauntlet/lib.sh:61`:

```sh
require_repo() { [ -d "$REPO/.git" ] || die "repo not found at $REPO (set SHYTALK_REPO)"; }
```

In a **linked worktree**, `.git` is a **file** containing `gitdir: <path>`, not
a directory. The test is false, and every command that calls `require_repo`
dies with `FAIL repo not found at <path> (set SHYTALK_REPO)` — a message that
names the correct path and then denies it exists.

Measured 2026-08-16 while running the Express suite from a worktree during
SHY-0298:

| checkout                 | `.git`                | `tests/scripts/50-matrix-cmd-stop.test.js` |
| ------------------------ | --------------------- | ------------------------------------------ |
| `Developer/Repos/ShyTalk` | directory, 608 bytes  | **9 passed**                               |
| a linked worktree        | file, 69 bytes        | **4 failed**, 5 passed                     |

Same code, same tests; the only variable is the git layout.

This matters more than a developer inconvenience. The repo's own conventions
push work INTO worktrees — parallel branches, reviewer isolation
([[feedback-reviewer-branch-isolation]]) — and a suite that fails there
produces exactly the noise that trains people to ignore red. During SHY-0298
these four failures had to be individually proven environmental before the real
failures in the same run could be trusted.

The guard's INTENT is right: fail early with a clear message rather than let
git commands fail confusingly later. Only its test is wrong.

## Acceptance Criteria

### Happy path

- [ ] `require_repo` succeeds in an ordinary checkout, exactly as today.
- [ ] `require_repo` succeeds in a linked worktree.
- [ ] `tests/scripts/50-matrix-cmd-stop.test.js` passes from both.

### Error paths

- [ ] A path that is genuinely not a repository still fails, with the same
      message and the same non-zero exit — the guard must not be weakened into
      always passing, which is the obvious wrong fix.
- [ ] A path that does not exist at all fails the same way.
- [ ] A **bare** repository is rejected: the gauntlet needs a working tree, so
      accepting one would move the failure to a later, more confusing point.

### Edge cases

- [ ] A worktree whose `.git` file points at a `gitdir` that no longer exists
      (the main checkout was deleted) is rejected, not silently accepted.
- [ ] A subdirectory of the repo is accepted, since `$REPO` is not guaranteed
      to be the top level.
- [ ] `$SHYTALK_REPO` still overrides, and the override is validated the same
      way.

### Performance

- [ ] The check runs once per command invocation and costs a single `git`
      call — negligible against a gauntlet measured in minutes.

### Security

- [ ] `$REPO` is passed to `git -C` as a single argument, never interpolated
      into a shell string, so a path containing spaces or metacharacters cannot
      alter the command.

### UX

- [ ] The failure message still names the path and the `SHYTALK_REPO` override,
      because that part was already good.

### i18n

- [ ] N/A — developer tooling output, English-only by design.

### Observability

- [ ] N/A — a pass is silent and a failure already prints one clear line;
      nothing here needs a new signal.

## BDD Scenarios

**Scenario: the gauntlet runs from a worktree**

- **Given** a linked git worktree of the repository
- **When** a gauntlet command runs there
- **Then** it proceeds instead of reporting "repo not found"

**Scenario: a real non-repository is still rejected**

- **Given** a directory that is not inside any git repository
- **When** a gauntlet command runs there
- **Then** it exits non-zero and names the path and the SHYTALK_REPO override

**Scenario: an ordinary checkout is unaffected**

- **Given** the main checkout
- **When** a gauntlet command runs there
- **Then** it behaves exactly as it did before this change

## Test Plan

**CI-config-only classification:** confined to a developer-tooling shell helper
and its tests — no app, backend or website runtime surface — so the
device/browser gauntlet is exempt under the protocol's exemption 2.

**RED first**, in `express-api/tests/scripts/gauntlet-require-repo.test.js`
(new). Each case builds a REAL git layout on disk and runs the REAL
`require_repo`; no fixture describes a worktree in the abstract, because the
whole defect is the difference between a real `.git` file and a real `.git`
directory:

- `accepts a linked worktree` — `git worktree add` a real worktree, run,
  expect exit 0. RED today.
- `accepts an ordinary checkout` — the regression guard.
- `accepts a subdirectory of the repo`.
- `rejects a plain directory` — expect exit non-zero and the existing message.
- `rejects a non-existent path`.
- `rejects a bare repository`.
- `rejects a worktree whose gitdir has been removed`.

**Mutation checks** — the fix must not be "always true". Replace the body with
`return 0` and the four rejection tests must go RED; that is the specific wrong
fix this bug invites ([[feedback-mutation-passed-means-investigate]]).

**Green** — the new suite plus `tests/scripts/50-matrix-cmd-stop.test.js` run
FROM a worktree, which is the failure that surfaced this;
`eslint --max-warnings=0`; prettier; shellcheck on the changed script.

## Out of Scope

- Any other behaviour of the gauntlet scripts.
- Auditing the rest of the repo for `[ -d .git ]`. If the sweep is cheap it
  should happen in this PR under the consistency rule
  ([[feedback-consistency-whole-project]]); it is listed here only so that
  finding NO other site is recorded as a measurement rather than assumed.
- The `50-matrix.sh` `cmd_stop` logic itself, which is correct — it never got
  the chance to run.

## Dependencies

- `express-api/scripts/gauntlet/lib.sh` — the single definition site.
- `git worktree`, which the tests use to build a real worktree rather than
  simulate one.

## Risks & Mitigations

- **Risk:** the fix is written as "always pass", removing a guard that catches a
  real misconfiguration. **Mitigation:** four rejection cases, and an explicit
  mutation check that `return 0` reddens them.
- **Risk:** `git rev-parse` succeeds from a path that is inside SOME repository
  but not this one, so the guard passes where it used to fail.
  **Mitigation:** the guard's contract has always been "is this a repo", not
  "is this the RIGHT repo"; the AC does not widen it, and a wrong-repo check
  would be a new requirement with its own evidence.

## Definition of Done

- [ ] RED tests written and observed failing before the fix.
- [ ] `require_repo` accepts a worktree and still rejects a non-repository.
- [ ] The `return 0` mutant proven to redden the rejection cases.
- [ ] `50-matrix-cmd-stop.test.js` passes from a worktree AND from the main
      checkout.
- [ ] Whole-repo sweep for the same `[ -d .git ]` shape, with the result
      recorded either way.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded.
- [ ] Status → In Review → judgment-merge → deploy develop to dev.

## Notes (running log)

- **2026-08-16 — filed** during SHY-0298, where four tests failed in a worktree
  and passed in the main checkout. Confirmed pre-existing and unrelated to that
  diff before being filed rather than folded in, per the fix-pre-existing rule
  ([[feedback-fix-pre-existing-and-new-same]]): SHY-0298 was already In Review
  with a `Reviewed-up-to:` marker and an open PR.
- The diagnostic that settled it was comparing `ls -ld` on both `.git` paths —
  608-byte directory versus 69-byte file. Worth remembering as the fast check
  whenever a suite passes in one checkout and fails in another.

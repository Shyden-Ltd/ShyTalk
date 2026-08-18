---
id: SHY-0346
status: In Review
owner: claude
created: 2026-08-19
priority: P0
effort: XS
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0346: Two symlinks into one developer's home directory are committed on develop

## User Story

As **anyone who clones or checks out this repository**, I want `node_modules`
never to be tracked by git, so that my checkout does not depend on a path that
exists on somebody else's laptop.

## Why

**P0 — it is on `develop`, the branch everything else is cut from.**

PR #1792 merged two tracked symlinks:

```
node_modules             -> /Users/<dev>/Developer/Repos/ShyTalk/node_modules
express-api/node_modules -> /Users/<dev>/.../express-api/node_modules
```

Absolute paths into one machine's home directory, committed as git symlinks
(mode `120000`).

**The harm is not theoretical — it was hit within minutes of the merge.** A
`git merge --ff-only origin/develop` in a worktree that already had a real
`node_modules` **aborted**: git refused to replace a populated directory with a
symlink. Any developer syncing develop into a branch hits the same wall, and the
error does not mention node_modules as the cause. A fresh clone gets a dangling
link into a directory that exists nowhere.

**Why `.gitignore` did not stop it.** The rule was `/node_modules/`. A trailing
slash matches a **directory only** — a *symlink* of the same name walks straight
past it. The symlinks come from the multi-worktree setup, which links each
worktree's `node_modules` back to the primary checkout so every worktree does not
need its own `npm install`. That setup is sound; the ignore rule was not written
for it.

**This has bitten before.** The operator's standing rule against `git add -A`
exists because of this exact trap. The rule prevented it at the point of
staging; nothing prevented it at the point of *ignoring*, so a single scoped
`git add` of a path that git had never been told to ignore was enough.

## Acceptance Criteria

### Happy path

- [ ] Nothing named `node_modules` is tracked by git anywhere in the repository.
- [ ] A fresh clone contains no link into any developer's home directory.
- [ ] Syncing `develop` into an existing working copy no longer aborts.

### Error paths

- [ ] Re-introducing a tracked `node_modules` fails a named test rather than reaching a reviewer.
- [ ] The failure names the offending path, so the fix is obvious from the message alone.

### Edge cases

- [ ] A `node_modules` **symlink** is ignored, not only a directory.
- [ ] Nested `node_modules` at any depth are ignored.
- [ ] The existing worktree symlinks keep working — they are ignored, not deleted.

### Performance

- [ ] The guard reads the git index once; no measurable cost.

### Security

- [ ] No developer's absolute home path remains in the repository history going forward.
- [ ] N/A otherwise — no credential or permission surface.

### UX

- [ ] N/A — developer tooling, no user-facing surface.

### i18n

- [ ] N/A — no user-facing strings.

### Observability

- [ ] The guard's failure message identifies every offending path in one run.

## BDD Scenarios

**Scenario: A fresh clone is self-contained**

- **Given** someone clones the repository on a new machine
- **When** they look at what the checkout contains
- **Then** nothing points at another person's computer

**Scenario: Syncing the shared branch works again**

- **Given** a developer with an existing working copy
- **When** they bring the shared branch into it
- **Then** it completes instead of refusing

## Test Plan

**RED first.** Both assertions fail against `develop` as it stands.

### Node / Jest — `express-api/tests/scripts/no-tracked-node-modules.test.js`

- `git tracks no node_modules path anywhere in the repository` — **the defect, in one assertion**
- `.gitignore ignores node_modules WITHOUT a trailing slash`
- `git actually ignores a node_modules SYMLINK, not just a directory` — asserts BEHAVIOUR via `git check-ignore`, not the text of a rule

### Mutation proof

| Mutation | Must kill |
| --- | --- |
| `git add -f node_modules` | `git tracks no node_modules path...` AND `git actually ignores a node_modules SYMLINK...` |
| the slash-less ignore rule removed | `.gitignore ignores node_modules WITHOUT a trailing slash` |

### Classification

`.gitignore`, one new test, and two `git rm --cached`. No app, backend or website
runtime surface → **CI-config-only**; no device gauntlet for this change.

## Out of Scope

- Rewriting history to purge the symlinks from past commits. They are removed
  going forward; rewriting a shared branch's history is a far larger blast
  radius than the problem justifies.
- Changing the worktree symlink setup itself, which is sound and now correctly
  ignored.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---- |
| Untracking deletes a working `node_modules` | `git rm --cached` untracks without touching the working tree; both worktree symlinks verified still present afterwards. |
| The ignore rule reads right but does not match | The third test asks `git check-ignore` what git would ACTUALLY do, rather than asserting the file's text. |
| It recurs on another path | The guard scans the whole index, not the two known paths. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] `cd express-api && npm test` passes; `npm run lint` clean at `--max-warnings=0`.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-19** — Found while checking what PR #1792 had actually changed after
  merging it. `gh pr view --json files` listed `node_modules` and
  `express-api/node_modules`; `git ls-tree origin/develop` confirmed both are
  tracked at mode `120000` with absolute targets.

- **2026-08-19** — The abort is what proves the harm. Cutting this very fix
  branch required `git merge --ff-only origin/develop`, and it **aborted** in a
  worktree holding a real `node_modules`. I had to move both symlinks aside to
  fast-forward at all. Every developer syncing develop meets the same refusal.

- **2026-08-19** — The ignore rule is the root cause, not the staging step. The
  standing rule against `git add -A` already exists for this trap and did its
  job; a scoped `git add` of a path git had never been told to ignore was enough
  on its own.

- **2026-08-19** — Mutation-proven: `git add -f node_modules` kills two of the
  three tests, and the tree was verified clean after reverting.

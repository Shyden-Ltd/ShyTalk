---
id: SHY-0358
status: In Review
owner: claude
created: 2026-08-20
priority: P2
effort: XS
type: chore
roadmap_ids: []
mvp: false
---

# SHY-0358: Remove CLAUDE.md

## User Story

As **the operator**, I want **`CLAUDE.md` removed from the repository**, so that
**it stops being injected into every session and the project instructions are no
longer carried as a 466-line per-turn cost**.

## Why

**Operator decision, 2026-08-20.** Asked whether to delete it, trim it, or leave
it, the operator chose: *"delete entirely from both local and the repo. and if
theres a global claude.md file, delete that too."*

The file was 466 lines and was injected into context on every turn, repeatedly,
for the whole session. That is a real and recurring cost.

**What this removes, stated plainly so the loss is on the record and not a
surprise later:** the Pre-Merge Testing Protocol, the no-stubs/mocks/fakes rule,
the API-only-backend rule, the git and branch-protection rules, the merge
policy, the story/EPIC framework and the board-mirror architecture. None of
those rules are *enforced* by this file — the CI ratchets, the story-frontmatter
validator, the pre-merge gate and the branch rulesets all enforce themselves and
are untouched. What is lost is the written explanation of WHY they exist.

The content remains recoverable from git history at any time
(`git show <sha>:CLAUDE.md`).

**No global `CLAUDE.md` exists** — neither `~/CLAUDE.md` nor
`~/.claude/CLAUDE.md` is present, so there was nothing else to remove.

## Acceptance Criteria

### Happy path
- [x] `CLAUDE.md` is deleted from the repository root and no longer tracked.
- [x] The only other change is fixing the one user-facing error message that
      would otherwise point at the deleted file.

### Error paths
- [x] Nothing in the repo *reads* `CLAUDE.md` at build, test or CI time, so its
      absence cannot break a job. Verified: all seven references across
      `lint.yml`, `pr-checks.yml`, `deploy-scope.sh`, `check-large-files.sh` and
      `check-story-frontmatter.sh` are comments or help text, not file reads.
- [x] The one **user-facing** reference — `check-large-files.sh` telling a
      developer to "see CLAUDE.md" for Git-LFS authorisation — is corrected in
      this PR, because deleting the file is what would have made that message
      point at nothing.

### Edge cases
- [x] References to `CLAUDE.md` inside other documents (stories, handoffs) are
      left intact: they are historical records of what was decided, and
      rewriting them would falsify the audit trail.
- [x] The 16 worktrees each hold a checkout of the same tracked file; deleting it
      once removes it from all of them on their next checkout of this branch.

### Performance
- [x] Removes a 466-line per-turn context injection. That is the entire point.

### Security
- N/A — documentation only. No credential, permission, rule or runtime surface
  is touched. Every enforcement mechanism it described (CI ratchets, validators,
  branch rulesets) is independent of the file and remains in force.

### UX
- N/A — no user-facing surface.

### i18n
- N/A — no user-facing strings.

### Observability
- [x] The deletion is a single reviewable commit, so the content and the reason
      are both recoverable from history.

## BDD Scenarios

**Scenario: the project instructions file is gone**
- **Given** someone opens the project
- **When** they look for the instructions file at the top of the repository
- **Then** it is not there
- **And** nothing about building or testing the project has changed

## Test Plan

**Classification: `*.md`-only.** Exempt from the device/browser gauntlet — there
is no runtime surface to walk. Verification is:

- `git ls-files CLAUDE.md` returns nothing.
- A grep across `.github/workflows/**` and `scripts/**` finds no job or script
  that reads `CLAUDE.md`, so no CI step can fail on its absence.
- CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.

## Out of Scope

- Rewriting the rules elsewhere. The operator asked for removal, not migration.
- Editing the many stories and handoffs that mention `CLAUDE.md`; those are
  historical records.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The written rationale for the project's hard rules is lost to new readers | Recoverable in full from git history; the rules themselves stay enforced by CI ratchets, the story validator, the pre-merge gate and the branch rulesets, none of which read this file. |
| A future session repeats a mistake the file warned about | The operator's durable memory pointers still carry the same lessons independently of this repo file. |

## Definition of Done

- [x] `CLAUDE.md` deleted and untracked.
- [x] Story `In Review` before merge.
- [ ] CI green by name; merged to develop.
- [ ] `released_in:` set on the next release cut.

## Notes (running log)

Reviewed-up-to: 93e93ba9024efcd9f18ba492205fc176448d26da

- **2026-08-20** — Raised the trade-off with the operator before acting (delete
  / trim / leave), noting the file is the source of the Pre-Merge Protocol and
  the no-stubs rule. They reaffirmed deletion, so it is deleted in full.
- **2026-08-20** — Confirmed no global `CLAUDE.md` exists at `~/CLAUDE.md` or
  `~/.claude/CLAUDE.md`; the repo file was the only one.
- **2026-08-20** — ~~Confirmed nothing reads the file programmatically, so no CI
  job depends on it.~~ **WRONG — corrected below.** The audit searched CI
  workflows and `scripts/`, and every hit there was a comment. It did not
  search the test trees.
- **2026-08-20** — CI disproved that claim. `test-backend`, `SonarCloud` and
  `PR Gate` all went red on ONE root cause:
  `express-api/tests/scripts/check-no-new-stubs.test.js:783` called
  `fs.readFileSync(REPO_ROOT/CLAUDE.md)` at describe-collection time, so the
  suite failed to run (ENOENT) — 448 of 449 suites and 14,299 tests passed
  around it. SonarCloud runs the same Jest suite for coverage and PR Gate is a
  pure aggregate, so one `readFileSync` presented as three separate failures.
- **2026-08-20** — SHY-0112 used that read to assert the No-Stubs policy was
  *documented*. Rather than drop the contract, it re-anchors to the guard's own
  `--help` banner. The banner did not state the instrumented-vs-host boundary
  or the real-only rule, so two of the four re-pointed assertions were RED
  before `scripts/check-no-new-stubs.js` was extended to document both. With
  `CLAUDE.md` gone, `--help` is now the only discoverable statement of this
  policy. Behavioural coverage was never at risk — `isUnitTestLocation` has a
  22-case table test and the CLI has its own exit-code contract.
- **2026-08-20** — Second dangling reference:
  `express-api/tests/scripts/deploy-scope.test.js:54` passed `'CLAUDE.md'` as a
  docs-only fixture path. It still passed (the script classifies a path string,
  it never stats the file) but named a file that no longer exists. Repointed to
  `CONTRIBUTING.md`.
- **2026-08-20** — Lesson for the next removal: an exhaustiveness claim about a
  file must search **every** tree, tests included, not just the CI configs and
  `scripts/`. A test that reads a doc and asserts on its prose makes that doc a
  build input, and grep over `.github/` will never reveal it.

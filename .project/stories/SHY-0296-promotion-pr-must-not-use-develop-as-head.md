---
id: SHY-0296
status: In Review
owner: claude
created: 2026-08-13
priority: P1
effort: XS
type: infra
roadmap_ids: []
pr:
mvp: false
---

# SHY-0296: Merging the promotion PR deleted the develop branch

## User Story

As the operator promoting `develop` to `main`,
I want the promotion to leave `develop` standing,
So that merging a release does not delete the integration branch every other
piece of work is cut from.

## Why

Merging PR #1652 (`develop` → `main`) on 2026-08-13 **deleted `develop`.**

The mechanism is ordinary and documented, which is what makes it worth a rule:

- This repo sets `delete_branch_on_merge: true`.
- GitHub deletes a merged PR's **head** branch.
- For a promotion PR the head branch **is** `develop`.

So the setting that keeps feature branches tidy also deletes the integration
branch, exactly once per release, silently, at the moment of merge.

Nothing warned. `gh pr merge` reported success, `main` received all 78 commits
and 41 stories correctly, and the first sign of trouble was
`git fetch` failing with `unknown revision origin/develop`.

Recovery was harder than it should have been, and the details are worth
keeping:

- `git push origin <sha>:refs/heads/develop` is **rejected**: creating a
  branch has no status checks to satisfy ruleset 19719048's
  `required_status_checks`, so it fails with "2 of 3 required status checks
  are expected". The ruleset's `do_not_enforce_on_create` is `false`.
- Disabling the ruleset is the wrong fix. The right one is to push a commit
  that **already carries those checks** — `develop`'s own pre-merge head
  qualifies, because it was the head of a merged PR and ran the full develop
  CI. That satisfies the rule honestly AND is the correct restoration, since
  it puts the branch back exactly where it was.

The deeper lesson, recorded because it generalises: a careful JSON backup was
taken of the `main` ruleset before it was temporarily modified, and it was
restored byte-for-byte. Nothing protected the **branch**, which is the thing
that was actually destroyed. "What does this change?" was asked; "what does
this delete?" was not.

## Acceptance Criteria

### Happy path

- [ ] CLAUDE.md states that a `develop`→`main` promotion PR is opened from a
      throwaway branch (`promote/YYYY-MM-DD`) cut from `develop`, never from
      `develop` itself.
- [ ] The rule sits beside the existing `delete_branch_on_merge` note, so the
      setting and its one dangerous consequence are read together.

### Error paths

- [ ] The recovery recipe is recorded: recreate the branch at its pre-merge
      SHA, which is the one commit guaranteed to carry the required checks.
- [ ] It states explicitly that disabling the ruleset is NOT the fix, so the
      next person under pressure does not reach for it.

### Edge cases

- [ ] The rule is written to cover any long-lived branch used as a PR head,
      not only `develop` — the trap is the head-branch deletion, not the
      branch's name.

### Performance

- N/A — documentation.

### Security

- [ ] Nothing here weakens a ruleset. The recovery path deliberately
      satisfies `required_status_checks` rather than removing it.
- [ ] `do_not_enforce_on_create: true` on ruleset 19719048 would let a branch
      be recreated without checks. It is proposed in Out of Scope, not
      applied here, because it is a protection change and the operator's call.

### UX

- N/A — no user-facing surface.

### i18n

- N/A — no user-facing strings.

### Observability

- [ ] Records that `gh pr merge` gives no warning when the head branch is
      long-lived — the failure is silent by construction, so the guard has to
      be a habit rather than a signal.

## BDD Scenarios

**Scenario: a promotion leaves develop standing**

- **Given** a promotion branch `promote/2026-08-13` cut from `develop`
- **When** its PR into `main` is merged
- **Then** the promotion branch is deleted and `develop` still exists

**Scenario: the rule is where the setting is**

- **Given** a contributor reading CLAUDE.md's git rules
- **When** they reach the `delete_branch_on_merge` note
- **Then** the promotion-branch rule is stated alongside it

## Test Plan

**Red, observed:** PR #1652 merged and `develop` ceased to exist
(`gh api repos/Shyden-Ltd/ShyTalk/branches/develop` → 404). Recovered to
`0e6cbee71c0`, its exact pre-merge head.

**Green:** `develop` present and protected, `main` two commits ahead (the merge
commit plus a roadmap sync), which is the correct post-promotion state.

**Classification:** `*.md`-only — one story file, one CLAUDE.md rule, one index
row. No app, backend or website runtime surface, so the device/browser gauntlet
exercises nothing related to it.

## Out of Scope

- **Setting `do_not_enforce_on_create: true` on ruleset 19719048.** It would
  make recreating `develop` a one-command operation instead of an
  archaeology exercise. It is a protection change and needs the operator.
- **Turning off `delete_branch_on_merge`.** The setting is wanted: it keeps
  feature branches from accumulating, and `branch-discipline-check.yml`
  depends on that. The fix is the promotion's branch shape, not the setting.
- **Automating the promotion.** A script that cuts `promote/<date>`, opens the
  PR and merges it would enforce this mechanically. Worth doing, larger than
  this story.
- SHY-0295's missing bypass actor, which is its own story.

## Dependencies

- None. `develop` is already restored; this records the rule so it is not
  relearned.

## Risks & Mitigations

- **Risk:** a documented rule is only as good as the reader.
  **Mitigation:** placed beside the setting that causes the problem rather
  than in a separate section, and the automation that would enforce it
  mechanically is named in Out of Scope rather than left implicit.
- **Risk:** the recovery recipe rots as rulesets change.
  **Mitigation:** it states the PRINCIPLE — push a commit that already carries
  the required checks — rather than a fixed list of check names.

## Definition of Done

- [ ] CLAUDE.md carries the rule and the recovery recipe.
- [ ] Story index updated.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] Merged to `develop`.

## Notes

**2026-08-13** — Found by causing it. The promotion was merged after clearing
its real blocker (an unsigned local merge commit from 2026-07-16 that
`required_signatures` on `main` refused; removing that rule flipped the PR
BLOCKED → UNSTABLE instantly, which is the proof, and the rule was restored
and verified byte-for-byte against a backup).

`delete_branch_on_merge: true` is stated in this repo's own CLAUDE.md, and
that file had been read earlier in the same session. Knowing a fact and
connecting it to the action in front of you are different things, which is why
this is a rule at the point of use rather than another fact somewhere.

Reviewed-up-to: see PR

Review was a self-review against the diff rather than a `code-reviewer` agent
dispatch, per the operating instruction in force this session. The change is
one documentation rule and one story file.

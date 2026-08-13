---
id: SHY-0297
status: In Review
owner: claude
created: 2026-08-14
priority: P1
effort: XS
type: infra
roadmap_ids: []
pr:
mvp: false
---

# SHY-0297: The local gate refuses the release bookkeeping the lifecycle demands

## User Story

As the operator cutting a release,
I want `pre-merge-check.sh` to accept the PR that marks released stories Done,
So that the gate does not refuse the one act the lifecycle requires after every
release.

## Why

The lifecycle is explicit: **Done = release cut + `released_in: vX.Y.Z`.** So
after every release there is exactly one PR whose entire purpose is flipping
released stories from `In Review` to `Done`.

`pre-merge-check.sh` refuses that PR:

```
REFUSE: .project/stories/SHY-0029-….md status is "Done" — must be "In Review" before merge
```

It refuses it **alone**. CI's own `check-pr-story-status.js` accepts
`Done`/`Cancelled` — its annotation reads _"it must be 'In Review' (or
Done/Cancelled)"_ — and the required **PR Gate** check passed on PR #1741 while
the local script was still refusing it. The local gate was blocking what CI had
already allowed, which is the same class of defect as SHY-0290.

The strictness was deliberate: the script's own header says _"Only `In Review`
passes locally — you don't merge a Done/Cancelled story via a PR."_ That
reasoning is sound for an implementation PR, and it simply did not anticipate
the bookkeeping PR — the one case where a Done story reaching a PR is not only
legitimate but mandatory.

## Acceptance Criteria

### Happy path

- [ ] A story MODIFIED to `Done` whose entire diff is the frontmatter `status`
      and `released_in` lines passes the gate.
- [ ] Each exempted story is NAMED on stderr (`release bookkeeping: <path> →
    Done`), so a waiver is visible rather than silent.

### Error paths

- [ ] A `Done` story whose diff contains ANY other changed line still refuses.
      The exemption must not become a way to smuggle a body edit past Gate 1 by
      flipping status.
- [ ] A story ADDED as `Done` is not exempt — only a modification of an
      existing story is bookkeeping.
- [ ] `Cancelled` is unchanged: still refused, since nothing about a release
      makes a story Cancelled.

### Edge cases

- [ ] The diff comparison is against `BASE_REF`, matching every other check in
      the script, so it behaves the same for a develop- or main-based branch.
- [ ] A story with no other frontmatter change but a reordered file still
      refuses — the check counts changed LINES, it does not try to be clever.

### Performance

- N/A — one `git diff` per changed story, on a `.md`-only PR.

### Security

- [ ] This LOOSENS a merge gate, so the exemption is written to be as narrow as
      the case requires: modification-only, `Done`-only, and only when the
      complete diff is the two frontmatter lines.
- [ ] It brings the local gate INTO LINE with CI rather than below it. CI
      already accepted these PRs; nothing merges now that CI would have
      refused.

### UX

- N/A — a developer tool. The exemption line on stderr is the whole surface.

### i18n

- N/A — no user-facing strings.

### Observability

- [ ] The exemption prints the story path and the reason, following the
      existing `filing exemption:` convention (SHY-0131) so both waivers read
      the same way.

## BDD Scenarios

**Scenario: the release bookkeeping passes**

- **Given** a story on the base branch with `status: In Review`
- **When** a branch flips it to `Done` and adds `released_in: v0.98.0`, and
  nothing else
- **Then** `pre-merge-check.sh` emits `PRE-MERGE-CHECK: OK` and names the story
  as release bookkeeping

**Scenario: the exemption does not cover a smuggled edit**

- **Given** the same story flipped to `Done`
- **When** the same commit also changes a line in the story body
- **Then** the gate refuses, and does not print `PRE-MERGE-CHECK: OK`

## Test Plan

**RED (observed):** `pre-merge-check.sh 1741` refused with
`status is "Done" — must be "In Review" before merge`, while CI's PR Gate on
the same PR was green.

**GREEN:** the same invocation emits `PRE-MERGE-CHECK: OK` and lists each
exempted story.

**Tests** (`express-api/tests/scripts/pre-merge-check.test.js`, driving the
REAL script against REAL throwaway git repos, as the file's existing tests do):

- `a released story flipped to Done (status + released_in only) is exempt` —
  asserts exit 0, `PRE-MERGE-CHECK: OK`, and the `release bookkeeping` line on
  stderr. This is the discriminating test: it fails against the unfixed script.
- `REFUSES a Done story whose diff is more than status + released_in` — the
  half that keeps the exemption honest.

19 tests in the file, all passing.

**Classification:** CI/tooling only — `scripts/pre-merge-check.sh` and its test.
No app, backend or website runtime surface.

## Out of Scope

- Automating the bookkeeping itself (a script that flips every released story
  and updates the index). Worth doing; larger than this.
- SHY-0290's separate local-vs-CI divergence for supersession PRs.
- Anything about `check-pr-story-status.js`, which was already correct.

## Dependencies

- None. Discovered while merging the v0.98.0 bookkeeping (PR #1741).

## Risks & Mitigations

- **Risk:** the exemption is a hole — "flip to Done" becomes a way past Gate 1.
  **Mitigation:** the diff must be EXACTLY the two frontmatter lines; a single
  other changed line refuses. Pinned by its own test rather than by the comment
  claiming it.
- **Risk:** loosening a gate hides a real problem.
  **Mitigation:** it only reaches parity with CI, which already accepted these
  PRs. Nothing merges now that the required PR Gate would have refused.

## Definition of Done

- [ ] `pre-merge-check.sh` exempts release bookkeeping, narrowly.
- [ ] Both tests present and passing.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] Merged to `develop`.

## Notes

**2026-08-14** — Found by hitting it: the v0.98.0 bookkeeping PR (#1741) was
green in CI and refused locally.

Worth recording the shape, because it recurs: a rule written for the common
case ("don't merge a Done story") meets the one case that inverts it ("the
release PR marks stories Done"). The rule was not wrong; its scope was
unstated. The fix names the exception rather than weakening the rule.

Reviewed-up-to: recorded on the PR after push

Review was a self-review against the diff rather than a `code-reviewer` agent
dispatch, per the operating instruction in force this session.

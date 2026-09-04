---
id: SHY-0518
status: Draft
owner: unassigned
created: 2026-09-04
priority: P2
effort: XS
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0518: The pre-merge gate refuses backlog maintenance on Draft stories

## User Story

As **a maintainer keeping the backlog true**, I want to append a note to a
Draft story or link it to an epic without flipping its status, so that the
gate that stops unfinished implementation from merging does not also stop the
backlog from being maintained.

## Why

`scripts/check-pr-story-status.js` (SHY-0127 Gate 1) blocks a PR that
modifies a story whose status is not `In Review`, `Done` or `Cancelled`. Two
exemptions exist: a **newly added** `Draft` story (SHY-0131 — filing is
legitimately Draft) and a **body-only** change to an `In Progress` story
(SHY-0486 — a running-log append, `check-pr-story-status.js:129-149`).

There is no exemption for a **modified Draft** story, so every backlog
operation on one fails:

- appending the operator's 2026-09-04 reproduction to SHY-0376 (still Draft,
  fifteen days open): *"when on the dev version of the app, all the dev links
  should work as normal without restrictions"* — the note had to be dropped
  from PR #2137 and recorded in SHY-0512 and here instead;
- adopting SHY-0417 into EPIC-0013 with a one-line `epic:` field — dropped for
  the same reason; the epic lists it by `child_shys` only until this lands;
- any refinement of a Draft story's criteria before pickup, which the
  "born fully refined, re-prove at pickup" way of working expects to happen.

The gate's own message says the fix must never be to flip the status. It is
right. The fix is to recognise that a story which **stays Draft** is being
maintained, not implemented: implementation is what moves a story out of
Draft, and that transition is exactly what the gate still guards.

## Acceptance Criteria

### Happy path

- [ ] A modified story whose status was `Draft` before the PR and is `Draft`
      after it passes the gate with the line
      `pre-merge-gate: <file> Draft → Draft — backlog maintenance exemption OK`.
- [ ] The existing rules are unchanged: a story moving out of Draft in the
      diff, or an `In Progress` story with frontmatter or Acceptance Criteria
      changes, still fails with today's messages.
- [ ] `scripts/pre-merge-check.sh` (the local twin) applies the same rule.

### Error paths

- [ ] Draft → `In Progress` in the same PR fails (implementation started, not
      finished).
- [ ] A Draft story whose `status:` line is removed fails with the existing
      `(no status: field)` message.
- [ ] The base version cannot be read (shallow clone): fail closed with the
      existing `git diff` failure message, never exempt by default.

### Edge cases

- [ ] A renamed Draft story (`R` code) with unchanged status passes — the new
      path is read from the last tab field as today.
- [ ] A Draft story whose only change is the `epic:` field passes.
- [ ] Several stories in one PR are each judged on their own before/after
      status.

### Performance

- [ ] One extra `git show base:path` per modified Draft story, the same call
      the In Progress exemption already makes.

### Security

- [ ] N/A — a CI gate over Markdown files; the exemption cannot admit code.

### UX

- [ ] The pass and fail lines name the file, both statuses and the rule, so a
      reader of the job log sees why without opening the script.

### i18n

- [ ] N/A — CI tooling, English only.

### Observability

- [ ] Exit codes unchanged (0 pass, 1 blocked, 2 tooling failure); the new
      exemption line is asserted by the test.

## BDD Scenarios

**Scenario: A note is added to a story nobody has started**

- **Given** a story on the backlog that nobody has picked up
- **When** a maintainer adds a note to it and opens a PR
- **Then** the PR is allowed to merge

**Scenario: A backlog story joins an epic**

- **Given** a story on the backlog and a newly filed epic
- **When** a maintainer links the story to the epic and opens a PR
- **Then** the PR is allowed to merge

**Scenario: Starting work still needs the story to reach review**

- **Given** a story someone has begun implementing in a PR
- **When** the PR is opened with the story marked as in progress
- **Then** the PR is blocked until the story is in review

**Scenario: Removing a story's status is still refused**

- **Given** a backlog story whose status line has been deleted
- **When** the PR is opened
- **Then** the PR is blocked and the missing status is named

## Test Plan

### Red

- `express-api/tests/scripts/pre-merge-gate.test.js` — new cases against a
  temp repository: Draft → Draft body change passes with the new line;
  Draft → Draft frontmatter (`epic:`) change passes; Draft → In Progress fails;
  status line removed fails; renamed Draft passes; existing In Progress cases
  unchanged.
- `express-api/tests/scripts/pre-merge-check.test.js` — the local twin
  mirrors the rule.

### Green

- One branch in the status switch: `code !== 'A' && status === 'Draft' &&
  statusOf(fileAt(base, file)) === 'Draft'` → exempt with the new line.

## Out of Scope

- Any other gate rule.
- Retroactively adding the SHY-0376 note and the SHY-0417 `epic:` field — done
  in the first PR that touches each after this lands.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The exemption lets an implementation PR through on a story left at Draft | Implementation PRs change code; the gate never guarded that — the story-status rule exists to force the In Review flip, and a story that stays Draft while its code merges is caught by the existing "story must be In Review" rule on the *next* touch and by review. Recorded here so the trade-off is explicit. |
| Base version unreadable in CI | Fail closed, as today. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] The first Draft-maintenance PR after it merges passes the gate with the
      new line; recorded in Notes.

## Notes

- **2026-09-04** — Found by PR #2137's first PR Gate run (EPIC-0013 filing),
  which failed on SHY-0376 (notes append) and SHY-0417 (epic adoption). Both
  edits were reverted to get the filing merged; this story restores the ability
  to make them.

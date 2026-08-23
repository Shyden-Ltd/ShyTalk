---
id: SHY-0435
status: In Review
owner: claude
created: 2026-08-22
priority: P1
effort: M
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0435: Files uploaded to a request nobody sent are kept for ever

## User Story

As **somebody who attached a file and then changed my mind and left**, I want it
not to be kept, so that a request I never sent leaves nothing behind.

## Why

Same root cause as SHY-0434, different lifecycle — and this half is not fixed.

The bytes are uploaded the **moment a file is picked**, before Send. SHY-0434
makes an explicit *removal* delete the object. But somebody who attaches a file
and then simply **leaves the screen** — presses back, switches app, gives up —
never removes anything. The object stays, and nothing references it: no ticket
carries the key, so no retention rule and no erasure request can reach it.

The existing test `leaving without sending keeps the attachments too` documents
that the FORM keeps them, deliberately, so returning to a half-written request
does not cost somebody their evidence. That behaviour is right. What is missing
is anything that eventually cleans up when they never come back.

### Why this is P1

The same content as SHY-0434: screenshots of private conversations,
photographs and video of other people in safety reports, account and payment
details. Kept indefinitely, unreferenced, undiscoverable.

Abandonment is also the **more likely** path. Somebody upset enough to be
raising a safety report is exactly the person who may attach evidence and then
back out.

### There is a backlog already

Every attachment ever picked and not sent is still there, from before either
ticket. This needs a one-off sweep as well as a standing rule.

## Acceptance Criteria

### Happy path

- [ ] An uploaded attachment that is never attached to a sent ticket is deleted
      after a defined, documented retention window.
- [ ] Returning to a half-written request within that window still finds the
      attachments — the behaviour SHY-0387 chose deliberately.

### Error paths

- [ ] A sweep that fails part-way is safe to re-run and never deletes a file a
      ticket references.
- [ ] A failure is alertable, not silent — an unswept backlog is the failure
      mode this ticket exists to prevent.

### Edge cases

- [ ] A ticket raised at the very edge of the window keeps its attachments.
- [ ] A file referenced by a follow-up message, not the original ticket, is
      kept.
- [ ] The one-off sweep of the existing backlog deletes only genuinely orphaned
      keys.

### Performance

- [ ] The sweep is incremental and bounded; it never enumerates the whole bucket
      in one pass.

### Security

- [ ] The sweep only ever touches the support attachment prefix.
- [ ] It cannot be triggered by a user request.

### UX

- [ ] Nobody loses an attachment from a request they are still writing.

### i18n

- [ ] No user-facing copy changes.

### Observability

- [ ] Every sweep reports how many objects it considered and deleted, so "it is
      running" is provable rather than assumed.

## BDD Scenarios

**Scenario: Changing my mind entirely**

- **Given** somebody who attached a screenshot and then left without sending
- **When** the retention window passes
- **Then** the file is deleted, and nothing of the request remains

**Scenario: Coming back to finish**

- **Given** somebody who attached a file and left the screen
- **When** they return shortly after
- **Then** the attachment is still there

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | The sweep selects orphaned keys only, and never one referenced by a ticket or a follow-up. |
| Integration | Against real storage: an orphan past the window is deleted; a referenced key and a fresh orphan are not. |
| Backlog | The one-off sweep is dry-runnable and reports what it would delete before it deletes anything. |

## Out of Scope

- Explicit removal, which is SHY-0434.
- Retention of attachments on tickets that WERE sent — those follow ticket
  retention.

## Dependencies

- SHY-0434 establishes the delete path and the key validation.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A sweep deletes a file belonging to a request somebody is still writing | The retention window is generous and documented, and the sweep checks references, not age alone. |
| The one-off backlog sweep deletes something referenced | Dry-run first, reporting the exact key list. |
| It is deferred because SHY-0434 "fixed attachments" | It did not. Removal is fixed; abandonment is the more likely path and is untouched. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] The retention window is written down, not implied by a constant.
- [ ] The existing backlog has been swept, with the dry-run output kept.

## Notes

- Found on 2026-08-22 while implementing SHY-0434, from the operator's point
  that we must not keep files we do not need.
- The retention window is a decision for the operator, not a default to pick
  quietly. It trades "somebody comes back to a half-written request" against
  "how long we hold something nobody sent us".

## How it was built

Shares the sweep with SHY-0436 — same schedule, same module — because they are
two routes to one outcome: an object in storage that no ticket references.

**Referenced keys are read FRESH on every run**, and anything in that set is
never touched. That is the whole safety of this sweep: a referenced key belongs
to somebody's live request, and deleting it destroys their evidence.

**The grace window is three days**, comfortably longer than an interruption and
far short of forever. Returning to a half-written request inside it still finds
the attachments — the form keeps them deliberately, and that behaviour is right;
this must not undo it.

**Fails closed**: an object with no timestamp is KEPT, because no age means no
evidence it is abandoned. And the filter re-checks the `support-tickets/`
prefix itself rather than trusting the caller's listing, so a bug there cannot
let the sweep reach avatars or room covers.

**The backlog clears itself.** Every attachment ever picked and not sent, from
before either ticket existed, is unreferenced and older than the window — so
the first run collects them all. No separate one-off script.

The sweep runs AFTER the closed-ticket pass, so the objects that pass has just
orphaned are already gone and the reference set is re-read in between.

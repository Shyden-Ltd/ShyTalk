---
id: SHY-0438
status: In Review
owner: claude
created: 2026-08-22
priority: P1
effort: M
type: feature
roadmap_ids: []
mvp: true
---

# SHY-0438: An admin can turn a support ticket into a report

## User Story

As **an admin reading a support ticket that is really a safety report**, I want to
turn it into a report in one click, so that it enters moderation instead of being
answered as correspondence.

## Why

SHY-0437 lets somebody who could not manage the report flow raise a ticket
instead. That escape hatch is only honest if the ticket then reaches the place a
report would have reached.

**Operator, 2026-08-22:** *"An admin will then file the report on their behalf.
This means the admin will need to be able to turn a support ticket into a report,
by a single click, and it takes on the report flow instead."*

Without this, a safety ticket is answered by whoever picks up support: no
moderation triage, no count against the reported person, nothing that would catch
a repeat pattern, and no action that can be appealed.

## The constraint on "single click"

`POST /reports` requires **`reportedUserId` and `reason`**. A support ticket
carries neither. So conversion cannot be silently automatic — something has to
say who is being reported.

Two ways to honour the instruction:

1. **Capture it up front.** The safety form (after the guide) asks who this is
   about, optionally. Somebody who could not report may not know how to identify
   the person, so it cannot be mandatory — but when they can give it, conversion
   really is one click with nothing to fill in.
2. **One click INTO the flow.** The button opens the report composer already
   carrying the ticket's message, attachments and reporter. The admin supplies
   the reported user and reason, which is the part only a human reading the text
   can do.

**Both, ideally:** capture what we can, and open the flow pre-filled. That is one
click when the ticket named somebody, and one click plus the missing field when
it did not — which is the least an admin could do by hand anyway.

## What must carry across

- the reporter — the person who raised the ticket, not the admin
- the message text, verbatim
- **every attachment**, still reachable from the report
- the original ticket id, so the report can be traced back
- that it came via support, so this route can be counted (SHY-0437 measures
  whether the guide is working)

## Acceptance Criteria

### Happy path

- [ ] A ticket in the safety category shows a single control to turn it into a
      report.
- [ ] Using it creates a real report in the moderation queue, attributed to the
      person who raised the ticket.
- [ ] The report carries the ticket's message and every attachment.
- [ ] The report records the ticket it came from, and the ticket records the
      report it became.
- [ ] The ticket is then closed permanently — SHY-0439.

### Error paths

- [ ] If report creation fails, the ticket is NOT closed and the admin is told —
      a half-conversion that closes the ticket and files nothing is the worst
      possible outcome.
- [ ] Converting a ticket that has already been converted is refused, and says
      which report it became.
- [ ] A ticket whose attachments have since gone still converts, and says which
      were missing.

### Edge cases

- [ ] A ticket in a non-safety category can still be converted — an admin reading
      it may recognise what it really is.
- [ ] A ticket with a follow-up carries the follow-up text too, not just the
      original.
- [ ] The reported person and the reporter being the same account is refused.
- [ ] A reporter who has since been deleted does not break conversion.

### Performance

- [ ] Conversion is a single operation from the admin's point of view; no
      per-attachment round trip in the interface.

### Security

- [ ] Only an admin can convert. Asserted, not assumed.
- [ ] Attachments move by reference, and the report's access rules govern them
      from then on.
- [ ] The action is audited: who converted what, when, and into which report.

### UX

- [ ] The control says what it will do, including that it closes the ticket for
      the person permanently.
- [ ] It is not adjacent to anything destructive.

### i18n

- [ ] No end-user copy here beyond SHY-0439's closing message.

### Observability

- [ ] Reports created this way are distinguishable from directly-filed ones, so
      the volume arriving via support is measurable.

## BDD Scenarios

**Scenario: Filing it on their behalf**

- **Given** an admin reading a support ticket about another person's behaviour
- **When** they turn it into a report
- **Then** it joins the moderation queue with everything the person sent

**Scenario: Nothing is lost if it fails**

- **Given** an admin turning a ticket into a report
- **When** the report cannot be created
- **Then** the ticket stays exactly as it was and the admin is told why

## Test Plan

| Layer | What it proves |
| --- | --- |
| Route | Conversion creates a report attributed to the reporter, carrying message and attachment keys; non-admins are refused; double conversion is refused. |
| Failure | A failed report creation leaves the ticket open — asserted by forcing the failure, not by inspection. |
| Browser | The control appears on a real admin page, converts, and the ticket then shows as converted. |
| Audit | An entry exists naming admin, ticket and report. |

## Out of Scope

- The guide — SHY-0437.
- The closed state and its copy — SHY-0439.
- Changing how reports are triaged once they arrive.

## Dependencies

- SHY-0439 is the other half: conversion closes the ticket permanently.
- The existing `POST /reports` contract.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The ticket closes but no report is created | Create the report FIRST; close only on success. Asserted by forcing the failure. |
| An admin converts the wrong ticket and cannot undo it, since the close is permanent | The control states its consequence; conversion is audited and the report records its origin, so it can be traced and withdrawn in moderation. |
| Attachments are copied rather than referenced, doubling personal data | They move by reference; retention then follows the report. |
| "Single click" is read as "no human judgement" and mis-files reports | A human still names the reported person and reason — that is the part only a reader can do. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] An admin converts a real ticket in a real browser and the report appears in
      the moderation queue with its attachments.
- [ ] A forced failure leaves the ticket open.

## Notes

- Operator, 2026-08-22 — quoted above.
- This also resolves the retention tension raised in SHY-0436: once a safety
  ticket becomes a report, the REPORT carries the safety record, so deleting the
  ticket after seven days no longer loses moderation history.

---
id: SHY-0385
status: In Review
owner: shyden
created: 2026-08-20
priority: P1
effort: M
type: feature
roadmap_ids: []
epic: EPIC-0012
mvp: true
---

# SHY-0385: Let someone raise a support ticket from inside the app

## User Story

As **someone who needs help**, I want to write to ShyTalk from inside the app
and be told it arrived, so that I know somebody will see it.

## Why

**Part two of the operator's design**, 2026-08-20: *"contacting support should
open a form, similar to reporting, where the support becomes a ticket for an
admin on the admin dashboard to action. not an email."*

SHY-0380 builds the queue — the endpoints and the admin dashboard tab. This
story gives people the way in, and **restores the Contact support control that
SHY-0384 removed** because it did nothing.

Splitting it this way was the operator's choice: the queue can be built and
proven against the API first, so the form is written against a surface that is
already known to work rather than two unproven halves at once.

## Acceptance Criteria

### Happy path

- [ ] Choosing **Contact support** opens a form inside the app.
- [ ] Submitting it tells the person plainly that it has been received.
- [ ] The ticket appears in the admin dashboard queue built by SHY-0380.
- [ ] The control is restored in both places the age dialog appears — a room and
      a private chat.
- [ ] The dialog copy removed by SHY-0384 is restored, now that it is true again.

### Error paths

- [ ] A failed submission says so and **keeps what the person typed**.
- [ ] An empty or whitespace-only message is refused before sending, with a
      reason.
- [ ] If they already have an open ticket, they are told — no silent duplicate.

### Edge cases

- [ ] Submitting twice quickly creates one ticket.
- [ ] A very long message is either accepted whole or bounded with a visible
      limit — never silently truncated.
- [ ] Someone under 18 can raise a ticket. **This must survive SHY-0379**, which
      hides age-gated features from known minors; support is not age-gated, and
      hiding it would strand the person most likely to need it.
- [ ] Works on Android and iOS.

### Performance

- [ ] One request; the form does not block the app while it sends.

### Security

- [ ] Submission is authenticated and bound to the account raising it.
- [ ] The message body is treated as untrusted text wherever it is displayed.
- [ ] Automatically attached context — which feature refused them, and what the
      app believed about their eligibility — contains no credentials or tokens.

### UX

- [ ] The person can tell afterwards that they raised a ticket.
- [ ] Any control that says it will do something does it. That is the rule this
      whole chain exists to restore.

### i18n

- [ ] All new copy in the **5 MVP locales only** (en, zh, id, vi, th).

### Observability

- [ ] A raised ticket is visible in logs without recording the message body.

## BDD Scenarios

**Scenario: Someone raises a ticket and knows it arrived**

- **Given** someone is looking at the age-restriction message
- **When** they choose Contact support and send a message
- **Then** they are told it has been received

**Scenario: A failed send does not lose what was typed**

- **Given** someone has written a message
- **When** the send fails
- **Then** they are told, and their message is still there

**Scenario: A second ticket is not silently created**

- **Given** someone already has an open ticket
- **When** they try to raise another
- **Then** they are told about the one they already have

## Test Plan

| Layer | What it proves |
| --- | --- |
| Source guard | The `onContactSupport` guard from SHY-0384 still passes — the control is wired to the form, not to dismiss. |
| App tests | Validation, failed-send retains input, confirmation shown, duplicate refused. |
| Copy tests | Restored dialog text asserted on the **rendered string** in all 5 MVP locales. |
| Integration | A ticket raised from the app appears in the SHY-0380 queue, against real services. |
| Device journeys | Real Android and real iPhone: raise a ticket, see it land in the dashboard. |

## Out of Scope

- The endpoints and admin tab, which are SHY-0380.
- Replying to the person in-app. That belongs to EPIC-0012.
- Migrating appeals or reports onto the ticket model.

## Dependencies

- **SHY-0380 must land first** — this submits to its endpoint.
- **SHY-0384** removed the control; this restores it.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| SHY-0384's removal is never reversed | Restoring it is an acceptance criterion here, and both stories sit under EPIC-0012. |
| SHY-0379 hides support from minors | Called out in all three stories; support is not age-gated. |
| Attached context leaks more than needed | Enumerate exactly what is attached, and assert it in a test. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Ticket raised from a real Android device and a real iPhone, and seen in the
      dashboard.
- [ ] SHY-0384's copy and control both restored.

## Notes

- Part two of two. Order: [[SHY-0384]] → [[SHY-0380]] → this.

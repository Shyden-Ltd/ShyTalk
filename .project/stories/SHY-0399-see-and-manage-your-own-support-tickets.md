---
id: SHY-0399
status: Draft
owner: unassigned
created: 2026-08-21
priority: P1
effort: L
type: feature
roadmap_ids: []
epic: EPIC-0012
mvp: true
---

# SHY-0399: See your own support tickets, add to them, reopen and close them

## User Story

As **somebody who contacted support**, I want to see what I sent and what came
back, so that I can add to it, reopen it if it was closed too early, or say that
I no longer need help.

## Why

**Operator, 2026-08-21:** somebody with new information should update their
existing ticket, or reopen it if it was closed, rather than raise another one.

None of that exists. Every route but creation is `requireAdmin`:

| Endpoint | Who |
| --- | --- |
| `POST /support-tickets` | anybody signed in |
| `GET /support-tickets` | `requireAdmin` |
| `PATCH /support-tickets/:id` | `requireAdmin` |

So a customer cannot list their tickets, read them, add to them, reopen them, or
close them. `status` moves one way only — `open → resolved`, by an admin. This
story is what makes [[SHY-0396]]'s steering copy honest: it is the "update your
existing ticket instead" that the warning points at.

## This one has a safeguarding dimension

A ticket thread is a **1:1 free-text channel between staff and a customer**, and
ShyTalk has a minor cohort — the reason age segregation exists at all. That is a
different risk profile from the current one-way drop box, and it should be
designed for rather than discovered later:

- who can post into a thread, and is that recorded per message
- whether an admin's identity is exposed to the customer, or only "ShyTalk
  Support"
- retention, and what a data-export ([[SHY-0393]]) includes
- that the channel cannot become a general messaging back door around the
  existing moderation surfaces

**Raise these with the operator before building.** They are decisions, not
details.

## Acceptance Criteria

### Happy path

- [ ] Somebody can see a list of their own tickets, newest first, with status.
- [ ] Opening one shows the whole conversation in order.
- [ ] They can add a message to an open ticket.
- [ ] They can reopen a closed ticket.
- [ ] They can close a ticket themselves.

### Error paths

- [ ] Adding to a ticket that an admin closed a moment ago is handled without
      losing what they typed.
- [ ] A failed send keeps the text, as [[SHY-0385]] established.
- [ ] Closing a ticket twice is harmless.

### Edge cases

- [ ] Somebody with no tickets sees an empty state that offers the way to raise
      one, not a blank screen.
- [ ] Reopening a ticket closed long ago is either allowed or refused with a
      reason — never silently ignored.
- [ ] A ticket closed by the customer and one resolved by an admin are
      distinguishable, because they mean different things.
- [ ] Works on Android and iOS.

### Performance

- [ ] The list is paginated; an account with many tickets does not fetch them all.

### Security

- [ ] Every read and write is scoped to the caller's own tickets. Requesting
      another account's ticket by id is refused, and that has its own test.
- [ ] A customer cannot set admin-only fields — `adminNote`, `resolvedBy` — nor
      read `adminNote`.
- [ ] Message bodies are untrusted text wherever displayed, in the app and the
      admin panel.

### UX

- [ ] Status is in plain language, not `open` / `resolved`.
- [ ] It is obvious which messages are theirs and which are ShyTalk's.
- [ ] Closing asks for confirmation, because it is the one destructive-feeling
      action here.

### i18n

- [ ] All copy, including status labels, across all 21 locale files, asserted on
      rendered text.

### Observability

- [ ] Reopen and customer-close are recorded with who did it and when, so a
      ticket's history is reconstructable.

## BDD Scenarios

**Scenario: Seeing what you sent**

- **Given** somebody who has contacted support before
- **When** they open their requests
- **Then** they see each one and its current state

**Scenario: Adding new information**

- **Given** somebody with an open request
- **When** they add a message to it
- **Then** it appears on that request for the admin

**Scenario: Reopening a closed request**

- **Given** a request that was closed
- **When** they reopen it
- **Then** it is open again with its history intact

**Scenario: Somebody else's request stays theirs**

- **Given** a request belonging to another account
- **When** somebody asks for it directly
- **Then** they are refused

## Test Plan

| Layer | What it proves |
| --- | --- |
| Route | List, read, append, reopen, close — each against the real emulator, each scoped to the caller. |
| Security | Requesting, appending to, reopening and closing **another account's** ticket are four separate refusals, each asserted; `adminNote` is absent from every customer-facing response. |
| State | Reopen preserves history; customer-close and admin-resolve are distinguishable in the record. |
| Copy | Status labels render per locale on rendered text. |
| Journey | Raise → add → close → reopen, walked on a real device. |

## Out of Scope

- Email delivery of any of this — [[SHY-0397]], [[SHY-0398]].
- Admin-side reply composition, which is [[SHY-0397]]'s customer-answer field.

## Dependencies

- **Operator decisions required** on the safeguarding points above before build.
- [[SHY-0396]] pairs with this: its warning points at "update your existing
  ticket", which is only true once this exists.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A ticket thread becomes an unmoderated staff↔minor messaging channel | Raised as an explicit operator decision before build, not discovered afterwards. |
| Ownership scoping is applied to reads but forgotten on writes | Four separate cross-account refusal tests — read, append, reopen, close — rather than one. |
| An internal note leaks through a customer-facing response | Asserted absent from every customer response shape, not just the obvious one. |
| Customer-close hides a case an admin still needs | Close is recorded with who did it, and the two close reasons stay distinguishable. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] The full journey walked on a real device: raise, add, close, reopen.

## Notes

- Filed from the operator's 2026-08-21 answer to "how do customers track and
  update an open ticket, reopen a closed one, and close one?" — the answer was
  that they cannot do any of the four.

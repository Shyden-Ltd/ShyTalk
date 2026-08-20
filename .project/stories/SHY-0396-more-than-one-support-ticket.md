---
id: SHY-0396
status: Draft
owner: unassigned
created: 2026-08-21
priority: P1
effort: S
type: feature
roadmap_ids: []
epic: EPIC-0012
mvp: true
---

# SHY-0396: Let somebody raise a second ticket, and tell them why not to

## User Story

As **somebody who has already contacted support and then thought of something
important**, I want to be able to send it, so that the guard against duplicates
does not lock me out of my own case.

## Why

**Operator, 2026-08-21:** "multiple support tickets should be allowed. but we
should inform them that if they have already contacted us, opening a new ticket
will only make it slower, and if they want to provide new information they should
update their existing ticket instead (or reopen it if it was closed)."

Today `support-tickets.js:100` refuses outright:

```js
if (existing.length > 0) {
  return res.status(409).json({ error: 'You already have an open support request' });
}
```

The intent was anti-spam. The effect is that somebody who forgot a detail, or who
has *new* information — a screenshot, an error code, the thing that finally
reproduced it — has **no way to add it**. There is no customer-facing read or
update endpoint either (`GET` and `PATCH` are both `requireAdmin`), so the 409 is
not redirecting them somewhere better. It is a closed door.

That is worse than it sounds on a safeguarding surface: the person most likely to
hit it twice in a day is the person whose problem is getting worse.

### The guard was solving a real problem

A hard block does stop somebody firing off ten tickets and fragmenting their own
case across ten records an admin has to reconcile. Removing it without replacing
it moves that cost onto whoever is triaging.

So the answer is not "delete the check". It is **inform, then allow**: say plainly
that a second ticket is slower, point at the better route, and let them decide.
The person who genuinely needs a second one gets it; the person who was about to
duplicate is told why not to, at the moment it matters.

## Acceptance Criteria

### Happy path

- [ ] Somebody with an open ticket can raise another one.
- [ ] Before they do, they are told plainly that a second request is **slower**
      than adding to the one they have.
- [ ] They are pointed at updating the existing ticket instead — or reopening it
      if it was closed.
- [ ] Somebody with no open ticket sees none of this.

### Error paths

- [ ] Being unable to check for existing tickets does not block raising one — the
      warning is advice, and losing the advice must not cost somebody their
      request.
- [ ] Rate limiting still applies, so "allowed" does not mean "unbounded".

### Edge cases

- [ ] Somebody whose only ticket is **resolved** is offered reopening, not a
      duplicate warning.
- [ ] Somebody with several open tickets is warned once, not once per ticket.
- [ ] The warning names how many are open, so it reads as a fact rather than a
      scold.

### Performance

- [ ] The existing-ticket check stays a single bounded query.

### Security

- [ ] The check only ever sees the caller's own tickets.
- [ ] The count of open tickets is not a channel for learning anything about
      another account.

### UX

- [ ] The warning **informs**, it does not refuse. No disabled Send, no dead end.
      Anyone who reads it and still wants a second ticket gets one.
- [ ] It appears before they have typed the whole thing again, not after they
      press send.

### i18n

- [ ] All 21 locale files, asserted on rendered text per locale.

### Observability

- [ ] A ticket raised despite the warning is distinguishable in the data, so the
      warning's effect can actually be judged rather than assumed.

## BDD Scenarios

**Scenario: A second request is allowed, with a warning first**

- **Given** somebody who already has a request open
- **When** they start another one
- **Then** they are told it will be slower and offered to add to the first

**Scenario: The warning does not block them**

- **Given** somebody who has read the warning and still wants a second request
- **When** they send it
- **Then** it is raised like any other

**Scenario: A closed request offers reopening instead**

- **Given** somebody whose only request was closed
- **When** they start a new one
- **Then** they are offered to reopen the closed one

## Test Plan

| Layer | What it proves |
| --- | --- |
| Route | A second ticket is created rather than refused, against the real emulator — the 409 case becomes a created-ticket case, and the old refusal test is replaced rather than deleted quietly. |
| Route | A failing existing-ticket lookup still allows the ticket through, so advice can never become an outage. |
| Copy | The warning renders in every locale, asserted on rendered text. |
| Journey | Raise, warn, raise again — walked on a real device. |

## Out of Scope

- **Updating** an existing ticket, and **reopening** a closed one. This story
  makes the warning honest by pointing at them; [[SHY-0399]] builds them. Until
  it does, the warning must not promise a route that is not there — say what is
  true today.
- The reply channel — [[SHY-0397]], [[SHY-0398]].

## Dependencies

- Sequencing matters: pointing somebody at "update your existing ticket" is only
  true once [[SHY-0399]] exists. Either land them together, or word this
  story's copy to describe only what is currently possible.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Removing the block fragments cases across duplicate tickets | The warning is shown at the point of creation, and the data records whether it was overridden, so the effect is measurable rather than assumed. |
| The warning is written as a telling-off | It states a consequence — slower — and offers a better route. It never refuses. |
| The copy promises updating before updating exists | Called out in Dependencies; the AC requires the copy to describe only what is true today. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Walked on a real device: warned, then allowed.

## Notes

- Found while answering "how do customers track and update an open ticket?" —
  the answer was that they cannot, and the 409 was actively enforcing it.
- Related: [[SHY-0385]] shipped the client-side handling of the 409 as
  `RaiseTicketOutcome.AlreadyOpen`. That case does not disappear here; it stops
  being terminal.

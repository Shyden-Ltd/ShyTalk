---
id: SHY-0396
status: In Review
owner: claude
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

- [ ] Somebody with an open ticket **can** raise another one. The second request
      is never refused.
- [ ] Before they do, they are told a request is already open, and shown a
      **very brief summary of it** — enough to recognise whether this is the same
      problem. More than one open ticket means a summary of each.
- [ ] They are reminded that opening another ticket for the **same** problem only
      slows things down and puts them to the **back of the queue**.
- [ ] They are given exactly **three** choices, in this order:
      1. **"It's the problem I already reported"** — their message is added to the
         existing ticket.
      2. **"It's a new problem"** — a new ticket is raised.
      3. **"Go back"** — nothing is sent and their message is still there.
- [ ] Somebody with no open ticket sees none of this and sends as normal.

### The behaviour being REPLACED

- [ ] The server's **409 refusal is gone**. `RaiseTicketOutcome.AlreadyOpen`
      currently disables Send and shows "You already have a request open. We will
      reply to that one.", which blocks a second ticket outright — the opposite of
      what is wanted (operator, 2026-08-21 and again 2026-08-22 on seeing it on a
      device).
- [ ] Nothing anywhere still treats a second request as an error condition.

### Error paths

- [ ] Being unable to check for existing tickets does not block raising one — the
      warning is advice, and losing the advice must not cost somebody their
      request.
- [ ] Rate limiting still applies, so "allowed" does not mean "unbounded".

### Edge cases

- [ ] Somebody whose only ticket is **resolved** sees no warning and raises a
      new request as normal. Reopening a resolved ticket is [[SHY-0399]] — this
      story must not promise a route that does not exist yet.
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

**Scenario: A closed request is not treated as an open one**

- **Given** somebody whose only request was closed
- **When** they start a new one
- **Then** it is raised with no warning

## Test Plan

| Layer | What it proves |
| --- | --- |
| Route | A second ticket is created rather than refused, against the real emulator — the 409 case becomes a created-ticket case, and the old refusal test is replaced rather than deleted quietly. |
| Route | A failing existing-ticket lookup still allows the ticket through, so advice can never become an outage. |
| Copy | The warning renders in every locale, asserted on rendered text. |
| Journey | Raise, warn, raise again — walked on a real device. |

## Out of Scope

- **Reopening** a closed one — [[SHY-0399]]. The warning must not promise a
  route that is not there, so somebody whose only ticket is resolved simply
  raises a new one.
- Adding to an OPEN ticket is **in** scope, not out. The operator's instruction
  on 2026-08-21 named it explicitly — "they can update their existing ticket if
  it's the same open issue" — so `POST /support-tickets/{id}/messages` belongs
  here. An earlier draft of this line said otherwise and contradicted the
  implementation direction below; the instruction wins.
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

## Implementation direction (worked out 2026-08-22, not yet built)

**What exists today.** `express-api/src/routes/support-tickets.js:194-203` queries
for one open ticket by `userId` and answers **409** if it finds one. The Android
client maps that 409 to `RaiseTicketOutcome.AlreadyOpen`, and `SupportPage`
disables Send and shows *"You already have a request open. We will reply to that
one."* The refusal is the whole mechanism — there is no append path at all.

**Shape proposed.** Three pieces, none of which exist yet:

| Piece | Why |
| --- | --- |
| `GET /api/support-tickets/mine/open` → `[{ ticketId, category, summary, createdAt }]` | The choice cannot be offered without a summary to show. `summary` is a short prefix of their own message — no new stored data needed. |
| `POST /api/support-tickets` — **409 removed** | "It's a new problem" must succeed. A second ticket is not an error condition. |
| `POST /api/support-tickets/{id}/messages` | "It's the problem I already reported" needs somewhere to put the text. Today it would be dropped. |

**Client flow.** On Send, if the person has open tickets, do not send yet:
show the warning, the summary of each open ticket, the reminder that a duplicate
goes to the back of the queue, and the three choices. "Go back" must leave their
typed message intact — losing it here is the worst thing this screen can do, and
`SupportFormViewModel.reset()` already takes that position deliberately.

**Watch for:** the 409 is currently load-bearing in tests. Anything asserting a
second request is refused is asserting the defect and must be inverted, not
deleted. Grep `AlreadyOpen`, `alreadyHasOpenTicket`, `409` under
`express-api/tests/`, `shared/src/jvmTest/`, and `tests/web/`.

**Already proven on a device, so it is real:** on 2026-08-22 a ticket raised from
the iPhone caused the Android send to answer *"You already have a request open.
We will reply to that one."* as the same persona. Duplicate prevention works
across devices — it is simply the wrong behaviour.


## What was built (2026-08-22)

**Server** — `express-api/src/routes/support-tickets.js`

| Change | Why |
| --- | --- |
| the 409 is gone from `POST /support-tickets` | a second request is never refused |
| `GET /support-tickets/mine/open` | the summaries the choice is answered against; mounted before `/:id` so `mine` is never read as an id |
| `POST /support-tickets/{id}/messages` | where the words go for "it is the problem I already reported"; 404 for somebody else's ticket, because whether it exists is not their business |
| `openTicketsAtCreation` on every new ticket | the observability clause — counted server-side, so a client cannot claim it saw a warning it never showed |

**Client** — `SupportRepository`, `SupportFormViewModel`, `SupportPage`, both
platform repositories.

`RaiseTicketOutcome.AlreadyOpen` and `alreadyHasOpenTicket` are deleted. What
replaces them is `openTickets` + `awaitingDuplicateChoice`: having a request open
is a QUESTION asked before sending, not an outcome of having sent. The list is
fetched when the form OPENS, so the warning is on screen before anybody starts
typing, and the choice screen appears instantly at Send.

A lookup that fails is treated as "nothing open" on purpose. The worst case is a
duplicate ticket; the alternative costs somebody their report.

**Tests**

| Suite | Count |
| --- | --- |
| `support-tickets.unit.test.js` | 56 |
| `SupportFormViewModelTest` | 39 |
| `SupportFormWiringPinTest` | 13 |
| `SupportRepositoryImplTest` (Android) | 24 |
| `support-duplicate-copy.test.js` (21 locales) | 231 |

**Journey** — `journey-tests/j38-asking-for-help-twice.feature`, 10 scenarios.

**Still to do before this can move:** the local device walk on Android and
iPhone, then the evidence page and operator sign-off.

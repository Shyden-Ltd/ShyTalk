---
id: SHY-0439
status: In Review
owner: claude
created: 2026-08-22
priority: P1
effort: S
type: feature
roadmap_ids: []
mvp: true
---

# SHY-0439: A ticket that became a report closes for good

## User Story

As **somebody whose support ticket was turned into a report**, I want to be told
plainly that it has been received and the ticket is finished, so that I am not
waiting for a reply that is not coming.

## Why

When an admin converts a ticket into a report (SHY-0438), the conversation moves
to moderation. The ticket must not sit in the person's list looking like it is
still being worked, and must not be reopenable — reopening would put a safety
matter back into a queue that is not for safety matters, which is the whole
problem SHY-0437 exists to solve.

**Operator, 2026-08-22**, exact copy:

> "we have received your report. this ticket is now closed and cannot be
> re-opened. Thank you for helping to keep our community safe. In future, it's
> better to report the user, message or room directly rather than use a support
> ticket"

## ⚠️ The copy names something that does not exist

**A room cannot be reported.** `reportRoom` / `report_room` / `reportedRoom` /
`roomReport` return zero matches across the app, the API and the admin dashboard.
Today a person can report a **user** (from a profile or an in-room card) and a
**message** (in a room or a private chat). That is all.

Telling somebody "it's better to report the room directly" would send them
looking for a control that is not there — at the end of an interaction that
began with them struggling to report in the first place. Two options, for
Shyden:

1. **Build room reporting** (SHY-0440) and keep the copy as written.
2. **Ship the copy without "room"** until it exists, then add it.

The wording is otherwise used verbatim. It should also be sentence-cased for the
product's voice — the instruction was typed quickly, not styled.

## A new terminal state

`status: closed` already exists and is reopenable (SHY-0399). This is different:
closed **because it became a report**, and permanently. That is a distinct state,
not a flag on the old one — a reopen path that has to remember to check a boolean
is a reopen path that will one day forget.

## Acceptance Criteria

### Happy path

- [ ] A converted ticket shows as closed to the person who raised it.
- [ ] It shows the message above, in their language.
- [ ] It cannot be reopened — no control, and the API refuses it.

### Error paths

- [ ] An attempt to reopen it through the API is refused with a reason, not a
      generic error.
- [ ] A ticket that failed to convert is NOT in this state (SHY-0438).

### Edge cases

- [ ] A ticket already reopened once can still be converted, and then cannot be
      reopened again.
- [ ] The person can still READ the ticket and what they sent; closed is not
      hidden.
- [ ] Raising a NEW ticket afterwards still works, and is not blocked by this one
      (SHY-0396).
- [ ] The state survives the seven-day deletion sweep correctly (SHY-0436).

### Performance

- [ ] No change.

### Security

- [ ] Only conversion can produce this state; it cannot be set directly by a
      user request.

### UX

- [ ] The message thanks them and explains the better route without implying
      they did something wrong. Somebody who reached support was already trying
      to do the right thing.
- [ ] It is visibly final, distinct from an ordinary closed ticket they could
      reopen.

### i18n

- [ ] Translated for all five MVP locales.
- [ ] Holds under right-to-left layout.
- [ ] The advice names only routes that exist in the reader's build.

### Observability

- [ ] Entering this state is recorded with the report it became.

## BDD Scenarios

**Scenario: Being told it has been dealt with**

- **Given** somebody whose ticket an admin turned into a report
- **When** they open their requests
- **Then** they are thanked, told it is closed for good, and told the better way
  next time

**Scenario: It cannot be picked back up**

- **Given** a ticket that became a report
- **When** the person looks for a way to reopen it
- **Then** there is none, and the API refuses one

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | The converted state is terminal; the reopen path refuses it. |
| Route | A reopen request against a converted ticket is refused with a reason. |
| Device | The person sees the message, in their language, with no reopen control. |
| i18n | Every MVP locale renders it without clipping. |
| Copy | The advice names only routes that exist — a test that fails if it mentions reporting a room while no such route is built. |

## Out of Scope

- The conversion itself — SHY-0438.
- The guide — SHY-0437.
- Room reporting — SHY-0440.

## Dependencies

- SHY-0438 produces this state.
- **SHY-0440 decides the final sentence of the copy.**
- SHY-0399 owns close/reopen generally; this adds a terminal variant.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The copy tells people to do something the app cannot do | The copy test asserts every route it names exists; SHY-0440 decides which. |
| "Cannot be re-opened" reads as a punishment | The wording thanks them first and frames the advice as faster help next time. |
| A generic reopen path forgets this state and lets it through | It is a distinct state, not a flag, so the reopen path must handle it explicitly. |
| Somebody thinks their report was ignored because the ticket went quiet | The message states plainly that the report has been received. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Proven on a real device: the person sees the message and has no way to
      reopen.
- [ ] The API refuses a reopen for a converted ticket.

## Notes

- Operator copy, 2026-08-22, quoted verbatim above.
- Worth deciding whether the same finality should apply to any ticket an admin
  judges to be a safety matter, or only to converted ones. This story assumes
  only converted ones.

---
id: SHY-0440
status: Draft
owner: claude
created: 2026-08-22
priority: P2
effort: M
type: feature
roadmap_ids: []
mvp: true
---

# SHY-0440: A room cannot be reported

## User Story

As **somebody in a room where the room itself is the problem**, I want to report
the room, so that moderation looks at the room rather than at one person in it.

## Why

Found on 2026-08-22 while writing SHY-0437 and SHY-0439. **There is no way to
report a room.** `reportRoom`, `report_room`, `reportedRoom` and `roomReport`
return zero matches across the app, the API and the admin dashboard.

Today a person can report:

| What | Where |
| --- | --- |
| A person | Their profile, or their card inside a room |
| A message | In a room, or in a private chat |

Two things follow.

**Immediately:** the closing copy the operator specified for SHY-0439 says *"it's
better to report the user, message or room directly"*. One third of that is not
possible. Somebody reading it at the end of an interaction that began with them
struggling to report would go looking for a control that is not there.

**More importantly:** there are room-level problems that reporting a person does
not describe.

- A room whose **name, topic or artwork** is the problem — no individual said
  anything reportable.
- A room being **used for something it is not for**, which is a pattern across
  many messages rather than any one of them.
- A room where **several people together** create the problem, and reporting one
  of them misrepresents it.
- A room a **minor** should never have been able to enter — an age-segregation
  failure, which is about the room, not a person.

In each case, the honest report is about the room, and today the person must
either pick somebody arbitrarily or give up.

## ⚠️ This is a decision, not just a build

Either outcome is legitimate; both need choosing:

1. **Build it.** Rooms become reportable, the guide teaches it, and the SHY-0439
   copy is true as written.
2. **Do not build it now.** Drop "room" from the SHY-0439 copy and from the
   guide, and revisit later.

What must NOT happen is shipping copy that names a route which does not exist.

## Acceptance Criteria

*(These apply if option 1 is chosen.)*

### Happy path

- [ ] A room can be reported from inside it, without naming a person.
- [ ] The report captures the room, its name and topic at the time, and who
      reported it.
- [ ] It arrives in the same moderation queue as other reports and is
      distinguishable as a ROOM report.

### Error paths

- [ ] Reporting a room that has since closed still records what it was.
- [ ] A duplicate report from the same person is handled the way user reports
      already are.

### Edge cases

- [ ] Reporting a room does not require, or imply, reporting its host.
- [ ] A room with no messages can still be reported — the name alone may be the
      problem.
- [ ] Works for a minor's account, in the age-segregated room set.
- [ ] The reporter leaving the room does not invalidate the report.

### Performance

- [ ] No change to room join or send.

### Security

- [ ] The reporter's identity is handled exactly as it is for user reports.
- [ ] Reporting a room does not expose its member list to the reporter.

### UX

- [ ] The control sits where somebody looks when the ROOM is wrong, not buried
      under a person's card.
- [ ] Reasons offered suit rooms — the current set (Spam, Harassment,
      Inappropriate Content, Other) was written for people and messages.

### i18n

- [ ] Every string translated for all five MVP locales.
- [ ] Holds under right-to-left layout.

### Observability

- [ ] Room reports are countable separately, so the gap this closes is
      measurable.

## BDD Scenarios

**Scenario: The room is the problem**

- **Given** somebody in a room whose name and purpose are inappropriate
- **When** they report the room
- **Then** moderation receives a report about the room, without them having to
  accuse a particular person

## Test Plan

| Layer | What it proves |
| --- | --- |
| Route | A room report is stored with the room's identity and state at the time, and appears in the moderation queue. |
| Admin | A room report is visible and actionable, and reads differently from a user report. |
| Device | On both phones: report a room and see it arrive. |
| Copy | SHY-0439's closing message may name rooms only once this exists. |

## Out of Scope

- Automated room moderation.
- Changing how user or message reports work.

## Dependencies

- Blocks the final sentence of SHY-0439's copy, and what SHY-0437's guide
  teaches.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Room reports become a way to harass a host | They are about the room, not its host, and are triaged like any other report. |
| Reusing person-shaped reasons makes room reports hard to triage | Reasons are reviewed for rooms as part of this work. |
| It is deferred and the SHY-0439 copy ships naming it anyway | A copy test fails if the message names a route that does not exist. |

## Definition of Done

- [ ] The operator decision is recorded in this ticket.
- [ ] If built: merged to `develop`, checks green, proven on both real devices.
- [ ] If not built: SHY-0439 and SHY-0437 updated to omit rooms, and this ticket
      left open with the reasoning.

## Notes

- Found while writing SHY-0437/0439, from the operator's own phrasing — the copy
  described a capability the app does not have.
- The age-segregation case is the one I would weigh most heavily: a room a minor
  should not have been able to enter is a safeguarding matter about the ROOM, and
  there is currently no way for anybody to raise it as one.

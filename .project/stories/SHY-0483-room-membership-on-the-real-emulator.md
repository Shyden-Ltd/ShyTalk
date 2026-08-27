---
id: SHY-0483
status: In Review
owner: unassigned
created: 2026-08-28
priority: P0
effort: M
type: refactor
roadmap_ids: []
mvp: true
epic: EPIC-0003
---

# SHY-0483: Room membership is proven against a fake transaction

## User Story

As **whoever relies on room membership**, I want joining, leaving and declining
proven against real Firestore, so that "they left" means the participant list
changed rather than that a stub was handed a marker object.

## Why

Third slice of `room-mutations.test.js`, after SHY-0481 (seats) and SHY-0482
(moderation). This one takes **membership** — how somebody enters and leaves a
room:

- `POST /join` (7 tests)
- `POST /leave` (7)
- `POST /decline-invite` (6)
- `POST /first-join` (6)

**26 tests**, still on the faked transaction, so every membership change was
asserted as `{ __arrayUnion: ['50'] }` or `{ __arrayRemove: ['99'] }` — marker
objects standing in for `FieldValue`s that nothing ever resolved.

### The idempotency tests are the interesting ones

Four of these routes have a **no-op branch**, and the reason is operational: a
client retrying `/leave` after a disconnect must not wake every connected client
with a spurious RTDB nudge. The old harness asserted that by checking a spy went
uncalled. Against real infrastructure the question can be asked properly — did
the document change, and did an event get published — which is what the branch
actually exists to prevent.

`/first-join` is **set-once**, and a re-post must not overwrite the original
timestamp. A marker object cannot express "the value that was already there is
still there".

## Acceptance Criteria

### Happy path

- [ ] Join, leave, decline-invite and first-join run against real Firestore
      transactions.
- [ ] All 26 behaviours preserved.
- [ ] The extracted file contains no Firestore or RTDB double.

### Error paths

- [ ] Every refusal — 404 missing, 404 cohort-hidden, 409 CLOSED, 403 BANNED —
      leaves the room read back **unchanged**.
- [ ] A banned caller is refused with `BANNED` and is not added to participants.

### Edge cases

- [ ] The no-op branches write **nothing** and publish **no** RTDB event,
      asserted against real state rather than against an uncalled spy.
- [ ] `first-join` is set-once: a second call leaves the ORIGINAL timestamp
      value in place.
- [ ] CLEANUP-ON-CLOSED holds: leave and decline still work after close, while
      join and first-join refuse. The universal rule is "drop your own state,
      never extend the room's".
- [ ] An `OWNER_AWAY` room is still joinable.

### Performance

- [ ] Within the emulator budget the other real route suites keep.

### Security

- [ ] Cohort-hiding and the ban list are proven against real data.
- [ ] Per-file room id, disjoint from every other suite (SHY-0464).

### UX

- [ ] None: server-side contract only.

### i18n

- [ ] None.

### Observability

- [ ] The RTDB event is asserted **present** on a real change and **absent** on
      a no-op — the behaviour the no-op branch exists for.

## BDD Scenarios

**Scenario: Leaving a room**

- **Given** somebody sitting in a room
- **When** they leave
- **Then** they are out of the room and their seat is free

**Scenario: Leaving twice**

- **Given** somebody who has already left
- **When** their phone retries leaving
- **Then** nobody else is disturbed

## Test Plan

| Layer | What it proves |
| --- | --- |
| Route (real emulator) | Participant list and seats after each join, leave and decline. |
| Route (real emulator) | No-op branches change nothing AND publish nothing. |
| Route (real emulator) | `first-join` set-once keeps the original value. |
| Unit (`*.unit.test.js`) | Each route answers 500 when the transaction throws. |
| Mutation | Removing the ban check fails the suite. |

## Out of Scope

- `disconnect-user` (RTDB presence — sequenced against SHY-0103), the
  owner-away/close group, room settings, and the Chunk C group. Later slices.

## Dependencies

- Follows SHY-0481 and SHY-0482.

## Risks & Mitigations

- **Risk:** a no-op test passes because the route did nothing for the wrong
  reason. **Mitigation:** each is paired with a positive case on the same route,
  so "nothing happened" is only accepted where something happens otherwise.

## Definition of Done

- [ ] The extracted file has zero Firestore/RTDB doubles.
- [ ] No-op branches asserted on real state and real events.
- [ ] `room-mutations.test.js` shrinks by the extracted groups and still passes.

## Notes

The no-op branch on `/leave` suppresses an RTDB nudge that "would wake every
connected client". That is a claim about a published event, and it is now
asserted as one.

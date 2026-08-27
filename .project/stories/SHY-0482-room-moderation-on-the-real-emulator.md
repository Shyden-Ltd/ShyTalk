---
id: SHY-0482
status: In Review
owner: unassigned
created: 2026-08-27
priority: P0
effort: M
type: refactor
roadmap_ids: []
mvp: true
epic: EPIC-0003
---

# SHY-0482: Room moderation powers are proven against a fake transaction

## User Story

As **whoever relies on room moderation**, I want kick, mute and host promotion
proven against real Firestore, so that "the ban was recorded" means the room
document holds it rather than that a stub was handed a marker object.

## Why

Second slice of `room-mutations.test.js` after SHY-0481, which took the seat
lifecycle. This one takes **moderation** — who may do what to whom in a room:

- `POST /kick` (7 tests)
- `PATCH /seats/:seatIndex/mute` (14)
- `POST /hosts` + `DELETE /hosts/:userId` (8)

**29 tests**, still on the faked transaction: `runTransaction` invoked its
callback once with a canned snapshot, and the recorded update was never applied.
So a ban was asserted as `{ __arrayUnion: ['99'] }` — a marker object standing in
for a `FieldValue` that nothing ever resolved. Whether the person is actually in
`bannedUserIds` afterwards was never asked.

That matters most on exactly these routes. They are the ones that decide whether
somebody can be silenced or removed, and their gates are ordered deliberately —
several tests exist only to pin **where** a check fires, so that a caller cannot
probe a room's state by comparing error codes.

## Acceptance Criteria

### Happy path

- [ ] Kick, mute and host add/remove run against real Firestore transactions.
- [ ] All 29 behaviours preserved.
- [ ] The extracted file contains no Firestore or RTDB double.

### Error paths

- [ ] Every refusal — 400, 403, 409 — is asserted with the room read back
      **unchanged**.
- [ ] A kicked person is really in `bannedUserIds` and really out of
      `participantIds`, both resolved by real `FieldValue` operations.

### Edge cases

- [ ] Gate ORDERING is preserved and asserted, since it is the point of several
      tests: the CLOSED gate fires **after** the role check on kick and on host
      add (an unprivileged caller sees 403 whatever the room state), and
      **before** the seat-empty probe on mute (a caller cannot learn whether a
      seat is occupied in a dead room).
- [ ] Self-mute works for every role (SHY-0272), and force-muting somebody else
      still does not.
- [ ] CLOSED-room cleanup: demoting a host still works after close, while
      state-extending writes do not.

### Performance

- [ ] Within the emulator budget the other real route suites keep.

### Security

- [ ] The ban list is asserted as stored data, not as an intention.
- [ ] Per-file room id, disjoint from every other suite (SHY-0464).

### UX

- [ ] None: server-side contract only.

### i18n

- [ ] None.

### Observability

- [ ] `kickInfo` is asserted as a real stored record, since it is what a kicked
      person is shown.

## BDD Scenarios

**Scenario: Somebody is removed from a room**

- **Given** a moderator and somebody behaving badly
- **When** the moderator removes them
- **Then** they are out of the room and cannot come back

**Scenario: Muting yourself**

- **Given** somebody sitting in a room
- **When** they mute their own microphone
- **Then** they are muted

## Test Plan

| Layer | What it proves |
| --- | --- |
| Route (real emulator) | The room document after every kick, mute and host change. |
| Route (real emulator) | Every refusal leaves the room untouched. |
| Route (real emulator) | Gate ordering, by using inputs that would otherwise succeed. |
| Mutation | Removing the kick role check fails the suite. |

## Out of Scope

- `disconnect-user`, which reads RTDB presence — the umbrella sequences that
  against SHY-0103.
- The room-settings and owner-away/close groups. Later slices.

## Dependencies

- Follows SHY-0481.

## Risks & Mitigations

- **Risk:** a gate-ordering test silently stops testing ordering.
  **Mitigation:** each such test uses an input that would otherwise succeed, so
  the assertion fails if the gate moves.
- **Risk:** the extraction loses a behaviour. **Mitigation:** names carried
  across one for one and counted.

## Definition of Done

- [ ] The extracted file has zero Firestore/RTDB doubles.
- [ ] A ban is asserted as stored data.
- [ ] `room-mutations.test.js` shrinks by the extracted groups and still passes.

## Notes

SHY-0272 is preserved with its explanation: muting your OWN microphone was
routed through the FORCE-mute moderator gate, which answers a different question
and returned false for every role — so nobody could mute themselves, in any room.
It shipped because nothing covered self-mute.

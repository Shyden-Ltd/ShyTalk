---
id: SHY-0480
status: In Review
owner: unassigned
created: 2026-08-27
priority: P0
effort: L
type: refactor
roadmap_ids: []
mvp: true
epic: EPIC-0003
---

# SHY-0480: The rooms invite and seat-request routes are proven against a fake Firestore

## User Story

As **whoever relies on the rooms API**, I want its route tests to run against
real Firestore, so that "an invite was written" means a document exists rather
than that a spy was called.

## Why

`rooms.test.js` covers the two rooms write routes across **38 tests** and
replaces Firestore, RTDB and messaging wholesale:

```js
jest.mock('../../src/utils/firebase', () => ({
  db: { doc: jest.fn(() => ({ get: mockDocGet, update: mockDocUpdate, set: mockDocSet })), ... },
  rtdb: { ref: jest.fn(() => ({ set: mockRtdbSet })) },
  messaging: { sendEachForMulticast: jest.fn().mockResolvedValue({ responses: [] }) },
}));
```

**94 doubles across 822 lines.** Worse than the count: `db.doc()` ignores its
path entirely and returns the *same* stub for every document, so a test asserting
"the room was updated" cannot distinguish the room from the invitee from the
inviter. The sibling suite migrated in SHY-0479 at least had a path-aware Map.

Second slice of the **SHY-0113** umbrella's express scope, after SHY-0479.

## Why this one splits rather than simply migrates

The file is two suites wearing one name.

- **Route contract** — validation, 400s, 404s, existence-hiding, boundary seat
  indices, name truncation, what ends up in Firestore. All of this can and should
  be real.
- **FCM behaviour** — push payload contents, invalid-token cleanup, the
  "Someone" and "a room" display-name fallbacks, and what happens when a send
  fails. There is no local FCM emulator, so these are genuine units.

Migrating the file as a whole would leave it permanently in the no-stubs
baseline for the sake of the second group. The ratchet's own guidance is to
*"move it to a unit-test location if it is genuinely a unit test"* —
`*.unit.test.js` is the sanctioned location. Splitting lets the route contract
reach zero doubles and leaves the units honestly labelled as units.

Two tests induce failures real Firestore will not produce on demand — a document
fetch throwing, and an RTDB write failing. Those are units too, and move with the
FCM group.

## Acceptance Criteria

### Happy path

- [ ] The route-contract tests run against the real Firestore and RTDB emulators.
- [ ] Every behaviour covered today is still covered, in one file or the other.
- [ ] `rooms.test.js` contains no Firestore, RTDB or messaging double.

### Error paths

- [ ] 400s for every invalid `seatIndex` form are asserted against the real
      route, not a stub.
- [ ] Existence-hiding holds: a missing invitee and a blocked invitee are
      indistinguishable, and neither writes an invite.
- [ ] A spoofed `invitedBy` is refused 403 before anything is written.

### Edge cases

- [ ] Seat indices 0 and 20 are accepted and the stored document proves it.
- [ ] An over-long `userName` is truncated **in Firestore**, read back.
- [ ] A second seat request updates the existing pending one rather than
      creating a second.

### Performance

- [ ] The suite stays within the emulator budget the other real route suites
      keep.

### Security

- [ ] Existence-hiding and the spoof check are proven against real data.
- [ ] Per-file id range, disjoint from every seeded persona and other suite
      (SHY-0464).
- [ ] The unit file clears only its own rows from any shared collection
      (SHY-0479).

### UX

- [ ] None: server-side contract only.

### i18n

- [ ] None.

### Observability

- [ ] The RTDB room event is written for real on the happy path, so a regression
      that stops broadcasting fails a test.

## BDD Scenarios

**Scenario: An invitation is really sent**

- **Given** somebody inviting a friend to their room
- **When** they send the invitation
- **Then** the friend has an invitation waiting

**Scenario: A seat request replaces the previous one**

- **Given** somebody who already asked for a seat
- **When** they ask for a different seat
- **Then** they still have exactly one request

## Test Plan

| Layer | What it proves |
| --- | --- |
| Route (real emulator) | Invites and seat requests land in Firestore as documents. |
| Route (real emulator) | Refusals write nothing — asserted by reading back. |
| Unit (`*.unit.test.js`) | FCM payloads, token cleanup, display-name fallbacks, send failures. |
| Ratchet | `rooms.test.js` leaves the baseline; the unit file is in a sanctioned location. |

## Out of Scope

- `room-mutations.test.js` — 181 doubles, the umbrella's largest remaining file.
  Its own slice.
- Proving `firestore.rules`. Express uses the Admin SDK, which bypasses rules;
  that belongs to the rules-harness slice (SHY-0103).

## Dependencies

- Follows SHY-0479, which established the real-emulator pattern for this area.

## Risks & Mitigations

- **Risk:** the split loses a behaviour. **Mitigation:** the test names are
  carried across one for one and counted, and an AC requires it.
- **Risk:** the migrated suite passes without reaching the route.
  **Mitigation:** every write assertion reads Firestore back, so a route that
  did nothing fails.

## Definition of Done

- [ ] `rooms.test.js` has zero Firestore/RTDB/messaging doubles and leaves the
      baseline.
- [ ] The unit file covers every FCM and induced-failure behaviour.
- [ ] Test count across the two files is not lower than 38.

## Notes

The double being replaced is worse than its count suggests: a single stub served
every path, so no assertion in the file could tell one document from another.

---
id: SHY-0485
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

# SHY-0485: Closing a room is proven against a fake batch

## User Story

As **whoever closes a room**, I want the close and owner-returned routes proven
against real Firestore, so that "everybody was released from the room" means
their user documents changed.

## Why

Fifth slice of `room-mutations.test.js`, after seats, moderation, membership and
settings. This one takes the **presence-free half of the room lifecycle**:

- `POST /close` (11 tests)
- `POST /owner-returned` (6)

`owner-away` stays behind: it reads RTDB presence, which the SHY-0113 umbrella
sequences against SHY-0103.

**17 tests**, still on the faked transaction — and on a faked **batch**.
Closing a room does two things: it empties the room inside a transaction, and it
then clears `currentRoomId` on every participant's user document in a batch. The
second half was asserted as:

```js
expect(mockBatchSet).toHaveBeenCalledTimes(3); // one per participant
```

Three calls to a spy. **Whether any user document actually changed was never
asked** — and that write is what releases somebody from a room they can no longer
see.

### The best-effort branch

The batch is deliberately best-effort: a failure must not undo an
already-committed close, because clients also self-clear on observing it. The old
suite proved that by making a stubbed commit reject. Against real infrastructure
the stronger question can be asked — the room is closed **and** the user
documents are untouched — which is exactly the state that branch produces.

## Acceptance Criteria

### Happy path

- [ ] Both routes run against real Firestore transactions and a real batch.
- [ ] All 17 behaviours preserved.
- [ ] The extracted file contains no Firestore or RTDB double.

### Error paths

- [ ] Every refusal — 404 missing, 404 cohort-hidden, 403 non-owner, 409
      CLOSED — leaves the room read back **unchanged**.
- [ ] A best-effort batch failure still leaves the room CLOSED.

### Edge cases

- [ ] Closing empties **every** seat and the participant list, asserted on the
      stored document.
- [ ] Each participant's `currentRoomId` is really `null` afterwards, and a
      non-participant's is untouched.
- [ ] Closing an already-CLOSED room is idempotent: no write, no user clears.
- [ ] The OWNER_AWAY rules hold — a non-owner may close when no other non-owner
      is seated, may not while one is, and may once the away window has expired.

### Performance

- [ ] Within the emulator budget the other real route suites keep.

### Security

- [ ] Owner-only and OWNER_AWAY takeover rules proven against real data.
- [ ] Per-file room and user id ranges, disjoint from every seeded persona and
      other suite (SHY-0464).

### UX

- [ ] None: server-side contract only.

### i18n

- [ ] None.

### Observability

- [ ] `closedAt` is asserted as a stored number, since it is what the archive
      reads.

## BDD Scenarios

**Scenario: Closing a room releases everybody**

- **Given** a room with people in it
- **When** the owner closes it
- **Then** nobody is left in the room

**Scenario: Closing it twice**

- **Given** a room that is already closed
- **When** somebody closes it again
- **Then** nothing changes

## Test Plan

| Layer | What it proves |
| --- | --- |
| Route (real emulator) | The room document after close: state, seats, participants, `closedAt`. |
| Route (real emulator) | Every participant's `currentRoomId` is really cleared. |
| Route (real emulator) | A failing batch still leaves the room CLOSED. |
| Unit (`*.unit.test.js`) | Each route answers 500 when the transaction throws. |
| Mutation | Dropping the participant clear, and the OWNER_AWAY seat check, each fail the suite. |

## Outcome

`room-lifecycle.test.js` — **14 tests, zero doubles**.
`room-lifecycle-errors.unit.test.js` — 3. **17 → 17**.
`room-mutations.test.js` drops **672 → 503 lines, 96 → 78 doubles**.

Running total across SHY-0481 → SHY-0485:
**1922 → 503 lines, 181 → 78 doubles**, and 170 → 36 tests remaining on the fake.

### Mutation-tested

| Mutation | Result |
| --- | --- |
| Skip the participant `currentRoomId` clear | **1 fails** |
| Let a non-owner close while another non-owner is seated | **1 fails** |

The first is the assertion this story existed to add. Under the old harness the
same mutation would have been caught only as "the spy was called 0 times instead
of 3"; it is now caught as **people were not released from the room**.

### A trap worth recording

The first attempt at the best-effort test replaced `db.batch` wholesale. That
broke the **transaction**, because the Firestore SDK builds its own `WriteBatch`
through `db.batch()` — the route answered 500 with
`this._writeBatch._reset is not a function`, and the test would have "passed" as
a failure for entirely the wrong reason had it been asserting 500.

The spy now returns a **real** batch and refuses only the commit that has been
given a `users/` write, so the transaction's own batch commits normally.

## Out of Scope

- `owner-away` (RTDB presence — sequenced against SHY-0103), `disconnect-user`,
  and the Chunk C review-hardening group.

## Dependencies

- Follows SHY-0481 through SHY-0484.

## Risks & Mitigations

- **Risk:** the expiry test becomes time-flaky. **Mitigation:** `ownerLeftAt` is
  set relative to the real timeout constant with a wide margin, not to a fixed
  clock.

## Definition of Done

- [ ] The extracted file has zero Firestore/RTDB doubles.
- [ ] The participant release is asserted on real user documents.
- [ ] `room-mutations.test.js` shrinks by the extracted groups and still passes.

## Notes

`expect(mockBatchSet).toHaveBeenCalledTimes(3)` is the assertion this story
exists to replace. Three calls to a spy say nothing about whether anybody was
released from the room.

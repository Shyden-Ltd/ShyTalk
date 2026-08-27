---
id: SHY-0481
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

# SHY-0481: The seat lifecycle is proven against a fake transaction

## User Story

As **whoever relies on room seating**, I want the seat routes proven against
real Firestore transactions, so that "the seat was taken" means the room
document changed rather than that a stub was called.

## Why

`room-mutations.test.js` is the umbrella's largest remaining express file — **181
doubles across 1922 lines, 170 tests, 19 route groups**. Every route on it is
transactional, and the transaction is faked:

```js
db: {
  doc: jest.fn(() => mockRoomRef),
  runTransaction: jest.fn(async (fn) => fn({ get: mockTxnGet, update: mockTxnUpdate })),
}
```

`runTransaction` simply calls the callback. Nothing is atomic, nothing re-reads,
and `mockTxnUpdate` records an intention that is never applied. So the seat
routes — whose entire purpose is to resolve a **race** for a seat — are tested by
a harness with no concurrency in it at all. `409 SEAT_TAKEN` is asserted against
a stub that was told the seat was taken.

## Why a slice, not the file

170 tests in one PR is not reviewable, and the SHY-0113 umbrella already
prescribes slicing this file. This is the first: the **seat lifecycle** — claim,
accept-invite, leave, remove, move — **43 tests**, extracted into
`room-seats.test.js` and migrated whole.

A file cannot be half-migrated: the `jest.mock` is global to it. Extracting a
group into its own file is what lets a slice reach zero doubles while the
remainder stays honest about still having them.

## Acceptance Criteria

### Happy path

- [ ] The seat-lifecycle routes run against real Firestore transactions.
- [ ] All 43 behaviours are preserved.
- [ ] `room-seats.test.js` contains no Firestore or RTDB double.

### Error paths

- [ ] Every refusal — 400 range, 404 room, 404 cohort-hidden, 409 closed,
      409 SEAT_TAKEN, 409 ALREADY_SEATED, 403 attendee, 403 non-owner seat 0 —
      is asserted with the room read back **unchanged**.
- [ ] A cross-cohort caller gets 404, indistinguishable from a missing room.

### Edge cases

- [ ] Seat 0 is owner-only, and the stored seat proves who holds it.
- [ ] A move vacates the old seat and fills the new one in the SAME document
      state — not one or the other.
- [ ] A genuine concurrency case is exercised: two callers race for one seat
      against the real transaction, and exactly one wins.

### Performance

- [ ] Within the emulator budget the other real route suites keep.

### Security

- [ ] Cohort-hiding is proven against real data.
- [ ] Per-file id range and room id, disjoint from every seeded persona and
      other suite (SHY-0464).
- [ ] Any shared collection is cleared of this file's own rows only (SHY-0479).

### UX

- [ ] None: server-side contract only.

### i18n

- [ ] None.

### Observability

- [ ] The RTDB room event is written for real on a successful mutation.

## BDD Scenarios

**Scenario: Two people reach for the same seat**

- **Given** one free seat and two people wanting it
- **When** they both take it at the same moment
- **Then** exactly one of them is sitting in it

**Scenario: Moving seats**

- **Given** somebody already seated
- **When** they move to a free seat
- **Then** they are in the new seat and the old one is free

## Test Plan

| Layer | What it proves |
| --- | --- |
| Route (real emulator) | Seat state in Firestore after every claim, move, leave and removal. |
| Route (real emulator) | Every refusal leaves the room document untouched. |
| Route (real emulator, concurrency) | Two real transactions racing for one seat — exactly one wins. |
| Mutation | Removing the seat-taken guard fails the suite. |

## Outcome

`room-seats.test.js` — **41 tests, zero doubles**. `room-seats-errors.unit.test.js`
— 4. **43 → 45**, and `room-mutations.test.js` drops 1922 → 1419 lines and
181 → 162 doubles.

### The case the old harness could not write

    two callers racing for one seat — exactly one wins

Two requests in flight against the same real seat, resolved by a real Firestore
transaction. The previous harness called its callback once with a fixed
snapshot, so `409 SEAT_TAKEN` was asserted against a stub that had been *told*
the seat was taken. Removing the guard from the route now fails **3 tests**,
including this one.

Other assertions that got stronger:

| Was | Now |
| --- | --- |
| `expect(mockTxnUpdate).not.toHaveBeenCalled()` | the whole room document read back and compared **unchanged** |
| a move checked as two separate recorded fields | both ends asserted in **one** document state |
| `'pendingInvites.20': { __delete: true }` — an intention | `pendingInvites` really is `{}` |
| `arrayUnion` recorded as a marker object | resolved for real, and shown not to duplicate an existing member |

### A docstring counted as a double

The first draft quoted the `runTransaction` stub it had replaced, to explain
what changed — and the ratchet, which matches its patterns as **text**, counted
the quotation. Reworded. Quoting the thing you removed counts as still having it.

## Out of Scope

- The remaining 14 route groups in `room-mutations.test.js` — moderation, room
  settings, owner-away/close. Later slices, as the umbrella prescribes.
- `firestore.rules`. Express uses the Admin SDK, which bypasses them
  (SHY-0103).

## Dependencies

- Follows SHY-0479 and SHY-0480, which established the pattern for this area.

## Risks & Mitigations

- **Risk:** the extraction loses a behaviour. **Mitigation:** test names carried
  across one for one and counted; an AC requires it.
- **Risk:** real transactions make the suite slow or flaky.
  **Mitigation:** one room document per test, deleted between; the emulator
  resolves contention deterministically.

## Definition of Done

- [ ] `room-seats.test.js` has zero Firestore/RTDB doubles.
- [ ] A real two-caller race is covered, which the fake transaction could not
      express.
- [ ] `room-mutations.test.js` shrinks by the extracted group and still passes.

## Notes

The fake `runTransaction` is the point of this story. A seat route exists to
resolve a race; a harness that calls the callback once, with a fixed snapshot,
cannot have a race in it. The migrated suite adds the case the old one could not
write.

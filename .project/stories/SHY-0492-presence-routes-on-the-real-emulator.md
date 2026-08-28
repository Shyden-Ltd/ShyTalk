---
id: SHY-0492
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

# SHY-0492: The presence-gated routes are proven against a fake RTDB

## User Story

As **whoever relies on the presence gate**, I want owner-away and
disconnect-user proven against real presence, so that "they had left" means the
presence node was really gone.

## Why

The last two express groups of the **SHY-0113** umbrella: `POST /owner-away`
(12 tests) and `POST /disconnect-user` (12). Both decide who may act on somebody
else, and both turn on a single question — **is that person still present?**

The route asks RTDB:

```js
const snap = await rtdb.ref(`rooms/${roomId}/presence/${userId}`).get();
return snap.exists();
```

The tests answered it with `mockRtdbGet.mockResolvedValue({ exists: () => true })`.
So every presence decision was asserted against a hand-written boolean, on a
route whose entire purpose is to act on somebody's absence. Presence is a real
node in a real database, and the local stack runs RTDB on 9000 — nothing
required it to be faked.

These groups were sequenced "against SHY-0103", which has now been **cancelled**:
the rules bug it described was fixed by SHY-0270 and is live on dev, proven by
probing the deployed rules. The gate is lifted.

## Acceptance Criteria

### Happy path

- [ ] Both routes run against real Firestore and real RTDB presence.
- [ ] All 24 behaviours preserved.
- [ ] `room-mutations.test.js` reaches **zero doubles** and leaves the baseline.

### Error paths

- [ ] Every refusal — 400, 404 missing, 404 cohort-hidden, 403 owner-target,
      403 present-target, 403 non-participant — leaves the room unchanged.
- [ ] The fail-safe holds: when the presence read **throws**, the route treats
      the person as PRESENT and refuses. Absence must never be inferred from an
      error.

### Edge cases

- [ ] The owner path never reads presence at all — asserted by the absence of a
      read, not by a spy.
- [ ] Idempotent `owner-away` writes nothing and broadcasts nothing.
- [ ] A disconnected user's seat and `currentRoomId` are really cleared.

### Performance

- [ ] Presence writes are single RTDB sets; no polling added.

### Security

- [ ] Only an absent, non-owner participant can be removed, proven against real
      presence.
- [ ] Per-file room and user ids, disjoint from every other suite (SHY-0464).

### UX

- [ ] None: server-side contract only.

### i18n

- [ ] None.

### Observability

- [ ] A presence-read failure is logged, and the log is asserted in the
      fail-safe case.

## BDD Scenarios

**Scenario: Removing somebody who has gone**

- **Given** somebody who has left the room without saying so
- **When** another person in the room removes them
- **Then** their seat is free

**Scenario: They are still here**

- **Given** somebody still in the room
- **When** another person tries to remove them
- **Then** nothing happens to them

## Test Plan

| Layer | What it proves |
| --- | --- |
| Route (real emulator + real RTDB) | Presence decisions against a real node. |
| Route (real emulator) | Refusals leave the room untouched. |
| Unit (`*.unit.test.js`) | The fail-safe when the presence read throws. |
| Mutation | Removing the presence check, and flipping the fail-safe, each fail. |

## Outcome

**`room-mutations.test.js` is gone.** All 24 remaining tests migrated with exact
parity — 20 against real Firestore and real RTDB, 4 induced failures in the unit
file. The no-stubs baseline drops **609 → 606** paths.

**That completes the SHY-0113 umbrella's express scope**: 1922 lines and 181
doubles at the start of this run, now zero.

### Mutation-tested

| Mutation | Result |
| --- | --- |
| Presence always reports ABSENT | **2 fail** |
| **Flip the fail-safe** — an unreadable presence reads as absent | **2 fail** |

The second is the one worth having. `isUserPresent` returns **true** on error, so
a database blip can never be mistaken for somebody having left; failing open
would let anyone be evicted during an outage. **A mocked read could never have
tested that** — the mock decided both the question and the answer.

### Two assertions became behavioural

| Was | Now |
| --- | --- |
| `expect(mockRtdbGet).not.toHaveBeenCalled()` — the owner path skips presence | the owner succeeds **while their presence node exists**, so a route that started checking would fail |
| `expect(rtdb.ref).toHaveBeenCalledWith('rooms/x/presence/1')` | somebody **else** is present while the owner is absent — a route reading the wrong node would refuse |

And the foreign-write pin — `expect(db.doc).toHaveBeenCalledWith('users/99')`,
needed only because the stub returned the same object for every path — became a
direct question: the evicted user's `currentRoomId` is null and the caller's is
untouched.

## Out of Scope

- The dev target for these journeys. `disconnect-user` reads collections the
  product API does not expose (SHY-0488).

## Dependencies

- Unblocked by the cancellation of SHY-0103.
- Follows SHY-0481 through SHY-0485 and SHY-0487.

## Risks & Mitigations

- **Risk:** RTDB state leaks between tests. **Mitigation:** the file owns one
  room path and clears it between tests, and clears only its own (SHY-0479).

## Definition of Done

- [ ] `room-mutations.test.js` has zero doubles and leaves the no-stubs
      baseline — completing the umbrella's express scope.
- [ ] The fail-safe is mutation-tested.

## Notes

The fail-safe is the assertion worth having: `isUserPresent` returns **true** on
error, so a database blip can never be mistaken for somebody having left. A
mocked read could never have tested that honestly — the mock decided both the
question and the answer.

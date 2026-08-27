---
id: SHY-0479
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

# SHY-0479: The room cross-cohort gate is proven against a fake, not against Firestore

## User Story

As **whoever relies on age segregation**, I want the room cross-cohort gate
proven against real Firestore, so that the test protecting a minor from an adult
is testing the product rather than a hand-written stand-in.

## Why

`rooms-same-cohort.test.js` covers the UK OSA #17 gate on two routes — room
invites and seat requests. It is the test that says an adult cannot invite a
minor into a room.

It replaces Firestore entirely:

```js
jest.mock('../../src/utils/firebase', () => ({
  db: { doc: jest.fn((path) => ({ get: () => mockDocGet(path), ... })), ... },
  rtdb: { ref: jest.fn(() => ({ set: mockRtdbSet })) },
}));
```

A `Map` of paths to objects, plus doubles for helpers, FCM, logging and
`isLiveAdmin`. **28 doubles across 295 lines.** Every assertion about who may
reach whom is an assertion about that Map.

This is the exact shape EPIC-0003 exists to remove, and it matters more here than
in most places: a safeguarding gate proven against a double is proven against
whatever the double's author believed. A double that is *more generous* than
reality hides the defect; one that is *less complete* invents one. Both have
already happened in this repository.

Slice of the **SHY-0113** umbrella — the "rooms-same-cohort gate → real" slice
named in its decomposition. Chosen next because it is the smallest of the three
remaining files and the one whose subject is safety.

## Acceptance Criteria

### Happy path

- [ ] The suite runs against the real Firestore emulator; rooms and users are
      real documents.
- [ ] All eleven existing behaviours still pass, unchanged in meaning.

### Error paths

- [ ] A cross-cohort invite is refused with 404 and a **real** audit document is
      written to Firestore, asserted by reading it back.
- [ ] A room with no owner, a missing owner document and a missing room each
      refuse, against real absence rather than a Map miss.

### Edge cases

- [ ] Existence-hiding holds: a missing invitee and a blocked invitee are
      indistinguishable to the caller.
- [ ] An admin bypass is exercised through the real `isLiveAdmin`, reading a
      real admin claim, not a mocked boolean.

### Performance

- [ ] The suite stays within the emulator budget the other real-Firestore route
      suites keep.

### Security

- [ ] The gate is proven against real data. A mutation that removes
      `requireSameCohort` from either route must fail the suite.
- [ ] Per-file id range so the suite cannot collide with a seeded persona or
      another suite (SHY-0464).

### UX

- [ ] None: server-side contract only.

### i18n

- [ ] None.

### Observability

- [ ] The audit trail is asserted as a real document, so a regression that stops
      recording segregation events fails a test.

## BDD Scenarios

**Scenario: An adult cannot invite a young person into a room**

- **Given** an adult and a young person
- **When** the adult tries to invite them
- **Then** the invitation does not happen

**Scenario: The refusal is recorded**

- **Given** a refused cross-cohort invitation
- **When** a moderator looks at the record
- **Then** the attempt is there

## Test Plan

| Layer | What it proves |
| --- | --- |
| Route (real emulator) | Both gates refuse cross-cohort against real user documents. |
| Route (real emulator) | The audit document exists in Firestore afterwards. |
| Mutation | Removing `requireSameCohort` from either route fails the suite. |
| Ratchet | The no-new-stubs debt SHRINKS; the baseline is regenerated only because the count went down. |

## Out of Scope

- `rooms.test.js` and `room-mutations.test.js` — the other two files in the
  umbrella's express scope, 275 doubles between them. Separate slices.
- FCM. There is no local emulator for it; the operator's 2026-06-17 decision
  permits a double locally provided real push is proven in dev.

## Dependencies

- Slice of **SHY-0113**.

## Risks & Mitigations

- **Risk:** the migrated suite passes because it no longer reaches the gate.
  **Mitigation:** a mutation removing the middleware must fail it — an AC, and
  run before merge.
- **Risk:** id collision with a seeded persona. **Mitigation:** `mintRealUser`
  already refuses seeded ids, and the file takes its own range.

## Definition of Done

- [ ] No Firestore or RTDB double remains in the file.
- [ ] Mutation-tested against removal of the gate.
- [ ] The no-new-stubs baseline shrinks.

## Notes

The umbrella's own note records the correction that matters here: express tests
use the **Admin SDK, which bypasses security rules**, so this migration proves
the *route middleware's* decision against real data — it does not and cannot
prove `firestore.rules`. That belongs to the rules-harness slice (SHY-0103).

---
id: SHY-0484
status: In Review
owner: unassigned
created: 2026-08-28
priority: P0
effort: S
type: refactor
roadmap_ids: []
mvp: true
epic: EPIC-0003
---

# SHY-0484: Room settings are proven against a fake transaction

## User Story

As **whoever changes a room's settings**, I want the rename and approval-toggle
routes proven against real Firestore, so that "the name changed" means the room
document holds the new name.

## Why

Fourth slice of `room-mutations.test.js`, after SHY-0481 (seats), SHY-0482
(moderation) and SHY-0483 (membership). This one takes **settings** — the two
owner-only routes:

- `PATCH /name` (10 tests)
- `PATCH /require-approval` (9)

**19 tests**, still on the faked transaction, so a rename was asserted as
`toHaveBeenCalledWith(ref, { name: 'New Name' })` — an intention recorded
against a stub, never applied to a document.

Both routes are **owner-only**, and both carry validation that only a real write
can confirm: a name is trimmed before it is stored, and `false` must be treated
as a value rather than as "missing".

## Acceptance Criteria

### Happy path

- [ ] Both routes run against real Firestore transactions.
- [ ] All 19 behaviours preserved.
- [ ] The extracted file contains no Firestore or RTDB double.

### Error paths

- [ ] Every refusal — 400 invalid, 404 missing, 404 cohort-hidden, 403
      non-owner, 409 CLOSED — leaves the room read back **unchanged**.
- [ ] A blank-after-trim name and an over-long name are both refused, and
      neither reaches the document.

### Edge cases

- [ ] The stored name is the **trimmed** one, read back from Firestore.
- [ ] `requireApproval: false` is applied, not treated as missing — asserted by
      flipping a room that had it `true`.
- [ ] A host is refused where the owner succeeds, on the same room.

### Performance

- [ ] Within the emulator budget the other real route suites keep.

### Security

- [ ] Owner-only enforcement and cohort-hiding are proven against real data.
- [ ] Per-file room id, disjoint from every other suite (SHY-0464).

### UX

- [ ] None: server-side contract only.

### i18n

- [ ] The name length limit is asserted in characters, so it does not silently
      become a byte limit.

### Observability

- [ ] The RTDB event is asserted present on a successful rename.

## BDD Scenarios

**Scenario: Renaming a room**

- **Given** somebody who owns a room
- **When** they give it a new name
- **Then** everyone sees the new name

**Scenario: Somebody else tries to rename it**

- **Given** somebody who does not own the room
- **When** they try to rename it
- **Then** the name does not change

## Test Plan

| Layer | What it proves |
| --- | --- |
| Route (real emulator) | The stored name and approval flag after each change. |
| Route (real emulator) | Every refusal leaves the room untouched. |
| Unit (`*.unit.test.js`) | Each route answers 500 when the transaction throws. |
| Mutation | Removing the owner check, and dropping the trim, each fail the suite. |

## Out of Scope

- owner-away / owner-returned / close, `disconnect-user` (RTDB presence,
  sequenced against SHY-0103), and the Chunk C group. Later slices.

## Dependencies

- Follows SHY-0481, SHY-0482 and SHY-0483.

## Risks & Mitigations

- **Risk:** the trim assertion passes on an untrimmed value that happens to
  match. **Mitigation:** the input has whitespace on both sides and the stored
  value is compared exactly.

## Definition of Done

- [ ] The extracted file has zero Firestore/RTDB doubles.
- [ ] Trim and the `false`-is-a-value case asserted on stored data.
- [ ] `room-mutations.test.js` shrinks by the extracted groups and still passes.

## Notes

`false` being a valid value rather than a missing one is the kind of thing a
recorded intention cannot distinguish: `{ requireApproval: false }` looks the
same whether it was applied or ignored. Reading the document back settles it.

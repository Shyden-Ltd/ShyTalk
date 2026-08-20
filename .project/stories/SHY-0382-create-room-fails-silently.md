---
id: SHY-0382
status: Draft
owner: unassigned
created: 2026-08-20
priority: P2
effort: S
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0382: Creating a room can do nothing at all, with no error and no log

## User Story

As **someone creating a room**, I want to be told when it does not work, so
that I am not left tapping a button that silently refuses.

## Why

Found while walking SHY-0372 on a real device against the **local** stack.
Tapping **Create** closed the dialog and produced no room, no error message, and
**no log line at all**.

The cause is the first line of the handler:

```kotlin
fun createRoom(name: String) {
    val userId = authRepository.currentUserId ?: return   // HomeViewModel.kt:369
    logI(TAG, "Creating room: name=$name")
    ...
```

The early return sits **above** its own log statement. So when `currentUserId` is
null, the function returns having recorded nothing whatsoever — the absence of
the log was the only clue that the function had even been reached.

### Why it is worth fixing even though the cause was environmental

The null user was a local-environment problem, but the **handling** is the
defect. Any condition that leaves `currentUserId` null in production — a session
expiring between screen load and tap, a failed token refresh — produces the same
dead button with nothing to diagnose it by.

## Acceptance Criteria

### Happy path

- [ ] Creating a room with a signed-in account behaves exactly as today.

### Error paths

- [ ] If the room cannot be created because there is no signed-in account, the
      person is told, and the dialog does not simply close.
- [ ] The attempt is logged with its reason, whether it succeeds or not.
- [ ] A backend refusal is also surfaced, not swallowed.

### Edge cases

- [ ] A session that expires between opening the dialog and tapping Create is
      handled as an error, not as silence.
- [ ] Double-tapping Create does not create two rooms.

### Performance

- [ ] No change.

### Security

- [ ] The fix must not create a room without a verified account. Failing closed
      stays; only the silence goes.
- [ ] No identifiers or tokens are written to logs.

### UX

- [ ] A control that cannot do its job says so.

### i18n

- [ ] Any new message goes to the **5 MVP locales only** (en, zh, id, vi, th).

### Observability

- [ ] Every exit path from room creation is logged, including the refusals.

## BDD Scenarios

**Scenario: A refused room creation says so**

- **Given** someone whose session is no longer valid
- **When** they try to create a room
- **Then** they are told it did not work

**Scenario: A normal room creation is unchanged**

- **Given** someone signed in
- **When** they create a room
- **Then** the room is created as it is today

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | A null current user produces an error state and a log entry, not a silent return. |
| Unit | Every exit path from `createRoom` logs, proven by asserting on the log for each. |
| Mutation | Remove the error state; the test must go red. |
| Device | On a real device with an invalidated session, tapping Create shows a message. |

## Out of Scope

- Why `currentUserId` is null on the local flavour. That is environment setup,
  and is covered by SHY-0383.
- Any change to who is allowed to create rooms.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Adding a message weakens the fail-closed behaviour | The guard stays; only the silence changes. A test asserts no room is created. |
| The same silent-return shape exists elsewhere | Sweep for `?: return` above the first log statement in ViewModels while fixing this one. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Proven on a real device.
- [ ] Sweep completed for the same shape in other ViewModels.

## Notes

- Third instance of the same shape in one session, with SHY-0372 and SHY-0380:
  a code path that does nothing and says nothing. Worth treating as a pattern.

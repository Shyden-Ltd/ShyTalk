---
id: SHY-0475
status: Draft
owner: unassigned
created: 2026-08-27
priority: P2
effort: M
type: bug
roadmap_ids: []
mvp: false
epic: EPIC-0003
---

# SHY-0475: Four room instrumentation tests fail on a real device and pass on the emulator

## User Story

As **whoever trusts the Android suite**, I want it to give the same answer on a
real phone as on the emulator, so that a green CI run is not a statement about
emulators only.

## Why

Four tests fail on a real OnePlus (`CPH2653`, Android 16) and pass on CI's
`google_apis` x86_64 emulator at API 33:

```
RoomBrowsingTest   clickRoom_navigatesToRoomScreen
RoomBrowsingTest   roomScreen_backButton_returnsToMain
RoomBrowsingTest   roomScreen_showsSeatGrid
RoomCreationTest   createRoom_submitForm_navigatesToNewRoom
```

All four ENTER a room, and all four fail the same way:

```
IllegalStateException: No compose hierarchies found in the app.
```

Not an assertion failure — the composition is **gone**. Every test that stops
short of entering a room passes, including `mainScreen_roomsTab_showsRoomList`.

Confirmed pre-existing: the same four fail on clean `develop` with no changes.

### The product is not broken

The device journey matrix creates rooms, enters them and takes seats on this
exact phone, and passes **15/15**. So this is the instrumentation harness
failing on real hardware, not the app failing users. Entering a room takes audio
focus and starts a foreground service; a real device treats that differently
from an emulator, and `createComposeRule()` hosts content in an activity that
appears not to survive it.

That distinction is why this is P2 and not P0 — but it also means the emulator
suite cannot see a whole class of real-device behaviour, which is the part worth
fixing.

## Acceptance Criteria

### Happy path

- [ ] The four tests pass on a real device.
- [ ] They still pass on the CI emulator.

### Error paths

- [ ] A test whose composition is destroyed reports WHY, rather than only that
      no hierarchy was found.

### Edge cases

- [ ] Entering a room without the audio permission granted is covered, since
      that is the difference the emulator hides.

### Performance

- [ ] No change to suite runtime beyond the four tests.

### Security

- [ ] None: test-harness only.

### UX

- [ ] None.

### i18n

- [ ] None.

### Observability

- [ ] The failure names the activity or service involved, so the next person
      does not start from "no compose hierarchies".

## BDD Scenarios

**Scenario: Somebody opens a room on a real phone**

- **Given** somebody looking at the room list
- **When** they open a room
- **Then** the room is shown

## Test Plan

| Layer | What it proves |
| --- | --- |
| Instrumentation (real device) | The four tests pass on the OnePlus. |
| Instrumentation (emulator) | They still pass in CI. |
| Device (real) | The journey matrix continues to walk rooms, as it already does. |

## Out of Scope

- The rest of the Android suite, which is green on both after SHY-0474.
- Any product change. The app enters rooms correctly on this device.

## Dependencies

- Found while completing SHY-0474.

## Risks & Mitigations

- **Risk:** treated as flakiness and retried away. **Mitigation:** it is
  deterministic — four for four, on two separate runs of clean develop.
- **Risk:** fixed by weakening the tests to stop entering rooms.
  **Mitigation:** entering a room IS the subject; an AC pins it.

## Definition of Done

- [ ] Four tests pass on a real device and on the emulator.
- [ ] The cause is named in the story, not just worked around.

## Notes

Discovered because SHY-0474 ran the suite on a real phone. CI has only ever run
it on an emulator, so nothing before this could have found it.

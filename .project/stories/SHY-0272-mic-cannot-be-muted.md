---
id: SHY-0272
status: In Progress
owner: claude
created: 2026-08-04
priority: P0
effort: S
type: bug
roadmap_ids: []
pr:
mvp: true
---

# SHY-0272: The microphone cannot be muted

## User Story

As someone sitting in a voice room,
I want to mute my own microphone,
So that I control when the room can hear me.

## Why

Reported from a real device: *"the mic is stuck open and cannot be muted/unmuted."*

The mic toggle was decorative. Tapping it did nothing at all — no request, no error message,
no change of state. Confirmed on the operator's own device before touching anything: the
button was present, enabled and clickable, the system reported *"Applications are using your
microphone"*, the tap registered in the app's input log, and **no API call followed**.

There are **two independent defects**, and either alone was enough to break muting.

**1. The permission gate could never pass (client, Android only).**

`RoomScreen` gated the toggle on:

```kotlin
if (platformSettings.hasPermission("microphone")) { viewModel.toggleSelfMute(seatIndex) }
```

`AndroidPlatformSettingsService.hasPermission` handed that string straight to
`ContextCompat.checkSelfPermission`, which only understands `android.permission.*` constants.
There is no permission called `"microphone"` — it is `RECORD_AUDIO` — so the check returned
DENIED **unconditionally**, and the `if` silently swallowed every tap. Not a race, not a
timing bug: a permanent no-op for every Android user in every room.

Each side was individually defensible. The interface's own docstring said *"e.g. microphone,
bluetooth"* — friendly labels; the Android implementation expected raw constants. Only the
CONTRACT between them was wrong, so no per-file test could see it. That is the same shape as
the SHY-0270 presence-identity bug, and stringly-typed APIs are how it hides.

iOS was unaffected: its implementation returns `true` unconditionally.

The same broken check also drives the Settings screen, which therefore reported microphone and
Bluetooth as not-granted for everyone, regardless of the truth.

**2. Self-mute was refused by the server (all platforms).**

`PATCH /rooms/:roomId/seats/:seatIndex/mute` chose its authorisation branch by *what* was
being set rather than *who* was being acted on, so every mute went through `canForceMute` —
which answers a different question: *"may this moderator silence that person?"* For a caller
acting on their own seat it answers `false` in every role:

| role | why it refused |
|---|---|
| owner | `canForceMute` refuses when the seat's occupant is the owner ("never the owner") |
| host | a host may only mute non-hosts, and they are a host |
| member | neither OWNER nor HOST, so the final `return false` |

So **nobody could mute themselves**, in any room, in any role. The *unmute* branch directly
below already asked the right question ("are you the occupant?"); the mute branch never did.

Even with defect 1 fixed, every self-mute would have come back `403 Not allowed to mute this
seat`.

**Why nothing caught either.** No test in the repo referenced self-mute, `"microphone"`, or
either error string. The mute endpoint had six tests — force-mute by an owner, three refusals,
and self-*unmute* — and not one self-mute. The mic toggle control had no test at all. A
`testTag` assertion would have passed throughout the entire outage, because the button was
always on screen; only invoking it, and reading its label, catches this.

## Acceptance Criteria

### Happy path
- [ ] Tapping the mic toggle mutes the microphone, and tapping again unmutes it
- [ ] This works for a member, a host, and the room owner

### Error paths
- [ ] A refusal is surfaced to the user rather than swallowed silently

### Edge cases
- [ ] The toggle reports the seat the user is actually in, not a fixed index
- [ ] Someone in the room but not seated has no mic toggle
- [ ] Muting is refused in a CLOSED room

### Performance
- [ ] N/A — one authorisation branch and a permission-constant lookup.

### Security
- [ ] A member still cannot force-mute anyone else
- [ ] An attendee still cannot force-mute the owner
- [ ] A host still cannot mute another host
- [ ] Only the occupant may unmute their own seat

### UX
- [ ] The control reads "Mute" when live and "Unmute" when muted
- [ ] It is disabled only when voice is genuinely unavailable

### i18n
- [ ] The three labels come from `strings.xml` and are covered by the SHY-0271 content guards

### Observability
- [ ] A refused mute is visible rather than silent

## BDD Scenarios

**Scenario: Muting my own microphone**
- **Given** a member is seated in a voice room
- **When** they tap the microphone control
- **Then** their microphone is muted and the control offers to unmute

**Scenario: The room owner mutes themselves**
- **Given** the owner is seated in their own room
- **When** they tap the microphone control
- **Then** their microphone is muted

**Scenario: Muting someone else is still moderator-only**
- **Given** a member who is not a host
- **When** they try to mute another member
- **Then** the request is refused

## Test Plan

**Red first — server.** Six new tests in `express-api/tests/routes/room-mutations.test.js` cover
self-mute for a member, the owner and a host, plus the counterparts the fix must not break
(a member cannot force-mute someone else; an attendee cannot force-mute the owner; self-mute is
refused in a CLOSED room). All three self-mute tests failed **403 where 200 was expected**
before the fix, on all three roles. After: **170/170 green**, including every pre-existing
permission test.

**Red first — client.** Four new tests in
`shared/src/androidHostTest/.../AndroidPermissionMappingTest.kt` pin the mapping
(`MICROPHONE → android.permission.RECORD_AUDIO`), assert exhaustively that every enum case maps
to a real `android.permission.*` constant, and pin the regression directly — no permission may
map to its own name, which is precisely what `"microphone"` did. **4/4 green** via
`:shared:testAndroidHostTest`, confirmed by reading the result XML rather than trusting the
build's exit code.

**The strongest guard is the compiler.** `hasPermission` now takes an `AppPermission` enum, so
`hasPermission("microphone")` no longer compiles. That class of defect cannot recur, and each
platform's `when` is exhaustive so a new permission cannot be added without every platform
being made to handle it.

**New — mute/unmute UI coverage.** `app/src/androidTest/.../MicToggleTest.kt` (6 tests, green on
a real OnePlus) covers the control that had none: that tapping it invokes the callback with the
occupied seat index, that it reads "Mute"/"Unmute"/"Voice unavailable" correctly, that it is
disabled *and* silent only when voice is genuinely unavailable, that it is absent when not
seated, and that it reports the seat it is really in.

Stated honestly: `MicToggleTest` would **not** have caught defect 1 — `ChatPanel` was correct;
the fault was in `RoomScreen`'s gate. The permission tests and the type change cover that.
Different tests catch different bugs.

**Also fixed:** `ChatPanel.onToggleMic` no longer carries a `= {}` default. A silent default is
how a privacy control ships dead, and it is the same pattern removed in SHY-0268. No call site
needed changing, confirming every host already wired it.

**Device evidence.** The defect was confirmed on the operator's live session before any change:
button enabled, content-description "Mute", tap registered, no API call, no state change.

## Out of Scope

- **iOS `hasPermission` returns `true` unconditionally.** Real checks need `AVAudioSession` and
  `CBManager`. Reporting `false` before those are wired would disable the iOS mic toggle
  entirely — the exact failure this story fixes on Android — so it stays permissive. iOS prompts
  at the point of use and the system refuses the capability itself if declined. Needs its own
  story.
- **Full end-to-end walk with live voice on the LOCAL stack.** Blocked by the LiveKit WebSocket
  repeatedly failing with `Broken pipe` over the `adb reverse` USB tunnel — an environment
  limitation, not a product fault. To be completed on dev, where LiveKit is a real server.
- The daily-rewards calendar modal exposes **no testTags at all**, so no journey can drive past
  it deterministically. Noticed while walking this bug; needs its own story.

## Dependencies

- None.

## Risks & Mitigations

- **Risk:** allowing self-mute weakens moderation.
  **Mitigation:** the change is scoped to `seat.userId == callerId`; force-muting anyone else
  still goes through `canForceMute` unchanged, and three tests pin exactly that.
- **Risk:** the enum change misses a call site.
  **Mitigation:** the compiler enforces it — there is no overload taking a String, so a missed
  call site cannot build. All three sites were updated and both Android and iOS compile.
- **Risk:** the iOS permissive stub hides a real iOS permission problem.
  **Mitigation:** stated explicitly in Out of Scope rather than left implicit; behaviour is
  unchanged from before this story, so nothing regresses.

## Definition of Done

- [ ] Self-mute works for member, host and owner
- [ ] Force-mute rules unchanged, pinned by tests
- [ ] Server + host + instrumented tests green
- [ ] End-to-end walk on a real Android device against dev
- [ ] iOS device walk of the same control
- [ ] Merged to develop; `released_in:` at the next release cut

## Notes (running log)

- **2026-08-04 01:0x BST** — Operator reported the mic stuck open. Reproduced on their live dev
  session before changing anything: tap registered, no API call, no state change, mic held open
  by the OS. Read the path rather than guessing and found two independent defects, either of
  which alone breaks muting. The permission one is Android-only and total; the server one
  affects every platform and every role.
- **2026-08-04 01:2x BST** — Local end-to-end blocked by LiveKit `Broken pipe` over the USB
  tunnel (`isVoiceUnavailable` correctly disables the control). Environment, not product;
  recorded in Out of Scope and deferred to the dev walk.

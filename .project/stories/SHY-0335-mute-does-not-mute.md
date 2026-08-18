---
id: SHY-0335
status: In Progress
owner: claude
created: 2026-08-18
priority: P0
effort: M
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0335: Muting yourself in a room does not mute you — the mic stays open

## User Story

As **anyone in a voice room**, I want the mute control to actually stop
transmitting my microphone, so that I can rely on being silent when I choose to
be.

## Why

**P0, MVP-blocking, and the most serious class of bug this product can ship.**

Operator-reported 2026-08-18: pressing mute in a chat room does not mute — the
microphone stays open permanently.

A mute control that lies is worse than having no mute control at all. A user who
believes they are muted will say things they would never say on an open mic —
to family in the room, about other participants, or simply private household
noise. This is a **privacy harm, not a feature gap**, and on a product with
minors in its audience it is not shippable.

It also cannot be worked around: the user has no other way to stop transmitting
short of leaving the room.

## Acceptance Criteria

### Happy path

- [ ] Pressing mute stops the local microphone track being published; other participants stop hearing the user immediately.
- [ ] Pressing unmute resumes publishing, and other participants hear the user again.
- [ ] The control's visual state always reflects the ACTUAL publish state, never an optimistic local guess.

### Error paths

- [ ] If the mute request to the voice service fails, the control does NOT show muted — it surfaces the failure rather than lying.
- [ ] Losing and regaining the network while muted leaves the user still muted, never silently re-opened.
- [ ] A driver/service returning no confirmation is treated as failure, not success.

### Edge cases

- [ ] Muting before the room has finished connecting is honoured once connected — it must not be dropped.
- [ ] Backgrounding and foregrounding the app preserves the mute state.
- [ ] Rapidly toggling mute settles on the final requested state, with no stuck intermediate.

### Performance

- [ ] Mute takes effect within 300 ms of the press — it is a safety control, not a preference.

### Security

- [ ] Mute state is enforced where the audio is published, not merely in the UI, so it cannot be bypassed by a client that ignores its own control.

### UX

- [ ] The muted state is unmistakable at a glance, and distinguishable from "connecting".
- [ ] Verified on real devices at the smallest supported resolution.

### i18n

- [ ] Any new or changed strings ship in all 20 locale files.

### Observability

- [ ] A mute request that fails is logged with enough detail to tell a permission denial from a transport failure.

## BDD Scenarios

**Scenario: Muting actually silences the user**

- **Given** two people are talking in the same room
- **When** one of them mutes themselves
- **Then** the other person stops hearing them

**Scenario: Unmuting restores their voice**

- **Given** someone is muted in a room
- **When** they unmute themselves
- **Then** the other person hears them again

**Scenario: A failed mute never looks successful**

- **Given** someone in a room whose connection is failing
- **When** they try to mute themselves
- **Then** they are told it did not work, rather than being shown as muted

## Test Plan

**RED first, on every framework this touches.** No production change lands
before a failing test names the defect.

### Kotlin unit — `app/src/test/.../core/room/ActiveRoomManagerTest.kt`

Four of the five originally-named tests exist. The fifth was named at a layer
that cannot honestly carry it, and saying so is part of the work:

- `toggleSelfMute - toggles mute state for own seat` — mute reaches the mic
- **`toggleSelfMute - a successful UNMUTE republishes (SHY-0335)`** — added; the
  unmute direction had four tests and every one was a refusal
- **`toggleSelfMute - a FAILED UNMUTE leaves the mic CLOSED (SHY-0335)`** — added
- `toggleSelfMute - a FAILED write must not change the mic (SHY-0335)`
- `mute requested before connect is applied once connected` — satisfied by the
  room collector, which sets the mic from `mySeat.isMuted` on every room update
  and again immediately after `joinRoom` (`ActiveRoomManager.kt:356`, `:362`).
  Mute-while-disconnected therefore survives to connect by construction.

**`mute publishes nothing — the local audio track is disabled at the source`
cannot be a unit test here, and pretending otherwise would be the bug wearing a
test's clothes.** `VoiceService` is the seam; below it is the LiveKit adapter,
platform code on both sides. A unit test can only assert that
`setMicrophoneEnabled(false)` was CALLED — which is what the mute tests above
already do — never that a track stopped publishing. The only honest proof is the
journey's receiving-side assertion, and that is where it lives.

### Express/Jest — `express-api/tests/routes/`

- server-side enforcement: a participant marked muted cannot publish audio

### Journey tests (REQUIRED — real devices, real LiveKit)

- `journey-tests/` scenario: two personas in one room; A mutes; **B's client
  observes A's audio track ending**, not merely A's UI changing. The assertion
  must be on the RECEIVING side — an assertion on the muter's own screen is
  exactly the bug.
- Walked on real Android (USB adb) AND real iPhone (USB devicectl), local first,
  then dev, per the Pre-Merge Testing Protocol.

### Mutation proof

| Mutation | Must kill |
| --- | --- |
| mute updates UI state but not the track | `mute publishes nothing` AND the journey's receiving-side assertion |
| a failed mute request is swallowed | `a failed mute request leaves the UI state UNMUTED` |
| server-side enforcement removed | the Express enforcement test |

## Out of Scope

- **Making a moderator's mute stick — SHY-0340.** This story restores the
  ability to silence yourself. It deliberately does NOT change who may
  UNMUTE a seat, because doing so needs a field that does not exist:
  `seats.{i}.isMuted` is a bare boolean, so the server cannot tell a
  self-mute from a moderator's force-mute and has nothing to gate an
  unmute on. That is a data-model change with its own migration, its own
  client surface and its own safety argument, so it is its own story.
- Push-to-talk, per-participant volume, and any change to the moderator mute UX.
- Room-join latency — its own story.

## Dependencies

- None. Independent of the room-join latency work, though both touch the voice
  session.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The UI is fixed but the track still publishes | The journey assertion is on the RECEIVING participant, so a UI-only fix cannot pass. |
| Fixed on one platform only | Journey walked on real Android AND real iPhone before merge. |
| A regression silently returns | Server-side enforcement means a client-side regression cannot re-open the mic. |

## Definition of Done

- [ ] Every AC met; every named test written RED first and now green.
- [ ] Every mutation killed its named test, reverted with a git-verified clean tree.
- [ ] Journey walked on real Android + real iPhone, local THEN dev, with the receiving-side assertion.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: Detect Changes, Analyze JavaScript, PR Gate.
- [ ] Status In Review before merge; Done on release cut with `released_in:`.

## Notes (running log)

- **2026-08-18** — Reported by the operator as an MVP blocker. Recorded verbatim:
  "unable to mute myself in a chat room, mic stays open permanently."
- **2026-08-18** — Filed as its own story rather than bundled with the reported
  room-loading delay: different defect, different fix, different tests.

- **2026-08-18** — ROOT CAUSE, found by reading the authorisation rather than
  guessing. `PATCH /rooms/:id/seats/:i/mute` had exactly two paths:
  `isMuted: true` went through `canForceMute()` — the MODERATOR gate — and
  `isMuted: false` through the self-unmute check. **There was no branch for
  muting yourself**, so a user doing so was judged by the moderator gate.
  `canForceMute` returns false for an attendee, false for the owner's own seat
  (it exists to stop moderators muting the owner) and false for an already-muted
  seat. So self-mute returned 403 "Not allowed to mute this seat".

- **2026-08-18** — The CLIENT WAS ALREADY CORRECT, which is exactly why the
  symptom was what it was. `RoomViewModel:1205` only calls
  `setMicrophoneEnabled(false)` on `Resource.Success`. On the 403 it never
  disabled the microphone — so the UI had asked to be muted and the mic stayed
  open. It hit attendees, hosts AND the room owner.

- **2026-08-18** — WHY IT SHIPPED, at two layers. The unit suite tested
  force-mute by an owner, host-vs-host, a non-occupant unmuting, and the
  occupant UNMUTING themselves — but never the occupant MUTING themselves. The
  journey corpus (j09) likewise covered Ines UNMUTING and never muting. The one
  action every real user performs was the one action with no test anywhere.

- **2026-08-18** — Mutation-proven in BOTH directions, which a permission change
  needs: removing the self-mute branch fails the 3 self-mute tests (the bug
  reproduced); hardcoding `isSelf = true` fails the 3 force-mute refusals. A fix
  proving only the first would pass just as happily if it had opened force-mute
  to everyone.

- **2026-08-18** — Two journey scenarios added to j09, with server state and the
  OTHER participant's device asserted BEFORE the muter's own screen. Leading
  with her own screen would have passed against the broken build. Both use steps
  that already exist, so neither can pass by calling something unimplemented —
  which after SHY-0330 now throws rather than silently reporting PASS.

- **2026-08-18** — STILL OWED: walking both scenarios on real Android + real
  iPhone, local then dev. Not done, so this is NOT ready for In Review.

- **2026-08-18** — **Scope carved out to SHY-0340.** This story carried an AC
  bullet, a UX bullet and a named test asserting that a moderator's mute cannot
  be cleared by the participant. Reading the unmute branch showed that is not a
  test this story can write: the seat model is `seats.{i}.isMuted`, a bare
  boolean, with no `mutedBy` anywhere in `express-api/src` (grepped). So the
  server cannot distinguish a self-mute from a force-mute, and the unmute rule
  is unconditionally "the occupant may unmute" —
  `room-mutations.js` `else if (!isSelf)`. Leaving the bullet here would have
  meant either an AC that can never be ticked, or a "fix" that widened this
  story into a data-model migration mid-flight. Moved WHOLE to SHY-0340 (P0),
  where it gets its own migration, client surface and safety argument.

- **2026-08-18 20:2x WIB** — Two tests added for the UNMUTE direction, which had
  none. `toggleSelfMute` carried four manager-level tests and every one was
  about muting or about being refused, so the honour-the-write change could have
  broken reopening the mic outright with all 66 still green. Mutation-proven,
  each killing exactly its own test and nothing else:

  | Mutation | Killed |
  | --- | --- |
  | discard the `Resource` again | `a FAILED UNMUTE leaves the mic CLOSED` + `a FAILED write must not change the mic` |
  | `setMicrophoneEnabled(false)` hardcoded | `a successful UNMUTE republishes` |

  68 tests in the class, 0 failures. Tree verified clean after each revert.

- **2026-08-18** — The fifth named unit test was retired with its reason, not
  quietly dropped: nothing above the `VoiceService` seam can observe a track
  ceasing to publish, so a unit test there could only ever restate the call it
  already asserts. The journey's receiving-side assertion is the real proof.

- **2026-08-18** — STILL OWED, unchanged: the real-device walk on Android and
  iPhone, local then dev. Devices are unreachable while the operator is away, so
  this stays out of In Review until that is done.

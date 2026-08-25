---
id: SHY-0466
status: In Progress
owner: unassigned
created: 2026-08-26
priority: P2
effort: M
type: bug
roadmap_ids: []
mvp: false
epic: EPIC-0003
---

# SHY-0466: A room should open even when voice cannot

## User Story

As **someone joining a room on a network that blocks voice**, I want to read
and use the room straight away, so that a feature I am not using does not cost
me the room I came for.

## Why

The room screen renders nothing until voice reports ready:

```
} else if (uiState.hasJoined && !uiState.isVoiceReady) {
    // Loading screen while connecting to voice
```

There is no path that marks voice ready on failure — only a watchdog:

```
private const val VOICE_CONNECT_TIMEOUT_MS = 10_000L
...
delay(VOICE_CONNECT_TIMEOUT_MS)
if (!_uiState.value.isVoiceReady) {
    _uiState.update { it.copy(isVoiceReady = true, isVoiceUnavailable = true) }
}
```

So when voice cannot connect, the person waits a full ten seconds on a
spinner before the seat grid, the chat and the participant list appear —
none of which need voice. Everything they came to do is held hostage by the
one part that is failing.

This is not confined to a test rig. Any network that permits the app's HTTPS
but blocks or slows the media path — a restrictive corporate or campus Wi-Fi,
a captive portal, a bad mobile handover — produces exactly this. Ten seconds
of blank screen on every room open is the worst experience on the slowest
connections, which inverts the mobile-first, low-connectivity bar.

**The failure also cannot explain itself.** Four sites set
`isVoiceUnavailable = true`; only one of them records a reason:

| Site | Sets `voiceErrorDetail`? |
| --- | --- |
| `voiceService.error` collector | yes — the message |
| watchdog, first room join | no |
| watchdog, room re-join | no |
| watchdog, owner-return re-join | no |

The banner reads `voiceErrorDetail ?: voice_chat_unavailable`, so the three
watchdog paths can only ever produce the generic "Voice chat is temporarily
unavailable". That string names neither the layer nor the cause, and it is
what a whole session of diagnosis started from.

Found while re-confirming J09 on 2026-08-26. The environment cause is
[[SHY-0465]]; this ticket is what the app did about it.

## Acceptance Criteria

### Happy path

- [ ] The seat grid, chat and participant list appear as soon as the room data
      has loaded, without waiting for voice.
- [ ] When voice connects normally, nothing about the room's appearance or
      timing changes from today.

### Error paths

- [ ] When voice cannot connect, the room stays fully usable and the banner
      explains what is unavailable and what still works.
- [ ] Every path that marks voice unavailable records a reason, so the banner
      is never reduced to the generic string when a cause is known.

### Edge cases

- [ ] Voice arriving late — after the watchdog has already given up — clears
      the banner and re-enables the mic rather than leaving it stuck off.
- [ ] Re-joining a room, and the owner returning, behave the same as a first
      join. The three watchdog sites must not drift apart again.

### Performance

- [ ] Time from opening a room to a usable seat grid no longer depends on the
      voice timeout on a network where voice fails.

### Security

- [ ] No change to who may enter a room or hold a seat. Rendering earlier must
      not render anything the cohort and block checks have not yet cleared.

### UX

- [ ] The mic control communicates that voice is unavailable rather than being
      silently inert, and says so when used.
- [ ] The banner distinguishes "still connecting" from "gave up", so a slow
      network does not read as a broken one.

### i18n

- [ ] Any new or changed string ships in all 5 MVP locales (en, zh, id, vi, th).
- [ ] The reason detail is composed from translated parts, never an English
      technical message shown to the reader.

### Observability

- [ ] Each unavailability path records which one fired, so a report names the
      site rather than the symptom.

## BDD Scenarios

**Scenario: Voice is blocked but the room still works**

- **Given** someone on a network where voice cannot connect
- **When** they open a room
- **Then** they can read and chat straight away, and are told voice is unavailable

**Scenario: Voice arrives late**

- **Given** a room opened while voice was still failing
- **When** voice connects a moment later
- **Then** the warning clears and the microphone becomes usable

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | The room renders on room data alone; voice state only drives the banner and the mic control. |
| Unit | Each of the four unavailability paths records a reason; none can set the flag without one. |
| Unit | A late voice connection clears the banner and re-enables the mic. |
| Device | With voice deliberately unreachable, the seat grid appears promptly and chat works; the mic explains itself. |
| Device | With voice healthy, J09 passes unchanged. |

## Out of Scope

- Making voice connect on a hostile network. This ticket is about what happens
  when it cannot.
- The local stack's address choice — [[SHY-0465]].

## Dependencies

- [[SHY-0465]] — supplies a reliable way to reproduce a voice-less network on
  demand, which this ticket's device evidence needs.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Rendering earlier exposes a room state that was previously masked by the spinner | The gate moves to room data readiness, which the block and cohort checks already precede. |
| The three watchdog sites drift apart again | The AC requires one shared path to mark unavailability, so a reason cannot be omitted at one site. |
| A late-arriving voice connection leaves stale UI | Covered by its own scenario and its own test. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Device-proven both ways on a real phone: voice healthy, and voice
      deliberately unreachable.

## Notes

- Filed 2026-08-26. Measured directly: with voice unreachable the seat grid
  did not appear within 10 000 ms; with voice reachable it appeared in 4.3 s.
- The device runner waits 10 000 ms for `room_seatGrid` — the same value as
  the app's voice watchdog. The two raced, and the same root cause surfaced as
  two different failures on two runs ("opens his mic" one run, "shows the seat
  grid" the next). Fixing this ticket removes the race rather than re-tuning
  the wait; if it is deferred, that equal-timeout collision is worth its own
  look.

---
id: SHY-0189
status: Draft
owner: claude
created: 2026-07-14
priority: P1
type: bug
effort: M
roadmap_ids: []
epic: EPIC-0004
mvp: false
---

# SHY-0189: App-Lock lockout consequences — disconnect live voice + suppress notifications while locked/locked-out

## User Story

**As** a user whose phone is locked behind the App-Lock (or hard-locked after 5 failed PINs),
**I want** live voice-room audio to stop and message previews to stay hidden while the lock stands,
**So that** someone holding my locked phone cannot keep listening to my live room or read incoming content the lock exists to protect.

## Why

Surfaced by SHY-0187's code review (R1 Important-6 + Minor-9, 2026-07-14). Two connected gaps, both real only now that SHY-0187 made the Lock screen reachable:

1. **`LockScreenViewModel.onLockout` / `onLockoutRecovered` are never wired.** The hooks are documented as "voice disconnect, notification suppression" (`LockScreenViewModel.kt:53-57`) and ARE invoked on the server-flagged lockout path — but no composition site sets them, so the documented consequences never fire.
2. **Voice audio very likely survives the lock.** Android voice runs in a foreground Service (`RoomService.kt` / `AndroidRoomServiceController`) architecturally independent of navigation; interposing `Screen.Lock` does not touch `RoomLifecycleManager`. Reviewer confidence ~65% that a locked phone keeps emitting live room audio — MUST be confirmed on-device first (see Test Plan RED).

**⚠️ OPERATOR TRIAGE REQUESTED:** if the on-device check confirms audible room audio behind the lock, this is arguably MVP-blocking for the same reason SHY-0187 was ("the entire point of the lock"). `mvp:` left `false` pending that evidence + the operator's call — do not self-add to the blocker set ([[project-mvp-golive-parameters]]).

## Acceptance Criteria

### Happy path
- [ ] While the Lock screen stands (warm re-lock or cold gate) over an active voice room, room audio is not audible (disconnected or hard-muted per the design decision below).
- [ ] On the hard lockout (5 failed PINs), any active voice session is disconnected and `onLockout`'s documented consequences run.

### Error paths
- [ ] If the voice disconnect fails (network/LiveKit error), the lock still stands and the failure is logged loudly — the lock never waits on the room teardown.

### Edge cases
- [ ] Unlock (or `onLockoutRecovered`) does NOT silently rejoin the room — the user returns to the room screen in its real (disconnected) state, never to a ghost session.
- [ ] A device with no active room: lock/unlock cycles produce zero room-lifecycle calls.

### Performance
- [ ] The disconnect is fire-and-forget from the lock's perspective (no added lock-render latency).

### Security
- [ ] No content (audio, previews, TTS) is emitted while the lock stands — verified on real devices on BOTH platforms.

### UX
- [ ] The room screen after unlock communicates the disconnect (existing left-room state, no new UI).

### i18n
- N/A — no new user-facing strings (reuses existing room-left states).

### Observability
- [ ] Lock-triggered disconnects are logged with cause (`app-lock` vs `lockout`) so support can tell them from network drops.

## BDD Scenarios

**Scenario: locked phone goes silent**

- **Given** I am live in a voice room and my App-Lock timeout expires in the background
- **When** the app returns to the foreground and the Lock screen renders
- **Then** no room audio is audible while the Lock screen stands

**Scenario: hard lockout disconnects the room**

- **Given** I am live in a voice room on the Lock screen
- **When** the fifth wrong PIN locks the account
- **Then** the voice session disconnects and the Account Locked state renders

**Scenario: unlock does not ghost-rejoin**

- **Given** my room was disconnected by the lock
- **When** I unlock successfully
- **Then** I see the room in its real disconnected state (no phantom audio, no auto-rejoin)

## Test Plan

**RED first (the evidence step):** real-device probe on Android + iPhone — join a live room with a second persona speaking, trigger the warm re-lock, listen. Record the result in Notes; it decides both the design and the MVP flag. Then: jvmTest for the decision logic (what the lock does to `RoomLifecycleManager`), instrumented/device journeys for the audible behaviour, per the full protocol (touches `shared/**` + possibly `app/**` room service).

**Design options (decide at pickup, record here):** (a) hard-disconnect on lock render (simplest, honest state), (b) hard-mute mic+speaker while locked with auto-restore on unlock (better UX, more state), (c) disconnect only on hard lockout + mute on soft lock. Leaning (a) — rooms are rejoinable and honest state beats hidden state ([[feedback-consumer-first-surface-design]]).

## Out of Scope

- Notification-preview suppression while locked (Android channel/iOS interruption-level work) — file separately if the on-device probe shows previews leaking over the lock.
- Re-designing lockout UX/strings.

## Dependencies

- SHY-0187 merged (the Lock screen must render for any of this to be reachable).
- Coordinate with `RoomLifecycleManager` / `RoomService` owners of record for the disconnect API.

## Risks & Mitigations

- **Risk:** disconnect races the LiveKit teardown and leaves a zombie foreground service. **Mitigation:** reuse the existing leave-room path end-to-end (no new teardown code); assert the service stops in the instrumented journey.
- **Risk:** over-eager disconnects on every soft lock annoy legitimate users. **Mitigation:** the design decision explicitly weighs (a) vs (b); the operator sees the trade-off before implementation.

## Definition of Done

On-device evidence recorded; chosen design implemented with RED→GREEN across the touched frameworks; both platforms verified on real devices (no audible audio behind the lock; lockout disconnects; unlock never ghost-rejoins); `code-reviewer` 100% clean; merged; released.

## Notes

- 2026-07-14 ~18:20 WIB — **CREATED fully-refined** from SHY-0187 code-review findings Imp-6 (unwired `onLockout`/`onLockoutRecovered` hooks) + Min-9 (probable voice-audio leak under the lock, reviewer confidence ~65%, needs on-device confirmation). Kept OUT of SHY-0187 deliberately: wiring voice-disconnect touches `RoomLifecycleManager` semantics — a product decision + its own test surface, not nav wiring. SHY-0187's device-gauntlet run should OPPORTUNISTICALLY capture the audio-under-lock evidence for this story (same journey, one extra listen step).

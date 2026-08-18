---
id: SHY-0340
status: Draft
owner: claude
created: 2026-08-18
priority: P0
effort: M
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0340: A moderator mutes someone in a voice room and they simply turn themselves back on

## User Story

As a **room owner or host moderating a live voice room**, I want a mute I apply
to actually hold, so that when someone is abusing a room full of people —
including children — I have a control that stops them, instead of one they undo
in a single tap.

## Why

**P0. This is the only in-room safety control we have, and it does not work.**

Muting is the moderator's first response to abuse in a live voice room. It is
the proportionate one: quieter than kicking, reversible, and it does not end
anyone's session. Every other tool we have is an escalation — kick, ban, or
close the room on everyone.

Today that first response is **advisory**. Two independent ways out, both
available to the muted person with no privilege of any kind:

**1. They unmute themselves.** `express-api/src/routes/room-mutations.js`,
`PATCH /rooms/:roomId/seats/:seatIndex/mute`. Muting *someone else* is gated by
`canForceMute()` (`express-api/src/utils/room-auth.js:92`) — owner, or host
against a non-host. Un-muting is gated by one condition:

```js
} else if (!isSelf) {
  return { status: 403, body: { error: 'Only the occupant can unmute' } };
}
```

The occupant may always unmute. The rule reads as if it were protecting the
seat, and it is — from *everyone except the one person it needs to hold*.

**2. They leave the seat and sit back down.** `claim` (line 181) and
`accept-invite` (line 219) both write `seats.{i}.isMuted: false` on seating, and
`leave` (line 239) clears it on the way out. So vacating and re-claiming resets
the mute even if route 1 were closed. Fixing only the unmute path would move the
bypass, not remove it.

**The server cannot tell the two apart, because nothing records who muted.**
`seats.{i}.isMuted` is a bare boolean. `mutedBy`, `forceMuted` and every spelling
of them appear **nowhere** in `express-api/src`, `shared/src` (non-test),
`app/src` or `firestore.rules` — grepped. A self-mute and a moderator's mute are
byte-identical in storage, so no rule can be written about one without also
binding the other. **A user must always be able to silence themselves**
(SHY-0335 exists because that was broken), so the distinction is not optional.

**We already know how to model this.** Group chat does it properly:
`conversations/{id}/mutes/{uid}` documents, modelled by
`shared/src/commonMain/kotlin/com/shyden/shytalk/core/model/MuteInfo.kt` —
`mutedBy`, `mutedByName`, `reason`, `mutedAt`, `expiresAt`, `isActive` — read
through `getGroupMutes()` and surfaced in `PrivateChatScreen` and
`GroupSettingsSheet`. The text surface has attribution and expiry. The **voice**
surface, where harm is live and unreviewable, has a boolean. The voice room is
the outlier, and this story brings it up to the standard the rest of the product
already meets.

**Why this blocks MVP.** We are shipping a voice product with minors in the
audience to the App Store and Play Store. "Our moderators can mute, and the
muted person can unmute themselves immediately" is not a moderation story that
survives a store review, a safety complaint, or a parent.

## Acceptance Criteria

### Happy path

- [ ] When a moderator mutes someone, that person stays silent until a moderator lifts it.
- [ ] The muted person is told they were muted by a moderator, rather than left to guess why their microphone stopped working.
- [ ] A moderator can lift a mute they applied, and the person can speak again.
- [ ] Anyone can still mute themselves at any time, and unmute themselves afterwards, exactly as before.

### Error paths

- [ ] An attempt to unmute around a moderator's mute is refused and says why, rather than failing silently or appearing to succeed.
- [ ] If the refusal cannot be delivered, the microphone stays closed — the failure direction is silence.
- [ ] Lifting a mute that is not there is treated as already-done, not as an error.

### Edge cases

- [ ] Leaving the seat and sitting back down does not clear a moderator's mute.
- [ ] Leaving the room entirely and rejoining does not clear it either.
- [ ] Being moved to another seat by a moderator carries the mute with the person.
- [ ] A person muted by a moderator who then mutes themselves is still muted by the moderator when they unmute themselves.
- [ ] A moderator who loses their role cannot leave people muted with nobody able to lift it — the owner can always lift any mute in their room.
- [ ] Closing the room ends all mutes with it; nothing outlives the room.

### Performance

- [ ] The mute reaches the muted person's device within 300 ms of the moderator applying it — it is a safety control, not a preference.
- [ ] Deciding whether someone may unmute costs no extra round trip on the ordinary self-mute path.

### Security

- [ ] Enforcement is server-side. A modified client that ignores its own controls still cannot publish audio while moderator-muted.
- [ ] Only a moderator of that room can lift a moderator mute; being the seat's occupant is not sufficient.
- [ ] The record of who muted whom is not readable by other participants beyond what the UI needs to show.

### UX

- [ ] "Muted by a moderator" is visibly different from "I muted myself" and from "still connecting", for the muted person and for everyone else.
- [ ] The microphone control does not invite a tap that will be refused.
- [ ] Verified with eyes on real devices at the smallest supported resolution, both platforms.

### i18n

- [ ] Every new or changed string ships in all locale files, and the rendered sentence is asserted, not just the key.

### Observability

- [ ] Each moderator mute and each lift is logged with room, actor and subject, so a safety complaint can be reconstructed afterwards.
- [ ] A refused unmute is distinguishable in logs from a transport failure.

## BDD Scenarios

**Scenario: A moderator's mute holds**

- **Given** a moderator has muted someone in a voice room
- **When** that person tries to turn their microphone back on
- **Then** they stay silent and are told a moderator muted them

**Scenario: Sitting down again does not undo it**

- **Given** a moderator has muted someone in a voice room
- **When** that person leaves their seat and takes it again
- **Then** they are still muted

**Scenario: People can still mute themselves**

- **Given** someone speaking in a voice room that nobody has moderated
- **When** they mute themselves
- **Then** they go silent, and they can turn themselves back on whenever they like

**Scenario: A moderator can lift the mute**

- **Given** a moderator has muted someone in a voice room
- **When** the moderator lifts the mute
- **Then** that person can speak again

## Test Plan

**RED first, on every framework this touches.** Every test below is observed
failing against today's build before any production line changes.

### Express / Jest — `express-api/tests/routes/room-mutations-*.test.js`

- `a moderator-muted occupant cannot unmute themselves` — **the defect, in one assertion**
- `a self-muted occupant CAN unmute themselves`
- `claiming a seat does not clear a moderator mute`
- `accepting an invite to a seat does not clear a moderator mute`
- `rejoining the room does not clear a moderator mute`
- `a host cannot lift a mute applied by the owner`
- `the owner can lift any mute in their room`
- `lifting a mute that is not present succeeds idempotently`
- `moving a muted occupant to another seat carries the mute`

### Kotlin unit — `shared/src/commonTest/.../room/`

- `a moderator mute renders distinctly from a self mute`
- `the mic control is refused, not optimistically flipped, when moderator-muted`
- `a refused unmute leaves the microphone closed`

### Journey tests — real devices, real LiveKit

- `journey-tests/` scenario extending j09: three personas. Owner mutes B;
  **C's device observes B's audio track end**; B taps unmute and C still hears
  nothing; B leaves the seat and reclaims it and C still hears nothing; owner
  lifts and C hears B again.
- The assertion is on the **receiving** side throughout. An assertion on B's own
  screen is the bug wearing a test's clothes.
- Walked on real Android (USB adb) AND real iPhone (USB devicectl), local first
  then dev, per the Pre-Merge Testing Protocol.

### Mutation proof

| Mutation | Must kill |
| --- | --- |
| unmute gate removed | `a moderator-muted occupant cannot unmute themselves` + the journey's receiving-side assertion |
| gate applied to ALL unmutes, not just moderator mutes | `a self-muted occupant CAN unmute themselves` |
| `claim` reverted to clearing `isMuted` unconditionally | `claiming a seat does not clear a moderator mute` |
| lift permitted to the occupant | `a host cannot lift a mute applied by the owner` |
| enforcement moved to the client only | the Express enforcement test |

## Out of Scope

- Timed mutes (`expiresAt`). The group-chat model carries one; this story ships
  indefinite-until-lifted, because an expiry adds a scheduler and a whole class
  of clock questions for no MVP benefit. The field shape should not preclude it.
- Mute reasons as free text, and any moderation audit UI.
- Push-to-talk, per-participant volume, room-join latency (SHY-0336).
- Restoring the ability to mute yourself — that is SHY-0335, and it lands first.

## Dependencies

- **SHY-0335** — self-mute is refused. It rewrites the same authorisation block.
  Landing this first would guarantee a conflict, and 0335 is the more urgent
  half (today nobody can mute themselves at all). This story stacks on it.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---- |
| A migration on live room documents | Rooms are ephemeral — they close, and mutes die with them. Absent means "not moderator-muted", so old documents need no backfill. |
| The gate over-reaches and blocks self-unmute | Asserted directly, and in the mutation table: widening the gate must turn `a self-muted occupant CAN unmute themselves` red. |
| Someone is left muted with nobody able to lift it | The owner can always lift any mute in their room; mutes die with the room. Both are ACs. |
| The client shows the wrong mute state | The mute's origin comes from the server with the room state; the client renders it, never infers it. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] `cd express-api && npm test` passes; `npm run lint` clean at `--max-warnings=0`.
- [ ] Journey scenarios walked on real Android AND real iPhone, local then dev, with the receiving-side assertion.
- [ ] Screenshots of all three mute states on both platforms at the smallest supported resolution.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-18 19:5x WIB** — Filed at operator request, carved out of SHY-0335.
  0335 carried "A user muted by a moderator cannot unmute themselves around it"
  as an edge-case AC plus a named Kotlin test. Reading the unmute branch showed
  0335 could not honour it: with `isMuted` a bare boolean there is nothing to
  gate on, so the bullet was either untickable or a licence to widen 0335 into a
  data-model change mid-flight. Removed there, whole, and pointed here.

- **2026-08-18** — Both bypasses verified by reading, not inferred.
  Route 1: `room-mutations.js` `else if (!isSelf) → 403`, so the occupant always
  may. Route 2: `claim`/`accept-invite`/`leave` write `isMuted: false` at lines
  181/219/239. A fix to route 1 alone relocates the bypass.

- **2026-08-18** — One suspicion checked and **withdrawn**: seat `move`
  (line 516) looked like it would strand the mute on the old seat, but it writes
  `seats.{to}.isMuted = fromSeat.isMuted` alongside `fromSeat.userId`, so the
  mute travels with the person. Correct as written. Recorded so the next reader
  does not re-open it.

- **2026-08-18** — Precedent, not invention: group chat already models moderator
  mutes as documents with `mutedBy`/`mutedByName`/`reason`/`expiresAt`/`isActive`
  (`MuteInfo.kt`, `conversations/{id}/mutes`). The voice room is the surface
  without attribution, which is the inverse of where the risk is.

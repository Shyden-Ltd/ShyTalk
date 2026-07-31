---
id: SHY-0261
status: In Progress
owner: claude
created: 2026-07-31
priority: P0
effort: M
type: bug
roadmap_ids: []
---

# SHY-0261: A room closes itself seconds after the owner opens it

## User Story

**As a** person opening a voice room
**I want** the room to stay open once I have opened it
**So that** I can actually host a conversation, instead of watching the room
disappear before anyone has a chance to join.

## Why

Reported by the operator 2026-07-31: "when a user opens a room, it closes itself
automatically almost immediately." Rooms are the core of the product, so this is
a P0.

It is caused by three individually-reasonable decisions meeting at a seam nobody
owned:

1. **The owner client announces its own departure on arrival.** `armOwnerLeftSignal`
   writes `ownerLeft/{roomId}` immediately (`setValue` BEFORE
   `onDisconnect().setValue`), by design, so the server-side listener path
   "exercises itself on every arm". Every room ENTRY therefore delivers an
   owner-LEFT signal.
2. **The server acts on that signal.** `decideOwnerLeftAction` closes the room
   outright (`CLOSE_IMMEDIATE`) when the room is ACTIVE and no non-owner is
   seated — which is precisely the shape of a freshly-opened room.
3. **The only thing preventing (2) is a presence check that can never succeed.**
   The re-check reads `rooms/{roomId}/presence/{ownerId}` where `ownerId` is the
   Firestore **uniqueId** (e.g. `10000005`), while the RTDB rule on that path is
   `auth.uid == $userId` — the Firebase **Auth uid** namespace. Both clients key
   their presence write by uniqueId, so **every presence write is rejected**, the
   node the server looks for never exists, and the owner always reads as absent.

Proven against the real RTDB emulator before any code was changed:

```
WRITE by uniqueId : DENIED   (permission_denied)   <-- presence never exists
WRITE by auth.uid : ALLOWED
SERVER lookup by ownerId(uniqueId) exists = false  <-- always
SERVER lookup by firebaseUid        exists = true
```

The irony is documented in the codebase itself: `PresenceService.armOwnerLeftSignal`
carries an explicit warning that the value "must be the Firebase Auth uid, NOT the
Firestore uniqueId… passing the uniqueId here would cause the rule-layer write to
fail silently" (learned in PR #1001). That lesson was never applied to
`setPresence`, three lines above it, which is governed by an identical rule.

**Presence is not degraded — it is entirely non-functional**, so the blast radius
is wider than the reported symptom. Two further consequences, both security-relevant:

- `POST /rooms/:id/owner-away` reads owner presence in the same wrong namespace, so
  `ownerPresent` is always false and **any participant can force a live room into
  OWNER_AWAY** while the owner is sitting in it.
- `POST /rooms/:id/disconnect-user` reads target presence the same way, so **any
  participant can evict any other participant** by asserting they disconnected.
- Client-side, `ActiveRoomManager`'s presence monitor sees an always-empty presence
  set, marks every participant absent, and drives `setOwnerAway` /
  `removeDisconnectedUser` after the grace window.

Why no test caught it: `owner-left-orchestrator.test.js` **injects** `presenceChecker`,
so the test decides what "present" means. A double accepts any argument, and the
defect is in the argument — the lookup key. Worse, two suites actively pinned the
defect as the contract (`expect(rtdb.ref).toHaveBeenCalledWith('rooms/room-1/presence/1')`,
`expect(presenceChecker).toHaveBeenCalledWith('room-1', 'owner-1')`), so the bug was
load-bearing on green.

## Acceptance Criteria

### Happy path

- [ ] An owner opening a room, present in RTDB, receives `NOOP` for the arming
      signal and the room remains `ACTIVE` with the owner still seated.
- [ ] A room with a seated non-owner also survives while the owner is present.
- [ ] A client's presence write is ACCEPTED by the RTDB rules (keyed by Firebase
      Auth uid, valued with the writer's uniqueId).

### Error paths

- [ ] An owner whose Firebase uid cannot be resolved (legacy room, no users doc)
      yields `NOOP` with reason `owner-identity-unresolved` — the room is never
      closed on a failed lookup.
- [ ] A resolved uid that is not RTDB-path-safe yields `NOOP` with reason
      `owner-firebase-uid-invalid` and no presence read is attempted.
- [ ] A presence read failure never authorises a destructive action:
      `isRoomMemberPresent` fails safe to "present".

### Edge cases

- [ ] A genuinely departed owner alone in the room still closes it
      (`CLOSE_IMMEDIATE`) — the fix must not strand empty rooms open.
- [ ] A genuinely departed owner with a seated non-owner still transitions to
      `OWNER_AWAY`, not `CLOSED`.
- [ ] A legacy presence node written as boolean `true` (no uniqueId) identifies
      nobody and is reported absent rather than guessed at.

### Performance

- [ ] The owner's uid resolution costs no extra Firestore read in the common case
      (`ownerFirebaseUid` is denormalised on the room at create-time); the users
      lookup is a legacy fallback only.

### Security

- [ ] A user cannot claim presence under any key but their own `auth.uid`.
- [ ] A user cannot clear another user's presence (clearing it is how you would
      evict them).
- [ ] A non-owner cannot force `OWNER_AWAY` on a room whose owner is present.
- [ ] A participant cannot evict another participant who is present.
- [ ] The RTDB path-safety guard applies to the value actually interpolated into
      the presence path (the Firebase uid), not only to `ownerId`.

### UX

- [ ] Opening a room results in a room that stays open; no visible flicker of
      close/reopen.

### i18n

- N/A — no user-facing strings are added or changed; the defect is in identity
  resolution between the client, the RTDB rules, and the API.

### Observability

- [ ] `NOOP` outcomes carry a distinguishable `reason`
      (`owner-identity-unresolved` vs `owner-firebase-uid-invalid` vs
      `writer-not-owner`) so a room that declines to close can be explained.
- [ ] A presence write skipped for lack of a Firebase session is logged rather
      than failing silently.

## BDD Scenarios

**Scenario: the owner opens a room and it stays open**

- **Given** a room that has just been created, with its owner seated and nobody else present
- **And** the owner's client has registered its presence
- **When** the client arms the owner-left signal as part of entering the room
- **Then** the server takes no action on the room
- **And** the room is still open, with the owner still in their seat

**Scenario: the owner really does leave an empty room**

- **Given** a room whose owner is no longer present anywhere
- **And** nobody else is seated in it
- **When** the owner-left signal is processed
- **Then** the room is closed and every seat is emptied

**Scenario: the owner leaves, but other people are still seated**

- **Given** a room whose owner is no longer present
- **And** at least one other person is seated
- **When** the owner-left signal is processed
- **Then** the room is marked as owner-away rather than closed
- **And** the time the owner left is recorded

**Scenario: someone tries to claim they are present as another person**

- **Given** a signed-in person
- **When** they attempt to register presence under someone else's identity
- **Then** the attempt is refused

**Scenario: someone tries to end a room they do not own**

- **Given** a room whose owner is present in it
- **When** another participant asks the server to mark the owner as away
- **Then** the request is refused and the room is unchanged

**Scenario: someone tries to remove a participant who is still connected**

- **Given** two participants in a room, both connected
- **When** one asks the server to remove the other as "disconnected"
- **Then** the request is refused and nobody loses their seat

**Scenario: the system cannot tell who the owner is**

- **Given** an older room that does not record its owner's sign-in identity
- **And** that owner has no profile record to fall back on
- **When** an owner-left signal is processed for that room
- **Then** the room is left exactly as it was
- **And** the reason it was left alone is recorded

## Test Plan

**Red (written first, all failed before the fix):**

- `express-api/tests/utils/owner-left-presence-namespace.test.js` — REAL Firestore
  + REAL RTDB emulators + the REAL `buildPresenceChecker` and `handleOwnerLeftSignal`.
  Presence is written through a **rules-enforced** authenticated client (not the
  Admin SDK, which bypasses rules), so the test fails if EITHER the rule or the
  server lookup regresses. 7 tests. Initially RED on:
  `owner opens a room and is present` (got `CLOSE_IMMEDIATE`),
  `a room with a seated non-owner also survives` (got `OWNER_AWAY`),
  `a room whose owner identity cannot be resolved is left alone` (got `CLOSE_IMMEDIATE`).
- `express-api/tests/rtdb-rules/room-presence-rules.test.js` — REAL RTDB emulator,
  13 tests pinning the namespace contract: uniqueId keys DENIED, uid keys allowed,
  no cross-user write or clear, value shape bounded.

**Green / regression:**

- `express-api/tests/routes/room-mutations.test.js` — 3 new tests: owner-away reads
  presence in the uid namespace (and explicitly NOT the uniqueId namespace); an
  unresolvable owner is treated as present; a present target cannot be evicted.
- `express-api/tests/utils/owner-left-orchestrator.test.js` — assertions that pinned
  the old namespace corrected; new tests for a non-path-safe `ownerFirebaseUid` and
  for the unresolvable-owner fail-safe.
- `app/src/test/java/com/shyden/shytalk/data/remote/PresenceServiceTest.kt` — 7 new
  tests for `presenceUniqueId` / `roomPresenceContains` (value-based correlation,
  legacy boolean nodes, key-shaped uniqueIds refused).

**Mutation-verified** (each mutant reintroduced the bug and was killed):

- server: `isRoomMemberPresent` → `isUserPresent(roomId, uniqueId)` — 3 tests failed.
- rules: `.write` uid binding dropped — 3 tests failed; `.validate` back to
  `isBoolean()` — 4 tests failed.
- Kotlin: `roomPresenceContains` matching on `it.key` — 2 tests failed.

**Frameworks run:** Express/Jest (full suite), eslint `--max-warnings=0`, prettier,
`:app:compileLocalDebugUnitTestKotlin`, `:app:testLocalDebugUnitTest`,
`:shared:compileKotlinIosArm64`.

**Owed before merge:** the real-device gauntlet (open a room on a real Android
device and on a real iPhone, confirm it stays open, and confirm a genuine departure
still closes it). Devices were unavailable in the session that wrote this fix.

## Out of Scope

- **Typing indicators carry the identical defect.** `conversations/{convId}/typing/{userId}`
  has the same `auth.uid == $userId` rule and the same uniqueId-keyed client write,
  so typing is also silently denied. It needs a different fix (the observer reads a
  named other user's node, so it genuinely needs the uniqueId namespace) and is
  filed separately rather than destabilising a P0 room fix.
- Removing the immediate `setValue` from `armOwnerLeftSignal`. Arming on entry is
  what turns a presence gap into a room closure, so it remains a latent hazard even
  with presence fixed; addressed separately so this change stays minimal.
- Migrating legacy boolean presence nodes. They expire on disconnect, so the
  population drains on its own.

## Dependencies

- Local emulator stack (Firestore 8080, RTDB 9000, Auth 9099) for the real-services
  tests.
- `database.rules.json` must be redeployed for the fix to take effect in dev/prod —
  the rule change is what permits the corrected client write.

## Risks & Mitigations

- **Risk:** presence keys change namespace, so any consumer comparing presence
  against room membership breaks.
  **Mitigation:** the uniqueId travels as the node VALUE, so `observeRoomPresence`
  still yields uniqueIds and every existing consumer is unchanged. Covered by the
  new Kotlin tests.
- **Risk:** the rules `.validate` change (boolean → bounded string) rejects writes
  from app versions still in the wild.
  **Mitigation:** those clients key by uniqueId and are already rejected, so there
  is no working behaviour to lose.
- **Risk:** an unresolvable owner now blocks a legitimate close, leaving a dead room
  open.
  **Mitigation:** deliberate — an open dead room is recoverable; a destroyed live
  room is not. The `owner-identity-unresolved` reason makes the case observable, and
  the OWNER_AWAY countdown plus the lazy stale-room reaper still close genuinely
  abandoned rooms.
- **Risk:** the fix is verified at the service and rules layers but not yet on real
  devices.
  **Mitigation:** both platforms compile; the client change is confined to the two
  presence services; the gauntlet is recorded above as owed before merge.

## Definition of Done

- [ ] Every AC above is met and covered by a named test.
- [ ] Express suite green; eslint `--max-warnings=0`; prettier clean.
- [ ] Android + iOS compile; Kotlin unit tests green.
- [ ] Mutation checks recorded for each layer (server, rules, client).
- [ ] Real-device gauntlet green: a room opened on a real Android device and a real
      iPhone stays open, and a genuine departure still closes it.
- [ ] `database.rules.json` deployed to dev and verified before the dev gauntlet.
- [ ] Follow-up story filed for the typing-indicator defect.
- [ ] `code-reviewer` 100% clean.

## Notes

**2026-07-31** — Diagnosed from the report "a room closes itself almost immediately".
Root cause found by reading the owner-left chain, then PROVEN against the real RTDB
emulator before any change (probe output quoted in `## Why`). The decisive tell was
that `decideOwnerLeftAction` closes a room outright when the owner is alone, which
is exactly a freshly-opened room, leaving the presence re-check as the sole guard —
and that guard reads a path no client is permitted to write.

Two suites were found asserting the defect as the expected contract. Both were
corrected rather than worked around; the corrected assertions now also assert the
NEGATIVE (the old namespace must NOT be used) so a regression cannot pass quietly.

Test-isolation hazard found and fixed while writing the regression suite: room ids
were stable across runs, so a leaked RTDB node from one run was inherited by the
next and silently inverted a "room must close" assertion. Ids now carry a per-run
nonce — leaks became impossible rather than unlikely.

The `firestore-rules` suites failed during the full-suite run with
`loadFirestoreRules` 500 UNKNOWN; that is emulator exhaustion, not a rules
regression. Confirmed by restarting the stack — 23/23 passed immediately after,
with no code change.

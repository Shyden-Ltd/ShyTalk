---
id: SHY-0103
status: Draft
owner: claude
created: 2026-06-15
priority: P1
effort: M
type: bug
roadmap_ids: []
public: false
mvp: false
---

# SHY-0103: RTDB room-presence rule checks `auth.uid` but the app keys presence by Firestore `uniqueId` → PERMISSION_DENIED → rooms close immediately

## User Story

As a **signed-in member who creates or joins a voice room**, I want **my presence in the room to register**, so that **the room stays open, others see me, and the voice session connects instead of the room closing within a minute**.

## Why

During the OkHttp-5 DEV gauntlet (#1429) on a real Android device against `shytalk-dev`, persona Alice (P-02, Firestore `uniqueId` 50000010, cohort adult) created a room and it was force-closed within <1 minute ("Room Closed · Open for < 1m"). Root cause from logcat:

```
RepoOperation: setValue at /rooms/{roomId}/presence/50000010 failed: DatabaseError: Permission denied
RepoOperation: onDisconnect().setValue at /rooms/{roomId}/presence/50000010 failed: DatabaseError: Permission denied
RepoOperation: setValue at /ownerLeft/{roomId} failed: DatabaseError: Permission denied
LiveKitVoiceService: Voice connection failed: Job was cancelled   (room torn down)
```

The presence node is **correctly** keyed by the Firestore `uniqueId` (`RtdbPresenceService.kt:72` writes `rooms/$roomId/presence/$userId` with `userId = 50000010`; the presence listener at `:109` maps `snapshot.children.keys` back to participant uniqueIds). But the RTDB rule (`database.rules.json:8`) gates the write with:

```json
"$userId": { ".write": "auth != null && auth.uid == $userId" }
```

`auth.uid` is the **Firebase Auth uid** — a *different identity namespace* from the Firestore `uniqueId` (CLAUDE.md: "Two identity namespaces exist for every user"). So `presence/50000010` (uniqueId) is compared against the caller's Firebase Auth uid (a different string) → never equal → `PERMISSION_DENIED`. The rest of the app already uses the custom claim for this exact purpose — `firestore.rules` checks `request.auth.token.uniqueId` — but the RTDB rules were never migrated to that model and still check the raw `auth.uid`.

Because this is a **rules-vs-code namespace mismatch** (not data-dependent), it is independent of OkHttp (RTDB uses its own websocket transport; reproduces on OkHttp 4) and is expected to affect **every environment whose deployed RTDB rules match `database.rules.json`** — making it a likely core-feature (voice rooms) breakage, hence P1.

## Acceptance Criteria

### Happy path
- [ ] A signed-in member (custom claim `uniqueId` present) creating a room can write `rooms/{roomId}/presence/{uniqueId}` without `PERMISSION_DENIED`; the room stays open and LiveKit voice connects.
- [ ] A second member joining the same room registers presence; both appear in the presence listener's `Set<String>` (keyed by uniqueId).
- [ ] `onDisconnect().removeValue()` on the presence node is accepted (cleanup registers without denial).

### Error paths
- [ ] A caller MUST NOT write a presence node for a `uniqueId` that is not their own (`auth.token.uniqueId != $userId` → deny). Adversarial `assertFails`.
- [ ] An unauthenticated caller is denied presence read and write (existing `auth != null` gate preserved).
- [ ] `ownerLeft/{roomId}` write is denied unless the written value matches the caller's owner identity (see Edge cases for which identity).

### Edge cases
- [ ] `ownerLeft/{roomId}`: reconcile identity. The app writes `ownerFirebaseUid` (the Firebase Auth uid) at `RtdbPresenceService.kt:93`, while the rule checks `newData.val() === auth.uid`. Confirm whether the observed `ownerLeft` denial is a cascade of the presence failure or a genuine second mismatch; if genuine, fix consistently (both writes must agree with whatever identity the rule validates).
- [ ] Presence re-establishment on RTDB reconnect (`RtdbPresenceService.kt:86-94`) is accepted after a connectivity blip.
- [ ] Room with the owner still present is NOT reaped by the owner-left/stale-room path purely because presence failed to register.

### Performance
- [ ] N/A — security-rule correctness change; no added round-trips. (Confirm room-open latency is unaffected: presence write should succeed on first attempt, removing the retry/teardown churn currently caused by the denial.)

### Security
- [ ] The fix MUST NOT widen access: presence remains writable only by the owning identity. Aligning the rule to `auth.token.uniqueId == $userId` ties the write to a signed custom claim (same trust basis `firestore.rules` already relies on). Adversarial `assertFails` proves a forged/foreign `uniqueId` is rejected.
- [ ] Decision recorded (in Notes) on the chosen identity for presence (uniqueId via `auth.token.uniqueId`) and for `ownerLeft` (Firebase Auth uid via `auth.uid`, if that is genuinely the design), with rationale. **RTDB security-rule change requires operator checkpoint before deploy (parity with the firestore.rules checkpoint rule in CLAUDE.md).**

### UX
- [ ] Creating/joining a room no longer results in an unexpected "Room Closed · Open for < 1m"; the room persists and is usable.
- [ ] If a genuine presence denial occurs (real auth failure), the UI surfaces an actionable state, not a silent room-close.

### i18n
- [ ] N/A — server-side rule change; no new user-facing strings (unless an error state is added; if so, all 20 locales updated).

### Observability
- [ ] The presence failure path logs a distinguishable, greppable warning (it currently surfaces only as generic `RepoOperation … Permission denied`), so a future rules regression is detectable in logcat/console.

## BDD Scenarios

**Scenario: owner registers presence and room stays open**
- **Given** an authenticated member whose token carries custom claim `uniqueId`
- **And** they create a room
- **When** the client writes `rooms/{roomId}/presence/{uniqueId}`
- **Then** the write succeeds (no PERMISSION_DENIED)
- **And** the room remains open and the voice session connects

**Scenario: foreign uniqueId presence write is denied**
- **Given** an authenticated member with `uniqueId` = A
- **When** they attempt to write `rooms/{roomId}/presence/{B}` where B ≠ A
- **Then** the write is denied

**Scenario: joiner presence appears in the presence set**
- **Given** an open room with the owner present
- **And** a second authenticated member joins
- **When** the second member writes their presence node
- **Then** the write succeeds
- **And** both uniqueIds appear in the room presence listener's set

**Scenario: unauthenticated presence write denied**
- **Given** an unauthenticated client
- **When** it attempts any `rooms/{roomId}/presence/{userId}` write
- **Then** the write is denied

## Test Plan

**RED (write first, must fail against current rules):**
- NEW `express-api/tests/rtdb-rules/presence-rules.test.js` (using `@firebase/rules-unit-testing` RTDB harness) — `assertSucceeds` writing `rooms/r1/presence/{myUniqueId}` for a token whose `uniqueId` claim == the path key; `assertFails` for a foreign uniqueId; `assertFails` unauthenticated. These FAIL today because the rule checks `auth.uid`, not `auth.token.uniqueId`.
- NEW `express-api/tests/rtdb-rules/owner-left-rules.test.js` — pin the `ownerLeft/{roomId}` write contract for the owner identity actually written by `RtdbPresenceService` (resolve the Edge-case ambiguity first).
- If no RTDB-rules harness exists yet, stand it up against the real RTDB emulator (`local/start.sh`) — real backend, no mocks (EPIC-0003).

**GREEN:**
- Change `database.rules.json` presence `.write` to `auth != null && auth.token.uniqueId == $userId` (and reconcile `ownerLeft` per the Edge-case decision). All RED tests pass; existing RTDB-rule expectations stay green.

**Gauntlet (Pre-Merge Protocol — runtime behaviour):**
- Real Android + real iOS: create a room → presence registers → room stays open → voice connects; second device joins → both present. State-verify the RTDB `rooms/{id}/presence` node. Run local then dev.
- Confirm scope on local + dev (and reason about prod) — this is a rules-vs-code mismatch, so capture whether prod RTDB rules carry the same `auth.uid` check.

## Out of Scope

- The OkHttp 5 adoption (#1429) — orthogonal; this finding does not block it (RTDB ≠ OkHttp).
- The Firestore `list`-rule denial (SHY-0102) — separate rules surface, separate root cause.
- Broader RTDB rules refactor beyond `rooms/{id}/presence`, `rooms/{id}/events`, and `ownerLeft`.

## Dependencies

- `database.rules.json` (`rooms/{roomId}/presence/{userId}` rule L8; `ownerLeft/{roomId}` rule L39).
- `app/src/main/java/com/shyden/shytalk/data/remote/RtdbPresenceService.kt` (presence write L72-73, reconnect L86-94, ownerLeft L91-94).
- Custom-claim minting that puts `uniqueId` on the token (same claim `firestore.rules` consumes) — must be present for all sign-in paths (persona + Google + Apple).
- `@firebase/rules-unit-testing` RTDB support + the local emulator stack.
- Relates to the in-progress "Room mutations → server-side authz" plan (presence may move server-side there; coordinate so this fix isn't superseded).

## Risks & Mitigations

- **Risk:** widening write access while fixing the denial. **Mitigation:** rule ties the write to the signed `uniqueId` claim; adversarial `assertFails` for foreign uniqueId; operator checkpoint on the rules change; fail-closed default.
- **Risk:** the `uniqueId` claim is absent on some sign-in path → presence still denied for those users. **Mitigation:** AC verifies presence across persona + real sign-in; confirm claim presence in the token before deploy.
- **Risk:** `ownerLeft` uses a different identity than presence — a blanket swap could break the owner-left signal. **Mitigation:** resolve the Edge-case ambiguity with a dedicated test before changing the `ownerLeft` rule.

## Definition of Done

- RED tests written and failing first, then green; existing RTDB-rule tests stay green.
- Chosen identity model documented + operator-approved (RTDB rules change).
- Rooms create/join → presence registers → room stays open + voice connects on real Android + real iOS, local then dev; RTDB state agrees; foreign-uniqueId write still denied.
- Released in a `vX.Y.Z` cut with `released_in:` set.

## Notes (running log)

- 2026-06-15 — Filed from the OkHttp-5 DEV gauntlet (#1429). Root-caused to an RTDB rules-vs-code identity-namespace mismatch: presence node keyed by Firestore `uniqueId` (50000010) but `database.rules.json:8` checks `auth.uid` (Firebase Auth uid). Definitively NOT OkHttp (RTDB transport; reproduces on OkHttp 4). Confirmed on dev with persona Alice (UID 50000010). The rest of the app uses `auth.token.uniqueId` (see `firestore.rules`); the RTDB rules appear un-migrated to that model. `ownerLeft` denial observed too — flagged as Edge case to disambiguate (cascade vs genuine second mismatch). Security-sensitive → rule change needs operator checkpoint per CLAUDE.md. Evidence log: `/tmp/manual-qa-okhttp5-dev-cycle.md`.

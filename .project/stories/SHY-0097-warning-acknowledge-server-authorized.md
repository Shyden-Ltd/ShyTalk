---
id: SHY-0097
status: In Progress
owner: claude
created: 2026-06-13
priority: P1
effort: M
type: bug
roadmap_ids: []
pr:
mvp: false
---

# SHY-0097: Warning-acknowledge silently fails — make it server-authorized

## User Story

**As** a warned user tapping "I Understand & Accept" on the moderation warning screen,
**I want** the acknowledgement to actually clear my active warning and let me back into the app,
**So that** I'm not trapped on the warning screen forever (today the button does nothing — the screen re-appears and `hasActiveWarning` never clears).

## Why

Found by live real-device testing during SHY-0096's gauntlet (2026-06-13). Confirmed root cause (not assumed):

- The Android (`app/src/main/java/com/shyden/shytalk/data/repository/UserRepositoryImpl.kt:387`) and iOS (`IosUserRepositoryImpl.kt:428`) `acknowledgeWarning` do a **direct client Firestore write** `users/$userId.update(hasActiveWarning=false, warningReason=null)`.
- `firestore.rules` (lines 57-69, `match /users/{uniqueId}`) **deny** any client update whose `affectedKeys()` touch the protected moderation fields — and that list includes `hasActiveWarning`, `warningReason`, `warningCount`. So the write is rejected with `PERMISSION_DENIED`. This protection is **correct**: a user must not be able to clear their own moderation warning client-side.
- `SharedNavGraph.kt:789-796` `onAccept` **ignores the `Resource` result** (fire-and-forget): it calls `acknowledgeWarning` then navigates to Main regardless. The reactive gate (`SharedNavGraph.kt:127`) then sees `hasActiveWarning` still `true` and bounces the user back to the warning screen → **stuck**, with no error shown (silent failure).

**Operator decision (2026-06-13):** make acknowledge **server-authorized** — a new Express endpoint clears the warning (the only place allowed to touch the protected fields), the client **awaits** the result and surfaces errors (no silent fail). Mirrors the existing `requestAccountDeletion` pattern (`api.post(...)`).

This is a **safety/moderation** bug (a warned user is trapped; and the security model for clearing warnings was never actually exercised). Verified-real, no stubs.

## Acceptance Criteria

### Happy path
- [ ] A new authenticated Express endpoint (e.g. `POST /api/users/:uniqueId/acknowledge-warning`) clears the caller's active warning **server-side** (Admin SDK, bypassing the client rules): sets `hasActiveWarning=false`, `warningReason=null`, `warningAcknowledged=true`, and **preserves `warningCount`** (moderation history is not erased).
- [ ] The endpoint authorizes the caller (the authenticated user may acknowledge **only their own** warning; admin/officia not required).
- [ ] `UserRepositoryImpl.acknowledgeWarning` (Android) + `IosUserRepositoryImpl.acknowledgeWarning` (iOS) call this endpoint (not a client Firestore write) and return the real `Resource<Unit>` (Success/Error).
- [ ] `SharedNavGraph` `onAccept` **awaits** the result: on Success → navigate to Main; on Error → **stay on the warning screen + show an error** (retry possible). No optimistic navigate-then-bounce.
- [ ] After a successful acknowledge, the reactive gate sees `hasActiveWarning=false` and does **not** re-navigate to the warning screen.

### Error paths
- [ ] Endpoint returns 4xx for: unauthenticated, acknowledging another user's warning, or a user with no active warning (idempotent-safe: acknowledging when none active is a no-op success or a clear 4xx — pick one + test it).
- [ ] Client `acknowledgeWarning` surfaces a network/endpoint failure as `Resource.Error` (no swallow); `onAccept` keeps the user on the warning screen + shows the error.
- [ ] A `PERMISSION_DENIED` can no longer occur for the legitimate flow (the write is server-side); the old client-write path is removed.

### Edge cases
- [ ] Acknowledging twice (double-tap / retry) is safe (idempotent — second call is a no-op success, no error to the user).
- [ ] A second-strike / suspension state is unaffected (acknowledge only clears an active **warning**, never a suspension).
- [ ] `warningCount` is preserved across acknowledge (a later strike still escalates correctly).

### Performance
- [ ] Acknowledge round-trip completes within a normal API budget (~1-2s on dev); the button shows a busy/disabled state while in flight so it can't be double-fired into an inconsistent state.

### Security
- [ ] The Firestore rule protecting `hasActiveWarning`/`warningReason`/`warningCount` from client writes is **unchanged** (still denied) — the endpoint is the only authorized clearer (Admin SDK). A user cannot clear their own warning by any client path.
- [ ] The endpoint validates the caller owns the `uniqueId` (no clearing others' warnings).

### UX
- [ ] On failure the user sees an actionable error and stays on the warning screen (not silently bounced); on success they reach Main.

### i18n
- [ ] Any new error string (acknowledge failed) is added to all 20 locale files.

### Observability
- [ ] The endpoint logs the acknowledge (uid + outcome) for moderation audit; client logs an Error on failure (not a silent swallow).

## BDD Scenarios

**Scenario: acknowledge clears the warning server-side**
- **Given** Raul has an active first-strike warning (`hasActiveWarning=true`, `warningCount=1`)
- **When** Raul taps `warning_acknowledgeButton` on the real device
- **Then** within 3000ms `users/<raul>` has `hasActiveWarning=false`, `warningAcknowledged=true`, and `warningCount` still `1`
- **And** the app navigates to the rooms tab and does not bounce back to the warning screen

**Scenario: a client cannot clear its own warning directly (security preserved)**
- **Given** an authenticated client
- **When** it attempts a Firestore `update(hasActiveWarning=false)` on its own user doc
- **Then** the write is denied by the rules (`PERMISSION_DENIED`)

**Scenario: acknowledge endpoint failure is surfaced, not swallowed**
- **Given** the acknowledge endpoint returns an error (e.g. network down)
- **When** Raul taps acknowledge
- **Then** the app stays on the warning screen and shows an error (no navigate-to-Main-then-bounce)

**Scenario: a user cannot acknowledge another user's warning**
- **Given** user A is authenticated
- **When** A calls `POST /api/users/<B>/acknowledge-warning`
- **Then** the endpoint responds 403 and B's warning is unchanged

## Test Plan

Touches Express (Node) + KMP (Kotlin) → **full Pre-Merge Testing Protocol**. Real backends only (local Firebase emulator, real device); no mocks.

**MARK-AS-FAILED (the bug-capturing tests — RED now, GREEN after the fix):**
- **Journey j11** (`journey-tests/j11-harassment-moderation-cycle.feature:74-77`) — "Raul acknowledges the warning — flag clears" asserts `users/50000050.hasActiveWarning == false` after tapping `warning_acknowledgeButton`. This **currently FAILS** on the real device (verified 2026-06-13: BEFORE=true, AFTER=true). It is the canonical failing test this ticket turns green.
- **Journey j10** (`journey-tests/j10-mid-room-warning.feature`) — the mid-room warning→acknowledge path, same failure.

**Tests to RUN during the fix (per framework):**
- **Express/Node (Jest), real emulator** — new `express-api/tests/<route>/acknowledge-warning.test.js`: authed self-acknowledge clears `hasActiveWarning`/`warningReason`, sets `warningAcknowledged`, preserves `warningCount`; 401 unauth; 403 other-user; idempotent re-ack. RED→GREEN.
- **Firestore rules test** — assert a client `update(hasActiveWarning=false)` is still DENIED (security unchanged).
- **Kotlin unit / androidTest** — `acknowledgeWarning` calls the endpoint + returns the real Resource; migrate `app/src/androidTest/.../WarningAcknowledgmentTest.kt` to assert the **real** emulator flag-flip (off `FakeAuthRepository`) — this is also EPIC-0003 Phase-2 fake-migration for this surface.
- **iOS** — `IosUserRepositoryImpl.acknowledgeWarning` calls the endpoint.
- **Device gauntlet** — j10 + j11 GREEN on the real Android + real iPhone (the flag-flip surfaced + verified).
- **eslint/detekt/ktlint/iOS-compile** clean; SonarCloud gate.

## Out of Scope
- The warning-screen UI itself (correct; only `onAccept` result-handling changes).
- The popup-gating bug (separate ticket SHY-0098).
- Changing the moderation/strike escalation model (warningCount semantics unchanged).

## Dependencies
- Express API + Admin SDK (the only authorized clearer).
- The local emulator stack + real device (gauntlet).
- Blocks **SHY-0096**'s j10/j11 gauntlet (the persona-switch linchpin can't prove the warning journeys until this is fixed).

## Risks & Mitigations
- **Risk:** the endpoint over-permits (clears others' warnings). **Mitigation:** caller-owns-uniqueId check + a 403 test.
- **Risk:** removing the client write breaks iOS too. **Mitigation:** update both `UserRepositoryImpl` (Android) + `IosUserRepositoryImpl` (iOS) + iOS-compile + device test both.
- **Risk:** silent-failure regression (swallowing the Resource again). **Mitigation:** the error-path scenario + a unit test asserting `onAccept` does not navigate on Error.

## Definition of Done
- [ ] Server endpoint + client wiring (Android + iOS) + result-handling done; j10 + j11 GREEN on real devices; the bug-capturing tests flipped RED→GREEN; the Firestore-rules-deny test still green (security preserved).
- [ ] Pre-Merge Testing Protocol satisfied (all frameworks + both gauntlets) → `code-reviewer` 100% clean → judgment-merge.
- [ ] `released_in: vX.Y.Z` on the next release cut.

## Notes (running log)
- 2026-06-13 — Filed as a bug found during SHY-0096's real-device gauntlet. Root cause CONFIRMED (firestore.rules:57-69 deny client writes to hasActiveWarning/warningReason; the client-write acknowledge is rejected + the Resource is ignored → user stuck). Operator chose **server-endpoint** behaviour (vs relaxing rules / record-only). j11:74-77 is the canonical failing test. Blocks SHY-0096.
- 2026-06-14 — **Split out of the SHY-0096 device-gauntlet bundle** into its own branch `story/SHY-0097-warning-acknowledge-server-authorized` (operator: "split now, then test each" → one PR per SHY), off `origin/main`. Carries the RED spec (j11 `@known-failure-SHY-0097`) + the GREEN fix (Express `users.js` server-authorized acknowledge endpoint, `UserRepositoryImpl`, `SharedNavGraph`, `IosUserRepositoryImpl`). The `SharedNavGraph` hunk here is disjoint from SHY-0098's (verified content-identical post-split). Split verified lossless; bundle preserved as `backup/shy-bundle-pre-split`. Nothing pushed.
- 2026-06-14 — **`@known-failure-SHY-0097` tag KEPT** (operator: "keep it until green — don't easily dismiss something; it needs to be resolved and verified"). The server-side fix is in place, but the tag stays on j11 until the warning-acknowledge DB-flip is proven GREEN on the real Android + real iPhone. Only after that on-device confirmation is the tag removed (in this SHY's PR). Do not strip it on the strength of the code change alone.
- 2026-06-14 — **Test backfill: the endpoint shipped without its DoD-named tests; added now.** The diff carried the `users.js` acknowledge endpoint + client wiring + the j11 journey change, but no Jest unit test and no Firestore-rules test (a verified gap). Investigated the harness: every existing users-route Jest test mocks `src/utils/firebase` (the legacy pattern). Operator clarified the rule (2026-06-14): **"the only thing that can use mocks is the unit tests; everything else should be real, no stubs or fakes."** Applied that: added **`express-api/tests/routes/acknowledge-warning.test.js`** (mock-based UNIT test, 7 cases — happy/`has_active_warning` snake-case fallback/idempotent-no-op/403 owner-guard/400 bad-param/404 missing/500 Firestore-error; asserts the exact update payload AND that `warningCount` is never written) + **`acknowledge-warning-rules-static.test.js`** (9 cases — a source-scan unit guard that the `users/{uniqueId}` update rule keeps the 6 warning-field variants in the client-write deny-list + the negated-`affectedKeys().hasAny` shape + the `firebaseUid==auth.uid` owner gate). **Verified:** full express-api jest **12224/12224 green** (suite +16); eslint clean; prettier clean. **The REAL end-to-end proof remains the j11 device journey** (real device → real Express → real emulator) — these unit tests are the fast CI guard, NOT a substitute. **Deferred to EPIC-0003:** a behavioral real-emulator rules test + the CI real-emulator jest *lane* (the backend jest job `test-backend.yml` runs with no emulator + only express-api deps; standing up that lane in `integration-tests.yml` is cross-cutting infra, out of scope for this focused PR). A real-emulator route test was prototyped + proven green locally during investigation, then set aside per the operator's "unit tests mock; don't overbuild" steer.

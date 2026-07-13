---
id: SHY-0185
status: In Progress
owner: claude
created: 2026-07-13
priority: P0
type: bug
effort: S
roadmap_ids: []
mvp: true
---

# SHY-0185: iOS app crashes (SIGABRT) when the user-flags Firestore listener errors after sign-in

## User Story

**As** a ShyTalk user on iOS,
**I want** the app to stay running when a background real-time listener hits a transient error,
**So that** a Firestore rules denial or a momentary network drop degrades gracefully instead of crashing me out of the app right after I sign in.

## Why

Root-caused 2026-07-13 from 20 on-device crash reports (`idevicecrashreport`, all `EXC_CRASH SIGABRT`). The crashing coroutine's `lastExceptionBacktrace` is a `dev.gitlive.firebase.firestore.FirebaseFirestoreException` thrown by a `NativeDocumentReference$snapshots` listener. Traced to `IosUserRepositoryImpl.observeUserFlags()` — a direct gitlive Firestore `users/{uid}.snapshots` **Flow with no error handling** — collected by `SharedNavGraph.kt:116` `LaunchedEffect(uid){ …collect{} }` right after sign-in. When the listener errors (dev rules `PERMISSION_DENIED` / transient network), gitlive surfaces it as a **Flow exception**; nothing catches it, so it propagates to Kotlin/Native's final-resort handler → `SIGABRT` → the app drops to SpringBoard. This is the "app crashes after legal acceptance" that blocked the SHY-0151 device proof all session.

**Android does not crash** here: its `addSnapshotListener` callback does `if (error != null …) return`, swallowing the listener error. This story gives the iOS `.snapshots` Flow the same safety. (The deeper fix — never touch Firestore from the client, route via the API — is [[feedback-no-direct-backend-all-via-api]] / EPIC-0006; this is the acute crash mitigation.)

## Acceptance Criteria

### Happy path
- [ ] A healthy `observeUserFlags` Flow still emits every real `UserFlags` snapshot unchanged (no behavioural regression when there is no error).

### Error paths
- [ ] When the underlying listener Flow throws (e.g. a `FirebaseFirestoreException` from a rules denial or network drop), the app does NOT crash; the observing collector receives a safe default `UserFlags()` (not-suspended, no-warning) instead of an unhandled exception.
- [ ] Emissions received before the error still reach the collector; only the error is replaced by the fallback.

### Edge cases
- [ ] A Flow that errors on its very first term (before any value) recovers to the single fallback value.
- [ ] The recovery helper is generic over the emitted type so it can protect other listener Flows without duplication.

### Performance
- [ ] The fix is a single terminal `catch` operator — no added allocation per emission, no polling, no retry loop (a retry on a persistent `PERMISSION_DENIED` would hot-loop).

### Security
- [ ] On a listener error the fallback is the SAFE state (`isSuspended=false`, `hasActiveWarning=false`) — a read error must NOT lock a user out or fabricate a warning; it fails OPEN for the user's own non-privileged flags, matching Android's existing swallow-the-error behaviour.

### UX
- [ ] N/A — no user-visible string or layout change; the observable difference is "no crash". A subsequent recomposition re-subscribes the listener, so live updates resume.

### i18n
- [ ] N/A — no user-facing copy.

### Observability
- [ ] N/A for this mitigation — the fallback is silent (parity with Android's silent swallow). The direct-Firestore access itself is tracked under EPIC-0006; adding structured logging belongs with that route-via-API work, not this crash stop-gap.

## BDD Scenarios

**Scenario: a listener error no longer crashes the app**
- **Given** the iOS app has signed in and is observing the current user's flags
- **When** the Firestore user-flags listener emits an error (rules denial or network drop)
- **Then** the app keeps running (no `SIGABRT`)
- **And** the flags collector receives a default `UserFlags()` (not-suspended, no-warning)

**Scenario: healthy updates are unaffected**
- **Given** the user-flags listener is delivering normal snapshots
- **When** a snapshot arrives with `isSuspended=true`
- **Then** the collector receives `UserFlags(isSuspended=true, …)` exactly as before (the recovery operator is transparent to non-error emissions)

**Scenario: values before an error are preserved**
- **Given** a listener Flow that emits one valid value then errors
- **When** it is observed through the recovery operator
- **Then** the collector receives the valid value followed by the fallback, in order

## Test Plan

**Red (fails before the fix):**
- `shared/src/commonTest/.../core/util/FlowRecoveryTest.kt` — `a flow that errors recovers to the fallback instead of throwing` (a `flow { emit(1); throw … }` collected via the new `recoverListenerErrors(99)` must yield `[1, 99]`, not throw). Fails to compile/pass until the helper exists.

**Green:**
- New `shared/src/commonMain/.../core/util/FlowRecovery.kt` — `fun <T> Flow<T>.recoverListenerErrors(fallback: T): Flow<T> = catch { emit(fallback) }`.
- `FlowRecoveryTest.kt` — (1) error → `[emitted…, fallback]`; (2) healthy flow → unchanged; (3) error-on-first-term → `[fallback]`.
- `IosUserRepositoryImpl.observeUserFlags` gains a terminal `.recoverListenerErrors(UserFlags())`.
- `:shared:jvmTest` green; `:shared:compileKotlinIosArm64` green.

**Device (the real proof — deferred to the SHY-0151 device gauntlet, iPhone-gated):** on a real iPhone, sign in as a persona whose user-flags read errors (or induce a transient rules denial) and confirm the app stays up + the SHY-0151 bind→lock→ban proof can now complete past sign-in.

## Out of Scope

- Routing `observeUserFlags` (and the other iOS `.snapshots` listeners) through the Express API — the systematic direct-backend-access fix is **EPIC-0006** ([[feedback-no-direct-backend-all-via-api]]).
- Retrying/re-subscribing the listener after an error to keep observing (Android relies on the SDK's internal retry; a KMP re-subscribe belongs with the API migration, not this stop-gap).
- The other unguarded iOS `.snapshots` Flows (`observeUsers`, economy/room/PM repos) — same latent risk, but this story fixes the CONFIRMED crash path; the helper is reusable for them under EPIC-0006.

## Dependencies

- None. Pure additive helper + a one-line change to one iOS impl.

## Risks & Mitigations

- **Recovery masks a real persistent error (user's flags never load).** → Acceptable for the safe non-privileged flags: Android already swallows the same error, and a recomposition re-subscribes. The proper observability lands with EPIC-0006.
- **`catch` swallowing a programming error (e.g. a bug in `.map`) rather than only listener errors.** → The `.map` here is trivial (null-safe casts with defaults) and cannot throw on valid data; the only realistic upstream throw is the listener error. The helper is placed terminally so it also covers the map, which is the desired safety.

## Definition of Done

- `recoverListenerErrors` helper + `FlowRecoveryTest` (3 cases) green; `IosUserRepositoryImpl.observeUserFlags` uses it; `:shared:jvmTest` + `:shared:compileKotlinIosArm64` green; ktlint + detekt clean; `code-reviewer` 100% clean; merged to develop; the SHY-0151 device proof re-run confirms the app no longer crashes after sign-in (device-gauntlet phase); released.

## Notes (running log)

- 2026-07-13 ~20:20 WIB — Filed from the SHY-0151 device-proof crash investigation (operator authorised the mitigation). Evidence: 20 `iosApp-2026-07-13-*.ips` crash reports (scratchpad/crash2), all SIGABRT via `FirebaseFirestoreException` from `NativeDocumentReference$snapshots` → `IosUserRepositoryImpl.observeUserFlags` (no catch) → `SharedNavGraph.kt:116` collect. Android impl (`app/src/main/.../UserRepositoryImpl.kt:189`) already swallows the error arg. Root fix = EPIC-0006 (route via API). Related history: [[project-shy0139-ios-crash-fix]].

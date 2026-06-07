---
id: SHY-0014
status: Draft
owner: claude
created: 2026-06-07
priority: P0
effort: M
type: bug
roadmap_ids: [G016]
pr:
---

# SHY-0014: Android/Ios RoomServiceController tests + FakeRoomLifecycleManager extraction

## User Story

As the ShyTalk operator, I want **`AndroidRoomServiceController` and `IosRoomServiceController` to have platform-specific tests in their respective `androidUnitTest` / `iosTest` source sets, exercising the `awaitLeaveCompletion` race + the cross-platform contract via a shared `FakeRoomLifecycleManager`**, so that voice-room lifecycle parity between Android and iOS is verified in CI rather than discovered via user-facing flakiness.

## Why

`RoomServiceController` is the platform-bridge layer between the shared `RoomLifecycleManager` (covered by SHY-0013) and the platform-specific voice service:

- **Android**: `AndroidRoomServiceController` (`app/src/main/java/com/shyden/shytalk/room/AndroidRoomServiceController.kt`) wraps `RoomService.kt` (foreground service) for the Android lifecycle.
- **iOS**: `IosRoomServiceController` (`shared/src/iosMain/kotlin/com/shyden/shytalk/room/IosRoomServiceController.kt`) wraps `IosLiveKitVoiceService.kt` for iOS.

Both implement the same contract but neither has direct tests. The race-sensitive `awaitLeaveCompletion` logic exists in both — if Android's wait completes correctly but iOS's doesn't (or vice versa), users see different behaviour on each platform.

Roadmap row G016 (line 62 of `.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md`):

> Sev: 🟠 Important. Test — RoomLifecycleManager platform impls. Location: `app/.../AndroidRoomServiceController.kt` + `shared/.../IosRoomServiceController.kt`. Gap: `awaitLeaveCompletion` race logic critical, untested. Fix: Platform-specific tests + FakeRoomLifecycleManager extraction. Scope: M.

Bumped to Tier 2 P0 under SHY-0032 because:

1. Voice rooms are ShyTalk's core product surface; race-induced phantom states are user-visible.
2. Cross-platform parity gaps are a class of bug that escapes pre-release testing because Android-only or iOS-only QA misses them.
3. Pre-public window is the cheap time to add the cross-platform contract test.

## Acceptance Criteria

### Happy path

- [ ] `shared/src/commonTest/kotlin/com/shyden/shytalk/room/RoomServiceControllerContractTest.kt` defines the shared contract: an abstract test class with ≥15 test cases that both Android + iOS platform tests extend.
- [ ] `shared/src/commonTest/kotlin/com/shyden/shytalk/room/fake/FakeRoomLifecycleManager.kt` is extracted — a deterministic test-double that platforms can drive in their tests + that the SHY-0013 unit tests can also reuse.
- [ ] `app/src/test/java/com/shyden/shytalk/room/AndroidRoomServiceControllerTest.kt` extends the contract; runs as `./gradlew :app:testDevDebugUnitTest --tests "*AndroidRoomServiceController*"`; passes.
- [ ] `shared/src/iosTest/kotlin/com/shyden/shytalk/room/IosRoomServiceControllerTest.kt` extends the contract; runs as `./gradlew :shared:iosX64Test --tests "*IosRoomServiceController*"`; passes.
- [ ] Cross-platform parity test: both implementations produce the same observable state-transition sequence given the same input sequence (verified via the shared contract).
- [ ] `awaitLeaveCompletion` test: assert it does NOT return before the underlying `leave()` flow completes; deterministic via `TestCoroutineScheduler`.

### Error paths

- [ ] `leave()` called when no room joined → both platforms throw the same exception type (e.g. `IllegalStateException`) with consistent message.
- [ ] `leave()` called twice → second call is idempotent (no-op or returns same result); no double-cleanup.
- [ ] Underlying voice service throws during `leave()` (e.g. LiveKit disconnect failure) → both platforms surface the error consistently; `awaitLeaveCompletion` completes (does not hang).
- [ ] Process death simulation: controller scope cancellation mid-leave → cleanup completes within 100ms; no orphaned subscriptions.
- [ ] `join()` called when already in another room → both platforms either (a) leave the current room first then join (sequential), or (b) reject with a typed error; test enumerates which.

### Edge cases (adversarial)

- [ ] **Race: leave-then-immediate-join** → both platforms resolve to the new room cleanly (no zombie state from the old room).
- [ ] **Race: join-then-immediate-leave** → both platforms either complete the join then leave OR cancel the join; both outcomes are documented + asserted.
- [ ] **Race: concurrent leaves from 10 coroutines** → both platforms resolve to IDLE exactly once; same as RoomLifecycleManager race in SHY-0013.
- [ ] **iOS-specific: app backgrounded mid-leave** → iOS controller honours the background-task budget; `awaitLeaveCompletion` doesn't violate the 30s iOS background-task limit.
- [ ] **Android-specific: foreground service stopped mid-leave** → cleanup completes before service-destroy; no lingering `MediaSession` etc.
- [ ] **Android-specific: notification removal during leave** → leave still completes (notification removal isn't synchronously coupled to leave success).
- [ ] **Cross-platform: simulated network blip during leave** → both platforms retry once + complete OR surface a typed retry-able error.

### Performance

- [ ] `awaitLeaveCompletion` returns within 100ms of underlying leave completion (no spurious delays) on both platforms.
- [ ] FakeRoomLifecycleManager state transitions in <1ms per call (deterministic, no real I/O).
- [ ] Full contract test (15 cases) runs in <10s per platform.

### Security

- [ ] Controller does NOT log roomId or userId at any level above DEBUG (privacy; voice-room participation is sensitive).
- [ ] `leave()` cannot be triggered from an untrusted external intent / URL scheme — verified by reading the public API surface; if exposed via intent-filter, the filter is internal-only OR requires permission.

### UX

- [ ] During leave, the UI's "leaving room" loader is observable (the controller emits a state observable that the VM can subscribe to).
- [ ] `awaitLeaveCompletion` failure modes surface as a typed event (not generic exception) so the VM can show a clear message.

### i18n

- [ ] N/A — controller is internal; user-facing strings live in the calling VM/screen.

### Observability

- [ ] State transitions logged at INFO: `Log.i("AndroidRoomService", "transition: $from → $to (roomId=$hashed_roomId)")` — roomId hashed for privacy.
- [ ] Crashlytics non-fatal on race-resolution timeouts (>500ms `awaitLeaveCompletion` indicates a real-world stall).
- [ ] Sonar coverage on both controllers ≥85%.

## BDD Scenarios

**Scenario: awaitLeaveCompletion deterministically waits for leave**

- **Given** an `AndroidRoomServiceController` mid-leave (leave dispatched, voice service still tearing down)
- **When** `awaitLeaveCompletion()` is called
- **Then** the call suspends until the voice service confirms teardown
- **And** the suspension is observed via `TestCoroutineScheduler` (not real-time sleep)
- **And** the same scenario passes on `IosRoomServiceController` (parity)

**Scenario: Cross-platform parity contract**

- **Given** the same input sequence: `join("A"), takeSeat(0), leave()`
- **When** both `AndroidRoomServiceController` and `IosRoomServiceController` process the sequence (with FakeRoomLifecycleManager as backend)
- **Then** both emit the same observable state-transition sequence
- **And** both have the same final state (IDLE)

**Scenario: Concurrent leaves resolve atomically on both platforms**

- **Given** a controller in JOINED state
- **When** `leave()` is called 10x concurrently
- **Then** the controller resolves to IDLE exactly once
- **And** only one underlying voice-service teardown is dispatched
- **And** this holds for both Android and iOS

**Scenario: iOS background-task budget honoured**

- **Given** `IosRoomServiceController` with a leave in progress
- **When** the app is simulated-backgrounded mid-leave
- **Then** cleanup completes within the iOS background-task budget (30s, but our impl should be <5s)
- **And** no `BGTaskScheduler` expiration warning emitted

**Scenario: Android foreground service stop during leave**

- **Given** `AndroidRoomServiceController` with a leave in progress
- **When** the foreground service is stopped (`stopService()`)
- **Then** leave completes cleanly
- **And** no `MediaSession` leak remains
- **And** the notification is removed

**Scenario: leave-on-no-room is idempotent**

- **Given** a controller in IDLE state (no room joined)
- **When** `leave()` is called
- **Then** it returns immediately without error (idempotent)
- **And** state remains IDLE

## Test Plan (TDD)

### Red

1. Locate `AndroidRoomServiceController.kt` + `IosRoomServiceController.kt` (verify paths via grep).
2. Extract `FakeRoomLifecycleManager` into commonTest if not already (probably need to create).
3. Add the shared contract test file in commonTest.
4. Add platform-specific extensions in androidTest + iosTest source sets.
5. Run `./gradlew :app:testDevDebugUnitTest --tests "*RoomServiceController*"` + `./gradlew :shared:iosX64Test --tests "*RoomServiceController*"` → RED on most cases.
6. Specific RED expectations:
   - Concurrent-leave atomicity likely RED on at least one platform.
   - Cross-platform parity contract test surfaces any subtle implementation drift.
   - iOS background-task budget test may RED if the impl doesn't yet honour `beginBackgroundTaskWithName:`.
   - Android foreground-service-stop test may RED if cleanup races the service destroy.

### Green

1. For each surfaced bug, fix in the platform-specific controller.
2. Re-run contract on both platforms → GREEN parity.
3. Sonar coverage ≥85% on both controllers.

## Out of Scope

- **Refactoring `RoomService.kt`** (Android foreground service) or `IosLiveKitVoiceService.kt` directly — only controller tests; underlying services are tested separately.
- **LiveKit integration tests** — out of scope; LiveKit itself is a vendor dependency we trust.
- **End-to-end voice-room journey** — covered by journey BDDs; this SHY is unit-level.
- **Adding new room features** — only test coverage.

## Dependencies

- **SHY-0013** (`RoomLifecycleManager` tests) — provides the shared substrate that the controllers wrap; FakeRoomLifecycleManager is extracted here for reuse.
- **SHY-0032** — process dependencies.
- Existing iosTest source set wiring (verify in `shared/build.gradle.kts`); if not wired, add (also flagged in SHY-0015's risks).
- `kotlinx-coroutines-test`.

## Risks & Mitigations

- **Risk:** iOS test source set isn't yet configured for full instrumented-test parity. **Mitigation:** if `iosX64Test` source set isn't wired, contribute the gradle config in this PR; reviewer agent verifies build.
- **Risk:** Real `RoomService` and `IosLiveKitVoiceService` are difficult to fake without significant test scaffolding. **Mitigation:** `FakeRoomLifecycleManager` provides a clean substitute at the LifecycleManager layer; the controllers under test mock down to that fake, not to the full voice stack.
- **Risk:** Contract test reveals real implementation drift between Android and iOS that requires production fix in both files. **Mitigation:** GOOD outcome — fix both; reviewer agent validates parity.
- **Risk:** Test concurrency is flaky in CI on iOS simulator. **Mitigation:** use `TestCoroutineScheduler` for deterministic time; mark genuinely-CI-resource-dependent tests as `@FlakyTest` only if proven (not for masking real races).

## Definition of Done

- [ ] Shared contract + FakeRoomLifecycleManager + both platform tests exist.
- [ ] All ~15 contract cases pass on both Android and iOS.
- [ ] Any surfaced production bugs fixed.
- [ ] Sonar coverage ≥85% on both controllers.
- [ ] Reviewer reports ZERO findings.
- [ ] Per-type Done gate satisfied (`bug` → auto-merge once green; cross-platform smoke on a real Android device + iOS simulator).
- [ ] PR merged.
- [ ] `status: Done`; `pr:` populated; cross-platform parity outcome logged in Notes.

## Notes (running log)

- 2026-06-07 ~20:52 BST — Refined under SHY-0032. Bumped P1 → P0 (cross-platform race coverage = Tier 2 reliability).
- 2026-06-07 — Skeleton generated by `scripts/convert-roadmap-to-stories.sh` from PR-bundle `PR-E2` (roadmap_ids: G016).

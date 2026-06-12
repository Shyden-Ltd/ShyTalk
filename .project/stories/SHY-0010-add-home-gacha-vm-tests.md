---
id: SHY-0010
status: Draft
owner: claude
created: 2026-06-07
priority: P0
effort: M
type: bug
roadmap_ids: [G003-D1]
pr:
mvp: true
---

# SHY-0010: HomeViewModel + GachaViewModel tests

## User Story

As the ShyTalk operator, I want **`HomeViewModel` and `GachaViewModel` to have adversarial unit-test coverage in commonTest covering state machines, room-list pagination, daily-reward integration, age-gate enforcement, and gacha animation choreography**, so that the highest-traffic entry surface (Home) and the highest-economy-risk surface (Gacha) cannot silently drift between releases.

## Why

The two ViewModels currently lack direct tests:

- **`HomeViewModel`** (`shared/src/commonMain/kotlin/com/shyden/shytalk/feature/home/HomeViewModel.kt`) — drives the Home screen; loads the room list, the daily-reward state, the push-permission banner (per PR #1010), the Gacha entry-card, the active-event banner. Home is the FIRST screen authenticated users see — every bug here is high-visibility.
- **`GachaViewModel`** (`shared/src/commonMain/kotlin/com/shyden/shytalk/feature/gacha/GachaViewModel.kt`) — drives the lucky-spin Gacha; coordinates coin debit, age-gate check (redirect to `AgeVerificationSubmit` if under-18), randomised outcome, animation playback, reward delivery. Economy + age-compliance + animation race all converge here.

Both are part of G003 (the 15-VM coverage gap) — specifically G003-D1 (line 54 of `.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md`):

> G003-D1: Sev: 🔴 Critical. Test — HomeViewModel, GachaViewModel. Highest-risk business logic. Fix: TDD per VM. Scope: M.

P0 confirmed under SHY-0032's Tier 2 reliability tier.

## Acceptance Criteria

### Happy path

- [ ] `shared/src/commonTest/kotlin/com/shyden/shytalk/feature/home/HomeViewModelTest.kt` exists with ≥25 test cases.
- [ ] `shared/src/commonTest/kotlin/com/shyden/shytalk/feature/gacha/GachaViewModelTest.kt` exists with ≥25 test cases.
- [ ] HomeViewModel state machine covered:
  - Initial → Loading → Success(rooms+rewards+banner) transitions.
  - Pull-to-refresh re-enters Loading → Success.
  - Empty room list → Empty state distinct from Loading.
  - Push-permission state changes propagated (per [[SHY-0006]] integration).
- [ ] GachaViewModel state machine covered:
  - Initial → Idle (showing CTA + cost).
  - Idle → AgeGate (user under-18, redirect path).
  - Idle → Insufficient (not enough coins; show top-up).
  - Idle → Spinning (animation in flight).
  - Spinning → Result (reward revealed).
  - Result → Idle (after dismiss).
- [ ] All tests pass via `./gradlew :shared:jvmTest --tests "*HomeViewModel*" --tests "*GachaViewModel*"`.
- [ ] Sonar coverage on both VMs ≥90%.

### Error paths

- [ ] **HomeViewModel**: room-list API 401 → emit `Error.NotAuthenticated`; suggest sign-in.
- [ ] **HomeViewModel**: room-list API 500 → emit `Error.ServerError(retryable=true)`; preserve last-known room list with stale indicator.
- [ ] **HomeViewModel**: daily-reward API failure (non-critical) → Home still loads with rooms; daily-reward badge shows "unavailable" but Home is usable.
- [ ] **HomeViewModel**: push-permission store throws → Home still loads; banner just absent.
- [ ] **GachaViewModel**: spin API 409 (duplicate request-ID) → treat as idempotent success; show reward from server's saved result.
- [ ] **GachaViewModel**: spin API 500 mid-spin → cancel animation; show `Error.SpinFailed(refunded=true|false)`; if user was already charged, ensure refund is requested.
- [ ] **GachaViewModel**: spin API 403 (age-gate enforced server-side) → redirect to age-verification (covers the edge case where client-side age check was skipped).
- [ ] **GachaViewModel**: animation handler throws (rare) → reward state still emits; user sees result even if animation glitches.

### Edge cases (adversarial)

- [ ] **HomeViewModel** — pull-to-refresh while initial load in flight: VM debounces; only one API call dispatched.
- [ ] **HomeViewModel** — room-list updated by push notification mid-refresh: the new room is merged correctly; no duplicates; no stale rooms shown.
- [ ] **HomeViewModel** — locale change mid-load: VM re-fetches room-list (since names may be localised); no half-loaded state.
- [ ] **HomeViewModel** — daily-reward claim during room-list load: both flows complete independently; no shared-state corruption.
- [ ] **HomeViewModel** — process-death during load: on relaunch, Home re-loads from cache (if cached) OR triggers fresh load with skeleton UI.
- [ ] **GachaViewModel** — rapid spin requests (5 in 100ms): VM debounces; exactly one API call.
- [ ] **GachaViewModel** — spin cancelled mid-animation (user backgrounded app): animation cancels; if reward was already delivered, state still records it on re-entry.
- [ ] **GachaViewModel** — age-gate timing: user is 17.99 years old at check-time; flow proceeds with under-18 redirect. (Boundary check.)
- [ ] **GachaViewModel** — age-gate spoofing attempt (client sends wrong DOB): server-side check enforces; client UX matches server decision.
- [ ] **GachaViewModel** — animation queue interaction: gacha animation enqueues correctly with `AnimationQueue` (SHY-0013 dependency); doesn't conflict with concurrent gift animations.
- [ ] **GachaViewModel** — insufficient funds detected client-side: VM blocks API call; shows top-up; if user tops up and immediately retries, the retry uses the refreshed balance.
- [ ] **Both VMs** — coroutine cancellation on navigation-away: all in-flight coroutines cancelled within 10ms; no leaked observers.

### Performance

- [ ] HomeViewModel initial load completes within 200ms with FakeRepositories.
- [ ] GachaViewModel state transitions <50ms each.
- [ ] Tests use `TestCoroutineScheduler`; deterministic timing.
- [ ] Full suite (~50 tests) within 30s.
- [ ] No memory leak after 1000 state transitions.

### Security

- [ ] **HomeViewModel**: room-list never includes hidden/banned rooms (relies on server filter; client doesn't double-filter); verified by FakeRepository returning a banned room + asserting it's not surfaced.
- [ ] **GachaViewModel**: client never sees other users' gacha results; FakeRepository contract verifies isolation.
- [ ] **GachaViewModel**: age check on client side is UX-only; server-side enforcement is the authoritative gate (verified via 403 handling).
- [ ] **GachaViewModel**: request-ID for spin is cryptographically random (same as SHY-0011's gifting); asserted in test.
- [ ] No PII (user IDs, room names) logged.

### UX

- [ ] HomeViewModel emits loading state within 50ms (no janky gap).
- [ ] GachaViewModel transitions are observable for animation choreography.
- [ ] Pull-to-refresh feedback obvious; error → retry button.
- [ ] Gacha result reveal is asynchronous from the API response (so the reveal animation isn't pre-spoiled).

### i18n

- [ ] HomeViewModel re-fetches on locale change (room names + daily-reward copy localised).
- [ ] GachaViewModel reward names + animation captions in all 20 locales (verified by `Res.string.*` references).

### Observability

- [ ] State transitions logged at DEBUG.
- [ ] Errors logged at WARN with error class.
- [ ] Crashlytics non-fatal on invariants (gacha state machine reaches impossible state, room-list contains duplicate IDs, etc.).
- [ ] Sonar coverage ≥90%.

## BDD Scenarios

**Scenario: HomeViewModel — initial load with all repositories happy**

- **Given** Fake room repository returns 5 rooms
- **And** Fake daily-reward repository returns "available"
- **And** Fake push-permission store reports `AUTHORIZED`
- **When** HomeViewModel is initialized
- **Then** state transitions: `Initial → Loading → Success(rooms=5, dailyReward=available, banner=hidden)`

**Scenario: HomeViewModel — daily-reward fails but Home still loads**

- **Given** room repo returns 3 rooms
- **And** daily-reward repo throws `NetworkException`
- **When** HomeViewModel is initialized
- **Then** state is `Success(rooms=3, dailyReward=unavailable, banner=hidden)`
- **And** the user can still navigate to rooms

**Scenario: GachaViewModel — under-18 user redirected to age verification**

- **Given** the authenticated user has DOB indicating age 16
- **When** GachaViewModel is initialized
- **Then** state is `AgeGate(redirectTo=AgeVerificationSubmit)`
- **And** the spin button is not actionable

**Scenario: GachaViewModel — successful spin**

- **Given** user is over 18 with 500 coins
- **And** spin cost is 100 coins
- **When** `spin()` is called
- **Then** state transitions: `Idle → Spinning → Result(reward=X, balance=400)`
- **And** the animation handler enqueues exactly one animation

**Scenario: GachaViewModel — double-tap spin dedupe**

- **Given** the user double-taps `spin` within 50ms
- **When** the VM processes both events
- **Then** exactly one API call is dispatched
- **And** the user is charged exactly once

**Scenario: GachaViewModel — server-side 403 age-gate (client spoof attempt)**

- **Given** the client-side age check incorrectly reports age 19 (but server-side DOB is age 16)
- **When** `spin()` is called and server returns 403 with `reason=under_18`
- **Then** VM emits `AgeGate(redirectTo=AgeVerificationSubmit)` — same state as client-detected case
- **And** no charge applied

**Scenario: HomeViewModel — push notification delivers a new room mid-refresh**

- **Given** HomeViewModel is mid-refresh
- **And** push notification fires with `room_added: room-X`
- **When** the refresh completes returning rooms A, B, C
- **Then** the merged list is A, B, C, room-X (with no duplicates)
- **And** if room-X was already in the refresh result, it appears exactly once

**Scenario: HomeViewModel — locale change re-fetches**

- **Given** HomeViewModel showing room list in English
- **When** the system locale changes to ja-JP
- **Then** the VM re-fetches the room list
- **And** the room names display in Japanese

## Test Plan (TDD)

### Red

1. Locate the two VMs; verify expected paths.
2. Locate or create FakeRepositories for: `FakeRoomRepository`, `FakeDailyRewardRepository`, `FakePushPermissionStore`, `FakeGachaRepository`, `FakeUserRepository` (for DOB / age).
3. Add the two test files; write all ~50 test cases.
4. Run `./gradlew :shared:jvmTest --tests "*HomeViewModel*" --tests "*GachaViewModel*"` → RED on undertested paths.
5. Expected RED:
   - Pull-to-refresh debounce likely RED.
   - Push-notification merge logic likely RED.
   - Spin double-tap dedupe likely RED.
   - Server-side 403 age-gate handling likely RED (may currently crash or just show generic error).

### Green

1. Add minimum fixes for surfaced bugs.
2. Re-run → GREEN.
3. Sonar coverage ≥90%.
4. Manual smoke on dev device: pull-to-refresh Home; do a gacha spin (with both <18 and >18 test personas); verify all flows.

## Out of Scope

- **Refactoring Home UI** — only VM logic.
- **New gacha mechanics** — only test coverage of existing.
- **Server-side gacha logic** — out of scope.
- **End-to-end Home journey** — covered by BDDs in SHY-0009 and j-series journeys.

## Dependencies

- **SHY-0001** + **SHY-0032** — process.
- **SHY-0006** — push permission VM tests; HomeViewModel integrates with PushPermissionStore.
- **SHY-0013** — AnimationQueue tests; GachaViewModel uses it.
- **SHY-0011** — GiftingViewModel patterns (similar idempotency + request-ID requirements).
- **SHY-0024** — NavGraph migration; once shipped, GachaViewModel's redirect-to-AgeVerificationSubmit becomes routable on Android.
- Existing FakeRepository patterns in commonTest.

## Risks & Mitigations

- **Risk:** HomeViewModel has 5+ dependencies (room repo, daily-reward repo, push store, etc.) → test setup is complex. **Mitigation:** use a `HomeViewModelTestFixture` helper that constructs sensible defaults; tests override only the deps they care about.
- **Risk:** GachaViewModel's age-gate flow depends on SHY-0024 (NavGraph migration). **Mitigation:** test the VM's emitted intent (redirect-to-AgeVerificationSubmit) without testing the actual navigation; integration test deferred to post-SHY-0024.
- **Risk:** Push-notification merge race surfaces a real production bug. **Mitigation:** GOOD outcome; fix in this PR.
- **Risk:** GachaViewModel's animation handler is tightly coupled to platform-specific `AnimationQueue`. **Mitigation:** if tightly coupled, refactor minimum to inject a Fake; reviewer validates the change is minimum.

## Definition of Done

- [ ] Both test files exist; ≥50 cases pass.
- [ ] Any production bugs surfaced fixed.
- [ ] Sonar coverage ≥90% on both VMs.
- [ ] Manual smoke on dev device passes.
- [ ] Reviewer reports ZERO findings.
- [ ] Per-type Done gate satisfied (`bug` → auto-merge + dev smoke for Home + Gacha).
- [ ] PR merged.
- [ ] `status: Done`; `pr:` populated; bug catalogue in Notes.

## Notes (running log)

- 2026-06-07 ~21:03 BST — Refined under SHY-0032. P0 confirmed (Tier 2 reliability — highest-traffic VMs).
- 2026-06-07 — Skeleton generated by `scripts/convert-roadmap-to-stories.sh` from PR-bundle `PR-D1` (roadmap_ids: G003-D1).

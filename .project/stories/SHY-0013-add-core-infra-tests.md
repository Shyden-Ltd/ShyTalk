---
id: SHY-0013
status: Draft
owner: claude
created: 2026-06-07
priority: P0
effort: M
type: infra
roadmap_ids: [G004, G020]
pr:
mvp: true
---

# SHY-0013: RoomLifecycleManager + AnimationQueue + ModerationFilter tests

## User Story

As the ShyTalk operator, I want **the three race-sensitive / ordering-critical core components — `RoomLifecycleManager`, `AnimationQueue`, and `ModerationFilter` — to have adversarial unit tests in commonTest/jvmTest covering concurrency, ordering, and bypass attempts**, so that the substrate under every voice-room interaction and every gift animation and every content moderation decision has a real safety net instead of "tested by accident via E2E".

## Why

Three core substrate components currently have **zero direct test coverage**:

1. **`RoomLifecycleManager`** (`shared/src/commonMain/kotlin/com/shyden/shytalk/core/room/RoomLifecycleManager.kt`) — owns the `awaitLeaveCompletion` race-sensitive logic; coordinates the room-join → seat-take → leave flow; tracked by the `RoomLifecycleManager: koinInject()` singleton in both `NavGraph.kt:119` and `SharedNavGraph.kt:100`. A race here could let a user "leave" a room while the seat-take is mid-flight, leading to ghost seats / phantom users.

2. **`AnimationQueue`** (`shared/src/commonMain/kotlin/com/shyden/shytalk/feature/gift/AnimationQueue.kt` or equivalent — locate via grep at PR-start) — orders gift animations so they don't overlap visually. An ordering bug would let two animations play simultaneously (looks broken) OR drop one entirely (user paid for a gift that never appeared).

3. **`ModerationFilter`** (`shared/src/commonMain/kotlin/com/shyden/shytalk/core/util/ModerationFilter.kt`) — Online Safety Act (OSA) #17 compliance filter for user-generated content (messages, profile names, room names, etc.). A bypass — via unicode normalization tricks, RTL injection, zero-width characters, etc. — would let banned terms through, putting ShyTalk in compliance violation.

Roadmap rows G004 (line 29) + G020 (line 64):

> G004: Sev: 🔴 Critical. Test — core infrastructure. Race-sensitive state flows (`awaitLeaveCompletion`), gift animation queue ordering, content filter all uncovered. Fix: Per-component jvmTest; concurrency/ordering for AnimationQueue; race coverage for RoomLifecycleManager. Scope: M.
>
> G020: Sev: 🟠 Important. Test — ModerationFilter. OSA #17 compliance filter untested for bypass. Fix: Adversarial tests: bypass attempts, unicode normalization, edge length. Scope: S.

Bumped to Tier 2 P0 under SHY-0032 because:

1. Race conditions are irreversible bugs that ship invisibly until a real user hits them at scale.
2. OSA compliance failures carry regulatory + reputational risk; pre-public is the cheap window to harden.
3. The three components are foundational — every higher-level test (VM tests in SHY-0010/0011/0012, journey BDDs in SHY-0006-0009) implicitly relies on them being correct.
4. The "quality + reliability over speed" weighting prioritises substrate-correctness.

## Acceptance Criteria

### Happy path

- [ ] `shared/src/commonTest/kotlin/com/shyden/shytalk/core/room/RoomLifecycleManagerTest.kt` exists with ≥15 test cases covering:
  - Single-thread happy path (join → take seat → leave; assert final state empty).
  - `awaitLeaveCompletion` returns after leave finishes (not before).
  - Re-entering a room after leave restores expected state.
- [ ] `shared/src/commonTest/kotlin/com/shyden/shytalk/feature/gift/AnimationQueueTest.kt` exists with ≥10 test cases covering:
  - Single animation enqueue → start → complete (order observable).
  - Multiple enqueues honoured in FIFO order.
  - Queue empty after all animations complete.
  - Cancelling an in-flight animation surfaces the cancellation observably.
- [ ] `shared/src/commonTest/kotlin/com/shyden/shytalk/core/util/ModerationFilterTest.kt` exists with ≥25 test cases covering:
  - Clean text passes (positive cases for non-banned content).
  - Known banned terms (per OSA #17 enumerated set) are flagged.
  - Mixed clean + banned text in same message is flagged.
- [ ] All tests pass via `./gradlew :shared:jvmTest --tests "*RoomLifecycle*" --tests "*AnimationQueue*" --tests "*ModerationFilter*"`.
- [ ] Sonar coverage on the 3 files ≥85% line + ≥80% branch.

### Error paths

- [ ] **RoomLifecycleManager**: `leave` called when no room joined → throws `IllegalStateException` with a clear message ("no active room to leave"); test asserts the exception type + message.
- [ ] **RoomLifecycleManager**: `awaitLeaveCompletion` called when no leave in progress → returns immediately (not hang); timeout-bounded test asserts completion within 100ms.
- [ ] **AnimationQueue**: enqueueing while the queue is being drained doesn't cause `ConcurrentModificationException` — verified by a stress test (100 enqueues + 100 dequeues interleaved).
- [ ] **AnimationQueue**: animation handler throws → next animation in queue still starts (the handler's exception is caught + logged, doesn't poison the queue).
- [ ] **ModerationFilter**: null input → returns "clean" (or whatever the documented null-handling contract is — read the production code to confirm).
- [ ] **ModerationFilter**: extremely long input (10 MB string) → either completes within 500ms OR returns a typed `InputTooLargeException`; never hangs.

### Edge cases (adversarial)

- [ ] **RoomLifecycleManager** race: 10 concurrent `leave()` calls → exactly one wins; others are no-ops or return idempotent success; verified by a `runBlocking { repeat(10) { launch { manager.leave() } } }` test with assertions on the final state.
- [ ] **RoomLifecycleManager** race: `join(X)` immediately followed by `leave()` before join completes → manager either (a) cancels the join, (b) completes join then leave, (c) errors with a clear message; test enumerates which the production code does + asserts it.
- [ ] **RoomLifecycleManager** race: process-death simulation (test framework cancels the coroutine scope mid-flow) → next instantiation recovers to a clean state; no leaked subscriptions, no zombie observers.
- [ ] **AnimationQueue** ordering: 1000 enqueues with random delays → all dequeued in FIFO order; no animations dropped, no duplicates.
- [ ] **AnimationQueue** cancellation: scope cancellation mid-animation → handler's `finally` block runs; queue state cleaned.
- [ ] **ModerationFilter** adversarial — unicode normalization bypass: banned word "bad" with `båd` (NFC variant), `båd` (decomposed), `B𝑨D` (math italic), `b a d` (zero-width spaces inserted), `b​a​d` (explicit zero-width spaces), `b​a​d` (literal zero-width spaces) — all flagged.
- [ ] **ModerationFilter** adversarial — RTL injection: `bad` written as `dab` with RTL marker `‮` → flagged.
- [ ] **ModerationFilter** adversarial — case + leetspeak: `BAD`, `B4D`, `b@d`, `b4d`, `bᴀᴅ` (small caps), `b̾a̾d̾` (combining diacriticals) — all flagged.
- [ ] **ModerationFilter** adversarial — wordboundary: `embedded-bad-word` should flag if substring-match is the policy; `bad` as a substring of `badge` (legitimate word) — verify either substring-match (flags both) OR word-boundary (flags only the standalone) and document which it is.
- [ ] **ModerationFilter** adversarial — known false positives: legitimate words containing banned substrings (`grass`, `assistant`, `class`) should NOT be flagged if word-boundary is in effect.
- [ ] **ModerationFilter** language: test for non-English banned terms (Arabic, Chinese, etc.) per the OSA #17 multi-language requirement; if not currently supported, this is a documented gap (filed as follow-up SHY).

### Performance

- [ ] **RoomLifecycleManager**: single `join` → `leave` cycle completes within 50ms in unit test (no real network; with FakeVoiceService).
- [ ] **AnimationQueue**: enqueue + dequeue latency under 1ms p99 for 1000-item queue.
- [ ] **ModerationFilter**: 1 KB message check completes within 10ms p99; 10 KB within 50ms.
- [ ] Test suite as a whole completes within 60s.
- [ ] No detectable memory leak after 10,000 enqueue/dequeue cycles on AnimationQueue.

### Security

- [ ] **ModerationFilter** is the OSA #17 compliance boundary; security review explicitly enumerates the banned-term sources (likely a static `.txt` resource or a remote-config fetch — locate via grep).
- [ ] If banned-term lists are fetched from a remote source, the fetch is over HTTPS + signature-verified.
- [ ] **RoomLifecycleManager** transitions cannot be coerced to skip authentication state checks — if a user-id is required for join, the test verifies the manager rejects unauth'd joins.
- [ ] **AnimationQueue** doesn't expose enqueue API to untrusted callers (it should be internal to the gift flow which is server-mediated).

### UX

- [ ] **ModerationFilter** blocked messages surface to the user with a clear-but-non-revealing message ("Your message couldn't be sent — it may contain inappropriate content") — not the exact reason (avoid letting bad actors iterate against the filter).
- [ ] **AnimationQueue** drops are observable in logs but not user-visible mid-animation (no flicker on cancellation).
- [ ] **RoomLifecycleManager** race-resolved states never leave the user UI in a stuck loader — every state transition emits an observable that the VM consumes.

### i18n

- [ ] User-facing moderation-blocked message uses a strings.xml key in all 20 locales (not in scope to add new keys; only to verify the existing block message is localized).
- [ ] Banned-term list itself is language-aware (per the security AC above).

### Observability

- [ ] **RoomLifecycleManager** state transitions logged at INFO level: `Log.i("RoomLifecycle", "transition: $from → $to (roomId=$roomId)")`.
- [ ] **AnimationQueue** enqueue/dequeue logged at DEBUG level (chatty; off in production builds via log level).
- [ ] **ModerationFilter** blocks logged at WARN level with the rule that triggered (NOT the original message text — privacy + bad-actor-iteration protection): `Log.w("ModerationFilter", "blocked: rule=$ruleId")`.
- [ ] Sonar coverage threshold enforced via existing Sonar config; PR fails if coverage drops on the 3 files.
- [ ] Crashlytics non-fatal on `RoomLifecycleManager` race-detection (so we observe production occurrences).

## BDD Scenarios

**Scenario: RoomLifecycleManager — happy path**

- **Given** a fresh `RoomLifecycleManager` instance
- **When** `join("room-A")` is called, followed by `takeSeat(0)`, followed by `leave()`
- **Then** each call completes successfully
- **And** after `leave()`, `activeRoomId` is `null`
- **And** state transitions emitted: `IDLE → JOINING → JOINED → SEATED → LEAVING → IDLE`

**Scenario: RoomLifecycleManager — leave-while-joining race**

- **Given** a `RoomLifecycleManager` mid-join (join started, not complete)
- **When** `leave()` is called concurrently
- **Then** the manager resolves to a documented end-state (either cancelled-join + IDLE, or completed-join + IDLE)
- **And** no zombie subscription remains
- **And** the final state is reproducible across 100 test runs

**Scenario: AnimationQueue — FIFO ordering under load**

- **Given** an empty `AnimationQueue`
- **When** 1000 animations are enqueued with random IDs
- **Then** they dequeue in the same order they were enqueued
- **And** zero animations are dropped
- **And** zero duplicates are observed

**Scenario: ModerationFilter — unicode normalization bypass**

- **Given** a banned word `bad` in the filter dictionary
- **When** the input `"båd"` (NFC form) is checked
- **Then** it is flagged as containing a banned term
- **And** the same applies to NFD form, math italic, small caps, zero-width-separated, and RTL-reversed variants

**Scenario: ModerationFilter — legitimate word containing banned substring**

- **Given** the word-boundary policy is in effect (verify in test)
- **When** the input `"grass"` is checked
- **Then** it passes (not flagged) — the substring `"ass"` does not trigger because of word boundaries

**Scenario: AnimationQueue — handler exception doesn't poison the queue**

- **Given** an `AnimationQueue` with 3 enqueued animations where the second handler throws
- **When** the queue drains
- **Then** animations 1 and 3 still complete
- **And** the exception from animation 2 is captured (logged + Crashlytics non-fatal) but does not propagate to crash the process

**Scenario: RoomLifecycleManager — 10 concurrent leave calls**

- **Given** a `RoomLifecycleManager` in JOINED state
- **When** `leave()` is called 10x concurrently from different coroutines
- **Then** the manager resolves to IDLE exactly once
- **And** subsequent observations of state are all IDLE
- **And** no exceptions propagated to callers

**Scenario: ModerationFilter — security boundary documented**

- **Given** the moderation filter test suite
- **When** the test class header is read
- **Then** it documents the OSA #17 compliance reference + the banned-term-list source + the language coverage matrix

## Test Plan (TDD)

### Red

1. Locate the three source files (`RoomLifecycleManager.kt`, `AnimationQueue.kt`, `ModerationFilter.kt`); if any aren't at the expected paths, grep + document actual locations.
2. Add the three test files in `shared/src/commonTest/kotlin/...` (paths mirror production).
3. Write all ~50 test cases enumerated in the AC above.
4. Run `./gradlew :shared:jvmTest --tests "*RoomLifecycle*"` etc.
5. Expected RED outcomes:
   - Several `RoomLifecycleManager` race tests fail (current code may lack synchronisation).
   - At least 2-3 `ModerationFilter` adversarial bypasses succeed (current filter likely doesn't NFC-normalise before comparing).
   - `AnimationQueue` FIFO test may pass if the implementation uses `Channel`/`Mutex` correctly; cancellation test likely fails if `finally` cleanup is missing.
6. Document the RED state in PR description as the bug catalogue.

### Green

1. For each surfaced bug:
   - Add minimum fix in production code (synchronisation, NFC-normalisation, `finally` cleanup, etc.).
   - Re-run the corresponding test → GREEN.
   - Reviewer agent validates each fix is minimum-not-overreach.
2. Run full suite → all GREEN.
3. Sonar coverage check → ≥85% on each file.
4. No new compile warnings.

## Out of Scope

- **Replacing the moderation backend** (e.g. swapping to Hive Moderation / Perspective API) — separate SHY if pursued; only testing the current filter.
- **Multi-language moderation expansion** — only English coverage matrix; non-English is a follow-up SHY if not currently supported.
- **Performance optimisation** of the three components — only test coverage; perf tuning only if tests reveal regression.
- **Refactoring the components** beyond minimum fixes for surfaced bugs.
- **Mocking out `RoomLifecycleManager` in higher-level tests** — that's the VM tests' problem (SHY-0010-0012); only direct unit tests here.

## Dependencies

- **SHY-0001** + **SHY-0032** — process dependencies.
- The three production source files (verify locations at PR-start).
- Coroutines test artefacts (`kotlinx-coroutines-test`) — verify version in `gradle/libs.versions.toml`.
- `kotlin.test` for assertions; matches existing test style.

## Risks & Mitigations

- **Risk:** The RED tests surface several real bugs at once; fixing them all balloons scope. **Mitigation:** if >3 distinct bug fixes surface, split into SHY-0013-A (tests + obvious fixes) + SHY-0013-B (deeper fixes); reviewer agent decides at PR-time.
- **Risk:** The `awaitLeaveCompletion` race is fundamentally a design issue requiring a coroutine `Mutex` or `Channel`; the minimal fix may not be sufficient. **Mitigation:** the AC documents the expected end-state for each race; reviewer agent verifies the fix actually achieves it, not just makes the test pass via a sleep.
- **Risk:** ModerationFilter NFC-normalisation adds latency. **Mitigation:** the 1KB-within-10ms perf AC bounds it.
- **Risk:** AnimationQueue tests are flaky in CI due to coroutine scheduling. **Mitigation:** use `TestCoroutineScheduler` from `kotlinx-coroutines-test`; deterministic time-step.
- **Risk:** The OSA #17 banned-term list is loaded from a path that doesn't exist in test classpath. **Mitigation:** test setup injects a known fixture term list; production list is exercised only in a separate integration test (out of scope).

## Definition of Done

- [ ] Three test files exist; ≥50 test cases pass.
- [ ] Any surfaced production bugs fixed in this PR.
- [ ] Sonar coverage ≥85% on the 3 production files.
- [ ] No new compile warnings.
- [ ] Reviewer reports ZERO findings.
- [ ] Per-type Done gate satisfied (`infra` → auto-merge once green; substrate test additions have no user-visible behaviour change, so no dev-smoke required per the CLAUDE.md lifecycle rules for `infra`).
- [ ] PR merged via auto-merge.
- [ ] `status: Done`; `pr:` populated; bug catalogue + fix summary in Notes.

## Notes (running log)

- 2026-06-07 ~20:52 BST — Refined under SHY-0032. Bumped P1 → P0 (race + OSA compliance = highest reliability tier).
- 2026-06-07 — Skeleton generated by `scripts/convert-roadmap-to-stories.sh` from PR-bundle `PR-E1` (roadmap_ids: G004, G020).

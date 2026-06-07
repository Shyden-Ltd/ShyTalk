---
id: SHY-0018
status: Draft
owner: claude
created: 2026-06-07
priority: P1
effort: M
type: bug
roadmap_ids: [G015, G030]
pr:
---

# SHY-0018: IosMessage + IosSeatRequest + IosEconomyGift + IosSmallRepositories + IosPushBridge tests

## User Story

As the ShyTalk operator, I want **the remaining iOS repository implementations (IosMessage, IosSeatRequest, IosEconomyGift, IosSmallRepositories) AND IosPushBridge to have unit-test coverage covering Firestore snapshot transforms, error propagation, null-safety, FCM token handling, deep-link routing, and push-permission state reporting**, so that the iOS-side of the data layer reaches Android parity in CI coverage rather than relying on integration tests catching regressions.

## Why

Five files in `shared/src/iosMain/kotlin/com/shyden/shytalk/` lack direct tests:

**Repository implementations** (G015):

1. `IosMessage` (or similar — likely `IosMessageRepositoryImpl.kt`) — DM persistence + send.
2. `IosSeatRequest` — voice-room seat-request flow.
3. `IosEconomyGift` — gift transactions.
4. `IosSmallRepositories` — collection of smaller repos (verify the exact contents by reading the file).

**Push bridge** (G030): 5. `IosPushBridge` — FCM token reporting, push notification deep-link extraction, permission state reporting.

Roadmap rows G015 (line 72) + G030 (line 73):

> G015: Sev: 🟠 Important. Test — IosMessage, IosSeatRequest, IosEconomyGift, IosSmallRepositories (5 files). Firestore snapshot transforms, error propagation, null-safety uncovered. Fix: jvmTest stubs + iosMain tests. Scope: M.
>
> G030: Sev: 🟠 Important. Test — IosPushBridge. FCM token + deep link + permission state reporting untested; parity with AndroidPushPermissionTest needed. Fix: iosMain test covering 3 paths. Scope: S.

P1 Tier-3 coverage. Closes the iOS data-layer + push-platform-bridge coverage gap.

## Acceptance Criteria

### Happy path

**Repository tests (G015)**:

- [ ] `shared/src/iosTest/kotlin/com/shyden/shytalk/data/repository/IosMessageRepositoryImplTest.kt` exists with ≥15 cases.
- [ ] `shared/src/iosTest/kotlin/com/shyden/shytalk/data/repository/IosSeatRequestRepositoryImplTest.kt` exists with ≥10 cases.
- [ ] `shared/src/iosTest/kotlin/com/shyden/shytalk/data/repository/IosEconomyGiftRepositoryImplTest.kt` exists with ≥10 cases.
- [ ] `shared/src/iosTest/kotlin/com/shyden/shytalk/data/repository/IosSmallRepositoriesTest.kt` exists with ≥10 cases (or split per sub-repo if the file groups multiple).
- [ ] Each test file covers per-method:
  - Happy path: input → expected output via fake Firestore snapshots.
  - Snapshot transform correctness: raw `DocumentSnapshot` data → typed domain model.
  - Null-safety: missing optional fields → sensible defaults; missing required fields → typed error.
  - Error propagation: Firestore exceptions wrapped in `Result.Failure(...)`.

**Push bridge tests (G030)**:

- [ ] `shared/src/iosTest/kotlin/com/shyden/shytalk/core/push/IosPushBridgeTest.kt` exists with ≥10 cases covering 3 documented paths:
  - **FCM token**: `IosPushBridge.token()` returns the current token; updates on rotation; logs to backend.
  - **Deep link**: incoming push payload with `deep_link` extra → bridge extracts it + dispatches to nav.
  - **Permission state reporting**: bridge reports current iOS permission state to shared `PushPermissionStore`; updates on state change.
- [ ] Parity check with `AndroidPushPermissionTest` (Android equivalent) — same contract test cases.

- [ ] All tests pass via `./gradlew :shared:iosX64Test --tests "*Repository*" --tests "*PushBridge*"` (or jvmTest equivalent if iosTest source set unavailable).
- [ ] Sonar coverage on all 5 files ≥85%.

### Error paths

- [ ] **Each repo**: Firestore returns null document → `Result.Failure(NotFound)`.
- [ ] **Each repo**: Firestore throws `FirebaseFirestoreException(PERMISSION_DENIED)` → wrapped as `Result.Failure(Forbidden)`.
- [ ] **Each repo**: Firestore throws `UNAVAILABLE` → `Result.Failure(Network)` with retryable flag.
- [ ] **Each repo**: Firestore returns document with missing required fields → `Result.Failure(InvalidResponse)` + Crashlytics non-fatal.
- [ ] **Each repo**: snapshot listener cancellation → no leaked listener; verified via fake.
- [ ] **PushBridge**: FCM token fetch fails → returns null OR throws documented exception; caller can handle.
- [ ] **PushBridge**: malformed deep-link payload → ignored gracefully; logged at WARN.
- [ ] **PushBridge**: permission state lookup fails (iOS API error) → defaults to NOT_DETERMINED + log.

### Edge cases

- [ ] **IosMessage**: empty message → rejected client-side before send.
- [ ] **IosMessage**: very long message (10 KB) → handled per backend contract (truncation OR rejection).
- [ ] **IosMessage**: message with banned content → ModerationFilter (SHY-0013) flags; send blocked.
- [ ] **IosSeatRequest**: seat-take during room-leave race → returns conflict.
- [ ] **IosEconomyGift**: gift mid-balance-update race → backend dedupe via request-ID; client sees consistent outcome.
- [ ] **PushBridge**: token rotation mid-request → in-flight requests use old token; next request uses new.
- [ ] **PushBridge**: deep-link to a route that requires auth → bridge dispatches; nav handles auth gate.
- [ ] **PushBridge**: permission state change during app foreground → store update propagates within 100ms.

### Performance

- [ ] Each test runs within 100ms with fakes.
- [ ] Full suite (~55 tests) within 15s.

### Security

- [ ] Request-ID for each mutating call (IosMessage.send, IosSeatRequest, IosEconomyGift) is cryptographically random (UUID v4 or `SecureRandom`-backed); verified by asserting 100 consecutive IDs differ AND don't share a common timestamp-derived prefix. Matches the pattern established in SHY-0010 / SHY-0011 / SHY-0017 for parity across all mutation-bearing client surfaces.
- [ ] FCM token never logged with full value (only token-presence indicator).
- [ ] Deep-link extraction validates the route is in the allowed-list (no arbitrary URL → arbitrary nav).
- [ ] Message content never logged.
- [ ] Auth tokens never embedded in error messages.

### UX

- [ ] N/A — internal layer.

### i18n

- [ ] Error messages from server passed through; localization at VM/UI layer.

### Observability

- [ ] Each request logged at DEBUG.
- [ ] Each error logged at WARN with status code (no PII).
- [ ] Deep-link dispatch logged at INFO with route (no payload).
- [ ] FCM token rotation logged at INFO (boolean: rotated, no value).
- [ ] Sonar coverage ≥85% across all 5 files.

## BDD Scenarios

**Scenario: IosMessage send happy path**

- **Given** authenticated iOS user; fake Firestore ready
- **When** `iosMessageRepo.send(roomId="R", text="hello")` is called
- **Then** the message is written via Firestore add
- **And** the returned `Result.Success(Message(...))` matches the input

**Scenario: IosMessage — message with banned content blocked**

- **Given** ModerationFilter would flag the text
- **When** send is called
- **Then** result is `Result.Failure(ModerationBlocked)`
- **And** no Firestore write attempted

**Scenario: IosSeatRequest — conflict during seat-take**

- **Given** another user just took the seat
- **When** the seat-take request is sent
- **Then** server returns conflict
- **And** result is `Result.Failure(Conflict(reason="seat_taken"))`

**Scenario: IosEconomyGift — successful gift**

- **Given** user has 500 coins; gift cost 100
- **When** gift sent
- **Then** balance debits to 400
- **And** result is `Result.Success(GiftSent(...))`

**Scenario: PushBridge — FCM token returned + reported to backend**

- **Given** iOS notification permission granted
- **When** `iosPushBridge.token()` is called
- **Then** the current FCM token is returned (non-null)
- **And** the token is reported to the backend via the existing endpoint
- **And** logs show "fcm_token_reported" without the value

**Scenario: PushBridge — deep link extracted from payload**

- **Given** push payload `{deep_link: "shytalk://room/R"}`
- **When** the push is received
- **Then** bridge extracts the URL
- **And** dispatches to the nav controller with `Screen.Room.createRoute("R")`

**Scenario: PushBridge — permission state propagates to store**

- **Given** iOS permission state changes from NOT_DETERMINED to AUTHORIZED (user just granted)
- **When** the bridge observes the change
- **Then** `PushPermissionStore` is updated within 100ms
- **And** the shared state observable emits AUTHORIZED to all subscribers

**Scenario: Parity with AndroidPushPermissionTest**

- **Given** the same 3 contract tests (FCM token, deep link, permission state) on both Android and iOS
- **When** both test suites run
- **Then** both pass the same assertions
- **And** the contract is documented as cross-platform identical

## Test Plan (TDD)

### Red

1. Locate the 5 files; verify paths.
2. Create or reuse FakeFirestore + FakePushAPI fixtures.
3. Add 5 test files; ~55 cases total.
4. Run `./gradlew :shared:jvmTest --tests "*Ios*"` (or iosX64Test) → RED on uncovered paths.

### Green

1. Fix any surfaced production bugs.
2. Re-run → GREEN.
3. Sonar coverage ≥85%.

## Out of Scope

- **Refactoring repository interfaces** — only tests.
- **Adding new push features** — only coverage.
- **End-to-end push flow on real device** — out of scope; manual smoke covers.

## Dependencies

- **SHY-0001** + **SHY-0032** — process.
- **SHY-0013** — ModerationFilter (used by IosMessage).
- **SHY-0015** — SecureStorage (may be used for token caching).
- **SHY-0017** — iOS room repo pattern (template).
- **SHY-0006** — PushPermissionStore (consumer).
- Ktor MockEngine / FakeFirestore.

## Risks & Mitigations

- **Risk:** iOS source set test configuration may need work (per SHY-0015 risks). **Mitigation:** start with jvmTest as fallback; document the choice.
- **Risk:** IosSmallRepositories groups multiple repos; tests may be unwieldy. **Mitigation:** split into per-repo test files at pickup.
- **Risk:** Real FirebaseFirestoreException can't be constructed in tests; mock requires interface refactor. **Mitigation:** if exception construction blocked, use error-injection via the FakeFirestore + assert on result classification.

## Definition of Done

- [ ] 5 test files exist; ≥55 cases pass.
- [ ] Any surfaced bugs fixed.
- [ ] Sonar coverage ≥85%.
- [ ] Parity test cases pass on both Android and iOS.
- [ ] Reviewer ZERO findings.
- [ ] Per-type Done gate (`bug` → auto-merge + dev smoke on iOS simulator).
- [ ] PR merged.
- [ ] `status: Done`; `pr:` populated; bug catalogue in Notes.

## Notes (running log)

- 2026-06-07 ~21:25 BST — Refined under SHY-0032. Tier 3 iOS coverage; closes the iOS data-layer + push-bridge gap.
- 2026-06-07 — Skeleton from `convert-roadmap-to-stories.sh` PR-bundle `PR-F2` (G015, G030).

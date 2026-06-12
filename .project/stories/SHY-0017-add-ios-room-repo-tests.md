---
id: SHY-0017
status: Draft
owner: claude
created: 2026-06-07
priority: P1
effort: M
type: bug
roadmap_ids: [G014]
pr:
mvp: true
---

# SHY-0017: IosRoomRepositoryImpl tests (P2 client migration coverage)

## User Story

As the ShyTalk operator, I want **`IosRoomRepositoryImpl` to have unit-test coverage in jvmTest (with iOS-specific fakes) covering endpoint dispatch, request building, response parsing, error mapping (net fail / 409 / 403), and offline-queue behaviour**, so that iOS parity with the existing Android RoomRepositoryImpl test coverage is restored and the P2 client migration becomes verifiable in CI.

## Why

The room-mutations P2 client migration moved room mutations from direct Firestore calls to Express API endpoints. The Android implementation has test coverage; the iOS implementation (`shared/src/iosMain/kotlin/com/shyden/shytalk/data/repository/IosRoomRepositoryImpl.kt`) does NOT.

Without coverage:

- Refactors to the Express endpoint contract could silently break iOS while Android tests pass.
- Network-error mapping is invisible (a 500 might surface as a generic UX message OR as a typed retry).
- Offline-queue behaviour (if any) is undocumented.

Roadmap row G014 (line 71):

> Sev: 🟠 Important. Test — IosRoomRepositoryImpl P2. Location: `shared/src/iosMain/kotlin/com/shyden/shytalk/data/repository/IosRoomRepositoryImpl.kt`. Gap: P2 client migration; endpoint calls + error mapping untested. Fix: iosMain or jvmTest with fakes; cover net fail, 409, 403. Scope: M.

P1 Tier-3 coverage. Cross-platform parity with Android's existing tests.

## Acceptance Criteria

### Happy path

- [ ] Test file `shared/src/iosTest/kotlin/com/shyden/shytalk/data/repository/IosRoomRepositoryImplTest.kt` exists (OR `shared/src/commonTest/.../IosRoomRepositoryImplTest.kt` if iOS-specific source set isn't set up).
- [ ] ≥20 test cases covering:
  - Each repository method has happy-path coverage (join, leave, takeSeat, acceptInvite, kick, transferOwnership, mute, etc. — enumerate by reading the production interface).
  - Each method's request body shape verified (correct URL, method, headers, body JSON).
  - Each method's response parsing verified (success path returns expected domain object).
- [ ] All tests pass via `./gradlew :shared:jvmTest --tests "*IosRoomRepository*"` (or iosX64Test equivalent).
- [ ] Sonar coverage on `IosRoomRepositoryImpl.kt` ≥85%.

### Error paths

- [ ] Network failure (no connectivity) → returns `Result.Failure(NetworkException)`; doesn't crash.
- [ ] 401 unauthorized → returns `Result.Failure(NotAuthenticated)`; caller can react.
- [ ] 403 forbidden (e.g. user lacks owner role for the mutation) → returns `Result.Failure(Forbidden(reason))`.
- [ ] 404 not found (room deleted between client read + write) → returns `Result.Failure(NotFound)`.
- [ ] 409 conflict (race with another mutation, e.g. seat taken by someone else) → returns `Result.Failure(Conflict(reason))`; caller can retry.
- [ ] 429 rate-limited → returns `Result.Failure(RateLimited(retryAfter))`.
- [ ] 5xx server error → returns `Result.Failure(ServerError(retryable=true))`.
- [ ] Malformed response (non-JSON body, missing required field) → returns `Result.Failure(InvalidResponse)`; logs Crashlytics non-fatal.
- [ ] Request timeout → returns `Result.Failure(Timeout)`.

### Edge cases

- [ ] Concurrent calls to the same method (race) → each call is independent; backend dedup via request-ID.
- [ ] Method called with null/empty room ID → returns `Result.Failure(InvalidArgument)` BEFORE dispatching network call.
- [ ] Auth token expires mid-request → automatic refresh attempted; if refresh fails, returns NotAuthenticated.
- [ ] Server returns redirect (3xx) → handled per HTTP semantics OR rejected as unexpected.
- [ ] Server returns success status but partial data → treated as InvalidResponse.

### Performance

- [ ] Each test runs within 100ms with FakeHttpClient.
- [ ] Full suite (~20 tests) within 5s.
- [ ] No leaked coroutines after scope cancellation.

### Security

- [ ] Request-ID for each mutation call (takeSeat, kick, transferOwnership, etc.) is cryptographically random (UUID v4 or platform-provided `SecureRandom`-backed equivalent); verified by asserting 100 consecutive IDs differ AND that no ID shares a common timestamp-derived prefix. Matches the pattern established in SHY-0010 (GachaVM) + SHY-0011 (GiftingVM) for parity across all mutation-bearing client surfaces.
- [ ] Auth tokens never logged.
- [ ] Request bodies don't include client-only data (e.g. cached session info that shouldn't be sent).
- [ ] Response parsing rejects unexpected fields (don't trust unknown fields to be benign).
- [ ] HTTPS-only — http:// requests rejected.

### UX

- [ ] N/A — repository is internal; user-facing UX in the calling VM/screen.

### i18n

- [ ] Error messages from server are passed through as-is; localization at the VM/UI layer.

### Observability

- [ ] Each request logged at DEBUG (method + URL, no auth header).
- [ ] Each error logged at WARN with status code (no PII).
- [ ] Sonar coverage ≥85%.

## BDD Scenarios

**Scenario: takeSeat happy path**

- **Given** an authenticated iOS user
- **And** a room exists with seat 2 empty
- **When** `iosRoomRepository.takeSeat(roomId="R", seat=2)` is called
- **Then** the HTTP call goes to `POST /api/rooms/R/takeSeat` with body `{seat: 2}`
- **And** the response 200 is parsed into `Result.Success(SeatTaken(roomId="R", seat=2))`

**Scenario: takeSeat — 409 conflict (seat taken)**

- **Given** the same setup but the server returns 409 with body `{error: "seat_already_taken"}`
- **When** the call is made
- **Then** the result is `Result.Failure(Conflict(reason="seat_already_taken"))`

**Scenario: leave — network failure**

- **Given** no connectivity
- **When** `leave(roomId="R")` is called
- **Then** result is `Result.Failure(NetworkException)`
- **And** no partial state mutation

**Scenario: kick — 403 forbidden (non-owner)**

- **Given** a non-owner user
- **When** they call `kick(roomId="R", targetUid="U")`
- **Then** server returns 403 with body `{error: "not_owner"}`
- **And** result is `Result.Failure(Forbidden(reason="not_owner"))`

**Scenario: Auth token expiry triggers refresh**

- **Given** an expired auth token
- **When** any mutation is called
- **Then** the implementation attempts token refresh
- **And** on successful refresh, the original call is retried
- **And** the final result reflects the original call's outcome

**Scenario: Malformed response logged + non-fatal**

- **Given** server returns 200 with body that's missing required `roomId` field
- **When** the response is parsed
- **Then** result is `Result.Failure(InvalidResponse)`
- **And** Crashlytics non-fatal logged

## Test Plan (TDD)

### Red

1. Locate `IosRoomRepositoryImpl.kt`; verify production methods.
2. Create FakeHttpClient (shared with Android tests if possible) or use Ktor's `MockEngine`.
3. Add test file; ~20 cases per AC.
4. Run `./gradlew :shared:jvmTest --tests "*IosRoomRepository*"` → RED on uncovered error paths.

### Green

1. Add minimum production fixes for any surfaced bugs (typically error-mapping gaps).
2. Re-run → GREEN.
3. Sonar coverage ≥85%.

## Out of Scope

- **Refactoring the repository interface** — only iOS impl tests.
- **Server-side endpoint tests** — backend scope.
- **End-to-end voice-room flow** — journey-test scope.

## Dependencies

- **SHY-0001** + **SHY-0032** — process.
- **SHY-0004** — room mutation P3 deploy verify (ensures the Express endpoints these tests assume exist actually exist).
- **SHY-0014** — RoomServiceController tests (consumer of the repository).
- Ktor MockEngine or shared FakeHttpClient.

## Risks & Mitigations

- **Risk:** Android RoomRepositoryImpl tests don't fully establish the FakeHttpClient pattern; iOS may need extras. **Mitigation:** reuse what exists; extend as needed.
- **Risk:** iosTest source set not configured; tests live in jvmTest as proxy. **Mitigation:** acceptable per roadmap fix description ("iosMain or jvmTest with fakes"); document the choice.
- **Risk:** Surfaced error-mapping bug means iOS users currently see different error UX than Android. **Mitigation:** fix in this PR; document parity contract.

## Definition of Done

- [ ] Test file exists; ≥20 cases pass.
- [ ] Any surfaced bugs fixed.
- [ ] Sonar coverage ≥85%.
- [ ] Reviewer ZERO findings.
- [ ] Per-type Done gate (`bug` → auto-merge + dev smoke on iOS simulator).
- [ ] PR merged.
- [ ] `status: Done`; `pr:` populated; bug catalogue in Notes.

## Notes (running log)

- 2026-06-07 ~21:18 BST — Refined under SHY-0032. Tier 3 iOS parity coverage.
- 2026-06-07 — Skeleton from `convert-roadmap-to-stories.sh` PR-bundle `PR-F1` (G014).

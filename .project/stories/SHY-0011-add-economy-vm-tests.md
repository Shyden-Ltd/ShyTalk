---
id: SHY-0011
status: Draft
owner: claude
created: 2026-06-07
priority: P0
effort: M
type: bug
roadmap_ids: [G003-D2]
pr:
---

# SHY-0011: Wallet + Gifting + TransactionHistory VM tests

## User Story

As the ShyTalk operator preparing for public launch with real currency flows, I want **`WalletViewModel`, `GiftingViewModel`, and `TransactionHistoryViewModel` to have adversarial unit-test coverage in commonTest covering state machines, integer correctness, idempotency, race conditions, and error recovery**, so that money math + transaction state cannot silently corrupt user balances.

## Why

The three economy ViewModels are currently **uncovered**:

- **`WalletViewModel`** (`shared/src/commonMain/kotlin/com/shyden/shytalk/feature/shop/WalletViewModel.kt`) — drives the wallet screen; owns the user's coin balance display + the top-up/withdrawal flow. A bug here would let the UI show an inflated balance the backend doesn't honour.
- **`GiftingViewModel`** (`shared/src/commonMain/kotlin/com/shyden/shytalk/feature/.../GiftingViewModel.kt` — locate exact path at PR-start) — handles sending gifts in rooms / chats; debits sender, credits recipient, dispatches the gift animation. An idempotency bug would let a double-tap charge twice; a race would let two gifts charge against insufficient funds.
- **`TransactionHistoryViewModel`** (`shared/src/commonMain/kotlin/com/shyden/shytalk/feature/shop/TransactionHistoryViewModel.kt`) — paginated transaction list. A pagination bug would show stale data; an ordering bug would make audit-of-spending unreliable.

These are part of G003 (the 15-VM coverage gap) — specifically G003-D2 in the roadmap's subset breakdown (line 55):

> G003-D2: Sev: 🔴 Critical. Test — WalletViewModel, GiftingViewModel, TransactionHistoryViewModel. Economy VMs. Fix: TDD per VM. Scope: M.

Already P0 in the original skeleton; kept P0 under SHY-0032's Tier 2 reliability tier. Money correctness is foundational — every higher-level economy feature (shop, subscription, backpack, daily reward) builds on these VMs being right.

## Acceptance Criteria

### Happy path

- [ ] `shared/src/commonTest/kotlin/com/shyden/shytalk/feature/shop/WalletViewModelTest.kt` exists with ≥20 test cases.
- [ ] `shared/src/commonTest/kotlin/com/shyden/shytalk/feature/.../GiftingViewModelTest.kt` exists with ≥25 test cases (gifting is the highest-risk surface).
- [ ] `shared/src/commonTest/kotlin/com/shyden/shytalk/feature/shop/TransactionHistoryViewModelTest.kt` exists with ≥15 test cases.
- [ ] State machine coverage for each VM:
  - Initial state asserts default values (loading=true OR empty, balance=0, etc.).
  - Loading → Success transition with correct data.
  - Loading → Error transition with typed error.
  - Refresh after Error returns to Loading then Success.
  - Cancel mid-load returns to Initial.
- [ ] All tests pass via `./gradlew :shared:jvmTest --tests "*WalletVM*" --tests "*GiftingVM*" --tests "*TransactionHistoryVM*"`.
- [ ] Sonar coverage on the 3 VMs ≥90% (small-surface VMs; high coverage is achievable).

### Error paths

- [ ] **WalletViewModel**: backend returns 401 → VM emits `Error.NotAuthenticated`; UI redirects to sign-in (verified by observing the event flow).
- [ ] **WalletViewModel**: backend returns 500 → VM emits `Error.ServerError` with retry-after hint; balance display unchanged.
- [ ] **WalletViewModel**: network unavailable → VM emits `Error.Network`; balance display shows last-known-good with stale indicator.
- [ ] **WalletViewModel**: backend returns non-integer balance (impossible but defensive) → VM emits `Error.Invalid` and logs Crashlytics non-fatal.
- [ ] **GiftingViewModel**: insufficient funds → VM emits `Error.InsufficientFunds`; no API call made; UI shows top-up prompt.
- [ ] **GiftingViewModel**: 409 conflict (duplicate request ID) → VM treats as idempotent success (no double-charge); shows confirmation.
- [ ] **GiftingViewModel**: 500 mid-flight → VM emits `Error.RetryRequired`; the gift API call's request-ID is preserved so retry is idempotent.
- [ ] **GiftingViewModel**: recipient blocked (403) → VM emits `Error.RecipientUnavailable`; no charge.
- [ ] **TransactionHistoryViewModel**: empty result → VM emits `Empty` state (distinct from `Loading` and `Error`).
- [ ] **TransactionHistoryViewModel**: pagination next-page returns 404 → VM treats as end-of-list (not error).

### Edge cases (adversarial)

- [ ] **WalletViewModel**: backend returns balance `0` → distinguishable from "not loaded" (`null`); UI shows "0 coins" not blank.
- [ ] **WalletViewModel**: backend returns balance `Long.MAX_VALUE` → no integer overflow; UI shows scientific notation or capped display ("9,223,372,036,854,775,807+" if needed).
- [ ] **WalletViewModel**: rapid refresh (5 refreshes within 100ms) → VM debounces; only one API call dispatched.
- [ ] **GiftingViewModel** — double-tap idempotency: user double-taps send button → VM debounces OR sends with the same request-ID → backend dedupes → exactly one charge.
- [ ] **GiftingViewModel** — concurrent gifts: user sends two distinct gifts within 100ms → both succeed OR the second blocks until the first completes (verify which the production code does + assert it).
- [ ] **GiftingViewModel** — gift mid-room-leave race: user sends gift then immediately leaves the room → gift either completes (recipient still credited) OR is cancelled cleanly (no half-charge).
- [ ] **GiftingViewModel** — animation queue ordering: 5 gifts sent in rapid succession → animations play in send order (verifies integration with `AnimationQueue` from SHY-0013).
- [ ] **TransactionHistoryViewModel** — pagination race: scroll fast → fetches don't double-load the same page; deduplicated by `pageToken`.
- [ ] **TransactionHistoryViewModel** — list mutation during fetch: new transaction arrives via push while paginating → the new transaction is inserted at top, not appended; pagination state preserved.
- [ ] **TransactionHistoryViewModel** — clock skew: transaction with future timestamp (server clock ahead of device) → displayed correctly, not filtered as invalid.
- [ ] **All three VMs** — coroutine cancellation: ViewModelScope cancellation mid-flight → no orphaned coroutines; verified by `TestCoroutineScheduler` assertion.

### Performance

- [ ] Each test runs within 100ms (uses `TestCoroutineScheduler` for deterministic time).
- [ ] Full suite (~60 tests) within 30s.
- [ ] No detectable memory leak after 1000 state transitions per VM.

### Security

- [ ] **WalletViewModel**: balance state is never logged with the actual value (logs only "balance loaded" + size of payload).
- [ ] **GiftingViewModel**: request-ID generation uses cryptographically-secure random (NOT `Math.random()` or `Date.now()`); verified by reading the production code + asserting in test that consecutive IDs differ.
- [ ] **GiftingViewModel**: recipient UID never exposed in logs (privacy).
- [ ] **All three VMs**: no client-side balance modification path (the VM cannot mutate balance directly; only via API response — verified by inspecting the VM API surface).

### UX

- [ ] Loading states surface to the UI within 50ms of action (no janky "nothing happens" gap).
- [ ] Error states have actionable recovery: retry button for transient, top-up button for insufficient funds, sign-in for not-authenticated.
- [ ] Optimistic UI: if implemented (e.g. WalletViewModel optimistically decreases balance pending API confirmation), the test asserts rollback on error.
- [ ] Pagination loading indicator distinct from initial load.

### i18n

- [ ] All user-facing strings used by these VMs (success messages, error messages, currency display) resolve in all 20 locales; the VM tests do NOT verify localization (that's `compose-resources-locale-parity.test.js`) but DO use `Res.string.*` references.
- [ ] Currency formatting respects locale: `1,234 coins` (en-US) vs `1.234 coins` (de) — verified by a test that swaps locale + asserts format.

### Observability

- [ ] State transitions logged at DEBUG level: `Log.d("WalletVM", "state: $old → $new")`.
- [ ] Error transitions logged at WARN level with error class (not message): `Log.w("WalletVM", "error: ${error::class.simpleName}")`.
- [ ] Crashlytics non-fatal on invariant violations (balance becomes negative, duplicate request-ID dispatched, etc.).
- [ ] Coroutine job count metric (helpful for leak detection) optional.

## BDD Scenarios

**Scenario: WalletViewModel — initial load happy path**

- **Given** a fresh `WalletViewModel` with a `FakeWalletRepository` returning balance `500`
- **When** the VM is initialized
- **Then** state transitions: `Initial(loading=true) → Success(balance=500)`
- **And** no errors emitted

**Scenario: GiftingViewModel — double-tap dedupe**

- **Given** the user has 1000 coins
- **And** a `GiftingViewModel` ready to send a 100-coin gift
- **When** `sendGift()` is called twice within 50ms
- **Then** exactly one API call is dispatched (verified via FakeRepository call count)
- **And** the final balance reflects exactly one charge (900 coins)

**Scenario: GiftingViewModel — insufficient funds blocks the call**

- **Given** the user has 50 coins
- **When** `sendGift(100)` is called
- **Then** state transitions to `Error.InsufficientFunds`
- **And** no API call is dispatched
- **And** the user sees the top-up prompt action available

**Scenario: TransactionHistoryViewModel — pagination boundary**

- **Given** `TransactionHistoryViewModel` has loaded page 1 (10 items)
- **When** `loadNextPage()` is called and the backend returns 5 items + no next-page token
- **Then** the displayed list has 15 items
- **And** `hasMore` is false
- **And** subsequent `loadNextPage()` calls are no-ops

**Scenario: TransactionHistoryViewModel — new push during pagination**

- **Given** `TransactionHistoryViewModel` has loaded page 1
- **And** a push notification fires with a new transaction
- **When** the VM observes the push
- **Then** the new transaction is inserted at the top of the list (not appended)
- **And** the pagination state (next-page token, current cursor) is preserved
- **And** subsequent `loadNextPage()` still loads page 2 correctly

**Scenario: GiftingViewModel — request-ID is cryptographically random**

- **Given** `GiftingViewModel` generates 100 request-IDs in rapid succession
- **When** the IDs are collected
- **Then** all 100 are distinct
- **And** no two IDs share a common timestamp-derived prefix

**Scenario: Concurrent ViewModel scope cancellation**

- **Given** all three VMs are running with in-flight API calls
- **When** the parent ViewModelScope is cancelled (e.g. navigation away)
- **Then** all in-flight coroutines are cancelled within 10ms
- **And** no completion callbacks fire post-cancellation
- **And** no leaked coroutines remain (verified via `TestCoroutineScheduler.testScheduler.activeChildren`)

## Test Plan (TDD)

### Red

1. Locate the 3 VMs + their existing FakeRepositories (if any). Grep `FakeWalletRepository`, `FakeGiftRepository`, `FakeTransactionRepository`.
2. If FakeRepositories don't exist, create them in `shared/src/commonTest/kotlin/.../fake/` mirroring the production repository interfaces.
3. Add the 3 test files; write all ~60 test cases.
4. Run `./gradlew :shared:jvmTest --tests "*WalletVM*"` etc → RED on tests where the VM has untested behaviour.
5. Specific RED expectations:
   - Double-tap dedupe likely RED if no debounce/idempotency in place.
   - Concurrent-gifts race likely RED.
   - Pagination push insertion likely RED (typical implementation only handles append).
   - Some state-transition tests likely RED due to missing intermediate states.

### Green

1. For each surfaced bug:
   - Add minimum fix (debounce, idempotency token, race-resolution, state-machine completeness).
   - Reviewer agent validates fixes don't overreach.
2. Re-run suite → GREEN.
3. Sonar coverage ≥90% per file.

## Out of Scope

- **Refactoring the economy backend** (Express API gift/wallet routes) — VM tests only; backend tests are separate.
- **Adding new economy features** (subscriptions, etc.) — covered by SHY-0008's BDD expansion.
- **Replacing the FakeRepository pattern** with another test-double mechanism — keep consistent with existing VM test patterns.
- **End-to-end gift flow** (UI to backend to recipient device) — out of scope; that's journey-test territory.

## Dependencies

- **SHY-0001** + **SHY-0032** — process dependencies.
- **SHY-0013** (AnimationQueue tests) — gifting integrates with AnimationQueue; if AnimationQueue tests reveal a contract change, this SHY may need to update.
- Existing FakeRepository pattern (verify in `shared/src/commonTest/.../fake/`).
- `kotlinx-coroutines-test`, `kotlin.test`.

## Risks & Mitigations

- **Risk:** Money-math bug surfaces (e.g. integer overflow at large balances). **Mitigation:** GOOD outcome — fix in this PR.
- **Risk:** Idempotency tests reveal the gift API has no idempotency token at all. **Mitigation:** if so, fix in this PR (add the token) + file follow-up SHY for Express-side dedupe.
- **Risk:** Concurrent-gift test is flaky due to coroutine scheduling. **Mitigation:** use `TestCoroutineScheduler` deterministically.
- **Risk:** The 3 VMs share state via a singleton (e.g. `WalletState` koin singleton) → tests interfere. **Mitigation:** koin reset between tests; `@BeforeTest` cleanup; test isolation per [[feedback-test-isolation-no-leaks]].

## Definition of Done

- [ ] Three test files exist; ≥60 test cases pass.
- [ ] Any surfaced production bugs fixed.
- [ ] Sonar coverage ≥90% on the 3 VMs.
- [ ] Reviewer reports ZERO findings.
- [ ] Per-type Done gate satisfied (`bug` → auto-merge once green).
- [ ] PR merged.
- [ ] `status: Done`; `pr:` populated; bug catalogue in Notes.

## Notes (running log)

- 2026-06-07 ~20:52 BST — Refined under SHY-0032. P0 confirmed (Tier 2 reliability — money correctness).
- 2026-06-07 — Skeleton generated by `scripts/convert-roadmap-to-stories.sh` from PR-bundle `PR-D2` (roadmap_ids: G003-D2).

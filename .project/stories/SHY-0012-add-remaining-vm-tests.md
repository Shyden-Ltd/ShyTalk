---
id: SHY-0012
status: Draft
owner: claude
created: 2026-06-07
priority: P0
effort: L
type: bug
roadmap_ids: [G003-D3]
pr:
---

# SHY-0012: 10 remaining ViewModel test files (Messaging + Profile + Settings + Daily + Splash)

## User Story

As the ShyTalk operator, I want **the remaining 10 untested ViewModels — `ConversationListViewModel`, `GroupSetupViewModel`, `PrivateChatViewModel`, `ReportReviewViewModel`, `FunFactSplashViewModel`, `DailyRewardViewModel`, `AppSettingsViewModel`, `RoomSettingsViewModel`, `GiftWallViewModel`, `RequiredDOBViewModel` — each covered by an adversarial commonTest file**, so that the VM-coverage chapter (G003 in the roadmap) is fully closed and every user-facing screen has its business logic tested in isolation from the UI.

## Why

After SHY-0010 (Home + Gacha) and SHY-0011 (Wallet + Gifting + TransactionHistory) ship, 10 ViewModels still lack direct test coverage. These cover:

- **Messaging cluster**: `ConversationListViewModel`, `GroupSetupViewModel`, `PrivateChatViewModel`, `ReportReviewViewModel` — direct-message functionality + report flows.
- **Profile cluster**: `GiftWallViewModel`, `RequiredDOBViewModel` — public profile data + onboarding age collection.
- **Settings cluster**: `AppSettingsViewModel`, `RoomSettingsViewModel` — app-wide + room-specific settings.
- **Daily/Splash cluster**: `DailyRewardViewModel`, `FunFactSplashViewModel` — first-run + recurring engagement flows.

Roadmap row G003-D3 (line 56 of `.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md`):

> G003-D3: Sev: 🔴 Critical. Test — ConversationList, GroupSetup, PrivateChat, ReportReview, FunFactSplash, DailyReward, AppSettings, RoomSettings, GiftWall, RequiredDOB. Remaining 10 VMs. Fix: TDD per VM. Scope: L.

P0 confirmed under SHY-0032's Tier 2 reliability tier. This SHY is intentionally the LAST of the 3 VM batches (SHY-0010, 0011, 0012) so that the foundational FakeRepository pattern is already established by the earlier two before tackling this larger batch.

**Pickup-time split protocol**: 10 VMs in one PR is large. SHY IDs cannot be suffixed with `A/B/C` (the validator rejects non-`SHY-NNNN` formats). If the pickup engineer determines the diff exceeds review tolerance (>800 LOC), they MUST:

1. File 3 new SHY IDs by claiming the next sequential numbers (e.g. SHY-NNNN, SHY-NNNN+1, SHY-NNNN+2 — the next free IDs in the index at pickup time), each fully refined per [[feedback-no-skeleton-stories-fully-refined]] using the per-VM AC bullets in this story as the seed.
2. Suggested split: cluster A = messaging (Conversation/GroupSetup/PrivateChat/ReportReview); cluster B = profile + settings (GiftWall/RequiredDOB/AppSettings/RoomSettings); cluster C = daily + splash (DailyReward/FunFactSplash).
3. Mark SHY-0012 `status: Cancelled` with a Notes entry pointing at the three replacement SHY IDs.
4. The architect agent must validate each new SHY before any TDD code is written.

If the pickup engineer determines the full 10-VM scope fits in one PR (≤800 LOC and reviewer agent doesn't force a split), then SHY-0012 ships as one PR and the split protocol is unused.

## Acceptance Criteria

### Happy path

For each of the 10 ViewModels, a `shared/src/commonTest/kotlin/com/shyden/shytalk/feature/<cluster>/<VmName>Test.kt` file exists with:

- [ ] State machine coverage: Initial → Loading → Success/Empty/Error transitions; refresh; cancel.
- [ ] ≥10 test cases per VM (so ~100 test cases total).
- [ ] All tests pass via `./gradlew :shared:jvmTest`.
- [ ] Sonar coverage ≥85% per VM.
- [ ] FakeRepositories established by SHY-0010 and SHY-0011 are reused; new fakes only where the VM uses a repo not yet faked.

**Per-VM AC bullets (additive to the generic above):**

- [ ] **ConversationListViewModel**: lists user's DMs; covers (a) empty inbox state, (b) pagination, (c) new message arrival via push (insert at top, no dupes), (d) blocked-user filter, (e) unread-count accuracy.
- [ ] **GroupSetupViewModel**: creates a group chat; covers (a) participant selection (min 2, max N), (b) duplicate participant rejection, (c) name validation (length, banned terms via ModerationFilter), (d) create-failure rollback.
- [ ] **PrivateChatViewModel**: 1-on-1 messaging; covers (a) send happy path, (b) typing indicator, (c) read receipt, (d) message-failure retry, (e) blocked-recipient mid-conversation, (f) message order under concurrent sends.
- [ ] **ReportReviewViewModel**: user submits a report (other user, message, room); covers (a) form validation, (b) submit-success, (c) submit-failure, (d) duplicate-report prevention (idempotency), (e) attachment upload (if supported).
- [ ] **FunFactSplashViewModel**: shown on app cold-start with a rotating fact; covers (a) fact rotation (no repeat within N), (b) skip-to-app, (c) preference to disable, (d) cold-start vs warm-start behaviour, (e) i18n correctness per locale.
- [ ] **DailyRewardViewModel**: daily-streak reward claim; covers (a) available state, (b) claimed state (cannot double-claim), (c) streak-broken handling, (d) reward animation choreography, (e) clock-skew (server vs device time).
- [ ] **AppSettingsViewModel**: app-wide preferences (notifications, theme, language); covers (a) load defaults, (b) save change, (c) save-failure rollback, (d) reset-to-defaults, (e) sign-out action.
- [ ] **RoomSettingsViewModel**: per-room owner-editable settings (name, description, privacy, banned users); covers (a) load, (b) save (owner-only), (c) non-owner read-only, (d) banned-user list mutations, (e) topic change with ModerationFilter check.
- [ ] **GiftWallViewModel**: paginated gift history per profile; covers (a) load, (b) pagination, (c) empty state, (d) gift detail expansion, (e) sender-blocked-by-viewer filter.
- [ ] **RequiredDOBViewModel**: onboarding DOB collection; covers (a) date picker validation (min age, max age), (b) submit happy path, (c) submit failure, (d) age-gate trigger if under-18 (redirect to AgeVerificationSubmit), (e) re-prompt if pre-existing invalid DOB.

### Error paths

For each VM:

- [ ] 401 → `Error.NotAuthenticated`; redirect-to-sign-in event.
- [ ] 403 → `Error.Forbidden`; appropriate UX (e.g. "you don't have permission").
- [ ] 404 → `Error.NotFound` (for resource lookups).
- [ ] 5xx → `Error.ServerError`; retry path.
- [ ] Network unavailable → `Error.Network`; last-known-good state preserved where applicable.
- [ ] Invalid response (server returned garbage) → `Error.Invalid` + Crashlytics non-fatal.

### Edge cases (adversarial)

- [ ] All VMs that fetch data debounce rapid-refresh (5 calls within 100ms → 1 API call).
- [ ] All VMs that send data debounce double-tap (2 calls within 50ms → 1 API call).
- [ ] All VMs that use coroutines clean up on scope cancellation within 10ms (no orphans).
- [ ] All VMs that observe push notifications merge correctly (no dupes, push-during-load handled).
- [ ] Per-VM specific edges:
  - **ConversationListVM**: 10,000 conversations don't blow memory (lazy-load); deletion of a conversation propagates within 1s.
  - **GroupSetupVM**: max-participant boundary (e.g. 49 vs 50 vs 51); concurrent-edit race (operator + reviewer adding participants).
  - **PrivateChatVM**: message ordering under 100 concurrent sends; missing message detection.
  - **ReportReviewVM**: report-spam (10 reports in 1 minute) rate-limited.
  - **FunFactSplashVM**: empty fact catalogue → graceful fall-through to app.
  - **DailyRewardVM**: clock travel (device clock moved forward then back) doesn't double-credit.
  - **AppSettingsVM**: notification-preference change → push permission re-evaluation triggered.
  - **RoomSettingsVM**: owner-transfer mid-edit invalidates editor's pending changes cleanly.
  - **GiftWallVM**: gift-deletion (rare) propagates; pagination state preserved.
  - **RequiredDOBVM**: dates in non-Gregorian calendars (handled by `kotlinx.datetime`); leap-year DOB boundary.

### Performance

- [ ] Each VM initialises within 200ms with FakeRepositories.
- [ ] All transitions <50ms.
- [ ] Test suite (~100 cases) within 60s.
- [ ] No memory leaks after 1000 state transitions per VM.

### Security

- [ ] No VM logs PII (user IDs, message content, profile DOB, settings values).
- [ ] All write VMs use cryptographically-random request-IDs for idempotency.
- [ ] **ReportReviewVM**: report content is never logged client-side (privacy of the reporter).
- [ ] **RequiredDOBVM**: DOB stored only via SecureStorage (SHY-0015 dependency); never in logs.
- [ ] **RoomSettingsVM**: ban-list mutations are server-authoritative; client-side preview not authoritative.
- [ ] **GroupSetupVM**: group-name moderation via ModerationFilter (SHY-0013 dependency); banned name rejected client-side AND server-side.

### UX

- [ ] All VMs emit loading state within 50ms.
- [ ] All error states have actionable recovery (retry / sign-in / top-up / etc.).
- [ ] Optimistic UI patterns documented + tested where used (e.g. GroupSetupVM optimistically shows the group while server is creating).

### i18n

- [ ] All user-facing strings via `Res.string.*` references; locale-change re-fetches where data is locale-dependent (room names, fun facts).
- [ ] **FunFactSplashVM**: facts available in all 20 locales (verified via fixture); fallback to English if locale missing.
- [ ] **DailyRewardVM**: streak number format respects locale (`7天` vs `7 days`).
- [ ] **RequiredDOBVM**: date picker uses locale-appropriate format (DMY vs MDY vs YMD).

### Observability

- [ ] State transitions logged at DEBUG per VM.
- [ ] Errors logged at WARN with error class (not full message — PII risk).
- [ ] Crashlytics non-fatals on invariant violations.
- [ ] Sonar coverage ≥85% per VM.

## BDD Scenarios

**Scenario: ConversationListViewModel — push delivers new message during pagination**

- **Given** `ConversationListViewModel` has loaded page 1 (10 conversations)
- **And** a push fires with `new_message: conv-X`
- **When** the VM observes the push
- **Then** `conv-X` is bumped to the top of the list (or inserted if new conversation)
- **And** unread-count increments
- **And** pagination state is preserved

**Scenario: GroupSetupViewModel — banned group name rejected**

- **Given** the user enters a group name containing a banned term (per ModerationFilter)
- **When** `validate()` runs before submit
- **Then** state emits `Error.NameRejected(reason="moderation")`
- **And** no API call is dispatched

**Scenario: PrivateChatViewModel — concurrent message order**

- **Given** 100 messages enqueued in rapid succession
- **When** the chat history is observed
- **Then** all 100 messages appear in send-order
- **And** no message is dropped
- **And** server-side acks match client-side order

**Scenario: ReportReviewViewModel — duplicate-report prevention**

- **Given** the user submits a report for `user-X`
- **When** they immediately submit a second report for the SAME `user-X` within 30 seconds
- **Then** the VM treats it as a duplicate (server-side dedupe via request-ID)
- **And** UX shows "you already reported this user"

**Scenario: DailyRewardViewModel — clock-travel doesn't double-credit**

- **Given** the user has claimed today's reward
- **When** they change the device clock back 24 hours and re-open the app
- **Then** the VM detects the clock skew (server-time check)
- **And** state shows `Claimed` (not `Available`)
- **And** no double-credit attempted

**Scenario: AppSettingsViewModel — notification preference triggers push permission re-eval**

- **Given** the user toggles `notifications: ON` from OFF
- **When** save completes
- **Then** an event is emitted to re-evaluate push permission
- **And** if permission is denied, the PushPermissionDeniedBanner (SHY-0006) becomes visible on Home

**Scenario: RoomSettingsViewModel — non-owner sees read-only view**

- **Given** the user is a member but not owner of a room
- **When** `RoomSettingsViewModel` loads
- **Then** state is `Success(editable=false, fields=...)`
- **And** the UI renders fields as non-interactive

**Scenario: GiftWallViewModel — pagination preserves order under deletion**

- **Given** GiftWall has 50 gifts loaded across 5 pages
- **When** the gift on page 3 is deleted by the giver (rare flow)
- **Then** the list updates to 49 gifts
- **And** pagination state recalibrates (page 5 may collapse)
- **And** no duplicate or missing entries

**Scenario: RequiredDOBViewModel — under-18 triggers age-gate**

- **Given** the user enters DOB indicating age 16
- **When** submit is called
- **Then** state emits `AgeGate(redirectTo=AgeVerificationSubmit)`
- **And** DOB is NOT persisted client-side until age-verification submits succeed

## Test Plan (TDD)

### Red

1. Locate all 10 VMs; verify paths.
2. For each VM, identify required FakeRepositories; reuse from SHY-0010/0011 where possible.
3. Add 10 test files; ~10 test cases each (so ~100 total).
4. Run `./gradlew :shared:jvmTest --tests "*VM*"` → RED on undertested paths.
5. Expected RED highlights:
   - Push merge logic likely RED across messaging VMs.
   - Clock-skew handling in DailyRewardVM likely RED.
   - Idempotency on ReportReviewVM likely RED.

### Green

1. For each surfaced bug → minimum fix → re-run → GREEN.
2. Sonar coverage ≥85% per VM.
3. Manual smoke on dev device: walk through each screen; verify no regression.

## Out of Scope

- **Refactoring VMs beyond minimum fixes** for surfaced bugs.
- **Adding new VM features** — only coverage.
- **End-to-end journey tests** — covered by feature files.
- **Server-side coverage** — separate.

## Dependencies

- **SHY-0010** + **SHY-0011** — FakeRepository pattern established by these earlier batches.
- **SHY-0013** — ModerationFilter (used by GroupSetupVM, RoomSettingsVM).
- **SHY-0015** — SecureStorage (used by RequiredDOBVM).
- **SHY-0024** — NavGraph migration (RequiredDOBVM's age-gate redirect becomes routable post-migration).
- **SHY-0006** — PushPermissionStore (AppSettingsVM triggers re-eval).
- Existing FakeRepository conventions.

## Risks & Mitigations

- **Risk:** 10 VMs in one PR balloons review surface. **Mitigation:** pickup-time split protocol documented in Why section above — pickup engineer files new SHY IDs (next free in index) for each cluster + cancels SHY-0012; each VM's AC is independently complete so splitting is mechanical.
- **Risk:** ReportReviewVM may not exist as a separate VM (just a screen with inline state). **Mitigation:** verify at pickup; if no VM, either extract one or document why the screen handles it inline.
- **Risk:** Several VMs surface real production bugs simultaneously → fix scope > test scope. **Mitigation:** reviewer agent may force a split; acceptable.
- **Risk:** FakeRepositories needed for some VMs don't exist yet; setup overhead high. **Mitigation:** SHY-0010/0011 ship first; their FakeRepositories establish the pattern.
- **Risk:** Locale-dependent tests are flaky due to fixture mismatch. **Mitigation:** use a fixed locale per test; explicit `Locale("en")` setup.

## Definition of Done

- [ ] 10 test files exist; ≥100 cases pass.
- [ ] Sonar coverage ≥85% per VM.
- [ ] Any surfaced production bugs fixed (or split into follow-up SHYs with documented rationale).
- [ ] Reviewer reports ZERO findings (across the split sub-PRs if applicable).
- [ ] Per-type Done gate satisfied (`bug` → auto-merge per VM cluster).
- [ ] PR(s) merged.
- [ ] `status: Done`; `pr:` populated.

## Notes (running log)

- 2026-06-07 ~21:10 BST — Refined under SHY-0032. P0 Tier 2; largest VM batch (10 VMs).
- 2026-06-07 — Skeleton generated by `scripts/convert-roadmap-to-stories.sh` from PR-bundle `PR-D3` (roadmap_ids: G003-D3).

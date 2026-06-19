---
id: SHY-0130
status: Draft
owner: claude
created: 2026-06-19
priority: P1
effort: L
type: bug
roadmap_ids: []
public: false
mvp: false
---

# SHY-0130: Conversations `list` denied + DM threads corrupted — Android coerces participant uniqueIds to Long

## User Story

As a **signed-in member opening the Messages screen**, I want **my direct-message conversations to load (and the threads I started to be readable by their participants)**, so that **I can see and continue my DMs instead of an empty Messages screen or threads that silently vanish**.

## Why

The companion finding to SHY-0102 (rooms `list` denial). The original SHY-0102 triage explicitly **ruled out** an id-type mismatch for conversations ("the app model uses `Set<String>` consistently; seeded `participantIds` are strings") — but that only inspected the **model**, not the Android repository **implementation**. A 2026-06-19 code investigation (operator-requested, while PR #1480 was CI-blocked) found the real root cause:

**The canonical participant-id type is `String` EVERYWHERE except Android's repository impl:**
- Model: `Conversation.participantIds: List<String>` (`core/model/Conversation.kt:37`).
- Rule: `string(callerUniqueId()) in resource.data.participantIds` (`firestore.rules:324-329`; `callerUniqueId() = request.auth.token.uniqueId`).
- iOS: `IosPrivateMessageRepositoryImpl` passes the uniqueId as a **String** and even documents it (`// participantIds is stored as STRINGS … for string(callerUniqueId()) in resource.data.participantIds`).
- Express: `(conv?.participantIds || []).map(String)` and `String(req.auth.uniqueId)` (`conversations.js:57,220`).

**Android (`PrivateMessageRepositoryImpl`) is the lone outlier — it coerces the uniqueId to `Long` via `toLongOrNull() ?: x` in THREE places:**
1. `prefetchConversations` query — `whereArrayContains("participantIds", uid.toLongOrNull() ?: uid)` (L40).
2. `getConversations` query — same Long-coerced `array-contains` (L65).
3. `getOrCreateConversation` **write** — writes `participantIds` as `[uid1.toLongOrNull() ?: uid1, uid2.toLongOrNull() ?: uid2]` (L100-101).

**Two distinct failure modes:**
- **Reads:** an `array-contains <Long>` query cannot match string `participantIds`, and the rule needs the **string** form, so the `list` is denied/empty — the Messages screen renders empty (this is the originally-observed conversations denial).
- **Writes:** a conversation **created on Android** persists `participantIds` as numbers, so the rule's `string(callerUniqueId()) in resource.data.participantIds` is false even for a single-doc `get` — the thread becomes unreadable by **every** participant (silent data corruption, not just a query bug).

This is the same class of UK OSA #17 segregation-read bug as SHY-0102, plus a write-side data-integrity defect, so it is at least as severe.

## Acceptance Criteria

### Happy path
- [ ] On Android, a member's `getConversations` query returns their DM threads — no `PERMISSION_DENIED`, no empty Messages screen when threads exist.
- [ ] On Android, `prefetchConversations` (splash warm-up) issues the same string-typed query and succeeds.
- [ ] A conversation **created on Android** (`getOrCreateConversation`) writes `participantIds` as **strings**, and is immediately readable by both participants on Android AND iOS.
- [ ] iOS Messages continues to load (regression guard — iOS was already correct; must stay correct).

### Error paths
- [ ] A member listing conversations they are NOT a participant of is still denied (DM-privacy preserved — inherited from the new rule harness `assertFails`).
- [ ] A `list` query that does not constrain `participantIds` to the caller fails CLOSED (deny), never opens access.

### Edge cases
- [ ] `crossCohortAtMigration: true` threads remain hidden from `list` and `get` (the existing OSA migration gate at `firestore.rules:326,329` is preserved).
- [ ] Empty result set (0 matching conversations) returns an empty list, NOT a `PERMISSION_DENIED`.
- [ ] **Legacy data:** conversation docs already written by old Android builds with **numeric** `participantIds` are migrated to strings (Admin-SDK backfill) so their participants regain access; the migration is idempotent and dev+prod-scoped.
- [ ] `getOwnedGroupCount` (`PrivateMessageRepositoryImpl:756`, lists by `createdBy==userId, isGroup`) is verified against the `list` rule — if it is denied (it does not constrain `participantIds`), it is fixed in the same PR (zero-gap) by adding the `array-contains string(uid)` constraint or routing the count server-side.

### Performance
- [ ] N/A — the fix removes a type coercion; no added round-trip on the read path. The one-time Admin-SDK migration runs off the hot path (script/endpoint, batched).

### Security
- [ ] Age-segregation (UK OSA #17) + DM-privacy invariants are unchanged: the fix does NOT widen read access (it pins the caller's OWN string uniqueId, exactly what the rule compares). Adversarial `assertFails` cases (non-participant, `crossCohortAtMigration:true` hidden) are proven by the new engine harness.
- [ ] **No `firestore.rules` change** (the rule is already correct — it canonicalises on string ids). Therefore **no operator rules-deploy checkpoint**. (If the harness proves a rule change IS needed — e.g. for the `crossCohortAtMigration` list-satisfiability question below — STOP and checkpoint the operator before applying.)

### UX
- [ ] No empty Messages screen when DM threads exist; no silently-vanishing threads. A genuine denial surfaces an actionable state, not a blank screen.

### i18n
- [ ] N/A — no new user-facing strings (the existing conversation-load error path is reused).

### Observability
- [ ] `getConversations`' real-time listener no longer SWALLOWS Firestore errors (`if (error != null …) return` at L72, the same defect fixed for rooms in SHY-0102 I3) — a denied/failed listen is propagated to the Flow (`close(error)`) so it is logged + distinguishable from an empty result in logcat.

## BDD Scenarios

**Scenario: Android member lists their conversations successfully**
- **Given** an authenticated Android member whose string uniqueId is in a conversation's `participantIds`
- **When** the app issues its `getConversations` query (now `array-contains "<uniqueId>"`, a string)
- **Then** the query succeeds (no PERMISSION_DENIED)
- **And** the member's conversations are returned

**Scenario: a conversation created on Android is readable by both participants**
- **Given** an Android member creates a DM via `getOrCreateConversation`
- **When** the participantIds are persisted
- **Then** they are stored as strings (e.g. `["50000050","50000010"]`)
- **And** both participants can `get`/`list` the thread on Android and iOS

**Scenario: non-participant is denied (privacy preserved)**
- **Given** an authenticated member NOT in a conversation's `participantIds`
- **When** the member attempts to list that conversation
- **Then** the query is denied

**Scenario: cross-cohort migrated thread stays hidden**
- **Given** a conversation with `crossCohortAtMigration: true`
- **When** a participant lists their conversations
- **Then** that thread is excluded (rule gate preserved)

**Scenario: legacy numeric-id thread is recovered by the migration**
- **Given** a conversation written by an old Android build with numeric `participantIds`
- **When** the Admin-SDK backfill runs
- **Then** its `participantIds` become the string form
- **And** its participants can read it again

**Scenario: empty conversations list returns empty, not denied**
- **Given** an authenticated member with zero matching conversations
- **When** the app issues the conversations-list query
- **Then** the result is an empty list and no PERMISSION_DENIED is raised

## Test Plan

**RED (write first, must fail / prove the contract against the REAL rules engine):**
- NEW `express-api/tests/firestore-rules/conversations-rules.test.js` (the SHY-0129 `@firebase/rules-unit-testing` pattern) — pins the `match /conversations/{id}` list+get contract:
  - `assertSucceeds(getDocs(query(conversations, where('participantIds','array-contains', '<myUniqueIdString>'))))` for a participant.
  - `assertFails` the **Long**-typed query `where('participantIds','array-contains', <myUniqueIdNumber>)` (proves the Android bug shape is rejected).
  - `assertFails` for a non-participant.
  - `crossCohortAtMigration:true` thread excluded; empty cohort-pinned list returns empty not denied.
  - **Resolves the empirical unknown:** does the participantIds-string constraint ALONE satisfy the `list` rule, or does condition (B) `resource.data.get('crossCohortAtMigration', false) != true` also require a query constraint? Pin whichever the engine proves.
- `app/src/test/java/com/shyden/shytalk/data/repository/PrivateMessageRepositoryImplTest.kt` (host JVM unit; mockk) — value-level capture that `getConversations("50000050")` and `prefetchConversations()` issue `whereArrayContains("participantIds", "50000050")` with a **String** (not a Long), and that `getOrCreateConversation` writes string `participantIds`. A listener-error-propagation test (à la SHY-0102 I3).

**GREEN:**
- `app/src/main/.../PrivateMessageRepositoryImpl.kt` — drop the `toLongOrNull() ?: x` coercion at L40, L65, L100-101; pass/store strings. Fix the L72 listener error-swallow → `close(error)`.
- Resolve `getOwnedGroupCount` (L756) per the zero-gap AC.
- NEW migration: an Admin-SDK script/endpoint (`express-api/scripts/` or a maintenance route) that backfills numeric `participantIds` → strings across `conversations` (idempotent, batched, dev then prod). Tests against the real emulator.
- iOS: no code change expected (already correct) — add/confirm a regression test that the iOS query stays string-typed.

**Gauntlet (per Pre-Merge Protocol — touches runtime messaging behaviour):**
- Real Android + real iOS journeys: Messages list populates; a DM created on Android is read on iOS and vice-versa; cross-cohort migrated thread stays hidden. Local then dev.
- Web browsers per allowlist (messaging surface, if exercised on web).

## Out of Scope

- The rooms `list` denial — that is SHY-0102 (this is its conversations companion).
- SHY-0117 (Messaging **test-migration** to real services) — orthogonal; this is a product bug + its proving harness, not the bulk test migration.
- Any broader messaging-rules refactor beyond the `participantIds` id-type contract + the `crossCohortAtMigration` list question.
- Group-membership-growth rule changes (the create/update gates at `firestore.rules:330-390`) unless the harness proves they block the list.

## Dependencies

- `firestore.rules` `match /conversations/{conversationId}` (L316-329) + `callerUniqueId()` (L8-10) — UNCHANGED by this story (unless the harness proves otherwise → operator checkpoint).
- `@firebase/rules-unit-testing` harness pattern established by **SHY-0129** (`room-rules.test.js`).
- `Conversation` model (`core/model/Conversation.kt`, `participantIds: List<String>`).
- Express conversations canonicalisation (`conversations.js`, `.map(String)`) — the server-side reference for "strings are canonical".

## Risks & Mitigations

- **Risk:** the migration misses some legacy numeric-id docs → those threads stay inaccessible. **Mitigation:** the backfill query scans all `conversations`; idempotent re-runs; verify a count of remaining numeric-id docs == 0 post-run on dev then prod.
- **Risk:** removing the Long coercion breaks a caller that depended on numeric ids. **Mitigation:** grep all `participantIds` producers/consumers; the model is `List<String>` so consumers already expect strings; cover each in tests.
- **Risk:** the `crossCohortAtMigration` condition makes the list unsatisfiable without a query constraint (a rule change would then be needed). **Mitigation:** the harness resolves this empirically FIRST; if a rule change is required, STOP and operator-checkpoint (security-sensitive) before applying.
- **Risk:** behaviour differs local vs dev (data shape drift). **Mitigation:** gauntlet runs local then dev on real devices; migration verified on both.

## Definition of Done

- All RED tests (engine harness + Android unit) written failing-first, then green; existing rule + unit tests stay green; `:shared:compileKotlinIosArm64` green.
- Android query+write use strings; `getOwnedGroupCount` resolved; listener error-swallow fixed; legacy data migrated (dev+prod, remaining-numeric-count == 0).
- `code-reviewer` 100% clean before push; CI required checks (Detect Changes, Analyze JavaScript, PR Gate) green.
- Messages load + cross-platform DM read verified on real Android + real iOS, local then dev; segregation/privacy adversarial cases still deny.
- Released in a `vX.Y.Z` cut with `released_in:` set.

## Notes (running log)

- 2026-06-19 — **Filed from the SHY-0102 conversations carve-out investigation (operator-requested while PR #1480 was CI-blocked on an unrelated emulator-boot flake).** Root cause = Android-only id-type coercion (`toLongOrNull()`) in `PrivateMessageRepositoryImpl` at query L40/L65 + write L100-101, contradicting the canonical `String` type used by the model, the rule (`string(callerUniqueId())`), iOS (with an explanatory comment), and Express (`.map(String)`). Two failure modes: read denial (Long query can't match string data / satisfy the string rule) + write corruption (Android-created threads get numeric ids that fail the rule even for `get`). Fix = drop the coercion (strings everywhere) + Admin-SDK migration for legacy numeric-id docs + the SHY-0102-I3 observability fix on `getConversations` L72 + resolve `getOwnedGroupCount`. One empirical unknown for the harness: whether the participantIds-string constraint alone satisfies the `list` rule or condition (B) `crossCohortAtMigration != true` also needs handling (iOS's working string-only impl suggests alone-suffices). Corrects the original SHY-0102 triage which wrongly ruled out a type mismatch by inspecting only the model, not the impl.

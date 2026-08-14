---
id: SHY-0134
status: Draft
owner: claude
created: 2026-06-20
priority: P2
type: bug
effort: S
roadmap_ids: []
public: false
mvp: false
---

# SHY-0134: `getOwnedGroupCount` conversations `list` is denied → MAX_OWNED_GROUPS cap silently bypassed

## User Story

As a **member creating group chats**, I want **the "max groups you can own" cap to actually count my owned groups**, so that **the limit is enforced for everyone instead of being silently disabled by a denied query**.

## Why

`getOwnedGroupCount` lists `conversations` by `createdBy == userId && isGroup == true` (Android `PrivateMessageRepositoryImpl:752`; iOS `IosPrivateMessageRepositoryImpl:756`) and counts the non-closed ones. The query does **not** constrain `participantIds`, but the conversations `list` rule (`firestore.rules:327-329`) requires `string(callerUniqueId()) in resource.data.participantIds`. Firestore enforces a `list` rule by requiring the query's constraints to *prove* the rule (the same reason SHY-0102 had to add `whereEqualTo("cohort", …)` and SHY-0130 had to pin a string `participantIds` `array-contains`) — a `createdBy`-only query cannot prove participant membership, so the engine **denies the list** (`PERMISSION_DENIED`).

The denial is then **swallowed fail-open**: `GroupSetupViewModel.loadOwnedGroupCount()` (`shared/.../feature/messaging/GroupSetupViewModel.kt:92`) handles only `Resource.Success`; the `else -> Unit` branch drops a `Resource.Error` silently, leaving `ownedGroupCount` at its default `0`. `NewMessageViewModel` (`:146`) consumes the same call. Net effect: the `MAX_OWNED_GROUPS` cap reads a permanent `0`, so a member can create **unlimited** groups — the limit is not enforced. This is the conversations companion to SHY-0102 (rooms list denial) and SHY-0130 (conversations id-type), carved out of SHY-0130 as a distinct functional-denial finding.

## Acceptance Criteria

### Happy path
- [ ] `getOwnedGroupCount(userId)` succeeds (no `PERMISSION_DENIED`) on both Android and iOS and returns the correct count of the caller's non-closed owned groups.
- [ ] The count drives the `MAX_OWNED_GROUPS` cap: at the cap, group creation is blocked; below it, allowed.

### Error paths
- [ ] A genuine error (network/offline) from `getOwnedGroupCount` is **not** silently treated as `0`: the ViewModel surfaces/logs it and the cap fails **closed** (do not allow unlimited creation on an unknown count) — the `else -> Unit` swallow at `GroupSetupViewModel.kt:99` is fixed.
- [ ] A non-owner cannot read another member's owned-group set (privacy preserved — the query is scoped to the caller).

### Edge cases
- [ ] A creator who has **left** a group they created (still `createdBy == userId` but no longer in `participantIds`) is counted per the intended cap semantics — DECISION REQUIRED in the spec: either (a) such groups still count (then a client `array-contains` fix would undercount → route server-side), or (b) they don't count (client `array-contains` fix is correct). The harness + the actual leave-flow behaviour decide which; the chosen semantics is pinned by a test.
- [ ] A user who owns `0` groups returns `0`; a user at exactly `MAX_OWNED_GROUPS` is blocked from creating one more.
- [ ] Closed (`isClosed == true`) owned groups are excluded from the count (existing behaviour preserved).

### Performance
- [ ] If the fix adds a `participantIds array-contains` + `createdBy ==` + `isGroup ==` query, a backing **composite index** exists in `firestore.indexes.json` (no `FAILED_PRECONDITION`). If routed server-side instead, the endpoint is a single indexed admin query.

### Security
- [ ] The fix does **not** widen read access: it pins the query to the caller's own membership/ownership; cohort segregation (OSA §17) and DM-privacy are unaffected (group conversations the caller doesn't own/participate in stay unreadable).

### UX
- [ ] No regression to the group-creation flow; the cap message appears at the right time; a transient count error degrades gracefully (cap fails closed with a clear retry path, not a silent unlimited bypass).

### i18n
- N/A — no new user-facing strings (existing cap messaging reused). If the error-path UX adds a string, it goes in all 20 locales.

### Observability
- [ ] A denied/failed `getOwnedGroupCount` is logged (not swallowed), so a future regression is visible in logcat rather than manifesting as an unenforced cap.

## BDD Scenarios

**Scenario: owned-group count succeeds after the fix**
- **Given** a member who created 2 non-closed groups (and is a participant of each)
- **When** `getOwnedGroupCount` runs with the participant-scoped query
- **Then** it succeeds (no PERMISSION_DENIED) and returns `2`

**Scenario: the denial is real before the fix (regression guard)**
- **Given** a seeded group with `createdBy == caller, isGroup == true`
- **When** the client lists by `createdBy + isGroup` only (no `participantIds` constraint)
- **Then** the engine denies the list (proven against the real rules engine)

**Scenario: the cap is enforced**
- **Given** a member who already owns `MAX_OWNED_GROUPS` groups
- **When** they attempt to create another
- **Then** creation is blocked by the cap

**Scenario: a count error fails closed**
- **Given** `getOwnedGroupCount` returns `Resource.Error`
- **When** the group-setup screen evaluates the cap
- **Then** it does not treat the count as `0`/unlimited — it surfaces the error and blocks (or prompts retry), and the error is logged

## Test Plan

**RED (failing-first):**
- `express-api/tests/firestore-rules/conversations-rules.test.js` — add a `getOwnedGroupCount` describe: (a) a `createdBy + isGroup`-only list is DENIED; (b) a `participantIds array-contains(string(uid)) + createdBy + isGroup` list is ALLOWED and returns only the caller's owned groups. Real emulator.
- `app/src/test/java/com/shyden/shytalk/data/repository/PrivateMessageRepositoryImplTest.kt` — value-level capture that the fixed query includes `whereArrayContains("participantIds", userId)` (or that the call routes server-side); count excludes closed groups.
- `app/src/test/java/com/shyden/shytalk/feature/messaging/GroupSetupViewModelTest.kt` — a `Resource.Error` from `getOwnedGroupCount` no longer leaves `ownedGroupCount` at `0`/unlimited (fail-closed) and is logged (the current tests at L580 assert the error path — extend them to assert the cap is NOT bypassed).
- iOS host test — the iOS query is participant-scoped (mirror).

**GREEN:**
- `PrivateMessageRepositoryImpl.kt:752` + `IosPrivateMessageRepositoryImpl.kt:756` — add the `participantIds array-contains` constraint (if client-fixable per the edge-case decision) OR route the count via an Express+AdminSDK endpoint (admin bypasses rules; preserves the "created-but-left" semantics).
- `GroupSetupViewModel.kt:99` (+ `NewMessageViewModel.kt:146` if it has the same swallow) — fail-closed + log on error.
- `firestore.indexes.json` — composite index if the client query gains a third predicate.

**Gauntlet (per Pre-Merge Protocol — backend rules-adjacent + client):** Kotlin JVM unit + iOS compile (`:shared:compileKotlinIosArm64`) + Express/Jest (real emulator) + detekt/ktlint/eslint/prettier + real-device check: a member at the cap cannot create another group on real Android + real iOS, local then dev.

## Out of Scope

- The conversations id-type contract — **SHY-0130** (merged).
- The `crossCohortAtMigration` list-leak — **SHY-0132**.
- The rooms list denial — **SHY-0102**.
- Any change to `MAX_OWNED_GROUPS`'s value or the group-creation rules beyond making the count query satisfiable + the cap fail-closed.

## Dependencies

- `firestore.rules` conversations `list` rule (L327-329) — unchanged (the fix is query + index, mirroring SHY-0102/SHY-0130); if a rule change is somehow required, STOP + operator-checkpoint.
- `@firebase/rules-unit-testing` harness (`conversations-rules.test.js`, SHY-0130).
- `createGroupConversation` writing the creator into `participantIds` (the basis for the `array-contains` fix) — and the group **leave** flow (determines the created-but-left edge-case semantics).
- `Constants.MAX_OWNED_GROUPS` + `GroupSetupViewModel` / `NewMessageViewModel`.

## Risks & Mitigations

- **Risk:** an `array-contains participantIds` fix undercounts groups the user created but later left. **Mitigation:** the edge-case AC forces an explicit semantics decision; if "created-but-left still counts", route the count server-side (admin query on `createdBy`) instead of the client `array-contains`.
- **Risk:** fixing the query but leaving the ViewModel swallow → cap still bypassed on any transient error. **Mitigation:** the fail-closed ViewModel fix is in-scope and tested.
- **Risk:** missing composite index → `FAILED_PRECONDITION` at runtime. **Mitigation:** add the index in the same change; prove the query shape against the emulator.

## Definition of Done

- Harness proves the denial (before) and the satisfiable query (after); `getOwnedGroupCount` succeeds on both platforms; the cap is enforced and fails closed on error; the error-swallow is fixed + logged.
- `:shared:compileKotlinIosArm64` green; composite index added if needed.
- `code-reviewer` 100% clean; CI required checks (Detect Changes, Analyze JavaScript, PR Gate) green.
- Real-device verification: a member at `MAX_OWNED_GROUPS` is blocked on real Android + real iOS, local then dev.
- Released in a `vX.Y.Z` cut with `released_in:` set.

## Notes (running log)

- 2026-06-20 — **Filed (operator-requested follow-up).** Discovered during SHY-0130: `getOwnedGroupCount` lists `createdBy + isGroup` with no `participantIds` constraint → the conversations `list` rule denies it (same class as SHY-0102/SHY-0130), and `GroupSetupViewModel`'s `else -> Unit` swallows the `PERMISSION_DENIED`, defaulting `ownedGroupCount` to `0` → the `MAX_OWNED_GROUPS` cap is silently un-enforced (fail-open limit bypass). Affects Android (`PrivateMessageRepositoryImpl:752`) + iOS (`IosPrivateMessageRepositoryImpl:756`); consumed by `GroupSetupViewModel:92` + `NewMessageViewModel:146`. Carved out of SHY-0130's narrowed id-type scope as a distinct functional-denial. Key open question for pickup: created-but-left group semantics → client `array-contains` vs server-side admin count.

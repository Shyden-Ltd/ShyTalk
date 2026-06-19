---
id: SHY-0102
status: In Review
owner: claude
created: 2026-06-15
priority: P1
effort: M
type: bug
roadmap_ids: []
public: false
mvp: false
---

# SHY-0102: Rooms `list` query denied — client query must pin `cohort` to satisfy the read rule

## User Story

As a **signed-in member browsing the app**, I want **my rooms list to load**, so that **I can see and join the rooms available to my cohort instead of an empty screen**.

## Why

During the OkHttp-5 journey gauntlet (#1429) on a real Android device, persona Raul (UID 50000050, cohort `adult`) hit `PERMISSION_DENIED` on the rooms-list query `rooms where state in [ACTIVE, OWNER_AWAY]` → `"false for 'list'"` at `firestore.rules` L192. DEV-confirmed (not local-seed-only) with persona Alice on `shytalk-dev`.

**Root cause (now PROVEN, not theorised — see SHY-0129):** Firestore evaluates a `list`/query rule **once against the query**, with `resource.data` UNbound — not per-returned-document. The rooms read rule (`firestore.rules` L192-193) is `allow read: if request.auth != null && (cohortMatchesCaller() || isAdmin())`, and `cohortMatchesCaller()` (L26-29) dereferences `resource.data.cohort`. A `list` therefore passes **only when the query itself constrains `cohort`** to a constant the rule can prove — i.e. `where('cohort','==', <caller's cohort>)`. The app's production query constrains only `state`, so the list is denied. Proof: an **empty** rooms collection (0 docs) is still denied — confirming this is the rule-evaluation model, not data.

**The contract is already pinned for real.** SHY-0129's `@firebase/rules-unit-testing` engine suite (`express-api/tests/firestore-rules/room-rules.test.js`, describe `rooms list (collection query) — SHY-0102 contract`, L606-657) proves against the REAL rules engine: a cohort-pinned list is **ALLOWED**, the unconstrained list is **DENIED**, an empty cohort-pinned list returns **empty (not denied)**, a minor pinning `cohort==adult` is **DENIED** (segregation), and an unauthenticated caller is **DENIED**. This story is the **client half**: make every rooms-list query send the cohort-pinned shape the engine already accepts.

**Fix shape is decided (no rules change):** option (a) — the **client query adds the rule-satisfying constraint**. The rule is correct and secure as-is (SHY-0129 is the evidence), so there is **no `firestore.rules` change and therefore NO rules-deploy operator checkpoint**. This is exactly what the SHY-0129 harness comment records (room-rules.test.js L600).

**Conversations carved out.** The original filing also covered the `conversations` `list` denial (`participantIds array_contains`, rule L327). That is a **separate code path** (`PrivateMessageRepositoryImpl`, a different rule, and a probable id-type mismatch — the Android client coerces the id via `userId.toLongOrNull() ?: userId`, but seeded `participantIds` are strings) and is **not yet proven by an engine harness**. It is moved to its own future SHY (see Out of Scope). Note: SHY-0117 is the Messaging *test-migration* story (EPIC-0003), NOT the conversations-list denial fix — they are different work.

## Acceptance Criteria

### Happy path
- [ ] An `adult` member's rooms-list query (`getActiveRooms`) succeeds and returns the adult-cohort ACTIVE/OWNER_AWAY rooms — no `PERMISSION_DENIED`.
- [ ] A `minor` member's rooms-list query succeeds and returns minor-cohort rooms.
- [ ] The Rooms (home) screen populates from real data on local and dev.
- [ ] ALL FIVE client `rooms` `list` queries send the cohort-pinned shape and succeed (same rule, same denial class — zero-gap): `getActiveRooms`, `prefetchActiveRooms` (splash), `findActiveRoomByOwner` (owner-dedup), `closeAllRoomsByOwner` (replace-room), `leaveAllRooms` (join cleanup).

### Error paths
- [ ] A `minor` member is still denied adult-cohort rooms and an `adult` is still denied minor-cohort rooms (age-segregation preserved — inherited from SHY-0129 `assertFails`).
- [ ] When the caller's cohort cannot be resolved (user fetch fails / unknown), the query pins the **most-restrictive** cohort (`minor`) — fails CLOSED (a denied/empty list), never opens cross-cohort access.

### Edge cases
- [ ] Empty result set (0 matching rooms) returns an empty list, NOT a `PERMISSION_DENIED` (inherited SHY-0129 `empty cohort-pinned list returns empty`).
- [ ] A caller whose effective cohort comes from an admin `cohortOverride` pins the **override** value (`effectiveCohort = cohortOverride ?: cohort`), matching the JWT claim the rule compares against.
- [ ] All FIVE rooms-query methods carry the constraint — none silently left denied. (`closeAllRoomsByOwner` + `leaveAllRooms` are also client `list` queries on `rooms`, found during implementation — a user could otherwise end up with duplicate/lingering rooms when the denied bulk-close/leave silently no-ops.)

### Performance
- [ ] N/A — one added equality filter on an already-issued query; no extra round-trip, no client-side fan-out. Room-list render budget (< 2s with 50 rooms) unaffected.

### Security
- [ ] Age-segregation (UK OSA #17) is unchanged: the fix does NOT widen read access. The constraint pins the caller's OWN cohort; the rule still rejects any pin that doesn't equal the signed JWT cohort claim. Adversarial denial cases are inherited from SHY-0129 (minor→adult, unauthenticated) and re-asserted at the client layer (resolved cohort = caller's effective cohort, fail-closed to minor).
- [ ] Decision recorded: fix shape (a) **client query adds the rule-satisfying constraint** — chosen because SHY-0129 proves the rule is correct + secure. **No rules change → no operator rules-deploy checkpoint.**

### UX
- [ ] No empty Rooms screen when cohort-appropriate rooms exist; no silent failure. A genuine denial still surfaces the existing error state, not a blank screen.

### i18n
- [ ] N/A — no new user-facing strings (the existing room-observation error path is reused).

### Observability
- [ ] The existing `logE(TAG, "Room observation failed: …")` path remains; a denied list is distinguishable from an empty list in logs (denied → `catch` error log; empty → `Received 0 active rooms` info log) so this class of failure stays detectable in logcat/console.

## BDD Scenarios

**Scenario: adult member lists rooms successfully**
- **Given** an authenticated member with effective cohort `adult`
- **And** the rooms collection contains adult-cohort rooms in state ACTIVE/OWNER_AWAY
- **When** the app issues its production rooms-list query (now pinned `where cohort == "adult"`)
- **Then** the query succeeds (no PERMISSION_DENIED)
- **And** only adult-cohort rooms are returned

**Scenario: empty rooms collection returns empty, not denied**
- **Given** an authenticated `adult` member
- **And** zero matching rooms exist
- **When** the app issues its cohort-pinned rooms-list query
- **Then** the result is an empty list
- **And** no PERMISSION_DENIED is raised

**Scenario: minor cannot list adult rooms (segregation preserved)**
- **Given** an authenticated member with effective cohort `minor`
- **When** the client resolves the caller's cohort and pins `where cohort == "minor"`
- **Then** the query returns only minor-cohort rooms
- **And** no adult-cohort room is ever returned to the minor

**Scenario: cohort cannot be resolved — fail closed**
- **Given** an authenticated member whose user document cannot be fetched
- **When** the client resolves the caller's cohort
- **Then** it pins the most-restrictive cohort `minor`
- **And** an adult caller in this state sees a denied/empty list rather than any cross-cohort leak

**Scenario: owner-dedup query is also cohort-pinned**
- **Given** an authenticated member who owns an active room
- **When** `findActiveRoomByOwner` runs (now pinned `where cohort == <caller cohort>`)
- **Then** the query succeeds and returns the owner's active room id (it shares the owner's cohort)

## Test Plan

**Inherited RED→GREEN (already proven against the REAL engine — SHY-0129):**
- `express-api/tests/firestore-rules/room-rules.test.js` → describe `rooms list (collection query) — SHY-0102 contract` (L606-657): cohort-pinned list ALLOWED; unconstrained list DENIED; empty cohort-pinned list returns empty; minor→adult DENIED; unauthenticated DENIED. This story does NOT re-implement these — it makes the client send the proven-accepted shape.

**RED (write first, must fail against current client code):**
- `app/src/test/java/com/shyden/shytalk/data/repository/RoomRepositoryImplTest.kt` (host JVM = unit location; mockk permitted) — capture the query args and assert VALUES:
  - `getActiveRooms("adult")` builds `whereEqualTo("cohort","adult")` AND `whereIn("state", ["ACTIVE","OWNER_AWAY"])`; `getActiveRooms("minor")` pins `cohort=="minor"`; `getActiveRooms` still constrains `state`.
  - `prefetchActiveRooms("minor")` pins `cohort=="minor"`.
  - `findActiveRoomByOwner("owner-1","adult")` pins `cohort` AND `ownerId`.
  - `leaveAllRooms("user-1","minor")` pins `cohort` (alongside its `participantIds`/`state` constraints).
  - `closeAllRoomsByOwner("owner-1","adult")` pins `cohort`.
- NEW `app/src/test/java/com/shyden/shytalk/data/repository/CohortResolverTest.kt` — value matrix for the fail-closed resolver: `Success(adult)`→`"adult"`; `Success(cohort=minor, override=adult)`→`"adult"`; `Success(minor)`→`"minor"`; `Error`→`"minor"`; `null userId`→`"minor"`.
- `app/src/test/java/com/shyden/shytalk/feature/home/HomeViewModelTest.kt` — `observeRooms` calls `getActiveRooms` with the resolved cohort (adult user → `"adult"`; unresolved → `"minor"`); the create-flow `findActiveRoomByOwner` is called with the resolved cohort.
- `app/src/test/java/com/shyden/shytalk/core/room/ActiveRoomManagerTest.kt` — `ensureSingleRoom` resolves cohort and passes it to `findActiveRoomByOwner`.
- Splash VM test (if present) — `prefetchActiveRooms` called with the resolved cohort.

**GREEN:**
- `RoomRepository` interface: add `cohort: String` to ALL FIVE rooms-`list` methods — `getActiveRooms`, `prefetchActiveRooms`, `findActiveRoomByOwner`, `closeAllRoomsByOwner`, `leaveAllRooms` (cohort placed before the optional `exceptRoomId` on `leaveAllRooms`).
- Android impl (`app/src/main/.../RoomRepositoryImpl.kt`): add `.whereEqualTo("cohort", cohort)` (issued FIRST) to all five queries.
- iOS impl (`shared/src/iosMain/.../IosRoomRepositoryImpl.kt`): add `"cohort" equalTo cohort` (first arg of `all(...)`) to all five queries.
- NEW `shared/src/commonMain/.../data/repository/CohortResolver.kt`: `suspend fun UserRepository.resolveEffectiveCohort(userId: String?): String` — fail-closed to `COHORT_MINOR`.
- Thread the resolved cohort at all 6 call-sites — HomeViewModel `observeRooms`/`createRoom`/`confirmReplaceRoom`, FunFactSplashViewModel (splash prefetch), ActiveRoomManager `ensureSingleRoom`, RoomViewModel (join cleanup); refactor `doCreateRoom`'s inline cohort resolution onto the shared helper.
- Update `app/src/androidTest/.../FakeRoomRepository.kt` signatures to compile (mechanical).
- `./gradlew :shared:compileKotlinIosArm64` green.

**Gauntlet (per Pre-Merge Protocol — this touches runtime behaviour; backend rule is read-only here, no `firestore.rules` change):**
- Real Android + real iOS app journeys: Rooms screen populates for an adult persona; a minor persona sees only minor rooms; state-verify Firestore agrees. Local then dev.
- Web browsers per allowlist (rooms surface).
- iOS query-shape correctness is proven by `:shared:compileKotlinIosArm64` + the real-iOS device journey (the GitLive `where { }` builder cannot be introspected by a host unit test without a live Firestore).

## Out of Scope

- **The `conversations` `list` denial** — separate code path (`PrivateMessageRepositoryImpl`), different rule (L327), needs its own engine-harness proof + a probable id-type fix (Long vs String in `participantIds`). To be filed as its own SHY. **NOT** covered by SHY-0117 (that is the Messaging test-migration story).
- The OkHttp 5 adoption (#1429) — orthogonal.
- Any `firestore.rules` change — the rule is correct; the fix is client-only.
- The "can't create rooms" client claim-propagation race (force-refresh token after claim mint) — separate client bug SHY.

## Dependencies

- **SHY-0129** — the real-engine harness that proves the cohort-pinned list contract this story implements on the client.
- `firestore.rules` rooms read rule (L192-193) + `cohortMatchesCaller()` (L26-29) — UNCHANGED.
- `core/util/CohortUtil.kt` — `COHORT_MINOR`, `effectiveCohort(...)`; `User.effectiveCohort` extension (`core/model/User.kt`).
- `UserRepository.getUser()` — resolves the caller's User doc (cohort source).

## Risks & Mitigations

- **Risk:** widening read access while fixing the denial. **Mitigation:** the constraint pins the caller's OWN effective cohort; the rule still rejects any non-matching pin; segregation `assertFails` inherited from SHY-0129; fail-closed default `minor`.
- **Risk:** passing the wrong cohort (e.g. fetch fails) returns the wrong rooms. **Mitigation:** wrong-cohort pin is DENIED by the rule (not leaked) → denied/empty list; default is most-restrictive `minor`; the user fetch is the same one `doCreateRoom` already relies on.
- **Risk:** the interface change breaks other callers / the androidTest fake. **Mitigation:** all callers enumerated by grep (HomeViewModel ×2, splash, ActiveRoomManager) + `FakeRoomRepository` updated in the same PR; iOS compile-check gate.
- **Risk:** behaviour differs local vs dev. **Mitigation:** gauntlet runs local THEN dev on real devices.

## Definition of Done

- All RED client tests written failing-first, then green; existing Kotlin unit tests stay green; `:shared:compileKotlinIosArm64` green.
- Fix shape documented + (client-only → no operator rules checkpoint).
- Rooms list loads on real Android + real iOS + browsers, local then dev; Firestore state agrees; segregation/privacy adversarial cases still deny.
- `code-reviewer` 100% clean before push; CI required checks (Detect Changes, Analyze JavaScript, PR Gate) green.
- Released in a `vX.Y.Z` cut with `released_in:` set.

## Notes (running log)

- **Reviewed-up-to: `cb4b081323c`** (code-reviewer 2 rounds → zero findings). Status → In Review.


- 2026-06-15 — Filed from OkHttp-5 journey gauntlet (#1429) finding. Root-caused to Firestore `list`-rule evaluation model (resource.data deref unsatisfiable for `list`); confirmed NOT OkHttp-related, NOT a claims gap, NOT an id-type mismatch (rooms). Observed on local with persona Raul (UID 50000050).
- 2026-06-15 (later) — **DEV-CONFIRMED, not local-seed-only.** OkHttp-5 DEV gauntlet on real Android reproduced the rooms `list` denial with persona Alice (UID 50000010, cohort adult). Confirms environment-wide (local + dev) → priority stays P1. Conversations `list` path not re-reached on dev this cycle (room flow blocked upstream).
- 2026-06-19 — **Pickup-fitness re-validation (per [[feedback-pickup-fitness-review-every-story]]) — story re-scoped.** Since filing, SHY-0129 landed a 125-test real-engine harness that PROVES the diagnosis and the exact client contract (cohort-pinned list ALLOWED, unconstrained DENIED, empty→empty, segregation preserved). Consequences applied to this spec: (1) **Scope narrowed to rooms only** — the `conversations` denial is a separate code path / different rule / probable id-type issue, NOT proven yet, and NOT covered by SHY-0117 (a test-migration story); carved to a future SHY. (2) **Fix decision locked = client query constraint, no rules change, no operator checkpoint** (was "3 options + checkpoint"). (3) **Server RED tests are inherited from SHY-0129**, not re-implemented. (4) **Zero-gap: a third call-site** (`findActiveRoomByOwner`) is the same denial class and is fixed in this PR alongside `getActiveRooms` + `prefetchActiveRooms`.
- 2026-06-19 — **Design decision recorded:** explicit `cohort: String` parameter on the rooms-query methods (mirrors the existing `createRoom(…, cohort)` OSA precedent), NOT a hidden repository session-dependency. Fail-closed default centralised in one helper `UserRepository.resolveEffectiveCohort(userId)` → `COHORT_MINOR` when unresolved; `doCreateRoom`'s inline copy refactored onto it. Architecture confirmed: Android impl lives in the `app` module (native Firebase SDK), iOS impl in `shared/iosMain` (GitLive KMP wrapper) — no shared query builder, so the constraint is added per-platform. Branch `story/SHY-0102-rooms-list-cohort-query-fix`.
- 2026-06-19 — **Zero-gap finding during implementation: the denial is FIVE methods, not three.** A comprehensive `collection("rooms")` grep (not just the bug-report's `getActiveRooms`) surfaced two more client `list` queries with the identical denial: `closeAllRoomsByOwner` (`where ownerId==X` — called from `HomeViewModel.confirmReplaceRoom`, so the replace-room flow silently fails to close the old room → duplicate active rooms) and `leaveAllRooms` (`where participantIds array_contains userId` — called from `RoomViewModel`'s join cleanup, so old rooms aren't left → lingering membership). Both are intentionally client-side queries (impl comments say "Query stays client-side; each close/leave routes through /close|/leave") so they ARE subject to the read `list` rule. Fixed both in this PR per [[feedback-fix-pre-existing-and-new-same]] + [[feedback-zero-gap-qa-mindset-everywhere]]. All other `collection("rooms")` usages are single-doc get/set/create (not lists) — unaffected.
- 2026-06-19 — **TDD RED→GREEN done; LOCAL non-device gauntlet green.** RED: targeted run = 179 tests, 6 cohort-capture failures (impl didn't pin cohort), resolver + VM-threading green. GREEN (added the `where('cohort')` clause per platform): `:app:testDevDebugUnitTest` + `:shared:jvmTest` BUILD SUCCESSFUL; `:shared:compileKotlinIosArm64` green (tri-platform); detekt green; ktlint green. New tests: per-method cohort-pin capture (value-level, all 5 methods) in `RoomRepositoryImplTest`; `CohortResolverTest` 7-case fail-closed value matrix; cohort-threading verifies in `HomeViewModelTest` (adult→"adult", unresolved→"minor") + `ActiveRoomManagerTest`.
- 2026-06-19 — **code-reviewer round 1 (commit `a674db07dd8`): 5 findings, ALL applied.** C1 — no test for the `RoomViewModel` join-flow `leaveAllRooms` cohort-threading → added 2 (`RoomViewModelTest`: adult + fail-closed-minor). C2 — no test for the splash `prefetchActiveRooms` cohort → added 3 (`FunFactSplashViewModelTest`: adult, fail-closed-minor, null-userId-skips). I1 — missing `leaveAllRooms` error-path test → added. I2 — `confirmReplaceRoom` cohort pinned with `any()` → added 2 value-pinned (adult + minor). **I3 (pre-existing, fixed per [[feedback-fix-pre-existing-and-new-same]]):** Android `getActiveRooms` snapshot listener SWALLOWED Firestore errors (`if (error != null) return`) — so a denied/failed listen never reached `observeRooms`' `.catch`, contradicting this story's Observability AC. Fixed to `close(error)` (propagates to the Flow → logged; Firestore has already torn down the listener on error) + added an error-propagation test. Re-gauntlet after fixes: all green (app units + jvmTest + iOS compile + detekt + ktlint + no-stubs ratchet). Remaining gate: code-reviewer re-review (round 2) → push/CI → operator-gated real-device rooms-screen-populates journey (local then dev).

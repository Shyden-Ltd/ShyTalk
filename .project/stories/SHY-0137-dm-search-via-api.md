---
id: SHY-0137
status: In Progress
owner: claude
created: 2026-06-20
priority: P1
effort: S
type: bug
roadmap_ids: []
public: false
mvp: false
---

# SHY-0137: DM "Search All Users" is denied by the cohort rule (and is name-only) → route through the cohort-gated `/api/users/search` API

## User Story

As a **member starting a new direct message**, I want **"Search All Users" to actually return matching people in my cohort by name OR by unique ID**, so that **I can find and message someone instead of getting an empty, silently-failing search box**.

## Why

The DM-recipient "Search All Users" flow runs a **raw Firestore `list` query** on the `users` collection constrained only by a `displayName` range — with **no `cohort` constraint** (Android `PrivateMessageRepositoryImpl.searchUsers` ~L731; iOS `IosPrivateMessageRepositoryImpl.searchUsers` ~L729). The `users` read rule (`firestore.rules:51`) requires `cohortMatchesCaller()` for any non-self / non-admin read. Firestore enforces a `list` rule by requiring the query's own constraints to **prove** the rule passes (the same reason SHY-0102 / SHY-0130 / SHY-0134 had to pin extra `where` clauses) — a `displayName`-only query cannot prove same-cohort, so the engine **denies the whole list** with `PERMISSION_DENIED`. The search therefore never returns results in production.

Two secondary defects compound it: the query searches **by name only** (no way to find someone by their unique ID), and the denial surfaces to the user as a hard error via `NewMessageViewModel.searchAllUsers` (`shared/.../feature/messaging/NewMessageViewModel.kt:192`) → `Resource.Error`.

The fix is to stop querying Firestore directly and route both platforms through the **already-correct, cohort-gated** Express endpoint **`GET /api/users/search?q=...`** (`express-api/src/routes/users.js:473`). That endpoint: (a) is gated server-side by `where('cohort','==',callerCohort)` (numeric branch uses `requireSameCohort`) — **fixing the permission error**; (b) **auto-routes by query shape** — a numeric `q` → exact `uniqueId` lookup, anything else → displayName match — **giving "search by ID AND name" for free**; (c) returns `{ "users": [ ... ] }`. This is the **first concrete instance** of a broader **"no direct client DB access — all reads/writes via the Express API"** initiative; an EPIC will track migrating the remaining direct-Firestore client reads/writes.

### Device-testing follow-ups (2026-06-21)

Real-device testing of the API-routed search surfaced **two follow-on issues**, both fixed under this story:

- **(A) Search always returned empty (client dropped every result).** The endpoint correctly returns same-cohort users, but `stripSensitiveFields` (`users.js:70`, deletes `cohort` + `cohortOverride` at ~L86) removes the cohort field (adult/minor status is **OSA §17-sensitive** and must stay stripped). `NewMessageViewModel.searchAllUsers` then ran `viewerUser?.let { result.data.filterSameCohortAs(it) } ?: emptyList()` — but `filterSameCohortAs` (HIDE policy) reads each item's `cohort`, which `User.fromMap` defaults to `"minor"` when absent. For an **adult** viewer every cohort-less search row therefore looked cross-cohort and was **dropped → search always empty**. Because the Express endpoint is the **authoritative server-side cohort gate** (a tampered client cannot bypass it) and already excludes self, the client re-filter on these results is **both redundant AND broken**; the fix uses `result.data` directly. The sibling `availableUsers`/`recentUsers` filters (lines ~96/~133) are **left intact** — those come from `userRepository.getUsers(...)`, which reads **Firestore directly** (`whereIn(documentId, …)`) on both Android (`UserRepositoryImpl:134`) and iOS (`IosUserRepositoryImpl:90`), so the `cohort` field is present and the client filter is correct there.

- **(B) Name search was case-SENSITIVE and PREFIX-only.** The displayName branch did `where('displayName','>=',q).where('displayName','<',q+sentinel)`, so `lfc` missed `LFC_UK` and `Bao` missed `[SEED] Bao (P-17 Teacher)`. It is changed to **case-insensitive SUBSTRING**: fetch up to `USER_SEARCH_SCAN_LIMIT` (200) same-cohort docs via the single-field `where('cohort','==',cohort)` (no new composite index) and keep only docs whose `displayName` contains `q` case-insensitively. Implemented by extending `respondWithSameCohortUsers` with an optional `filterPredicate(data)`; `/discover` passes none (unchanged). The numeric/uniqueId branch is unchanged. A dedicated search index is needed at scale — a follow-up SHY will track it.

## Acceptance Criteria

### Happy path
- [ ] `searchUsers("<name>", currentUserId)` returns matching same-cohort users (no `PERMISSION_DENIED`) on both Android and iOS by calling `GET /api/users/search?q=<urlencoded name>`.
- [ ] `searchUsers("<numericId>", currentUserId)` returns the same-cohort user with that exact `uniqueId` — the client passes `q` verbatim and the **server** auto-routes numeric → exact-id; the client does NOT branch on shape.
- [ ] The `{ users: [...] }` response is parsed into `List<User>` with correct `uid` (= stringified `uniqueId`), `displayName`, `uniqueId`, and photo fields.

### Error paths
- [ ] A non-2xx response (e.g. a real `PERMISSION_DENIED` mapped to an API error, or 5xx) yields `Resource.Error` (not a crash, not a false `Success`); `NewMessageViewModel.searchAllUsers` surfaces it via its existing `Resource.Error` branch.
- [ ] A query below the server minimum (`SEARCH_MIN_QUERY_CHARS` = 3) — including blank/whitespace — returns an **empty result list WITHOUT calling the API** (no guaranteed-400 round-trip), so debounced typeahead while the user is still typing does not flash a hard error.

### Edge cases
- [ ] `currentUserId` is excluded from results even if the server includes the caller (defence-in-depth; the server already self-excludes).
- [ ] An empty `users` array (no matches) → `Resource.Success(emptyList())`, not an error.
- [ ] A query with reserved characters (`&`, `=`, `?`, space) is URL-encoded so it cannot corrupt the query string; a multi-byte UTF-8 name (e.g. `café`, `中`) is percent-encoded per byte and round-trips through Express.
- [ ] **(A)** A search `Resource.Success` carrying **cohort-less** users (the endpoint strips `cohort`) is **NOT** re-filtered/dropped by the client — `searchAllUsers` sets `allUsersSearchResults = result.data` directly. An adult viewer sees the server's same-cohort rows (previously every row was dropped → empty).
- [ ] **(A)** Search results surface even when `viewerUser` is not yet loaded (the old `?: emptyList()` fail-closed branch no longer discards results, since the server is the authoritative gate).
- [ ] **(A)** The sibling `availableUsers` (line ~96) and `recentUsers` (line ~133) filters are **left as-is** — they consume `userRepository.getUsers(...)` which reads Firestore directly (cohort field present), so `filterSameCohortAs` is correct there.
- [ ] **(B)** A lowercase query matches a mixed-case displayName (`lfc` → `LFC_UK`); a substring in the **middle** matches (`Bao` → `[SEED] Bao (P-17 Teacher)`); a non-matching substring returns empty; a `null`/missing `displayName` doc is tolerated (no throw) and excluded.
- [ ] **(B)** The displayName branch scans at most `USER_SEARCH_SCAN_LIMIT` (200) same-cohort docs via a single-field `where('cohort','==',cohort)` (no composite index) and filters the substring match in JS; the numeric/uniqueId branch is unchanged (exact lookup + same-cohort gate); `/discover` behaviour is unchanged (no predicate).

### Performance
- [ ] No client-side fan-out or N+1: one `GET /api/users/search` call per debounced query (the existing 300ms debounce in `searchAllUsers` is unchanged). The endpoint is backed by the existing cohort/displayName Firestore indexes (no new index needed — server already shipped).

### Security
- [ ] The fix **narrows** client trust surface: the client no longer issues a raw cross-cohort `users` `list`; cohort segregation (UK OSA §17) is enforced **server-side** by the endpoint (`where('cohort','==',caller)` / `requireSameCohort`), and sensitive fields are stripped by the endpoint's `stripSensitiveFields` (PII, cohort, pinHash, fcmTokens, etc.) before reaching the client.
- [ ] Block-list integrity and the existence-hiding cross-cohort 404 (numeric branch) are preserved because they live in the endpoint — the client gains nothing it could not already see.

### UX
- [ ] "Search All Users" returns results instead of an empty/error box; searching by a unique ID now works; typing a 1–2 char fragment shows no results yet without a red error toast.

### i18n
- N/A — no new user-facing strings. The error path reuses the existing `Resource.Error` → `UiText.plain(result.message)` surfacing in `NewMessageViewModel`; no XML string additions, so no 20-locale change.

### Observability
- [ ] An API failure flows through `firebaseCall`, which logs at error level (logcat / iOS log) before returning `Resource.Error`, so a future regression is visible rather than silent. The server endpoint logs its own failures (`log.error('users', ...)`).

## BDD Scenarios

**Scenario: name search returns same-cohort results via the API**
- **Given** a signed-in member and same-cohort users matching "Bob"
- **When** `searchUsers("Bob", myId)` runs
- **Then** the client calls `GET /api/users/search?q=Bob` and returns the matching `User` list (no `PERMISSION_DENIED`)

**Scenario: unique-ID search routes through the same endpoint**
- **Given** a same-cohort user with `uniqueId = 10000002`
- **When** `searchUsers("10000002", myId)` runs
- **Then** the client calls `GET /api/users/search?q=10000002` (identical endpoint — the server, not the client, branches numeric→exact-id) and returns that single user

**Scenario: the current user is excluded**
- **Given** the API returns the caller plus one other same-cohort user
- **When** the results are mapped
- **Then** the caller's own `uniqueId` row is dropped and only the other user remains

**Scenario: below-min query short-circuits without an API call**
- **Given** the user has typed only "ab" (2 chars, below `SEARCH_MIN_QUERY_CHARS`)
- **When** `searchUsers("ab", myId)` runs
- **Then** it returns `Resource.Success([])` and makes **zero** calls to `api.get`

**Scenario: an API error becomes a Resource.Error**
- **Given** the search endpoint returns a non-2xx / throws
- **When** `searchUsers("Bob", myId)` runs
- **Then** the result is `Resource.Error` (surfaced by the ViewModel, logged by `firebaseCall`)

**Scenario: the query is URL-encoded**
- **Given** a search for "a&b=c"
- **When** `searchUsers("a&b=c", myId)` runs
- **Then** the request path is `GET /api/users/search?q=a%26b%3Dc` (reserved chars percent-encoded, space → `%20` not `+`)

**Scenario: (A) cohort-less server results are not dropped by the client**
- **Given** an **adult** viewer and a search `Resource.Success` of users with **no** `cohort` field (the endpoint stripped it; `User.fromMap` defaults them to `"minor"`)
- **When** `searchAllUsers("lfc")` runs in search-all mode
- **Then** `allUsersSearchResults` contains **every** server-returned user (none dropped by a client cohort re-filter)
- **And** the previous behaviour discarded all of them, leaving the list empty

**Scenario: (A) results surface before the viewer doc loads**
- **Given** `userRepository.getUser` fails so `viewerUser` stays `null`
- **When** `searchAllUsers("cha")` returns same-cohort users from the endpoint
- **Then** `allUsersSearchResults` still contains those users (no fail-closed `emptyList()`)

**Scenario: (B) lowercase query matches a mixed-case displayName**
- **Given** an adult cohort containing a user named `LFC_UK`
- **When** `GET /api/users/search?q=lfc` runs
- **Then** the response `users` includes `LFC_UK` (case-insensitive substring), and the Firestore query used only `where('cohort','==','adult')` (no `displayName` range)

**Scenario: (B) substring in the middle of a name matches**
- **Given** an adult cohort containing `[SEED] Bao (P-17 Teacher)`
- **When** `GET /api/users/search?q=Bao` runs
- **Then** the response `users` includes that user (mid-string match), and the scan applied `.limit(200)` (`USER_SEARCH_SCAN_LIMIT`)

**Scenario: (B) non-matching substring + numeric branch unchanged**
- **Given** an adult cohort whose names do not contain `zzz`, and a same-cohort user with `uniqueId 10000200`
- **When** `GET /api/users/search?q=zzz` then `GET /api/users/search?q=10000200` run
- **Then** the first returns an empty `users` array, and the second returns exactly that one user via the unchanged exact-id + same-cohort path

## Test Plan

**RED (failing-first), all in unit-test locations (mocks permitted there per the real-only ratchet):**
- `app/src/test/java/com/shyden/shytalk/data/repository/PrivateMessageRepositoryImplTest.kt` — new `searchUsers — Express API` region with `WorkerApiClient` mocked: (a) calls `api.get("/api/users/search?q=Bob%20Smith")` (URL-encoded path captured value-level via a `slot`); (b) parses `{users:[...]}` into `List<User>` with `uid == "10000002"`; (c) excludes `currentUserId`; (d) a numeric query AND a name query both hit `/api/users/search?q=...` (same endpoint); (e) a below-min (`"ab"`) and a blank (`"   "`) query return `Resource.Success([])` with `coVerify(exactly = 0) { api.get(any()) }`; (f) `api.get` throwing → `Resource.Error`; plus empty-array → empty list, and reserved-char encoding (`a%26b%3Dc`).
- `shared/src/commonTest/kotlin/com/shyden/shytalk/core/util/UrlEncodingTest.kt` — value matrix for the new multiplatform `encodeUrlQueryComponent` (unreserved untouched; space → `%20`; `& = ?` encoded; numeric verbatim; multi-byte UTF-8 per-byte `caf%C3%A9` / `%E4%B8%AD`; empty; uppercase hex) — runs on both Android and iOS targets from commonTest.

**GREEN:**
- `shared/src/commonMain/kotlin/com/shyden/shytalk/core/util/Constants.kt` — add `USER_SEARCH_MIN_QUERY_CHARS = 3` (mirrors the server constant).
- `shared/src/commonMain/kotlin/com/shyden/shytalk/core/util/UrlEncoding.kt` — new dependency-free multiplatform `encodeUrlQueryComponent`.
- `app/src/main/java/com/shyden/shytalk/data/repository/PrivateMessageRepositoryImpl.kt` — `searchUsers` now short-circuits below-min, calls `api.get`, parses `{users:[...]}` via `JSONObject.toMap()` → `User.fromMap`, excludes `currentUserId`. `firestore` dependency retained for the other methods.
- `shared/src/iosMain/kotlin/com/shyden/shytalk/data/repository/IosPrivateMessageRepositoryImpl.kt` — mirror via `IosApiClient.get` + a local `jsonObjectToMap` primitive flattener.

**Device-testing follow-ups RED→GREEN (2026-06-21):**
- **(A) Kotlin** — `app/src/test/.../feature/messaging/NewMessageViewModelTest.kt`: `searchAllUsers keeps cohort-less server results for adult viewer (no client re-drop)` (adult viewer + cohort-less search rows → both survive in `allUsersSearchResults`) and `searchAllUsers surfaces results before viewerUser is loaded (no fail-closed empty)` (viewer-load fails → results still surface). **RED proof:** restoring the buggy `viewerUser?.let { result.data.filterSameCohortAs(it) } ?: emptyList()` made exactly these 2 (of 17) fail; the fixed `allUsersSearchResults = result.data` makes them pass. The existing `availableUsers`/`recentUsers` cohort-filter tests still pass (those paths unchanged — `getUsers` reads Firestore directly).
- **(B) Express** — `express-api/tests/routes/users-discovery-filter.test.js` displayName branch updated to case-insensitive substring + new value-level cases: lowercase→mixed-case (`lfc`→`LFC_UK`), mid-string (`Bao`→`[SEED] Bao …`), non-matching substring → empty, null/missing-displayName tolerated + excluded, `USER_SEARCH_SCAN_LIMIT=200` applied, cohort symmetry + self-exclusion retained; numeric/uniqueId branch unchanged. Runner: `cd express-api && node --experimental-vm-modules node_modules/.bin/jest tests/routes/users-discovery-filter.test.js`.

**Gauntlet (per Pre-Merge Protocol — client change + backend route change to the existing endpoint):** Kotlin JVM unit (`testDevDebugUnitTest`) + shared JVM unit (`:shared:jvmTest`) + iOS shared compile (`:shared:compileKotlinIosArm64`) + detekt + ktlint + Express Jest (`tests/routes/users*`) + eslint (`--max-warnings=0`) + prettier (`--check`) + `node scripts/check-no-new-stubs.js` (ratchet stays green — the only new doubles are in `app/src/test/**`, an exempt unit-test location; the Express test reuses the file's existing route-level mocks) + real-device check: "Search All Users" returns same-cohort results by name (case-insensitive, substring) AND by unique ID on real Android + real iOS, local then dev. **Because issue B changes `express-api/**`, the full device + all-browser matrix applies (backend = shared core).**

## Out of Scope

- The full **"no direct client DB access — all via Express API"** migration of every other direct-Firestore client read/write (this SHY is the first concrete instance; the rest is tracked by a forthcoming EPIC). Only the DM `searchUsers` read is migrated here.
- The other already-filed `list`-denial fixes: rooms (**SHY-0102**), conversations id-type (**SHY-0130**), cross-cohort leak (**SHY-0132**), `getOwnedGroupCount` (**SHY-0134**).
- Any change to the `/api/users/search` endpoint itself (it already implements ID + name + cohort gating + field stripping).
- The `NewMessageViewModel` debounce, the client same-cohort `filterSameCohortAs` filter, and the rest of `PrivateMessageRepositoryImpl` (other methods keep using `firestore`).

## Dependencies

- The existing Express endpoint `GET /api/users/search` (`express-api/src/routes/users.js:473`) + its helpers `respondWithSameCohortUsers`, `looksLikeUniqueId`, `stripSensitiveFields`, and constants `SEARCH_MIN_QUERY_CHARS` / `SEARCH_MAX_QUERY_CHARS` / `MIN_UNIQUE_ID` — all already shipped and live.
- Android `WorkerApiClient.get(path)` (attaches the Firebase ID token; 401-refresh-retry) and iOS `IosApiClient.get(path)` — already injected into both repos.
- `User.fromMap(map, uid)` (`shared/.../core/model/User.kt`), Android `JSONObject.toMap()` (`core/util/JsonExt.kt`).
- `NewMessageViewModel.searchAllUsers` (unchanged consumer) — relies on the same `Resource<List<User>>` contract.

## Risks & Mitigations

- **Risk:** the API `User` object lacks a Firestore-style doc id, so `User.uid` could be wrong. **Mitigation:** the `users` doc id IS the `uniqueId` string (server uses `users/${uniqueId}`); the client sets `uid = uniqueId.toString()` and a test pins `uid == "10000002"`.
- **Risk:** URL-encoding mismatch between client and Express decode (e.g. space as `+`). **Mitigation:** `encodeUrlQueryComponent` emits `%20` (not `+`) and percent-encodes reserved chars; a value-matrix unit test on both targets pins the output.
- **Risk:** a transient short query mid-typing fires a guaranteed 400 and flashes an error. **Mitigation:** below-min queries short-circuit to an empty list client-side with zero API calls (tested via `coVerify(exactly = 0)`).
- **Risk:** the iOS primitive flattener drops nested fields. **Mitigation:** the search user-card fields (displayName, uniqueId, photo, nationality) are all primitives, and `User.fromMap` tolerates absent collection fields via defaults; the existing economy-repo flattener uses the same approach.

## Definition of Done

- Both platforms route `searchUsers` through `GET /api/users/search`; the Firestore direct `list` is removed; no `PERMISSION_DENIED`; search works by name AND by unique ID.
- RED-first tests added (Android repo + shared `UrlEncoding` value matrix) and passing GREEN; below-min short-circuit and error→`Resource.Error` proven.
- `:shared:compileKotlinIosArm64` green; detekt + ktlint clean (no warnings); `scripts/check-no-new-stubs.js` ratchet still green; story frontmatter validator exit 0.
- `code-reviewer` 100% clean; CI required checks (Detect Changes, Analyze JavaScript, PR Gate) green.
- Real-device verification: "Search All Users" returns same-cohort results by name and by ID on real Android + real iOS, local then dev.
- Released in a `vX.Y.Z` cut with `released_in:` set.

## Notes (running log)

- 2026-06-21 — **Device-testing follow-ups fixed (A + B).** Real-device testing of the API-routed search surfaced two follow-ons. **(A)** Search always empty: the endpoint strips `cohort` (OSA §17) but `NewMessageViewModel.searchAllUsers` re-ran `filterSameCohortAs`, which treats every cohort-less row as cross-cohort and drops it for an adult viewer. Fix: use `result.data` directly (endpoint is the authoritative gate + self-excludes). **Line-133 audit:** `availableUsers` (~L96) and `recentUsers` (~L133) consume `userRepository.getUsers(...)`, which reads Firestore DIRECTLY (`whereIn(documentId, chunk)` — Android `UserRepositoryImpl:134`, iOS `IosUserRepositoryImpl:90`), so `cohort` is present and those client filters are CORRECT — left as-is. **(B)** Name search was case-sensitive prefix-only: changed the `users.js` displayName branch to case-insensitive SUBSTRING via a bounded `where('cohort','==',cohort).limit(USER_SEARCH_SCAN_LIMIT=200)` cohort scan + JS `String(displayName||'').toLowerCase().includes(q.toLowerCase())`; implemented by adding an optional `filterPredicate(data)` to `respondWithSameCohortUsers` (`/discover` passes none — unchanged). Removed `PREFIX_UPPER_SENTINEL`. Files: `express-api/src/routes/users.js`, `shared/.../feature/messaging/NewMessageViewModel.kt`, tests in `users-discovery-filter.test.js` + `NewMessageViewModelTest.kt`. Gates GREEN: Express Jest `tests/routes/users*` 144/144, eslint 0-warn, prettier clean, `NewMessageViewModelTest` 17/17 (RED proof: 2 fail on buggy revert), `:shared:jvmTest` green, `:shared:compileKotlinIosArm64` green, ktlint + detekt 0-findings, `check-no-new-stubs.js` clean. Follow-up SHY to track a dedicated search index at scale.
- 2026-06-20 — **Filed + implementation started (operator-directed).** Confirmed bug: DM "Search All Users" runs a raw `users` Firestore `list` with a `displayName` range and **no `cohort` constraint`; the `users` read rule (`firestore.rules:51`) requires `cohortMatchesCaller()`, so Firestore denies the list with `PERMISSION_DENIED` — and it only searched by name. Fix routes both platforms through the existing cohort-gated `GET /api/users/search?q=...` (`express-api/src/routes/users.js:473`), which fixes the permission error AND adds unique-ID search server-side AND removes a direct client DB read. First concrete instance of the broader "no direct client DB access — all via Express API" initiative (EPIC to follow). Cross-platform: Android (`PrivateMessageRepositoryImpl`) + iOS (`IosPrivateMessageRepositoryImpl`); added shared `Constants.USER_SEARCH_MIN_QUERY_CHARS` + multiplatform `encodeUrlQueryComponent`. Tests: Android repo `searchUsers — Express API` region + shared `UrlEncodingTest` (both unit-test locations; ratchet-exempt).

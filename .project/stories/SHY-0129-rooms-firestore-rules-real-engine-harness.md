---
id: SHY-0129
status: In Review
owner: claude
created: 2026-06-19
priority: P1
effort: M
type: refactor
roadmap_ids: []
epic: EPIC-0003
pr:
mvp: false
---

# SHY-0129: Migrate the rooms `firestore.rules` tests to the real Rules engine (EPIC-0003 / SHY-0113 slice)

## User Story

**As** the team draining EPIC-0003's mock-backed tests onto real services,
**I want** `express-api/tests/firestore-rules/room-rules.test.js` rewritten off plain string-grepping of `firestore.rules` (with `expect(true).toBe(true)` tautologies) and onto the **real `@firebase/rules-unit-testing` (v5) engine** running against the Firestore emulator,
**So that** the `match /rooms/{roomId}` contract — cohort-segregated read, cohort-stamped create, the `update: if false` Admin-SDK lockdown, owner-only delete, plus the `messages` / `seatRequests` subcollections **and the `list` query contract** — is proven by the engine that actually adjudicates production requests, instead of by source-text assertions that pass even when the rule is wrong.

## Why

The prior `room-rules.test.js` only `readFileSync('firestore.rules')` and ran regexes over the text — it could not catch a rule that *parses* but *adjudicates wrong*, and it contained literal `expect(true).toBe(true)` placeholders (the exact "structural-grep-as-behaviour" anti-pattern the strict testing standard bans, [[feedback-ac-traceability-in-tests]]). Critically, **Express room routes use the Admin SDK, which bypasses `firestore.rules` entirely** — so no express integration test can ever reach a rules bug. The Rules contract is only reachable through a *client-credentialed* path, which is exactly what `@firebase/rules-unit-testing` provides (scoped auth tokens → queries adjudicated by the real engine). This establishes the **first true rules-engine test surface in the repo** and the reusable pattern (per-persona handle cache, `clearFirestore()` isolation, `assertSucceeds`/`assertFails`) for the other rules blocks (users, conversations, wallet) to follow.

It also hardens a **legal** invariant: cohort read-segregation is a UK Online Safety Act §17 requirement ([[project-mvp-golive-parameters]]). A real-engine test that proves a minor cannot list adult rooms (and vice-versa) is materially stronger evidence than a regex over the rule body. The slice additionally **proved, against the live engine, the root cause of SHY-0102** (the "empty Rooms screen" `list` denial is a CLIENT query-shape bug, not a rules bug) — captured as a pinned contract here and fixed under the SHY-0102 bug story.

## Acceptance Criteria

### Happy path
- [ ] `room-rules.test.js` contains **no** `expect(true).toBe(true)` and does **not** assert by grepping `firestore.rules` source text; it loads the real rules via `initializeTestEnvironment({ projectId, firestore: { host, port, rules: readFileSync(RULES_PATH) } })` and adjudicates every case through the engine.
- [ ] **Create** is proven value-level: a fully-claimed adult creating a room with `cohort` == their JWT `cohort` claim and `ownerId` == `string(uniqueId)` and default `ownerFirebaseUid` → `assertSucceeds`; the same write with a mismatched cohort stamp, a spoofed `ownerId`, or a missing `cohort` claim → `assertFails`.
- [ ] **Read** is proven cohort-segregated: an adult reading an `adult` room → succeeds; an adult reading a `minor` room → fails; admin (`token.admin == true`) reading any room → succeeds; unauthenticated read → fails.
- [ ] **Update** lockdown is proven: every client `update()` on a room doc → `assertFails` (the `update: if false` Admin-SDK-only lockdown), including by the room owner.
- [ ] **Delete** is proven owner-only: the owner deletes their room → succeeds; a non-owner (same cohort) delete → fails; unauthenticated delete → fails.
- [ ] The full `cd express-api && npm test` is green with the emulator up (these suites + the rest, 0 regressions).

### Error paths
- [ ] A caller whose token is **missing the `uniqueId` claim** is denied on create (the rule's `callerUniqueId()` has no default and the create predicate fails closed), proven via the engine rather than assumed.
- [ ] `messages` subcollection: create by a non-owner/non-participant → fails; `update`/`delete` by a non-`senderId` → fails; the sender editing their own message → succeeds.
- [ ] `seatRequests` subcollection: a create with `userId` != caller's `string(uniqueId)` (impersonation) → fails; the genuine requester or the room owner updating a request → succeeds; a third party → fails.

### Edge cases
- [ ] **`list` contract (SHY-0102 root-cause pin):** a `list` of rooms constrained by `where('cohort','==', <caller cohort>)` AND `where('state','in',['ACTIVE','OWNER_AWAY'])` → `assertSucceeds` with the **exact expected document count** per cohort (adult=2, minor=1, empty cohort=0); an **unfiltered** state-only `list` (today's client query) → `assertFails` (documents the bug to stop sending); a minor pinning `where('cohort','==','adult')` → `assertFails` (segregation holds); anonymous `list` → `assertFails`.
- [ ] Boundary persona matrix is exercised with distinct UIDs (ADULT, ADULT_2 participant, ADULT_3 non-participant, MINOR, ADMIN, NO_CLAIMS) so cross-persona reads/writes are tested against real, distinct tokens — not a single mutated fixture.
- [ ] Per-test isolation: `clearFirestore()` in `beforeEach`; no doc leaks between cases ([[feedback-test-isolation-no-leaks]]).

### Performance
- [ ] One gRPC client handle is cached **per persona** (a `Map`), not one per assertion — the suite opens ~6 channels, not ~40; `cleanup()` closes them in `afterAll` and the Jest worker exits gracefully (no "worker failed to exit" warning; [[feedback-warnings-are-failures]]).
- [ ] All 4 `firestore-rules` suites complete in a few seconds against a warm emulator.

### Security
- [ ] No credentials/secrets: emulator sandbox project id `demo-shytalk-rooms-rules-<worker>`; rules loaded from the repo `firestore.rules`; no external network; no `private_key` touched.
- [ ] The cohort read-segregation assertions (minor↔adult both directions) constitute the OSA §17 evidence; the suite fails loudly if a future rule edit widens cross-cohort read access.

### UX
- [ ] N/A — backend rules test harness; no user-facing surface. (The SHY-0102 *symptom* — empty Rooms screen — is fixed under its own story; this slice only pins the contract.)

### i18n
- [ ] N/A — no user-facing strings.

### Observability
- [ ] The structural source-contract guards that **no engine test can express** are preserved (not deleted) in `room-rules-static.unit.test.js`: the lockdown→endpoint migration map (19 endpoints), the seat race-safety preconditions (`SEAT_TAKEN`/`ALREADY_SEATED`), and the `users/{uniqueId}` `currentRoomId` self-write guard — so coverage is migrated, never regressed.

## BDD Scenarios

**Scenario: an adult cannot read a minor's room**
- **Given** the emulator holds a room stamped `cohort: 'minor'`
- **When** an adult-claimed caller issues `get` on that room
- **Then** the Rules engine denies it (`assertFails`)
- **And** the same adult reading an `adult`-stamped room succeeds

**Scenario: the cohort-filtered rooms list is allowed; the unfiltered one is denied**
- **Given** two `ACTIVE` adult rooms and one `ACTIVE` minor room exist
- **When** an adult caller lists rooms `where cohort == 'adult' AND state in ['ACTIVE','OWNER_AWAY']`
- **Then** the engine allows it and returns exactly 2 docs
- **And** the same caller listing rooms `where state in ['ACTIVE','OWNER_AWAY']` with **no** cohort constraint is denied (this is the SHY-0102 client bug)

**Scenario: client room updates are locked to the Admin SDK**
- **Given** a room owned by the caller
- **When** the owner attempts a client `update()` on the room doc
- **Then** the engine denies it (`update: if false`), forcing the change through a server endpoint

**Scenario: a seat request cannot impersonate another user**
- **Given** an adult caller with `uniqueId` 50001
- **When** they create a `seatRequests` doc with `userId: '50002'`
- **Then** the engine denies it (anti-impersonation `userId == string(callerUniqueId())`)

**Scenario: the worker exits cleanly**
- **Given** the suite cached one handle per persona and called `cleanup()` in `afterAll`
- **When** Jest finishes the suite
- **Then** there is no "worker process failed to exit gracefully" warning

## Test Plan

**RED (the prior state this replaces):** the old `room-rules.test.js` passed unconditionally (`expect(true).toBe(true)` + source-text regexes) — it could not fail on a wrong rule. The new suite is RED-meaningful: point it at a deliberately-broken rule (e.g. drop `cohortMatchesCaller()` from read) and the segregation assertions fail; restore and they pass.

**GREEN:**
- `room-rules.test.js` — real-engine suite: per-persona handle cache, `seedDoc`/`seedRoom` helpers, `clearFirestore()` per test; describes for create / read / update-lockdown / delete / `messages` / `seatRequests` / rooms-`list` contract.
- `room-rules-static.unit.test.js` — preserved structural guards (endpoint map, seat race-safety, `currentRoomId`).
- Bring up the local stack → `cd express-api && npm test` green (**125/125** across the 4 `firestore-rules` suites; full canonical suite 0 regressions).

**Frameworks:** Express/Node Jest (`npm test`), `@firebase/rules-unit-testing` v5 against the Firestore emulator, eslint (`--max-warnings=0`), prettier, SHY frontmatter validator.

**Gauntlet exemption (matches SHY-0110):** the diff is **100% `*.test.js`** + this story file — **no** production code, **no** `firestore.rules` edit, **no** app/web/device surface. A test-file-only change has no user-facing runtime to regress, so the device journey gauntlet (real Android + iOS + all browsers) is **not** warranted here; the authoritative gate is **CI-green** — the Test Backend job (emulator-in-CI, SHY-0109) runs these very suites against the real emulator. The full journey protocol stays mandatory for any slice that touches production/`firestore.rules`/app/web ([[feedback-release-gated-on-full-journey-protocol]]).

## Out of Scope
- **The SHY-0102 client fix** (add `where('cohort','==', cohortClaim)` to `getActiveRooms()` tri-platform) — its own branch/PR under the SHY-0102 bug story. This slice only *pins the contract* that proves the fix is client-side and needs no rules change.
- **No `firestore.rules` change** — the engine proved the rooms rule is already correct and secure; therefore **no rules-deploy operator checkpoint** is triggered by this slice.
- The room-mutations express endpoint tests (the next SHY-0113 slice) — they exercise the Admin-SDK endpoints, a different surface; the static guards here are their interim safety net.
- Other rules blocks (users / conversations / wallet) — each its own follow-on, reusing this pattern.

## Dependencies
- SHY-0109 (merged) — emulator-in-CI + `tests/helpers/firebase-emulator.js` (`firestoreHostPort()`, `assertEmulatorReachable()`, `clearCollection*`). This branch is off `origin/main` which includes it.
- `@firebase/rules-unit-testing` v5.0.1 (already a devDependency).
- Local emulator stack (`bash local/start.sh`) for local verification + pre-push Jest.

## Risks & Mitigations
- **Risk:** non-unref'd keepalive timers on the rules-testing gRPC channels hang the Jest worker. **Mitigation:** one cached handle per persona + `cleanup()` in `afterAll`; proven — worker exits with no warning. **Do not** regress to per-assertion `authenticatedContext().firestore()`.
- **Risk:** per-worker emulator data collisions if these run in parallel with other emulator suites. **Mitigation:** project id is namespaced per Jest worker (`demo-shytalk-rooms-rules-<JEST_WORKER_ID>`); `clearFirestore()` per test.
- **Risk:** a reviewer reads the static guards as the banned "structural-grep-as-behaviour" pattern. **Mitigation:** the file's header documents they are *source-shape invariants no engine test can express* (endpoint existence, seat preconditions, deny-list membership) — explicitly distinct from behaviour, which the engine suite now owns.

## Definition of Done
- `room-rules.test.js` is engine-backed + tautology-free; `room-rules-static.unit.test.js` preserves the structural guards; `npm test` fully green (125/125 in the rules suites, 0 regressions); eslint `--max-warnings=0` + prettier clean; no worker-exit warning.
- `code-reviewer` zero findings on the local commit before push ([[feedback-reviewer-before-push-not-parallel]]).
- Story flipped → In Review before the push that triggers CI (Pre-Merge Gate checks the diffed story is In Review).
- Pushed; CI required checks green by name (Detect Changes, Analyze JavaScript, PR Gate, Test Backend, SonarCloud) with the emulator exercised. CI-green is the authoritative gate (test-file-only → gauntlet exemption, per SHY-0110); no device-journey evidence required for this slice.
- Judgment-merge (no auto-merge). Story → Done on the next release cut ([[feedback-done-equals-release-cut]]).
- `Reviewed-up-to:` marker recorded in Notes.

## Notes (running log)
- **2026-06-19 ~09:50 BST — built + committed** on branch `story/SHY-0113-rooms-rules-real-migration` (re-authored under [SHY-0129] + branch renamed at carve time). First true rules-engine suite in the repo. Initial state: 108/108 green across the 4 `firestore-rules` suites; eslint/prettier clean; teardown leak fixed (per-persona handle cache). Architect skipped (test-harness refactor reusing the proven SHY-0109 emulator pattern, [[feedback-rate-limit-slowdown-strategies]]).
- **2026-06-19 — carved from SHY-0113.** Packaging decided by the operator: the rules-harness slice is its own SHY/PR (this one); the SHY-0102 client fix is separate. Per the SHY-0128 Gate-1 dogfood, this PR keeps its story-diff to **only SHY-0129 (+ the EPIC child-list)** — the parent SHY-0113 (`In Progress`) is deliberately NOT touched in this mergeable PR; its log will record the slice on its own next mergeable PR.
- **Findings proved against the live engine (recorded here so they are not lost):**
  - **SHY-0102 ("empty Rooms screen") = CLIENT bug, not rules.** Same adult caller: `get` single room ALLOWED; `list rooms where state in [ACTIVE,OWNER_AWAY]` (today's exact client query, `IosRoomRepositoryImpl.kt:31`) → `permission-denied`, even when empty; BUT `list rooms where cohort==adult AND state in [...]` → ALLOWED; minor filtering `cohort==adult` → still denied. Firestore (rules-aren't-filters) rejects a `list` unless the query CONSTRAINS the rule's gated field (`resource.data.cohort`). **Rule is correct + secure → NO rules change → NO rules-deploy checkpoint.** Fix = client-side `where('cohort','==', cohortClaim)` on `getActiveRooms()`, under the SHY-0102 bug story.
  - **"Can't create rooms" = CLIENT claim-propagation race.** A fully-claimed adult create is ALLOWED by the engine; an unclaimed freshly-signed-in token is denied (app calls `createRoom` before `uniqueId`/`cohort` land on the ID token). Fix = client force-refresh; verify on a real-device room-creation journey. File as a client bug SHY.
- **2026-06-19 — `code-reviewer` round 1 → all findings applied; 108→125 green.** The reviewer (correctly) surfaced a **CI-breaking** `check-no-new-stubs.js` failure plus real coverage gaps. Fixes:
  - **Ratchet (CI-breaking):** the new structural file carried `jest.mock`/`jest.fn` outside a unit-test location → renamed `room-rules-static.test.js` → **`room-rules-static.unit.test.js`** (it reads source text with zero real collaborators — genuinely a unit test, so doubles are policy-exempt); and the rewritten `room-rules.test.js` dropped the doubles its baseline still recorded → regenerated `scripts/no-stubs-baseline.json` (−2 stale entries, **shrink-only**, verified no additions). Ratchet now 0 offenders.
  - **Coverage added (+17 tests):** `messages` **delete** (sender ✓ / non-sender ✗ / anon ✗ — the other half of `allow update, delete`); `seatRequests` **delete implicitly denied** (block grants only read/create/update); `seatRequests` read **reverse cohort** (adult→minor ✗) + **admin bypass** (✓); rooms read **reverse cohort** single-doc (adult→minor ✗); **admin-cannot-delete** a room (no admin bypass on delete); `messages` **cross-cohort non-participant** denied; **partial-claims** create race (uniqueId present, cohort absent → ✗); a `messages` **LIST** contract block (member ✓ / admin ✓ / cross-cohort ✗ / anon ✗ — proves the subcollection list is NOT subject to a SHY-0102-style denial because its rule gates on the parent cohort, not per-doc `resource.data`). Split the two compound succeed+fail tests into individually-named cases.
  - **Defence-in-depth note for the operator (NOT changed here — would be a rules change):** `messages.create` / `seatRequests.create` gate on membership/identity, NOT cohort. Reachable cross-cohort is blocked (participation is cohort-gated server-side + `rooms update: if false`), but an Admin-SDK-planted cross-cohort participant could post. Adding a cohort gate on subcollection *create* is a possible follow-on rules SHY (needs the operator rules-deploy checkpoint).
  - 125/125 green across the 4 `firestore-rules` suites; eslint `--max-warnings=0` + prettier clean; ratchet 0 offenders.
- **2026-06-19 — `code-reviewer` round 2 → PASS (zero findings).** Re-reviewed the amended commit: confirmed all 10 round-1 findings genuinely closed with value-level engine assertions, the baseline change correct + shrink-only, no isolation leaks or wrong-count risks introduced. One sub-threshold note (the seatRequests-delete test packed two `assertFails`) — split into two individually-named tests (requester / owner), +1 test → **125/125**. **Reviewed-up-to: `54ebf4ea4b5`** (round-2 PASS); the only post-review delta is that reviewer-endorsed split + the 124→125 count bump — no behavioural/contract change. Status flipped → In Review.
- **2026-06-19 — CI red (PR #1478, commit `ba062ad`) → root-caused + fixed (NOT a test bug).** Test Backend + SonarCloud both failed: `Cannot find module '@firebase/rules-unit-testing' from room-rules.test.js` (PR Gate cascaded from the two). Root cause = **manifest/CI resolution asymmetry**: the package was a **root** devDependency only, so local Jest resolved it by walking up to the repo-root `node_modules`, but CI's Test Backend / SonarCloud run an isolated `cd express-api && npm ci` with no parent tree to walk into → unresolved. Fix = added `@firebase/rules-unit-testing@^5.0.1` to **`express-api/package.json`** devDependencies (+ lockfile; 41 transitive pkgs, 0 vulns). Verified the honest way — clean `cd express-api && npm ci` (lockfile-based, exactly CI's model) then `jest tests/firestore-rules` → **125/125**, no module error. Shipped as a follow-on commit (no force-push). Lesson: a new import in a sub-package's tests must be in THAT sub-package's manifest, not merely root-resolvable ([[feedback-verify-file-tracked-before-ci-reference]] / [[feedback-workflow-verify-by-running]]).

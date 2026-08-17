---
id: SHY-0171
status: Cancelled
owner: claude
created: 2026-07-09
priority: P2
effort: M
type: bug
roadmap_ids: []
epic: EPIC-0003
pr:
mvp: false
---

# SHY-0171: Four cron test files wipe the shared `users` collection, so they cannot run in parallel with any suite that signs a user in

## User Story

**As** an engineer trusting a green test run,
**I want** no test file to delete data another file is actively using,
**So that** a passing suite means the code is right, not that the parallel scheduling happened to be kind.

## Why

Jest runs test **files** in parallel workers against ONE Firestore emulator project. Four real-emulator cron suites call `clearCollection(db, 'users')` in `beforeEach`/`afterAll` — a wipe of the *entire* collection:

- `express-api/tests/cron/orphanedStorage.test.js:81,91`
- `express-api/tests/cron/backups.test.js:76,88`
- `express-api/tests/cron/subscriptions.test.js:43,47`
- `express-api/tests/cron/expireDataExports.test.js:75,80`

Meanwhile `tests/helpers/real-auth.js`'s `mintRealUser` writes `users/{uniqueId}` for every real-emulator suite that needs a signed-in caller. If a cron `beforeEach` fires while such a suite is mid-test in another worker, the caller's user doc vanishes: `resolveUniqueId` (`middleware/auth.js`) returns `null`, and `checkUserBans` then skips **all** device-ban resolution (a null `uniqueId` has no `deviceBindings`, so only network bans apply). The affected assertions pass or fail for reasons unrelated to the code under test.

This is the same defect class SHY-0149 root-caused and fixed for `deviceBindings` / `deviceBans` / `networkBans` (per-file id prefixes + `clearPrefixed`), left open on `users`. It is **not** fixable by the same mechanism: `subscriptions.test.js:53` asserts *"an empty users collection is a clean no-op"*, and the crons under test scan the whole collection. These suites genuinely require exclusive access.

Surfaced by the SHY-0149 round-5 code review. Not exploitable in production — this is test-infrastructure correctness — but it silently undermines the trustworthiness of every real-emulator suite that mints a user.

## Acceptance Criteria

### Happy path
- [ ] The four cron suites still assert exactly what they assert today (including the empty-collection no-op case) and pass.
- [ ] A real-emulator suite that mints a user (e.g. `auth-ban-gate.test.js`) passes when run in parallel with all four cron suites, repeatedly.

### Error paths
- [ ] A cron suite's cleanup can no longer delete a user document created by another test file — demonstrated, not asserted by inspection.

### Edge cases
- [ ] The chosen mechanism holds when a cron suite fails mid-test (cleanup still scoped, no leak).
- [ ] `local/seed.js` data and the `npm run local` server are unaffected (they must keep the canonical project + collection).

### Performance
- [ ] No full-suite wall-clock regression beyond ~10% (a blanket `--runInBand` would be far worse and is out of scope).

### Security
- N/A — test-infrastructure change; no production surface.

### UX
- N/A — no user-facing surface.

### i18n
- N/A — no user-facing strings.

### Observability
- [ ] If the isolation mechanism is violated (a file wipes a shared collection), it fails loudly at test time rather than producing a mystery flake.

## BDD Scenarios

**Scenario: two test files that both use accounts run at the same time**
- **Given** one test file that needs an empty list of accounts
- **And** another test file that has just created an account and is using it
- **When** both run at the same time
- **Then** neither disturbs the other, and both report the truth about the code

**Scenario: a cleanup runs while another test is working**
- **Given** a test file finishing and tidying up after itself
- **When** another test file is midway through a check that relies on its own data
- **Then** the tidying removes only the first file's data

## Test Plan

Touches `express-api/tests/**` only → no product runtime surface; the device/browser gauntlet does not apply (CI-config-only-adjacent, but classify per the story's final shape).

**Red → Green:**
- **Express/Node (Jest, real emulator):** reproduce first — run `tests/cron/subscriptions.test.js` in parallel with `tests/middleware/auth-ban-gate.test.js` in a loop and observe the 401/pass-through flake (this is the RED). Then apply the chosen isolation and show 10 consecutive green parallel runs.
- Verify with `--runInBand` first to prove the failure is scheduling-dependent, not logic.
- **Static/quality:** `npm run lint` 0 warnings; prettier clean.

**Options to weigh (pick with evidence, not taste):**
1. A dedicated Jest **project**/config for exclusive-access real-emulator suites, run serially after the parallel ones.
2. A file-level advisory lock so exclusive suites never overlap a user-minting suite.
3. Scope each cron to a projectId/namespace of its own — **rejected already**: the Auth emulator resolves tokens against the project it was started with, so per-worker projects 401 every minted token (proven under SHY-0149).

## Out of Scope
- The `deviceBindings`/`deviceBans`/`networkBans` isolation — already delivered by SHY-0149.
- Any production code change.

## Dependencies
- `express-api/tests/helpers/firebase-emulator.js` (`clearCollection`, `clearPrefixed`), `tests/helpers/real-auth.js` (`mintRealUser`), `express-api/jest.config.js`.

## Risks & Mitigations
- **Risk:** a serial project meaningfully slows CI. **Mitigation:** only the handful of exclusive-access suites run serially; measure before/after.
- **Risk:** an advisory lock deadlocks a crashed worker. **Mitigation:** timeout + fail loudly.
- **Risk:** the fix looks green because the flake is probabilistic. **Mitigation:** the RED step must reproduce the flake first, and the GREEN step needs repeated parallel runs, not one.

## Definition of Done
- [ ] The flake is reproduced BEFORE the fix, and 10 consecutive parallel runs pass after it.
- [ ] No test file wipes a collection another file writes; violations fail loudly.
- [ ] `code-reviewer` 100% clean → In Review → CI green by name → merge → `released_in:` on the next cut.

## Notes (running log)

- 2026-07-10 — **CANCELLED — the work landed inside [[SHY-0149]] instead.** The collision stopped being theoretical: during SHY-0149's round-8 full-suite run, `tests/middleware/auth-suspension-cache-clear.test.js` failed with a suspended user reading as unsuspended (403 expected, 200 received) — a cron worker's `clearCollection(db, 'users')` had deleted the minted user mid-test. The file passes alone (4/4). With this PR's own test signal at stake, deferring was no longer defensible.
- **The fix** is narrower than this story assumed. The blocker was believed to be "these suites need an empty collection, so they can't be prefix-scoped." True — but they do not need **Auth**, and Auth is the only thing per-project namespacing breaks (the emulator resolves tokens against the project it was started with). So `src/utils/firebase.js` now honours an opt-in `FIRESTORE_TEST_NAMESPACE` env var under `NODE_ENV=local`, and each of the four suites claims its own project (`subs` / `exports` / `storage` / `backups`) before requiring the module. Their wholesale `users` wipes now hit an isolated project; the "empty users collection is a clean no-op" assertion keeps its exact meaning. Verified: the previously-colliding set passes 77/77 across three consecutive parallel runs.
- **The general lesson** is in [[reference-emulator-parallel-test-isolation]]: per-worker projectId fails for Auth-minting suites, but per-FILE project namespacing is fine for Firestore-only suites. Two different tools for two different constraints.

- 2026-07-09 — **CREATED fully-refined** from the SHY-0149 round-5 review (reviewer finding R5-C3). SHY-0149 fixed the same defect class for `deviceBindings`/`deviceBans`/`networkBans` via per-file id prefixes + `clearPrefixed`, and removed its own `users` wipes — but the four cron suites still wipe `users` wholesale, and cannot simply be prefix-scoped because they assert on an empty collection. Filed rather than folded into SHY-0149: it needs a scheduling/config decision (serial project vs lock), touches files outside that story's scope, and its RED step is a reproduction harness, not a code change. Per-worker `projectId` is already ruled out with evidence (Auth emulator 401s — see [[reference-emulator-parallel-test-isolation]]).

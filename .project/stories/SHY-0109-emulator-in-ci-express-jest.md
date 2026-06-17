---
id: SHY-0109
status: In Review
owner: claude
created: 2026-06-16
priority: P1
effort: M
type: infra
roadmap_ids: []
epic: EPIC-0003
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1445
mvp: false
---

# SHY-0109: Provision Firebase Emulators in CI for the express Jest suite (Phase 3 keystone)

## User Story

**As** the team draining EPIC-0003's express-api Jest mock debt (182 of 198 files `jest.mock('../../src/utils/firebase')`),
**I want** the CI jobs that run the express Jest suite (`test-backend.yml` + `sonarcloud.yml`) to provision the real Firebase Emulator stack (Auth + Firestore + RTDB) before Jest runs, plus a proven, reusable pattern (helper + a migrated proof-of-concept test) for talking to it,
**So that** every subsequent Phase-3 migration can replace `jest.mock(firebase)` with the **real** local-emulator backend (`$0`, no credentials, CI-safe) instead of an in-process double — unblocking the bulk of the EPIC.

## Why

Phase 3 of EPIC-0003 migrates ~195 express-api Jest files from in-process mocks to the real local stack. Evidence (this session's survey): **182 of 198** `jest.mock` offenders mock `../../src/utils/firebase` — they all gate on one missing piece of infrastructure: a **real Firebase emulator available in CI**. The EPIC charter calls this out as *"emulator-in-CI infra SHY first"* — it is the keystone that unblocks the rest of Phase 3.

The mechanism already exists end-to-end and is $0/credential-free: `express-api/src/utils/firebase.js` keys off `NODE_ENV==='local'` to point the Admin SDK at `localhost:8080/9099/9000` under projectId `demo-shytalk` (the `demo-` prefix is the Admin SDK's emulator-sandbox marker → **no service-account credentials, no cloud quota**). The repo already has a battle-tested `./.github/actions/start-firebase-emulators` composite action (caches the emulator JARs, installs `firebase-tools`, starts all emulators, waits for readiness) — used today by `playwright-tests.yml`, `integration-tests.yml`, and `e2e-tests.yml`. This story **wires that existing action into the two Jest jobs** and proves the path with one real migration (`expireTempIds`), rather than building emulator provisioning from scratch.

The operator authorised this story to **push and merge on the CI-green gate** (AskUserQuestion 2026-06-16 "Build + push the emulator-in-CI infra") — explicitly *not* the real-device gauntlet, because it touches no app/web/device surface (a CI-workflow change's only true proof is a CI run; it cannot be safely parked — [[feedback-workflow-verify-by-running]]).

## Acceptance Criteria

### Happy path
- [ ] `test-backend.yml`'s `test-backend` job runs `./.github/actions/start-firebase-emulators` **before** the Jest step, and sets up a JVM (Temurin 21, the SHA-pinned `actions/setup-java@be666c2fcd27ec809703dec50e508c2fdc7f6654`) before that action, because the Firestore + RTDB emulators are JVM-based.
- [ ] `sonarcloud.yml`'s job runs `./.github/actions/start-firebase-emulators` **before** the Jest step (its JVM is already provided by the existing `./.github/actions/setup-jdk-gradle` step — no second JVM setup).
- [ ] `express-api/tests/cron/expireTempIds.test.js` is migrated off `jest.mock('../../src/utils/firebase')`: it sets `NODE_ENV=local`, seeds the **real** Firestore emulator via the Admin SDK, runs the real `expireTempIds()` cron, and asserts the **real** post-state by reading the emulator back.
- [ ] A reusable helper `express-api/tests/helpers/firebase-emulator.js` exports `assertEmulatorReachable()` (fast, actionable preflight) and `clearCollection(db, name)` (Admin-SDK batch delete for test isolation), tested against the real emulator in `express-api/tests/helpers/firebase-emulator.test.js`.
- [ ] Running the canonical `cd express-api && npm test` with the local emulator stack up is **fully green** (the migrated + helper tests pass; no other test regresses).

### Error paths
- [ ] When the Firestore emulator is **not reachable**, the migrated + helper tests fail **fast and loud** with an actionable message (`run \`bash local/start.sh\``) — NOT a multi-second hang, and NOT a silent skip (a silent skip would be a soft mock — the exact false-confidence the EPIC bans).
- [ ] `assertEmulatorReachable()` rejects within a bounded timeout (≤ ~6s) when nothing is listening on `localhost:8080`, with the host/port + remediation in the message.
- [ ] The migrated cron test proves the **negative path** for real: a user whose `tempUniqueIdExpiry` is in the **future**, one whose value is the `0` sentinel, and one with **no** `tempUniqueIdExpiry` field are all left **untouched** by the cron (verified by reading them back from the emulator) — i.e. the real compound query `tempUniqueIdExpiry <= now AND > 0` is exercised, not a `jest.fn()` stand-in.

### Edge cases
- [ ] The migrated cron test exercises the real `> 0` lower bound (the `0` sentinel is excluded) AND the real `<= now` upper bound (future expiry excluded) AND a doc with the field **absent** (excluded) — value-level, not "the mock was called".
- [ ] Each test starts from a **clean** `users` collection (`clearCollection` in `beforeEach` + `afterAll`) so order/leakage cannot mask a defect ([[feedback-test-isolation-no-leaks]]).
- [ ] Setting `NODE_ENV=local` inside the migrated test does not leak into other test files sharing the same Jest worker (restored in `afterAll`); every other express test continues to mock firebase and is unaffected.
- [ ] The CI wiring leaves the Jest command itself unchanged (`--experimental-vm-modules … --forceExit`) so the existing `archiver` dynamic-import contract is preserved.

### Performance
- [ ] Emulator startup is cached (`~/.cache/firebase/emulators` via the existing action) so steady-state CI cost is the boot wait (~30–60s), well inside the job's timeout; `test-backend.yml`'s `timeout-minutes` is raised from 10 → 15 to absorb the first cold-cache boot.
- [ ] `clearCollection` deletes in a single batched pass (no per-doc round-trip storm); the migrated suite completes in a few seconds against a warm emulator.

### Security
- [ ] No credentials anywhere: the emulator path uses projectId `demo-shytalk` (Admin-SDK emulator sandbox) — no service account, no `GOOGLE_APPLICATION_CREDENTIALS`, no secret env. Nothing is logged that could leak a key (there is no key).
- [ ] `assertEmulatorReachable()` only probes `localhost` over loopback; no external network; the preflight never executes scanned code or evaluates remote input.

### UX
- [ ] Developer experience: a contributor running `npm test` without the stack gets one clear, actionable failure pointing at `bash local/start.sh` — not a cryptic gRPC deadline-exceeded after 60s. The pattern (helper + `NODE_ENV=local` first line + clear preflight) is documented in the helper's header so the next 181 migrations copy a known-good shape.

### i18n
- N/A — CI infrastructure + backend test harness; no user-facing strings.

### Observability
- [ ] On emulator-unreachable, the failure message names the exact host:port and the remediation command, so a red CI/local run is self-diagnosing. The `start-firebase-emulators` action already emits a `::error::` if emulators don't come up within 120s.

## BDD Scenarios

**Scenario: CI provisions emulators before Jest (test-backend.yml)**
- **Given** the `test-backend` job on a PR that touches `express-api/`
- **When** the workflow runs
- **Then** the `setup-java` (Temurin 21, pinned SHA) and `start-firebase-emulators` steps both execute and appear **before** the "Run Express API tests with coverage" step
- **And** the migrated `expireTempIds` test passes against the running emulator (proving the emulator was actually reachable from Jest)

**Scenario: CI provisions emulators before Jest (sonarcloud.yml)**
- **Given** the SonarCloud workflow job
- **When** it runs the express coverage step
- **Then** `start-firebase-emulators` runs before the Jest step, reusing the JVM from the existing `setup-jdk-gradle` step (no duplicate JVM setup)

**Scenario: migrated cron test verifies real query semantics**
- **Given** the Firestore emulator is running and the `users` collection is seeded with two expired temp IDs, one future temp ID, one `0`-sentinel, and one with no expiry field
- **When** `expireTempIds()` runs against the real emulator
- **Then** reading the emulator back shows exactly the two expired docs cleared (`tempUniqueId == null && tempUniqueIdExpiry == null`)
- **And** the future, `0`-sentinel, and field-absent docs are unchanged

**Scenario: emulator-absent fails loud, not silent**
- **Given** nothing is listening on `localhost:8080`
- **When** the migrated/helper test suite runs
- **Then** it fails within ~6s with a message naming `localhost:8080` and `bash local/start.sh`
- **And** it does NOT report a passing/skipped result (no soft-mock false confidence)

**Scenario: helper clears a collection for isolation**
- **Given** the `users` collection has 3 seeded docs in the emulator
- **When** `clearCollection(db, 'users')` runs
- **Then** a subsequent read of `users` returns empty

## Test Plan

**RED (write first, must fail before the change):**
- `express-api/tests/scripts/emulator-in-ci-pin.test.js` (NEW) — asserts `test-backend.yml` references `./.github/actions/start-firebase-emulators` + a pinned `actions/setup-java`, both ordered before the Jest run; asserts `sonarcloud.yml` references `start-firebase-emulators` before its Jest run. **Fails now** (workflows don't reference the action yet).
- `express-api/tests/cron/expireTempIds.test.js` (REWRITTEN, real-emulator) — run **without** an emulator → fails fast via `assertEmulatorReachable()` (proves the test genuinely requires a real Firestore; a mock-based test would pass with no emulator).
- `express-api/tests/helpers/firebase-emulator.test.js` (NEW) — `clearCollection` + `assertEmulatorReachable` exercised against the real emulator.

**GREEN:**
- Add `setup-java` + `start-firebase-emulators` to `test-backend.yml`; add `start-firebase-emulators` to `sonarcloud.yml` → pin test passes.
- Bring up the local emulator stack (`bash local/start.sh`) → migrated + helper tests pass.

**Frameworks exercised:** Express/Node Jest (`cd express-api && npm test`), eslint (`npm run lint`, `--max-warnings=0`), prettier (`npm run format:check`), actionlint (workflow changes), the SHY frontmatter validator. **Real backend:** Firebase Emulator Suite (Auth 9099 / Firestore 8080 / RTDB 9000) under projectId `demo-shytalk`.

**Gauntlet exemption rationale:** touches CI workflows + Node test harness only — no `app/`, `shared/`, `public/`, iOS, or device surface. Per the Pre-Merge Protocol the device/browser gauntlet does not apply; the authoritative proof is **CI green** on the two modified jobs (the migrated test actually executing against the CI-provisioned emulator). Operator set this gate explicitly.

## Out of Scope
- Migrating the other 181 `jest.mock(firebase)` files — each is its own follow-up Phase-3 slice; this story delivers only the infra + one PoC migration.
- The non-firebase `jest.mock` offenders (~16, e.g. `jest.mock('../../src/utils/log')`) — they don't gate on the emulator; handled in later phases.
- Changing the `start-firebase-emulators` action's cache key strategy (pre-existing; works for 3 consumers).
- Any production code change to `expireTempIds.js` (unchanged — only its test's data source changes).
- Adding SHY-0108/SHY-0109 to `EPIC-0003` `child_shys` (deferred to a consolidation pass to avoid cross-branch conflicts; the `epic:` frontmatter already links them).

## Dependencies
- `./.github/actions/start-firebase-emulators` (exists).
- `express-api/src/utils/firebase.js` `NODE_ENV=local` emulator path (exists).
- `firebase.json` emulator port config (exists: auth 9099 / firestore 8080 / database 9000 / ui 4000).
- Local emulator stack (`bash local/start.sh`) for local verification + pre-push (`.husky/pre-push` runs Jest in its Sonar scan).
- Soft-relates to SHY-0108 (the ratchet baseline lists `expireTempIds.test.js` as a `jestMock` offender): whichever of SHY-0108/SHY-0109 merges **second** must regenerate `scripts/no-stubs-baseline.json` (the migrated file no longer offends → otherwise a STALE-baseline failure). SHY-0108 is not present on this branch, so its guard does not run here.

## Risks & Mitigations
- **Risk:** emulator boot flakiness in CI. **Mitigation:** the existing action already waits up to 120s for readiness + emits a `::error::` on timeout; JARs are cached; timeout raised to 15 min.
- **Risk:** `NODE_ENV=local` leaking across Jest test files in a shared worker. **Mitigation:** restored in `afterAll`; every other express test mocks firebase so is unaffected regardless.
- **Risk:** making `npm test`/pre-push now require the stack is a DX change. **Mitigation:** this is EPIC-0003's intended end-state (real services, not mocks); the failure is loud + actionable; the stack is already a documented Pre-Merge prerequisite.
- **Risk:** SonarCloud coverage shape changes because one test now hits real I/O. **Mitigation:** coverage is line/branch-based on `src/`; the cron's real path is now genuinely covered (strictly better), and `--forceExit` already handles open handles.

## Definition of Done
- Both workflows provision emulators before Jest; the migrated + helper + pin tests are green locally against the up stack; `npm test` fully green; `npm run lint` + `format:check` clean; actionlint clean on the workflow changes.
- `code-reviewer` (and a security pass) report **zero** findings on the local commit before push ([[feedback-reviewer-before-push-not-parallel]]).
- Pushed; **CI required checks green by name** (Detect Changes, Analyze JavaScript, PR Gate) — and specifically the `Test Backend` + SonarCloud jobs green with the emulator actually exercised.
- Judgment-merge (zero doubt; CI-gated per operator) — NOT auto-merge. Notify operator on merge.
- Story flipped `In Review` → `Done` on the next release cut with `released_in: vX.Y.Z`.

## Notes (running log)
- **2026-06-16 ~22:35 BST — created In Progress.** Operator chose "Build + push the emulator-in-CI infra" (AskUserQuestion). Architect skipped: low-risk infra reusing an existing, proven composite action ([[feedback-rate-limit-slowdown-strategies]]). Investigation confirmed: 182/198 jest.mock files mock firebase; `start-firebase-emulators` action already exists + is used by 3 workflows; `firebase.js` `NODE_ENV=local`→`demo-shytalk` emulator path is credential-free/$0. PoC target = `expireTempIds` (smallest, pure-Firestore, real compound-query semantics meaningless when mocked). EPIC `child_shys` + SHY-INDEX-vs-0108 baseline reconciliation deferred to consolidation (noted in Out of Scope + Dependencies).
- **2026-06-16 ~22:40 BST — TDD complete + local green.** RED: pin test 8/8 fail (workflows unwired). GREEN: wired both workflows; pin 8/8 pass. Migrated cron + helper tests pass against the real local emulator (14/14, incl. the fast-fail-when-absent guard). Full canonical `npm test` = 333 suites / 12,333 tests, 0 failed. eslint `--max-warnings=0` + prettier + actionlint clean.
- **2026-06-16 ~22:50 BST — code-reviewer: 0 Critical, 3 Important (I1 double-settle guard, I2 clearCollection loop clarity, I3 helper console-vs-log note) — ALL applied** to `tests/helpers/firebase-emulator.js`; re-verified green. Pre-push SonarCloud quality gate passed.
- **2026-06-16 ~23:05 BST — pushed → PR #1445; CI ALL GREEN.** Required checks by name: Detect Changes ✓, Analyze JavaScript ✓, PR Gate ✓. `test-backend / Test Backend` ✓ (3m9s) — CI job log confirms emulators booted (`All emulators ready! Firestore 127.0.0.1:8080`) and `PASS tests/cron/expireTempIds.test.js` + `PASS tests/helpers/firebase-emulator.test.js` + `333 suites / 12,333 tests passed`. `sonarcloud / SonarCloud Analysis` ✓ (also emulator-provisioned), quality gate ✓, lint ✓, integration-tests ✓. Emulator JAR cache saved (`firebase-emulators-Linux`) → steady-state cost = boot only. CI-green gate met (operator-authorised; no device surface) → judgment-merge.

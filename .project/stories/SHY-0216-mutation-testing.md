---
id: SHY-0216
status: Draft
owner: claude
created: 2026-07-19
priority: P0
effort: M
type: infra
roadmap_ids: []
epic: EPIC-0008
mvp: true
pr:
---

# SHY-0216: Mutation testing — JS (Stryker) + Kotlin (Pitest)

## User Story

As the ShyTalk operator, I want automated mutation testing on the security- and safety-critical code (auth, bans, age-gating, payments, moderation) so that our tests are proven to actually *catch* bugs — not just execute lines — because on a minors-facing MVP a passing suite that would still stay green if the code were broken is worse than no suite at all.

## Why

The audit confirmed **no mutation testing** (no Stryker for JS, no Pitest for Kotlin). Line/branch coverage measures what *ran*, not what would be *caught* — a suite can have 100% coverage and still pass if a critical `>=` becomes `>` or a ban check is inverted. This is exactly the "a passing mutation is a finding" discipline the operator applies by hand ([[feedback-mutation-passed-means-investigate]], [[feedback-verify-the-mutant-not-just-the-mutation]]); this story automates it as a gate over the highest-risk modules. It proves test *quality*, registers into SHY-0212's runner, and gives SHY-0220 a plain-language "our tests actually catch bugs ✓" signal. Cost is controlled by scoping to critical modules + incremental (changed-files) runs, avoiding a cron ([[feedback-avoid-crons-prefer-event-driven]]).

## Acceptance Criteria

### Happy path

- [ ] **JS (StrykerJS):** `@stryker-mutator/core` is configured (`stryker.conf.json` in `express-api/`) to mutate the critical modules — `src/utils/bans.js`, `src/utils/age-verification*`, auth/OTP routes, payments/wallet, moderation — running the REAL Jest suite, with a **mutation-score threshold** (`break` = the agreed floor, `high`/`low` for reporting) that FAILS when the score drops below the floor. Registered `mutation-js` (`stack`, `publicArea: Cross-cutting`).
- [ ] **Kotlin (Pitest):** the Pitest Gradle plugin mutates the critical shared business logic (auth routing/guards, ban/age domain logic, cohort logic) running the JVM unit tests, with a mutation-score threshold that FAILS below the floor. Registered `mutation-kotlin` (`host`, `publicArea: Cross-cutting`).
- [ ] **PR gate = incremental:** on a PR, mutation runs only the changed critical files (Stryker `--incremental`; Pitest history/`--includeLaunchClasspath` scoped to the diff) so the gate is bounded; a **full** run is available on-demand via `workflow_dispatch` (no cron).
- [ ] A **surviving mutant** on changed critical code FAILS the gate, naming the file, line, the mutation (e.g. "`>=` → `>` survived"), and pointing at the test that should have killed it.
- [ ] Both register into `scripts/test/framework-registry.mjs` and emit normalized `metadata.json` (SHY-0212 contract) carrying mutation score + killed/survived/no-coverage counts; `docs/testing/mutation.md` explains in plain language what a "surviving mutant" means and why it matters.

### Error paths

- [ ] A newly-added critical branch with no test that kills its mutant FAILS `mutation-js`/`mutation-kotlin` with the specific surviving mutant — not a coverage percentage alone.
- [ ] A test that only *executes* code without asserting on it (a tautological/assertion-free test) is exposed by a surviving mutant even at 100% line coverage — the exact gap mutation testing exists to find.
- [ ] If the Jest suite / JVM tests can't run (stack down for `mutation-js`), the framework FAILS fast naming the missing dependency — a mutation run over a non-running suite is never reported green ([[feedback-environmental-is-not-a-diagnosis]]).

### Edge cases

- [ ] **Equivalent mutants** (mutations that cannot change observable behavior — genuinely unkillable) are handled by a reviewed, rationale-bearing `mutation-allowlist` per tool; the allowlist is diff-reviewed and cannot grow silently — an unexplained ignore fails review ([[feedback-never-suppress-fix-or-upgrade]]).
- [ ] Incremental mode's history/cache is keyed so a stale cache never hides a new surviving mutant (cache invalidated on source change).
- [ ] A changed file outside the critical set is not mutated by the PR gate (scope is explicit) but the on-demand full run covers the broader codebase.
- [ ] A flaky test that intermittently kills/spares a mutant is treated as a real test-quality bug to fix, not tolerated — mutation surfaces flaky assertions.

### Performance

- [ ] The PR incremental gate completes within a documented CI wall-clock budget (bounded by scoping to changed critical files + Stryker/Pitest concurrency).
- [ ] The full on-demand run is time-bounded (registry `timeoutMs`) and parallelized across mutators where the tools allow.
- [ ] Stryker/Pitest runs reuse cached tool installs ([[feedback-ci-cache-downloads-version-aware]]).

### Security

- [ ] Mutation testing runs the real suites against the real local stack — it introduces no new backend access and no mocks outside existing unit locations; it strengthens exactly the [[feedback-no-direct-backend-all-via-api]]-guarding tests.
- [ ] Mutation reports carry no secrets/PII (scores + source coordinates only; belt with SHY-0223).
- [ ] The critical-module scope explicitly includes the security/safety code so a weakened authz/ban/age test is caught by a surviving mutant.

### UX

- [ ] Failure output reads like a review comment: "In `bans.js:88`, changing `>=` to `>` survived — no test asserts the boundary; add a test at the exact expiry second." Not just "score 71% < 80%".
- [ ] `docs/testing/mutation.md` explains mutation score + surviving mutants in plain terms and the one command to run each tool locally.

### i18n

- [ ] N/A — mutation testing operates on code logic, not user-facing strings. (Localization *logic* that is critical, e.g. locale-fallback selection, is in-scope as critical code if it gates behavior, but there are no user-facing strings in this framework.)

### Observability

- [ ] Each tool's `metadata.json` records mutation score + killed/survived/no-coverage, feeding a plain-language "tests catch bugs ✓/⚠" signal for SHY-0220.
- [ ] The Stryker HTML report + Pitest report are uploaded as CI artifacts for engineers, greppable by `[framework:mutation-js|mutation-kotlin]`.
- [ ] The mutation score trend (last N runs) is retained so a slow erosion of test quality is visible before it breaches the floor.

## BDD Scenarios

**Scenario: A surviving mutant on a ban check fails the gate**
- **Given** a change to `bans.js` whose boundary (`>=` vs `>`) is not asserted by any test
- **When** `mutation-js` runs Stryker incrementally on the diff
- **Then** the gate fails
- **And** it names the file, line, the surviving mutation, and the test that should kill it

**Scenario: A tautological test is exposed despite 100% coverage**
- **Given** a test that calls a function but asserts nothing meaningful (100% line coverage)
- **When** mutation testing runs
- **Then** a mutant in that function survives
- **And** the gate fails, revealing the assertion gap

**Scenario: A Kotlin domain-logic mutant is killed**
- **Given** the auth-guard precedence logic with exhaustive commonTest coverage
- **When** `mutation-kotlin` runs Pitest over it
- **Then** every mutant is killed
- **And** the mutation score meets the floor

**Scenario: An equivalent mutant is handled without hiding real gaps**
- **Given** a genuinely equivalent mutant (no behavior change possible)
- **When** it appears in the report
- **Then** it is suppressed only via the reviewed allowlist with a written rationale
- **And** the allowlist cannot grow without review

**Scenario: PR gate stays bounded via incremental mode**
- **Given** a PR touching one critical file
- **When** the mutation gate runs
- **Then** only that file's mutants are evaluated on the PR
- **And** the run finishes within the CI budget

**Scenario: Mutation quality reaches the public page**
- **Given** a completed mutation run
- **When** SHY-0220's page reads the mutation `metadata.json`
- **Then** it can show "Our tests actually catch bugs ✓" with the score

## Test Plan

**Classification:** meta-testing over the REAL suites. `mutation-js` runs the real Jest suite (against the real local stack per EPIC-0003) many times; `mutation-kotlin` runs the real JVM unit tests. No new doubles are introduced. The only host-runnable unit portion is the allowlist parser + the metadata normalizer adapter.

### Red — write failing tests first

- Prove the gate BITES: introduce a deliberately assertion-free test over a critical function and confirm Stryker/Pitest report a surviving mutant and the gate fails.
- `express-api/tests/scripts/mutation/config.test.js` — `it('stryker scopes to the critical module set')`, `it('threshold break floor is set')`, `it('metadata records score + killed/survived/no-coverage')`, `it('allowlist requires a rationale')`.
- Kotlin: a Pitest config test / gradle verification that the plugin is applied to the shared critical logic with a score threshold.
- A meta-test asserting the PR path uses incremental mode and the full path is `workflow_dispatch`-only (no cron).

### Green — implement

1. Add StrykerJS + `stryker.conf.json` scoped to the critical modules; set the score floor; incremental on PR.
2. Add the Pitest Gradle plugin scoped to the shared critical logic; set the score floor.
3. Register both; write `docs/testing/mutation.md` + the reviewed allowlists.
4. Wire the incremental gate into CI (PR) + a `workflow_dispatch` full run (no cron).
5. **Kill every surviving mutant by adding real, asserting tests** (not by widening the allowlist) until the floor is met — this is the actual product value: stronger tests.

### Gauntlet

Touches test-suites over backend + shared logic; the mutation run exercises `express-api` + `shared` tests. Per the protocol, because it strengthens tests over backend-guarding code, the FULL relevant non-device gauntlet runs (Jest green on real stack, JVM tests green, lint, `code-reviewer` 100% clean); no new device surface, but the incremental gate + on-demand full run are proven before merge.

## Out of Scope

- Whole-codebase mutation coverage on every PR (too slow) — PR gate is scoped to critical files; broader coverage is the on-demand full run + future scope-expansion SHYs.
- iOS/Swift mutation testing (no mature $0 Swift mutation tool integrated here; Swift static analysis is SHY-0217's DAST/SAST scope) — revisit if a viable tool emerges.
- Mutation testing of pure UI composables (visual regression + a11y cover UI; mutation targets logic).
- The public rollup page — SHY-0220.

## Dependencies

- **Blocks:** contributes a test-quality signal to SHY-0220.
- **Blocked by:** SHY-0212 (registry/runner/docs/metadata). Benefits from EPIC-0003's real-emulator Jest migration (mutation runs the real suite). Uses existing Jest + JVM unit tests.
- **Tooling:** StrykerJS (open-source, $0); Pitest Gradle plugin (open-source, $0).

## Risks & Mitigations

- **Risk:** Mutation testing is slow and could balloon CI time. **Mitigation:** Scope to critical modules + incremental (changed-files) on PR; full run on-demand only; cached tool installs; tool-level concurrency.
- **Risk:** Equivalent mutants create false failures, tempting a broad ignore. **Mitigation:** Reviewed, rationale-bearing allowlist that can't grow silently; kill real mutants with real tests, never widen the ignore ([[feedback-never-suppress-fix-or-upgrade]]).
- **Risk:** Flaky tests make mutation results nondeterministic. **Mitigation:** A flaky kill/spare is a real test bug to fix; mutation actually helps surface flaky assertions; no retry-to-green ([[feedback-no-auto-retry-workflows]]).
- **Risk:** Teams game the score by testing trivia. **Mitigation:** Scope is the security/safety-critical set where the score genuinely reflects protection; reviewer checks that added tests assert meaningful behavior, not line execution.
- **Risk:** A cron creeps in for the full run. **Mitigation:** Full run is `workflow_dispatch` only; the meta-test asserts no schedule trigger ([[feedback-avoid-crons-prefer-event-driven]]).

## Definition of Done

- [ ] All AC boxes across the 8 dimensions checked.
- [ ] `mutation-js` (Stryker, real Jest on real stack) + `mutation-kotlin` (Pitest, JVM unit) green at/above the score floor over the critical modules.
- [ ] Every surviving mutant surfaced during the story is killed with a real asserting test (not allowlisted away).
- [ ] Both registered; `docs/testing/mutation.md` present + plain-language; `metadata.json` emitted; PR incremental + on-demand full, no cron.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded; status `In Review`; `pre-merge-check.sh` OK.
- [ ] Branch `story/SHY-0216-mutation-testing`; PR title `SHY-0216: Mutation testing — JS (Stryker) + Kotlin (Pitest)`; relevant gauntlet passed; `released_in:` at release.

## Notes

- 2026-07-19 — Created as an EPIC-0008 child (proposed extra, operator: "anything else you can think of" + it directly encodes the operator's [[feedback-mutation-passed-means-investigate]] discipline). Scoped to security/safety-critical modules to bound cost; incremental on PR + on-demand full (no cron). The real value is not the score — it's the **stronger tests** written to kill surviving mutants. Swift mutation deferred (no viable $0 tool).

---
id: SHY-0164
status: In Review
owner: claude
created: 2026-07-08
priority: P0
effort: XS
type: infra
roadmap_ids: []
pr:
mvp: true
---

# SHY-0164: Pre-push Sonar quality gate is main-only

## User Story

As **a ShyTalk contributor pushing a feature branch**, I want **the pre-push SonarCloud quality gate to run only when I push `main`** (and be skipped on feature branches), so that **a red `main` gate caused by pre-existing debt cannot block a clean feature-branch push into the `develop`-integration flow**.

## Why

`.husky/pre-push` runs `./gradlew sonar -Dsonar.qualitygate.wait=true`. A local invocation has no CI environment for the SonarScanner to auto-detect a branch/PR from, so SonarCloud grades the working tree against the project's **main** branch and waits on **main's** quality gate.

Today `main`'s gate is **RED** (pre-existing debt that PR #1527/SHY-0152 fixes but hasn't merged). Consequence: **every** feature-branch push is blocked at the Sonar step — even a push whose own diff introduces zero new issues — because the gate being waited on is main's. This blocks the whole `develop`-integration flow (a newly-built ticket cannot be pushed).

**The obvious fix — scoping the analysis per-branch with `sonar.branch.name` — does NOT work on this plan.** Empirically verified (2026-07-08): a feature-branch analysis uploads, but SonarCloud returns **"Organization is not allowed to access data from non-main branches"** — a **free-plan limitation**. So `qualitygate.wait=true` cannot read a feature branch's gate; it errors and would break every push. (The dead approach is recorded in the Notes log.)

The workable fix (operator-approved 2026-07-08, "skip Sonar gate for feature branches"): **gate the entire SonarCloud pre-push scan on `branch == main`.** A feature branch prints an explanatory skip message and runs none of the scan; a `main` push runs the full scan exactly as before (analysed as main, `wait=true`). The quality gate's **teeth land at the operator-gated `develop → main` promotion**, where main IS analysed.

**Coherence:** the scan block is one unit — the Express-jest and Kotlin-jvmTest steps exist only to generate the coverage the Sonar analysis uploads (the hook comments say so). Gating the whole block (not just the `./gradlew sonar` line) is therefore correct, and it also removes the local-Firebase-emulator dependency from feature-branch pushes (the Express-jest step was the source of the push pain).

**This hook is the ONLY enforcing Sonar gate.** CI's SonarCloud job runs with `sonar.qualitygate.wait=false` (`build.gradle.kts` — advisory-only, same free-plan limit), so CI never fails on a red gate. The main-push path here is the sole place the quality gate blocks — so the skip must NOT weaken the main path's negative behaviour (a real quality-gate failure on a main push must still block).

## Acceptance Criteria

### Happy path
- [ ] `.husky/pre-push` derives `CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"` and wraps the SonarCloud pre-push scan (the `SONAR_TOKEN` check, the Express-with-coverage + Kotlin JVM coverage steps, and the `./gradlew sonar … -Dsonar.qualitygate.wait=true` gate) in `if [ "$CURRENT_BRANCH" != "main" ]; then <skip> else <scan> fi`.
- [ ] Pushing any non-`main` branch prints `Feature branch (<name>) — skipping SonarCloud pre-push gate (enforced at develop→main promotion)` and runs none of the scan.
- [ ] Pushing `main` runs the full scan unchanged — analysed as `main` (no `sonar.branch.name`), `wait=true` — and blocks on a failing gate.
- [ ] Self-validating: THIS story's own push (from `story/SHY-0164-…`, a feature branch) succeeds with the fixed hook active, WITHOUT the local Firebase emulator and WITHOUT `--no-verify`.

### Error paths
- [ ] On the `main` path, a failing SonarCloud quality gate still BLOCKS the push (the failure handler prints `✗ SonarCloud quality gate FAILED — push blocked` and the hook exits non-zero) — the gate keeps its teeth; scoping to `main` does not disable it.
- [ ] On the `main` path, `SONAR_TOKEN` unset still blocks the push with the existing message.
- [ ] The "No code changes — skip" short-circuit above the guard is unchanged (a docs-only push still skips the scan and exits 0 regardless of branch).

### Edge cases
- [ ] A branch whose name merely *starts with* `main` (e.g. `main-hotfix`, `mainline`) is NOT treated as `main` — the guard is an exact `!= "main"` match — so it skips the scan.
- [ ] `develop` is not `main` → it skips the scan (develop's accumulated code is graded when it promotes to main).
- [ ] A skipped feature-branch push still FALLS THROUGH to the Playwright block (the skip is a plain `echo`, not an `exit`) — a feature branch that changed web files still runs Playwright when the local stack is up.
- [ ] The force-push guard earlier in the hook (which reads push refs from stdin) is untouched; `CURRENT_BRANCH` uses `HEAD`, independent of stdin.

### Performance
- [ ] Feature-branch pushes get FASTER, not slower: they no longer run the full Express-jest coverage suite (removing the emulator dependency) or the minutes-long gradle Sonar analysis — only the fast local guards + optional Playwright run. Net improvement.

### Security
- [ ] N/A — no auth/secret/rule/user-facing surface. The enforcing gate is preserved on the `main` path (`wait=true`, not defeated by a later `wait=false`). Skipping on feature branches does not reduce protection versus today: the free plan already could not gate a feature branch, and CI Sonar is already advisory — the gate still enforces at the `develop → main` promotion.

### UX
- [ ] N/A — developer tooling. The skip message names the branch and states where the gate lives (develop→main promotion), so a contributor is not surprised the scan did not run.

### i18n
- [ ] N/A — no user-facing strings.

### Observability
- [ ] The feature-branch path emits an explicit, greppable skip line naming the branch + the enforcement point. The `main` path retains the `→ SonarCloud analysis...`, `✓ … passed`, and `✗ … FAILED` echoes. A dated `SHY-0164` comment documents the free-plan rationale for the next reader.

## BDD Scenarios

**Scenario: pushing a feature branch is not blocked by the code-quality gate**

- **Given** a contributor has finished a ticket on a feature branch
- **And** the shared code-quality gate on the main line is currently red from older debt
- **When** they push the branch
- **Then** the push is not held up by the code-quality scan
- **And** a message tells them the scan runs when the work is promoted to the main line

**Scenario: promoting to the main line still runs the full code-quality scan**

- **Given** the main line itself is being pushed
- **When** the push runs
- **Then** the full code-quality scan runs and must pass before the push completes

**Scenario: a real quality problem on the main line still stops the push**

- **Given** a main-line push has started the code-quality scan
- **And** the scan reports a failing quality gate
- **Then** the push is blocked with a clear failure message
- **And** nothing is pushed

**Scenario: skipping the quality gate does not skip the web checks**

- **Given** a contributor pushes a feature branch that changed web pages
- **And** the local test stack is running
- **When** the push runs
- **Then** the web checks still run — only the code-quality scan is skipped

## Test Plan (TDD)

**Classification: CI-config-only** (per CLAUDE.md `### Exemptions` exemption 2, delivered by SHY-0163). The diff is confined to `.husky/pre-push` (a git-hook / dev-tooling script), its structural + behavioural pin test, and this story `.md` — **no app / backend (`express-api/src`, `firestore.rules`) / website runtime surface**. So no device/browser gauntlet; the full relevant non-device gauntlet IS run.

### Red
1. Rewrite `express-api/tests/scripts/prepush-sonar-main-only-gate.test.js` to encode the main-only contract by EXECUTING the hook's real bytes (18 pins across 5 harnesses):
   - **Behavioural (branch decision):** slice the hook's real `if [ "$CURRENT_BRANCH" != "main" ]` condition + skip branch, inject a concrete `CURRENT_BRANCH`, replace only the heavy scan body with a sentinel, and run it — assert `main` runs the scan; `develop`, a feature branch, a `main`-prefixed name (`main-hotfix`), and the detached-HEAD/empty values (`HEAD`, ``) skip it; all fall THROUGH a trailing sentinel (no `exit`); and the skip message names the branch.
   - **Behavioural (gate teeth):** slice the gate's real failure handler (from `; then` through its own closing `fi`, indentation-tolerant) and drive `if ! <cmd>` with the `false`/`true` shell builtins — assert `false` ⇒ exit 1 + FAILED message + no fall-through; `true` ⇒ exit 0 + fall-through.
   - **Behavioural (SONAR_TOKEN guard):** slice the in-guard `if [ -z "$SONAR_TOKEN" ]; then … exit 1; fi` (anchored on `]; then` to avoid the `.env`-loader block) and run it — unset ⇒ exit 1 + "not set" message; set ⇒ fall-through. (No `set -u` — faithful to the hook's plain `sh`.)
   - **Behavioural (no-code short-circuit):** slice the real `if [ "$HAS_CODE" = "false" ]; then … exit 0; fi` and drive it with `HAS_CODE=false`/`true` — false ⇒ exit 0 + "No code changes" before the guard; true ⇒ fall-through.
   - **Structural locks:** `wait=true` retained; no `wait=false` anywhere; `sonar.branch.name` NOT reintroduced; the WHOLE scan body (token check + Express-jest + Kotlin-jvmTest + gate) is bounded between the guard's `else` and its own closing `fi` (upper AND lower bound); Playwright sits after that `fi`.
   Confirm RED against the pre-fix (branch-scoped) hook (the guard/`CURRENT_BRANCH` don't exist and `sonar.branch.name` is still present).

### Green
2. `.husky/pre-push`: add the `CURRENT_BRANCH` guard around the whole scan; remove `-Dsonar.branch.name`/`SONAR_BRANCH`; add the dated SHY-0164 comment; keep the Playwright block outside the guard. Test GREEN (18/18).

### Verification
- `cd express-api && npx jest tests/scripts/prepush-sonar-main-only-gate.test.js` → 18/18 green.
- Full `tests/scripts/` meta-suite → 6961/6961 green (no regression; includes `check-node-version.test.js`, whose `Express tests with coverage` anchor moved but stays after the node-version guard).
- `sh -n .husky/pre-push` + `bash -n .husky/pre-push` clean; eslint `--max-warnings=0` + prettier clean (bash invoked via absolute `/bin/bash` to satisfy `sonarjs/no-os-command-from-path` with no suppression).
- **Behavioural — self-validating push:** the push that lands this branch runs the FIXED hook on a feature branch → the Sonar scan is skipped → the push succeeds with no local emulator and no `--no-verify`. That successful push is the end-to-end proof of the feature-branch skip.
- **Behavioural — teeth on main:** the failure-handler test proves a failing gate on the main path exits non-zero. A live main-Sonar analysis is NOT run locally (main is operator-gated; the develop→main promotion exercises it).

## Out of Scope
- Fixing main's red Sonar gate itself (PR #1527 / SHY-0152 — merges to main, separate + operator-gated).
- Making the Express-jest / Kotlin-jvmTest steps a blocking gate in their own right — they remain ungated coverage feeders (they only run on a main push now). Their unguarded-failure behaviour is a separate follow-up (see the SHY-0165 candidate in the Notes log).
- Restoring any Sonar signal on feature branches — impossible on the free plan (the org cannot read non-main branch data).
- Reading the pushed ref from stdin instead of `HEAD`.

## Dependencies
- SonarCloud free plan's **non-main-branch access limit** (the constraint that killed the branch-scoped approach and drives this design).
- `SONAR_TOKEN` in `.env` (only consulted on the `main` path now).
- The operator-gated `develop → main` promotion as the point the quality gate enforces.

## Risks & Mitigations
- **Risk:** a feature branch introduces a new Sonar issue not caught until the develop→main promotion. **Mitigation:** the free plan could not gate a feature branch regardless; CI Sonar is advisory; the enforcing gate at promotion (analysed as main) catches it before it reaches main. Net: no reduction versus the pre-fix reality.
- **Risk:** the coverage feeders (Express/Kotlin) no longer run on feature-branch pushes, so a backend regression isn't seen at push time. **Mitigation:** those steps were **ungated** (never blocked a push) and per-ticket TDD runs the relevant suite; the develop→main promotion runs the full gauntlet. No enforcement is lost.
- **Risk:** `HEAD` detached during a rebase flow → `git rev-parse --abbrev-ref HEAD` returns `HEAD` (≠ `main`) → the scan is skipped. **Mitigation:** acceptable — a detached-HEAD push is not the normal workflow, and skipping (not falsely gating) is the safe direction.

## Definition of Done
- [ ] `.husky/pre-push` gates the SonarCloud scan on `CURRENT_BRANCH == main`; feature branches skip with an explanatory echo; `-Dsonar.branch.name` removed; `wait=true` retained on the main path; Playwright outside the guard.
- [ ] `prepush-sonar-main-only-gate.test.js` rewritten (RED-first → GREEN, 18/18), behavioural + structural.
- [ ] **CI-config-only non-device gauntlet green:** the meta-test + full `tests/scripts/` suite + eslint + prettier + `sh -n`/`bash -n` + story validator + `code-reviewer` 100% clean.
- [ ] **Self-validating push succeeds** (feature-branch skip works; no emulator, no `--no-verify`) → merged into `develop`.
- [ ] `released_in:` set after release cut; `status: Done`.

## Notes (running log)
- 2026-07-08 — Filed to unblock the `develop`-integration flow. Root cause: the pre-push Sonar scan has no CI env → SonarCloud defaults to grading against main's (currently red) gate, blocking every clean feature-branch push.
- 2026-07-08 — **Branch-scoped approach (`sonar.branch.name`) proven UNSOUND and abandoned.** Committed a first attempt (`e4b5e534771`) that passed `-Dsonar.branch.name="$(git rev-parse --abbrev-ref HEAD)"`. Empirical test on a scratch branch: the analysis uploads (CE task SUCCESS) but the SonarCloud API returns **"Organization is not allowed to access data from non-main branches"** — a **free-plan limitation**, so `qualitygate.wait=true` cannot read a feature-branch gate and errors. Re-surfaced to the operator; chosen path: **skip the Sonar gate for feature branches** (main-only). Renamed branch + files `…-branch-scoped` → `…-main-only-gate` and re-refined this story to match.
- 2026-07-08 — Implemented main-only gate via TDD: rewrote the test to EXECUTE the hook's real branch-decision + gate-failure bytes (12 pins, RED 8/12 against the old hook → GREEN 12/12). Wrapped the whole scan in `if [ "$CURRENT_BRANCH" != "main" ]`. Full `tests/scripts/` suite 6961/6961; `sh -n`/`bash -n`, eslint `--max-warnings=0`, prettier all clean. Targets `develop` (not main, per operator).
- 2026-07-08 — **SHY-0165 candidate (follow-up):** on the main path the Express-jest + Kotlin-jvmTest steps are ungated (a failure does not `exit 1`, so it doesn't block the push) — pre-existing, reviewer-surfaced. Out of scope here; file as its own story.
- 2026-07-08 — **code-reviewer round 1** (commit `5a5fa5c30b4`): shell logic verified 100% clean (balanced if/else/fi, POSIX, correct fall-through, no collateral change). 6 test-COVERAGE gaps found (2 Critical, 4 Important), all verified real via grep + trace, all fixed: (1) `SONAR_TOKEN`-unset had zero coverage repo-wide → added `runTokenCheck` (unset⇒exit 1, set⇒fall-through); (2) containment pinned only the gate's lower bound → now bounds all four scan components (token check + Express-jest + Kotlin-jvmTest + gate) between `else` and the guard's own `fi`, catching a hoist-the-emulator-step regression; (3) skip message branch-name unasserted → `toContain(branch)`; (4) develop/main-hotfix assertion parity → added status + fall-through; (5) detached-HEAD/empty untested → `test.each(['HEAD',''])`; (6) "No code changes" short-circuit untested → `runNoCodeShortCircuit`. Test 12→18 pins, all green; prettier + eslint `--max-warnings=0` clean. Fixing the `SONAR_TOKEN`/containment anchors also surfaced (and the executing-bytes tests caught) a first-occurrence collision with the `.env`-loader `if [ -z "$SONAR_TOKEN" ]` — re-anchored on `]; then`.
- 2026-07-08 — **code-reviewer round 2** (commit `15da3c570c5` → fix `5a1dbc00011`): confirmed all 6 round-1 fixes closed; found 1 new weak-assertion bug — the `develop` skip test used `toContain('develop')`, which coincidentally passes off the static "develop→main promotion" suffix even if `$CURRENT_BRANCH` interpolation broke. Fixed all three skip tests to assert the parenthesised `Feature branch (<name>)` form (proves interpolation-in-parens, not bare presence). **Round-3 re-review: 100% CLEAN — zero findings** across hook + test + story. jest 18/18; prettier + eslint clean.

Reviewed-up-to: 5a1dbc00011

---
id: SHY-0163
status: Done
owner: claude
created: 2026-07-07
priority: P0
effort: S
type: infra
roadmap_ids: []
public: false
mvp: true
released_in: v0.98.0
---

# SHY-0163: Defer device E2E off the per-PR gate (MVP-sprint CI model)

## User Story

As **the ShyTalk delivery team**, we want **the heavy device E2E jobs (`android-e2e`, `ios-e2e`) removed from the required per-PR PR Gate and deferred to a single end-of-batch real-device pass**, so that **flaky CI-emulator runs stop blocking every merge and the MVP batch can move fast** — with real-device verification concentrated in one gauntlet before the `develop → main` promotion.

## Why

The required `android-e2e` check is **flaky on infrastructure, not code**: on PR #1538 (zero app code) and #1480 it ran ~31 min then died with `adb: device 'emulator-5554' not found` / `port 5554 connection refused` — the GitHub-hosted **emulator process crashed mid-run** (memory exhaustion on the ~235-scenario suite), producing no JUnit results. It was green hours earlier on #1536, so it is a genuine flake. Because `PR Gate` (the required ruleset context) `needs` `android-e2e` + `ios-e2e`, one flaky emulator blocks *every* merge. The operator's MVP-sprint model (2026-07-07) is: **write all tests as we go (TDD), but execute device/E2E once at the end on REAL devices** (real Android + iPhone + browsers) before promotion — so the CI emulator/simulator E2E is no longer the release gate and must not gate individual PRs.

## Acceptance Criteria

### Happy path
- [ ] `PR Gate`'s `needs:` list no longer contains `android-e2e` or `ios-e2e`; it still contains `detect-changes`, `pre-merge-gate`, `lint`, `build-and-test`, `sonarcloud`, `test-backend`, `playwright-web`, `integration-tests`, `qa-runner-driver-checks`.
- [ ] The PR Gate "Evaluate results" loop no longer references `needs.android-e2e.result` or `needs.ios-e2e.result`.
- [ ] The `android-e2e` and `ios-e2e` jobs each gate on `github.base_ref == 'main'` (they run only on a `develop → main` promotion / base-main PR, and are skipped on feature→`develop` PRs).

### Error paths
- [ ] A feature→`develop` PR whose `android-e2e`/`ios-e2e` would previously have failed on emulator flake now merges once the fast checks (unit, backend, Playwright-web, lint, Sonar, validators) are green — the flaky device job cannot block it.
- [ ] A genuinely-failing FAST check (e.g. `build-and-test` failure) still blocks PR Gate (the deferral does not weaken non-device gating).

### Edge cases
- [ ] `playwright-web` (headless browsers) and `integration-tests` (backend) REMAIN in PR Gate `needs` + the result loop — only the two real-device jobs defer.
- [ ] The `android-e2e`/`ios-e2e` jobs retain their existing `*_app_changed == 'true'` gating (the `base_ref` guard is ANDed on, not replacing it).

### Performance
- [ ] N/A — removes ~33 min of flaky emulator wall-clock from the feature→develop critical path (a speedup); no runtime-perf surface.

### Security
- [ ] N/A — CI gating change only; no auth, secrets, rules, or user-facing surface. Ruleset `12613584` still requires `Detect Changes` / `Analyze JavaScript` / `PR Gate`; `PR Gate` remains required and still gates on all non-device checks.

### UX
- [ ] N/A — no user-facing surface.

### i18n
- [ ] N/A — no user-facing strings.

### Observability
- [ ] The deferral is discoverable: a comment in `pr-checks.yml` at the gate + E2E jobs explains that device E2E is deferred to the real-device batch (SHY-0163), and the pin test names the invariant.

## BDD Scenarios

**Scenario: device E2E no longer gates a feature PR**
- **Given** `pr-checks.yml` after this change
- **When** the `PR Gate` `needs:` list is read
- **Then** it does not contain `android-e2e` or `ios-e2e`
- **And** it still contains `playwright-web` and `integration-tests`

**Scenario: PR Gate result loop drops the device jobs**
- **Given** the PR Gate "Evaluate results" step
- **When** its body is read
- **Then** it contains no `needs.android-e2e.result` or `needs.ios-e2e.result` reference

**Scenario: device jobs run only on base-main**
- **Given** the `android-e2e` and `ios-e2e` job `if:` conditions
- **When** they are read
- **Then** each contains `github.base_ref == 'main'`
- **And** each still contains its `*_app_changed == 'true'` gate

## Test Plan

**RED (write first — fail against current pr-checks.yml):**
- NEW `express-api/tests/scripts/pr-checks-device-e2e-deferred.test.js` — asserts: (1) `PR Gate` `needs:` excludes `android-e2e`/`ios-e2e` but includes `playwright-web`/`integration-tests`; (2) the result-eval loop has no `needs.android-e2e.result`/`needs.ios-e2e.result`; (3) `android-e2e` + `ios-e2e` job `if:` each contain `github.base_ref == 'main'` AND retain `*_app_changed == 'true'`.

**GREEN (implement):**
- `.github/workflows/pr-checks.yml`: remove `android-e2e, ios-e2e` from the `gate` job `needs:` (line ~436) and from the result-eval loop (lines ~456/459); add `&& github.base_ref == 'main'` to the `android-e2e` (~318) and `ios-e2e` (~370) `if:` blocks; add an explanatory SHY-0163 comment.

**Verification:**
- `cd express-api && npx jest tests/scripts/pr-checks-device-e2e-deferred.test.js tests/scripts/pre-merge-gate.test.js tests/scripts/pr-checks-app-changed-split.test.js` green.
- `actionlint .github/workflows/pr-checks.yml` clean.
- **Classification: CI-config-only** (per CLAUDE.md `### Exemptions (the ONLY two)`, exemption 2 — added by this PR). The diff is confined to `.github/workflows/pr-checks.yml`, its CI-structure meta-test `express-api/tests/scripts/pr-checks-device-e2e-deferred.test.js`, the story `.md`, `SHY-INDEX.md`, and the CLAUDE.md policy amendment — **no app (`shared`/`app`/`iosApp`), backend (`express-api/src`, `firestore.rules`, `database.rules.json`), or website (`public`) runtime surface**. So the device/browser gauntlet is not required; the full relevant non-device gauntlet (below) IS run. iOS-compile safety is preserved by DEV-TIME discipline (`./gradlew :shared:compileKotlinIosArm64` locally on any shared change, per the tri-platform policy) + the final real-device batch as backstop.
- Non-device gauntlet run + green: the pin suite (70 tests) + sibling `pr-checks-*` suites (114), `actionlint`, `eslint --max-warnings=0`, `prettier --check`, story validator, `code-reviewer` 100%-clean.

## Out of Scope

- The `develop`-branch git-flow wiring (SHY-0161 / #1538) — separate PR; this only changes the device-E2E gating.
- Auto-deploying `develop → dev` on merge — separate follow-up (`deploy-dev.yml` `push:[develop]` trigger).
- Fixing the emulator-OOM flake itself — deliberately NOT done: the final gauntlet uses REAL devices, so the CI emulator is retired from the gate, not stabilized.
- Removing the `android-e2e`/`ios-e2e` jobs entirely — kept (base-main only) as an on-promotion signal.

## Dependencies

- `.github/workflows/pr-checks.yml` (the `gate`, `android-e2e`, `ios-e2e` jobs).
- Ruleset `12613584` required contexts remain `Detect Changes` / `Analyze JavaScript` / `PR Gate` (unchanged — `PR Gate` stays required; only its internal `needs` shrink).

## Risks & Mitigations

- **Risk:** an iOS/Android device-only regression merges into `develop` undetected until the batch → **Mitigation:** operator-accepted (write tests as we go, fix at the batch); TDD on the fast layers catches logic bugs early; the final real-device gauntlet is the backstop before promotion.
- **Risk:** iOS compile break slips in (build-and-test is Linux-only, doesn't compile iOS) → **Mitigation:** dev-time `:shared:compileKotlinIosArm64` on every shared change (tri-platform policy) + batch backstop.
- **Risk:** someone re-adds device E2E to the gate later, reintroducing the flake block → **Mitigation:** the pin test asserts the exclusion, failing any such regression.

## Definition of Done

- New pin test written RED-first, then GREEN; `pre-merge-gate` + `app-changed-split` pin tests still green.
- `pr-checks.yml` edited; `actionlint` clean; `code-reviewer` 100% clean on the local commit before push.
- Merged (feature→`develop` once git-flow is live, or to `main` in the bootstrap) and released with `released_in:` set.

## Notes (running log)

- 2026-07-07 — Filed during the MVP-release sprint. Root cause of the blocking flake traced live on PR #1538: emulator process death (`port 5554` refused) ~31 min into `connectedLocalDebugAndroidTest`, no JUnit results — infra/OOM, not app code and not androidUiDump (so #1528 would NOT fix it). Operator decisions: blockers-only critical path, git-flow via `develop`, defer device-E2E execution to ONE final REAL-DEVICE batch, keep fast tests per-PR.
- 2026-07-08 — Target branch = `main` (bootstrap phase, per DoD). Confirmed: the blocked PRs (#1538/#1480/#1485) all target `main`, and SHY-0161/#1538 (which *adopts* `develop` as the integration branch) is itself still an OPEN PR — so `develop`-as-integration is not live yet. Branch is cut from `main` → clean 3-file diff. Flipped to In Review.
- 2026-07-08 — **Bootstrap-phase nuance (surfaced in code review):** `pr-checks.yml`'s own trigger is `on.pull_request.branches: [main]`, so this workflow only fires for base=main PRs and `github.base_ref` is *always* `'main'` today. The `base_ref == 'main'` guard added to the device jobs is therefore **forward-looking and inert until SHY-0161 adds `develop` to the trigger** — today's sole behaviour change is that the `gate` no longer *waits on / evaluates* the device jobs (so their emulator flake can't block a merge). Job comments reworded to state this truthfully rather than imply "skipped on feature→develop" already happens. AC Error-paths bullet 1 describes the post-SHY-0161 target state.
- 2026-07-08 — **Code-reviewer cycle 1** (local commit, pre-push). Findings + resolution: (C) AC Error-paths bullet 2 ("a failing fast check still blocks the gate") had zero test/BDD backing → added 5 result-loop retention pins + a BEHAVIORAL block that extracts the gate's "Evaluate results" shell and runs it in real bash against synthetic job-result maps (all-green→0, each fast job failure/cancelled→1, detect-changes guard→1, skipped→0, device-job failure ignored→0), mirroring the `classifyFiles` precedent in `pr-checks-app-changed-split.test.js`. (I) loop-based include test masked multi-drops → `test.each` per job. (I) no direct parser tests + `gateNeeds` block-style silent-`[]` → parameterised `jobSection`/`gateNeeds` for injectable input, added synthetic unit tests for `isJobHeader`/`jobSection`/`gateNeeds`, plus a `needs.length>0` self-check. (I) misleading job comments → reworded (above). Test count 14 → 70; eslint (`--max-warnings=0`) + prettier + actionlint clean; sibling `pr-checks-*` suites (114) green. Reviewer's Finding-4 `#`-comment false-positive claim was verified FALSE (a `#`-led name fails `/^[a-z]/`) — no change needed there.
- 2026-07-08 — **Policy question RESOLVED (operator, 2026-07-08):** the story Test Plan called this a workflow-only change exempt from the device/browser gauntlet, but CLAUDE.md's Pre-Merge Protocol exemption was `*.md`-only. Operator chose option (a) — **amend the rule**. CLAUDE.md `### Exemptions (the ONLY two)` now adds a second, tightly-bounded exemption for **CI-config-only PRs** (no app/backend/website runtime surface; scoped to `.github/workflows/**` + CI-only scripts + CI-structure meta-tests; still runs Jest/actionlint/eslint/prettier/validator/review; anti-loophole boundary lists the product-runtime paths that void it; backend⇒full-gauntlet unchanged). Amendment is part of THIS PR. SHY-0163 qualifies under the new exemption, so no device/browser gauntlet is required for it.
- 2026-07-08 — **Code-reviewer cycle 2 + confirmation → 100% CLEAN, zero findings.** Cycle 2 confirmed all 5 cycle-1 findings resolved and found zero new blocking issues; its one non-blocking polish note (a device-job override that was a mechanical no-op) was addressed by parameterising `runGate(overrides, source=gateEvalScript())` and replacing the test with a genuine regression tripwire (feed a synthetic re-added `android-e2e` placeholder → the `${{`-remnant guard throws), then re-confirmed clean. Delta committed in `be4687265ac`; original deferral in `8ee85cde6df`. Ready to push + open PR → `main` (bootstrap; operator judgment-merge).
- 2026-07-08 — **Push: operator-authorised `--no-verify`** (AskUserQuestion, 2026-07-08). The local pre-push hook runs the full backend Jest suite with coverage for SonarCloud, which needs the local Firebase emulator + Docker — both down this session, so hundreds of pre-existing EPIC-0003 real-services tests fail with `ECONNREFUSED localhost:8080`, all unrelated to this CI-config-only diff. CI runs the same suite against its provisioned emulator (SHY-0109), so the full backend gate still applies in CI — nothing is skipped, only relocated. `actionlint` + the CI-structure pin suites (`pr-checks-*`, 70+114) were run locally and are green. Bypass scoped to this one push.

Reviewed-up-to: be4687265ac0bbfdab39746c99bc98ab359e01cb

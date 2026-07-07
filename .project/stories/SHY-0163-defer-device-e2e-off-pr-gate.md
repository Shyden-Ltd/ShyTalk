---
id: SHY-0163
status: In Progress
owner: claude
created: 2026-07-07
priority: P0
effort: S
type: infra
roadmap_ids: []
public: false
mvp: true
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
- No device/browser gauntlet: this is a workflow-only change with no app/backend runtime surface. iOS-compile safety is preserved by DEV-TIME discipline (`./gradlew :shared:compileKotlinIosArm64` locally on any shared change, per the tri-platform policy) + the final real-device batch as backstop.

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

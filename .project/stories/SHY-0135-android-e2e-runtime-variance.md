---
id: SHY-0135
status: Draft
owner: claude
created: 2026-06-20
type: infra
priority: P2
effort: M
roadmap_ids: []
public: false
mvp: false
---

# SHY-0135: android-e2e cell has extreme runtime variance — intermittently hits the 90-min hard cap and blocks PRs

## User Story

As a **maintainer relying on CI to gate merges**, I want **the `android-e2e` job to finish deterministically inside its budget instead of intermittently consuming the full 90-minute `timeout-minutes` and going red**, so that **PRs are not blocked by an infra flake that a manual rerun usually clears — turning every merge into a babysitting exercise**.

## Why

The `android-e2e / Android E2E (API …, …)` job (`.github/workflows/e2e-tests.yml`, `reactivecircus/android-emulator-runner@v2.37.0`) exhibits **extreme runtime variance** on the 2-core GitHub-hosted `ubuntu-22.04` runners. Observed this session:

- **PR #1485 (SHY-0130):** the job ran the **full 90 minutes** in the `Run E2E tests on emulator` step (past the 30-min boot-timeout, i.e. the emulator *had* booted) and was **cancelled** at the hard `timeout-minutes: 90` cap → `PR Gate` FAILURE. A single manual rerun then **passed in 4.6 minutes** on the same commit.
- **PR #1480 (SHY-0102):** parked on the same cell going red.
- Historical (#950/#952/#953, captured in the workflow comments): emulator **boot** failures on `ubuntu-24.04` (pinned down to `ubuntu-22.04` to mitigate the boot axis; upstream `ReactiveCircus/android-emulator-runner#400`).

So there are **two** failure axes: (1) boot variance (largely mitigated by the 22.04 pin + `emulator-boot-timeout: 1800` + `heap-size: 4096`), and (2) **test-run variance** — the suite sometimes completes in single-digit minutes and sometimes cannot finish inside the 90-min ceiling, on identical code. A 90-min-vs-4.6-min spread is not a budget problem; it is a determinism problem. Bumping the timeout would only mask it; an auto-retry workflow is **forbidden** ([[feedback-no-auto-retry-workflows]]). The job needs to be made deterministic and fast enough to clear its budget reliably.

## Acceptance Criteria

### Happy path
- [ ] The `android-e2e` cell completes (pass or genuine fail) **well inside** its budget on a healthy runner — target p95 wall-clock comfortably under the cap with clear headroom — without relying on a manual rerun.
- [ ] No green run is ever cancelled by the `timeout-minutes` cap during normal operation.

### Error paths
- [ ] A genuine test failure still fails fast and visibly (the fix must not hide real failures behind sharding/parallelism or a raised ceiling).
- [ ] A genuine emulator-boot failure still surfaces promptly (the `emulator-boot-timeout` exit-on-real-failure behaviour is preserved).

### Edge cases
- [ ] A slow-but-healthy runner still finishes within budget (the determinism fix gives enough margin that ordinary 2-core variance does not tip a run over the cap).
- [ ] The root-cause investigation distinguishes "runner genuinely slow/degraded" from "a specific scenario hangs" — captured from a real timed-out run's logs/Allure timing — and the chosen mitigation addresses the actual cause.

### Performance
- [ ] Total `android-e2e` wall-clock is reduced and bounded (e.g. via matrix **sharding** of the ~235 BDD scenarios across N parallel cells, and/or **AVD snapshot caching** to cut cold-boot time), with the per-shard budget set from measured p95 + headroom.
- [ ] The change does not introduce a paid runner (free GitHub-hosted only — [[feedback-no-self-hosted-runners]] / no paid runners) and respects the $0 constraint.

### Security
- N/A — CI infrastructure only; no app/runtime/security-surface change.

### UX
- N/A — CI/maintainer-facing; no end-user surface. (Maintainer "UX": no more babysitting reruns.)

### i18n
- N/A — no user-facing strings.

### Observability
- [ ] A timed-out or slow run leaves enough signal to diagnose next time: per-scenario timing (Allure already collects step timings) and an emulator/system log artifact are retained, so the variance can be tracked rather than re-guessed.
- [ ] The workflow comments + the sibling guard test (`android-e2e-emulator-boot-headroom.test.js`) are updated to document the determinism mechanism (shards/snapshot) the same way the boot-timeout/heap headroom is documented today.

## BDD Scenarios

**Scenario: a healthy run finishes inside budget**
- **Given** the `android-e2e` cell on a healthy GitHub-hosted runner
- **When** the full BDD suite runs (sharded and/or snapshot-cached per the fix)
- **Then** every shard completes within its per-shard `timeout-minutes`
- **And** no shard is cancelled by the cap

**Scenario: a real test failure still fails fast**
- **Given** a deliberately failing BDD scenario
- **When** `android-e2e` runs
- **Then** the owning shard reports FAILURE promptly (not by timing out)

**Scenario: a hung scenario is attributable**
- **Given** a run that approaches the cap
- **When** it is investigated
- **Then** the retained per-scenario timing + emulator log identify whether a specific scenario stalled or the runner was globally slow

**Scenario: no auto-retry workflow is introduced**
- **Given** the fix
- **When** the workflow is reviewed
- **Then** there is no `workflow_run`-triggered `gh run rerun --failed` (or equivalent) auto-retry — determinism is achieved by making the job fast/bounded, not by retrying failures

## Test Plan

**RED / GREEN (CI-config + guard tests — this is an infra story, exercised by the workflow itself + its guard suite):**
- `express-api/tests/scripts/android-e2e-emulator-boot-headroom.test.js` (existing guard) — extend with assertions pinning the new determinism mechanism: e.g. the sharded matrix dimension and/or `disable-spellchecker`/snapshot-cache options, the per-shard `timeout-minutes`, and that `runs-on: ubuntu-22.04` + `emulator-boot-timeout` + `heap-size` are retained. Mirrors how the test already pins the runner image + boot headroom.
- `scripts/check-no-paid-runners.sh` (existing CI guard) — stays green (no paid runner introduced by the shard fan-out).
- **Empirical validation:** run the modified workflow on a throwaway PR ≥5 times; record wall-clock per shard; confirm zero cap-cancellations and a healthy p95 margin. Capture a before/after timing table in `## Notes`.

**Investigation deliverable (spike-like, first task):** pull the `Run E2E tests on emulator` logs + Allure step timings from a real timed-out run (e.g. #1485's first attempt) to classify the variance (global-slow vs scenario-hang) BEFORE choosing between sharding, snapshot caching, or a targeted scenario fix.

## Out of Scope

- The product bugs the cell happens to gate (SHY-0102, SHY-0130) — those merge on their own evidence (a manual rerun of the infra cell is the interim workaround).
- Migrating off GitHub-hosted runners or to paid runners (forbidden).
- Any `workflow_run` auto-retry mechanism (forbidden — the fix must be determinism, not retry).
- The web/iOS e2e cells (separate budgets; only address if the investigation shows a shared root cause).

## Dependencies

- `.github/workflows/e2e-tests.yml` (`test-android` job, `reactivecircus/android-emulator-runner@e89f39f…` v2.37.0) — the job being made deterministic.
- `app/src/androidTest/**` (~235 BDD scenarios) — the suite to shard; its current runtime is the budgeting input.
- `express-api/tests/scripts/android-e2e-emulator-boot-headroom.test.js` — the guard test to extend.
- Upstream `ReactiveCircus/android-emulator-runner#400` — track for an action release that fixes the 24.04/boot path (may relax the 22.04 pin later).

## Risks & Mitigations

- **Risk:** sharding multiplies runner minutes / hits concurrency limits. **Mitigation:** size N from measured runtime so total minutes stay reasonable on the free tier; keep shards within the org's concurrent-job budget.
- **Risk:** AVD snapshot caching reintroduces the boot flakiness it was meant to avoid (current `-no-snapshot` was deliberate). **Mitigation:** the investigation decides snapshot vs shards; if snapshots regress boot reliability, prefer sharding alone.
- **Risk:** the fix masks a real hung-scenario product bug. **Mitigation:** the investigation-first AC requires classifying the variance before mitigating; a per-scenario timeout surfaces a hang as a fast, attributable failure rather than a 90-min cap.
- **Risk:** flakiness is purely upstream/runner-image and not fully fixable here. **Mitigation:** bound the blast radius (fast shards finish before the degraded-runner tail), document the residual, and track #400 for the real upstream fix.

## Definition of Done

- The investigation classifies the variance with evidence; the chosen mitigation (sharding and/or snapshot caching and/or a targeted scenario fix) is implemented with per-shard budgets derived from measured timing.
- ≥5 consecutive throwaway-PR runs complete inside budget with zero cap-cancellations; a before/after timing table is in `## Notes`.
- The guard test is extended to pin the determinism mechanism; `check-no-paid-runners.sh` + the existing boot-headroom assertions stay green; no auto-retry workflow added.
- `code-reviewer` 100% clean; CI required checks green.
- Released in a `vX.Y.Z` cut with `released_in:` set (infra change still ships via a normal release).

## Notes (running log)

- 2026-06-20 — **Filed (operator-requested follow-up).** Characterised from this session's CI: #1485's `android-e2e` ran the full 90 min in the test-run step (emulator booted) then was cancelled at the hard cap → `PR Gate` FAILURE; a single manual rerun passed in **4.6 min** on the same commit. Same cell parked #1480. The 90-min-vs-4.6-min spread on identical code = a determinism problem, not a budget one. Two axes: boot variance (mitigated 2026-06-01 by the `ubuntu-22.04` pin + `emulator-boot-timeout: 1800` + `heap-size: 4096`; upstream `android-emulator-runner#400`) and test-run variance (this story's focus). Forbidden non-fixes: raising the timeout (masks it) and any `workflow_run` auto-retry ([[feedback-no-auto-retry-workflows]]). Direction: investigate a real timed-out run's per-scenario timing first, then shard the suite and/or cache the AVD snapshot for a bounded, deterministic budget. Interim workaround for blocked PRs: one manual rerun of the cell (confirmed-infra, not code).

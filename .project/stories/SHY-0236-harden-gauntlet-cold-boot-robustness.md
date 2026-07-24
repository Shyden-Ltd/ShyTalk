---
id: SHY-0236
status: In Review
owner: claude
created: 2026-07-24
priority: P1
effort: M
type: infra
roadmap_ids: []
---

# SHY-0236: Harden the cold-boot gauntlet — best-effort suites, FAIL sentinel, Playwright env, bash-3.2 safety

## User Story

As **the engineer running the release gauntlet before a develop→main promotion**,
I want **the cold-boot gauntlet to run every phase to completion, survive an individual suite failure, and always leave a correct DONE/FAIL sentinel**,
So that **one harness-level or flaky failure never hides the rest of the results or blocks the real device journey matrix — I get one comprehensive, trustworthy pass/fail per run**.

## Why

The `express-api/scripts/gauntlet/` cold-boot suite is the local release gate ([[feedback-journey-matrix-hard-gate-all-devices-local-then-dev]], [[reference-gauntlet-scripts]]). Exercising it end-to-end for the 2026-07-24 develop→main release surfaced four harness defects that made a clean, observable run impossible:

1. **bash-3.2 empty-array crash** — `"${ANDROID_ARGS[@]}"` / `"${PASSTHRU[@]}"` under `set -u` on macOS's system bash 3.2 aborts at android-prep ("unbound variable") whenever the array is empty (fixed in bash 4.4; macOS still ships 3.2).
2. **First-failure abort** — `run_logged` calls `die` (→ `exit 1`) on any suite failure, so a single web-suite failure kills the whole run BEFORE the device journey matrix (the main signal) is ever dispatched.
3. **Silent death (no sentinel)** — `die`'s explicit `exit 1` bypasses the `ERR` trap, so `on_fail` never fires and no `FAIL` sentinel is written; the run looks "still running" forever.
4. **Missing `API_BASE_URL`** — the Playwright phases run `npx playwright test` without `API_BASE_URL`, so every web test errors before asserting.

Plus the detached child re-execs with a fresh `RUN_ID`, writing its logs + sentinel into a different dir than the parent advertised.

## Acceptance Criteria

### Happy path
- [ ] A cold-boot run with no failing suites reaches the end and writes exactly `DONE` (no `FAIL`) in the advertised `RUN_DIR`.
- [ ] The detached child writes its logs + sentinel into the SAME `RUN_DIR` the parent printed (inherited `GAUNTLET_RUN_ID`); `$GAUNTLET_TMP/latest` resolves to it.

### Error paths
- [ ] A failing test suite is recorded (not fatal): the run continues through remaining phases and still dispatches the device journey matrix.
- [ ] After all phases, if ≥1 suite failed, the run writes `FAIL`, prints the failed-suite list + count, and exits non-zero.
- [ ] A genuinely fatal infra step (services / reseed / matrix-dispatch) still fails fast (`set -e` + ERR trap → `FAIL` sentinel).

### Edge cases
- [ ] Empty arg arrays (`ANDROID_ARGS`, `PASSTHRU`, `FAILED_STEPS`) never trigger the bash-3.2 "unbound variable" abort (portable `${arr[@]+"${arr[@]}"}` guard).
- [ ] A `--frameworks` run where every framework passes but the matrix has pre-existing failures still writes `DONE` for prep+dispatch (the matrix carries its own sentinel).

### Performance
- [ ] No added latency — the changes are control-flow only; each suite runs exactly once.

### Security
- [ ] N/A — local dev/QA tooling; no secrets, no network trust boundary, no runtime surface.

### UX
- [ ] The end-of-run summary names every failed suite (with its log path already printed per-suite) so triage is one glance.

### i18n
- [ ] N/A — developer-facing CLI tooling, no user-facing strings.

### Observability
- [ ] Every run leaves exactly one of `DONE`/`FAIL` in the advertised `RUN_DIR`; the FAIL path enumerates the failed suites + count.

## BDD Scenarios

**Scenario: One web suite fails but the device matrix still runs**
- **Given** a cold-boot run where `playwright-e2e` fails
- **When** the frameworks phase completes
- **Then** the failure is recorded (not fatal) and the run proceeds to dispatch the journey matrix
- **And** at the end the run writes `FAIL`, lists `playwright-e2e`, and exits non-zero

**Scenario: Clean run writes DONE in the advertised dir**
- **Given** a detached cold-boot run with no failing suites
- **When** it completes
- **Then** `DONE` exists in the exact `RUN_DIR` the parent printed (not a sibling timestamp dir)

**Scenario: bash 3.2 empty array does not abort**
- **Given** macOS system bash 3.2 with `set -u`
- **When** android-prep runs with an empty `ANDROID_ARGS`
- **Then** the run proceeds (no "unbound variable" abort)

**Scenario: Playwright phase has its API base URL**
- **Given** the frameworks phase
- **When** `playwright-e2e` runs
- **Then** `API_BASE_URL=http://localhost:3000` is set and tests execute (no "must be explicitly set" error)

## Test Plan

**Classification: test-tooling-only.** The change is confined to `express-api/scripts/gauntlet/gauntlet.sh` — a local dev/QA helper script with **no** app / backend / website runtime surface. Per the CI-config-only / tooling exemption ([[feedback-ci-config-only-merge-to-main]] rationale), the real-device gauntlet does not gate THIS change; the proof is the tooling itself running correctly.

- **bash-3.2 validation:** `/bin/bash -n gauntlet.sh` (syntax) + a `set -uo pipefail` harness proving empty `FAILED_STEPS` / `ANDROID_ARGS` / `PASSTHRU` expand safely (0 args) and that the tally's empty→DONE / non-empty→FAIL branches behave (both proven 2026-07-24).
- **End-to-end proof:** a real cold-boot run (`gauntlet.sh --detach --frameworks --ios --android-bdd`) reaches the matrix dispatch, records suite failures instead of aborting, and leaves the correct sentinel — validated as part of the 2026-07-24 release gauntlet.
- **Guards:** actionlint N/A (not a workflow); `code-reviewer` 100% clean on the diff.

## Out of Scope

- The individual suite failures the gauntlet surfaces (e.g. serve-web-meta detached-HEAD → SHY-0237; EPIC-0003 matrix debt) — fixed under their own stories.
- `50-matrix.sh` / `30-android.sh` / `40-ios.sh` internals — unchanged here.
- Re-architecting phases into a parallel runner or adding new suites.

## Dependencies

- None. Self-contained hardening of `gauntlet.sh`.

## Risks & Mitigations

- **Risk:** best-effort suites mask a real regression. **Mitigation:** the end tally writes `FAIL` + exits non-zero + enumerates every failed suite — nothing is hidden, the pass/fail is just deferred to a comprehensive report.
- **Risk:** the sentinel-dir change breaks the attached (non-detach) path. **Mitigation:** `GAUNTLET_RUN_ID` defaults to a fresh timestamp when unset, so attached runs are unaffected.
- **Risk:** a fatal infra failure gets swallowed as "best-effort." **Mitigation:** only `run_logged` (test suites) is best-effort; services / reseed / matrix-dispatch are raw commands that still die-fast via `set -e` + the ERR trap.

## Definition of Done

- `gauntlet.sh` runs every phase to completion, records suite failures, always writes the correct `DONE`/`FAIL` sentinel in the advertised dir, and sets `API_BASE_URL` for Playwright.
- bash-3.2-safe (syntax + empty-array proof green); `code-reviewer` 100% clean; merged to develop.
- Proven by a real cold-boot release gauntlet reaching the device journey matrix.

## Notes

**2026-07-24:** Filed + implemented in one pass while running the develop→main release gauntlet, which surfaced four harness defects (empty-array abort at android-prep; first-failure abort before the matrix; silent no-sentinel death; missing Playwright `API_BASE_URL`) plus the sentinel-dir mismatch. All are control-flow / harness fixes with no runtime surface. The empty-array guard uses the portable `${arr[@]+"${arr[@]}"}` idiom (safe on bash 3.2 AND 5.x). Architect self-approval: pure tooling robustness, no product behaviour, mirrors the existing script conventions.

- **Code-review R1** (`code-reviewer`): 1 Critical + 2 Important, ALL applied. **C1** — the `--android-bdd` gate `[ "$ANDROID_OK" = "1" ] || die` reproduced the SAME silent-death defect this story fixes elsewhere (an explicit `die`→`exit 1` bypasses the `ERR` trap, so no sentinel is written); now writes `touch "$RUN_DIR/FAIL"` before the die. **I2** — RUN_ID inheritance used a public-looking `GAUNTLET_RUN_ID` that a stale exported shell var could collide with (racing two runs into one dir); renamed to the private `_GAUNTLET_CHILD_RUN_ID`, set ONLY on the re-exec. **I3** — no committed regression coverage; added `express-api/tests/scripts/gauntlet-cold-boot-structure.test.js` (8 assertions — the generalisable "every mid-run die writes FAIL" invariant that would have caught C1, plus run_logged best-effort, tally DONE/FAIL branches, bash-3.2 empty-array guards, Playwright API_BASE_URL, private RUN_ID marker). Reviewer independently verified the rest clean (guard idioms, `FAILED_STEPS` scope/lifetime, best-effort-suites vs die-fast-infra split, `trap - ERR` placement, `set -uo pipefail`/`set -e`-after-trap ordering).
- Fix round self-certified ([[feedback-agent-token-frugality]]): structure test **8/8**, `/bin/bash -n` clean, and empirically validated by the LIVE release gauntlet — android-prep cleared (empty-array fix), Playwright executing 7190 tests (API_BASE_URL fix), logs in the advertised `RUN_DIR` (private-marker fix). Reviewed-up-to: the R1-fix commit.

**2026-07-24 (folded in: matrix-orphans / hung-uiautomator thrash — permanent fix, operator-directed):** mid-release the operator saw the Android phone thrashing (app open/close forever). Root cause was a KNOWN pair of harness bugs my own memory ([[reference-matrix-orphans-and-hung-uiautomator]]) had already diagnosed and flagged as "owed a fix" — which I'd previously hand-recovered instead of fixing. Fixed both permanently here (same gauntlet-robustness theme):
- **`50-matrix.sh cmd_stop`**: was `kill $pid` on the nohup-wrapper only, orphaning the `manual-qa-runner --parallel` cell runners (they keep driving the phone). Now kills the WHOLE process tree (recursive `_pid_tree`/`pgrep -P`, loop up to 3× until quiet), reaps every runner tagged with the run-dir id, force-stops the app + kills the on-device `uiautomator`/`androidx.test` holder on every connected device, and VERIFIES (`pgrep -fl manual-qa-runner` empty) — no more reassuring `stopped pid N` lie. Validated live: "full process tree killed … 0 runners remain", exit 0.
- **`android-adb-driver.js androidUiDump`**: once the transient-retry budget is spent, now kills the on-device `uiautomator` (the stale UiAutomation holder / EXIT=137 loop) so the next dump rebinds fresh — instead of returning `''` forever while the caller relaunches the app endlessly. Fires only on the already-failed path (cold-start retry untouched).
- Tests: driver stale-holder pin (`android-adb-driver.test.js` → **1337 green**) + 5 `cmd_stop` structure pins (`gauntlet-cold-boot-structure.test.js` → **13 green**). Also caught here (env gaps that broke the run): the gauntlet needs `PERSONAS_PASSWORD` + `WDA_TEAM_ID` exported — addressed separately.
- **Meta-lesson codified** ([[reference-matrix-orphans-and-hung-uiautomator]] updated to FIXED + the "apply owed harness fixes, don't re-hand-recover a known bug" rule; reinforces [[feedback-consult-lessons-before-coding]], [[feedback-root-cause-not-symptom]]). Self-certified (validated live + 1350 tests green over the R1-reviewed base).

**2026-07-24 — Code-review R2** (`code-reviewer`, final reviewer-before-push gate over the whole branch): 1 Critical + 2 Important, ALL applied (fix round self-certified per [[feedback-agent-token-frugality]]). The orphan/thrash commit (6baf316) had been self-certified without an agent pass; R2 caught the gaps:
- **C1 — `_pid_tree`/`cmd_stop` had only source-text (regex) pins, zero BEHAVIORAL coverage** (the [[feedback-structural-tests-anchor-on-the-whole-unit]] trap — a regex pin stays green even if the recursion were reverted). Added `express-api/tests/scripts/50-matrix-cmd-stop.test.js` (9 tests) that EXECUTE the real shell (the `qa-cleanup-orphans-pin.test.js` spawnSync pattern) against throwaway `sleep` fixtures: `_pid_tree` recursion (all descendants, deepest-first, excludes an unrelated sibling, empty-pid guard) + `cmd_stop` clean/no-op, missing-pid-file die, run-id-tagged reap (DO-kill), and honest `return 1` on a surviving `manual-qa-runner` (DON'T-kill). Mutation-proven: a non-recursive `_pid_tree` returns 1 pid vs the real 2 → the `toEqual` assertion fails ([[feedback-mutation-passed-means-investigate]]).
- **I1 — `cmd_stop` trusted the file-cached `$pid` before recursively `kill -9`ing its subtree** (PID-reuse hazard: over an hours-long run the OS may recycle that PID onto an innocent process). Fixed in `50-matrix.sh`: only walk `$pid`'s tree when it INDEPENDENTLY still matches the run (`pgrep -f "$run_id"` cross-check via `grep -qxF`); otherwise kill only the run_id-scoped set. Preserves healthy-case completeness (the nohup wrapper's argv carries the `--report-dir=.../matrix-<id>/...` path = run_id). Reinforces [[feedback-kill-servers-by-port-not-pkill]] / [[feedback-pkill-f-matches-your-own-waiters]].
- **I2 — the driver stale-holder test exercised only the `catch` branch** (pkill throws); added the success-branch case (pkill succeeds → recovery log fires) to `android-adb-driver.test.js`.
- **Test-harness bug found + codified** while writing C1: `process.kill(pid,0)` reports a KILLED Node-spawned child as alive (zombie, unreaped because the sync busy-wait blocks the event loop) → switched liveness asserts to `pgrep -f <tag>` empty. New memory [[reference-node-spawn-zombie-liveness-check]]. Suite stable across 3 repeat runs.
- Gates: eslint `--max-warnings=0` + prettier clean on the changed JS; `bash -n` clean; gauntlet `.sh` are NOT CI-shellcheck-gated (only actionlint's embedded shellcheck on workflow `run:` blocks), so the pre-existing SC2034 on `for pass in 1 2 3` is left un-churned. Tests: **1360 green** (structure 13 + behavioral 9 + driver incl. new I2). Reviewed-up-to: the R2-fix commit.

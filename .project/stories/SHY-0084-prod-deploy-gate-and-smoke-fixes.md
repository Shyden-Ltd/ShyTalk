---
id: SHY-0084
status: In Review
owner: claude
created: 2026-06-12
priority: P0
effort: M
type: bug
roadmap_ids: []
pr:
public: false
mvp: true
---

# SHY-0084: Consolidate prod-deploy approval gates + fix Android & iOS boot smoke tests

## User Story

As the ShyTalk operator cutting a production release,
I want a SINGLE manual approval gate for the whole prod deploy, an Android boot smoke test that passes reliably, and an iOS boot smoke test that actually runs,
So that releasing to all three platforms is one decision (not four), and a green deploy genuinely proves the apps install + launch on both mobile platforms.

## Why

`.github/workflows/deploy-prod.yml` has three operator-flagged defects (all verified against the latest prod run **27286731472**, 2026-06-10, which FAILED):

1. **Four separate approval gates.** Each platform deploy job carries its own GitHub `environment:` (each with manual-approval protection): `deploy-backend-prod`→`prod-backend` (line 220), `deploy-web-prod`→`prod-web` (324), `deploy-android-prod`→`prod-android` (360), `deploy-ios-prod`→`prod-ios` (406). One release = FOUR approval clicks across four environments. The operator wants ONE gate.
2. **Android boot smoke FAILS.** `smoke-test-android` died in ~4 min, but NOT on the emulator/action download — the log shows the emulator BOOTED ("Emulator booted.") and then the verification `script:` died on its very first line:

   ```
   /usr/bin/sh -c set -euo pipefail
   /usr/bin/sh: 1: set: Illegal option -o pipefail
   ##[error]The process '/usr/bin/sh' failed with exit code 2
   ```

   **Root cause:** `reactivecircus/android-emulator-runner` executes its `script:` input via `/usr/bin/sh` (dash on Ubuntu runners), but the inline block opened with `set -euo pipefail` plus `shopt -s nullglob` and bash arrays (`apks=(...)`, `${#apks[@]}`) — all bash-only constructs. Under dash, line 1 aborts immediately, so the smoke never installs the APK. (The pinned SHA `e89f39f1…` is **correct** — it is the *commit* the annotated `v2.37.0` tag dereferences to; `0a638108…` is the tag-OBJECT sha, which must NOT be pinned. `e2e-tests.yml` already documents "executes `script` via /usr/bin/sh" and wraps its command in `bash -c`, so e2e is the CORRECT reference pattern, not a shared victim — no SHA change anywhere.)
3. **iOS boot smoke NEVER RUNS.** `smoke-test-ios` (line 790) has `timeout-minutes: 20`, but the job spends the entire budget on setup → `:shared:linkDebugFrameworkIosSimulatorArm64` → `pod install` → `Build iOS app for simulator`, which was CANCELLED at exactly 20 min (started 17:21:26, cancelled 17:41:49). The actual "Boot simulator and verify app launches" step was **skipped**. So the iOS boot test has effectively never executed — the slow KMP/xcodebuild eats the whole timeout before the boot verification.

Net effect: prod releases are blocked by a flaky/mis-pinned Android smoke, and the iOS smoke gives zero real coverage. Both are launch-blocking for the tri-platform MVP go-live (`mvp: true`).

## Acceptance Criteria

### Happy path

- [ ] **One gate:** `deploy-prod.yml` uses a SINGLE protected GitHub environment (e.g. `prod`) such that exactly ONE manual approval unlocks all four platform deploys (backend/web/android/ios). Achieved either by (a) pointing all four deploy jobs at one `environment: prod`, or (b) a dedicated `approve-prod` gate job (`environment: prod`) that the four deploys `needs:`. The chosen approach is documented in a workflow comment.
- [ ] **Android boot smoke passes:** `smoke-test-android` runs to completion and verifies the prod debug APK installs, launches `com.shyden.shytalk/.MainActivity`, is the foreground activity, and logs no `FATAL EXCEPTION` — on a green app build.
- [ ] **iOS boot smoke ACTUALLY runs:** `smoke-test-ios`'s "Boot simulator and verify app launches" step EXECUTES (conclusion `success`, not `skipped`/`cancelled`) and verifies the prod app builds, the simulator boots, the app launches, and no crash report is produced.
- [ ] A fully-successful deploy (all 4 deploys + all 4 smokes) ends with `alert-desync` NOT firing.

### Error paths

- [ ] **Real regressions still fail the smoke:** a genuine Android launch failure (e.g. `am start` error / app not foreground / `FATAL EXCEPTION`) still fails `smoke-test-android` (exit 1). A genuine iOS launch failure / crash report still fails `smoke-test-ios`. The fixes must NOT mask real failures to go green (no relaxed assertions, no `|| true`).
- [ ] **The fix does not mask shell errors:** the extracted verifier runs under `bash` (its shebang) so `set -euo pipefail` is honoured — a non-zero adb/grep in the chain still fails the smoke. The script is NOT made to swallow errors to go green.
- [ ] The single approval gate still HARD-requires approval — a deploy cannot proceed to any platform without the one approval. A DENIED approval (the `approve-prod` job fails) blocks all four deploys even though they use `always()` (each `if:` adds `needs.approve-prod.result == 'success'`).

### Edge cases

- [ ] **Cold iOS cache:** the raised iOS timeout (and/or a pre-built shared framework) leaves enough headroom for the boot step to run even on a COLD `~/.konan` cache (the slowest case), not just a warm-cache run.
- [ ] **Android emulator boot stays reliable:** `smoke-test-android` keeps its `ubuntu-22.04` pin (the empirically-stable image for this action — see `android-e2e-emulator-boot-headroom.test.js`); the fix does not touch the emulator/action config, only the verification shell.
- [ ] **No spurious SHA change:** the emulator-runner SHA (`e89f39f1…`) is left UNCHANGED in both `deploy-prod.yml` and `e2e-tests.yml` (it is the correct v2.37.0 commit). `android-e2e-emulator-boot-headroom.test.js`'s SHA + `ubuntu-22.04` pins stay green (regression-guarded).

### Performance

- [ ] iOS smoke completes WITH the boot step inside the (raised) `timeout-minutes`. If the framework is pre-built in a shared job (or cached), document the new budget. The consolidated gate must not unnecessarily serialise the four deploys (they may still run in parallel after the single approval).

### Security

- [ ] The single `prod` environment RETAINS the required-reviewers protection of the prior four (the consolidation reduces clicks, NOT the approval requirement). No secret is moved to a less-protected scope. The `no-self-hosted-runners` + `no-paid-runners` policies still hold (Android stays `ubuntu-22.04`, iOS stays `macos-latest`).

### UX

*(consumer = the operator approving a prod release)*

- [ ] The deployer sees ONE "Review pending deployment" prompt for prod, not four. Approving it once releases all platforms.
- [ ] The four smoke jobs report clear per-platform pass/fail; a failed smoke is visibly attributed to its platform (the existing `alert-desync` summary is preserved/updated).

### i18n

- N/A — CI/CD workflow change; no user-facing strings.

### Observability

- [ ] `alert-desync` (line 923) continues to surface per-platform deploy + smoke outcomes; its `needs`/`if` are updated to match the consolidated gate + the now-running iOS smoke (so a skipped-vs-failed iOS smoke is no longer ambiguous).
- [ ] The iOS smoke's actual boot result is visible in the run (a real conclusion, not a perpetual `cancelled`).

## BDD Scenarios

**Scenario: one approval unlocks the whole prod deploy**
- **Given** a prod deploy is dispatched
- **When** the operator approves the single `prod` environment gate once
- **Then** all four platform deploy jobs (backend/web/android/ios) proceed without any further approval prompt

**Scenario: Android boot smoke verifies a green app**
- **Given** the prod debug APK is built and the app is healthy
- **When** `smoke-test-android` runs
- **Then** the APK installs, the app launches and is the foreground activity, no FATAL EXCEPTION is logged, and the job concludes `success`

**Scenario: iOS boot smoke actually executes the boot step**
- **Given** the prod iOS app builds for the simulator within the timeout
- **When** `smoke-test-ios` runs
- **Then** the "Boot simulator and verify app launches" step has conclusion `success` (NOT skipped/cancelled) and verifies launch + no crash report

**Scenario: a real Android crash still fails the smoke**
- **Given** the app throws a FATAL EXCEPTION on launch
- **When** `smoke-test-android` runs
- **Then** the job fails (exit 1) and `alert-desync` fires for Android

**Scenario: the Android verifier runs under bash (the dash regression is gone)**
- **Given** `reactivecircus/android-emulator-runner` executes its `script:` via `/usr/bin/sh` (dash)
- **When** the smoke `script:` invokes `bash "$GITHUB_WORKSPACE/scripts/ci/android-smoke-verify.sh"`
- **Then** `set -o pipefail` / `shopt` / arrays in the verifier run under a bash interpreter and the APK install + launch verification proceeds (no "Illegal option -o pipefail")

**Scenario: a missing/duplicate APK artifact fails the smoke loudly**
- **Given** the `debug-apk` dir holds zero or more than one `*.apk`
- **When** the verifier runs
- **Then** it exits 1 with `::error::Expected exactly one debug APK … found N` (no silent pass)

## Test Plan

Workflow/CI change — validated by static lint + a real prod-deploy run + any SHA-pin assertion tests.

**RED / discovery (done in this ticket's investigation):**
- Confirmed the 4 `environment: prod-*` gates (deploy-prod.yml 220/324/360/406) + that the `production` environment ALREADY exists with the repo owner as required reviewer (so no operator setup needed for the consolidation).
- Confirmed run 27286731472: Smoke Test (Android Boot) = failure — emulator BOOTED then `script:` died with `/usr/bin/sh: 1: set: Illegal option -o pipefail` (dash, not bash); Smoke Test (iOS Boot) = cancelled (build steps consumed the 20-min timeout; "Boot simulator and verify" skipped).
- Confirmed the SHA `e89f39f1…` is CORRECT (the commit `v2.37.0` dereferences to; `0a638108…` is the annotated-tag object — NOT a pin target). So NO re-pin.

**RED (failing-first tests):**
- `express-api/tests/scripts/android-smoke-verify.test.js`: drives `scripts/ci/android-smoke-verify.sh` against a stubbed `adb` — value matrix: healthy→0; benign "already running" re-launch→0; 0 APKs→1; 2 APKs→1; `am start` error→1; not-foreground→1; FATAL EXCEPTION→1; clean logcat→0. (Fails at RED: script absent → exit 127.)
- `express-api/tests/scripts/deploy-prod-single-gate-and-smoke.test.js`: asserts exactly ONE `environment:` (== `production`); none of the 4 legacy envs remain; `approve-prod` job on `production`; `deploy-backend-prod` needs `approve-prod` + has no own environment; Android smoke calls the bash verifier + has no `set -euo pipefail`/`shopt` + checks out the repo + stays `ubuntu-22.04`; iOS `timeout-minutes` ≥ 40 with the boot step intact.

**GREEN (implementation):**
- NEW `scripts/ci/android-smoke-verify.sh` (bash; install→launch→foreground→crash checks; env-knobbed for testability) + `bash "$GITHUB_WORKSPACE/scripts/ci/android-smoke-verify.sh"` as the action `script:`; add a checkout step to `smoke-test-android` so the file is on disk.
- `deploy-prod.yml`: ONE `approve-prod` job (`environment: production`) that `deploy-backend-prod` needs; remove the 4 `environment: prod-*`; every deploy adds `approve-prod` to `needs:` + `needs.approve-prod.result == 'success'` to its `if:` (enforces the gate under `always()`).
- `smoke-test-ios`: `timeout-minutes: 20 → 45` (headroom for the cold-cache build so "Boot simulator and verify" runs).

**Validation:**
- `npx jest` both new files green; `shellcheck scripts/ci/android-smoke-verify.sh` clean; `actionlint .github/workflows/deploy-prod.yml`; `check-action-shas.sh`; `android-e2e-emulator-boot-headroom.test.js` stays green (SHA + `ubuntu-22.04` regression guard); full `cd express-api && npm test`.
- A real prod-deploy dispatch (operator-gated) showing: ONE approval, all 4 deploys, Android smoke `success`, iOS smoke boot step `success`. Evidence (run id + per-job conclusions) pasted into `## Notes`.

## Out of Scope

- Changing WHAT the smokes assert beyond making them run reliably (deeper E2E coverage is the journey-test corpus, not the boot smoke).
- The dev deploy workflow (`deploy-dev.yml`) — unless it shares the same mis-pinned emulator-runner SHA, in which case re-pin only (no gate change; dev has no manual gates).
- Migrating runners or the emulator API level beyond what's needed to make the Android smoke reliable.

## Dependencies

- GitHub `environments`: reuses the pre-existing **`production`** environment (required reviewer = repo owner, verified via `gh api repos/.../environments`). No operator setup needed — the four `prod-*` envs are simply abandoned.
- No SHA change → no `check-action-shas.sh` impact; the existing emulator-runner pin stays.

## Risks & Mitigations

- **Misdiagnosis trap (annotated-tag SHA).** The original draft blamed a "wrong SHA" — but `git/refs/tags/v2.37.0` returns the annotated-tag OBJECT sha (`0a638108…`), not the commit; the pinned `e89f39f1…` is the correct dereferenced commit. Pinning the tag-object sha would have INTRODUCED a real digest-mismatch. *Mitigation:* verified via deref (`git/tags/<tagsha>`); the fix touches the shell, not the pin — caught by the pickup-fitness review before implementation.
- **Collapsing to one environment weakens approval if misconfigured.** *Mitigation:* reuses the already-protected `production` env; each deploy's `if:` adds `needs.approve-prod.result == 'success'` so a denied approval blocks all four despite `always()`; the assertion test pins exactly-one-environment == `production`.
- **Raising the iOS timeout just delays a still-too-slow build.** *Mitigation:* measure the cold-cache build time; if it can't fit a sane timeout, pre-build the framework in a shared job (the deploy-ios job already builds it — reuse its artifact/cache).
- **Can't fully prove via CI alone** — a real prod-deploy run is the proof ([[feedback-workflow-verify-by-running]]); operator-gated.

## Definition of Done

- `deploy-prod.yml` consolidated to one approval gate; Android smoke re-pinned/reliable; iOS smoke boot step runs within timeout — all per the AC.
- `actionlint` + `check-action-shas.sh` green; any SHA-assertion test updated; `code-reviewer` ZERO findings.
- A real operator-gated prod-deploy run shows ONE approval + Android smoke `success` + iOS smoke boot step `success`; evidence in `## Notes`.
- Merged + released (`released_in: vX.Y.Z`). SHY-INDEX row added.

## Notes (running log)

- 2026-06-12 ~01:32 BST — **IMPLEMENTED + ROOT-CAUSE CORRECTED (In Review).** Pickup-fitness review (re-validated the ticket vs current code BEFORE implementing) overturned defect 2's diagnosis: the Android smoke does NOT fail on a SHA/digest-mismatch. The pinned `e89f39f1…` IS the correct v2.37.0 commit — `git/refs/tags/v2.37.0` returns the annotated-tag OBJECT sha `0a638108…` (`type: tag`), and dereferencing it (`git/tags/<tagsha>`) gives the commit `e89f39f1…`. Pinning the draft's "correct" `0a638108…` would have INTRODUCED a real digest-mismatch. The REAL failure (run 27286731472 log): emulator booted, then the `script:` died with `/usr/bin/sh: 1: set: Illegal option -o pipefail` — the action runs `script` via dash, and the inline block used bash-only `set -o pipefail` + `shopt` + arrays. **Fixes shipped:** (1) NEW `scripts/ci/android-smoke-verify.sh` (bash; shellcheck-clean) invoked via `bash "$GITHUB_WORKSPACE/…"`, + a checkout step in `smoke-test-android` (it had none — only the APK artifact); (2) ONE `approve-prod` job on the pre-existing `production` env (repo-owner reviewer) gates all four deploys via `needs:` + an explicit `needs.approve-prod.result == 'success'` in each `if:` — removed the 4 `environment: prod-*`; (3) iOS smoke `timeout-minutes: 20 → 45`. **Tests:** `android-smoke-verify.test.js` (10, stubbed adb value-matrix) + `deploy-prod-single-gate-and-smoke.test.js` (13) — both RED-first then GREEN; `android-e2e-emulator-boot-headroom.test.js` still green (SHA + `ubuntu-22.04` unchanged); actionlint + check-action-shas clean; full express-api **12,178 pass**. No SHA changed anywhere. Live prod-deploy verification (one approval + Android/iOS smoke success) pending the operator-gated run (queued for morning approval per operator).
  - **code-reviewer (agent ae4cd74d) cycle 1:** 2 Critical + 2 Important + 2 Minor. Resolved: **C2** (only `deploy-backend-prod` was test-pinned for the gate) → added 9 tests asserting `deploy-web/android/ios-prod` each carry `needs: approve-prod` + `needs.approve-prod.result == 'success'` under `always()` + no own environment. **I1** (no failing-`adb install` test) → added `installRc:'1'` case. **I2** (`^Error` misses lowercase adb-transport `error:`) → pattern → `^[Ee]rror` + a "device offline" test. **M1** (dead `${crashes:-0}` reassignment) → removed — and NOTE the reviewer's literal `|| echo 0` fix was itself BUGGY (grep prints "0" AND exits 1 on no-match → `|| echo 0` yields "0\n0" → arithmetic error; caught by the clean-logcat test), so I kept the correct `|| true` form. **C1** (`build-android` builds/signs prod artifacts pre-approval) → **documented won't-fix:** it is PRE-EXISTING (unchanged from the old design — the old gates were on the deploy jobs, never the build), it does NOT deploy (publication is gated on deploy-android-prod which needs approve-prod), sign≠publish, and gating it would force a ~25-min post-approval rebuild that hurts the queued-overnight deploy — a workflow comment records the deliberate choice. M2/I3 = design notes covered by the C2 tests. Re-verify: shellcheck + actionlint clean; 34 SHY-0084 tests green; full suite 12,178. **Operator: flag C1 if you'd prefer the Android build gated too (security-vs-speed trade-off).**
- 2026-06-12 ~00:25 BST — Filed at operator request ("the deploy workflow does 4 separate manual approval gates — consolidate to one; the android smoke tests fail — look into it; the iOS smoke tests don't happen at all — fix that"). Investigation done against prod run **27286731472** (2026-06-10, FAILED): 4 gates = `prod-backend/web/android/ios`; Android smoke fails on the emulator-runner step (pinned SHA `e89f39f1…` ≠ real v2.37.0 `0a638108…` → `digest-mismatch`, ~4-min death); iOS smoke `cancelled` — the "Build iOS app for simulator" step hit the 20-min timeout so "Boot simulator and verify" was skipped (the boot test never runs). `mvp: true` — prod-deploy reliability gates the tri-platform go-live. Implementation deferred until SHY-0082 (Mirror v4) lands (one active branch); P0 in the queue thereafter.

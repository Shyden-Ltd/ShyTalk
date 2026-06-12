---
id: SHY-0026
status: Draft
owner: claude
created: 2026-06-07
priority: P2
effort: S
type: infra
roadmap_ids: [G043, G044]
pr:
mvp: true
---

# SHY-0026: Mobile driver helper scripts (Android flags check + iOS WDA build)

## User Story

As the ShyTalk operator setting up the cross-platform QA matrix on new dev machines, I want **`express-api/scripts/drivers/mobile-android-flags-check.sh` + `express-api/scripts/setup-ios-wda.sh` helper scripts wired into the runner's `--check-env` mode**, so that operator-onboarding for the mobile-Chrome and iOS-Safari matrix cells becomes one command instead of a multi-step manual checklist.

## Why

Per the QA framework runbooks (`QA_FRAMEWORK_CELL_RUNBOOK_ANDROID.md` + `QA_FRAMEWORK_CELL_RUNBOOK_IOS.md`), two prerequisite steps are currently undocumented-script gaps:

**G043 (Android)**: mobile-browser flags need probing via `adb getprop` to detect chrome://flags state (specifically, whether `--enable-features=DownloadResumption` etc. are enabled). Manual command; not in `--check-env`.

**G044 (iOS)**: WebDriverAgent (WDA) needs a one-command build with team-ID argument, xcrun xcodebuild invocation, signing verification. Currently a multi-step manual checklist.

Roadmap rows G043 (line 111) + G044 (line 112):

> G043: Sev: 🟡 Polish. Matrix — Android mobile-browser chrome://flags check. Location: `express-api/scripts/drivers/` + `QA_FRAMEWORK_CELL_RUNBOOK_ANDROID.md`. Gap: Flag-state-probe script missing from `--check-env`. Fix: `mobile-android-flags-check.sh` via adb getprop; wire into `--check-env`. Scope: S.
>
> G044: Sev: 🟡 Polish. Matrix — iOS WebDriverAgent build script. Location: `express-api/scripts/` + `QA_FRAMEWORK_CELL_RUNBOOK_IOS.md`. Gap: One-command script missing. Fix: `scripts/setup-ios-wda.sh` with team-ID arg, xcrun xcodebuild, signing verify. Scope: S.

P2 Tier-4 (operator ergonomics). Together these scripts close the manual-toil onboarding gap for 2 matrix cells.

## Acceptance Criteria

### Happy path

- [ ] `express-api/scripts/drivers/mobile-android-flags-check.sh` exists, executable, with shebang `#!/usr/bin/env bash`, `set -euo pipefail`.
- [ ] Script reads chrome://flags state via `adb shell getprop`-style probes; prints PASS/FAIL per required flag.
- [ ] Required-flag list documented at top of script with reasons.
- [ ] Exit 0 if all required flags configured; non-zero with clear list of missing flags otherwise.
- [ ] `express-api/scripts/setup-ios-wda.sh` exists, executable, takes `--team-id <ID>` argument (required).
- [ ] Script runs `xcrun xcodebuild` against WebDriverAgent's project file, signs with the provided team-ID, verifies the build artifact, prints next-step instructions.
- [ ] Exit 0 on successful build + signing verify; non-zero with the xcodebuild error tail otherwise.
- [ ] `manual-qa-runner.js --check-env` invokes both scripts when running against the relevant matrix cells; outcome propagates to the check-env summary.
- [ ] Both runbooks updated to point to the scripts instead of describing manual steps.

### Error paths

- [ ] **flags-check**: adb not installed → script exits non-zero with `adb required; install via Android Studio SDK Manager`.
- [ ] **flags-check**: no Android device connected → exits non-zero with `no device; connect via USB or wireless adb pair`.
- [ ] **flags-check**: device unauthorized → exits non-zero with `device unauthorized; accept the prompt on device`.
- [ ] **setup-ios-wda**: xcrun not installed → exits non-zero with `Xcode Command Line Tools required`.
- [ ] **setup-ios-wda**: --team-id missing → prints usage and exits non-zero.
- [ ] **setup-ios-wda**: invalid team-id (signing failure) → prints xcodebuild's exact error tail; suggests checking Apple Developer Account.

### Edge cases

- [ ] **flags-check**: multiple devices connected → script prompts for device serial OR honours `ANDROID_SERIAL` env var.
- [ ] **flags-check**: physical device vs emulator → both supported with different flag baselines.
- [ ] **setup-ios-wda**: Simulator vs real device builds — script supports `--target <simulator|device>` (default simulator).
- [ ] **setup-ios-wda**: WDA repo not present → script clones it OR exits with clone instructions.

### Performance

- [ ] flags-check completes within 5s.
- [ ] setup-ios-wda completes within 5 minutes (first build); incremental builds faster.

### Security

- [ ] Neither script writes secrets to stdout/stderr.
- [ ] team-id treated as semi-sensitive (Apple's identifier); not logged to CI artifacts.
- [ ] No PII captured from devices.

### UX

- [ ] Both scripts print human-readable status (✓ / ✗ / colour-coded if TTY).
- [ ] Failures suggest the next-step remediation, not just an error code.
- [ ] `--help` flag prints usage + examples.

### i18n

- [ ] N/A — operator tooling; English only.

### Observability

- [ ] Both scripts emit a structured-log line at end (`[mobile-android-flags-check] result: PASS|FAIL flags-missing: A,B,C`).
- [ ] `--check-env` summary in the runner integrates both scripts' results.
- [ ] CI workflow that runs `--check-env` surfaces individual script outcomes.

## BDD Scenarios

**Scenario: Android flags-check passes on properly-configured device**

- **Given** an Android device connected via adb with required chrome://flags enabled
- **When** `bash express-api/scripts/drivers/mobile-android-flags-check.sh` runs
- **Then** exit code is 0
- **And** stdout contains `[mobile-android-flags-check] result: PASS`

**Scenario: Android flags-check fails clearly on missing flag**

- **Given** Android device with a required flag disabled
- **When** the script runs
- **Then** exit is non-zero
- **And** stdout names the missing flag(s) + remediation step

**Scenario: iOS WDA build succeeds with valid team-id**

- **Given** Xcode installed; valid Apple Developer team-ID
- **When** `bash express-api/scripts/setup-ios-wda.sh --team-id ABCD1234` runs
- **Then** exit code is 0
- **And** WDA build artifact exists at the expected path
- **And** signing identity verified

**Scenario: iOS WDA build fails clearly on invalid team-id**

- **Given** Xcode installed; invalid team-ID
- **When** script runs
- **Then** exit non-zero
- **And** xcodebuild error tail printed
- **And** "check Apple Developer Account" hint shown

**Scenario: --check-env integrates both scripts**

- **Given** runner invoked as `node manual-qa-runner.js --check-env`
- **When** matrix cells include mobile-android-chrome AND ios-simulator-safari
- **Then** both helper scripts run as part of check-env
- **And** check-env summary lists their outcomes

## Test Plan (TDD)

### Red

1. Add `express-api/tests/scripts/mobile-android-flags-check.test.js` with shell-test pattern (spawnSync against the script):
   - Test A: script not yet exists → RED.
   - Test B: --help prints usage.
   - Test C: missing-adb error path mock.
2. Same for `setup-ios-wda.test.js`.
3. Add `--check-env` integration test asserting both helpers called.
4. Run `cd express-api && npm test -- mobile-android` → RED.

### Green

1. Implement both scripts.
2. Wire into `--check-env`.
3. Update runbooks.
4. Re-run → GREEN.

## Out of Scope

- **Other matrix-cell helper scripts** (mobile-firefox, ios-real-device-cellular) — separate SHYs if needed.
- **Refactoring the runner's --check-env logic** — only adding invocations.
- **CI-side automation** — scripts are operator-side helpers.

## Dependencies

- **SHY-0001** + **SHY-0032** — process.
- `manual-qa-runner.js` — host for `--check-env`.
- Android SDK + adb (operator must have these for Android cell).
- Xcode + xcrun (operator must have these for iOS cell).

## Risks & Mitigations

- **Risk:** flag-detection via `adb getprop` is fragile (flag formats differ per Chrome version). **Mitigation:** parse defensively; fail clearly if format unknown.
- **Risk:** WDA build is genuinely slow on first run; operator perceives script as "hung". **Mitigation:** stream xcodebuild output; print progress markers.
- **Risk:** xcrun signing varies between Xcode versions. **Mitigation:** test against current dev's Xcode; document version baseline.

## Definition of Done

- [ ] Both scripts exist and pass their tests.
- [ ] --check-env integration verified via integration test.
- [ ] Runbooks updated.
- [ ] Reviewer ZERO findings.
- [ ] Per-type Done gate (`infra` → auto-merge once green; manual operator verification on a real device + simulator).
- [ ] PR merged.
- [ ] `status: Done`; `pr:` populated; operator-verification outcome in Notes.

## Notes (running log)

- 2026-06-07 ~21:37 BST — Refined under SHY-0032. Tier 4 operator ergonomics.
- 2026-06-07 — Skeleton from `convert-roadmap-to-stories.sh` PR-bundle `PR-I4` (G043, G044).

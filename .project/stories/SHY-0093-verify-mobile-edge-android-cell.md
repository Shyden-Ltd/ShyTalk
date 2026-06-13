---
id: SHY-0093
status: Draft
owner: claude
created: 2026-06-13
priority: P2
effort: S
type: chore
roadmap_ids: []
epic: EPIC-0003
pr:
mvp: false
---

# SHY-0093: Make the `mobile-edge-android` matrix cell green-or-provably-env-gated

## User Story

**As** the QA matrix that must drive every real browser ShyTalk ships to,
**I want** the `mobile-edge-android` cell (Mobile Edge on a real Android device, via CDP-over-adb) to either run a real journey green, or report a **loud, accurate, remediation-named skip**,
**So that** the one non-green web cell is resolved by evidence — not left as an ambiguous "skip" that hides whether it is a missing device or a real CDP-wiring bug.

## Why

EPIC-0003's evidence pass found the 12-cell web matrix is 11/12 operational; the sole non-green cell is `mobile-edge-android`, which currently does not run. It is **unknown** whether that is (a) a benign device-availability skip (no Edge-capable Android attached / Edge not installed) or (b) a real bug in the CDP-over-adb wiring (`EDGE_CDP_SOCKET = 'com.microsoft.emmx_devtools_remote'` → `adb forward localabstract:…` → `playwright.chromium.connectOverCDP`). Per [[feedback-never-guess-always-investigate]], the cause must be established on the **real device** before any code change: let the evidence name it, then fix-or-document.

## Acceptance Criteria

### Happy path
- [ ] On a **real** Android device with Mobile Edge installed and **USB Web Debugging** enabled, `node scripts/manual-qa-runner.js --check-drivers --target local --filter mobile-edge-android` reports the driver **healthy/available** (CDP endpoint reachable, ≥1 context).
- [ ] A representative web regression journey runs **green** in the `mobile-edge-android` cell against the real ShyTalk web surface via Edge-over-CDP.

### Error paths
- [ ] When Mobile Edge is **not installed** / no Edge-capable device is attached, the runner emits a **loud, accurate skip** (not a silent pass, not a false failure) naming the exact remediation: open Mobile Edge, enable USB Web Debugging (About-Edge → tap version 5× → developer mode), connect+trust the device.
- [ ] When `connectOverCDP` fails, the existing actionable error fires verbatim and is correct (`… Confirm Mobile Edge is open on the device + "USB Web Debugging" is enabled …`).

### Edge cases
- [ ] **InPrivate-only** Edge → CDP returns 0 contexts → the driver's existing 0-contexts message fires (`… may be in InPrivate mode only. Switch to a normal tab + retry.`) and the cell skips loudly rather than passing empty.
- [ ] The hardcoded socket name `com.microsoft.emmx_devtools_remote` is **verified to match the real device's actual Edge DevTools socket** (`adb shell cat /proc/net/unix | grep -i emmx`); if Edge's socket name has drifted, the fix updates `EDGE_CDP_SOCKET` to the observed value (evidence-driven).
- [ ] The adb `localabstract` forward is **torn down** after the cell (no leaked forward across cells — verify with `adb forward --list` before/after).

### Performance
- [ ] `connectOverCDP` honours a bounded connect timeout (no indefinite hang on an absent socket); the cell's wall-clock is within ~2× the `mobile-chrome-android` cell (both are Chromium-over-CDP).

### Security
- [ ] CDP is reached only over the **local adb forward** (localhost) — no network-exposed DevTools endpoint; the forward is scoped to the run and removed on teardown.

### UX
- [ ] In the matrix report, a skipped Edge cell is **visually unambiguous** vs a pass or a fail (the QA reader can tell "env not present" from "broken" at a glance).

### i18n
- N/A — driver tooling + runner output are English (internal engineering surface).

### Observability
- [ ] The skip-vs-fail-vs-pass outcome is recorded in the cell's per-cell log with the cause (device-absent / InPrivate / connect-failed / passed), so a CI or local reader needs no re-derivation.

## BDD Scenarios

**Scenario: Edge cell runs green on a real device**
- **Given** a real Android device with Mobile Edge open + USB Web Debugging on
- **When** the `mobile-edge-android` cell runs a regression journey
- **Then** it connects over CDP and the journey passes
- **And** `--check-drivers` reports the driver healthy

**Scenario: Edge absent → loud skip, not silent pass**
- **Given** no Edge-capable Android device / Edge not installed
- **When** the cell runs
- **Then** the runner reports a loud skip naming the remediation
- **And** it does NOT report a pass

**Scenario: socket-name drift is caught by evidence**
- **Given** the device's real Edge DevTools socket is inspected via `/proc/net/unix`
- **When** it differs from `com.microsoft.emmx_devtools_remote`
- **Then** `EDGE_CDP_SOCKET` is updated to the observed value
- **And** the cell then connects

**Scenario: no leaked adb forward**
- **Given** the cell completes (pass or skip)
- **When** `adb forward --list` is checked
- **Then** the cell's `localabstract` forward has been removed

## Test Plan

Touches `.js` (driver + possibly runner) → **runs the FULL Pre-Merge Testing Protocol**. Evidence-first on the **real** device (no simulator/mock); real backends per CLAUDE.md § No Stubs.

**Investigation (before any edit, per never-guess):**
- `--check-drivers --filter mobile-edge-android` on the real device → capture the actual failure/skip reason.
- `adb shell cat /proc/net/unix | grep -i emmx` → confirm the real socket name.
- Decide from evidence: env-skip (document + make the skip loud/accurate) vs CDP-wiring bug (fix the socket/forward/connect path).

**Red → Green (framework by framework):**
- **Express/Node (Jest)** `cd express-api && npm test`:
  - `tests/scripts/drivers/web-mobile-edge-android-driver.test.js` extended: assert the connect path uses the (verified) socket name; assert the absent-socket path yields a **loud skip object** (not a pass); assert teardown removes the forward. RED before fix, GREEN after.
  - `driver-contract.test.js` + `driver-interface-pin.test.js` green unchanged (method surface stable).
- **eslint** `npm run lint` → 0 warnings.
- **Device gauntlet (Phase 1 LOCAL):** the real journey runs **green in the `mobile-edge-android` cell on the real device** (the headline AC); the full matrix re-run shows 12/12 green (or Edge a loud env-skip with the cause recorded, if the device genuinely lacks Edge — operator-visible).
- **Phase 2:** `code-reviewer` 100% clean → push → CI green by name (Detect Changes / Analyze JavaScript / PR Gate).
- **Phase 3 (DEV):** re-run on dev (web = Chrome; the Edge-android cell is local-matrix only — note in PR that dev cannot prove Edge).

## Out of Scope
- The 11 already-green web cells (no changes).
- Appium / native-iOS work (SHY-0094/0095).
- Adding Edge to CI's hosted runners (no real Android device in CI; the Edge cell is a local-gauntlet cell — see the DEV-phase note).

## Dependencies
- A **real Edge-capable Android device** connected + trusted with USB Web Debugging available.
- `android-cdp-helpers.js` (`bootstrapAdbForward`) + the Android cell runbook (`QA_FRAMEWORK_CELL_RUNBOOK_ANDROID.md`).
- SHY-0026 mobile-driver onboarding (`mobile-android-flags-check.sh`) for the device-trust/flag preconditions.

## Risks & Mitigations
- **Risk:** the device available at build time has no Mobile Edge → cannot prove the green path. **Mitigation:** install Edge from Play Store on the real device (devices are connected per EPIC-0003); if genuinely impossible, escalate to the operator rather than declaring the cell green on no evidence.
- **Risk:** Edge's DevTools socket name drifts between Edge versions. **Mitigation:** the fix reads the real socket from `/proc/net/unix` and the test pins the verified value with a comment citing the observed Edge version.
- **Risk:** a leaked adb forward poisons a later cell. **Mitigation:** explicit teardown + the `adb forward --list` before/after assertion.

## Definition of Done
- [ ] Root cause established on the real device (env-skip vs wiring bug) and recorded in Notes; fix applied if it is a bug, accurate loud-skip if it is env.
- [ ] **Pre-Merge Testing Protocol satisfied** (`CLAUDE.md` § Pre-Merge Testing Protocol): driver Jest RED→GREEN + contract/pin tests green + eslint 0 → LOCAL gauntlet shows the `mobile-edge-android` cell green on the real device (or loud env-skip with cause) + full matrix re-run → `code-reviewer` 100% clean → push → CI green by name → DEV gauntlet green → **judgment-merge** (zero doubt; NO auto-merge; notify operator).
- [ ] `released_in: vX.Y.Z` set on the next release cut.

## Notes (running log)
- 2026-06-13 — Filed under EPIC-0003 (child build-order item **A**). Evidence at filing: driver uses `EDGE_CDP_SOCKET='com.microsoft.emmx_devtools_remote'` → `bootstrapAdbForward` → `pw.chromium.connectOverCDP`; actionable connect-failure + 0-contexts(InPrivate) messages already present (lines 82/92). Cause of the current non-green state is **unknown by design** — this story's first act is the real-device investigation, not a guessed fix.

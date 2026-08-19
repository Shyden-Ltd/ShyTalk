---
id: SHY-0241
status: Draft
owner: claude
created: 2026-07-25
priority: P1
effort: M
type: infra
roadmap_ids: []
epic: EPIC-0009
---

# SHY-0241: Harden cross-platform real-time journey coverage (live admin/web → Android/iPhone propagation)

## User Story

As **the engineer trusting the release gauntlet to prove the product works cross-platform**,
I want **the moderation/admin journeys to assert that an admin/web action propagates LIVE (within a bounded time) to both the Android app and the iPhone app**,
So that **a regression that breaks real-time cross-surface propagation — the core of a social app where a web-admin action must instantly reach every participant's phone — is caught by the matrix instead of shipping**.

## Why

The 2026-07-25 grounding investigation (recorded in EPIC-0009 / SHY-0240 Notes) mapped exactly what the four confirmed cross-platform journeys assert today:

- **j10 (`j10-mid-room-warning.feature`) already covers it** — Greta warns from Web Admin → `within 5000ms Theo's Android UI navigates to the warning screen` (`:57-59`) AND `within 5000ms Ines's iOS Sim UI shows Theo's seat with mic-off` (`:66-69`). Genuine live web→Android **and** →iOS.
- **j11 (`j11-harassment-moderation-cycle.feature`) already covers it** — Android→iOS live (`within 3000ms Nora's iOS Sim UI shows the message`, `:33-35`) and web-admin→iOS live (`:60-64`, `:87-91`).
- **j01 (`j01-adult-new-day-one.feature`) is a GAP** — Android + Web only (no iOS); the web-admin→device path is *relaunch-gated* (Greta approves → `Adam kills and relaunches` → cohort claim, `:84-85`), not an instant live assertion.
- **j04 (`j04-dob-mismatch-flip.feature`) is mostly a GAP** — Android-physical + Web (no iOS); the web-admin downgrade reaches Android only via `force-refreshes via securetoken` + `relaunches the app` (`:67-77`), not instant-live. Its one genuinely-live leg is Android→Android (`:87-88`).

So "harden cross-platform real-time coverage" = **add live web→device propagation assertions to j01 + j04**, mirroring the proven j10/j11 `Then within <N>ms <persona>'s <platform> UI shows/navigates …` pattern, and **consider upgrading j10/j11's `@ios-sim` tag to `@ios-device`** so the real-time iOS leg runs on a real iPhone (per the retired-Simulator policy).

**Why this is its own story (split from SHY-0240):** these assertions can only be *verified* by driving real Android + iOS device UIs through `manual-qa-runner.js` (adb/simctl/Playwright drivers) — a hard matrix gate that needs physically-present, unlocked, prepared devices and the operator present (the release session). It is not AFK/headless-verifiable, unlike the SHY-0240 smoke.

## Acceptance Criteria

### Happy path
- [ ] j01 gains a live web-admin→device assertion: after Greta approves Adam on Web Admin, `Then within <N>ms Adam's <device> UI` reflects the approval **without a kill/relaunch** (or, if the product genuinely requires a token refresh, the assertion drives the in-app refresh path and asserts the live UI change, not a manual relaunch).
- [ ] j04 gains a live web-admin→device assertion for the downgrade reaching the app UI within a bounded time.
- [ ] At least one of j01/j04 asserts propagation to **iOS** as well as Android (so both phones are exercised for the admin→device path), consistent with the tri-platform policy.

### Error paths
- [ ] The new assertions use the existing bounded `within <N>ms` matcher so a *missing* propagation fails the scenario (not a silent pass); the chosen bound matches the product's real propagation SLA (align with j10/j11's 3000–5000ms).

### Edge cases
- [ ] The assertions do not assume a specific device speed — bounds are generous enough for a real low-end device on a poor connection ([[feedback-mobile-first-and-low-connectivity-all-surfaces]]) yet tight enough to catch a genuine break.
- [ ] j10/j11 `@ios-sim` → `@ios-device` upgrade (if taken) keeps the scenarios green on a real iPhone; if the runner can't yet drive a real-iOS cell for these, the tag change is deferred with a recorded reason rather than left failing.

### Performance
- [ ] N/A — journey assertions; the matrix wall-clock is dominated by device I/O, not these added `Then` steps.

### Security
- [ ] N/A — test-corpus assertions; no runtime/product change, no secrets.

### UX
- [ ] N/A — no user-facing surface; test authoring only.

### i18n
- [ ] N/A — journey steps are English Gherkin (the corpus convention).

### Observability
- [ ] Each new assertion produces a clear pass/fail line in the matrix cell log (the existing `manual-qa-runner` per-scenario `OK|FAIL|SKIP` output), attributable to the specific propagation leg.

## BDD Scenarios

**Scenario: Web-admin approval reaches the Android app live (j01)**
- **Given** Adam is signed in on the Android app awaiting approval
- **When** Greta approves Adam on the Web Admin
- **Then** within the propagation bound, Adam's Android UI reflects the approved state without a manual relaunch

**Scenario: Web-admin approval reaches the iPhone app live (j01/j04)**
- **Given** the same admin action with a persona on the iPhone app
- **When** the admin action is taken on Web Admin
- **Then** within the propagation bound, the iPhone UI reflects it

**Scenario: A broken propagation fails the scenario**
- **Given** a regression that stops the live admin→device push
- **When** the journey runs
- **Then** the bounded `within <N>ms` assertion times out and the scenario FAILS (no silent pass)

## Test Plan

**Classification: device-matrix journey work (NOT tooling-only).** Runs the full Pre-Merge Testing Protocol — real Android + real iPhone + web-admin (Playwright) via `manual-qa-runner.js`, LOCAL gauntlet green then DEV green. Files touched: `journey-tests/j01-adult-new-day-one.feature`, `journey-tests/j04-dob-mismatch-flip.feature` (add live web→device `Then` steps), and optionally the `@ios-sim`→`@ios-device` tags in `journey-tests/j10-mid-room-warning.feature` + `j11-harassment-moderation-cycle.feature`. Any new step phrasing must resolve to existing step definitions (or add them under `manual-qa-runner.js`'s matchers with their own runner-branch coverage per the driver-method conventions).

**Verification (device-dependent — release session):** run the affected journeys on the real device matrix (Mac web-admin ∥ real Android ∥ real iPhone), assert the new live-propagation steps pass; then DEV. This is the hard gate SHY-0240's smoke protects but cannot replace.

**Pre-req:** validate the current j01/j04/j10/j11 still pass as-is before adding assertions (baseline), so a new failure is attributable to the added step, not pre-existing drift ([[feedback-pickup-fitness-review-every-story]]).

## Out of Scope

- The pre-flight smoke (SHY-0240, merged separately).
- Rewriting the journey corpus or the drivers beyond the added assertions + any step definitions they require.
- Per-lane data isolation / multi-emulator lanes (EPIC-0009 explicitly OUT).
- New moderation/admin *product* features — this is coverage hardening of existing flows.

## Dependencies

- **SHY-0240** (smoke) + SHY-0238/0239 — this is the last EPIC-0009 child; it is exercised by the same first real v2 run that serves as the release gate.
- Real Android + real iPhone devices, prepared + unlocked (the SHY-0239 PIN gate), with the runner able to drive a real-iOS cell for the iOS assertions.
- The `manual-qa-runner.js` matchers for the `within <N>ms <persona>'s <platform> UI …` propagation assertions (j10/j11 already use them — reuse, don't reinvent).

## Risks & Mitigations

- **Risk:** the runner can't yet drive real-iOS cells for these journeys (the "FRAMEWORK FIRST" gap — only Android-native + Web-Chromium fully wired today). **Mitigation:** land the Android web→device assertions first; gate the iOS assertion / `@ios-device` upgrade on the runner supporting it, with a recorded reason if deferred.
- **Risk:** flaky bounds cause false failures on a slow device. **Mitigation:** match j10/j11's proven 3000–5000ms bounds; tune against real-device measurement, committed as data ([[feedback-first-sample-is-the-fastest-sample]]).
- **Risk:** a new step phrase has no step definition. **Mitigation:** reuse j10/j11's exact matcher phrasing; if a new matcher is needed, add it with runner-branch tests per the driver-method conventions.

## Definition of Done

- j01 + j04 assert live web-admin→device propagation (Android, and at least one iOS leg) within bounded time; a broken propagation fails the scenario.
- The affected journeys pass on the real device matrix LOCAL then DEV (the release-session gate); j10/j11 `@ios-device` upgrade done or deferred-with-reason.
- `code-reviewer` clean; merged to develop; exercised by the first real v2 run.

## Notes

**2026-07-25:** Split out of the original SHY-0240 ("smoke + cross-platform coverage") during the SHY-0240 build. Rationale: the smoke is device-free tooling (built + merged AFK); this journey hardening is device-matrix work that only the operator-present release session can verify. Drafted fully-refined so it is a ready pickup for that session. Exact current coverage (from the SHY-0240 grounding Explore): j10/j11 already assert live web→device propagation; j01/j04 do not (relaunch-gated / no iOS). This story closes that gap.

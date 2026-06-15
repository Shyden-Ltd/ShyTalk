---
id: SHY-0101
status: Draft
owner: claude
created: 2026-06-15
priority: P1
effort: L
type: infra
roadmap_ids: []
epic: EPIC-0003
pr:
mvp: false
---

# SHY-0101: Make j11 (harassment-moderation) green on real Android — close the journey-apparatus gaps + retire `@known-failure-SHY-0097`

## User Story

**As** the EPIC-0003 real-device gauntlet running the j11 harassment-moderation journey on the real OnePlus CPH2653,
**I want** the Android journey apparatus (launch-gate handling, dev persona-picker availability, acknowledge-scenario robustness, and the message / conversation / appeal driver actions) to be complete and deterministic,
**So that** every `@android-physical` scenario in `journey-tests/j11-harassment-moderation-cycle.feature` runs **green on the real device** and the `@known-failure-SHY-0097` tag can finally be retired.

## Why

SHY-0096 (Phase-0 linchpin) and SHY-0097 (server-authorized warning-acknowledge) were device-proven, but getting there surfaced a cascade of **journey-apparatus** gaps (NOT product bugs) that were explicitly banked as SHY-0101 (see SHY-0096 Notes 2026-06-14 + SHY-0097 Notes 2026-06-14 `I4`). j11 is the most complex moderation loop (15 scenarios, 3 acts); today it cannot run end-to-end on the real device because the apparatus that drives it is incomplete:

1. **Dev fresh-install launch gates.** `express-api/scripts/drivers/android-adb-driver.js#_advancePastLaunchGates` handles `splash` + "Later"/"Not now" taps, but a **fresh dev install** parks the app behind a legal-accept gate, the **OS notification-permission system dialog**, and the daily-reward dialog before any `main_*`/picker screen is reachable. The driver does not advance past that full chain deterministically, so the device never reaches a testable state on a clean dev build.
2. **Dev persona-picker unavailable.** `shared/src/commonMain/kotlin/com/shyden/shytalk/core/BuildVariant.kt#isPersonaPickerAvailable` is `!localDevPersonasPassword.isNullOrEmpty()`. LOCAL hardcodes `localdev123`; PROD is empty (picker off); **DEV has no committed password bake**, so a stock dev build (incl. the Deploy-To-Dev seeded build) shows no persona picker — the journey can't sign personas in without a manual one-off `-P` at build time. There is no committed, CI-reproducible mechanism.
3. **j11 acknowledge SCENARIO flakes** (distinct from the flag-flip, which SHY-0097 proved). `journey-tests/j11-harassment-moderation-cycle.feature:79` taps `warning_acknowledgeButton`, but the button can vanish in the `Given`→`When` step gap (a daily-reward popup / transition re-covers it). The acknowledge matcher needs dismiss-and-retry robustness before the scenario is reliably green. This is why `@known-failure-SHY-0097` (line 78) is **kept** until SHY-0101 (operator: "keep it until green").
4. **Missing Android driver actions.** j11 needs `androidSendMessageTo` (lines 33/90), `androidOpenConversationWith` (line 175), and an appeal action for `suspension_submitAppealButton` (line 138). The **runner matchers** for the first two exist (`manual-qa-runner.js:3831`, `:8550`) but the **real Android driver methods** are missing/incomplete — the same matcher-ahead-of-driver gap SHY-0096 closed for `androidKillAndRelaunch`.
5. **Missing suspension/appeal setup-Givens.** Act-2/Act-3 scenarios depend on `Given Raul is on the suspension screen` / `Given Raul has submitted a suspension appeal` etc.; those setup-Givens have no runner wiring yet.

Closing these makes j11 a genuinely-runnable real-device journey (EPIC-0003's "fully-operational, real-only" bar) and removes the last standing `@known-failure` tag on the moderation corpus.

## Acceptance Criteria

### Happy path
- [ ] `_advancePastLaunchGates` advances a **fresh dev install** past the full gate chain — legal-accept → OS notification-permission → daily-reward → splash — to the persona picker (or `main_*` if already signed in) in one bounded call, on the real OnePlus CPH2653.
- [ ] The launch-gate advance is reachable through the **public** driver surface the runner invokes — either promote the current internal `driver._advancePastLaunchGates` to a public method, or deliberately keep + document the underscore convention (decision recorded in this story's Notes).
- [ ] The DEV build flavor **bakes** `DEV_QA_PERSONAS_PASSWORD` (from a gradle property / env var / CI secret) into `BuildConfig`, so `BuildVariant.isPersonaPickerAvailable` is `true` on a stock dev build and the persona picker renders without a manual per-build `-P`.
- [ ] `androidSendMessageTo(name, target)` opens the conversation with the named persona and sends the given text; the message persists (asserted via the real datastore, per j11:34).
- [ ] `androidOpenConversationWith(name, target)` navigates to the existing 1:1 conversation thread with the named persona.
- [ ] A new appeal action types the appeal text and taps `suspension_submitAppealButton`, satisfying j11:137-139 on the real device.
- [ ] After the acknowledge-robustness fix, the j11 acknowledge scenario (j11:79) is **green on the real device**; the `@known-failure-SHY-0097` tag is removed from j11:78 **and** the now-stale comment block above it (j11:73-77 — it still blames the old client-Firestore-write root cause that SHY-0097 already fixed) is removed/corrected so the feature file does not mislead.

### Error paths
- [ ] Each new driver action throws a **specific, actionable** error (naming the failed tag + observed screen) when its target element never appears within budget — never a silent `false` that lets the journey proceed on a stale screen (consistent with SHY-0096's `androidSignOut` error contract).
- [ ] `_advancePastLaunchGates` surfaces a clear error if a gate it expected to clear is still present after its retries (e.g. the OS permission dialog couldn't be dismissed/granted), rather than hanging.
- [ ] The acknowledge dismiss-and-retry gives up loudly after a bounded number of re-dumps (it must not loop forever if the button is genuinely absent because the gate didn't clear).

### Edge cases
- [ ] `_advancePastLaunchGates` is **idempotent / order-tolerant**: gates may appear in any order or be absent (a re-run dev install may have already accepted legal / granted notifications) — each gate is skipped cleanly when not present.
- [ ] The OS notification-permission dialog (a **system** dialog, not an app Compose surface) is handled via the platform-correct path (e.g. `adb` permission grant or the system-dialog tap), not a testTag lookup that can't see system UI.
- [ ] `androidSendMessageTo` POSIX-escapes free-form user text before it reaches `adb` (per the `adb() shell-escape` driver rule) so a body with quotes/spaces/`$` is sent verbatim.
- [ ] Acknowledge robustness re-dumps and re-locates the button after dismissing a covering daily-reward popup, then taps the freshly-resolved node (not a stale coordinate).

### Performance
- [ ] The full launch-gate advance completes within a bounded budget (≤ existing per-gate settle × number of gates) or fails loudly; it must not add an unbounded wait to every journey start.
- [ ] Each new driver action adds at most one bounded settle per tap (≤ the driver's existing per-tap budget).

### Security
- [ ] `DEV_QA_PERSONAS_PASSWORD` is **never** baked into the PROD flavor (PROD stays empty → picker off) and is never logged by the build or the driver; it is sourced from a secret/env, not committed in plaintext.
- [ ] No persona passwords, tokens, or PII are logged by the new driver actions (consistent with the driver's existing redaction).

### UX
- [ ] N/A — internal QA-apparatus + a build-config flag; no end-user-facing surface. (The dev persona picker is gated to non-prod and is a developer/QA affordance, not a shipped UX; PROD behaviour is unchanged.)

### i18n
- [ ] Driver navigation anchors on **testTags**, not visible text, wherever a tag exists, so it is locale-independent. Where a system dialog (notification permission) forces text/!tag handling, the handling is locale-robust (platform permission API, not a localized button label). No new user-facing strings are introduced.

### Observability
- [ ] Each launch-gate decision and each new driver action logs one concise diagnostic line to stderr (the runner surfaces it), so a failed real-device run is traceable to the exact gate/step that broke.

## BDD Scenarios

**Scenario: fresh dev install advances past all launch gates to the picker**
- **Given** a freshly-installed dev build on the real OnePlus CPH2653 (legal not yet accepted, notifications not yet granted)
- **When** `_advancePastLaunchGates('dev')` runs
- **Then** it clears the legal-accept, OS notification-permission, daily-reward, and splash gates in turn
- **And** resolves with `persona_picker_open` (or a `main_*` tag) visible

**Scenario: stock dev build exposes the persona picker (password baked)**
- **Given** a dev build assembled with `DEV_QA_PERSONAS_PASSWORD` provided via gradle property/env
- **When** `BuildVariant.isPersonaPickerAvailable` is evaluated
- **Then** it returns `true` and the sign-in screen renders the persona picker
- **And** the same evaluation on a PROD build returns `false`

**Scenario: send a message to another persona on the real device (happy path)**
- **Given** Raul [P-08] is signed in on Android with a pre-existing conversation with Nora
- **When** `androidSendMessageTo('Nora', 'dev')` sends "offensive content #1"
- **Then** within 3000ms the datastore has a `messages` entry `{senderId: 50000050, body: "offensive content #1"}`

**Scenario: acknowledge is robust to a covering daily-reward popup (retires the known-failure)**
- **Given** Raul is on the warning screen and a daily-reward popup transiently covers `warning_acknowledgeButton`
- **When** the j11 acknowledge step runs
- **Then** the driver dismisses the popup, re-dumps, re-locates and taps `warning_acknowledgeButton`
- **And** within 3000ms `users/50000050.hasActiveWarning` is `false` and `main_roomsTab` shows — with `@known-failure-SHY-0097` removed

**Scenario: a new driver action fails loudly, never silently (error path)**
- **Given** the conversation thread never renders (wrong screen / stale session)
- **When** `androidOpenConversationWith('Nora', 'dev')` exhausts its budget
- **Then** it throws an error naming the missing tag + the observed screen
- **And** the runner marks the scenario failed (no silent pass on a stale screen)

**Scenario: launch-gate advance is order-tolerant / idempotent (edge case)**
- **Given** a dev install that has already accepted legal and granted notifications
- **When** `_advancePastLaunchGates('dev')` runs
- **Then** it skips the already-cleared gates without error and still reaches the picker

**Scenario: free-form message text is shell-escaped (edge case / security-adjacent)**
- **Given** a message body containing quotes, spaces, and a `$` (`say "hi" $NOW`)
- **When** `androidSendMessageTo` sends it
- **Then** the persisted `messages.body` equals the input verbatim (no shell interpolation / truncation)

**Scenario: the dev password is never baked into prod (security)**
- **Given** a PROD-flavor build
- **When** `BuildConfig` is inspected
- **Then** the dev personas password field is empty and `isPersonaPickerAvailable` is `false`

## Test Plan

Touches `.js` driver/runner tooling + Kotlin build config + a `.feature` file → **full Pre-Merge Testing Protocol** (CLAUDE.md). Real backends/devices only (No Stubs / Real Only). No new `child_process`/`execSync` mock is added — per EPIC-0003's operating definition, driver *behaviour* is proven on the real device + real local stack, and driver *pure logic* (gate-state classification, escape handling, retry budget) is unit-tested with **real-captured XML fixtures** + `jest.fn` doubles confined to unit tests.

**Red (before — captured on the real OnePlus CPH2653 against the dev/local stack):**
- `journey-tests/j11-harassment-moderation-cycle.feature` `@android-physical` scenarios fail/skip on the real device: a fresh dev install never clears the legal/notification/daily-reward gates (`_advancePastLaunchGates` returns/hangs short of the picker); the persona picker is absent on a stock dev build; the acknowledge scenario (line 79) flakes; `androidSendMessageTo`/`androidOpenConversationWith`/appeal actions have no real driver implementation.
- `journey-tests/j11-harassment-moderation-cycle.feature:78` carries `@known-failure-SHY-0097` (the RED marker this story removes).

**Green (after — per framework):**
- **Driver unit (Jest, real-captured fixtures)** — `express-api/tests/scripts/drivers/android-adb-driver.test.js`: new cases for `androidSendMessageTo` / `androidOpenConversationWith` / the appeal action (happy + the 4 input-rejection cases + shell-escape of user text + throw-on-missing-tag), and for `_advancePastLaunchGates` clearing the dev fresh-install gate chain (legal → notif-permission → daily-reward → splash) from real-captured dump fixtures, including the order-tolerant/idempotent skip path.
- **Runner routing (Jest)** — `express-api/tests/scripts/device-journey-runner.test.js` (+ the relevant `manual-qa-runner-*.test.js`): the j11 message/conversation/appeal + suspension Givens route to the new driver methods on the Android branch.
- **Kotlin unit (commonTest)** — `shared/src/commonTest/kotlin/com/shyden/shytalk/core/BuildVariantTest.kt`: `isPersonaPickerAvailable` is `true` for a dev build whose baked `localDevPersonasPassword` is non-empty and `false` for prod/empty.
- **iOS shared compile** — `./gradlew :shared:compileKotlinIosArm64` stays green after the `BuildVariant`/BuildConfig wiring.
- **Lint/format** — `eslint --max-warnings=0` + `prettier --check` (express-api) + `detekt` + `ktlint` clean.
- **THE REAL PROOF (device gauntlet)** — `express-api/scripts/manual-qa-runner.js` runs j11's `@android-physical` scenarios **green on the real OnePlus CPH2653** against the real dev/local backend (real app UI → real Express → real Firestore), with `@known-failure-SHY-0097` removed. iOS-Sim/web-admin handoff steps are driven by their existing drivers (see Out of Scope).

## Out of Scope

- **Full real-iPhone coverage of j11's `@ios-sim` steps** (Nora's report/notice/block paths) and the `@browser-chromium` admin steps — those are driven by their existing drivers; extending native-iOS journey coverage is **SHY-0095** (EPIC-0003 Phase 6). SHY-0101 owns the **Android** apparatus + the cross-platform handoffs the Android scenarios depend on.
- The broader EPIC-0003 mock/fake big-bang migration (Phases 2–6) — SHY-0101 is Phase-0/1 apparatus completion only; it adds **no** new mocks and migrates none.
- Any change to the moderation product behaviour (warn/suspend/appeal logic) — that shipped in SHY-0097/SHY-0098; this is test apparatus only.
- Re-architecting `manual-qa-runner.js` or the driver-interface contract (sound + complete; SHY-0101 only fills method gaps).

## Dependencies

- **SHY-0096** (Done/merged) — `androidPersonaSignIn` / `androidSignOut` / `androidKillAndRelaunch` / `_dismissDailyRewardIfPresent` / `_advancePastLaunchGates` baseline that SHY-0101 extends.
- **SHY-0097** (Done/merged) — the server-authorized acknowledge endpoint that makes the flag-flip work; SHY-0101 makes the acknowledge *scenario* green and removes its `@known-failure` tag.
- The real local/dev stack ([[reference-local-journey-runner-setup]]) + real OnePlus CPH2653 (operator-gated gauntlet) + seeded personas (P-08 Raul / P-09 Nora / P-12 Greta) via the admin-SDK seed.
- `DEV_QA_PERSONAS_PASSWORD` provisioned as a CI/secret value for the dev build bake (operator-held; mirrors the existing dev-personas secret).

## Risks & Mitigations

- **Risk:** the OS notification-permission dialog is system UI that Compose testTags can't see, so a tag-based tap silently no-ops. **Mitigation:** handle it via the platform path (adb permission grant or a system-dialog text tap), unit-test the gate-classification from a real-captured dump, and assert loud failure if it can't be cleared.
- **Risk:** baking `DEV_QA_PERSONAS_PASSWORD` leaks the secret into an artifact or the prod build. **Mitigation:** source from env/secret (never committed), gate the bake to the dev flavor only, keep prod empty, and add a `BuildVariantTest` assertion that prod's picker stays off.
- **Risk:** acknowledge dismiss-and-retry masks a genuine regression (button truly absent because the gate didn't clear). **Mitigation:** bound the retries and fail loudly with the observed screen; keep the SHY-0097 behaviour-level flag-flip assertion unchanged.
- **Risk:** j11 is large; one PR balloons. **Mitigation:** deliver in vertical slices if needed (launch-gates → dev bake → acknowledge robustness → message/conversation → appeal), each keeping the suite green; the `@known-failure-SHY-0097` tag is removed only in the slice that proves the acknowledge scenario green on-device.

## Definition of Done

- All AC checkboxes verified; the 8 BDD scenarios pass at the appropriate layer.
- New/changed driver methods unit-tested (real-captured fixtures; `jest.fn` confined to unit tests; **zero** new `execSync` mocks) + runner-routing tested; `BuildVariantTest` covers the dev/prod picker gate.
- `journey-tests/j11-harassment-moderation-cycle.feature` `@android-physical` scenarios run **green on the real OnePlus CPH2653** via `manual-qa-runner.js`; `@known-failure-SHY-0097` removed from line 78.
- Full local gauntlet green (Jest driver+runner suites, `:shared:jvmTest`, `:shared:compileKotlinIosArm64`, detekt, ktlint, eslint, prettier) → `code-reviewer` + `security-reviewer` 100% clean → push → CI green → DEV gauntlet on real Android → judgment-merge.
- `released_in:` set on the release that ships it; EPIC-0003 `child_shys` already includes SHY-0101.

## Notes (running log)

- 2026-06-15 — Filed fully-refined ([[feedback-no-skeleton-stories-fully-refined]]) as the EPIC-0003 Phase-0 **completion** story, banking the journey-apparatus gaps surfaced (not caused) by SHY-0096/SHY-0097's real-device gauntlet (see SHY-0096 Notes 2026-06-14 "two new driver primitives" + SHY-0097 Notes 2026-06-14 `I4` / 2026-06-14 acknowledge-scenario flake). Real-grounded against the live tree: existing methods `_advancePastLaunchGates` / `_dismissDailyRewardIfPresent` / `androidKillAndRelaunch` (`express-api/scripts/drivers/android-adb-driver.js`), the runner matchers `androidSendMessageTo` (`manual-qa-runner.js:3831`) + `androidOpenConversationWith` (`:8550`) that lack real Android driver methods, `BuildVariant.isPersonaPickerAvailable` (`shared/src/commonMain/kotlin/com/shyden/shytalk/core/BuildVariant.kt`, tested in `BuildVariantTest.kt`), and `journey-tests/j11-harassment-moderation-cycle.feature` (`@known-failure-SHY-0097` at line 78). Linked into EPIC-0003 `child_shys`. Awaiting architect approval before TDD pickup.
- 2026-06-15 — **Pre-file `code-reviewer` clean (docs PR).** 0 Critical, 3 Important — ALL fixed in this PR: (I1) corrected the `manual-qa-runner.js` matcher line reference (`:3824`→`:3831`); (I2) named the launch-gate method accurately as the internal `driver._advancePastLaunchGates` (was implied-public) + added a Happy-path AC for the public-surface promote-or-keep decision; (I3) added an AC to remove/correct the now-stale `@known-failure-SHY-0097` comment block (j11:73-77) alongside the tag, since SHY-0097 already fixed the client-write root cause that comment still describes. Both frontmatter validators (`--scan`) re-run green; structure intact (10 `##` / 8 `###` AC / 8 Scenarios).

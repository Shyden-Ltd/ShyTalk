---
id: SHY-0007
status: Draft
owner: claude
created: 2026-06-07
priority: P1
effort: S
type: feature
roadmap_ids: [G007, G008]
pr:
mvp: true
---

# SHY-0007: gacha.feature + age_verification.feature (BDD coverage)

## User Story

As the ShyTalk operator, I want **two new BDD feature files — `gacha.feature` and `age_verification.feature` — covering the lucky-spin gacha economy + animation flow AND the age-verification submit flow with all observable states**, so that the regulatory-sensitive age gate and the economy-sensitive gacha mechanics have end-to-end behavioural contracts verifiable on a real device.

## Why

Two related but distinct flows lack BDD coverage:

1. **Gacha**: lucky-spin mechanic with coin cost + age gate + randomised outcome + animation + reward delivery. Currently zero BDD scenarios.
2. **Age verification**: under-18 user enters DOB + submits verification → success redirect OR error display. Currently unit-tested (`AgeVerificationSubmitViewModel`) but zero BDD scenarios.

Both are user-flow surfaces that benefit from end-to-end coverage because they integrate multiple subsystems (economy + animation + age-gate + navigation).

Roadmap rows G007 + G008 (lines 32-33):

> G007: Sev: 🔴 Critical. Journey — no gacha/lucky-spin .feature. Location: `app/src/androidTest/assets/features/`. Gap: Gacha flow (economy + age gate + animation) has zero BDD coverage. Fix: Create `gacha.feature` with: visible, requires coins, deducts coins, age-gate <18, animation completes, summary popup. Scope: S.
>
> G008: Sev: 🔴 Critical. Journey — no age-verification submit .feature. Location: `app/src/androidTest/assets/features/`. Gap: Submit flow has unit tests but no BDD scenario. Fix: Create `age_verification.feature` with: entry from gate, form visible, submit loading, success redirect, error display. Scope: S.

P1 Tier-3 coverage. Sequential dependency on SHY-0010 (GachaVM tests) for the unit-level substrate and SHY-0024 (NavGraph migration) for the AgeVerificationSubmit route to be reachable on Android.

## Acceptance Criteria

### Happy path

**gacha.feature**:

- [ ] File `app/src/androidTest/assets/features/gacha.feature` created with ≥8 scenarios:
  - Gacha card visible on Home for authenticated user.
  - Tap Gacha card → Gacha screen with spin button + cost.
  - Spin with sufficient coins → balance deducted; animation plays; reward revealed.
  - Spin with insufficient coins → top-up prompt; no charge.
  - Spin as under-18 user → AgeRestrictionDialog → redirect to AgeVerificationSubmit (depends on SHY-0024).
  - Spin animation completes within 5 seconds.
  - Summary popup shows the reward with category icon.
  - Dismiss summary returns to Gacha screen for another spin.

**age_verification.feature**:

- [ ] File `app/src/androidTest/assets/features/age_verification.feature` created with ≥7 scenarios:
  - Entry from gacha gate — user lands on submit screen with pre-filled context.
  - Form visible with required fields (DOB, ID upload if required).
  - Submit happy path → loading state → success redirect to Home (with verified-badge update).
  - Submit failure (network) → error message + retry CTA.
  - Submit failure (invalid DOB) → field-level validation error.
  - Cancel returns to caller screen (or Home).
  - Re-entry after partial fill preserves form state OR clears (verify which intended).

- [ ] All scenarios use existing step-defs in `app/src/androidTest/java/com/shyden/shytalk/steps/`; new steps only where existing don't cover.
- [ ] `./gradlew connectedDevDebugAndroidTest --tests "*Gacha*" --tests "*AgeVerification*"` passes on dev device against local stack.
- [ ] Manual run via `manual-qa-runner.js --feature gacha,age_verification --device android` against dev passes.
- [ ] Allure attachments captured per scenario.

### Error paths

- [ ] **Gacha**: spin API returns 500 → animation aborts; user sees retry CTA; balance not deducted (or refund attempted).
- [ ] **Gacha**: spin API returns 403 (server-side age gate) → same redirect to AgeVerificationSubmit as client-side; UX matches.
- [ ] **Gacha**: animation handler throws → summary still appears; user not stuck on broken animation.
- [ ] **Age verification**: submit returns 422 (server-side DOB validation failure, e.g. user is over 18 contradicting form input) → clear error message + retry path.
- [ ] **Age verification**: submit returns 500 → retry CTA; user data not lost.
- [ ] **Age verification**: ID upload fails (if required) → upload retry; partial submission state preserved.

### Edge cases

- [ ] **Gacha**: rapid double-tap on spin → debounced; exactly one API call.
- [ ] **Gacha**: spin during active room session → spin works; doesn't interrupt voice.
- [ ] **Gacha**: locale change mid-animation → text re-renders; animation continues.
- [ ] **Age verification**: DOB at exact 18.00 boundary → server-side decides (test both sides of boundary).
- [ ] **Age verification**: timezone difference (user in UTC+12 vs server in UTC) → DOB interpretation consistent.
- [ ] **Age verification**: existing verified user navigates here directly → screen shows "already verified" state OR redirects to Home.

### Performance

- [ ] Each scenario completes within 60s.
- [ ] Full suite (~15 scenarios) within 15 minutes.
- [ ] Gacha animation runs at 60fps (verified via existing animation IdlingResource).

### Security

- [ ] **Gacha**: spin request-ID cryptographically random (tested via SHY-0010); BDD verifies behaviour, not implementation.
- [ ] **Age verification**: DOB never logged in plaintext; Allure screenshots redact DOB field.
- [ ] **Age verification**: ID upload (if scenario covers) uses secure transport; never cached locally beyond session.
- [ ] Test personas only (`local-claude-001..NNN` with documented birth dates); never real PII.

### UX

- [ ] Loading states asserted in scenarios (no "nothing happens" gaps).
- [ ] Error states have actionable recovery.
- [ ] Animation choreography asserted via Allure screenshots at key frames.
- [ ] Age-gate redirect is non-bypassable from UX (no back-button escape mid-flow).

### i18n

- [ ] Scenarios run against `en-US` default; cross-locale verification deferred to separate workflow.
- [ ] User-facing strings (gacha CTA, age-verification labels, error messages) resolve in all 20 locales.

### Observability

- [ ] Allure attachments per scenario.
- [ ] Job summary lists pass/fail per .feature.
- [ ] Failed scenarios upload device logcat + screen recording.
- [ ] Test isolation per [[feedback-test-isolation-no-leaks]].

## BDD Scenarios

**Scenario: Gacha — sufficient coins, successful spin**

- **Given** test persona "local-claude-018" (age 25) signed in with 500 coins
- **When** they navigate to Gacha
- **And** tap "Spin"
- **Then** balance deducts to 400 within 2s
- **And** the spin animation plays
- **And** within 5s the reward summary appears
- **And** the reward is added to backpack

**Scenario: Gacha — insufficient coins**

- **Given** persona "local-claude-019" (age 25) with 50 coins
- **And** spin cost is 100 coins
- **When** they tap "Spin"
- **Then** the spin does NOT initiate
- **And** the top-up prompt appears
- **And** balance remains 50

**Scenario: Gacha — under-18 user redirected to age verification**

- **Given** persona "local-claude-020" (age 16) signed in
- **When** they navigate to Gacha and tap "Spin"
- **Then** the AgeRestrictionDialog appears
- **When** they tap "Verify my age"
- **Then** they land on the AgeVerificationSubmit screen
- **And** no coins are deducted

**Scenario: Age verification — submit happy path**

- **Given** persona on the AgeVerificationSubmit screen
- **When** they enter DOB indicating age 22
- **And** tap "Submit"
- **Then** the screen shows a loading indicator
- **And** within 5s the success state appears
- **And** they are redirected to Home
- **And** their profile shows "Age verified" badge

**Scenario: Age verification — server-side rejection (DOB contradicts existing data)**

- **Given** persona on the submit screen
- **And** the server has existing DOB data indicating age 15
- **When** they submit DOB indicating age 22
- **Then** the server returns 422
- **And** the form shows a clear error: "Submitted age contradicts our records"
- **And** retry CTA available

**Scenario: Gacha — animation glitch doesn't break flow**

- **Given** the animation handler throws mid-spin (simulated)
- **When** the spin completes server-side
- **Then** the summary popup still appears with the reward
- **And** logcat shows the animation exception
- **And** Crashlytics non-fatal logged

## Test Plan (TDD)

### Red

1. Create `gacha.feature` and `age_verification.feature` with the scenarios above.
2. Identify any missing step-defs; stub them.
3. Run `./gradlew connectedDevDebugAndroidTest --tests "*Gacha*"` → RED on scenarios that need new step-defs or surface untested code.

### Green

1. Implement missing step-defs.
2. Fix any production bugs surfaced.
3. Re-run until all scenarios green on dev device.
4. Manual run via `manual-qa-runner.js`.

## Out of Scope

- **Gacha mechanic redesign** — only BDD coverage of existing.
- **Age verification ID-upload flow** — covered only if it's part of the current flow; otherwise out of scope.
- **iOS BDD coverage** — Android-only here.
- **Server-side age-gate logic** — backend test scope.

## Dependencies

- **SHY-0001** + **SHY-0032** — process.
- **SHY-0010** — GachaViewModel tests (substrate).
- **SHY-0024** — NavGraph migration (AgeVerificationSubmit becomes Android-routable after).
- **SHY-0013** — AnimationQueue (gacha uses it).
- Existing test personas + step-def framework.

## Risks & Mitigations

- **Risk:** Without SHY-0024 merged, age-gate redirect on Android doesn't work; gacha under-18 scenario fails for non-test-related reasons. **Mitigation:** sequence SHY-0024 before this SHY; document the dependency in PR description; if scheduled before SHY-0024, mark the affected scenario `@SkipOnAndroidPreNavGraphMigration` and rerun post-SHY-0024-merge.
- **Risk:** Animation timing flaky on slower CI hardware. **Mitigation:** use IdlingResource; not arbitrary sleeps.
- **Risk:** Test personas missing the required DOB values. **Mitigation:** extend `provision-test-personas.js` with personas of specific ages (16, 17.99, 18, 25).

## Definition of Done

- [ ] 2 .feature files exist; ≥15 scenarios pass.
- [ ] Manual run + dev smoke pass.
- [ ] Reviewer ZERO findings.
- [ ] Per-type Done gate (`feature` → auto-merge + dev smoke).
- [ ] PR merged.
- [ ] `status: Done`; `pr:` populated; smoke outcome in Notes.

## Notes (running log)

- 2026-06-07 ~21:18 BST — Refined under SHY-0032. Tier 3 coverage; sequenced after SHY-0024.
- 2026-06-07 — Skeleton from `convert-roadmap-to-stories.sh` PR-bundle `PR-C1` (G007, G008).

---
id: SHY-0043
status: Draft
owner: claude
created: 2026-06-08
priority: P0
effort: S
type: feature
roadmap_ids: [G006]
pr:
---

# SHY-0043: Add `push_permission.feature` BDD coverage for PR #1010's denial flow

## User Story

As the ShyTalk QA / operator, I want **a BDD `push_permission.feature` file with 4 scenarios covering the post-PR-#1010 push-permission denial UX**, so that the non-dismissible banner, deep-link-to-settings tap, granted-state hiding, and cold-start persistence all have CI-runnable assertions instead of relying on manual smoke tests.

## Why

PR #1010 shipped the push-permission denial UX (`PushPermissionDeniedBanner` composable + `PushPermissionStore` state machine + `AndroidPushPermissionBridge` + `IosPushBridge`). Unit tests for the store + bridges are covered by [[SHY-0006]] (G005+G013+G029). What's still missing is the END-TO-END BDD scenario coverage — i.e. the `.feature` file that drives the journey-runner / androidTest BDD suite through the actual user flow.

Roadmap row (line 31, 2026-06-05): `G006 | 🔴 Critical | Journey — no push permission denial .feature | ... Create push_permission.feature with 4 scenarios (denied shows banner, tap → settings, granted hides, persists cold-start)`.

Without the feature file, regressions to the banner UI or the settings deep-link wouldn't be caught by CI — only by a human noticing on dev.

## Acceptance Criteria

### Happy path

- [ ] New file `app/src/androidTest/assets/features/push_permission.feature` exists with the standard Gherkin header (`Feature: Push permission denial UX`) + 4 scenarios listed below.
- [ ] **Scenario 1** — Denied state shows banner: Given app launches with notifications-DENIED, When HomeScreen renders, Then `PushPermissionDeniedBanner` is visible.
- [ ] **Scenario 2** — Tap → opens system settings: Given the banner is visible, When the user taps the "Open settings" action, Then the system Notification Settings activity is launched (verifiable via Espresso intents).
- [ ] **Scenario 3** — Granted hides banner: Given the user returns from settings with notifications-AUTHORIZED, When HomeScreen re-renders, Then the banner is NOT visible.
- [ ] **Scenario 4** — Cold-start persistence: Given notifications are DENIED at app close, When the app is force-stopped + relaunched, Then the banner is visible immediately on first HomeScreen render (no flash, no race).
- [ ] Each scenario uses existing step definitions where possible (CommonSteps, SystemScreenSteps, PushPermissionSteps); new steps added to PushPermissionSteps if needed.
- [ ] The feature file is picked up by the BDD runner (verified by running `./gradlew connectedDevDebugAndroidTest -Pcucumber.filter.tags='@push-permission'`).

### Error paths

- [ ] **Scenario 2's intent assertion fails on emulator** (some emulators block system intent launches): mark scenario `@flaky-emulator` and verify on physical device per [[feedback-real-android-device-preferred]].
- [ ] **PushPermissionStore takes time to settle on cold-start** (race between Composable init + store init): scenario 4 uses an explicit `waitFor` not a hard sleep.
- [ ] **System notification settings is restricted on test users**: scenario 2 uses Espresso intent intercept (`Intents.intended(hasAction(Settings.ACTION_APP_NOTIFICATION_SETTINGS))`) instead of actually launching settings.

### Edge cases

- [ ] **iOS parity** — the corresponding XCUITest BDD coverage for the iOS banner: file a separate companion SHY (out of scope here per the Android-feature-file scope).
- [ ] **Non-dismissible behaviour** — scenario 1 includes an explicit assertion that the banner CANNOT be swiped/dismissed (verifies the non-dismissible design).
- [ ] **Banner localised strings** — verify the banner uses the `notifications_disabled_banner_title` + `_action` keys, not hardcoded text.
- [ ] **Foreground vs background state changes** — scenario 3 covers AUTHORIZED-on-return; out-of-scope is the case where permission is revoked WHILE the app is foregrounded (no clean signal on Android API < 33).

### Performance

- [ ] Feature execution time: <30s per scenario on the emulator (BDD scenarios should be fast; if slower, move to a heavier integration suite).

### Security

- [ ] No new permissions or system surfaces introduced — uses the same APIs PR #1010 already gated.
- [ ] Espresso intent intercept does NOT leak the test app's notification token into logs.

### UX

- [ ] Scenarios validate the operator's "non-dismissible" design intent — caught early if a regression makes the banner dismissible.

### i18n

- [ ] Scenario 1 uses `R.string.notifications_disabled_banner_title` + `R.string.notifications_disabled_banner_action` resource lookups, not hardcoded English strings. This makes the feature locale-agnostic.

### Observability

- [ ] On scenario failure, Allure screenshot fires via the existing `ScreenshotRule`.
- [ ] Scenario tags include `@push-permission` so the BDD runner can filter to just this suite.
- [ ] Cucumber report references the feature file path so CI links to source.

## BDD Scenarios

This SHY's deliverable IS a `.feature` file containing 4 Gherkin scenarios. The four scenarios below mirror exactly what will be authored in the new `push_permission.feature` file.

**Scenario: Denied notifications show the banner**

- **Given** the app is launched with notifications permission DENIED
- **When** I navigate to the home screen
- **Then** I see the push permission denied banner
- **And** the banner cannot be dismissed by swipe

**Scenario: Tapping the banner opens system settings**

- **Given** the push permission denied banner is visible
- **When** I tap the "Open settings" action
- **Then** the system notification settings intent fires (verified via Espresso intent intercept)

**Scenario: Granting permission hides the banner**

- **Given** the app was previously showing the banner with notifications DENIED
- **When** notifications permission is granted (user returns from system settings with AUTHORIZED)
- **Then** the push permission denied banner is hidden on the next HomeScreen render

**Scenario: Banner persists across cold start**

- **Given** notifications permission is DENIED at app close
- **When** the app is force-stopped via `adb shell am force-stop`
- **And** the app is relaunched
- **Then** I see the push permission denied banner on first HomeScreen render
- **And** there is no visible state-flicker (the store-init race is properly awaited)

## Test Plan

**Red:**
- `ls app/src/androidTest/assets/features/push_permission.feature` — must exist (currently doesn't).
- `./gradlew connectedDevDebugAndroidTest -Pcucumber.filter.tags='@push-permission'` — must include 4 scenarios + all pass.

**Green:**
- Author the feature file with the 4 scenarios per the spec above.
- Extend PushPermissionSteps with `I see the push permission denied banner` + `the banner cannot be dismissed by swipe` + `the system notification settings intent fires` + `the push permission denied banner is hidden` + `the app is force-stopped` + `the app is relaunched` + `I am on the home screen` + `I see the push permission denied banner without a visible state-flicker`.
- Wire Espresso intents intercept for scenario 2.
- Verify on emulator + physical device per [[feedback-real-android-device-preferred]].

**Coverage gate:** 4 scenarios pass via BDD runner.

## Out of Scope

- iOS XCUITest parity — file follow-up SHY (e.g. `SHY-NN-add-ios-push-permission-xcuitest`).
- Web (Playwright) parity — the web app doesn't have a banner equivalent.
- Re-design of the banner UI — PR #1010's design is the contract.
- Coverage for notifications revoked WHILE foregrounded — Android API limitation.

## Dependencies

- [[SHY-0006]] (PushPermissionDeniedBanner + HomeScreen + HomeViewModel push tests — Draft) — provides the unit-test scaffolding; not blocking for this BDD work but should ideally ship first so the underlying components are well-tested.
- Existing `PushPermissionSteps` step-definitions file in `app/src/androidTest/java/com/shyden/shytalk/steps/`.
- Cucumber-Android BDD runner config in the existing androidTest setup.
- `ScreenshotRule` for Allure failure capture.

## Risks & Mitigations

- **Risk: scenario 2 (intent launch) flaky on emulator.** Mitigation: tag `@flaky-emulator` if needed; rely on physical-device cell for canonical pass.
- **Risk: PushPermissionStore state is async; scenarios race the UI.** Mitigation: use `Espresso.onIdle()` + the store's existing `awaitInitialized()` signal.
- **Risk: cold-start scenario fails because `installLocalDebug` resets state.** Mitigation: scenario 4 explicitly force-stops via `adb shell am force-stop` then relaunches; doesn't reinstall.
- **Risk: BDD runner filter `@push-permission` collides with another tag.** Mitigation: verify uniqueness via `grep -rn '@push-permission' app/src/androidTest/`.

## Definition of Done

- [ ] `push_permission.feature` file exists with 4 scenarios.
- [ ] Required step definitions added to PushPermissionSteps.
- [ ] `./gradlew connectedDevDebugAndroidTest -Pcucumber.filter.tags='@push-permission'` passes (4/4) on both emulator + physical device.
- [ ] Allure report includes the new scenarios.
- [ ] Reviewer ZERO findings.
- [ ] `status: Done`; `pr:` populated.

## Notes (running log)

- 2026-06-08 ~12:58 BST — Spec created by SHY-0036 batch fill. Source: zero-gap roadmap line 31 (G006). Reserved ID SHY-0043.

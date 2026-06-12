---
id: SHY-0043
status: Draft
owner: claude
created: 2026-06-08
priority: P0
effort: XS
type: feature
roadmap_ids: [G006]
pr:
mvp: true
---

# SHY-0043: Add the missing cold-start-persistence scenario to `push_permission.feature`

## User Story

As the ShyTalk QA / operator, I want **the one push-permission scenario still missing from `push_permission.feature` — banner persistence across a cold start (force-stop + relaunch) — authored and passing on the real Android device**, so that a regression where the denied-banner fails to render (or flickers) on first HomeScreen paint after a process restart is caught by CI, not by a human noticing on dev.

## Why

PR #1010 shipped the push-permission denial UX (`PushPermissionDeniedBanner` + `PushPermissionStore` + `AndroidPushPermissionBridge` + `IosPushBridge`). Roadmap G006 (line 31, 2026-06-05) called for a `push_permission.feature` with 4 scenarios: *denied shows banner*, *tap → settings*, *granted hides*, *persists cold-start*.

**Pickup-fitness re-validation 2026-06-12 (verified against the live file, not assumed):** `app/src/androidTest/assets/features/push_permission.feature` already exists with **12 scenarios** shipped by PR #1015 + integration coverage by PR #1024. Direct inspection (`grep -nE '^\s*Scenario'`) confirms **3 of the original 4 are already covered**:

| Original G006 scenario | Status in the live file |
| --- | --- |
| Denied → banner visible | ✅ "Banner visible when push permission is DENIED" + "Tiramisu+ post-denial → banner visible" |
| Tap → opens system settings | ✅ "Tapping the banner invokes the system settings deeplink" |
| Granted hides banner | ✅ "Banner hidden when push permission is AUTHORIZED" + "Banner disappears when user grants permission via Settings (late grant)" |
| **Persists cold-start** | ❌ **ABSENT** — no `force-stop` / `relaunch` / `cold` scenario in the file, no supporting step defs |

(The live file also adds non-dismissible + late-revoke + pre/post-Tiramisu API-gating that the original G006 row never anticipated.)

So this story is **rescoped to the single genuinely-missing scenario**: cold-start persistence. Without it, a regression where `PushPermissionStore` loses its denied state across a process restart — or where the banner flickers because the Composable paints before the store re-initialises — would ship silently.

## Acceptance Criteria

### Happy path

- [ ] One new scenario `Banner persists across cold start` is appended to `app/src/androidTest/assets/features/push_permission.feature`, tagged `@push-permission`, matching the file's existing Gherkin style.
- [ ] The scenario: **Given** notifications are DENIED at app close, **When** the app is force-stopped (`adb shell am force-stop`) and relaunched, **Then** `PushPermissionDeniedBanner` is visible on the FIRST HomeScreen render **And** there is no visible state-flicker (the store-init race is explicitly awaited, not slept).
- [ ] Any new step phrases (`the app is force-stopped`, `the app is relaunched`, `the banner is visible without a state-flicker`) are added to `PushPermissionSteps`, reusing existing steps wherever they already exist.
- [ ] `./gradlew connectedDevDebugAndroidTest -Pcucumber.filter.tags='@push-permission'` runs the now-13 scenarios and all pass **on the real Android device**.

### Error paths

- [ ] **Store hasn't settled on cold-start** (race between Composable init + store init): the scenario uses the store's existing `awaitInitialized()` signal / `Espresso.onIdle()`, NOT a hard `Thread.sleep` — a sleep-based pass would mask the very race this scenario exists to catch.
- [ ] **`force-stop` doesn't fully kill the process** (background service keeps it warm): the scenario asserts a genuine cold start by checking the process was recreated (e.g. a fresh `Application.onCreate`), not just a resumed activity.
- [ ] **Relaunch reinstalls and wipes state** (false negative): the scenario force-stops + relaunches the SAME install via `adb shell am start`, it does NOT `installLocalDebug` (which would reset the denied state).

### Edge cases

- [ ] **No-flicker assertion is observable**: the banner must be present on the *first* `HomeScreen` composition after relaunch — assert against the first render, not a settled steady state, so a one-frame flash-to-empty regression fails the scenario.
- [ ] **Localised strings**: the scenario asserts the banner via `R.string.notifications_disabled_banner_title` / `_action` resource lookups (locale-agnostic), not hardcoded English.
- [ ] **Tag uniqueness**: `@push-permission` does not collide with another suite — re-confirm via `grep -rn '@push-permission' app/src/androidTest/` (the existing 12 scenarios already use it; the new one joins them).

### Performance

- [ ] Scenario completes in <30s on the real device including the force-stop + relaunch round-trip (cold start is inherently slower than the warm scenarios; budget for the process recreation but flag if it exceeds 30s).

### Security

- [ ] No new permissions or system surfaces — uses the same APIs PR #1010 already gated.
- [ ] The force-stop/relaunch adb round-trip does not leak the test app's notification token into logs/Allure output.

### UX

- [ ] The scenario validates the operator's intent that the denied reminder is **durable** — a user who denied notifications and reopens the app days later still sees the path back to Settings, with no jarring flash.

### i18n

- [ ] Banner asserted via string resources (see Edge cases) → the scenario is locale-agnostic and would pass under any of the 20 locales.

### Observability

- [ ] On scenario failure, the existing `ScreenshotRule` fires an Allure screenshot.
- [ ] The new scenario carries `@push-permission` so the BDD runner filter picks it up alongside the existing suite.
- [ ] The Cucumber report references the feature file path so CI links back to source.

## BDD Scenarios

This story's deliverable IS the single Gherkin scenario below, appended to the existing `push_permission.feature`. (The other three original G006 scenarios already exist — see `## Why`.)

**Scenario: Banner persists across cold start**

- **Given** notifications permission is DENIED at app close
- **When** the app is force-stopped via `adb shell am force-stop`
- **And** the app is relaunched (same install, not reinstalled)
- **Then** I see the push permission denied banner on the first HomeScreen render
- **And** there is no visible state-flicker (the store-init race is explicitly awaited)

## Test Plan

**Red:**
- `grep -c 'Scenario' app/src/androidTest/assets/features/push_permission.feature` returns 12 (the cold-start scenario is absent).
- After authoring, `./gradlew connectedDevDebugAndroidTest -Pcucumber.filter.tags='@push-permission'` must include the new `Banner persists across cold start` scenario; before the step defs exist it is undefined/failing → RED.

**Green:**
- Append the scenario to the feature file.
- Add the missing step phrases to `PushPermissionSteps` (`the app is force-stopped`, `the app is relaunched`, `... on the first HomeScreen render`, `... without a state-flicker`), reusing the existing `I see the push permission denied banner` step.
- Wire the cold-start via `adb shell am force-stop` + `am start`; await store init via `awaitInitialized()` — never `Thread.sleep`.
- Run on the real Android device → GREEN (13/13).

### Pre-Merge Testing Protocol (per `CLAUDE.md` § Pre-Merge Testing Protocol)

**Not `*.md`-only** (authors a `.feature` + Kotlin step defs) → the FULL gauntlet applies. The deliverable is itself a test, and cold-start persistence is **inherently a real-device, native-Android concern** (force-stop + process recreation) — it cannot be proven on an emulator-only or web surface.

**Frameworks exercised (RED→GREEN):**
- ✅ **Android instrumented BDD** — the new scenario in `push_permission.feature` + `PushPermissionSteps` on the **real Android device** (`connectedDevDebugAndroidTest`); this IS the story's RED→GREEN.
- ✅ **Kotlin/JVM unit + detekt + ktlint** — the new step-def Kotlin passes static analysis; the existing `PushPermissionStore`/store-init unit tests (SHY-0006's domain) stay green as the regression net for the persistence behaviour the scenario exercises.
- ✅ **iOS shared compile-check** — `./gradlew :shared:compileKotlinIosArm64` (shared `PushPermissionStore` lives in commonMain; the build must stay green).
- ✅ **Manual-QA journey matrix** — the push-permission journey on the real Android device, incl. the cold-start path; full corpus at the pre-push gate.
- ⬜ **Web E2E / integration / eslint / Express Jest** — N/A (no web/API surface), but the full journey corpus runs as the regression net.
- ⬜ **iOS XCTest / XCUITest** — N/A here; the iOS banner's cold-start parity is a **separate companion SHY** (see Out of Scope). The iOS app still runs the full regression corpus on the real device.
- ✅ **SonarCloud** — quality gate.

**LOCAL gauntlet:** the new scenario green on the **real Android device** (no emulator — the `@flaky-emulator` tag of the original is now MOOT under the real-device-only policy); impact-selected = push-permission journey each loop; full corpus at the pre-push gate. Any failure → fix TDD → restart the whole local gauntlet.

**DEV gauntlet:** redeploy the unmerged branch via Deploy-To-Dev `ref`; re-run on real Android + real iOS; web = Chrome only. Restart from LOCAL on any failure. **Judgment-merge** only when production-ready with zero doubt.

## Out of Scope

- **The 3 already-shipped scenarios** (denied→banner, tap→settings, granted→hidden) — present via PR #1015; do NOT re-author (would create duplicate scenarios).
- **iOS XCUITest cold-start parity** — file a separate companion SHY (`add-ios-push-permission-cold-start-xcuitest`); the shared `PushPermissionStore` is exercised here but the iOS banner UI is a distinct surface.
- **Web (Playwright) parity** — the web app has no banner equivalent.
- **Re-design of the banner UI** — PR #1010's design is the contract.
- **Notifications revoked WHILE foregrounded** — Android API limitation (already covered as a late-revoke scenario in the live file regardless).

## Dependencies

- **[[SHY-0006]]** (PushPermissionStore + HomeViewModel push unit tests — Draft) — provides the unit-test regression net for the persistence behaviour this scenario drives; ideally ships first.
- The **existing** `push_permission.feature` (PR #1015) — this story appends to it, does not create it.
- Existing `PushPermissionSteps` step-definitions in `app/src/androidTest/java/com/shyden/shytalk/steps/`.
- The Cucumber-Android BDD runner config + `ScreenshotRule`.

## Risks & Mitigations

- **Risk: a `Thread.sleep`-based wait makes the scenario pass while masking the store-init race.** Mitigation: AC mandates `awaitInitialized()` / `onIdle`, never a hard sleep; reviewer checks for it.
- **Risk: `force-stop` leaves the process warm (background service), so it's not a true cold start.** Mitigation: assert a fresh `Application.onCreate`, not just a resumed activity.
- **Risk: relaunch reinstalls and wipes the denied state (false negative).** Mitigation: `am force-stop` + `am start` on the same install; never `installLocalDebug`.
- **Risk: the new scenario duplicates an existing one.** Mitigation: pickup-fitness already confirmed cold-start is absent; re-`grep` before authoring.

## Definition of Done

- [ ] One new `Banner persists across cold start` scenario appended to `push_permission.feature`, with its step defs in `PushPermissionSteps`.
- [ ] `./gradlew connectedDevDebugAndroidTest -Pcucumber.filter.tags='@push-permission'` passes (13/13) **on the real Android device**.
- [ ] **Pre-Merge Testing Protocol satisfied** (`CLAUDE.md` § Pre-Merge Testing Protocol): LOCAL gauntlet 100% green (new scenario on the real Android device + full regression corpus on real Android + real iOS app) → `code-reviewer` 100% clean → push → CI green by name → DEV gauntlet 100% green → **judgment-merge** (zero doubt; NO auto-merge).
- [ ] Allure report includes the new scenario.
- [ ] `released_in: vX.Y.Z` after release cut; `status: Done`.

## Notes (running log)

- 2026-06-08 ~12:58 BST — Spec created by SHY-0036 batch fill. Source: zero-gap roadmap line 31 (G006). Reserved ID SHY-0043. Originally scoped at 4 scenarios.
- 2026-06-12 ~23:30 BST — **Rescoped to the single missing scenario** (operator dedup decision, [[SHY-0091]] pass). Pickup-fitness against the live `push_permission.feature` (verified by `grep`, not assumed): PR #1015 + #1024 already shipped 12 scenarios covering 3 of the original 4 (denied→banner, tap→settings, granted→hidden) plus non-dismissible + pre/post-Tiramisu gating. ONLY **cold-start persistence** (force-stop + relaunch, no flicker) is genuinely absent — no scenario, no step defs. Effort S→XS. The original's `@flaky-emulator` mitigation is now MOOT (real-device-only policy). Embedded the full Pre-Merge Testing Protocol (cold-start = inherently real-device Android). DoD → **judgment-merge**.
</content>

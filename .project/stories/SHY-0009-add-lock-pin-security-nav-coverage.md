---
id: SHY-0009
status: Draft
owner: claude
created: 2026-06-07
priority: P1
effort: S
type: feature
roadmap_ids: [G010]
pr:
mvp: true
---

# SHY-0009: Lock/PinSetup/SecuritySettings navigation coverage

## User Story

As the ShyTalk operator, I want **the Lock / PinSetup / SecuritySettings screens to either be wired into `SharedNavGraph` (preferred post-SHY-0024) OR have their MainActivity-intercept pattern documented + tested via instrumented test**, so that the security-adjacent navigation paths have CI-verifiable behavioural coverage rather than relying on manual smoke.

## Why

Per `shared/src/commonMain/kotlin/com/shyden/shytalk/navigation/Screen.kt:75-80`, the Screen sealed class declares `Lock`, `PinSetup`, and `SecuritySettings` routes — but per the roadmap, these are NOT routed through `NavGraph.kt` or `SharedNavGraph.kt`. Instead they're intercepted at `MainActivity` level by `AppLockRepository` (when the app needs to gate a sensitive flow).

This intercept pattern means:

- The nav graph's tests don't exercise these routes.
- The intercept logic is invisible to journey BDD tests.
- A regression to `AppLockRepository`'s intercept could silently bypass the security gate.

Roadmap row G010 (line 46 of `.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md`):

> Sev: 🟠 Important. Nav — Lock/PinSetup/SecuritySettings not in SharedNavGraph. Location: `shared/src/commonMain/kotlin/com/shyden/shytalk/navigation/Screen.kt:75-80` + `SharedNavGraph.kt`. Gap: Declared in Screen.kt but routed outside NavGraph (via MainActivity AppLockRepository intercept). Nav-level untested. Fix: Wire into SharedNavGraph OR document intercept pattern + add MainActivity-level instrumented test. Scope: S.

P1 Tier-3 coverage. **Sequenced after SHY-0024** (Android→SharedNavGraph migration) — once that lands, this SHY decides whether the Lock/PinSetup routes also migrate into SharedNavGraph (cleaner) or keep the MainActivity intercept (with full doc + test).

## Acceptance Criteria

### Happy path

**Path A (preferred — wire into SharedNavGraph):**

- [ ] `SharedNavGraph.kt` gains `composable(Screen.Lock.route)`, `composable(Screen.PinSetup.route)`, `composable(Screen.SecuritySettings.route)` blocks wiring the respective screens.
- [ ] `AppLockRepository`'s intercept logic is refactored to use a `NavController.navigate(Screen.Lock.route)` call instead of MainActivity-level activity-replacement.
- [ ] Android + iOS both reach Lock via `navController.navigate(Screen.Lock.route)`.
- [ ] Existing biometric / PIN authentication flow on Lock screen unchanged (only routing migrated).

**Path B (fall-back — document the intercept):**

- [ ] If Path A is impractical (e.g. intercept must happen before NavGraph initializes), the MainActivity intercept pattern is documented in CLAUDE.md § Architecture with a clear "why":
  - When the intercept fires (app foreground after lock-timeout).
  - How it bypasses NavGraph (`AppLockRepository.shouldShowLock()` → `setContent { LockScreen(...) }` replacement).
  - Why nav-graph routing doesn't work here (e.g. nav-state has restoration concerns).
- [ ] An instrumented test `app/src/androidTest/java/com/shyden/shytalk/security/AppLockInterceptTest.kt` covers:
  - App backgrounded → re-foregrounded after lock-timeout → Lock screen appears (not Home).
  - Lock auth succeeds → original destination restored.
  - Lock auth via biometric vs PIN both paths work.
  - PinSetup screen reachable from SecuritySettings (within the intercept-flow).

**Both paths share:**

- [ ] BDD scenarios in `app/src/androidTest/assets/features/security_settings.feature` (new file or extension of existing) covering:
  - Navigate Settings → SecuritySettings.
  - SetUp PIN flow (PinSetup).
  - Toggle biometric on/off.
  - Lock-timeout configuration.
  - Trigger lock via "Lock now" action.
- [ ] All tests pass on dev Android device against local stack.

### Error paths

- [ ] **Path A**: `Screen.Lock.route` navigated-to without prior auth state → screen shows "auth required" gate.
- [ ] **Path B**: MainActivity intercept fails (e.g. AppLockRepository throws) → app falls back to showing Home (NOT crash); error logged Crashlytics non-fatal.
- [ ] **Both**: PinSetup save failure → form retains input; clear error message.
- [ ] **Both**: Biometric not available on device → SecuritySettings hides the toggle; PIN-only path works.
- [ ] **Both**: SecuritySettings reached without sign-in (regression) → redirect to SignIn.

### Edge cases

- [ ] **Path A**: deep-link directly to `Screen.Lock.route` → unauthenticated handling consistent.
- [ ] **Path A**: nav-state restoration after process death → Lock screen shows correctly if intercept was active pre-death.
- [ ] **Path B**: intercept races with deep-link from notification → intercept wins; deep-link queued for post-auth.
- [ ] **Both**: PIN entry mid-rotation → input preserved.
- [ ] **Both**: Backgrounding mid-PIN-setup → setup state preserved on return.
- [ ] **Both**: Multiple lock-timeout triggers in rapid succession → only one Lock screen shown (idempotent).

### Performance

- [ ] Lock screen appears within 100ms of intercept trigger.
- [ ] PinSetup save completes within 500ms.
- [ ] No perceptible cold-start delay added by either path.

### Security

- [ ] Lock screen is non-bypassable (no back-button escape; no hidden home-button override).
- [ ] PIN entry uses SecureStorage (SHY-0015 dependency); PIN never logged.
- [ ] Biometric session token via SecureStorage too.
- [ ] SecuritySettings cannot be reached without prior auth in the same session.
- [ ] If Path B chosen: the intercept logic is reviewed for any auth-bypass class of bug (e.g. timing-window where Home renders before intercept fires).

### UX

- [ ] Lock screen UI consistent across both paths.
- [ ] Failed PIN entries handled with clear error + counter (3 wrong → cool-down).
- [ ] Biometric prompt uses the system biometric UI (not custom).
- [ ] SecuritySettings is a sub-screen of AppSettings; back-nav returns to AppSettings.

### i18n

- [ ] Lock + PinSetup + SecuritySettings strings localized in all 20 locales.

### Observability

- [ ] Lock intercept fired logged at INFO.
- [ ] PIN auth success/failure logged at INFO (without value).
- [ ] Biometric auth result logged at INFO.
- [ ] Coverage of `AppLockRepository` ≥85%.

## BDD Scenarios

**Scenario: Path A — Lock route navigates via SharedNavGraph**

- **Given** the app is migrated to SharedNavGraph (SHY-0024 done)
- **And** a sensitive action triggers lock
- **When** `navController.navigate(Screen.Lock.route)` runs
- **Then** the Lock screen renders
- **And** the back-stack records the prior destination

**Scenario: Path B — MainActivity intercept replaces content with Lock**

- **Given** the app is backgrounded for >lock-timeout
- **When** brought back to foreground
- **Then** `AppLockRepository.shouldShowLock()` returns true
- **And** MainActivity replaces content with the Lock screen
- **And** the original destination (e.g. Home) is preserved for post-auth restore

**Scenario: PIN auth success restores original destination**

- **Given** Lock screen visible
- **And** the original destination was Home
- **When** user enters correct PIN
- **Then** Lock screen dismisses
- **And** Home is shown (not SignIn)

**Scenario: 3 wrong PINs trigger cool-down**

- **Given** Lock screen visible
- **When** user enters wrong PIN 3 times
- **Then** Lock screen shows cool-down message
- **And** PIN input disabled for the cool-down period

**Scenario: SecuritySettings reachable from AppSettings**

- **Given** user signed in on AppSettings
- **When** they tap "Security" entry
- **Then** SecuritySettings renders
- **And** back-nav returns to AppSettings (not Home)

**Scenario: Biometric not available — SecuritySettings hides toggle**

- **Given** test device without biometric hardware (or biometric disabled)
- **When** SecuritySettings renders
- **Then** the biometric toggle is hidden
- **And** PIN-only configuration is the only auth method shown

## Test Plan (TDD)

### Red

1. Locate `AppLockRepository` (verify path; likely `app/src/main/.../AppLockRepository.kt`).
2. Decide Path A vs B based on architectural feasibility (consult operator if ambiguous).
3. Add tests per chosen path.
4. Run `./gradlew connectedDevDebugAndroidTest --tests "*AppLock*"` → RED.

### Green

1. Implement chosen path; if Path A, migrate intercept logic to nav-graph routing; if Path B, ensure documentation + instrumented test cover all flows.
2. Re-run until GREEN.
3. Sonar coverage ≥85% on AppLockRepository.

### Pre-Merge Testing Protocol (per `CLAUDE.md` § Pre-Merge Testing Protocol)

**Not `*.md`-only** (wires/tests security nav + may refactor `AppLockRepository`) → the FULL gauntlet applies. This is **security-adjacent** (the lock screen + PIN gate), so the device gauntlet is the safety net against an auth-bypass regression.

**Frameworks exercised (RED→GREEN):**
- ✅ **Android instrumented BDD + Manual-QA journey matrix** — `AppLockInterceptTest` + `security_settings.feature` on a **real Android device**: background → re-foreground after lock-timeout → Lock screen (not Home), PIN + biometric auth both restore the original destination, 3-wrong-PIN cool-down, SecuritySettings reachable from AppSettings. The non-bypassable assertion (no back-button escape) is the headline.
- ✅ **Kotlin/JVM + Android unit (Robolectric)** — `AppLockRepository` intercept logic (≥85% per AC); Robolectric for the lifecycle-simulation unit layer.
- ✅ **detekt + ktlint + iOS shared compile-check** — Path A's `SharedNavGraph` wiring must keep the iOS build green (`:shared:compileKotlinIosArm64`) since the graph is shared.
- ⬜ **Web E2E / integration / eslint / Express Jest / iOS XCUITest** — N/A (Android-only security nav); the iOS app runs the regression corpus on the real iPhone as the net.
- ✅ **SonarCloud** — coverage gate.

**LOCAL gauntlet:** the security-nav suite + BDD green on a **real Android device** (lock intercept + biometric + PIN cool-down, all non-bypassable) → impact-selected each loop, full corpus at the pre-push gate. Any failure → fix TDD → restart the whole local gauntlet.
**DEV gauntlet:** redeploy the unmerged branch via Deploy-To-Dev `ref`; real Android + real iPhone regression; web = Chrome only. Restart from LOCAL on failure. **Judgment-merge** only when production-ready with zero doubt — an auth-bypass regression is a security incident. (Depends on [[SHY-0024]] for Path A's SharedNavGraph wiring.)

## Out of Scope

- **Refactoring SecureStorage** — SHY-0015 covers.
- **Adding new auth methods** — only existing.
- **Changing lock-timeout default** — out of scope.

## Dependencies

- **SHY-0024** — NavGraph migration (Path A requires this).
- **SHY-0015** — SecureStorage (PIN storage).
- **SHY-0005** — Biometric stable version.

## Risks & Mitigations

- **Risk:** Path A reveals nav-state-restoration complications that justify Path B. **Mitigation:** decide after architect review; both paths have AC.
- **Risk:** Path B's instrumented test is hard to write (lifecycle simulation). **Mitigation:** Robolectric for unit-level + true instrumented test for the lifecycle simulation.

## Definition of Done

- [ ] Chosen path implemented + tested.
- [ ] BDD scenarios pass.
- [ ] Sonar coverage ≥85%.
- [ ] **Pre-Merge Testing Protocol satisfied** (`CLAUDE.md` § Pre-Merge Testing Protocol): security-nav suite + BDD green on a **real Android device** (lock intercept + biometric + PIN cool-down, non-bypassable) + iOS regression on real iPhone → `code-reviewer` 100% clean → push → CI green by name → DEV gauntlet green → **judgment-merge** (zero doubt; NO auto-merge).
- [ ] `released_in: vX.Y.Z` set after the release cut.
- [ ] `status: Done`; `pr:` populated; chosen-path rationale in Notes.

## Notes (running log)

- 2026-06-07 ~21:18 BST — Refined under SHY-0032. Tier 3; sequenced after SHY-0024.
- 2026-06-07 — Skeleton from `convert-roadmap-to-stories.sh` PR-bundle `PR-C3` (G010).
- 2026-06-12 ~23:58 BST — **Embedded the Pre-Merge Testing Protocol** ([[SHY-0091]] pass): security-adjacent Android nav → AppLockInterceptTest + security_settings BDD on real Android (non-bypassable lock + biometric + PIN cool-down); iOS build kept green for Path A's SharedNavGraph wiring. DoD auto-merge → judgment-merge. Pickup-fitness: depends on [[SHY-0024]] (Path A) + [[SHY-0015]] (SecureStorage) + [[SHY-0005]] (biometric); no dupes/stale found.
- 2026-06-13 ~02:03 BST — **No-Stubs flag (self-review-surfaced)** ([[feedback-no-stubs-mocks-fakes-real-only]]): the Test Plan's Android unit layer uses **Robolectric** (a simulated Android framework) for `AppLockRepository` lifecycle-simulation — a stand-in the No-Stubs rule disfavours where the protocol wants real (same call as [[SHY-0016]]). The real-device `AppLockInterceptTest` + `security_settings` BDD is already the headline; any lifecycle behaviour that genuinely needs the Android runtime should run as a **real-device instrumented test**, not Robolectric — pure intercept LOGIC with no framework dependency may stay JVM. Part of the foundational-harness operator decision (🔴 SHY-0091 handoff). Not re-architected here.

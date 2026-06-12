---
id: SHY-0005
status: Draft
owner: claude
created: 2026-06-07
priority: P0
effort: XS
type: infra
roadmap_ids: [G002]
pr:
mvp: true
---

# SHY-0005: Biometric alpha → stable (downgrade)

## User Story

As the ShyTalk operator, I want **`gradle/libs.versions.toml`'s `biometric = "1.4.0-alpha07"` downgraded to the latest stable AndroidX Biometric release**, so that production builds never ship a pre-release biometric dependency on the lock-screen auth path. (If the stable surface genuinely lacks an API we depend on, the downgrade is **not** possible right now — that case hands off to [[SHY-0050]], which documents the alpha-pinning rationale inline; this story then waits for the API to GA.)

## Why

The AndroidX Biometric library at `1.4.0-alpha07` (`gradle/libs.versions.toml`) is an **alpha** release. Anthropic project policy + the operator's CLAUDE.md hard constraint ("never introduce paid services; avoid pre-release dependencies in production builds") means alpha versions must be resolved to stable wherever the stable surface covers our usage.

Roadmap row G002 (line 25 of `.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md`):

> Sev: 🔴 Critical. Category: Dep — pre-release biometric. Location: `gradle/libs.versions.toml:33`. Gap: `biometric = "1.4.0-alpha07"` is alpha; no rationale comment. Fix: Downgrade to stable if API surface covered, else add `# Required: <API>` comment. Scope: XS.

**Scope split (operator dedup decision 2026-06-12):** the roadmap fix had two halves. This story (G002) owns **only the downgrade**. The "else add rationale comment" half is [[SHY-0050]] (roadmap G032). The two are complementary and mutually exclusive in outcome: if this downgrade lands, [[SHY-0050]] closes as `Cancelled` (no alpha left to explain); if the stable surface lacks an API we need, this story cannot downgrade now and [[SHY-0050]] ships the rationale comment instead — this story stays open as the future-downgrade tracker, re-evaluated when AndroidX GAs the missing API.

The dependency is used by `LockScreenViewModel`, `PinSetupViewModel`, the biometric authentication path that gates the lock screen, and the session-token storage flow that integrates with `SecureStorage` (SHY-0015's domain).

This is Tier 1 P0 because:

1. Pre-release Android libs ship behaviour changes (and bugs) between alpha versions; production users would see different behaviour run-to-run.
2. Alpha lib licensing terms may change before stable.
3. Operator's quality + reliability weighting means every prod dep gets justified or downgraded.
4. The fix is XS effort — no excuse to defer.

**Downgrade feasibility (verify at pickup, 2026-06-12):** AndroidX Biometric latest stable needs confirming against `https://maven.google.com/web/index.html?q=androidx.biometric`. We depend on `BiometricPrompt` + `BiometricManager.from(context)` + `setAllowedAuthenticators(BIOMETRIC_STRONG)`. If the stable surface covers all three, downgrade. If it lacks one (e.g. a class-3 strong-only enforcement helper added in alpha07), the downgrade is blocked → hand to [[SHY-0050]].

## Acceptance Criteria

### Happy path

- [ ] `gradle/libs.versions.toml`'s biometric line is set to the latest **stable** version: `biometric = "<stable-version>"` (no `-alpha`/`-beta`/`-rc` suffix).
- [ ] `./gradlew :app:dependencies | grep biometric` shows the downgraded version resolves cleanly with no version conflicts.
- [ ] All biometric-related unit tests pass (`./gradlew testDevDebugUnitTest :shared:jvmTest`).
- [ ] `./gradlew assembleDevDebug` produces a working APK; the **real-Android-device** biometric prompt still appears + authenticates correctly (Phase 1 LOCAL gauntlet, biometric journey).
- [ ] `./gradlew dependencyUpdates` confirms no other AndroidX dep is sliding alpha as a transitive of biometric.

### Error paths

- [ ] **Stable lacks an API we use:** the build fails with a compile error naming the missing symbol. This story records the blocked downgrade in `## Notes` and hands the rationale-comment work to [[SHY-0050]]; it does NOT keep-alpha-with-comment itself (that is 0050's deliverable). This story stays open as the future-downgrade tracker.
- [ ] **Downgrade causes a runtime regression** in `LockScreenViewModel` biometric flow (e.g. a behaviour change in `BiometricManager.canAuthenticate()` return codes): caught by `LockScreenViewModelTest`; if the existing test doesn't cover the regression, a new failing test case is added in this PR (RED) before the fix.
- [ ] **A NEWER alpha is published** after this story (e.g. via a Dependabot bump) while the downgrade is blocked: the next `dependencyUpdates` run surfaces the drift; [[SHY-0050]]'s rationale comment is the tracking surface.

### Edge cases

- [ ] **Maven Central / Google Maven publication:** verify the stable version is actually published to `mavenCentral()` + `google()` (not just announced) before adopting — read `https://maven.google.com/web/index.html?q=biometric`.
- [ ] **Behaviour change between alpha07 and stable:** AndroidX often changes `BIOMETRIC_ERROR_*` codes between versions. Enumerate every `BIOMETRIC_ERROR_*` constant referenced in client code (`grep -rn "BIOMETRIC_ERROR_" app/ shared/`); verify each still exists in stable.
- [ ] **minSdk:** the stable version may require a higher minSdk than our target. Verify against `app/build.gradle.kts` minSdk.
- [ ] **Transitive impact:** changing the biometric version may pull a different `androidx.core` transitive; verify with `./gradlew :app:dependencyInsight --dependency biometric`.

### Performance

- [ ] APK size delta within ±50KB (alpha→stable typically reduces size slightly) — recorded in `## Notes`.
- [ ] Cold start time unchanged (biometric lib is lazy-loaded; should not affect startup) — confirmed in the real-device journey, not assumed.

### Security

- [ ] Verify the stable version has no open CVEs (`gh api repos/androidx/biometric/security-advisories`).
- [ ] Biometric authentication's class-3 strong-only enforcement remains in effect — verified by reading `LockScreenViewModel`'s `setAllowedAuthenticators(BIOMETRIC_STRONG)` call AND by the real-device biometric journey rejecting a weak (class-2) authenticator.

### UX

- [ ] No visible UX change. Biometric prompt copy + appearance unchanged — confirmed by walking the prompt on the real Android device, not by reading code alone.
- [ ] If the downgrade reveals a behaviour change (e.g. a different prompt UI in stable), the change is documented in the PR description + reviewed against design.

### i18n

- N/A — gradle dep change; no user-facing strings added or altered. (The biometric prompt's existing localised strings are unchanged; the journey still renders them, proving no regression.)

### Observability

- [ ] PR description states the resolved stable version + the API-surface check that proved it covers our usage.
- [ ] `## Notes` captures the resolved version, the APK-size delta, and the alternative considered (blocked-downgrade → 0050 handoff, if applicable).

## BDD Scenarios

**Scenario: downgrade to stable lands cleanly**

- **Given** the stable biometric release covers `BiometricPrompt` + `BiometricManager.from(context)` + `setAllowedAuthenticators(BIOMETRIC_STRONG)`
- **When** the PR sets `biometric = "<stable>"` in `gradle/libs.versions.toml`
- **Then** `./gradlew assembleDevDebug` succeeds
- **And** `./gradlew testDevDebugUnitTest :shared:jvmTest` passes (no compile error, no regression caught by tests)
- **And** the biometric prompt on a **real Android device** still appears + authenticates + enforces class-3 strong-only

**Scenario: stable lacks a required API → downgrade blocked, hand to SHY-0050**

- **Given** the stable surface lacks a class-3 strong-only enforcement helper we depend on
- **When** the downgrade is attempted and the build fails with a missing-symbol compile error
- **Then** this story records the blocked downgrade in `## Notes` and stays open as the future-downgrade tracker
- **And** [[SHY-0050]] ships the inline rationale comment for the retained alpha (this story does NOT add the comment)

**Scenario: Maven publication confirmed before adoption**

- **Given** the PR proposes a specific stable version
- **When** the build resolves dependencies from `mavenCentral()` / `google()`
- **Then** the version fetches successfully with no `Could not find` error

**Scenario: no transitive alpha leakage**

- **Given** the downgraded biometric version
- **When** `./gradlew :app:dependencies` runs
- **Then** no transitive AndroidX dep resolves to an alpha/beta version

## Test Plan

### Red

1. Add `app/src/test/java/com/shyden/shytalk/biometric/BiometricVersionAuditTest.kt`:
   - Reads the biometric version from `gradle/libs.versions.toml` (resource lookup or a build-script-injected constant).
   - Asserts the version matches the stable-version regex `^\\d+\\.\\d+\\.\\d+$` (no `-alpha`/`-beta`/`-rc`).
   - Currently FAILS because `1.4.0-alpha07` matches the alpha pattern.
2. Run `./gradlew testDevDebugUnitTest --tests "*BiometricVersionAudit*"` → RED.

### Green

1. **Confirm the downgrade is feasible:** read the latest AndroidX Biometric stable release notes / Maven metadata; enumerate the biometric APIs we use (`grep -rn "BiometricPrompt\\|BiometricManager\\|setAllowedAuthenticators" app/ shared/`); cross-reference each against the stable surface.
2. **If feasible:** update `gradle/libs.versions.toml` to the stable version; remove any obsolete imports; re-run build + tests → GREEN.
3. **If NOT feasible:** record the blocked downgrade + missing API in `## Notes`; hand the rationale comment to [[SHY-0050]]; this story stays Draft/open (no merge).

### Pre-Merge Testing Protocol (per `CLAUDE.md` § Pre-Merge Testing Protocol)

**Not `*.md`-only** (edits `gradle/libs.versions.toml` + a Kotlin test) → the FULL gauntlet applies. Biometric is **Android-only** (iOS uses `LAContext`, a separate non-gradle path — see Out of Scope), so the worked-on surface is the native Android app, not web.

**Frameworks exercised (RED→GREEN before code):**
- ✅ **Kotlin/JVM unit** — `BiometricVersionAuditTest`, `LockScreenViewModelTest`, `PinSetupViewModelTest` (`./gradlew testDevDebugUnitTest :shared:jvmTest`)
- ✅ **detekt + ktlint** — the new/changed Kotlin test files pass static analysis
- ✅ **Android instrumented BDD** — biometric lock-screen scenarios on a **real Android device** (`connectedDevDebugAndroidTest`)
- ✅ **iOS shared compile-check** — `./gradlew :shared:compileKotlinIosArm64` (the dep bump must not break the iOS build)
- ✅ **Manual-QA journey matrix** — lock-screen / biometric-unlock journeys on the real Android device
- ⬜ **Web E2E / Web integration / eslint / Express Jest** — N/A (no web or API surface), but the FULL journey corpus still runs at the pre-push gate as a regression net
- ⬜ **iOS XCTest / XCUITest** — N/A for biometric specifically (separate `LAContext` path); the iOS app still runs the full regression corpus on the real device to prove the shared-framework rebuild introduced no regression
- ✅ **SonarCloud** — quality gate on the diff

**LOCAL gauntlet (Phase 1, 100% green before push):** worked-on cells = the **real Android device** (the Mac/Android/iOS *browser* cells are web-only → N/A for this native change). Impact-selected = lock-screen/biometric journeys each loop; **full corpus** (all journeys, real Android + real iOS app) at the pre-push gate to catch any unexpected regression from the build change. Any failure → fix TDD across all frameworks → restart the entire local gauntlet.

**DEV gauntlet (Phase 3):** redeploy the unmerged branch via **Deploy-To-Dev `ref`**; re-run on real Android + real iOS; web = Chrome only (regression-only here). Any failure → fix LOCALLY (TDD) → restart from Phase 1.

## Out of Scope

- **Refactoring biometric flows** — only the dep version, not the integration code.
- **Adding new biometric features.**
- **The rationale-comment path** — owned by [[SHY-0050]] (G032). This story does NOT add a keep-alpha comment.
- **iOS biometric flows** — separate `LAContext` code path; not gradle-managed.
- **Migrating to Google Identity Services.**

## Dependencies

- **SHY-0001** + **SHY-0032** — process dependencies.
- **[[SHY-0050]]** — the complementary rationale-comment story (G032). Mutually exclusive outcome: downgrade here ⇒ 0050 cancels; blocked here ⇒ 0050 ships the comment.
- `gradle/libs.versions.toml` — the file being edited.
- `app/build.gradle.kts` — reads `libs.versions.biometric.get()`.
- `LockScreenViewModel`, `PinSetupViewModel` — consumers; their tests are the regression net.
- The AndroidX Biometric latest stable version (lookup at PR-time via `https://maven.google.com/web/index.html?q=androidx.biometric`).

## Risks & Mitigations

- **Risk:** the downgrade reveals an API gap we didn't know about. **Mitigation:** the compile-error makes it obvious; record in `## Notes` + hand to [[SHY-0050]]; this story waits for GA.
- **Risk:** the downgrade changes biometric prompt UX subtly (button label / icon differs between alpha and stable). **Mitigation:** walk the prompt on the real Android device in the LOCAL gauntlet; if visibly changed, document + get operator approval.
- **Risk:** the stable version has its own regression vs `1.4.0-alpha07`. **Mitigation:** check the stable release notes for known issues before adopting; if a regression affects us, file upstream + hand to [[SHY-0050]].
- **Risk:** a future Dependabot PR bumps to a NEWER alpha while we're blocked. **Mitigation:** `BiometricVersionAuditTest` fails on any alpha, forcing a conscious decision; [[SHY-0050]]'s comment is the tracking surface.

## Definition of Done

- [ ] `gradle/libs.versions.toml` biometric line set to the latest stable (or, if blocked, `## Notes` records the missing API + the [[SHY-0050]] handoff and this story stays open).
- [ ] `BiometricVersionAuditTest.kt` passes (GREEN).
- [ ] **Pre-Merge Testing Protocol satisfied** (`CLAUDE.md` § Pre-Merge Testing Protocol): LOCAL gauntlet 100% green — biometric journey on the **real Android device** + full regression corpus (real Android + real iOS app) + the framework set above — then `code-reviewer` 100% clean → push → CI green by name (Detect Changes, Analyze JavaScript, PR Gate) → DEV gauntlet 100% green (real devices; web = Chrome) → **judgment-merge** (zero doubt, production-ready; NO auto-merge).
- [ ] PR description states the resolved stable version + the API-surface check.
- [ ] `released_in: vX.Y.Z` set after the release cut; `status: Done` (or stays open as the future-downgrade tracker if the downgrade was blocked).

## Notes (running log)

- 2026-06-07 ~20:44 BST — Refined under SHY-0032. Already P0; Tier 1 dep hygiene.
- 2026-06-07 — Skeleton generated by `scripts/convert-roadmap-to-stories.sh` from PR-bundle `PR-A4` (roadmap_ids: G002).
- 2026-06-12 ~23:20 BST — **Narrowed to downgrade-only** (operator dedup decision, [[SHY-0091]] pass). Path B (keep-alpha-with-rationale-comment) removed and delegated entirely to [[SHY-0050]] (G032); the two stories are now complementary with non-overlapping ownership. Embedded the full **Pre-Merge Testing Protocol** Test Plan (biometric = Android-only: real-device biometric journey + iOS shared compile-check + full regression corpus; web N/A except as the regression net). DoD updated: auto-merge → **judgment-merge**.
</content>
</invoke>

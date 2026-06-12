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

# SHY-0005: Biometric alpha → stable (downgrade or rationale comment)

## User Story

As the ShyTalk operator, I want **`gradle/libs.versions.toml:33`'s `biometric = "1.4.0-alpha07"` either downgraded to the latest stable AndroidX Biometric release, OR retained with an explicit `# Required: <API>` rationale comment naming the alpha-only API surface we depend on**, so that production builds never ship with un-rationalised pre-release dependencies.

## Why

The AndroidX Biometric library at `1.4.0-alpha07` (`gradle/libs.versions.toml:33`) is an **alpha** release. Anthropic project policy + the operator's CLAUDE.md hard constraint ("never introduce paid services; avoid pre-release dependencies in production builds") means alpha versions need explicit justification documented inline.

Roadmap row G002 (line 25 of `.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md`):

> Sev: 🔴 Critical. Category: Dep — pre-release biometric. Location: `gradle/libs.versions.toml:33`. Gap: `biometric = "1.4.0-alpha07"` is alpha; no rationale comment. Fix: Downgrade to stable if API surface covered, else add `# Required: <API>` comment. Scope: XS.

The dependency is used by `LockScreenViewModel`, `PinSetupViewModel`, the biometric authentication path that gates the lock screen, and the session-token storage flow that integrates with `SecureStorage` (SHY-0015's domain).

This is Tier 1 P0 because:

1. Pre-release Android libs ship behaviour changes (and bugs) between alpha versions; production users would see different behaviour run-to-run.
2. Alpha lib licensing terms may change before stable.
3. Operator's quality + reliability weighting means every prod dep gets justified or downgraded.
4. The fix is XS effort — no excuse to defer.

Two distinct paths:

- **Path A (downgrade)**: AndroidX Biometric latest stable as of today (2026-06-07) needs verification. If the stable surface covers the APIs we use (we depend on `BiometricPrompt` + `BiometricManager.from(context)` + the new `setAllowedAuthenticators()` API), downgrade.
- **Path B (justify with comment)**: if the stable surface lacks an API we critically need (e.g. a class-3 strong-only enforcement helper added in alpha07), keep the alpha but add a multi-line `# Required: <API>` comment naming the exact class/method + the alpha-version it was added + a follow-up commitment to swap to stable when the API GAs.

## Acceptance Criteria

### Happy path

- [ ] Decision documented inline at `gradle/libs.versions.toml:33`:
  - **Path A**: `biometric = "<stable-version>"` (e.g. `"1.3.0"` if that's the latest stable as of refinement time).
  - **Path B**: `biometric = "1.4.0-alpha07"  # Required: <API.name> (added in 1.4.0-alpha07; not yet in stable; track AndroidX release notes for stable promotion).`
- [ ] If Path A: `./gradlew :app:dependencies | grep biometric` shows the downgraded version resolves cleanly with no version conflicts.
- [ ] If Path A: all biometric-related tests pass (`./gradlew test :shared:jvmTest`).
- [ ] If Path A: `./gradlew assembleDevDebug` produces a working APK; manual smoke on dev device confirms biometric prompt still appears + authenticates correctly.
- [ ] If Path B: the rationale comment names the EXACT API (class + method signature) that justifies the alpha; the comment includes a link to the AndroidX release-notes page; the comment includes a `# TODO(SHY-XXXX): swap to stable when <API> is GA` line.
- [ ] Either path: `./gradlew dependencyUpdates` (gradle-versions-plugin) confirms no other AndroidX dep is sliding alpha as a transitive of biometric.

### Error paths

- [ ] If Path A is attempted but stable lacks an API we use: build fails with a compile error naming the missing symbol. SHY transitions to Path B; documents the missing API in the rationale comment.
- [ ] If Path A's downgrade causes a runtime crash in `LockScreenViewModel` biometric flow (e.g. behaviour change in `BiometricManager.canAuthenticate()` return codes): the regression is caught by the existing `LockScreenViewModelTest`; if the test doesn't cover the regression, a new test case is added in this PR.
- [ ] If Path B is chosen but the rationale comment isn't specific enough (`# Alpha required` with no API named): the validator (NO — there's no automated check for rationale specificity) — the reviewer agent catches this and demands a specific API reference.
- [ ] If a NEW alpha release is published after this PR but the rationale comment isn't updated: the next `dependencyUpdates` run surfaces the drift; operator-side process flags follow-up.

### Edge cases

- [ ] **Maven Central caching**: verify the stable version is actually published to `mavenCentral()` + `google()` repositories (not just announced). Use `gh api repos/androidx/biometric/releases` or read https://maven.google.com/web/index.html?q=biometric for the canonical published list.
- [ ] **Behaviour-change between alpha07 and stable**: AndroidX often changes BIOMETRIC*ERROR*_ codes between alpha versions. If Path A: enumerate every BIOMETRIC*ERROR*_ constant we reference in client code; verify each still exists in stable.
- [ ] **AndroidX Biometric minSdk**: the stable version may require a higher minSdk than our current target. Verify against `app/build.gradle.kts` minSdk.
- [ ] **Transitive dep impact**: changing the biometric version may pull in a different `androidx.core` transitive; verify with `./gradlew :app:dependencyInsight --dependency biometric`.

### Performance

- [ ] APK size delta is within ±50KB. Alpha-to-stable downgrade typically reduces size slightly.
- [ ] Cold start time unchanged (biometric lib is lazy-loaded; should not affect startup).

### Security

- [ ] If Path A (downgrade): verify the stable version has no open CVEs (`gh api repos/androidx/biometric/security-advisories`).
- [ ] If Path B (keep alpha): document that the alpha hasn't been pen-tested by Anthropic; mitigation is the operator's standard build-time supply-chain checks (SHA-pinned actions, etc.).
- [ ] Biometric authentication's class-3 strong-only enforcement remains in effect either way — verified by reading `LockScreenViewModel`'s `setAllowedAuthenticators(BIOMETRIC_STRONG)` call.

### UX

- [ ] No visible UX change. Biometric prompt copy + appearance unchanged.
- [ ] If Path A reveals a behaviour change (e.g. different prompt UI in stable), the change is documented in PR description + reviewed against design.

### i18n

- [ ] N/A — gradle dep change; no user-facing strings.

### Observability

- [ ] PR description states the chosen Path (A or B) with rationale.
- [ ] Notes log captures the resolved version + the alternative considered.
- [ ] If Path B: the follow-up SHY-XXXX referenced in the rationale comment is filed before this PR merges.

## BDD Scenarios

**Scenario: Path A — downgrade to stable**

- **Given** the operator and reviewer have confirmed the stable biometric release covers our API surface
- **When** the PR sets `biometric = "<stable>"` in `gradle/libs.versions.toml`
- **Then** `./gradlew assembleDevDebug` succeeds
- **And** `./gradlew test :shared:jvmTest` passes (no compile errors, no behaviour regression caught by tests)
- **And** the existing biometric prompt on a dev device still appears + authenticates

**Scenario: Path B — keep alpha with documented rationale**

- **Given** the stable version lacks a class-3 strong-only enforcement helper we depend on
- **When** the PR keeps `biometric = "1.4.0-alpha07"` and adds a multi-line rationale comment
- **Then** the comment names the exact class + method we depend on
- **And** the comment links to the AndroidX release notes for the alpha
- **And** the comment includes a `# TODO(SHY-XXXX): swap to stable when <API> is GA` line referencing a filed follow-up SHY

**Scenario: Reviewer catches non-specific rationale**

- **Given** a draft PR with a generic comment `# Alpha required`
- **When** the reviewer agent reads `gradle/libs.versions.toml:33`
- **Then** the reviewer flags the comment as a Critical finding ("rationale not specific")
- **And** the PR cannot merge until the comment names a specific API

**Scenario: Maven Central confirms stable version**

- **Given** the PR proposes `biometric = "1.3.0"`
- **When** the build resolves dependencies
- **Then** the version is fetched from `mavenCentral()` or `google()` successfully
- **And** no `Could not find` error is emitted

**Scenario: No transitive alpha leakage**

- **Given** the chosen biometric version (either path)
- **When** `./gradlew :app:dependencies` runs
- **Then** no transitive AndroidX dep resolves to an alpha/beta version
- **And** if any does, this PR documents the cascading rationale

## Test Plan (TDD)

### Red

1. Add `app/src/test/java/com/shyden/shytalk/biometric/BiometricVersionAuditTest.kt`:
   - Reads `gradle/libs.versions.toml` from the test classpath (use a resource lookup or a small build-script-injected constant).
   - Asserts the biometric version EITHER matches a stable-version regex `^\\d+\\.\\d+\\.\\d+$` (no `-alpha/-beta/-rc`), OR is accompanied by a rationale comment in the same file.
   - Currently FAILS because `1.4.0-alpha07` matches the alpha pattern AND there's no rationale comment.
2. Run `./gradlew test --tests "*BiometricVersionAudit*"` → RED.

### Green

1. **Decide Path A vs B** based on whether the stable version supports our API surface:
   - Read the latest AndroidX Biometric stable release notes (or query Maven artifact metadata).
   - Enumerate the biometric APIs used in our codebase (`grep -rn "BiometricPrompt\\|BiometricManager" app/ shared/`).
   - Cross-reference each API against the stable version's surface.
2. **If Path A**: update `gradle/libs.versions.toml:33` to the stable version; remove any obsolete imports; re-run build + tests.
3. **If Path B**: add the multi-line rationale comment with specific API references + AndroidX release notes link + TODO(SHY-XXXX) for follow-up swap.
4. Re-run `BiometricVersionAuditTest` → GREEN.
5. Manual smoke on dev Android device: lock the app; trigger biometric prompt; authenticate; verify session token storage works.

## Out of Scope

- **Refactoring biometric flows** — only the dep version, not the integration code.
- **Adding new biometric features** — out of scope.
- **iOS biometric flows** — separate code path (`LAContext`); not gradle-managed.
- **Migrating to Google Identity Services** — out of scope.

## Dependencies

- **SHY-0001** + **SHY-0032** — process dependencies.
- `gradle/libs.versions.toml` — the file being edited.
- `app/build.gradle.kts` — reads `libs.versions.biometric.get()`.
- `LockScreenViewModel`, `PinSetupViewModel` — consumers; their tests are the regression net.
- The AndroidX Biometric latest stable version (lookup at PR-time via `https://maven.google.com/web/index.html?q=androidx.biometric`).

## Risks & Mitigations

- **Risk:** Path A's downgrade reveals an API gap we didn't know about. **Mitigation:** the compile-error makes this obvious; swap to Path B with documented rationale.
- **Risk:** Path A changes biometric prompt UX subtly (e.g. button label or icon differs between alpha and stable). **Mitigation:** manual smoke on dev device; if visible change, document in PR + get operator approval.
- **Risk:** Path B's `BiometricVersionAuditTest` becomes a permanent yellow-flag (the test passes only because of the comment, not the underlying issue). **Mitigation:** the test passing IS the desired outcome (rationale documented); the TODO comment is the follow-up commitment.
- **Risk:** A future Dependabot PR bumps to a NEWER alpha (`1.4.0-alpha08`); the test still passes but the rationale comment is stale. **Mitigation:** the rationale comment's specific API reference will be checked by Dependabot's reviewer (or the operator) — if the new alpha changes the API, the comment must be updated.
- **Risk:** The "stable version" we choose has its own bug (e.g. a regression vs `1.4.0-alpha07`). **Mitigation:** check the stable version's release notes for known issues before adopting; if a regression affects us, file it upstream + Path B.

## Definition of Done

- [ ] `gradle/libs.versions.toml:33` updated per Path A or Path B.
- [ ] `BiometricVersionAuditTest.kt` passes.
- [ ] `./gradlew assembleDevDebug` + `./gradlew test :shared:jvmTest` pass.
- [ ] Manual biometric smoke on dev Android device passes (lock → biometric → unlock).
- [ ] If Path B: follow-up SHY-XXXX filed for the API GA + swap.
- [ ] PR description states Path A or B with rationale.
- [ ] Reviewer reports ZERO findings.
- [ ] Per-type Done gate satisfied (`infra` → auto-merge once green).
- [ ] PR merged via auto-merge.
- [ ] `status: Done`; `pr:` populated; chosen Path + version logged in Notes.

## Notes (running log)

- 2026-06-07 ~20:44 BST — Refined under SHY-0032. Already P0; Tier 1 dep hygiene.
- 2026-06-07 — Skeleton generated by `scripts/convert-roadmap-to-stories.sh` from PR-bundle `PR-A4` (roadmap_ids: G002).

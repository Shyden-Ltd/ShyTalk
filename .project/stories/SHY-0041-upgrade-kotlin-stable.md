---
id: SHY-0041
status: Draft
owner: claude
created: 2026-06-08
priority: P0
effort: XS
type: chore
roadmap_ids: [G001]
pr:
mvp: true
---

# SHY-0041: Upgrade Kotlin from 2.4.0-RC2 to 2.4.0 stable

## User Story

As the ShyTalk operator who flagged that `gradle/libs.versions.toml:3` declares `kotlin = "2.4.0-RC2"` (a release candidate, not stable), I want **Kotlin pinned to the 2.4.0 stable release** (or, if 2.4.0 stable is not yet on Maven Central, an explicit blocker comment + CI gate that fires when stable lands — see [[SHY-0049]] for the gate), so that the production build no longer depends on pre-release Kotlin metadata which `detekt 1.23.8` cannot parse (see [[SHY-0048]] for the related detekt 2.0 wait).

## Why

`gradle/libs.versions.toml:3` (per 2026-06-05 audit): `kotlin = "2.4.0-RC2"`. Maven Central status at SHY-creation time (2026-06-08): check needed via `curl -s https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-gradle-plugin/maven-metadata.xml | grep '<latest>'`. If `<latest>` is 2.4.0 stable, this SHY ships the version bump + CI iOS-link verification. If still RC2, this SHY ships only the blocker-comment + creates SHY-0048's gate.

[[feedback-never-suppress-fix-or-upgrade]] HARD GLOBAL RULE: "Fix root cause or upgrade the dependency to a version that no longer emits it." Pre-release Kotlin is a deferred fix; this SHY closes the deferral.

## Acceptance Criteria

### Happy path

- [ ] If `2.4.0` stable on Maven Central: `gradle/libs.versions.toml:3` reads `kotlin = "2.4.0"`; `./gradlew :shared:compileKotlinIosArm64` succeeds; `./gradlew testDevDebugUnitTest :shared:jvmTest detekt` all green.
- [ ] If `2.4.0` stable NOT yet released: file gains a comment block above the `kotlin = "2.4.0-RC2"` line documenting (a) the Maven Central check date, (b) the response from the metadata URL, (c) the SHY-0048 CI-gate that will fire when stable lands.
- [ ] No regression in `:app` build, `:shared` jvm/ios builds, or unit tests.
- [ ] If the bump happens, the dev deploy succeeds end-to-end (manual dispatch of `deploy-dev.yml` workflow; verify on dev environment).
- [ ] CHANGELOG / release notes updated if the bump ships (release-notes for the next release should mention Kotlin upgrade).

### Error paths

- [ ] **Maven Central lookup fails** (network blip, 5xx): retry once; if still failing, defer the SHY (mark `Blocked` in Notes) rather than guess.
- [ ] **Bump breaks iOS K/N link** (compileKotlinIosArm64 fails with internal compiler error): bisect — revert to 2.4.0-RC2 + file detekt-blocker SHY for follow-up.
- [ ] **Bump triggers a detekt failure** that wasn't present on RC2: cross-link with [[SHY-0048]] (detekt 2.0 wait) — if detekt 1.23.8 can't handle 2.4.0 metadata, this SHY must wait for SHY-0048's resolution.
- [ ] **Bump breaks a dependent plugin** (e.g. Compose Multiplatform, KSP): identify + file follow-up SHY for plugin bump in same series.

### Edge cases

- [ ] **Kotlin 2.4.1 patch released between SHY filing and merge**: bump to latest patch instead.
- [ ] **JetBrains releases a 2.4.0 hotfix shortly after stable**: bump to hotfix if it lands before this SHY's PR merges.
- [ ] **Composing dependency catalogs** — `libs.versions.toml` may reference `kotlin.version` from `gradle.properties`; verify the source-of-truth.
- [ ] **Compose Multiplatform binary compat** — Compose plugin version must declare 2.4.0 support; check `composeMultiplatform` row in `libs.versions.toml`.

### Performance

- [ ] No CI runtime regression — Kotlin 2.4.0's K2 compiler is typically faster than RC builds. Measure pre/post: `./gradlew :shared:compileKotlinIosArm64` wall-clock.

### Security

- [ ] N/A — version bump, no new attack surface.

### UX

- [ ] N/A — no user-facing change.

### i18n

- [ ] N/A — no string changes.

### Observability

- [ ] Commit message: `[SHY-0041] Bump Kotlin 2.4.0-RC2 → 2.4.0 stable` (or if blocker comment: `[SHY-0041] Block on Kotlin 2.4.0 stable + create CI gate marker`).
- [ ] PR description includes the Maven Central check output for traceability.

## BDD Scenarios

**Scenario: Kotlin stable is on Maven Central → bump succeeds**

- **Given** `curl -s https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-gradle-plugin/maven-metadata.xml | grep '<latest>'` returns `<latest>2.4.0</latest>` or higher patch
- **When** `gradle/libs.versions.toml:3` is updated to `kotlin = "2.4.0"`
- **Then** `./gradlew :shared:compileKotlinIosArm64` exits 0
- **And** `./gradlew testDevDebugUnitTest :shared:jvmTest detekt` exits 0
- **And** the diff is exactly one line in `libs.versions.toml`

**Scenario: Kotlin stable NOT released → blocker comment + gate**

- **Given** Maven Central's latest Kotlin is still `2.4.0-RCx` or `2.4.0-Mx`
- **When** the contributor opens `libs.versions.toml:3`
- **Then** there is a comment block above the line explaining the block + check date + reference to SHY-0048 gate
- **And** the comment includes the literal Maven Central URL for future re-checks

## Test Plan

**Red:** N/A — version bump verified by build + test suite, not new unit tests. Existing `:shared:jvmTest` covers Kotlin-version-sensitive code; any regression surfaces there.

**Green:**
- Run `curl -s https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-gradle-plugin/maven-metadata.xml | tail -20` and pin the response in the PR description.
- If stable: edit `gradle/libs.versions.toml:3`; run full local gauntlet (`./gradlew testDevDebugUnitTest :shared:jvmTest :shared:compileKotlinIosArm64 detekt`).
- If not stable: add comment block; create SHY-0048 if not already done.

**Coverage gate:** local + CI build pass on the bump; iOS K/N link verified.

### Pre-Merge Testing Protocol (per `CLAUDE.md` § Pre-Merge Testing Protocol)

**Not `*.md`-only** (edits `gradle/libs.versions.toml`) → the FULL gauntlet applies. **A Kotlin compiler bump recompiles the entire Android + iOS app** — the canonical "could break anything" change — so the full device gauntlet + full journey corpus is genuinely warranted, not ceremonial. (If the stable build is unavailable and this ships only a blocker comment, the gauntlet collapses to its build/compile + regression floor, like a `.toml` comment-only change.)

**Frameworks exercised (if the bump ships):**
- ✅ **Kotlin/JVM unit + detekt + ktlint** — `./gradlew testDevDebugUnitTest :shared:jvmTest detekt` (detekt is the headline: 1.23.8's metadata ceiling is the whole reason — cross-ref [[SHY-0048]]).
- ✅ **iOS shared compile-check + K/N link** — `./gradlew :shared:compileKotlinIosArm64` (a compiler bump is highest-risk at the K/N link).
- ✅ **Android instrumented BDD + Manual-QA journey matrix** — the FULL journey corpus on a **real Android device AND a real iPhone** (a compiler change can regress anywhere; full-corpus regression is mandatory, not impact-selected).
- ⬜ **Web E2E / integration / eslint / Express Jest** — the web pages are static JS, untouched by a Kotlin bump → N/A as impact, but still run as the regression net.
- ✅ **SonarCloud** — quality gate.

**LOCAL gauntlet:** the full build (jvm + ios + detekt) green → FULL journey corpus on real Android + real iPhone (every cell — a compiler change earns the whole matrix). Any failure → bisect/revert per the Error-paths AC → restart the whole local gauntlet.
**DEV gauntlet:** the existing dev-deploy AC IS the DEV gauntlet — redeploy the unmerged branch via Deploy-To-Dev `ref`; full journeys on real Android + real iPhone; web = Chrome only. Restart from LOCAL on failure. **Judgment-merge** only when production-ready with zero doubt.

## Out of Scope

- Upgrade of dependent plugins beyond what Kotlin 2.4.0 requires (Compose Multiplatform, KSP, etc.) — separate SHYs per plugin.
- detekt 2.0 migration — covered by [[SHY-0048]].
- CI Kotlin pre-release gate implementation — covered by [[SHY-0049]] (separate XS-scope spec).
- Release-notes copywriting beyond the one-line Kotlin bump mention.

## Dependencies

- **Maven Central availability of 2.4.0 stable** — external; outside our control.
- **detekt 1.23.8** — currently passing on RC2; bump may surface its metadata-ceiling issue (cross-ref [[SHY-0048]]).
- **Compose Multiplatform** — current version declares Kotlin 2.4.x support; verify before bump.
- **iOS deploy infrastructure** — must be operational for the dev-deploy verification (see [[reference-local-stack-runner-setup]]).

## Risks & Mitigations

- **Risk: Kotlin 2.4.0 stable not released by SHY pickup time.** Mitigation: defer to blocker-comment + SHY-0048 gate; no harm in waiting.
- **Risk: 2.4.0 stable breaks our K/N or detekt config.** Mitigation: pre-flight build before push; revert + file follow-up SHY.
- **Risk: A downstream plugin (Compose, KSP) has compat issues.** Mitigation: read each plugin's changelog before bump; pin patch versions.

## Definition of Done

- [ ] If bump: `libs.versions.toml` updated; full local + CI build green; release notes mention Kotlin bump.
- [ ] If blocked: explicit comment + [[SHY-0048]] created; this SHY closes as `Blocked` with concrete trigger condition.
- [ ] **Pre-Merge Testing Protocol satisfied** (`CLAUDE.md` § Pre-Merge Testing Protocol) when the bump ships: full build (jvm + ios + detekt) green + FULL journey corpus green on **real Android + real iPhone** (a compiler bump earns the whole matrix) → `code-reviewer` 100% clean → push → CI green by name → DEV gauntlet green → **judgment-merge** (zero doubt; NO auto-merge). (Blocker-comment-only path: build/compile + regression floor, then judgment-merge.)
- [ ] `released_in: vX.Y.Z` set after the release cut (if the bump shipped).
- [ ] `status: Done` (or `Blocked` if external); `pr:` populated.

## Notes (running log)

- 2026-06-08 ~12:58 BST — Spec created by SHY-0036 batch fill. Source: zero-gap roadmap line 24 (G001). Reserved ID SHY-0041.
- 2026-06-12 ~23:45 BST — **Embedded the Pre-Merge Testing Protocol** ([[SHY-0091]] pass): a Kotlin compiler bump recompiles both apps → full journey corpus on real Android + real iPhone is mandatory (not impact-selected); detekt is the headline framework. Blocker-comment-only path collapses to the build/regression floor. **Pickup-fitness fix:** corrected a stale cross-ref in Error-paths (detekt-2.0 wait is [[SHY-0048]], NOT SHY-0059 which is the admin-users-moderation-skip bug). DoD auto-merge → judgment-merge.

---
id: SHY-0028
status: Draft
owner: claude
created: 2026-06-07
priority: P2
effort: S
type: chore
roadmap_ids: [G046]
pr:
mvp: true
---

# SHY-0028: Gradle deprecation sweep (--warning-mode all)

## User Story

As the ShyTalk operator who treats every warning as a failure ([[feedback-warnings-are-failures]]), I want **`./gradlew testDevDebugUnitTest --warning-mode all` to run clean with zero deprecation warnings**, so that we have a deterministic baseline before the next Gradle major upgrade (where unfixed deprecations become hard errors).

## Why

Gradle prints deprecation warnings only when `--warning-mode=all` (or `summary`); the default `none` hides them. Accumulating deprecations means future major upgrades break suddenly.

Roadmap row G046 (line 115):

> Sev: 🟡 Polish. Dep — Kotlin `@Deprecated` usages scan. Location: (codebase-wide). Gap: Static scan not done. Fix: `./gradlew testDevDebugUnitTest --warning-mode all 2>&1 | grep -i deprecat`; enumerate hits. Scope: S.

P2 Tier-5 chore. Per [[feedback-never-suppress-fix-or-upgrade]]: fix root cause OR upgrade dep; never suppress.

## Acceptance Criteria

### Happy path

- [ ] Run `./gradlew testDevDebugUnitTest --warning-mode all 2>&1 | grep -iE "deprecat|warning" > /tmp/gradle-deprecations.txt` to enumerate hits.
- [ ] For each hit, identify root cause (our code vs transitive dep).
- [ ] Fix in our code where applicable; upgrade dep where applicable; document the chosen fix per finding.
- [ ] After fixes, `./gradlew testDevDebugUnitTest --warning-mode all` runs clean (zero deprecation warnings).
- [ ] Add a CI step that runs `./gradlew detekt --warning-mode all` and fails on new deprecations introduced post-merge.

### Error paths

- [ ] If a deprecation is from a dep we can't upgrade (e.g. Kotlin's `@kotlin.RequiresOptIn` vs `@OptIn` migration), document why; pin to a wrapper if possible; do NOT suppress.
- [ ] If a fix breaks other code, scope expands; reviewer agent decides whether to split into follow-up SHY.

### Edge cases

- [ ] Some deprecations are platform-specific (Android-only or iOS-only); document per-platform impact.
- [ ] Deprecations in test-only code still fix (don't accept tech debt in tests per [[feedback-fix-pre-existing-and-new-same]]).
- [ ] Detekt's own deprecations vs Gradle's own deprecations — both fix.

### Performance

- [ ] No regression in build time after fixes.
- [ ] CI deprecation-check step adds <30s to lint workflow.

### Security

- [ ] No suppression mechanism (e.g. `-Werror=no-deprecation`) added.
- [ ] No dep downgrade introducing CVEs.

### UX

- [ ] N/A — build-system change.

### i18n

- [ ] N/A.

### Observability

- [ ] PR description enumerates every deprecation found + chosen fix per finding.
- [ ] CI lint step prints number of deprecations on every push.
- [ ] Job summary lists count.

## BDD Scenarios

**Scenario: Clean run after fixes**

- **Given** all surfaced deprecations fixed
- **When** `./gradlew testDevDebugUnitTest --warning-mode all` runs
- **Then** stdout contains zero lines matching `Deprecated Gradle features|Method ... deprecated|API ... deprecated`

**Scenario: CI catches new deprecation in PR**

- **Given** the CI lint step running deprecation check
- **When** a PR introduces new deprecated API usage
- **Then** the check fails
- **And** the failure message names the file + line

**Scenario: Documented dep upgrades vs in-code fixes**

- **Given** the PR description
- **When** reviewer reads it
- **Then** every finding has a chosen fix labeled `[upgrade-dep]`, `[fix-code]`, or `[wait-upstream]` (with rationale)

## Test Plan (TDD)

### Red

1. Run `./gradlew testDevDebugUnitTest --warning-mode all 2>&1 | grep -i deprecat | wc -l` → baseline count > 0 (RED).
2. (Add CI lint check that asserts count == 0.)

### Green

1. Walk findings; fix per choice.
2. Re-run baseline check → count == 0 (GREEN).
3. CI step in `lint.yml` running the check.

### Pre-Merge Testing Protocol (per `CLAUDE.md` § Pre-Merge Testing Protocol)

**Not `*.md`-only** (fixes deprecations across Kotlin/Gradle source + adds a CI lint step) → the FULL protocol applies. Deprecation fixes can reach shared/commonMain code, so they can ripple into real app behaviour — the apps regression net is load-bearing here, not ceremonial.

**Frameworks exercised (RED→GREEN):**
- ✅ **Kotlin/JVM unit** (`./gradlew testDevDebugUnitTest --warning-mode all`) — both the RED surface (the deprecation enumeration) AND the GREEN gate (zero warnings) run against the **real Gradle build + real unit suite**; the suite is the regression net for each fix.
- ✅ **detekt** + **ktlint** — the source fixes.
- ✅ **iOS shared compile-check** (`:shared:compileKotlinIosArm64`) — any fix touching commonMain/shared must still compile for iOS.
- ✅ **Android instrumented BDD** (`connectedDevDebugAndroidTest`) — if a fix touches Android runtime code paths, the instrumented suite on a **real Android device** is the regression net.
- ✅ **actionlint** — the new `lint.yml` deprecation-check step.
- ⬜ **Web Playwright / Express Jest** — N/A (no web/server surface).

**No-Stubs (already aligned):** the whole ticket is real — real Gradle, real `--warning-mode all` output, real unit/instrumented runs verify each fix. Nothing to mock. Per [[feedback-never-suppress-fix-or-upgrade]] + the Out-of-Scope ban, suppression flags are forbidden — fix the root cause or upgrade, never `-Werror=no-deprecation`.

**LOCAL gauntlet:** zero deprecations on `--warning-mode all`; unit + detekt + ktlint + `:shared:compileKotlinIosArm64` clean; the FULL apps regression on a **real Android device + real iPhone** (shared-code fixes can change runtime behaviour) + web regression. Any failure → fix TDD → restart. (If >20 distinct deprecations, batch per the Risk row — each batch still runs the full gauntlet.)
**DEV gauntlet:** redeploy the unmerged branch via Deploy-To-Dev `ref`; re-run the apps regression on real devices; web = Chrome; confirm the new CI lint step is green on the real pipeline. Restart from LOCAL on failure.
**Judgment-merge** only when production-ready with zero doubt; NO auto-merge.

## Out of Scope

- **Upgrading Gradle major version** — that's a separate SHY.
- **Refactoring beyond minimum fix** for each deprecation.
- **Suppressing deprecation warnings via flag** — explicitly forbidden.

## Dependencies

- **SHY-0001** + **SHY-0032** — process.
- Gradle version (verify in `gradle/wrapper/gradle-wrapper.properties`).
- Kotlin version (verify in `gradle/libs.versions.toml`).

## Risks & Mitigations

- **Risk:** A deprecation requires upstream dep version we don't have yet. **Mitigation:** document; wait-upstream label; revisit when version available.
- **Risk:** Fix introduces test regression. **Mitigation:** existing test suite is the regression net.
- **Risk:** Number of deprecations is very large; scope balloons. **Mitigation:** if >20 distinct, split into batches (SHY-0028-A/B/C); reviewer agent decides at PR time.

## Definition of Done

- [ ] Zero deprecations on `--warning-mode all` run.
- [ ] CI step added; passes.
- [ ] PR description enumerates findings + fixes.
- [ ] **Pre-Merge Testing Protocol satisfied** (`CLAUDE.md` § Pre-Merge Testing Protocol): zero deprecations on `--warning-mode all` + unit/detekt/ktlint/`:shared:compileKotlinIosArm64` clean + full apps regression green on real Android + real iPhone + the new CI step green → `code-reviewer` 100% clean → push → CI green by name → DEV gauntlet green (real devices; Chrome web) → **judgment-merge** (zero doubt; NO auto-merge).
- [ ] `released_in: vX.Y.Z` set after the release cut.
- [ ] `status: Done`; `pr:` populated; finding count + fix breakdown in Notes.

## Notes (running log)

- 2026-06-07 ~21:37 BST — Refined under SHY-0032. Tier 5 chore.
- 2026-06-07 — Skeleton from `convert-roadmap-to-stories.sh` PR-bundle `PR-I6` (G046).
- 2026-06-13 ~01:05 BST — **Embedded the Pre-Merge Testing Protocol** ([[SHY-0091]] pass): Gradle/Kotlin deprecation sweep → real-build headline (`--warning-mode all` is both RED enumeration + GREEN gate); deprecation fixes can reach commonMain → `:shared:compileKotlinIosArm64` + the FULL apps regression on real Android + real iPhone are load-bearing (shared-code ripple). No-Stubs ([[feedback-no-stubs-mocks-fakes-real-only]]): already aligned (all-real build/test) — nothing to scrub; suppression flags stay forbidden ([[feedback-never-suppress-fix-or-upgrade]]). DoD swaps the stale Reviewer-ZERO / `chore→auto-merge` / PR-merged lines for protocol-satisfied + judgment-merge + released_in. Pickup-fitness: AC current; the live deprecation count + Gradle/Kotlin versions need the read-and-confirm at pickup; the >20-distinct batching rule stands.

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
- [ ] Reviewer ZERO findings.
- [ ] Per-type Done gate (`chore` → auto-merge once green).
- [ ] PR merged.
- [ ] `status: Done`; `pr:` populated; finding count + fix breakdown in Notes.

## Notes (running log)

- 2026-06-07 ~21:37 BST — Refined under SHY-0032. Tier 5 chore.
- 2026-06-07 — Skeleton from `convert-roadmap-to-stories.sh` PR-bundle `PR-I6` (G046).

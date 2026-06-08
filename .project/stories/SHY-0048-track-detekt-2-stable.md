---
id: SHY-0048
status: Draft
owner: claude
created: 2026-06-08
priority: P1
effort: S
type: chore
roadmap_ids: [G053]
pr:
---

# SHY-0048: Track detekt 2.0 stable release on Gradle Plugin Portal + migrate config

## User Story

As a Kotlin-version-conscious ShyTalk maintainer, I want **a tracking SHY for the detekt 2.0 stable release** so that when JetBrains publishes detekt 2.0.0 (currently only 2.0.0-alpha.3 exists on GitHub releases — not on the Gradle Plugin Portal — per the SHY-0036-cited roadmap audit), we can immediately bump from 1.23.8 (Kotlin 2.0 metadata ceiling) to 2.x (Kotlin 2.4+ support) without the existing 2.4.0 metadata risk surfacing.

## Why

Roadmap row (line 118, 2026-06-05): `G053 | 🟠 Important | Dep — detekt 2.0 Kotlin 2.4 metadata support | gradle/libs.versions.toml:35 | detekt 1.23.8 is built against Kotlin 2.0 compiler internals (metadata ceiling 2.1.0); Kotlin 2.4 emits metadata version 2.4.0. detekt#8865 documents the failure mode. Local verification: NO metadata warnings emitted on our code (the bug doesn't manifest for our patterns). detekt 2.0.0-alpha.3 is the canonical fix but is only published as GitHub release, NOT on the Gradle Plugin Portal — upgrade infeasible until 2.0 stable. | Wait for detekt 2.0.0 stable on Gradle Plugin Portal; migrate detekt.yml config if rule schema changed; verify all current rules still apply | S`.

Critical detail from the audit: **the bug doesn't currently manifest for our code patterns** — detekt 1.23.8 still passes locally + in CI without metadata warnings. So this is a forward-looking tracker, not an urgent fix.

[[feedback-never-suppress-fix-or-upgrade]]: long-term we MUST upgrade, but we cannot until 2.0 stable lands.

## Acceptance Criteria

### Happy path

- [ ] If detekt 2.0.0 stable IS on Gradle Plugin Portal at SHY-pickup time: bump `gradle/libs.versions.toml:35` from `1.23.8` to `2.0.0`; migrate `config/detekt/detekt.yml` per the detekt 2.0 migration guide; verify all current rules still apply; `./gradlew detekt` exits 0.
- [ ] If 2.0.0 NOT yet on Gradle Plugin Portal: add a comment block above `gradle/libs.versions.toml:35` documenting (a) the Gradle Plugin Portal check date + URL, (b) the alpha.3 location, (c) the metadata-ceiling rationale, (d) reference to this SHY for the wait condition.
- [ ] CI `lint.yml` continues to run detekt + passes on the new version.
- [ ] Notes record the result of the GPP check (`curl -s https://plugins.gradle.org/m2/io/gitlab/arturbosch/detekt/detekt-gradle-plugin/maven-metadata.xml | tail -20`).

### Error paths

- [ ] **GPP lookup fails**: retry once; otherwise defer.
- [ ] **Bump breaks one or more rules** (config schema changed): migrate per detekt's migration guide; surface each migrated rule in PR description.
- [ ] **Bump triggers new findings** on our codebase: each finding is either (a) a real defect → fix it, or (b) a rule that no longer fits our style → suppress with rationale comment + filed follow-up SHY.
- [ ] **Local detekt and CI detekt diverge** (config-file vs config-on-classpath): align both to the new version.

### Edge cases

- [ ] **detekt 2.0.0-rc.N released after this SHY** (not stable yet): wait for stable, NOT a release candidate — that defeats the purpose.
- [ ] **Kotlin 2.4.x bumps to 2.5.x before detekt 2.0 ships**: cross-reference [[SHY-0041]] (Kotlin upgrade) — both SHYs may need to ship together.
- [ ] **detekt 2.0 has stricter defaults**: prepare for a flood of new findings; size the PR accordingly (M-scope if many).
- [ ] **Our custom rules (if any) at `config/detekt/` reference detekt 1.x APIs**: rewrite per 2.0 API.

### Performance

- [ ] detekt 2.0 K2-based analysis is typically faster; measure pre/post wall-clock.

### Security

- [ ] No new attack surface — static analyser bump.

### UX

- [ ] N/A — CI/dev tool.

### i18n

- [ ] N/A — no strings.

### Observability

- [ ] Commit: `[SHY-0048] Bump detekt 1.23.8 → 2.0.0 (G053)` OR `[SHY-0048] Block on detekt 2.0 stable + document GPP check (G053)`.
- [ ] PR description records the GPP check URL + output.

## BDD Scenarios

**Scenario: detekt 2.0 stable on Gradle Plugin Portal → bump succeeds**

- **Given** `curl -s https://plugins.gradle.org/m2/io/gitlab/arturbosch/detekt/detekt-gradle-plugin/maven-metadata.xml | grep '<release>'` returns `<release>2.0.0</release>` or higher
- **When** `gradle/libs.versions.toml:35` is updated to `detekt = "2.0.0"`
- **And** `config/detekt/detekt.yml` is migrated per the detekt 2.0 guide
- **Then** `./gradlew detekt` exits 0
- **And** the diff shows the version bump + the config migration

**Scenario: detekt 2.0 not yet on GPP → blocker comment**

- **Given** GPP's latest detekt-gradle-plugin is `1.x` or `2.0.0-alpha.N`
- **When** the contributor opens `gradle/libs.versions.toml:35`
- **Then** a comment block above the line documents the wait condition + GPP URL + this SHY's reference

**Scenario: Regression — detekt downgrade attempted**

- **Given** detekt 2.0.0 has been adopted
- **When** a future PR attempts to downgrade to 1.x
- **Then** the reviewer flags it as a regression
- **And** the metadata-ceiling risk is re-introduced — must be blocked

## Test Plan

**Red:** N/A for the tracker case (no test). For the bump case: existing `./gradlew detekt` task is the regression net.

**Green:**
- Run GPP lookup; pin output in PR description.
- If stable: bump + migrate config + verify.
- If not: add blocker comment.

**Coverage gate:** `./gradlew detekt` exits 0 against the post-bump (or pre-bump unchanged) state.

## Out of Scope

- detekt 1.x patch bumps (e.g. 1.23.8 → 1.23.9) — handled by Dependabot.
- Replacing detekt with a different static analyser.
- Authoring new custom detekt rules.

## Dependencies

- Gradle Plugin Portal availability of detekt 2.0.0 stable (external).
- [[SHY-0041]] (Kotlin 2.4.0 stable) — may interact if Kotlin bumps further before detekt 2.0 ships.
- `gradle/libs.versions.toml` + `config/detekt/detekt.yml` files.

## Risks & Mitigations

- **Risk: detekt 2.0 stable never lands** (project abandoned). Mitigation: re-evaluate annually; if abandoned, file SHY to switch to alternative (e.g. ktlint+intellij-inspections).
- **Risk: bump breaks our CI on Day 1.** Mitigation: pre-flight `./gradlew detekt` local before push; revert if needed.
- **Risk: config migration touches many rule entries.** Mitigation: PR scope can expand to M if needed.

## Definition of Done

- [ ] If bump: version + config updated; CI green.
- [ ] If blocked: explicit comment + this SHY remains `Draft` with concrete trigger.
- [ ] Reviewer ZERO findings.
- [ ] `status: Done` (or `Blocked` if external).

## Notes (running log)

- 2026-06-08 ~13:08 BST — Spec created by SHY-0036 batch fill. Source: zero-gap roadmap line 118 (G053). Reserved ID SHY-0048.

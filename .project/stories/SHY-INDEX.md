# SHY Story Index

Live backlog of every piece of work captured under the Agile way of working ([[feedback-agile-user-stories]]). Each row maps one PR-bundle to one detailed story file at `.project/stories/SHY-XXXX-slug.md`. Every story is born fully refined per [[feedback-no-skeleton-stories-fully-refined]] — no skeleton placeholders allowed.

**Status legend:** 📝 Draft · 🚧 In Progress · 👀 In Review · ✅ Done · ❌ Cancelled

**Sort order (Active section):** `priority` ascending, then `created` ascending (matches CLAUDE.md § Story ID + file layout). Within the same `priority` + `created`, the row order is operator-curated to reflect the **tier prioritisation** (Tier 1 unblocker → Tier 1 security → Tier 2 reliability → ...) — this is operator-validated signal beyond strict mechanical sort. P0 always tops; in-progress SHYs surface at the top of their priority band for immediate visibility.

## Active

| ID                                                              | Pri | Effort | Type     | Title                                                                                            | Status         | Roadmap IDs      | PR  |
| --------------------------------------------------------------- | --- | ------ | -------- | ------------------------------------------------------------------------------------------------ | -------------- | ---------------- | --- |
| [SHY-0064](SHY-0064-fix-sync-jq-argv-too-long.md)               | P0  | XS     | bug      | Fix SHY-0063 sync workflow — jq ARG_MAX (single-jq pipeline for 177KB payload)                   | 🚧 In Progress | —                | —   |
| [SHY-0063](SHY-0063-fix-sync-roadmap-signed-commits.md)         | P0  | S      | bug      | Fix SHY-0038 sync workflow — signed commits via Release App createCommitOnBranch                 | 🚧 In Progress | —                | [#1045](https://github.com/Shyden-Ltd/ShyTalk/pull/1045) |
| [SHY-0038](SHY-0038-public-roadmap-gh-project-link.md)          | P0  | L      | infra    | Full bidirectional sync: SHY .md → roadmap-data.json auto-regen + GH Project board link          | 🚧 In Progress | —                | [#1044](https://github.com/Shyden-Ltd/ShyTalk/pull/1044) |
| [SHY-0060](SHY-0060-age-gating-per-feature.md)                  | P0  | XL     | feature  | Age-gating per feature: tiered per-feature age thresholds replacing single 13+ signup gate       | 🚧 In Progress | —                | —   |
| [SHY-0024](SHY-0024-resolve-navgraph-coexistence.md)            | P0  | L      | refactor | Migrate Android to SharedNavGraph + delete NavGraph.kt                                           | 📝 Draft       | G028             | —   |
| [SHY-0004](SHY-0004-verify-room-mutation-p3-deploy.md)          | P0  | S      | bug      | Verify Room mutation P3 deploy status + reconcile                                                | 📝 Draft       | G009, G027       | —   |
| [SHY-0029](SHY-0029-tighten-ownerfirebaseuid-rule.md)           | P0  | S      | bug      | Tighten ownerFirebaseUid rule (strict equality, no legacy fallback)                              | 📝 Draft       | G026             | —   |
| [SHY-0015](SHY-0015-add-secure-storage-contract-tests.md)       | P0  | S      | bug      | SecureStorage + CryptoKeyPair contract tests                                                     | 📝 Draft       | G019             | —   |
| [SHY-0005](SHY-0005-biometric-alpha-to-stable.md)               | P0  | XS     | infra    | Biometric alpha → stable (downgrade or rationale comment)                                        | 📝 Draft       | G002             | —   |
| [SHY-0021](SHY-0021-add-cron-account-deletion-endpoint-test.md) | P0  | S      | infra    | cron-account-deletion endpoint integration test (auth coverage)                                  | 📝 Draft       | G021             | —   |
| [SHY-0013](SHY-0013-add-core-infra-tests.md)                    | P0  | M      | infra    | RoomLifecycleManager + AnimationQueue + ModerationFilter tests                                   | 📝 Draft       | G004, G020       | —   |
| [SHY-0011](SHY-0011-add-economy-vm-tests.md)                    | P0  | M      | bug      | Wallet + Gifting + TransactionHistory VM tests                                                   | 📝 Draft       | G003-D2          | —   |
| [SHY-0014](SHY-0014-add-room-service-controller-tests.md)       | P0  | M      | bug      | Android/Ios RoomServiceController tests + FakeRoomLifecycleManager extraction                    | 📝 Draft       | G016             | —   |
| [SHY-0010](SHY-0010-add-home-gacha-vm-tests.md)                 | P0  | M      | bug      | HomeViewModel + GachaViewModel tests                                                             | 📝 Draft       | G003-D1          | —   |
| [SHY-0012](SHY-0012-add-remaining-vm-tests.md)                  | P0  | L      | bug      | 10 remaining ViewModel test files (Messaging + Profile + Settings + Daily + Splash)              | 📝 Draft       | G003-D3          | —   |
| [SHY-0041](SHY-0041-upgrade-kotlin-stable.md)                   | P0  | XS     | chore    | Upgrade Kotlin 2.4.0-RC2 → 2.4.0 stable (or block-comment + CI gate via SHY-0049)                | 📝 Draft       | G001             | —   |
| [SHY-0042](SHY-0042-viewmodel-coverage-tracker.md)              | P0  | XS     | docs     | G003 ViewModel-coverage tracker (meta — links SHY-0010/0011/0012)                                | 📝 Draft       | G003             | —   |
| [SHY-0043](SHY-0043-add-push-permission-feature.md)             | P0  | S      | feature  | Add push_permission.feature BDD coverage (4 scenarios for PR #1010 denial UX)                    | 📝 Draft       | G006             | —   |
| [SHY-0044](SHY-0044-fix-admin-claim-throw.md)                   | P0  | XS     | bug      | firestore.rules: use isAdmin() helper at line 140 (fix admin-claim throws-on-absent)             | 📝 Draft       | G025             | —   |
| [SHY-0019](SHY-0019-fix-qa-runner-smoke-true.md)                | P1  | S      | infra    | qa-runner --smoke `\|\| true` → targeted exit-code handling                                      | 📝 Draft       | G012             | —   |
| [SHY-0031](SHY-0031-serialise-gh-pages-deploys.md)              | P1  | S      | infra    | Serialise gh-pages cross-workflow deploys (split-job + shared concurrency)                       | 📝 Draft       | G055             | —   |
| [SHY-0006](SHY-0006-add-push-permission-vm-tests.md)            | P1  | S      | bug      | PushPermissionDeniedBanner + HomeScreen + HomeViewModel push tests                               | 📝 Draft       | G005, G013, G029 | —   |
| [SHY-0008](SHY-0008-expand-economy-bdd-coverage.md)             | P1  | M      | feature  | Expand economy BDD coverage (subscription + gifting + backpack)                                  | 📝 Draft       | G017             | —   |
| [SHY-0007](SHY-0007-add-gacha-and-age-verification-features.md) | P1  | S      | feature  | gacha.feature + age_verification.feature (BDD coverage)                                          | 📝 Draft       | G007, G008       | —   |
| [SHY-0009](SHY-0009-add-lock-pin-security-nav-coverage.md)      | P1  | S      | feature  | Lock/PinSetup/SecuritySettings navigation coverage                                               | 📝 Draft       | G010             | —   |
| [SHY-0017](SHY-0017-add-ios-room-repo-tests.md)                 | P1  | M      | bug      | IosRoomRepositoryImpl tests (P2 client migration coverage)                                       | 📝 Draft       | G014             | —   |
| [SHY-0018](SHY-0018-add-ios-message-bridge-tests.md)            | P1  | M      | bug      | IosMessage + IosSeatRequest + IosEconomyGift + IosSmallRepositories + IosPushBridge tests        | 📝 Draft       | G015, G030       | —   |
| [SHY-0022](SHY-0022-seed-admin-keyboard-data-fixtures.md)       | P1  | M      | bug      | admin-keyboard data-dependent skip remediation                                                   | 📝 Draft       | G023             | —   |
| [SHY-0045](SHY-0045-sha-pin-floating-action-tags.md)            | P1  | XS     | infra    | SHA-pin floating Action tags in manual-qa-matrix + qa-runner-driver-checks workflows             | 📝 Draft       | G011             | —   |
| [SHY-0046](SHY-0046-verify-gift-wall-feature-e2e.md)            | P1  | XS     | chore    | Verify gift_wall.feature covers 3 UI states (loading/populated/empty) + GiftWallScreen test tags | 📝 Draft       | G018             | —   |
| [SHY-0047](SHY-0047-fix-admin-core-modules-skip.md)             | P1  | XS     | bug      | Fix bare test.skip() at admin-core-modules.spec.ts:133 (implement or remove)                     | 📝 Draft       | G024             | —   |
| [SHY-0048](SHY-0048-track-detekt-2-stable.md)                   | P1  | S      | chore    | Track detekt 2.0 stable release on Gradle Plugin Portal + migrate config when stable lands       | 📝 Draft       | G053             | —   |
| [SHY-0030](SHY-0030-refresh-ios-parity-navigation-feature.md)   | P2  | XS     | feature  | ios_parity_navigation.feature freshness check + update                                           | 📝 Draft       | G039             | —   |
| [SHY-0023](SHY-0023-seed-admin-backups-cross-tab-fixtures.md)   | P2  | S      | bug      | admin-backups + admin-cross-tab data fixture gaps                                                | 📝 Draft       | G033             | —   |
| [SHY-0016](SHY-0016-add-sticker-storage-tests.md)               | P2  | S      | bug      | StickerStorage platform tests (file I/O lifecycle)                                               | 📝 Draft       | G038             | —   |
| [SHY-0025](SHY-0025-upgrade-locale-parity-key-set.md)           | P2  | XS     | bug      | Locale parity test upgrade (key-set comparison) + PR #1010 string verification                   | 📝 Draft       | G042, G052       | —   |
| [SHY-0026](SHY-0026-add-mobile-driver-helper-scripts.md)        | P2  | S      | infra    | Mobile driver helper scripts (Android flags check + iOS WDA build)                               | 📝 Draft       | G043, G044       | —   |
| [SHY-0020](SHY-0020-add-release-to-qa-matrix-workflow-call.md)  | P2  | S      | infra    | release.yml → manual-qa-matrix.yml workflow_call (event-driven E2 matrix)                        | 📝 Draft       | G022, G049       | —   |
| [SHY-0028](SHY-0028-gradle-deprecation-sweep.md)                | P2  | S      | chore    | Gradle deprecation sweep (`--warning-mode all`)                                                  | 📝 Draft       | G046             | —   |
| [SHY-0027](SHY-0027-dependabot-sweep-codeql-kotlin.md)          | P2  | XS     | chore    | Dependabot open-PR sweep + CodeQL Kotlin enable                                                  | 📝 Draft       | G045, G047       | —   |
| [SHY-0049](SHY-0049-add-kotlin-prerelease-ci-gate.md)           | P2  | XS     | infra    | Add check-kotlin-prerelease.sh CI gate (fires when Kotlin stable lands)                          | 📝 Draft       | G031             | —   |
| [SHY-0050](SHY-0050-add-biometric-alpha-rationale-comment.md)   | P2  | XS     | docs     | Add rationale comment to biometric = "1.4.0-alpha07" (companion to SHY-0005)                     | 📝 Draft       | G032             | —   |
| [SHY-0051](SHY-0051-fix-touch-drag-skip-mouse-event.md)         | P2  | XS     | bug      | Convert Firefox/WebKit touch-skip in suggestions-board to mouse-event drag                       | 📝 Draft       | G034             | —   |
| [SHY-0052](SHY-0052-fix-mobile-isMobile-skip-viewport.md)       | P2  | S      | bug      | Rewrite admin-suggestions.spec.ts mobile-context skips using viewport sizing                     | 📝 Draft       | G035             | —   |
| [SHY-0053](SHY-0053-fix-sonarcloud-yml-true-swallow.md)         | P2  | XS     | bug      | Remove `\|\| true` from sonarcloud.yml coverage step (was silently swallowing Jest failures)     | 📝 Draft       | G036             | —   |
| [SHY-0054](SHY-0054-audit-allure-report-continue-on-error.md)   | P2  | XS     | chore    | Audit allure-report.yml continue-on-error: true (intentional or remove)                          | 📝 Draft       | G037             | —   |
| [SHY-0055](SHY-0055-update-claude-md-feature-count.md)          | P2  | XS     | docs     | Update CLAUDE.md stale feature-file count (33 → 47)                                              | 📝 Draft       | G040             | —   |
| [SHY-0056](SHY-0056-document-app-lock-nav-pattern.md)           | P2  | XS     | docs     | Document App Lock navigation intercept pattern in CLAUDE.md Architecture                         | 📝 Draft       | G041             | —   |
| [SHY-0057](SHY-0057-split-admin-keyboard-mobile-skip.md)        | P2  | XS     | bug      | Split admin-keyboard.spec.ts:61 mobile-viewport skip (keyboard-only vs general)                  | 📝 Draft       | G048             | —   |
| [SHY-0058](SHY-0058-fix-dev-sanity-api-skip.md)                 | P2  | XS     | bug      | Convert dev-sanity.spec.ts:66-72 API-not-running skip to CI-aware assertion                      | 📝 Draft       | G050             | —   |
| [SHY-0059](SHY-0059-fix-admin-users-moderation-skip.md)         | P2  | XS     | bug      | Audit admin-users-moderation.spec.ts:149 conditional skip + seed required data                   | 📝 Draft       | G051             | —   |

## Done

| ID                                                 | Pri | Effort | Type     | Title                                                                                               | Status  | Roadmap IDs | PR                                                       |
| -------------------------------------------------- | --- | ------ | -------- | --------------------------------------------------------------------------------------------------- | ------- | ----------- | -------------------------------------------------------- |
| [SHY-0001](SHY-0001-establish-agile-workflow.md)   | P1  | M      | infra    | Establish Agile user-story way of working                                                           | ✅ Done | —           | [#1034](https://github.com/Shyden-Ltd/ShyTalk/pull/1034) |
| [SHY-0002](SHY-0002-wire-github-integration.md)    | P1  | M      | infra    | Wire GitHub Issues + Projects v2 integration                                                        | ✅ Done | —           | [#1035](https://github.com/Shyden-Ltd/ShyTalk/pull/1035) |
| [SHY-0003](SHY-0003-convert-roadmap-to-stories.md) | P1  | L      | chore    | Convert zero-gap roadmap to user stories + cross-label                                              | ✅ Done | G054        | [#1036](https://github.com/Shyden-Ltd/ShyTalk/pull/1036) |
| [SHY-0032](SHY-0032-refine-skeleton-acs.md)        | P0  | L      | chore    | Refine the 28 skeleton SHYs + codify no-skeleton rule                                               | ✅ Done | —           | [#1037](https://github.com/Shyden-Ltd/ShyTalk/pull/1037) |
| [SHY-0033](SHY-0033-investigate-stale-branches.md) | P0  | M      | chore    | Investigate 506-branch sprawl + close stale + 1-active-branch                                       | ✅ Done | —           | [#1038](https://github.com/Shyden-Ltd/ShyTalk/pull/1038) |
| [SHY-0034](SHY-0034-tag-only-release-flow.md)      | P0  | L      | refactor | Re-architect release.yml to tag-only signed-commit flow (eliminate ephemeral `release/v*` branches) | ✅ Done | —           | [#1040](https://github.com/Shyden-Ltd/ShyTalk/pull/1040) |
| [SHY-0035](SHY-0035-investigate-repo-size.md)      | P0  | M      | chore    | Investigate >1GB repo size + audit + add >5MB lint                                                  | ✅ Done | —           | [#1041](https://github.com/Shyden-Ltd/ShyTalk/pull/1041) |
| [SHY-0036](SHY-0036-fill-missing-g-ids.md)         | P0  | XL     | chore    | Fill 19 missing G-IDs as fully-refined SHYs + roadmap-to-SHY mapping table                          | ✅ Done | (19 G-IDs)  | [#1042](https://github.com/Shyden-Ltd/ShyTalk/pull/1042) |
| [SHY-0037](SHY-0037-introduce-epics.md)            | P0  | M      | infra    | Introduce EPICs concept + `epic:` frontmatter field + EPIC validator + CLAUDE.md spec               | ✅ Done | —           | [#1043](https://github.com/Shyden-Ltd/ShyTalk/pull/1043) |

## Cancelled

_None yet._

## Reserved (planned, not yet filed)

These IDs are reserved by the SHY-0032 + SHY-0033 multi-PR plan (operator 2026-06-07). Files don't exist yet; they'll be created as fully-refined SHYs (per [[feedback-no-skeleton-stories-fully-refined]]) when each predecessor lands. Per [[feedback-one-active-branch-close-on-finish]]: only one of these may have an active branch at a time.

| Reserved ID  | Title (planned)                                                                                                                                                                                                       | Trigger                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| ~~SHY-0039~~ | ~~CI workflow for SHY → roadmap-data.json auto-sync~~ — **ABSORBED into SHY-0038 (Option D)** per operator quality-over-speed reframe (2026-06-08 ~18:38 BST). Slot freed for next concern.                           | —                                                        |
| SHY-0040     | Optimise `sync-stories-to-issues.sh` per-file overhead (currently ~620ms/file, 34 files = 21s; bottleneck is jq+awk subprocess churn)                                                                                 | When SHY corpus hits ~50 files or sync timeout escalates |
| SHY-0061     | Public roadmap renderer reads SHY-derived `phases[].items[]` (currently consumes only `phases[].features[]`); adds per-phase SHY section with shyId badges                                                            | After SHY-0038 merges (sync infra in place)              |
| SHY-0062     | Staged migration of ~95 legacy `phases[].features[]` entries into fully-refined SHYs with `public: true`. Batched by phase (~8 follow-up SHYs at ~12 features each); preserves user-visible content during transition | After SHY-0061 merges (renderer reads `items[]`)         |

---

## EPICs

| EPIC      | Title                                                      | Status      | Child SHYs                                      |
| --------- | ---------------------------------------------------------- | ----------- | ----------------------------------------------- |
| EPIC-0001 | ShyTalk SHY framework (stories, validator, GH sync, EPICs) | In Progress | SHY-0001, SHY-0002, SHY-0003, SHY-0037 (4 SHYs) |

EPICs are validated by `scripts/check-epic-frontmatter.sh` (separate from the SHY validator). The `epic:` field on SHY frontmatter is optional — most SHYs need not belong to an EPIC. See `CLAUDE.md` § "Agile Way of Working" → "### EPICs" for the full spec.

---

## Conventions

- **ID:** `SHY-XXXX` (4-digit zero-padded, sequential; no recycling).
- **File path:** `.project/stories/SHY-XXXX-kebab-slug.md`.
- **Granularity:** 1 PR-bundle = 1 SHY (multi-G bundles list every G-ID in `roadmap_ids` frontmatter).
- **Lifecycle:** stories stay in place after merge; `status` flips in frontmatter; this index updates in lockstep.
- **Tooling:** `scripts/check-story-frontmatter.sh` validates every `SHY-[0-9][0-9][0-9][0-9]-*.md` in CI. This `SHY-INDEX.md` file is human-maintained — the 4-digit ID glob excludes it from validation.
- **No skeletons:** every new SHY is born fully refined ([[feedback-no-skeleton-stories-fully-refined]]); `N/A — TBD refinement on pickup` is forbidden.

See `CLAUDE.md` § "Agile Way of Working" for the full spec (frontmatter, body sections, AC depth, BDD format, lifecycle, naming convention, Done bar per `type`).

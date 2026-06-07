# SHY Story Index

Live backlog of every piece of work captured under the Agile way of working ([[feedback-agile-user-stories]]). Each row maps one PR-bundle to one detailed story file at `.project/stories/SHY-XXXX-slug.md`. Every story is born fully refined per [[feedback-no-skeleton-stories-fully-refined]] — no skeleton placeholders allowed.

**Status legend:** 📝 Draft · 🚧 In Progress · 👀 In Review · ✅ Done · ❌ Cancelled

**Sort order (Active section):** `priority` ascending, then `created` ascending, then `id` ascending. P0 always tops.

## Active

| ID                                                              | Pri | Effort | Type     | Title                                                                                     | Status         | Roadmap IDs      | PR  |
| --------------------------------------------------------------- | --- | ------ | -------- | ----------------------------------------------------------------------------------------- | -------------- | ---------------- | --- |
| [SHY-0024](SHY-0024-resolve-navgraph-coexistence.md)            | P0  | L      | refactor | Migrate Android to SharedNavGraph + delete NavGraph.kt                                    | 📝 Draft       | G028             | —   |
| [SHY-0032](SHY-0032-refine-skeleton-acs.md)                     | P0  | L      | chore    | Refine the 28 skeleton SHYs + codify no-skeleton rule                                     | 🚧 In Progress | —                | —   |
| [SHY-0004](SHY-0004-verify-room-mutation-p3-deploy.md)          | P0  | S      | bug      | Verify Room mutation P3 deploy status + reconcile                                         | 📝 Draft       | G009, G027       | —   |
| [SHY-0029](SHY-0029-tighten-ownerfirebaseuid-rule.md)           | P0  | S      | bug      | Tighten ownerFirebaseUid rule (strict equality, no legacy fallback)                       | 📝 Draft       | G026             | —   |
| [SHY-0015](SHY-0015-add-secure-storage-contract-tests.md)       | P0  | S      | bug      | SecureStorage + CryptoKeyPair contract tests                                              | 📝 Draft       | G019             | —   |
| [SHY-0005](SHY-0005-biometric-alpha-to-stable.md)               | P0  | XS     | infra    | Biometric alpha → stable (downgrade or rationale comment)                                 | 📝 Draft       | G002             | —   |
| [SHY-0021](SHY-0021-add-cron-account-deletion-endpoint-test.md) | P0  | S      | infra    | cron-account-deletion endpoint integration test (auth coverage)                           | 📝 Draft       | G021             | —   |
| [SHY-0013](SHY-0013-add-core-infra-tests.md)                    | P0  | M      | infra    | RoomLifecycleManager + AnimationQueue + ModerationFilter tests                            | 📝 Draft       | G004, G020       | —   |
| [SHY-0011](SHY-0011-add-economy-vm-tests.md)                    | P0  | M      | bug      | Wallet + Gifting + TransactionHistory VM tests                                            | 📝 Draft       | G003-D2          | —   |
| [SHY-0014](SHY-0014-add-room-service-controller-tests.md)       | P0  | M      | bug      | Android/Ios RoomServiceController tests + FakeRoomLifecycleManager extraction             | 📝 Draft       | G016             | —   |
| [SHY-0010](SHY-0010-add-home-gacha-vm-tests.md)                 | P0  | M      | bug      | HomeViewModel + GachaViewModel tests                                                      | 📝 Draft       | G003-D1          | —   |
| [SHY-0012](SHY-0012-add-remaining-vm-tests.md)                  | P0  | L      | bug      | 10 remaining ViewModel test files (Messaging + Profile + Settings + Daily + Splash)       | 📝 Draft       | G003-D3          | —   |
| [SHY-0019](SHY-0019-fix-qa-runner-smoke-true.md)                | P1  | S      | infra    | qa-runner --smoke `\|\| true` → targeted exit-code handling                               | 📝 Draft       | G012             | —   |
| [SHY-0031](SHY-0031-serialise-gh-pages-deploys.md)              | P1  | S      | infra    | Serialise gh-pages cross-workflow deploys (split-job + shared concurrency)                | 📝 Draft       | G055             | —   |
| [SHY-0006](SHY-0006-add-push-permission-vm-tests.md)            | P1  | S      | bug      | PushPermissionDeniedBanner + HomeScreen + HomeViewModel push tests                        | 📝 Draft       | G005, G013, G029 | —   |
| [SHY-0008](SHY-0008-expand-economy-bdd-coverage.md)             | P1  | M      | feature  | Expand economy BDD coverage (subscription + gifting + backpack)                           | 📝 Draft       | G017             | —   |
| [SHY-0007](SHY-0007-add-gacha-and-age-verification-features.md) | P1  | S      | feature  | gacha.feature + age_verification.feature (BDD coverage)                                   | 📝 Draft       | G007, G008       | —   |
| [SHY-0009](SHY-0009-add-lock-pin-security-nav-coverage.md)      | P1  | S      | feature  | Lock/PinSetup/SecuritySettings navigation coverage                                        | 📝 Draft       | G010             | —   |
| [SHY-0017](SHY-0017-add-ios-room-repo-tests.md)                 | P1  | M      | bug      | IosRoomRepositoryImpl tests (P2 client migration coverage)                                | 📝 Draft       | G014             | —   |
| [SHY-0018](SHY-0018-add-ios-message-bridge-tests.md)            | P1  | M      | bug      | IosMessage + IosSeatRequest + IosEconomyGift + IosSmallRepositories + IosPushBridge tests | 📝 Draft       | G015, G030       | —   |
| [SHY-0022](SHY-0022-seed-admin-keyboard-data-fixtures.md)       | P1  | M      | bug      | admin-keyboard data-dependent skip remediation                                            | 📝 Draft       | G023             | —   |
| [SHY-0030](SHY-0030-refresh-ios-parity-navigation-feature.md)   | P2  | XS     | feature  | ios_parity_navigation.feature freshness check + update                                    | 📝 Draft       | G039             | —   |
| [SHY-0023](SHY-0023-seed-admin-backups-cross-tab-fixtures.md)   | P2  | S      | bug      | admin-backups + admin-cross-tab data fixture gaps                                         | 📝 Draft       | G033             | —   |
| [SHY-0016](SHY-0016-add-sticker-storage-tests.md)               | P2  | S      | bug      | StickerStorage platform tests (file I/O lifecycle)                                        | 📝 Draft       | G038             | —   |
| [SHY-0025](SHY-0025-upgrade-locale-parity-key-set.md)           | P2  | XS     | bug      | Locale parity test upgrade (key-set comparison) + PR #1010 string verification            | 📝 Draft       | G042, G052       | —   |
| [SHY-0026](SHY-0026-add-mobile-driver-helper-scripts.md)        | P2  | S      | infra    | Mobile driver helper scripts (Android flags check + iOS WDA build)                        | 📝 Draft       | G043, G044       | —   |
| [SHY-0020](SHY-0020-add-release-to-qa-matrix-workflow-call.md)  | P2  | S      | infra    | release.yml → manual-qa-matrix.yml workflow_call (event-driven E2 matrix)                 | 📝 Draft       | G022, G049       | —   |
| [SHY-0028](SHY-0028-gradle-deprecation-sweep.md)                | P2  | S      | chore    | Gradle deprecation sweep (`--warning-mode all`)                                           | 📝 Draft       | G046             | —   |
| [SHY-0027](SHY-0027-dependabot-sweep-codeql-kotlin.md)          | P2  | XS     | chore    | Dependabot open-PR sweep + CodeQL Kotlin enable                                           | 📝 Draft       | G045, G047       | —   |

## Done

| ID                                                 | Pri | Effort | Type  | Title                                                  | Status  | Roadmap IDs | PR                                                       |
| -------------------------------------------------- | --- | ------ | ----- | ------------------------------------------------------ | ------- | ----------- | -------------------------------------------------------- |
| [SHY-0001](SHY-0001-establish-agile-workflow.md)   | P1  | M      | infra | Establish Agile user-story way of working              | ✅ Done | —           | [#1034](https://github.com/Shyden-Ltd/ShyTalk/pull/1034) |
| [SHY-0002](SHY-0002-wire-github-integration.md)    | P1  | M      | infra | Wire GitHub Issues + Projects v2 integration           | ✅ Done | —           | [#1035](https://github.com/Shyden-Ltd/ShyTalk/pull/1035) |
| [SHY-0003](SHY-0003-convert-roadmap-to-stories.md) | P1  | L      | chore | Convert zero-gap roadmap to user stories + cross-label | ✅ Done | G054        | [#1036](https://github.com/Shyden-Ltd/ShyTalk/pull/1036) |

## Cancelled

_None yet._

## Reserved (planned, not yet filed)

These IDs are reserved by the SHY-0032 multi-PR plan. Files don't exist yet; they'll be created as fully-refined SHYs (per [[feedback-no-skeleton-stories-fully-refined]]) when each predecessor lands.

| Reserved ID | Title (planned)                                                                                                                                                | Trigger               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| SHY-0033    | Fill 18 missing G-IDs as fully-refined SHYs (G001, G003, G006, G011, G018, G024, G025, G031, G032, G034, G035, G036, G037, G040, G041, G048, G050, G051, G053) | After SHY-0032 merges |
| SHY-0034    | Introduce EPICs + `epic:` frontmatter field + CLAUDE.md spec updates                                                                                           | After SHY-0033 merges |
| SHY-0035    | Refactor public roadmap webpage + add GitHub project board link                                                                                                | After SHY-0034 merges |
| SHY-0036    | CI workflow for SHY → roadmap-data.json auto-sync                                                                                                              | After SHY-0035 merges |

---

## Conventions

- **ID:** `SHY-XXXX` (4-digit zero-padded, sequential; no recycling).
- **File path:** `.project/stories/SHY-XXXX-kebab-slug.md`.
- **Granularity:** 1 PR-bundle = 1 SHY (multi-G bundles list every G-ID in `roadmap_ids` frontmatter).
- **Lifecycle:** stories stay in place after merge; `status` flips in frontmatter; this index updates in lockstep.
- **Tooling:** `scripts/check-story-frontmatter.sh` validates every `SHY-[0-9][0-9][0-9][0-9]-*.md` in CI. This `SHY-INDEX.md` file is human-maintained — the 4-digit ID glob excludes it from validation.
- **No skeletons:** every new SHY is born fully refined ([[feedback-no-skeleton-stories-fully-refined]]); `N/A — TBD refinement on pickup` is forbidden.

See `CLAUDE.md` § "Agile Way of Working" for the full spec (frontmatter, body sections, AC depth, BDD format, lifecycle, naming convention, Done bar per `type`).

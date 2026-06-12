# SHY Story Index

Live backlog of every piece of work captured under the Agile way of working ([[feedback-agile-user-stories]]). Each row maps one PR-bundle to one detailed story file at `.project/stories/SHY-XXXX-slug.md`. Every story is born fully refined per [[feedback-no-skeleton-stories-fully-refined]] — no skeleton placeholders allowed.

**Status legend:** 📝 Draft · 🚧 In Progress · 👀 In Review · ✅ Done · ❌ Cancelled

**Sort order (Active section):** `priority` ascending, then `created` ascending (matches CLAUDE.md § Story ID + file layout). Within the same `priority` + `created`, the row order is operator-curated to reflect the **tier prioritisation** (Tier 1 unblocker → Tier 1 security → Tier 2 reliability → ...) — this is operator-validated signal beyond strict mechanical sort. P0 always tops; in-progress SHYs surface at the top of their priority band for immediate visibility.

## Active

| ID                                                              | Pri | Effort | Type     | Title                                                                                            | Status         | Roadmap IDs      | PR  |
| --------------------------------------------------------------- | --- | ------ | -------- | ------------------------------------------------------------------------------------------------ | -------------- | ---------------- | --- |
| [SHY-0087](SHY-0087-parallelize-ios-smoke-with-deploy.md)       | P1  | S      | infra    | Run the iOS boot smoke in parallel with the iOS App Store deploy (~25 min saving)                | 📝 Draft       | —                | —   |
| [SHY-0088](SHY-0088-cache-cocoapods-instrument-ios-archive.md)  | P1  | M      | infra    | Instrument + cache the 29-min iOS `xcodebuild archive` (CocoaPods compile)                       | 📝 Draft       | —                | —   |
| [SHY-0089](SHY-0089-gradle-build-cache-kn-ios-link.md)          | P2  | M      | infra    | Build-cache the 22-min Kotlin/Native iOS framework link (feasibility-gated)                      | 📝 Draft       | —                | —   |
| [SHY-0060](SHY-0060-age-gating-per-feature.md)                  | P0  | XL     | feature  | Age-gating per feature: tiered per-feature age thresholds replacing single 13+ signup gate       | 📝 Draft       | —                | —   |
| [SHY-0071](SHY-0071-sync-wall-clock-batching.md)                | P1  | M      | refactor | Sync wall-clock: batch gh lookups (one upfront list → map) + scan-mode validation (36.2s→≤6s)      | 📝 Draft       | —                | —   |
| [SHY-0062](SHY-0062-migrate-legacy-roadmap-features.md)         | P1  | XL     | chore    | Migrate ~95 legacy roadmap features into tracked stories (meta/tracker; EPIC-0002)                | 📝 Draft       | —                | —   |
| [SHY-0070](SHY-0070-system-routes-observability.md)             | P2  | S      | feature  | System-routes observability: structured sweep logging + {swept,errors} plumbing                   | 📝 Draft       | —                | —   |
| [SHY-0024](SHY-0024-resolve-navgraph-coexistence.md)            | P0  | L      | refactor | Migrate Android to SharedNavGraph + delete NavGraph.kt                                           | 📝 Draft       | G028             | —   |
| [SHY-0029](SHY-0029-tighten-ownerfirebaseuid-rule.md)           | P0  | S      | bug      | Tighten ownerFirebaseUid rule (strict equality, no legacy fallback)                              | 📝 Draft       | G026             | —   |
| [SHY-0015](SHY-0015-add-secure-storage-contract-tests.md)       | P0  | S      | bug      | SecureStorage + CryptoKeyPair contract tests                                                     | 📝 Draft       | G019             | —   |
| [SHY-0005](SHY-0005-biometric-alpha-to-stable.md)               | P0  | XS     | infra    | Biometric alpha → stable (downgrade or rationale comment)                                        | 📝 Draft       | G002             | —   |
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
| [SHY-0038](SHY-0038-public-roadmap-gh-project-link.md)          | P0  | L      | infra    | Full bidirectional sync: SHY .md → roadmap-data.json auto-regen + GH Project board link              | ✅ Done | —           | [#1044](https://github.com/Shyden-Ltd/ShyTalk/pull/1044) |
| [SHY-0063](SHY-0063-fix-sync-roadmap-signed-commits.md)          | P0  | S      | bug      | Fix SHY-0038 sync workflow — signed commits via Release App createCommitOnBranch                     | ✅ Done | —           | [#1045](https://github.com/Shyden-Ltd/ShyTalk/pull/1045) |
| [SHY-0064](SHY-0064-fix-sync-jq-argv-too-long.md)                | P0  | XS     | bug      | Fix SHY-0063 sync workflow — jq ARG_MAX (single-jq pipeline for 177KB payload)                       | ✅ Done | —           | [#1046](https://github.com/Shyden-Ltd/ShyTalk/pull/1046) |
| [SHY-0065](SHY-0065-release-yml-single-jq-pattern.md)            | P1  | XS     | refactor | Apply single-jq inline-additions pattern to release.yml (preventive — mirror SHY-0064 sync fix)      | ✅ Done | —           | [#1048](https://github.com/Shyden-Ltd/ShyTalk/pull/1048) |
| [SHY-0066](SHY-0066-migrate-required-status-checks-to-ruleset.md) | P0 | XS     | infra    | Migrate `required_status_checks` from classic protection to ruleset 12613584 (unblock sync+release)  | ✅ Done | —           | [#1047](https://github.com/Shyden-Ltd/ShyTalk/pull/1047) |
| [SHY-0067](SHY-0067-fix-shy-0002-mirror-comprehensive.md)        | P0  | L      | bug      | Fix SHY-0002 mirror — 4 stacked defects (auth + label auto-create + silent-failure + board + Type)   | ✅ Done | —           | [#1049](https://github.com/Shyden-Ltd/ShyTalk/pull/1049) |
| [SHY-0004](SHY-0004-verify-room-mutation-p3-deploy.md)          | P0  | S      | bug      | Verify Room mutation P3 deploy status + reconcile                                                | ✅ Done        | G009, G027       | [#1126](https://github.com/Shyden-Ltd/ShyTalk/pull/1126) |
| [SHY-0021](SHY-0021-add-cron-account-deletion-endpoint-test.md) | P0  | S      | infra    | cron-account-deletion endpoint integration test (auth coverage)                                  | ✅ Done        | G021             | [#1120](https://github.com/Shyden-Ltd/ShyTalk/pull/1120) |
| [SHY-0040](SHY-0040-sync-script-per-file-overhead.md)           | P1  | S      | refactor | Cut sync-stories-to-issues.sh per-file subprocess overhead (37.3s→≤10s for 66 files)              | ✅ Done        | —                | [#1121](https://github.com/Shyden-Ltd/ShyTalk/pull/1121) |
| [SHY-0061](SHY-0061-renderer-reads-shy-items.md)                | P0  | M      | feature  | Roadmap renderer reads SHY-derived `phases[].items[]` with shyId badges                           | ✅ Done        | —                | [#1117](https://github.com/Shyden-Ltd/ShyTalk/pull/1117) |
| [SHY-0068](SHY-0068-cache-sonar-engine-jar-ci.md)                | P1  | S      | infra    | Cache SonarCloud scanner-engine JAR in CI (eliminate WAF-flake download)                          | ✅ Done        | —                | [#1119](https://github.com/Shyden-Ltd/ShyTalk/pull/1119) |
| [SHY-0069](SHY-0069-pin-local-node-and-hook-observability.md)   | P0  | S      | infra    | Pin local Node to CI version + pre-push hook observability + watchman config                      | ✅ Done        | —                | [#1114](https://github.com/Shyden-Ltd/ShyTalk/pull/1114) |
| [SHY-0072](SHY-0072-lazy-translation-service.md)                | P1  | M      | feature  | Lazy translation service: translate-on-first-view + server cache + fail-silent + miss queue       | ✅ Done        | —                | [#1132](https://github.com/Shyden-Ltd/ShyTalk/pull/1132) |
| [SHY-0073](SHY-0073-renderer-lazy-i18n-and-gated-story-links.md) | P1  | M      | feature  | Renderer: lazy item translations + gated GitHub story links (once-per-session confirm)            | ✅ Done        | —                | [#1133](https://github.com/Shyden-Ltd/ShyTalk/pull/1133) |
| [SHY-0074](SHY-0074-mirror-fidelity-board-body-labels.md)       | P1  | XL     | bug      | Mirror architecture v2: bugs-only Issues, draft cards for stories, faithful board columns         | ✅ Done        | —                | [#1134](https://github.com/Shyden-Ltd/ShyTalk/pull/1134) |
| [SHY-0078](SHY-0078-mirror-idempotent-create-guard.md)          | P1  | M      | bug      | Mirror create-path idempotency guard (issue dedup + items-map empty-read retry)                   | ✅ Done        | —                | [#1243](https://github.com/Shyden-Ltd/ShyTalk/pull/1243) |
| [SHY-0079](SHY-0079-draft-dedup-sidecar.md)                     | P1  | L      | bug      | Draft-dedup sidecar: board-items.json consistent id-map overlaying the laggy Projects v2 query     | ✅ Done        | —                | [#1272](https://github.com/Shyden-Ltd/ShyTalk/pull/1272) |
| [SHY-0080](SHY-0080-argmax-safe-map-merge.md)                   | P0  | S      | bug      | ARG_MAX-safe items-map merges (stdin not --argjson) — the deterministic board-duplication root cause | ✅ Done        | —                | [#1274](https://github.com/Shyden-Ltd/ShyTalk/pull/1274) |
| [SHY-0081](SHY-0081-mirror-v3-uniform-board-drafts.md)          | P1  | L      | refactor | Mirror v3: every story (incl. bug) is a board draft card; the Issues page is reserved for bug reports | ✅ Done        | —                | [#1305](https://github.com/Shyden-Ltd/ShyTalk/pull/1305) |
| [SHY-0082](SHY-0082-mirror-v4-typed-issues.md)                  | P1  | XL     | refactor | Mirror v4: every story is a real typed GitHub issue (Bug/Feature/Task), never a draft                | ✅ Done        | —                | [#1308](https://github.com/Shyden-Ltd/ShyTalk/pull/1308) |
| [SHY-0083](SHY-0083-mvp-frontmatter-field.md)                   | P1  | S      | infra    | Add optional `mvp:` frontmatter field (MVP launch-set classification flag)                           | ✅ Done        | —                | [#1307](https://github.com/Shyden-Ltd/ShyTalk/pull/1307) |
| [SHY-0084](SHY-0084-prod-deploy-gate-and-smoke-fixes.md)        | P0  | M      | bug      | Consolidate prod-deploy approval gates + fix Android & iOS boot smoke tests (released_in v0.97.14)   | ✅ Done        | —                | [#1389](https://github.com/Shyden-Ltd/ShyTalk/pull/1389) |
| [SHY-0085](SHY-0085-board-sync-loud-degraded-read.md)           | P2  | S      | infra    | Make a fully-degraded board items-map read LOUD (sidecar-only sync warning) (released_in v0.97.13)   | ✅ Done        | —                | [#1391](https://github.com/Shyden-Ltd/ShyTalk/pull/1391) |
| [SHY-0086](SHY-0086-speed-up-prod-deploy-pipeline.md)           | P0  | M      | spike    | Investigate + speed up the entire prod-deploy pipeline (spike — findings + SHY-0087/0088/0089)       | ✅ Done        | —                | [#1399](https://github.com/Shyden-Ltd/ShyTalk/pull/1399) |

## Cancelled

_None yet._

## Reserved (planned, not yet filed)

These IDs are reserved by the SHY-0032 + SHY-0033 multi-PR plan (operator 2026-06-07). Files don't exist yet; they'll be created as fully-refined SHYs (per [[feedback-no-skeleton-stories-fully-refined]]) when each predecessor lands. Per [[feedback-one-active-branch-close-on-finish]]: only one of these may have an active branch at a time.

| Reserved ID  | Title (planned)                                                                                                                                                                                                       | Trigger                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| ~~SHY-0039~~ | ~~CI workflow for SHY → roadmap-data.json auto-sync~~ — **ABSORBED into SHY-0038 (Option D)** per operator quality-over-speed reframe (2026-06-08 ~18:38 BST). Slot freed for next concern.                           | —                                                        |
| ~~SHY-0070~~ | ~~System-routes observability~~ — **FILED 2026-06-10** (see Active table)                                                                                                                                            | —                                                        |
| ~~SHY-0071~~ | ~~Sync wall-clock batching~~ — **FILED 2026-06-10** (see Active table)                                                                                                                                                | —                                                        |
| ~~SHY-0040~~ | ~~Optimise sync-stories-to-issues.sh per-file overhead~~ — **FILED 2026-06-10** (see Active table)                                                                                                                    | —                                                        |
| ~~SHY-0061~~ | ~~Public roadmap renderer reads SHY-derived `phases[].items[]`~~ — **FILED 2026-06-09** (see Active table)                                                                                                           | —                                                        |
| ~~SHY-0062~~ | ~~Staged migration of ~95 legacy features~~ — **FILED 2026-06-10** (see Active table; EPIC-0002)                                                                                                              | —                                                        |

---

## EPICs

| EPIC      | Title                                                      | Status      | Child SHYs                                      |
| --------- | ---------------------------------------------------------- | ----------- | ----------------------------------------------- |
| EPIC-0001 | ShyTalk SHY framework (stories, validator, GH sync, EPICs) | In Progress | SHY-0001, SHY-0002, SHY-0003, SHY-0037 (4 SHYs) |
| EPIC-0002 | Public roadmap story-migration + lazy translation platform | In Progress | SHY-0062, SHY-0072, SHY-0073 (+batches as filed) |

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

# MVP-Draft backlog reconciliation — 2026-07-08

**Scope:** all 45 stories with `mvp: true` AND `status: Draft`, checked against current code (`develop` @ `82905619ecd`) + presence at the last release `v0.97.15`.
**Why:** the board had drifted — many "Draft" rows are already built. This audit reconciles the board (SHY-0167) and states what MVP work is *genuinely* left.

## Headline

| Bucket | Count | Meaning |
|---|---|---|
| **DONE-IN-CODE → reclassified** | 10 (22%) | Deliverable already in the code + verified against the story's AC → Done/In Review/Cancelled. |
| **PARTIAL (Android-only, iOS gap) → kept Draft** | 3 (7%) | Tests exist but in the wrong source set/framework vs the AC → real Tri-Platform gap surfaced. |
| **OPEN** | 26 (58%) | Genuinely not done → stays Draft; broken down by *gate* below. |
| **CANT-TELL** | 6 (13%) | Needs a runtime/dispatch/repo-var check → stays Draft. |

**~22% of the MVP-Draft backlog was already delivered and mislabelled** (another 7% partially). Of the 26 genuinely-open, only **7 are fully local-autonomous**; the rest are gated on real devices, the web stack, upstream releases, or an operator decision.

> **Correction (post code-reviewer verification):** the initial pass counted 13 DONE-IN-CODE, but SHY-0010/0012/0042's ViewModel tests, though present, live in `app/src/test` (JUnit4 + MockK, Android-only) not `shared/commonTest` (kotlin.test) as their AC requires — so the cross-platform ViewModels have **zero iOS test-execution proof**. Those 3 were reverted to Draft with the gap documented rather than marked delivered. A wrong "Done" hides a gap; the audit's job is to surface it.

## Board corrections applied (SHY-0167)

| SHY | Reclassified | released_in | Evidence (current code) |
|---|---|---|---|
| 0005 | → **Done** | v0.97.15 | `libs.versions.toml` `biometric = "1.1.0"` (stable) |
| 0041 | → **Done** | v0.97.15 | `libs.versions.toml` `kotlin = "2.4.0"` (stable, no RC) |
| 0044 | → **Done** | v0.97.15 | `firestore.rules` uses `isAdmin()` (def @38, 27 sites); direct `token.admin` only a comment @33 |
| 0045 | → **Done** | v0.97.15 | `manual-qa-matrix.yml` actions SHA-pinned (0 floating `@vN`) |
| 0053 | → **Done** | v0.97.15 | `sonarcloud.yml` Jest coverage step: `|| true` removed (its cited G036 target) |
| 0055 | → **Done** | v0.97.15 | `CLAUDE.md` "48 files, ~235 scenarios" (was stale "33"). Minor: AC's optional `<!-- last verified -->` comment not added — micro-follow-up, not blocking. |
| 0025 | → **In Review** | — | `compose-resources-locale-parity.test.js` upgraded to key-set (no-missing/no-extra) |
| 0051 | → **In Review** | — | `suggestions-board.spec.ts` skip → real mouse-drag (Closes G034); 0 skips |
| 0052 | → **In Review** | — | `admin-suggestions.spec.ts` isMobile skips → viewport sizing (G035); 9 remaining skips are unrelated data/platform guards |
| 0050 | → **Cancelled** | — | Moot: SHY-0005 moved biometric to stable, so no alpha pin to annotate |

*Done stories carry `released_in: v0.97.15` = a **verified-containing** release (`git show v0.97.15:<path>`); the earliest-containing release was not back-traced. In-Review = delivered on develop, awaiting the next release cut (same state as SHY-0060/0165/0166).*

### PARTIAL — kept Draft (code-reviewer found an AC-deviation gap)

| SHY | Verdict | Gap |
|---|---|---|
| 0010 | **kept Draft** | `HomeViewModelTest.kt`/`GachaViewModelTest.kt` exist but at `app/src/test/java/…` (JUnit4 + MockK, Android-only), not `shared/commonTest` (kotlin.test) as the AC requires. ViewModels are in `shared/commonMain` → **zero iOS test-execution proof**. |
| 0012 | **kept Draft** | all 10 ViewModel test files exist, same `app/src/test` + MockK deviation → iOS-uncovered. |
| 0042 | **kept Draft** | VM-coverage tracker: its tracked tests exist but Android-only (same deviation), so the cross-platform coverage goal is unmet on iOS. |

**These 3 are a live Tri-Platform gap** (all 15 G003 P0 ViewModels have Android-JVM proof only). **Operator decision needed:** accept `app/src/test`+MockK as the standard and rewrite these ACs, OR file a follow-up to relocate/reimplement in `shared/commonTest` for real iOS execution. Kept Draft (not marked delivered) so the gap stays visible.

## What's genuinely left — 26 OPEN, by gate

### A. Fully local-autonomous (no device, no running stack, no operator) — 7 — *the actionable queue*
| SHY | P | What the fix touches |
|---|---|---|
| **0056** | P2 | `CLAUDE.md` — add an "App-Lock navigation" subsection (`*.md`-only, trivial) |
| **0013** | P0 | `shared/src/commonTest/.../RoomLifecycleManagerTest.kt` — host-JVM (`:shared:jvmTest`); siblings AnimationQueue/ModerationFilter already tested |
| **0049** | P2 | author `scripts/check-kotlin-prerelease.sh` + Jest + wire into `lint.yml`/pre-push |
| **0019** | P1 | `manual-qa-runner.js` `--smoke-ignore-connect-errors` flag; drop `|| true` at `qa-runner-driver-checks.yml:141` + exit-code Jest |
| **0020** | P2 | `on: workflow_call` in `manual-qa-matrix.yml` + `qa-matrix-post-release` job in `release.yml` + YAML-parse Jest |
| **0031** | P1 | split Pages workflows build/deploy + shared `group: gh-pages-deploy` + concurrency Jest |
| **0071** | P1 | batch per-file `gh issue list` + `check-story-frontmatter.sh --scan` in `sync-stories-to-issues.sh` |

### B. Needs the web stack + browser matrix — 6 (`test.skip` fills, [[feedback-fill-gaps-always-no-skip]])
0022 (admin-keyboard 7 data-skips), 0023 (admin-backups/cross-tab 4 skips), 0047 (admin-core-modules bare skip), 0057 (admin-keyboard mobile skip split), 0058 (dev-sanity API-not-running skip → CI-gated assertion), 0059 (admin-users-moderation conditional skip + seed).

### C. Needs a real device (Android/iOS) — 10
0007 (gacha+age_verification .feature), 0009 (Lock/PinSetup/Security nav coverage), 0014 (RoomServiceController tests), 0015 (SecureStorage+CryptoKeyPair contract), 0017 (iOS room repo — no `iosTest` dir exists), 0018 (5 iOS repo/push-bridge tests), 0024 (Android→SharedNavGraph migration + delete NavGraph.kt), 0043 (push_permission cold-start scenario), 0046 (gift_wall 3-state coverage), 0026 (mobile driver helper scripts — device-validated).

### D. Operator / upstream gated — 3
- **0070** [backend] — `errors`-counting is an architect/operator design decision (all 12 `hardDeleteAccount` steps swallow → loop-level `errors` ~always 0; `errors:1` not real-inducible without the out-of-scope refactor). Options: redefine / descope-to-`swept`-only / accept caveat. See `docs/SHY-0070-pickup-blocker-note` + the story Notes.
- **0048** [infra] — detekt 2.0 *stable* not yet released upstream (currently on `2.0.0-alpha.4`); blocked, not free.
- **0006** [kotlin-host] — push-banner/HomeScreen/VM-push tests are host-writable but the story hinges on a foundational No-Stubs `Fake*Store` decision.

## CANT-TELL — 6 (need a runtime/dispatch/repo-var check)
0016 (StickerStorage: JVM test exists, no iOS test / KMP contract), 0027 (CodeQL-Kotlin gated on repo-var `ENABLE_CODEQL_KOTLIN` — value not in code), 0028 (gradle deprecation — needs a `--warning-mode all` run), 0030 (ios_parity_navigation.feature freshness vs SharedNavGraph — not statically decidable), 0054 (allure `continue-on-error` — documented, but no `::warning::` + can't confirm post-story), 0062 (migrate ~95 legacy roadmap features — EPIC-0002 meta-coordinator, gated on SHY-0072/0073).

## Follow-up findings surfaced by the audit (each needs its own ticket)
1. **G003 ViewModel iOS-coverage gap (operator decision):** SHY-0010/0012/0042's ViewModel tests live in `app/src/test` (JUnit4 + MockK) not `shared/commonTest`, so the 15 cross-platform P0 ViewModels have no iOS test-execution proof. Decide: accept the Android-module location as standard (rewrite ACs) OR relocate to `commonTest`. Highest-value follow-up.
2. **SHY-0053 residual:** `sonarcloud.yml:150` — the gradle/Kotlin-coverage step still carries `|| true` (a *different* step from the fixed Jest one), a live silent-failure against [[feedback-warnings-are-failures]]. Trivial CI fix; deserves a follow-up story.
3. **SHY-0070:** `errors`-counting design decision — parked on the story + `docs/SHY-0070-pickup-blocker-note`.
4. **Stale comment (nit):** `manual-qa-matrix.yml:66-70` claims the checkout step is "a plain @v4 tag (not SHA-pinned)" but line 71 is a real 40-hex SHA pin (`@9c091bb… # v7.0.0`) — the comment now says the opposite of the code. Cosmetic; fold into the next `manual-qa-matrix.yml` edit.
5. **SHY-0055 sub-bullet (nit):** the optional `<!-- last verified: … -->` comment its AC mentions was never added to `CLAUDE.md`; the substantive count is correct + released, so 0055 is Done, but the convention is unfulfilled.

## Recommended next autonomous pick
**SHY-0013** (P0, host-JVM `RoomLifecycleManagerTest` for the `awaitLeaveCompletion` race) — highest-priority item in the fully-autonomous queue, closes the last third of a P0, no device/stack. Then SHY-0056 (trivial docs) and the infra scripts (0049/0019/0020/0031/0071).

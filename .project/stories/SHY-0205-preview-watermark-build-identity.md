---
id: SHY-0205
status: In Review
owner: claude
created: 2026-07-18
priority: P1
effort: L
type: feature
roadmap_ids: []
pr:
---

# SHY-0205: Preview watermark build identity + QA context (compact, all platforms)

## User Story

As the ShyTalk operator running device gauntlets across three platforms and three environments, I want every non-prod build's preview watermark to identify exactly WHAT is running (git branch, commit, dirty state, build/install time, server identity) and WHO/WHERE it is (cohort, locale, route, driving journey), so that any screenshot or glance at a device answers "which code is this, against which backend, doing what?" without archaeology.

## Why

Operator task #12 (2026-07-18, do-first). Recurring failure modes this kills:

- Stale device builds silently tested (no build identity on Android; iOS shows hardcoded `1.0 (1)` — its version fix is SHY-follow-up task #11).
- Cross-environment confusion (client on one env, backend another) — the server-echoed `/api/health` `sha` + last-API dot make the answering backend visible. (The API-only rule's cross-env hazard, see `[[feedback-web-urls-env-derived-never-cross]]`.)
- Gauntlet triage cost: run-3's triage repeatedly asked "was the app even pointed at a live stack?" — the status dot answers it in every screenshot.
- QA screenshots need self-description (journey marker, route, cohort, locale) — today they rely on filename conventions alone.

Existing assets being ENRICHED (not created): shared `PreviewWatermark.kt` (Android+iOS via commonMain) and `public/js/preview-watermark.js` (already on the main pages; already reads a never-populated `meta[name="shytalk-build"]` seam designed for deploy pipelines).

**Operator field rulings (2026-07-18 ~11:00–11:35 WIB):** IN = branch, short SHA + dirty marker, build timestamp, cohort, locale, journey marker, route, server-echoed sha, last-API-status dot. OUT (rejected) = API base URL, CI run id, live clock, seed fingerprint. Compactness demanded (~11:50): badge must not eat the app. All-web-pages demanded (~11:52): every public page carries it.

## Acceptance Criteria

### Happy path

- [x] Shared (Android+iOS) watermark renders, in order: `ShyTalk Preview` title; `env · version (build)` [existing]; `branch` (middle-truncated ≤ 24 chars); `sha7` with `*` suffix when built from a dirty tree, paired with build/install timestamp (`MM-dd HH:mm`); `deviceInfo` [existing]; `UID · cohort` (cohort = `adult`/`minor` when resolved); `Name` [existing]; `locale · route` (route = current nav destination when available); `▶ <journey marker>` ONLY while a marker is set; `api <sha7|?> ●` server line with green/red last-API dot.
- [x] Android injects `GIT_BRANCH`, `GIT_SHA`, `GIT_DIRTY` as `buildConfigField`s for ALL flavours in `app/build.gradle.kts` via `providers.exec` (precedent line 44); "built" timestamp derives at runtime from `PackageInfo.lastUpdateTime` (install time — immune to gradle configuration-cache staleness).
- [x] iOS: `iosApp/iosApp/Info.plist` gains `ShyTalkGitBranch`/`ShyTalkGitSha`/`ShyTalkGitDirty` keys resolving `$(SHYTALK_GIT_BRANCH)`/`$(SHYTALK_GIT_SHA)`/`$(SHYTALK_GIT_DIRTY)`; `scripts/ios/build-debug-dev.sh` passes them as xcodebuild settings from live git; `iOSApp.swift` reads them + the app binary's modification date and threads all through `doInitKoin` → `BuildVariant.initBuildInfo`. No `project.pbxproj` mutation.
- [x] Web: `public/js/preview-watermark.js` renders the same field set from `meta[name="shytalk-git-branch"|"shytalk-git-sha"|"shytalk-git-dirty"|"shytalk-built-at"]` + the existing `shytalk-build` meta, plus runtime locale (`document.documentElement.lang` / i18n current), route (`location.pathname`), journey marker (`window.__journey_marker`), and the server line from a real `/api/health` poll.
- [x] `local/serve-web.js` injects the git metas dynamically into every `text/html` response (local = working-tree truth, no build step).
- [x] `scripts/stamp-build-meta.mjs` stamps the metas into `public/**/*.html` at DEV deploy time (`deploy-dev.yml` step before hosting upload). Prod deploy is untouched.
- [x] EVERY page in `public/**/*.html` (glob-discovered, fragments excluded) shows the badge on local.

### Error paths

- [x] `/api/health` unreachable/non-200/timeout → dot turns red; sha shows last-known or `?`; watermark never throws, UI never blocks. Verified by inducing a REAL failure (api base pointed at a closed port), no mocks.
- [x] Missing/blank BuildConfig, plist, or meta values → `?` placeholders via `initBuildInfo` blank-coercion extended to the new slots (never crash, never render empty segments like ` · `).
- [x] git unavailable at build (not a repo / detached HEAD) → `?` values; the BUILD still succeeds (gradle + xcodebuild + stamp script all degrade, exit 0).
- [x] Signed-out / cohort unresolved → cohort segment omitted entirely (no `UID: x · ?`).

### Edge cases

- [x] Branch names > 24 chars middle-truncate with `…` (deterministic pure helper; `story/SHY-0205-preview-watermark-build-identity` → verifiable fixed output).
- [x] Dirty detection: `git status --porcelain` non-empty ⇒ `*`; clean tree ⇒ no `*` (both proven in tests of the stamp script; gradle/xcodebuild sides proven by the same underlying command contract).
- [x] Journey marker set → line appears; cleared → line disappears (web: window hook poll).
- [x] zh locale + deep route strings: line clamps (ellipsis: Compose maxLines+Ellipsis, web max-width+overflow), badge width capped; zh proven end-to-end on web via the REAL language-preference path.
- [x] prod: watermark absent (existing `isPreviewBuild` gate); health poll NEVER starts in prod; prod deploy path carries NO git metas.

### Performance

- [x] Health poll interval ≥ 30s, preview builds only, single in-flight request, no retry storm on failure (next tick tries again).
- [x] New shared fields ride the EXISTING 2s watermark poll (volatile reads) — no additional Compose timers beyond the health poll.
- [x] Compactness budget (operator ~11:50): ≤ 10 rendered lines fully loaded, ≤ 7 idle (no journey, signed out); font size ≤ 9.sp equivalents; badge max-width capped (~65% screen width). Enforced as constants + formatting-function tests, eyeballed on device.

### Security

- [x] Prod-deployed HTML carries zero git metadata (stamp script refuses non-dev targets; deploy-prod.yml untouched — asserted by pin test).
- [x] Watermark renders ONLY the whitelisted fields — no env dumps, no credentials; stamp script + serve-web injection never emit values from env vars other than the git identity set.
- [x] `DEV_QA_PERSONAS_PASSWORD` and friends remain absent from all new logs/output (stamp script logs redact to key names).

### UX

- [x] Tap-transparency contract preserved: no `.clickable`/`.pointerInput` (Compose), `pointer-events:none` (web) — existing tests keep passing; NO expand-on-tap (explicitly ruled out to protect the contract).
- [x] Badge remains top-end within `safeDrawing` insets (the SHY-0095 regression stays fixed) and below the web shared header.
- [x] Background alpha stays within the pinned 0.1–0.5 bounds; added lines use the SAME translucent block (one badge, not stacked chips).

### i18n

- [x] Watermark labels stay untranslated English by design (dev-only tooling); NO `strings.xml` additions — the locale FIELD shows resolved locale as data (zh proven on web via the real i18n path; en proven on Android + iOS devices; the app-side value is the same `Locale.current.language` read regardless of locale).

### Observability

- [x] App start logs one debug line with the full build identity (branch/sha/dirty/built) on Android logcat + iOS console + web console — greppable in gauntlet logs.
- [x] The `window.__journey_marker` web channel exists and is Playwright-proven (set → ▶ line renders, clear → hides); the runner-side stamping at scenario boundaries ships with the Android/iOS channels in SHY-0206.
- [x] Health-dot state changes log at debug level (ok→fail, fail→ok), never spamming per-poll.

## BDD Scenarios

**Scenario: Android local build shows its git identity**
- **Given** the app is built via `installLocalDebug` from branch `story/SHY-0205-preview-watermark-build-identity` at a clean commit `abc1234`
- **When** the app launches on the device
- **Then** the watermark shows `story/SHY-0205-previe…dentity`, `abc1234` with NO `*`, and an install timestamp matching today
- **And** logcat contains one line with branch+sha+built values

**Scenario: dirty working tree is flagged**
- **Given** a build produced with uncommitted changes present
- **When** the watermark renders
- **Then** the sha reads `abc1234*`

**Scenario: iOS build injects identity via xcodebuild settings**
- **Given** `build-debug-dev.sh` runs on a clean checkout
- **When** the app installs and launches on the iPhone
- **Then** the watermark branch/sha lines match the checkout (not `?`)
- **And** an Xcode-GUI build without the settings shows `?` placeholders and does not crash

**Scenario: every web page carries the badge locally**
- **Given** the local stack + serve-web are running
- **When** each `public/**/*.html` page (glob-discovered) is visited with a non-prod hostname
- **Then** `#preview-watermark` is visible on every one with branch/sha populated from serve-web's injected metas

**Scenario: server line proves which backend answered**
- **Given** the web page or app points at the local Express
- **When** the health poll completes
- **Then** the server line shows the `/api/health` `sha` value (`?` for local's `unknown`) with a green dot

**Scenario: dead backend turns the dot red without breaking anything**
- **Given** the health target is a closed port (real failure, no mocks)
- **When** the next poll fails
- **Then** the dot renders red, the page/app remains fully interactive, and exactly one state-change debug log is emitted

**Scenario: journey marker line is conditional**
- **Given** a Playwright/runner session sets `window.__journey_marker = "j01 s03"`
- **When** the watermark refreshes
- **Then** `▶ j01 s03` appears; and after the session clears it, the line disappears

**Scenario: cohort and locale self-describe QA screenshots**
- **Given** an adult persona signs in with the zh locale active
- **When** the watermark renders
- **Then** it shows `· adult` after the UID and `zh · <route>` on the locale line; signed out, the cohort segment is absent

**Scenario: prod stays clean**
- **Given** a prod-hostname page load and a prod app build
- **When** rendering completes
- **Then** no watermark exists, no health poll fires, and deployed prod HTML contains no `shytalk-git-*` metas

**Scenario: stamp script is deploy-safe and idempotent**
- **Given** `scripts/stamp-build-meta.mjs` runs twice over `public/`
- **When** the second run completes
- **Then** each HTML file contains the meta set exactly once with updated values, exit 0; a non-dev invocation refuses with exit ≠ 0

## Test Plan

**TDD order: every file below gets its RED before the corresponding implementation.**

Unit (host / commonTest — doubles permitted per unit-location rule, none expected to be needed):
- `shared/src/commonTest/kotlin/com/shyden/shytalk/core/BuildVariantTest.kt` (extend): new config slots default `?`/`false`; `initBuildInfo` new-arg overload + blank-coercion; existing call sites' no-arg compatibility.
- `shared/src/commonTest/kotlin/com/shyden/shytalk/core/WatermarkFormatTest.kt` (NEW): `truncateMiddle` (short/exact/long/unicode), git line with/without dirty `*`, conditional-line assembly (journey/cohort/route present-absent), line-budget ≤10/≤7, timestamp formatting.
- `express-api/tests/scripts/stamp-build-meta.test.js` (NEW): real temp-dir HTML fixtures — stamps all metas, idempotent double-run, dirty flag from real `git status` in a real temp repo, refuses non-dev target, degrades to `?` outside a repo, redacted logging.
- `express-api/tests/scripts/serve-web-meta-injection.test.js` (NEW): REAL `serve-web.js` spawn on a scratch port — HTML responses carry metas with live git values, non-HTML untouched, injection failure degrades to unmodified HTML (exit path proven).

Integration / E2E (real stack only):
- `tests/web/preview-watermark.spec.ts` (extend): glob-all-pages badge presence; branch/sha lines populated via serve-web injection; `window.__journey_marker` set/clear; health dot green against live Express + red against a closed-port base (REAL induced failure); pointer-events + alpha + safe-position pins retained; prod-hostname absence.
- `express-api/tests/scripts/deploy-dev-*.test.js` (extend relevant pin suite): stamp step present in `deploy-dev.yml` before hosting upload; `deploy-prod.yml` has NO stamp step.

Kotlin gates: `./gradlew testDevDebugUnitTest :shared:jvmTest :shared:compileKotlinIosArm64 detekt` + `ktlint --relative`.
JS gates: `cd express-api && npm test` (touched suites), `npm run lint` (`--max-warnings=0`), `prettier --check .` from express-api cwd, `actionlint` (deploy-dev.yml edit).

Device/browser verification (Pre-Merge Protocol — product runtime touched: `shared/`, `app/`, `iosApp/`, `public/`):
- Real Android (3b402284, USB): `installLocalDebug -PlocalHost=localhost` → walk launch→sign-in→verify all watermark lines + screenshot; dirty-build rebuild shows `*`.
- Real iPhone (74563FF8, USB): `build-debug-dev.sh` install → same walk (dev flavour — iOS-local structurally unsupported).
- Web local: full Playwright across all 5 local projects (chromium/firefox/webkit/edge/mobile) + manual badge eyeball on portal/admin/legal pages.
- Dev phase: deploy develop→dev (operator-authorised for 2026-07-18) → Chrome spot-check dev pages show stamped metas; Android dev build spot-check.

## Out of Scope

- Android broadcast + iOS deep-link journey-marker channels and the runner driver methods that drive all three channels → **SHY-0206** (filed alongside; web window-hook channel IS in scope here).
- `/api/health` gaining an `environment` field (1-line backend change ⇒ backend full-gauntlet rule ⇒ rides after the journey-matrix harness debt clears) → follow-up SHY in the task-#5 batch.
- iOS `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION` correctness (hardcoded `1.0 (1)`) → operator task #11, separate story.
- Compose screenshot/visual-regression framework → SHY-0179 (unchanged).
- Any prod-deploy stamping.
- Web `Name:` line — deliberate asymmetry (R1 finding #7): web pages have no resolved-display-name source equivalent to the apps' AuthRepository slot; the UID·cohort pairing carries the identity signal on web.

## Dependencies

- None blocking. Touches `deploy-dev.yml` (additive step) — actionlint + existing pin suites guard it (`deploy-dev-concurrency`, `deploy-dev-ios-cache-share`, `deploy-dev-seed-personas` checked for structural assumptions before editing).
- NO `project.pbxproj` mutation anticipated (Info.plist + CLI build settings only). If one becomes necessary → STOP and AskUserQuestion per the pbxproj-auth rule.
- Server `sha` field already exists (`express-api/src/index.js:84`, `.deployed-sha` mechanism) — consumed read-only.

## Risks & Mitigations

- **Gradle configuration cache staleness for git values** → sha/branch via `providers.exec` (config-cache-safe, precedent exists); timestamp deliberately NOT baked at build (runtime `lastUpdateTime`).
- **Badge bloat harming device QA legibility** (operator concern) → hard line-budget + font/width caps as tested constants; conditional lines default-hidden.
- **Health poll flapping the dot on a busy local stack** → dot reflects last COMPLETED call only; 30s cadence; state-change-only logging.
- **deploy-dev.yml regression** → additive step, actionlint + pin tests, `[skip-ci]` never written literally, CI-run verify on next dev deploy (authorised today).
- **Web pages missing the loader** (events/legal pages drift) → glob-driven spec turns "a page forgot the script" into a permanent RED.
- **KMP iOS compile traps** (JVM-only APIs) → only KMP-safe APIs in commonMain; `compileKotlinIosArm64` in the gate.

## Definition of Done

- [x] All AC checked; every named test file exists with its RED→GREEN history; zero skipped gaps.
- [x] All 6 gate families green locally: Kotlin unit+detekt+ktlint, iOS compile, Express Jest, eslint+prettier, full local Playwright (5 projects), actionlint.
- [x] Real-device walks done: Android local (identity lines + dirty flag + dot proven), iPhone dev build (identity lines proven), web all-browsers badge sweep.
- [x] `code-reviewer` 100% clean on the LOCAL commit before push; `Reviewed-up-to:` recorded.
- [x] PR → develop, CI green by name, dev deploy verified (stamped metas live on dev pages), story flipped In Review on merge; Done on release cut with `released_in:` (release pending).

## Notes

- 2026-07-18 ~16:30 WIB — MERGED #1624 (squash 4393f567cc9) after the detached push gate (chromium 1401 green in-hook). Full local matrix at HEAD: chromium 1401 / firefox 1382 / webkit 1380 / mobile-chrome 1377 / mobile-safari 1371, only pre-existing flakes (admin-users-profile search ×4 projects, admin-cross-tab ×1), each passed on retry. DEV VERIFY: deploy run 29638164103 — Web/Backend/Android/Sanity/Smoke SUCCESS (Seed-Personas + iOS TestFlight failures pre-date this story, task #4); live https://dev.shytalk.shyden.co.uk homepage carries `shytalk-build 0.97.15-b202 · branch develop · sha ef8d15b · dirty 0 · built-at 2026-07-18T08:52:45Z` — ef8d15b confirmed = develop HEAD at deploy (board-sync commit atop the squash). Dev-phase AC ticked; Done rides the next release cut. Remains In Review per board convention.
- 2026-07-18 ~14:20 WIB — code-reviewer R2 (same agent, full re-read at HEAD): **CLEAN** — all 11 R1 findings verified genuinely resolved (hand-traced escapeAttr output, detached-HEAD sentinel ordering, transition-log state machine incl. the exactly-once non-flakiness argument); active regression hunt found nothing. Reviewed-up-to: 1e31f3fdf14. Status → In Review.
- 2026-07-18 ~13:55 WIB — code-reviewer R1 (full branch diff): 0 Critical, 6 Important, 5 Minor/Plausible. ALL verified against source, ALL addressed:
  (1) web health-dot state-change log missing → `recordHealth()` transition log added + Playwright pins exactly ONE `unknown -> false` line in the red-dot test. (2) web line-clamp not implemented (divs wrapped) → per-line `white-space:nowrap;overflow:hidden;text-overflow:ellipsis` on all 7 content lines + a CJK-long-marker clamp test asserting every row < 20px. (3) detached HEAD rendered literal "HEAD" not "?" → degraded to unknown in all three readers (build.gradle.kts takeUnless, build-debug-dev.sh guard, build-meta.js null-map) + detached-HEAD stamp test + gradle pin. (4) escapeAttr untested on the one un-sanitised slot (--build) → hostile `<script>"x"&</script>` test asserts full entity-encoding. (5) Android gradle injection had no structural pin (iOS did) → NEW android-git-identity-pin.test.js (10 tests: buildConfigFields, GITHUB_REF_NAME precedence, providers.exec config-cache safety, both sanitise regexes, detached-HEAD guard). (6) deploy-dev iOS archive omitted SHYTALK_GIT_DIRTY → explicit `SHYTALK_GIT_DIRTY=""` + 6 writer-invocation pins (build script + CI) in ios-dev-configuration.test.js. (7) web Name-line asymmetry → documented as deliberate in Out of Scope. (8) truncateMiddle unicode test promised-but-missing → CJK case added; UTF-16/surrogate limitation documented in KDoc. (9) truncateMiddle(., 0) threw in Kotlin but not JS → max<=1 → "…" guard BOTH sides + tests. (10) serve-web test scratch dirs inside the repo tree → moved to os.tmpdir(). (11) DST case for BuiltAt — accepted as-is (display-only debug timestamp; noted, not implemented). Post-fix gates: Jest 66 green across the four suites, eslint 0-warning, jvmTest 1429, iosArm64 compiles, ktlint/detekt/actionlint/shellcheck clean, watermark spec 38/38 chromium.
- 2026-07-18 ~13:05 WIB — LOCAL VERIFICATION EVIDENCE (real devices, real stack):
  - Android (OnePlus CPH2653, USB 3b402284, installLocalDebug -PlocalHost=localhost): logcat `build identity: local 0.97.15(176) story/SHY-0205-preview-watermark-build-identity@2d2e7230854* installed 07-18 12:45`; on-screen badge (uiautomator + screenshot): title / `local · 0.97.15 (176) · api unknown` + GREEN dot (device→local Express over adb reverse, server sha echoed) / `story/SHY-02…ld-identity` (24-char truncation exact) / `2d2e723* · 07-18 12:45` / device line / `UID: -` / `en` = 7 idle lines. REAL persona sign-in (Alice P-02): `UID: 50000010 · adult` + `Name: [SEED] Alice…` — cohort chain (server profile → effectiveCohort → watermark) proven end-to-end. Route line (`en · splash`) proven after the NavGraph fix below.
  - DEVICE-WALK FINDING → FIX: Android runs its own `NavGraph.kt` (structural duplicate of SharedNavGraph) — the route publisher added to the shared graph never executed on Android; mirrored into the Android collector (77fab169a9a) and re-proven on device. Nav-graph unification filed to the follow-up batch.
  - iOS (Sean's iPhone Air, USB 74563FF8, build-debug-dev.sh): badge shows `dev · 1.0 (1) · api 03e8f4a` + GREEN dot (real DEV backend deploy sha echoed — also showcases task #11's hardcoded 1.0(1)), `story/SHY-02…ld-identity` via xcodebuild→plist→Swift→Kotlin chain, `77fab16* · 07-18 12:59` (binary mtime), `iPhone · iOS 27.0`, `UID: -`, `en`. Screenshot captured via devicectl.
  - Web (live serve-web + Express): 37/37 Playwright chromium — glob-all-11-pages badge, live-sha meta injection, green dot vs REAL closed-port red dot, journey-marker set/clear, cohort pairing, zh via the real language-preference path, single console identity line. serve-web on :8888 restarted with injection (old process predated the change).
  - XSS note for reviewer: watermark innerHTML assembly routes EVERY dynamic value through the file's escapeHtml; the only raw markup is the static dot span with a 3-literal color ternary.
- 2026-07-18 ~12:05 WIB — architect pass (self, spec-vs-codebase): APPROVE. Every mechanism live-verified before spec: watermark mounts (MainActivity.kt:177 / MainViewController.kt:49), initBuildInfo blank-coercion seam, plist `$(VAR)` + CLI-settings mechanism (CI precedent deploy-dev.yml), `/api/health` `sha` live response, meta seam in preview-watermark.js, providers.exec precedent (build.gradle.kts:44). Constraints folded: health poll MUST reuse the existing shared HTTP client (no new dependency); route publisher is a minimal state holder (no nav internals in BuildVariant); compactness enforced via tested constants. Status → In Progress.
- 2026-07-18 ~11:00 WIB — operator locked base fields (branch/commit/build/version) + extras dirty-marker & build-timestamp; rejected apiBaseUrl & CI-run-id.
- 2026-07-18 ~11:31 WIB — operator added cohort, locale, journey marker, route.
- 2026-07-18 ~11:35 WIB — operator added server-echo + last-API dot; rejected live clock & seed fingerprint. Server-echo satisfied client-side via existing `/api/health` `sha` (zero backend change this SHY).
- 2026-07-18 ~11:50 WIB — operator: compact the badge (size budget ACs added). ~11:52 — operator: ALL web pages (glob spec AC added).
- Scope splits recorded: SHY-0206 (marker channels + runner methods), backend env-echo follow-up, task #11 iOS versioning separate.

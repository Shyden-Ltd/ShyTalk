# ShyTalk - Claude Code Instructions

## Project Overview
Social chat app with voice rooms. Kotlin Multiplatform (Android + iOS), Firebase backend, LiveKit voice, $0 hosting cost.

## Tri-Platform Policy
**ALL work must ship on desktop (web), iOS, and Android simultaneously.** No platform can fall behind. Every feature implemented in shared/commonMain must compile for both Android and iOS. Verify with `./gradlew :shared:compileKotlinIosArm64` after any shared code change.

## Agile Way of Working

Every piece of work is captured as ONE detailed user-story `.md` file at `.project/stories/SHY-XXXX-slug.md` and ships as ONE PR. The story IS the spec — operator and reviewer score against the AC + BDD scenarios; architect validates the spec before code starts. Source-of-truth lives in this repo; GitHub Issues + Projects v2 are an automatically-synced mirror (delivered by SHY-0002 after SHY-0001 ships).

### Story ID + file layout
- **ID format:** `SHY-XXXX` (4-digit zero-padded, sequential; never recycle gaps left by Cancelled stories).
- **File path:** `.project/stories/SHY-XXXX-kebab-slug.md`.
- **Index:** `.project/stories/SHY-INDEX.md` is the live backlog. Sorted `priority asc, created asc`. Active / Done / Cancelled tables. Index is human-maintained — the `SHY-[0-9][0-9][0-9][0-9]-*.md` glob in the validator naturally excludes it.

### Frontmatter (9 required fields)
- `id` — matches `^SHY-[0-9]{4}$`
- `status` — one of `Draft` / `In Progress` / `In Review` / `Done` / `Cancelled`
- `owner` — string (`claude` or operator GitHub handle)
- `created` — `YYYY-MM-DD`
- `priority` — `P0` / `P1` / `P2` / `P3` (P0 = drop everything)
- `effort` — `XS` / `S` / `M` / `L` / `XL` (matches the roadmap convention)
- `type` — `feature` / `bug` / `refactor` / `docs` / `infra` / `spike` / `chore`
- `roadmap_ids` — array form only (`[]` if ad-hoc; `[G001, G024]` if multiple)
- `pr` — URL once pushed (advisory; NOT enforced by the validator)

### Body sections (10 required `## ` headings + 8 required `### ` AC sub-headings)
`## User Story` (As/I want/So that) · `## Why` · `## Acceptance Criteria` · `## BDD Scenarios` · `## Test Plan` · `## Out of Scope` · `## Dependencies` · `## Risks & Mitigations` · `## Definition of Done` · `## Notes`.

The `## Acceptance Criteria` section MUST contain 8 sub-headings — one per QA dimension:
`### Happy path` · `### Error paths` · `### Edge cases` · `### Performance` · `### Security` · `### UX` · `### i18n` · `### Observability`.

A dimension may carry `N/A — <one-line rationale>` if it genuinely doesn't apply; an empty sub-heading body is rejected by the architect/reviewer (not the validator). The validator enforces BDD coverage presence-based and sectionally — it fails (exit 13) only when `## BDD Scenarios` has zero `**Scenario:**` blocks while `## Acceptance Criteria` has at least one `- [ ]` checkbox. One scenario may validly cover many AC bullets; per-bullet depth and correctness are the reviewer's responsibility, not the validator's.

### BDD scenario format (Markdown-native)
```
**Scenario: <short description>**
- **Given** <preconditions>
- **When** <action>
- **Then** <observable outcome — exact exit code, stderr substring, etc>
- **And** <additional observable>
```

### Stories born fully refined (NO skeletons) — HARD RULE

Every new SHY `.md` file is created **fully refined** at the moment of creation. No skeleton placeholders are allowed. Specifically:

- Every `### <dimension>` AC heading must have either ≥1 verifiable `- [ ]` bullet OR `N/A — <specific reason>` (e.g. `N/A — server-side rule; no user-facing strings`). `N/A — TBD refinement on pickup` is FORBIDDEN.
- `## BDD Scenarios` must contain ≥1 `**Scenario:**` block per AC bullet category (presence-based per validator exit 13).
- `## Test Plan` Red + Green sections must name real files + test names, not `(TBD on pickup ...)`.
- `## Dependencies`, `## Risks & Mitigations`, `## Out of Scope`, `## Definition of Done` must contain concrete content, not boilerplate.

**Why:** operator works AFK most of the time; resuming Claude sessions must be able to pick up the next SHY in priority order and start TDD work without needing operator input to do upstream planning. Skeletons break this by forcing planning before code, which collides with the architect-validates-spec-before-implementation gate.

**Anti-patterns:** writing `N/A — TBD refinement on pickup` under any dimension; leaving `## BDD Scenarios` empty when AC has bullets; saying "I'll refine this later" or "I'll skeleton-out now and fill on pickup."

**Reference:** `[[feedback-no-skeleton-stories-fully-refined]]` memory pointer.

**Historical exception:** `scripts/convert-roadmap-to-stories.sh` was a one-time skeleton generator (SHY-0003); its output was refined under SHY-0032 as a one-time cleanup. The script is now historic; do not re-invoke unprompted.

### Lifecycle (no backward transitions; Cancelled is terminal)
- `Draft` → architect APPROVE / APPROVE-WITH-CHANGES + concerns applied → `In Progress`
- `In Progress` → code-reviewer agent dispatched → `In Review`
- `In Review` → PR auto-merges → `Done` (for `infra` / `docs` / `chore` / `refactor`)
- `In Review` → for `feature` / `bug`: auto-merge + deploy-to-dev + dev smoke test → `Done`
- `In Review` → for `spike`: Notes-recorded decision + follow-up SHYs filed → `Done`
- any active → operator decides not to do → `Cancelled` (Notes captures why)

### Granularity + naming convention (strict)
- 1 PR-bundle = 1 SHY (multi-G roadmap bundles list every G-ID in `roadmap_ids`).
- Branch: `story/SHY-NNNN-kebab-slug`.
- Commit subject: `[SHY-NNNN] <verb-led summary>`.
- PR title: `SHY-NNNN: <Title>`.
- PR body opens with `Implements SHY-NNNN — see .project/stories/SHY-NNNN-slug.md for full spec, AC, BDD scenarios, and DoD.` plus `Closes #<github-issue-number>` once SHY-0002's sync is live.

### Cross-labelling the roadmap
The zero-gap roadmap at `.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md` gets a `SHY` column per row — OPEN G-items get `SHY-XXXX`; SHIPPED items get `✅ PR #N`; CANCELLED get `❌ Won't do — <reason>`. Don't create retro stories for shipped/cancelled rows.

### Audit trail
All audit signals — architect verdict, code-reviewer cycle count + verbatim findings, rework reasons, dev-verify outcomes — land as timestamped entries in the story's `## Notes (running log)` section. No parallel frontmatter audit fields.

### Tooling
- `scripts/check-story-frontmatter.sh` validates every `SHY-[0-9][0-9][0-9][0-9]-*.md` in CI (`lint.yml`, last step). Run `--help` for usage + the 8 documented exit codes. Add `--verbose` for per-check tracing.
- `.project/stories/SHY-0001-establish-agile-workflow.md` is the canonical seed — copy it as the starting template for new stories.
- `scripts/sync-stories-to-issues.sh` (delivered by SHY-0002) mirrors each story `.md` to a GitHub Issue + Projects v2 card. One-way sync — `.md` is the source of truth, the Issue is a derived view.

### GitHub Issues mirror (delivered by SHY-0002)

- **Source of truth:** the `.md` file. Issues are a mirror, not an editable surface for spec content. The script OVERWRITES the issue body with the `.md`-derived content on every change-detected sync. Operator MUST edit AC checkboxes in the `.md` file (not on GitHub) — checkbox edits on the issue UI are stomped on the next sync.
- **Change detection:** SHA-256 of the file body, stored in the issue footer as `_Last synced: <UTC> from commit <sha> body-hash: <hex>_`. Commit-SHA alone is insufficient (mid-PR edits share the same commit) — body-hash is the canonical signal.
- **PR `Closes #N` injection:** the `inject-pr-closes.yml` workflow appends `Closes #<issue-number>` to a PR body when the branch matches `story/SHY-NNNN-*` and the body doesn't already contain the close ref. Auto-merge then closes the issue. Fork PRs skip with a log entry (their `pull_request` trigger token is read-only).
- **Concurrency:** the sync workflow uses `concurrency: sync-stories-${{ github.ref }}` with `cancel-in-progress: false`. Only one sync runs per ref at a time — a label-based lock would have a TOCTOU race.
- **Auth:** requires `GH_PAT_PROJECT` repository secret — a fine-grained PAT with `issues:write`, `pull-requests:write`, and `project:write`. The automatic `GITHUB_TOKEN` cannot carry `project:write` (it's provisioned at job-start without project scopes). Operator provisions this PAT once at https://github.com/settings/tokens. The workflows skip with a `::warning::` if the secret is unset (no-op until provisioned).
- **Project v2 board:** operator manually provisions a Project v2 named `ShyTalk Stories` with custom fields `Pri` / `Effort` / `Type` (single-select) and `Roadmap IDs` / `SHY ID` (text). Script exits 35 if not provisioned, 36 on schema mismatch.

## Build & Test Commands
- **Build (Android)**: `./gradlew assembleDevDebug`
- **Build (iOS shared)**: `./gradlew :shared:compileKotlinIosArm64`
- **Unit tests**: `./gradlew test`
- **E2E tests**: `./gradlew connectedDebugAndroidTest`
- **Install on device**: `./gradlew installDebug`
- **Deploy Firestore rules**: `npx firebase deploy --only firestore:rules`

## E2E Test Framework (BDD/Gherkin)
- **Feature files**: `app/src/androidTest/assets/features/*.feature` (48 files, ~235 scenarios)
- **Step definitions**: `app/src/androidTest/java/com/shyden/shytalk/steps/` — CommonSteps, AuthSteps, SystemScreenSteps, ModerationSteps, PinSteps, AgeSegregationSteps, StartingScreenSteps, PushPermissionSteps
- **Test infrastructure**: ComposeTestRuleHolder (singleton), ScreenshotRule (Allure failure screenshots), ResetFakesRule
- **Allure reports**: Generated by CI, deployed to GitHub Pages; results in device internal storage
- **Cross-platform journey corpus**: `journey-tests/*.feature` (j01..j20) — persona-first, threads multiple features end-to-end with explicit cross-platform handoffs. Driven by `manual-qa-runner.js`. See `journey-tests/INDEX.md` for the authoring rules.
- **Plans**: `.project/plans/` (NOT `docs/` — internal docs go in `.project/`); test plans in `.project/test-plans/`

## Git Rules
- Default branch: `main` (NOT `master`)
- **NEVER commit directly to main** — always create a branch and PR
- Before starting work, check for unfinished branches (`git branch -a`)
- Commit AND push per task, with task name in message

## Architecture
- KMP: `shared/` module (commonMain/androidMain/iosMain) + `app/` (Android) + `iosApp/` (iOS)
- MVVM + Koin DI + Compose Multiplatform + Navigation
- Repository pattern: interface + impl, bound via Koin
- All models, repos, ViewModels, screens, and UI in `shared/src/commonMain/`
- Platform abstractions via expect/actual: PlatformSettingsService, PlatformImagePicker, PlatformBackHandler, PlatformTts, KeepScreenOn, RequestMicPermission
- iOS voice via LiveKit Swift bridge: `iosApp/iosApp/LiveKitBridge.swift` → `IosLiveKitVoiceService.kt`
- Android foreground service: `app/` has `RoomService.kt` + `AndroidRoomServiceController`
- Push permission UX: `shared/.../core/push/` — `PushPermissionState` (4-value enum), `PushPermissionStore` (process-singleton state holder + bridge), platform-specific `AndroidPushPermissionBridge` / `IosPushBridge`; non-dismissible `PushPermissionDeniedBanner` in `shared/.../core/ui/`
- Shared header on all web pages: `public/js/shared-header.js`
- Seasonal events: `public/events/events.json` (registry), `public/js/seasonal-theme.js` (web), `SeasonalTheme.kt` (app)
- 20 locales: ar, de, es, fr, hi, id, it, ja, km, ko, nl, pl, pt, ru, sv, th, tr, uk, vi, zh

### Cron-elimination architecture (closed 2026-06-04/05)
Five scheduled crons removed in the cron-elim cluster — replaced with event-driven or lazy-on-access patterns to stay $0 on the Firebase free tier:
- **expireBans** → server-side `Filter.or(expiresAt==null, expiresAt>now)` in `checkBans` (no separate cron)
- **dispatchNotifications** → inline `dispatchNotificationInline` + `Promise.allSettled` in `roadmap-notify.js`
- **staleRooms** → RTDB `onDisconnect` + lazy-reap at mutation chokepoint (`inRoomTransaction`); reaper in `express-api/src/utils/stale-room-reap.js`
- **sweep-bans** / **sweep-stale-rooms endpoints** → deleted (404s in prod)
- **accountDeletion** → only remaining scheduled workflow (`.github/workflows/cron-account-deletion.yml`)

When adding new background work: prefer event-driven (RTDB `onDisconnect`, write-time triggers, on-access reaping) over `setInterval`/cron. Crons cost free-tier quota.

## KMP iOS Compatibility (commonMain)
**NEVER use JVM-only APIs in commonMain** — they compile on Android but break iOS:
- `System.currentTimeMillis()` -> `currentTimeMillis()` from `core.util.PlatformTime`
- `Math.PI/sin()` -> `kotlin.math.PI/sin()`
- `String.format()` -> `padStart()` or manual formatting
- `synchronized {}` -> remove or use `kotlinx.coroutines.sync.Mutex`
- `@Volatile` -> `@kotlin.concurrent.Volatile`

## Key Constraints
- **$0 hosting** — never introduce paid services (no Firebase Blaze, no paid Cloudflare)
- **Google Play release notes** max 500 chars, non-technical, in `app/src/main/play/release-notes/en-US/internal.txt`
- **Translations** — user-facing strings must go in ALL 20 locale files (`shared/src/commonMain/composeResources/values-{locale}/strings.xml`)
- **Low resolution support** — use proportional/relative sizing, not fixed sp/dp
- **No rarity-colored borders** on gifts/backpack — neutral theme colors only

## Testing Policy
- Run ALL tests after every code change
- When fixing a bug, always write tests for it
- Fix all failures before committing
- JVM test gotcha: `org.json.JSONObject` is stubbed — add `testImplementation("org.json:json:20231013")` if needed

## PR Quality Gate (Pre-Push Checklist)
**Run ALL tests locally before pushing.** CI should be a safety net, not the first time tests run.

### Local test sequence (run before every push):
1. **Kotlin lint**: `ktlint --relative` (~1s, requires standalone ktlint 1.8.0)
2. **Express tests**: `cd express-api && npm test` (~10s)
3. **Kotlin tests + detekt**: `./gradlew testDevDebugUnitTest :shared:jvmTest detekt` (~2min)
4. **iOS compilation**: `./gradlew :shared:compileKotlinIosArm64` (~1min, mandatory for shared code changes)
5. **Playwright tests**: `npx playwright test` (~5min, requires local stack)
6. **E2E smoke tests**: `./gradlew connectedDevDebugAndroidTest` (requires emulator + local stack)

### Local stack prerequisite (for steps 5-6):
- Start Docker Desktop
- Run `bash local/start.sh` (Firebase Emulators + LiveKit + MinIO + Mailpit)
- Run `cd express-api && npm run local` (Express API against emulators)
- Android emulator for step 6

### Additional checks:
- Code review agent on the diff
- Security review agent on the changes
- i18n checker for all 20 locales (if user-facing strings changed)
- Update CLAUDE.md if new patterns/conventions introduced
- Re-run all tests after fixes
- Only push when all checks pass
- Use **Deploy to Dev** workflow (Actions tab → workflow_dispatch) when ready for internal testers
- Workflow-only changes (`.github/`, `.claude/`, `*.md`) don't need app testing

### Workflow / Actions hygiene (enforced by `lint.yml`):
- **No paid runners** — `scripts/check-no-paid-runners.sh` rejects `*-xlarge`, `*-cores`, `*-large`, `large-*` runs-on specs (free for orgs, paid for personal repos; PR #370 incident)
- **Scoped concurrency groups** — `scripts/check-workflow-concurrency-scoping.sh`
- **SHA-pinned third-party actions** (added in PR #1016, pending merge at time of writing) — `scripts/check-action-shas.sh` rejects `uses: foo/bar@vN` for any third-party action; only 40-hex SHAs and local (`./...`) refs pass. Supply-chain hardening. Get the SHA via `gh api repos/<owner>/<repo>/git/refs/tags/<tag> --jq '.object.sha'`. Once #1016 lands, drop the "pending merge" caveat from this bullet.
- **actionlint** + embedded shellcheck — runs in pre-push hook + CI lint job

## Debugging
- **Check Firestore security rules first** for read/write failures — pull logcat for `PERMISSION_DENIED`
- Rules file: `firestore.rules` — must include rules for ALL collections AND subcollections
- Firestore rules don't cascade into subcollections

## Environments
- **Local**: Firebase Emulators + LiveKit Docker, zero cloud usage
  - LiveKit: `ws://localhost:7880` (Docker container)
- **Dev**: Firebase `shytalk-dev`, API `dev-api.shytalk.shyden.co.uk` (London)
  - LiveKit: `livekit-eu.shytalk.shyden.co.uk` (London, Oracle Cloud)
- **Prod**: Firebase `shytalk-7ba69`, API `api.shytalk.shyden.co.uk` (Singapore)
  - LiveKit Asia: `livekit.shytalk.shyden.co.uk` (Singapore, Oracle Cloud)
  - LiveKit EU: `livekit-eu.shytalk.shyden.co.uk` (London, Oracle Cloud)
- LiveKit is self-hosted on Oracle Cloud VMs; multi-region routing handled by Express API
- Build flavors: `dev`, `prod`, and `local` in `app/build.gradle.kts`
- `google-services.json` in `app/src/dev/`, `app/src/prod/`, and `app/src/local/`

## Local Development (Zero Cloud)
- **Start:** `bash local/start.sh` (starts Firebase Emulators + LiveKit Docker)
- **API:** `cd express-api && npm run local`
- **Android on emulator:** `./gradlew installLocalDebug` (uses `10.0.2.2` as host alias)
- **Android on physical device:** `./gradlew installLocalDebug -PlocalHost=localhost` AND run `adb reverse tcp:3000 tcp:3000 && adb reverse tcp:7880 tcp:7880 && adb reverse tcp:9000 tcp:9000` (tunnels device localhost to laptop)
- **Firebase UI:** http://localhost:4000
- **Stop:** `bash local/stop.sh` or Ctrl+C in the start.sh terminal
- **Prerequisites:** Java 21+, Docker, Firebase CLI (`npm i -g firebase-tools`)
- **Seed data:** Auto-runs on first start. Manual: `node local/seed.js`
- **No cloud quota consumed** — all Firestore/Auth/RTDB traffic goes to emulators

## Express API (Oracle Cloud)
- Source: `express-api/src/` — routes, utils, middleware
- Stack: Express.js + Firebase Admin SDK + PM2 + Caddy
- Dev SSH: `ssh -i ~/.ssh/shytalk-oci ubuntu@145.241.224.13`
- Prod SSH: `ssh -i ~/.ssh/shytalk-oci ubuntu@213.35.98.160`

---

# Project-Specific Memories (migrated from global, 2026-05-30)

These were previously in the global `~/.claude/projects/-Users-shyden/memory/MEMORY.md` index. Moved here so they only load when working in this repo (saves ~50% per-turn memory cost in non-ShyTalk sessions). Original memory files remain at their global paths.

## Test Framework & Driver Architecture

- **QA runner driver architecture** — driver file layout, naming convention (`createX<Surface><Platform>Driver`, `mobile-<browser>-<platform>` slugs), browser-allowlist.js as policy single-source-of-truth, matrix-completion PR sequence #898→#899→#900→D/E/F/G/H/I. Pitfalls: absolute-path satisfies sonarjs, pre-commit only checks .js, `return await` for catching evaluate rejections, fetch-mock handler ordering is first-match-wins, loader uses process.stderr.write not console.error.
- **Setup-Given PR pattern** — established small-focused PR shape for journey setup-Givens (j01/j05/j02/j07/warning-state/j12/j13 all followed this), with mandatory test-coverage matrix, common matcher collision pitfalls (line 947 catch-all, line 1898 assignment), and conflict-resolution shortcut for parallel describe-block PRs.
- **Test matrix — FRAMEWORK FIRST** (STRENGTHENED 2026-05-30 ~15:00 BST) — NO local test counts until the framework supports EVERY device × EVERY browser. Currently only Android native + Web Chromium work; 12 other matrix cells (iOS native, Web Safari/Firefox/Edge on Mac, mobile browsers on Android+iPhone) missing. Dev = Android + Chrome on Mac + Chrome on Android only.
- **Prettier check from express-api cwd** — CI's lint runs `cd express-api && prettier --check .`; `npx --prefix` from repo root uses a different config and yields false-positive passes.
- **Test every commit via user journeys** — every commit (new + historical) must be journey-tested local-first, then dev; bug-fix-loop until clean at each stage.
- **Real Android device preferred over emulator** — always probe wireless adb first; emulator is the fallback.
- **iOS must also be journey-tested via real iPhone** — physical iPhone over wireless (NO simulator anymore); same memory savings as Android.
- **Journey-test auth = test personas, not OAuth** — canonical auth path is the in-screen persona picker; never drive Google/Apple OAuth in journey tests.

## Driver-Method PR Conventions (Phase 4 cluster)

- **Android driver helper coverage gaps** — Phase 4.5 housekeeping cluster: `androidTap` / `androidTapByTag` error / `androidOpenScreen` / `selectSerial` need direct tests (surfaced from PR #732 R2).
- **Null/undefined pins for string args** — Phase 4 driver methods must pin all 4 input-rejection cases (`''`/`'   '`/`null`/`undefined`) from Round 0; reviewer flags missing null/undefined as Important across 5+ PRs.
- **adb() shell-escape pattern for user text** — driver methods passing free-form user text to `adb()` must POSIX-escape `'` first (PR #741 fix); applies to JoinEventRoom, SubmitStarFeedback, future action methods.
- **escTag on all *_TAGS scaffolds** — every NEW *_TAGS scaffold in android-adb-driver.js must regex-escape its tag value before `new RegExp(...)`; apply preemptively to avoid burning an R1 review cycle.
- **Runner-branch tests with driver method** — every new driver-method PR must ALSO add manual-qa-runner.test.js tests for the matcher's Android + iOS Sim branches (3 each).
- **Cluster preemptive checklist** — complete pre-flight list to reach ZERO-findings one-round merges on Phase-4 PRs (driver tests, prod code, runner-routing, commit/PR); PR #764 hit all items and achieved cluster's first 10-min merge.
- **Input-rejection isolation via throwing fetcher** — for guard-then-fetch methods, the 4 input-rejection tests must use a throwing iosUiDump so a future reorder regresses.
- **Verify runner-routing per platform, not per Wake** — "runner-routing pre-existing" claim must grep for `uiDriver: { iosShows<Method>:` specifically, not just the Wake-N describe header; many Wake blocks have Web+Android but no iOS Sim.

## Local Stack & Build Tooling

- **Run local stack detached — no stuck shells** — start.sh idles forever; launch detached `( nohup bash local/start.sh >/tmp/shytalk-stack.log 2>&1 </dev/null & )` (subshell orphan — macOS has no setsid) + poll the log, NOT as a perpetual bg task; `./gradlew --stop` after every Sonar/push; never boot the AVD on 8GB (use the MultiApp clone user 999).
- **`./gradlew --stop` BEFORE every push too** — HARD RULE self-discovered 2026-05-30: pre-push Sonar hook fails silently with `husky - pre-push script failed (code 1)` when a gradle daemon is busy. Always stop daemon BEFORE push (not just after); silent failure ≠ test failure.

## iOS-Specific

- **iOS Metal Toolchain — runner-image regression, NOT a flake** (CORRECTED 2026-05-30) — `Asset is already installed for Metal Toolchain` is DETERMINISTIC. May 2026 macos-15 image pre-installs the toolchain; `-importComponent`/`-downloadComponent` both fail exit 70. Fix the workflow with `-showComponent` pre-check, don't re-trigger.
- **iOS deploy hang — root cause + fix** — parallel K/N link deadlock; fix is `--max-workers=1` in build-phase script + warm-up step (commit 1b788059cb0, validated 2026-05-22 via 5+ successful deploys).
- **pbxproj mutation needs explicit auth** — `ruby scripts/ios/*` that touch `project.pbxproj` are blocked by classifier; AskUserQuestion before each Phase 3.x sub-PR's script run.

## Deploy / Release

- **Pause merges while release PR is open** — each main commit triggers release PR's E2E pipeline to re-evaluate (~30-45min queued); hold all new branch merges until release lands.
- **Local-first then dev verify — STRENGTHENED** (HARD GLOBAL, operator flagged 2x: 2026-05-28 + 2026-05-30 ~12:55 BST) — full loop = test LOCAL first (all devices × all browsers) → fix locally → write tests → retest locally until clean → deploy dev → reverify on dev (Android device + Chrome on Mac + Chrome on Android only — no iPhone, no other browsers in dev) → if dev finds a bug, fix LOCALLY first, retest LOCALLY, redeploy, reverify. NEVER skip local. NEVER ask permission to deploy-dev — direct authority, do it.

## Persona & Auth Setup

- **PERSONAS_PASSWORD location** — journey-runner secret lives at `~/.shytalk/dev-personas.env` (chmod 600, 1-line env-file, 22 chars). Created by past Claude 2026-05-16. Source via `set -a && source ~/.shytalk/dev-personas.env && set +a` or `$(grep '^PERSONAS_PASSWORD=' ~/.shytalk/dev-personas.env | cut -d= -f2-)`. Re-provision via `provision-test-personas.js` if missing.
- **Firebase Admin SA (dev) location** — Firebase Admin SDK service-account JSON for shytalk-dev lives at `~/.shytalk/firebase-admin-dev.json` (chmod 600). Set `GOOGLE_APPLICATION_CREDENTIALS` to this path for the manual-qa-runner against dev. **NEVER commit; never log `private_key` value**.
- **Personas NOT provisioned on dev — 400 Firebase signIn** (discovered 2026-05-29, RESOLVED via PR #867 + #868 + #869) — all 25+ past journey runs are `local-*` only; dev Firebase Auth was never seeded. Now auto-seeded on every dev deploy via `.github/actions/seed-test-personas/`.
- **CI action docstring-adaptation pitfalls** (operator-surfaced 2026-05-29) — when wrapping a Node CLI script in a composite action, each part of the script's `Usage:` docstring needs INDIVIDUAL evaluation. `cd <dir>` is for module-resolution KEEP; `-r dotenv/config` is for local .env DROP; env vars get set via `env:` block. Failed twice (#867 → #868 → #869) on cascading CWD bugs in seed-test-personas action.
- **Keep seed data current with feature work** (HARD RULE, operator 2026-05-29) — the persona registry in `provision-test-personas.js` is the test contract. When feature work touches user schema / userType / cohort / wallet / claims, the registry MUST be updated in the same PR + dev re-seeded via `gh workflow run seed-dev-personas.yml`. Standalone re-seed workflow (~30 sec) avoids needing a full deploy.
- **Journey-test corpus was aspirational — expect drift cascade** (operator-surfaced 2026-05-29 via the j09 dispatch trail) — corpus was gitignored for months + never live-validated; first authenticated dispatch surfaced 12 findings + each fix unblocked the next drift layer. Pattern: test contract → production schema asymmetry. 5+ PRs across server, runner, feature corpus before one scenario approaches green.

## In-Flight Initiatives

- **Room mutations → server-side authz plan** (IN PROGRESS, operator 2026-05-27) — harden room write path (verified bugs: rules let any participant write any room field = client-only role gates; takeSeat/acceptInvite non-race-safe). Chosen: route all room-doc mutations through Express+AdminSDK (role-checked, transactional seat-claims) then lock firestore.rules. Phased P1 Express→P2 client migrate(Android+iOS)→P3 rules lockdown→P4 prod; rules/prod phases CHECKPOINT operator.


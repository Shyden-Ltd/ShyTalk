---
id: SHY-0207
status: In Progress
owner: claude
created: 2026-07-18
priority: P1
effort: S
type: bug
roadmap_ids: []
pr:
---

# SHY-0207: iOS local device builds get a real version identity (kill the hardcoded 1.0 (1))

## User Story

As the ShyTalk operator reading an iPhone's preview watermark, I want locally-built iOS installs to show the real app version and a monotonic build number — like Android's `local · 0.97.15 (176)` — instead of the hardcoded `1.0 (1)`, so that a glance at the badge tells me whether the install is current.

## Why

Operator task #11 (2026-07-18, ordered right after the watermark). `1.0 (1)` comes from `project.pbxproj`'s `MARKETING_VERSION = 1.0` / `CURRENT_PROJECT_VERSION = 1` defaults; CI already overrides both at archive time (deploy-dev.yml passes `MARKETING_VERSION=<gradle versionName>` + `CURRENT_PROJECT_VERSION=$GITHUB_RUN_NUMBER`), so ONLY local device builds (`scripts/ios/build-debug-dev.sh`) are affected — SHY-0205's iPhone walk showed `dev · 1.0 (1) · api 03e8f4a`: a real server sha next to a meaningless client version.

**Best-solution check (per the 2026-07-18 ticket bar):** alternatives considered — (a) edit pbxproj defaults: rejected (pbxproj mutation requires explicit operator auth, and defaults would still go stale vs gradle); (b) a Versions.xcconfig: rejected (new file + pbxproj wiring for the same effect); (c) **chosen** — pass both values as xcodebuild CLI settings from the build script, the exact seam CI already uses and SHY-0205 just extended with `SHYTALK_GIT_*` (zero new mechanism, single source of truth stays `app/build.gradle.kts`'s `versionName`, no pbxproj change). Build number = `git rev-list --count HEAD` — monotonic per branch history, meaningful ("commit #1607"), and needs no external counter locally.

## Acceptance Criteria

### Happy path

- [ ] `scripts/ios/build-debug-dev.sh` passes `MARKETING_VERSION=<versionName parsed from app/build.gradle.kts>` and `CURRENT_PROJECT_VERSION=<git rev-list --count HEAD>` to xcodebuild, reusing deploy-dev.yml's anchored awk + strict 3-int-semver validation verbatim.
- [ ] A freshly built local install's watermark reads `dev · <versionName> (<commit-count>)` (e.g. `dev · 0.97.15 (1607)`), device-verified.
- [ ] CI archives are UNTOUCHED (deploy-dev.yml already correct; pinned unchanged).

### Error paths

- [ ] versionName unparseable / not strict semver → the script FAILS loudly before xcodebuild (same message shape as CI) — never silently ships `1.0 (1)` again.
- [ ] git unavailable for the commit count → build fails loudly (the script already requires a repo for the SHY-0205 git stamps; consistent fail-fast).

### Edge cases

- [ ] Shallow clone (commit count artificially low): N/A locally — the operator's checkout is full; documented in the script comment.
- [ ] Detached HEAD: `rev-list --count HEAD` still counts — build number stays meaningful.

### Performance

- [ ] N/A — two subprocess calls prepended to a multi-minute build.

### Security

- [ ] No new secrets/values in logs beyond the version pair (redacted-echo line updated to include them — they are non-secret).

### UX

- [ ] N/A — QA badge content only; no end-user surface.

### i18n

- [ ] N/A — numeric version identity, no user-facing strings.

### Observability

- [ ] The script echoes the resolved `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION` once (greppable in build logs), and the watermark + iOS `build identity` NSLog carry them on-device.

## BDD Scenarios

**Scenario: local iPhone build shows the real version**
- **Given** `app/build.gradle.kts` says `versionName = "0.97.15"` and the checkout has N commits
- **When** `build-debug-dev.sh` builds and installs on the iPhone
- **Then** the preview watermark's status line reads `dev · 0.97.15 (N) · api <sha>` and the NSLog identity line matches

**Scenario: corrupt versionName fails fast**
- **Given** a build.gradle.kts whose versionName is not strict `X.Y.Z`
- **When** the script runs
- **Then** it exits non-zero BEFORE xcodebuild with the same error shape CI uses

**Scenario: CI path unchanged**
- **Given** deploy-dev.yml's archive step
- **When** the pin suite runs
- **Then** its existing `CURRENT_PROJECT_VERSION="${BUILD_NUMBER}"` / `MARKETING_VERSION="${VERSION_NAME}"` lines are still asserted verbatim

## Test Plan

- `express-api/tests/scripts/ios-dev-configuration.test.js` (extend, RED first): build-debug-dev.sh passes both settings; parses versionName via the anchored awk shape; validates strict semver with a loud failure; computes the count via `git rev-list --count HEAD`; deploy-dev.yml's existing version overrides remain (regression pin).
- Gates: shellcheck on the script, prettier/eslint on the test file, the full ios-dev-configuration suite green.
- Device verification (Pre-Merge Protocol — the script is the iOS build path): rebuild + install on iPhone 74563FF8 DETACHED with scheduled checks (fire-and-schedule pattern), then devicectl screenshot: watermark shows `dev · 0.97.15 (<count>)`.
- Classification: touches the local build SCRIPT only (no app/runtime source) — Android/web surfaces unaffected; the iOS device walk is the full relevant gauntlet.

## Out of Scope

- CI versioning (already correct), TestFlight build-number policy, pbxproj edits, Android versioning, the watermark itself (SHY-0205).

## Dependencies

- SHY-0205 merged (the script's xcodebuild-settings block + the pin-suite section this extends). No pbxproj mutation anywhere (else STOP → operator).

## Risks & Mitigations

- **CFBundleVersion collision with TestFlight uploads** → none: local Debug-Dev installs never upload; CI keeps `GITHUB_RUN_NUMBER`.
- **Commit-count ≠ CI run-number scales** → they never compare against each other; each channel is internally monotonic. Documented in the script.
- **awk drift between script and CI** → the pin test asserts BOTH use the same anchored pattern.

## Definition of Done

- [ ] ACs checked; pins RED→GREEN; shellcheck/eslint/prettier clean; iPhone walk evidence (screenshot + NSLog line) in Notes; code-reviewer clean; PR → develop merged; In Review until release.

## Notes

- 2026-07-18 ~16:40 WIB — Story born-refined during the post-SHY-0205 pickup; best-solution alternatives recorded in ## Why per the new ticket bar.

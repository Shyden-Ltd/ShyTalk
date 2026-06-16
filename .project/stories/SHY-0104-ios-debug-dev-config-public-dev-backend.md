---
id: SHY-0104
status: In Review
owner: claude
created: 2026-06-15
priority: P2
effort: M
type: infra
roadmap_ids: []
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1443
public: false
mvp: false
---

# SHY-0104: iOS Debug-Dev build configuration — public dev backend + persona picker (parity with Android dev flavor)

## User Story

As a **developer/QA testing ShyTalk on a real iPhone**, I want **an iOS build that runs against the public dev backend (shytalk-dev + dev-api) with the test-persona picker available**, so that **I can run real-device iOS journey/regression gauntlets on dev exactly as the Android `dev` flavor already does — without exposing the local emulator stack to the LAN**.

## Why

Operator directive (2026-06-15): "for dev, use the public dev backend always — this is how it's intended to be," for **all devices** including iOS. Today iOS has only two paths and neither supports a real-device dev gauntlet:

- **Debug** (`#if DEBUG` in `iosApp/iosApp/iOSApp.swift`): forces the **local Firebase emulators** (`project=demo-shytalk`, `http://localhost:…`) with the picker enabled (`devPersonasPassword` set to the committed local-emulator seed value, sourced from `local/seed.js`). On a *real* iPhone this requires rebinding the emulators to `0.0.0.0` — a LAN-exposure security regression the team explicitly reverted. Not acceptable.
- **Release** (`#else`): already targets the **public dev backend** correctly — `FirebaseApp.configure()` with the bundled `shytalk-dev` `GoogleService-Info.plist`, `environment: "dev"`, `apiBaseUrl: "https://dev-api.shytalk.shyden.co.uk"` — BUT `devPersonasPassword: nil` (line ~101), so the **persona picker is disabled** (deliberately, so the shared seed password literal is stripped from distributable IPAs — an anti-reverse-engineering measure). So you can't sign in as a seeded test persona.

Result: there is no iOS build that combines **public dev backend** + **persona picker**, which is exactly what a real-device dev gauntlet needs (the Android `dev` flavor has both: `dev-api` + `DEV_QA_PERSONAS_PASSWORD`-gated picker). This story adds a **Debug-Dev** configuration that fills the gap, keeping the password only in a **non-distributable debug** config so the IPA-leak protection is preserved.

This directly unblocks the real-iPhone image gauntlet for coil #1428 (and every future iOS-on-dev verification).

## Acceptance Criteria

### Happy path
- [ ] A `Debug-Dev` build installed on a real iPhone configures Firebase against **shytalk-dev** (bundled plist; NOT the local emulators) and uses `apiBaseUrl = https://dev-api.shytalk.shyden.co.uk` (assert via the startup env log + a successful authed call).
- [ ] The **persona picker** is available on `Debug-Dev` (because `devPersonasPassword` is set to the real `DEV_QA_PERSONAS_PASSWORD`), and signing in as a seeded dev persona (e.g. P-02 Alice) succeeds end-to-end against shytalk-dev.
- [ ] After sign-in, the app functions against dev (rooms/profile/economy reachable over real TLS) — i.e. a real-device dev journey is now runnable on iOS.

### Error paths
- [ ] If `DEV_QA_PERSONAS_PASSWORD` is empty/unset at build time, the picker is hidden (`BuildVariant.isPersonaPickerAvailable == false`) — fail closed, identical to Android's behaviour; no crash, no empty picker.
- [ ] A `Debug-Dev` build must NOT silently fall back to the local emulators if dev is unreachable — it surfaces a normal network error, not a localhost connection attempt.

### Edge cases
- [ ] `Debug-Dev` is excluded from any archive/distribution scheme (TestFlight/App Store) — only the existing Release/Distribution path ships, and that path keeps `devPersonasPassword: nil`.
- [ ] The simulator and device (`iosSimulatorArm64` / `iosArm64`) both build under `Debug-Dev`.
- [ ] Existing `Debug` (local-emulator) and `Release` (dev, no picker) behaviours are unchanged — this is additive.

### Performance
- [ ] N/A — build-configuration + env-wiring change; no runtime hot path affected.

### Security
- [ ] The shared persona password literal appears ONLY in `Debug-Dev` (a non-distributable debug config) — verified absent from any Release/Distribution `.ipa` (`strings`/symbol check). The existing IPA-leak protection is preserved.
- [ ] `Debug-Dev` cannot be selected by the distribution/export pipeline (`ExportOptions.plist` / archive scheme audited).
- [ ] No local-emulator LAN exposure is introduced anywhere (the whole point — this REPLACES the `0.0.0.0` rebind path).
- [ ] **`project.pbxproj` mutation requires operator auth** before running any config-adding script (per CLAUDE.md / `pbxproj mutation needs explicit auth`).

### UX
- [ ] On `Debug-Dev`, the sign-in screen shows the "Sign in as test persona" entry (picker), like the Android dev flavor; the dev/preview watermark renders (`environment != "prod"`).

### i18n
- [ ] N/A — no new user-facing strings.

### Observability
- [ ] Startup `NSLog` clearly states the active environment ("Debug-Dev — shytalk-dev / dev-api", distinct from the existing "DEBUG build — using Firebase Emulators" line) so a misconfigured build is obvious in the device console.

## BDD Scenarios

**Scenario: Debug-Dev build signs in as a dev persona against shytalk-dev**
- **Given** an iPhone with a `Debug-Dev` build whose `DEV_QA_PERSONAS_PASSWORD` was injected at build time
- **When** the user taps "Sign in as test persona" and selects P-02 (Alice)
- **Then** Firebase Auth authenticates against shytalk-dev (not the local emulator)
- **And** the app loads the signed-in experience over `https://dev-api.shytalk.shyden.co.uk`

**Scenario: picker hidden when password absent**
- **Given** a `Debug-Dev` build compiled WITHOUT `DEV_QA_PERSONAS_PASSWORD`
- **When** the sign-in screen renders
- **Then** the persona-picker entry is not shown (`isPersonaPickerAvailable == false`)

**Scenario: distributable build still has no picker/password**
- **Given** a Release/Distribution archive
- **When** the `.ipa` is inspected
- **Then** the shared persona password literal is absent
- **And** `devPersonasPassword` was `nil` at init

**Scenario: existing Debug (local) path unchanged**
- **Given** the plain `Debug` configuration
- **When** the app launches
- **Then** it still targets the local emulators (`demo-shytalk`, localhost) with the local-emulator seed password

## Test Plan

**RED (write first):**
- `shared/src/commonTest/kotlin/com/shyden/shytalk/core/BuildVariantTest.kt` — add cases asserting `isPersonaPickerAvailable` is driven by `localDevPersonasPassword` presence for the dev-with-picker init path (mirrors the existing Android-side expectation); RED until the iOS init passes the password.
- `iosApp/iosAppTests` (XCTest) — a test that, given the Debug-Dev compile flag, the env-resolution helper returns `environment="dev"`, `apiBaseUrl="https://dev-api…"`, `useEmulators=false`, and a non-nil persona password; RED until the Swift branch exists. (Refactor the `iOSApp.swift` init env-selection into a testable pure function first — no logic in the `App.init()` that can't be unit-tested.)

**GREEN:**
- Add `iosApp/Configurations/Dev.xcconfig` carrying `DEV_QA_PERSONAS_PASSWORD` (injected from `~/.shytalk/dev-personas.env` at build time; never committed) + dev markers.
- Add a `Debug-Dev` build configuration (via a reviewed `scripts/ios/*` ruby helper — **operator-authed pbxproj edit**) with a compile flag (e.g. `DEV_BACKEND`).
- Branch `iOSApp.swift` init: under `DEV_BACKEND`, configure dev (bundled shytalk-dev plist, `useEmulators:false`, `apiBaseUrl` dev, `devPersonasPassword` = xcconfig value, `environment:"dev"`); leave existing `#if DEBUG` (local) and `#else` (dev-no-picker Release) intact.
- All RED tests pass; existing iOS unit/UI suites stay green; `:shared:compileKotlinIosArm64` + simulator compile green.

**Gauntlet (Pre-Merge Protocol):**
- Real iPhone: build+install `Debug-Dev`, sign in as a dev persona, walk core journeys against dev; confirm NO localhost traffic. (This is the capability that lets coil #1428's iPhone image check run.)
- Confirm a Release/Distribution archive still excludes the password (security AC).

## Out of Scope

- The coil 3.5 bump (#1428) — this story is the prerequisite that enables iOS-on-dev real-device testing; coil merges on its own coverage independently.
- A `Debug-Prod` / real-prod iOS path (prod bundle-ID flow doesn't exist yet — noted in `iOSApp.swift`).
- Android changes (Android dev flavor already does this).
- CI wiring of the Debug-Dev config (CI keeps using the simulator Release/dev path); local-only build config unless a follow-up needs it.

## Dependencies

- `iosApp/iosApp/iOSApp.swift` (env-selection init, lines ~11–113), `iosApp/Configurations/` (xcconfig), `iosApp/iosApp.xcodeproj/project.pbxproj` (new configuration).
- `shared/.../core/BuildVariant.kt` (`isPersonaPickerAvailable`, `localDevPersonasPassword`) + `KoinHelper.doInitKoin(...)` iOS entry.
- Bundled `iosApp/iosApp/GoogleService-Info.plist` (already `shytalk-dev` — no console fetch needed).
- `DEV_QA_PERSONAS_PASSWORD` source: `~/.shytalk/dev-personas.env` (`PERSONAS_PASSWORD`).
- Dev personas seeded on shytalk-dev (already auto-seeded on dev deploy).

## Risks & Mitigations

- **Risk:** `project.pbxproj` corruption from the config-add script. **Mitigation:** operator-authed, reviewed ruby helper (pattern of `scripts/ios/add-local-configurations.rb`); commit the pbxproj diff in isolation; verify all schemes still resolve.
- **Risk:** the persona password leaks into a distributable IPA. **Mitigation:** password lives only in `Debug-Dev` (non-distributable); Security AC verifies absence from Release IPA via `strings`.
- **Risk:** Debug-Dev accidentally selected for archive/TestFlight. **Mitigation:** archive scheme + ExportOptions audited to use Release only; Edge-case AC.
- **Risk:** env-selection logic untestable inside `App.init()`. **Mitigation:** extract a pure env-resolver function and unit-test it (XCTest), per the Test Plan.

## Definition of Done

- Debug-Dev config builds (device + sim), signs in as a dev persona against shytalk-dev on a real iPhone, no localhost traffic; existing Debug/Release paths unchanged.
- Security AC proven (password absent from Release IPA; no LAN exposure introduced).
- RED tests written first then green; iOS unit/UI + shared compile green.
- Released in a `vX.Y.Z` cut with `released_in:` set.

## Notes (running log)

- 2026-06-15 — Filed from the coil #1428 real-iPhone gauntlet. Operator directive: dev testing must use the public dev backend on all devices ("this is how it's intended to be"), NOT local-stack-over-LAN (which would need the reverted `0.0.0.0` emulator exposure). Investigation found `iOSApp.swift` Release branch ALREADY targets shytalk-dev + dev-api; the only gap is `devPersonasPassword: nil` outside `#if DEBUG` (deliberate IPA-leak protection). This story adds a Debug-Dev path that keeps the picker in a non-distributable config. Operator chose (coil #1428 sequencing): file this story + merge coil on its CI/Android/link coverage; the iPhone coil-image check rides on this story's first real-device build. pbxproj edit needs operator auth at implementation time.
- 2026-06-16 ~11:35 BST — Implemented (TDD red→green). Design: compile-flag `DEV_BACKEND` (over a runtime plist flag) so Release hard-codes `nil` (strongest no-picker guarantee) + the local-emulator literals stay compile-stripped from dev/release. Pure `AppEnvironment.resolve(variant:personasPassword:)` (new `AppEnvironment.swift`) owns the variant→config mapping; `iOSApp.swift` `init()` now `#if DEV_BACKEND / #elseif DEBUG / #else` (order matters — Debug-Dev defines both DEV_BACKEND+DEBUG). Password injected at build time via Info.plist `DevQaPersonasPassword = $(DEV_QA_PERSONAS_PASSWORD)` (empty everywhere but Debug-Dev → absent from any distributable IPA). `Dev.xcconfig` (empty password default = fail-closed). `scripts/ios/add-dev-configuration.rb` (operator-authed pbxproj mutation; idempotent; xcodeproj gem) + Podfile `'Debug-Dev' => :debug` + `pod install`. **All 3 targets** (iosApp + iosAppTests + iosAppUITests) get Debug-Dev — closes the SWIFT_VERSION gap the Local build-out left (test-target configs deferred there); only iosApp carries DEV_BACKEND. `scripts/ios/build-debug-dev.sh` install helper. Tests: 11 XCTest resolver cases (value matrix, fail-closed, release-strips-even-if-passed) + 27 JS assertions (xcconfig + pbxproj structure + Info.plist + Podfile + script idempotency) — all GREEN. DEV_BACKEND confirmed in both pbxproj Debug-Dev configs; password injection confirmed via `xcodebuild -showBuildSettings` override.
- 2026-06-16 ~11:35 BST — **ENVIRONMENTAL BLOCKER (real-device gauntlet):** Sean's iPhone runs **iOS 27.0**; this Mac's **Xcode is 26.5 (SDK iOS 26.5)** — too old to build for an iOS 27.0 *device* ("iOS 26.5 is not installed" destination error). This blocks ALL iOS real-device builds (not just SHY-0104 — affects EPIC-0003's iOS cells too). An iOS **27.0 simulator** runtime IS installed (iPhone 17 family), so functional verification (DEV_BACKEND compiles, resolver tests, dev-backend boot + picker) runs there. The protocol's real-iPhone journey gauntlet needs Xcode 27.x (operator action) OR a device on a supported iOS. Escalating to operator with options.
- 2026-06-16 — Pre-existing (out of scope, repo-wide): `pod install` emits a FirebaseCore CocoaPods-deprecation notice (Firebase ends CocoaPods publishing Oct 2026 → future SPM migration). Not introduced by SHY-0104.
- 2026-06-16 ~12:25 BST — **iOS build VERIFIED on Xcode 27 / iOS 27.0 sim.** Toolchain: active Xcode was 26.5 (too old for the iPhone's iOS 27.0); Xcode 27 is installed at `/Applications/Xcode-beta.app` — used via `DEVELOPER_DIR` (non-destructive, no sudo). Building Debug-Dev surfaced **three latent landmines, all pre-existing in the Local build-out, none catchable by unit tests / review** (only by building a Configurations-based config — Debug-Dev is the first ever built): (1) the `Configurations` PBXGroup resolved to a doubled `iosApp/iosApp/Configurations` path → fixed by pinning the group `sourceTree = SOURCE_ROOT` (corrects Dev **and** the latent Local.xcconfig ref); (2) the KMP/Compose framework phase can't infer build type from the custom name `Debug-Dev` → set `KOTLIN_FRAMEWORK_BUILD_TYPE = debug` in Dev.xcconfig; (3) `AppEnvironment.swift` / `AppEnvironmentTests.swift` had no target membership (a raw file write isn't compiled) → `add-dev-configuration.rb` now adds both to their Sources phases. Both scripts hardened (add-local got the sourceTree fix too); new JS assertions pin the membership + KMP type (Dev+Local JS suites 63→ green). **GREEN:** `xcodebuild test -configuration Debug-Dev` on the iPhone 17 sim → AppEnvironmentTests **11/11 pass** (proves `#if DEV_BACKEND` compiles + resolver correct). **Functional:** app launches against dev — startup log `[ShyTalk] Debug-Dev build — shytalk-dev / dev-api (persona picker ENABLED)`; the red preview watermark reads `dev · 1.0 (1)`; app renders the dev-served policy-acceptance starting screen (dev backend reachable). **Security AC:** built Debug-Dev Info.plist `DevQaPersonasPassword` len=22 (injected); Release + Debug leave `DEV_QA_PERSONAS_PASSWORD` undefined → resolves empty → credential ABSENT from any distributable IPA. **Real-device deliverable PROVEN (~12:40 BST):** `build-debug-dev.sh` (DEVELOPER_DIR=Xcode 27) auto-detected the iPhone via its xctrace hardware UDID (00008150-…), compiled the iosArm64 KMP framework, signed, and installed Debug-Dev on Sean's iPhone (bundleID com.shyden.shytalk). Remaining (out of SHY-0104 scope): full real-device journey gauntlet needs the iOS Appium apparatus (EPIC-0003 / SHY-0094-0095) — SHY-0104 unblocks it.
- 2026-06-16 ~11:50 BST — `code-reviewer` (pre-push, branch-isolated, commit 71dee610df2): **ZERO Critical/Blocker.** 2 Important + 3 Minor, ALL applied: (Imp-1) test-target XCConfigurationList membership was asserted only via the count=4 proxy → added direct `iosAppTests` + `iosAppUITests` list-membership assertions (UUIDs verified via xcodeproj). (Imp-2) whitespace-only password edge untested → added `test_dev_withWhitespaceOnlyPassword...` documenting the empty-only coercion (matches Kotlin `takeIf { isNotEmpty() }`). (Min-1) count-comment accuracy → resolved by the new tests. (Min-2) `build-debug-dev.sh` device detection was brittle AND wrong-id (parsed devicectl's coredevice UUID, which `xcodebuild -destination id=` rejects) → switched to the `xctrace` hardware UDID. (Min-3) no Release-branch `NSLog` → added, completing the Observability AC for all 3 variants. Post-fix: jest 29/29, shellcheck + eslint + prettier clean.

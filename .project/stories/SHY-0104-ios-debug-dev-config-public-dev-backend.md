---
id: SHY-0104
status: Draft
owner: claude
created: 2026-06-15
priority: P2
effort: M
type: infra
roadmap_ids: []
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

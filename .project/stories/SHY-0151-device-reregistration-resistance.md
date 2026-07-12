---
id: SHY-0151
status: In Review
owner: claude
created: 2026-07-01
priority: P1
effort: L
type: feature
roadmap_ids: []
epic: EPIC-0005
pr:
mvp: true
---

# SHY-0151: Reinstall-proof device bans via DeviceCheck (iOS) + Play Integrity (Android)

## User Story

**As** the team issuing device bans,
**I want** a banned device to stay banned even after a reinstall or data-clear — keyed off the **platforms' own device-integrity primitives** (Apple DeviceCheck, Google Play Integrity) rather than a resettable app-generated ID,
**So that** a banned device can't return simply by reinstalling, and **no innocent device is ever mistaken for a banned one**.

## Why

The bypass-surface review found the device ID is a **resettable** value — Android `Settings.Secure.ANDROID_ID` (`DeviceInfoCollector.android.kt:16-19`) and iOS `identifierForVendor` (`DeviceInfoCollector.ios.kt:31`) both reset on clear-data/reinstall, so a device ban keyed on them evaporates.

Hardware IDs (serial / IMEI / SIM) — the intuitive fix — are **platform-blocked for consumer apps**: Android 10+ requires `READ_PRIVILEGED_PHONE_STATE` (a system permission Google Play does not grant), iOS has never exposed them, and SIM is both restricted and swappable. So the fix uses the platforms' sanctioned anti-abuse primitives, which are **free** and **deterministic** (no false positives, unlike heuristic fingerprinting):
- **iOS — DeviceCheck:** Apple persists **2 bits per physical device** that **survive app reinstall/data-clear**, managed by Apple + keyed to the developer account. We set a "banned" bit on a banned device; on a fresh install we query it and re-apply the ban. Deterministic, Apple-managed, zero false positives.
- **Android — Play Integrity:** no DeviceCheck equivalent exists, so Android is attestation-based: Play Integrity verifies a **genuine, untampered device** and lets us bind a server-issued device token, raising evasion cost and letting us gate off an *attested* signal rather than a resettable ID. (Honest asymmetry: iOS gets a near-perfect persistent bit; Android gets strong attestation + a server token, not a permanent hardware ID.)

Operator decision (2026-07-01): use DeviceCheck + Play Integrity (both free); **phone-number verification is flagged as a possible future *paid* lever** (SMS has a per-verification cost, so it doesn't meet the "free" bar) — out of scope here.

## Acceptance Criteria

### Happy path
- [ ] A normal, untampered device passes its platform integrity check (DeviceCheck bit clear on iOS; Play Integrity "genuine" on Android) and onboards normally — no false block.
- [ ] Device bans are keyed off the platform primitive (DeviceCheck bit / Play-Integrity-bound token), **not** the resettable `ANDROID_ID` / `identifierForVendor`.

### Error paths
- [ ] A **banned iPhone that reinstalls** is recognised via its **persisted DeviceCheck bit** and re-blocked (Apple remembers the device across the reinstall).
- [ ] A **banned Android device that returns** is recognised via its Play-Integrity-attested / server-bound device signal and blocked or flagged.

### Edge cases
- [ ] **DeviceCheck is only 2 bits** — used as a binary "banned" flag (not general state); the design stays within that budget.
- [ ] **iOS device with no Apple-services / DeviceCheck availability** → a documented fallback (fall back to the existing signals + server enforcement; never a silent pass, never a false block).
- [ ] **Android device where Play Integrity is unavailable / fails** (no Play Services, uncertified) → treated as an unsafe/untrusted device (consistent with the existing Android device gate + SHY-0146), not silently trusted.
- [ ] **No false positives:** because the key is a platform-managed per-device signal (not a heuristic match), an innocent device is **never** mistaken for a banned one — the whole reason for this approach over fingerprint correlation.

### Performance
- [ ] The DeviceCheck / Play Integrity calls are async, done at registration / sign-in (not per-request); bounded; no measurable onboarding delay in the normal case.

### Security
- [x] **Prerequisite (increment 1): iOS actually runs the auth-stage device checks.** The iOS DI hardcoded `bypassDeviceChecks = true` for EVERY build (TestFlight included), silently skipping the SHY-0170 device-lock and SHY-0149 ban application on iOS while Android enforced them (found by SHY-0170's review, routed here via EPIC-0005). Fixed variant-resolved + fail-closed: only the `.local` build bypasses (mirroring Android's `BYPASS_DEVICE_CHECKS` flavor table); dev/release enforce; a platform that never initialises the flag gets enforcement.
- [ ] Reinstall-surviving, deterministic device bans: **iOS strong** (DeviceCheck bit persists across reinstall); **Android** via attestation + server-bound token. Keyed off platform-trusted signals, needing **no** hardware-ID permissions.
- [ ] Honest boundary: a determined attacker with genuinely new hardware still returns — this is layered with SHY-0149 (server enforcement) + SHY-0150 (rules) + account/network bans; it raises the cost, it is not an absolute lock (documented).
- [ ] The DeviceCheck bit / integrity verdict is set + read **server-side** with the platform keys; not client-forgeable.

### UX
- [ ] **Zero false positives** — a legitimate device is never wrongly blocked (deterministic, not a guess); a genuinely banned device sees the ban screen.

### i18n
- N/A — server-side device-integrity logic; any user-facing block reuses the existing localized ban screen.

### Observability
- [ ] The device-integrity decisions are logged for audit — DeviceCheck bit set/query results, Play Integrity verdicts, and the ban action taken — per [[feedback-comprehensive-default-debug-logging]]; no secret keys logged.

## BDD Scenarios

**Scenario: a banned iPhone stays banned even after reinstalling**
- **Given** an iPhone that was banned
- **When** it reinstalls the app to try to get a fresh start
- **Then** it is still recognised as the banned device and blocked (the device is remembered across the reinstall)

**Scenario: a banned Android device is recognised when it returns**
- **Given** a banned Android device
- **When** it reinstalls and tries to sign up again
- **Then** the app's device-integrity check recognises it and blocks or flags it

**Scenario: an ordinary device is never wrongly blocked**
- **Given** an ordinary, untampered device
- **When** someone installs the app and signs up
- **Then** they are never mistaken for a banned device — the check is exact, not a guess

**Scenario: a device that can't prove it's genuine is treated as unsafe**
- **Given** a device that fails the platform's genuineness check (for example a tampered or uncertified device)
- **When** it opens the app
- **Then** it is treated as an unsafe device, not silently trusted

## Test Plan

Touches `express-api/**` (DeviceCheck bit + Play Integrity verdict verification, server-side, with the platform keys) + the app device-registration path (iOS DeviceCheck token, Android Play Integrity token) → **backend + app change ⇒ Gate 4 full gauntlet**. Per § No Stubs: DeviceCheck + Play Integrity require **real Apple/Google services on real devices** (they cannot be emulated) — so the device legs are essential + partly operator-gated ([[project-qa-gauntlet-operator-gated]]).

**Red → Green (framework by framework):**
- **Express/Node (Jest, real emulator + real platform APIs where possible)**: the ban→DeviceCheck-bit set/query lifecycle (server sets the bit on ban, queries on registration); Play Integrity verdict verification (genuine → pass; failed/absent → treated unsafe); the device-ban key is the platform signal, not `ANDROID_ID`/`identifierForVendor`. Server-side token/verdict verification with the platform keys.
- **iOS (real iPhone, XCTest + on-device)**: DeviceCheck token generation on the device; a **real reinstall** → the persisted bit still flags the banned device (the core proof — needs a real device + Apple services; operator-gated).
- **Android (real device CPH2653)**: Play Integrity token on-device; a banned device reinstall → recognised/flagged; a device without Play Services → treated unsafe.
- **Static/quality:** `npm run lint` 0 warnings; prettier clean; iOS/Android lint clean.

**Increment-1 (iOS enforcement) — cross-language wiring guard + device-gauntlet note (added after code-review R1):**
- **`IosBypassDeviceChecksWiringPinTest` (`shared/src/jvmTest`)** pins the DI wiring the bug lived in: `IosPlatformModule.kt` must bind `named("bypassDeviceChecks")` to `BuildVariant.bypassDeviceChecks` (never a hardcoded `{ true }`), and `iOSApp.swift` must forward `env.bypassDeviceChecks` into `doInitKoin` (never a hardcoded bool). Reads the real source files at runtime; `shared/build.gradle.kts` declares both files as `jvmTest` task inputs so Gradle re-runs the pin whenever either changes (verified: mutating the DI to `{ true }` re-runs the pin unprompted and fails). Mutation-verified both directions.
- **Phase-3 DEV-gauntlet operational note (device-lock now LIVE on iOS):** because increment 1 makes iOS `.dev`/`.release` builds actually run `resolveDeviceLockOrBlock()`, the FIRST persona sign-in binds the physical QA iPhone's `deviceId`; a SUBSEQUENT DIFFERENT persona on the SAME iPhone will correctly hit the device-locked screen (device-binding, SHY-0170). This matches Android's already-tested `assembleDevRelease` behaviour. When walking the multi-persona journeys (j01–j20) on the real iPhone, CLEAR `deviceBindings` for that device between persona switches — `POST /api/cleanup/all-device-bindings` (or the per-`uniqueId` scoped `POST /api/cleanup/device-binding/:uniqueId`) — so a correctly-working device-lock is not misread as an iOS regression.
- **Deferred device-E2E (named, per the MVP batch plan):** the true end-to-end proof of iOS enforcement is a real-iPhone journey — sign in as persona X (binds device), then persona Y on the same `.dev` build → Y lands on the device-locked screen (not the main UI); and a banned persona on iOS sees the ban screen at sign-in. Batched to the final real-device gauntlet with the DeviceCheck/Play Integrity increments.
- **Phase 1 LOCAL gauntlet:** Gate-4 full matrix — a real iPhone banned then reinstalled → still blocked (DeviceCheck); a real Android device banned then returning → flagged; ordinary devices unaffected. **Phase 2:** `code-reviewer` 100% clean → In Review → CI green. **Phase 3 (DEV):** verify DeviceCheck/Play Integrity against dev with the real platform keys.

## Out of Scope
- **Heuristic device fingerprinting / correlation** — explicitly replaced by the deterministic platform primitives (no false-positive risk).
- **Phone-number verification** — a strong *account-level* barrier, but SMS/OTP has a **per-verification cost** so it does not meet the "free" bar for launch (operator 2026-07-01). Flagged as a **possible future paid enhancement**; file its own story if/when the abuse justifies the cost.
- Serial / IMEI / SIM keying — **not possible** on consumer iOS/Android (platform-blocked; see Why).
- The **API/middleware** gate (SHY-0149) + **rules-level** gate (SHY-0150) — the enforcement layers this feeds; iOS in-app integrity detection is EPIC-0004 SHY-0146 (App Attest/DeviceCheck for *genuineness*; this story uses DeviceCheck for *ban persistence* — related, coordinate).

## Dependencies
- Apple **DeviceCheck** (developer-account key + the server-side API) + Google **Play Integrity API** (+ Play Services on device).
- The device-registration path (`/api/device-info`) + `DeviceInfoCollector` (android/ios) to carry the platform tokens.
- The `deviceBans` records + the ban lifecycle in SHY-0149 (where a ban sets the DeviceCheck bit / marks the token).
- Coordinate with SHY-0146 (iOS App Attest/DeviceCheck for device genuineness) to avoid duplicate DeviceCheck wiring.

## Risks & Mitigations
- **Risk:** DeviceCheck's 2-bit limit is too little for future needs. **Mitigation:** scope it to the binary "banned" flag now; richer per-device state is a separate concern.
- **Risk:** Android has no permanent per-device ID → a banned Android device with new hardware / a reset returns. **Mitigation:** honest defense-in-depth — Play Integrity + server token raise the cost; layered with SHY-0149/0150 + account/network bans; documented, not over-claimed.
- **Risk:** DeviceCheck/Play Integrity availability gaps (no Apple services / no Play Services). **Mitigation:** documented fallbacks that fail toward *treat-as-unsafe* / server-enforced, never a silent trusted pass or a false block.
- **Risk:** privacy/legal of device attestation. **Mitigation:** DeviceCheck/Play Integrity are Apple/Google-sanctioned + lighter-touch than raw fingerprinting; flag for the launch privacy/legal review ([[project-gdpr-export-osa17-legal-review]]).
- **Risk:** DeviceCheck/Play Integrity can't be emulated → CI can't fully cover it. **Mitigation:** the reinstall-survival proof is an operator-gated real-device gauntlet cell; server-side verdict verification is unit/integration-tested.

## Definition of Done
- [ ] DeviceCheck (iOS) bit set/query + Play Integrity (Android) verdict verification wired server-side + on-device; device bans keyed off the platform signal; documented fallbacks.
- [ ] **Pre-Merge Testing Protocol satisfied (Gate-4 full matrix):** Jest RED→GREEN (bit/verdict lifecycle · unsafe-on-failure · key-is-platform-signal) + **real-device reinstall-survival proof** (real iPhone DeviceCheck + real Android Play Integrity, operator-gated) → LOCAL gauntlet green → `code-reviewer` 100% clean → In Review → push → CI green → DEV green → **judgment-merge** (NO auto-merge; notify operator).
- [ ] `released_in: vX.Y.Z` set on the next release cut.

## Notes (running log)

Reviewed-up-to: 8ec2d3b0602

- 2026-07-13 ~03:10 WIB — **Increment-1 on-device enforcement proof ATTEMPTED; harness fully unblocked; the ONLY remaining gate is the per-session, un-automatable iOS "enable automation mode" prompt the operator must answer at the phone EACH Appium session.** Post-SHY-0095-merge the iOS Appium path is otherwise green: branch develop-merged (dd94e589741), gauntlet green, Debug-Dev built from THIS branch + installed (`com.shyden.shytalk`), WDA `build-for-testing` RC=0 (signing fine), device reachable (usbmuxd sees `00008150-…`, CoreDevice tunnel up), `unlockedSinceBoot:true`. A staged proof harness exists (`scratchpad/shy0151-proof.js`: phases bind-x→lock-y→ban-z→cleanup, real dev backend, evidence dumps; drives P-02 bind → P-05 device-locked screen `signIn_deviceLockedOk` → banned P-07 `ban_title`). **Diagnosis chain (each ruled out with evidence, ~40 min):** (1) NOT xctrace-offline (STEP-1 reachability passes; do-not-reboot per [[reference-iphone-xctrace-offline-fix]] — I rebooted once anyway = wasted, churned per [[feedback-never-churn-working-device-signing]]); (2) NOT `usePrebuiltWDA` (the [[project-afk-1527-sonar-and-device-apparatus]] verdict + [[reference-ios-wda-signing-headless]] say those launch WDA as a plain app not the XCTest server; the driver's normal flow is correct); (3) the REAL blocker per that same hard-won verdict: **"a reboot alone didn't fix it — the passcode did"** — iOS shows an "enable automation mode" prompt (`Failed to initialize for UI testing: "Timed out while enabling automation mode"` → xcodebuild 65) that a human must answer ON THE DEVICE, and it recurs EVERY session (proven tonight: operator answered once → session reached "Session created"+port-8100 stage; every subsequent session re-timed-out unanswered). (4) A secondary mechanical issue surfaced once past the gate: `RemoteXPC Connection refused to port 8100` (WDA's device HTTP server racing CoreDevice tunnel startup) — Appium's own hint is `wdaLaunchTimeout`; `IOS_FORCE_NEW_WDA=true` is COUNTERPRODUCTIVE (re-installs WDA → re-arms the automation prompt). Corrected the mis-scoped [[reference-ios27-ui-automation-consent-gate]] memory (it's a per-session on-device prompt, NOT a persistent Settings toggle). **STAGED (git stash@{0} on this branch, DEVICE-VALUE UNVERIFIED):** an env-configurable `IOS_WDA_LAUNCH_TIMEOUT_MS` cap on `ios-appium-driver.js` (unit 44/44 TDD) to ride out the 8100 race — NOT committed/PR'd because the automation-mode gate masked every device exercise of it, so its real value is unproven (per verify-by-running). **To finish (fresh, operator present at phone):** launch a session, answer the "enable automation mode" prompt within 60s (per session), reuse the consented WDA (NO force-new), apply `IOS_WDA_LAUNCH_TIMEOUT_MS=180000`; if 8100 still refuses, a device+Mac CoreDevice/usbmuxd reset is the next lever. Then the 3 proof phases run → evidence → merge #1582. This increment's CODE is unchanged + already R2-clean; only the on-device VERIFICATION is outstanding.

- 2026-07-12 01:1x WIB — **code-reviewer R2 on `6b0e9034238`: 3/4 R1 items independently-verified CLOSED (Imp-2 wiring pin + build.gradle input decl confirmed sound + non-tautological + side-effect-free; Min-3 AC box; Min-4 verb-led subject); 1 new Minor** — the Phase-3 operational note had a wrong endpoint path (`/api/admin/cleanup/...`). Verified against `express-api/src/index.js:255` (admin-cleanup mounts at `/api`, no `/admin`) + `admin-cleanup.js:768/800` → corrected to `POST /api/cleanup/all-device-bindings` + `POST /api/cleanup/device-binding/:uniqueId`. That fix is md-only (review-neutral); no feature-code drift since R1/R2 (reviewer re-read all 8 code files byte-identical). Status → In Review. Increment-1 is fully proven + clean; remaining SHY-0151 increments (DeviceCheck/Play Integrity + device-E2E) are separate.
- 2026-07-11 22:55 WIB — **PICKUP (fitness re-validated) + increment 1 built: iOS device-check enforcement.** Fitness: server-side greenfield confirmed (no DeviceCheck/Play Integrity wiring; only a bans.js comment); `/api/device-info` + devices routes present; `PLAY_SERVICE_ACCOUNT_JSON` secret exists (Play Integrity API access to verify); NO Apple DeviceCheck key — operator asked (present) to provision `.p8` + `DEVICECHECK_KEY_P8`/`DEVICECHECK_KEY_ID`/`APPLE_TEAM_ID` secrets; backend TDD proceeds without it, dev proof needs it. SHY-0146 still Draft → no duplicate DeviceCheck wiring to coordinate yet. **Increment 1 (this PR): the iOS `bypassDeviceChecks=true` hole** — found live during fitness (IosPlatformModule.kt:131 hardcoded `true` for every build; guards BOTH `resolveDeviceLockOrBlock()` [SHY-0170] and `checkAndApplyBan()` [SHY-0149] at sign-in AND new-account creation; SHY-0170 R1 had routed it to EPIC-0005 → this story is the open child). Fix mirrors Android's flavor table via the existing BuildVariant/doInitKoin pattern: `AppEnvironmentConfig.bypassDeviceChecks` (.local→true, .dev/.release→false; XCTest-pinned ×3) → `doInitKoin(bypassDeviceChecks:)` (Kotlin default false = fail-closed) → `BuildVariant.initBypassDeviceChecks` (commonTest ×4 incl. default-false + holder-independence pins, watched RED via unresolved-reference first) → DI reads `BuildVariant.bypassDeviceChecks`. AuthViewModel logic untouched (commonTest already pins both bypass=false enforcement paths at lines 410/441 and bypass=true skips); misleading "(debug build)" log corrected. `:shared:jvmTest` BuildVariantTest green; `:shared:compileKotlinIosArm64` green; `:app:compileLocalDebugKotlin` green; ktlint + detekt clean; XCTest `AppEnvironmentTests` suite PASSED via CocoaPods workspace (byt9tyzfh — all 16 incl. the 3 new bypass pins). **Mutation-verified both layers:** (1) Kotlin fail-closed default — flipped `BuildVariantConfig.bypassDeviceChecks` default `false→true`; the FIRST version of the default pin (object-getter based) SURVIVED because `@AfterTest`'s `initBypassDeviceChecks(false)` forces the shared singleton false before the test runs → a tautology (a real finding, per [[feedback-mutation-passed-means-investigate]]). Rewrote it to assert `BuildVariantConfig().bypassDeviceChecks` on a FRESH constructor instance → mutation now caught (exactly 1 test red), reverted, green. (2) Swift `.dev` enforce — mutation `.dev bypassDeviceChecks false→true` makes `test_dev_enforcesDeviceChecks` fail. The iOS workspace xcodebuild is pathologically slow (~20-30 min/build, KMP-framework reinvalidation) and the harness kept killing the tracked background runs, so I verified via a **standalone `swiftc`** compile of the REAL `AppEnvironment.swift` + a tiny `main.swift` exercising `resolve()` (seconds, not minutes): mutated `.dev=true` → `FAIL: test_dev_enforcesDeviceChecks`; restored `.dev=false` → `ALL BYPASS PINS PASS`. The `resolve()` pins are pure-function/direct-literal assertions (no shared state) so this standalone run exercises the identical logic the XCTest bundle does. Source restored to correct feature state (`.local=true, .dev=false, .release=false`); working tree clean (10 files, no mutation residue).
- 2026-07-12 01:1x WIB — **code-reviewer R1: 0 Critical / 2 Important / 2 Minor.** Core fix verified fail-closed + correct (three-layer false defaults; `.release` exhaustive-switch enforcing; boot order set-before-startKoin; Android parity confirmed against `assembleDevRelease`). Closures: (Imp-1, operational) device-lock is now LIVE on iOS → added the Phase-3 `deviceBindings`-clear note above so multi-persona journeys don't misread a working lock as a regression. (Imp-2, coverage gap — the DI-wiring bug class was unguarded) → added `IosBypassDeviceChecksWiringPinTest` + `shared/build.gradle.kts` `jvmTest` input declaration (mutation-verified it re-runs unprompted on a guarded-file change), plus named the deferred real-iPhone journey proof. (Min-3) Security AC box ticked. (Min-4) commit subject reworded verb-led. Re-verified: `:shared:jvmTest` incl. the new pin green; files restored clean.
- 2026-07-01 — **CREATED fully-refined** ([[feedback-no-skeleton-stories-fully-refined]]) under [[EPIC-0005-ban-enforcement-hardening]] from the bypass-surface map (vector 5: resettable device IDs). **Re-scoped during review:** the operator asked to key device bans off a unique identifier (serial/IMEI/SIM) to eliminate false positives — but those are **platform-blocked** for consumer apps (Android 10+ privileged permission; iOS never exposed; SIM swappable). Operator chose (AskUserQuestion) the platform-sanctioned + **free** primitives — **DeviceCheck (iOS)** (Apple-persisted per-device bit, survives reinstall, deterministic) + **Play Integrity (Android)** (attestation + server token) — replacing the original heuristic fingerprint-correlation (and its false-positive risk). **Phone-number verification** requested "if free"; it is **not** free (per-SMS cost) → flagged as a future paid enhancement, out of scope. `type: feature`, `mvp: true`. Non-technical BDD per [[feedback-non-technical-bdd]].

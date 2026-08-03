---
id: SHY-0146
status: Draft
owner: claude
created: 2026-07-01
priority: P1
effort: L
type: feature
roadmap_ids: []
epic: EPIC-0004
pr:
mvp: true
---

# SHY-0146: iOS in-app integrity detection (jailbreak / simulator / tamper) — Android parity

## User Story

**As** the team that already blocks modified Android devices in-app,
**I want** the same in-app integrity gate on iOS — jailbreak, simulator, and tamper detection — wired to the same pre-auth block screen,
**So that** "modified devices are blocked, always" holds **in-app on iOS too**, not only via App Store review, closing the platform-parity gap the anti-abuse audit found.

## Why

The anti-abuse map (2026-07-01) found iOS has **no in-app integrity detection**: `shared/src/iosMain/kotlin/com/shyden/shytalk/core/di/IosPlatformModule.kt:131` hard-codes `single(named("bypassDeviceChecks")) { true }`, so `AuthViewModel` receives `bypassDeviceChecks = true` and every root/emulator check is skipped on iOS. iOS relies **solely** on App Store review + platform sandboxing + DeviceCheck. Android, by contrast, runs a full `DeviceSecurityChecker` (su binaries, root-management apps, test-keys, writable `/system`; emulator fingerprint/model/hardware/product + qemu pipes) behind `UnsafeDeviceGate.isBlocked()` at `MainActivity:231` (pre-auth) → `UnsafeDeviceScreen`.

SHY-0143 deliberately **preserves** the Android gate on the optimistic path but leaves iOS platform-level and splits the in-app iOS work here (operator decision, 2026-07-01). This story implements iOS-side jailbreak/simulator/tamper detection and wires it to the **same pre-auth gate + shared `UnsafeDeviceScreen`**, so the block behaviour and screen are consistent cross-platform.

## Acceptance Criteria

### Happy path
- [ ] On a clean (non-jailbroken) **real iPhone**, prod build, the iOS integrity gate passes and startup proceeds normally — no `UnsafeDeviceScreen`, routing continues to SignIn/Main as usual.
- [ ] The iOS integrity check runs **pre-auth**, at the iOS startup equivalent of the Android `MainActivity:231` gate (before the route decision), replacing the hard-coded `bypassDeviceChecks = true` with a real iOS checker.
- [ ] A blocked iOS device shows the **shared `UnsafeDeviceScreen`** (the same composable Android uses) — consistent messaging cross-platform.

### Error paths
- [ ] On a **jailbroken** iPhone (one or more jailbreak indicators present) → `UnsafeDeviceScreen`, startup blocked (no routing to Main or SignIn).
- [ ] On the **iOS Simulator** with a prod build → blocked (parity with Android's emulator block).
- [ ] An integrity-attestation failure (App Attest / DeviceCheck, where wired) → blocked per policy.

### Edge cases
- [ ] **dev / local / *Debug** builds **bypass** the gate (parity with Android's `BYPASS_EMULATOR_GATE`/`bypassDeviceChecks`) so QA can run on the Simulator and dev devices — the bypass is build-flavour-gated, const-folded off in prod.
- [ ] A detection **primitive error** (e.g., a file-existence probe throws) is handled the same lenient way Android treats a check error (does not hard-fail a legitimate device on a transient probe error) — logged, not crashed.
- [ ] Detection must **not false-positive** on a normal App Store install (the indicator set is conservative — see Security) so legitimate users are never wrongly blocked.

### Performance
- [ ] The synchronous checks (suspicious-path existence, URL-scheme probes, sandbox-escape write test, simulator env check) are **fast local operations** with no network on the critical path; any App Attest/DeviceCheck attestation is async and done off the blocking path (or cached), so the gate does not add a network round-trip to cold-start.

### Security
- [ ] The jailbreak indicator set covers the standard vectors: suspicious file paths (`/Applications/Cydia.app`, `/Library/MobileSubstrate`, `/bin/bash`, `/usr/sbin/sshd`, `/etc/apt`), jailbreak URL schemes (`cydia://`, `sileo://`, `zbra://`), a **sandbox-escape write test** (attempt to write outside the app container), and a `fork()`/dyld-image check where feasible.
- [ ] **Simulator** detection via `targetEnvironment(simulator)` / `TARGET_OS_SIMULATOR`; prod builds enforce, dev builds bypass.
- [ ] Where feasible, **App Attest / DeviceCheck** provides server-verifiable integrity (defense-in-depth beyond client heuristics), so a tampered client can't simply patch out the local checks without also failing attestation.
- [ ] The gate is **enforced in prod** (bypass const-folded to `false`); the bypass path exists only for non-prod flavours.

### UX
- [ ] A blocked iOS device sees the **same `UnsafeDeviceScreen`** as Android (consistent wording + affordance); no iOS-specific bespoke screen.

### i18n
- N/A — reuses the existing localized `UnsafeDeviceScreen` strings; this story adds no new user-facing copy.

### Observability
- [ ] The iOS integrity outcome is logged (clean · jailbreak-indicator:<which> · simulator · attest-fail · probe-error) in local + dev builds per [[feedback-comprehensive-default-debug-logging]], so a block (or a false-negative) is diagnosable without a jailbroken device to hand.

## BDD Scenarios

**Scenario: a normal iPhone opens the app as usual**

- **Given** someone using an ordinary, untampered iPhone
- **When** they open the app
- **Then** the app opens normally, with no "unsafe device" warning

**Scenario: a jailbroken iPhone is blocked**

- **Given** someone using a jailbroken iPhone
- **When** they open the app
- **Then** they are shown the "unsafe device" screen and cannot use the app

**Scenario: the released app refuses to run on a fake or simulated iPhone**

- **Given** the released version of the app running on a simulated (not real) iPhone
- **When** it opens
- **Then** it shows the "unsafe device" screen

**Scenario: internal test builds still run on simulators for the team**

- **Given** an internal (non-released) test build
- **When** the team runs it on a simulator to test
- **Then** it opens and runs normally, so testing can go ahead

**Scenario: a hiccup in one safety check doesn't wrongly block a normal device**

- **Given** an ordinary device where one of the safety checks can't finish for a moment
- **When** the app checks whether the device is safe
- **Then** the person is not wrongly blocked

## Test Plan

iOS-only change (shared `iosMain` DI + a new iOS integrity checker; no Android/web/backend runtime change) → **NOT `*.md`-only → runs the iOS real-device leg** (real iPhone) + the shared host-unit tests. Per CLAUDE.md § No Stubs: detection reads **real** device state; host-unit tests feed **real** fixtures (paths present/absent) via an injected filesystem/URL-scheme probe boundary (a real-fixture data source, not a mocked collaborator — the same pattern as Android's `DeviceSecurityCheckerTest`).

**Red → Green (framework by framework):**
- **iOS unit (`iosApp/iosAppTests`, XCTest)** — the detection primitives against real fixtures/injected conditions:
  - jailbreak-path checker: returns true when a seeded indicator path exists (real temp path), false when absent.
  - URL-scheme checker: true when a jailbreak scheme is reported openable (injected `canOpenURL` responder), false otherwise.
  - sandbox-escape write test: true when a write outside the container succeeds (simulated via injected writer returning success), false when it throws (normal sandbox).
  - simulator detection: asserts `targetEnvironment(simulator)` branch.
  - the aggregate `isUnsafe()` composition (any indicator ⇒ blocked; probe-error ⇒ lenient).
- **Shared host-unit (`commonTest`)** — the DI wiring: prod flavour → real checker bound; dev/local → bypass bound (mirrors `UnsafeDeviceGateTest.kt` for Android).
- **iOS on-device (real iPhone)**: clean device → gate passes, app starts normally (positive path proven on real hardware). The **jailbroken-device negative** is **operator-gated/manual** (a jailbroken test device is required and can't be part of CI) — documented as a manual verification-ledger entry, not an automated cell.
- **Gate-ordering**: an XCTest asserting a forced-unsafe state routes to `UnsafeDeviceScreen` **before** the SignIn/Main route decision (parity with Android's pre-auth placement).
- **Static/quality:** Swift lint 0 warnings; `scripts/check-no-new-stubs.js` clean (iOS doubles only in `*Tests`).
- **Phase 1 LOCAL gauntlet:** real iPhone — clean device starts normally; dev-build Simulator bypass works (so the rest of the iOS journey suite still runs).
- **Phase 2:** `code-reviewer` 100% clean → In Review + `Reviewed-up-to:` → push → CI green by name.
- **Phase 3 (DEV):** re-verify on dev build; record the manual jailbroken-device check in the verification ledger.

## Out of Scope
- **Android** device-integrity checks — already implemented (`DeviceSecurityChecker`/`UnsafeDeviceGate`); this story is iOS parity only.
- The **cold-start session / cohort / ban** logic — that is SHY-0143 (which preserves the existing gates and explicitly defers in-app iOS integrity here).
- Server-side integrity enforcement beyond wiring **App Attest / DeviceCheck** attestation (a broader anti-abuse-backend effort, if pursued, is a separate story).
- Perfect/unbeatable jailbreak detection — this is **defense-in-depth** (standard indicators + attestation), not an absolute guarantee (jailbreak detection is inherently cat-and-mouse).

## Dependencies
- The shared `UnsafeDeviceScreen` composable (reused; no new screen).
- The iOS startup entry (`iosApp/iosApp/iOSApp.swift`) — where the pre-auth gate must run before the route decision.
- `shared/src/iosMain/kotlin/com/shyden/shytalk/core/di/IosPlatformModule.kt:131` — replace the hard-coded `bypassDeviceChecks = true` with a real iOS checker + a flavour-gated bypass.
- Apple **App Attest / DeviceCheck** APIs (for server-verifiable integrity, where wired).
- Parity reference: Android `DeviceSecurityChecker` + `UnsafeDeviceGate` semantics + `UnsafeDeviceGateTest`/`DeviceSecurityCheckerTest`.

## Risks & Mitigations
- **Risk:** false positives block legitimate users. **Mitigation:** conservative indicator set; lenient on single-probe errors; dev-flavour bypass for QA; real-device positive testing; observability logs the exact indicator so a false-positive is diagnosable.
- **Risk:** jailbreak detection is defeatable (cat-and-mouse). **Mitigation:** standard indicators **plus** App Attest/DeviceCheck for server-verifiable integrity; framed as defense-in-depth, not absolute — matches the Android bar, doesn't over-promise.
- **Risk:** simulator-block breaks the iOS QA journey suite. **Mitigation:** dev/local/Debug flavours bypass the gate (const-folded off in prod), exactly like Android — so Simulator-based journeys still run.
- **Risk:** the jailbroken-device negative can't be automated in CI. **Mitigation:** the detection primitives are unit-tested against real fixtures; the on-device jailbroken check is an explicit **operator-gated manual** ledger entry (honest coverage, not a faked automated pass).

## Definition of Done
- [ ] iOS integrity checker (jailbreak/simulator/tamper + optional App Attest/DeviceCheck) + pre-auth gate wiring in the iOS startup + `IosPlatformModule` binding (real checker in prod, bypass in dev) + shared `UnsafeDeviceScreen` reuse implemented.
- [ ] **Pre-Merge Testing Protocol satisfied:** XCTest RED→GREEN (detection primitives · aggregate · gate-ordering) + `commonTest` DI wiring + real-iPhone clean-device pass + dev-Simulator bypass → LOCAL iOS leg green → `code-reviewer` 100% clean → In Review + `Reviewed-up-to:` → push → CI green by name → DEV re-verify + **operator-gated manual jailbroken-device ledger entry** → **judgment-merge** (NO auto-merge; notify operator).
- [ ] `released_in: vX.Y.Z` set on the next release cut.

## Notes (running log)
- 2026-07-01 — **CREATED fully-refined** ([[feedback-no-skeleton-stories-fully-refined]]) under [[EPIC-0004-persistent-session-instant-coldstart]]. Split from SHY-0143 by operator decision (2026-07-01, AskUserQuestion "Add an iOS jailbreak/integrity-detection story") after the anti-abuse map found iOS runs with `bypassDeviceChecks = true` (no in-app integrity detection; platform-level only). Implements Android parity via the shared `UnsafeDeviceScreen` + pre-auth gate. **`mvp: true`** (operator decision 2026-07-01: launch-blocking — "modified devices blocked always" must hold in-app on both platforms day one, not relying on App Store review as iOS's only defense).

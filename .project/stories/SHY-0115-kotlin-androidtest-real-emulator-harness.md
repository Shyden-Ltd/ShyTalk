---
id: SHY-0115
status: Draft
owner: claude
created: 2026-06-17
priority: P1
effort: XL
type: infra
roadmap_ids: []
epic: EPIC-0003
pr:
mvp: false
---

# SHY-0115: Android instrumented-test real-emulator harness — replace the 22 `Fake*.kt` Koin bindings (EPIC-0003)

## User Story

**As** the team executing EPIC-0003,
**I want** a real-emulator-backed harness for Android instrumented tests that lets `androidTest` resolve the **real** repositories (Firebase/RTDB emulator + real LiveKit) instead of the 22 `Fake*.kt` Koin bindings + `ResetFakesRule`,
**So that** Android instrumented behaviour is proven against the same real backend the app ships to — the Android counterpart to the SHY-0109 express emulator keystone.

## Why

The largest single fake cluster on the Android side is the 22 `Fake*Repository.kt` bound into Koin for instrumented tests, reset between tests by `ResetFakesRule`. They make `androidTest` prove behaviour against an in-memory fiction. This SHY is the **Android keystone**: it builds the reusable real-emulator Koin module + per-test reset (real-state clean slate) that every subsequent androidTest-domain migration depends on — exactly as SHY-0109 unblocked the express drain. It does **not** migrate all 36 files; it delivers the harness + migrates one proof domain, establishing the pattern.

## Acceptance Criteria

### Happy path
- [ ] A real-emulator Koin test module exists that binds the **real** repository implementations pointed at the local emulator stack (Firestore/Auth/RTDB emulator hosts) + real LiveKit, usable from `androidTest`.
- [ ] A real per-test reset mechanism (replacing `ResetFakesRule`) clears the relevant real emulator state to a clean slate before each test (analogous to `clearCollectionGroup` on the express side).
- [ ] One proof domain (e.g. auth/user/identity) is migrated off its `Fake*Repository` bindings onto the real harness and passes on the real device/emulator — establishing the reusable pattern for the other domains.

### Error paths
- [ ] A real backend error (real PERMISSION_DENIED from real rules, real empty-state) is induced for at least one migrated test — not faked — and the instrumented assertion observes the real failure.
- [ ] Harness misconfiguration (emulator unreachable) fails fast with a clear message (the androidTest counterpart of `assertEmulatorReachable()`), not a silent pass.

### Edge cases
- [ ] Per-test isolation holds: real emulator state from one test does not leak into the next (the new reset proven by a leak-probe test, [[feedback-test-isolation-no-leaks]]).
- [ ] The harness works both on the real device gauntlet and any CI-available emulator path documented (driver behaviour stays gauntlet-only per the EPIC CI consequence).
- [ ] Surfaced bugs: non-blocking → `type: bug` SHY + `@known-failure-SHY-NNNN`; blocking → pivot-fix TDD-first.

### Performance
- [ ] Real-state reset + a migrated domain suite complete within a reasonable instrumented-test budget; no per-doc round-trip storm in reset.

### Security
- [ ] Emulator sandbox project only (`demo-shytalk`); no real credentials/secrets in instrumented config; no secrets logged.

### UX
- [ ] N/A — instrumented-test infrastructure; no user-facing surface.

### i18n
- [ ] N/A — harness only (locale-specific assertions live in the per-domain migrations).

### Observability
- [ ] The harness logs which emulator hosts it bound + the reset summary so failing instrumented runs are diagnosable.

## BDD Scenarios

**Scenario: an instrumented test resolves the real repository**
- **Given** the real-emulator Koin test module + a running local emulator stack
- **When** the migrated auth/user instrumented test runs
- **Then** it exercises the real repository against the emulator (no `Fake*Repository` bound) and asserts real state

**Scenario: real per-test reset gives a clean slate**
- **Given** test A seeds real emulator state
- **When** test B runs after the new reset rule
- **Then** test B sees a clean slate (no leaked state from A)

**Scenario: emulator unreachable fails fast**
- **Given** the emulator stack is down
- **When** an instrumented test using the harness runs
- **Then** it fails fast with a clear "emulator unreachable" message, not a false pass

## Test Plan

**RED:** the migrated proof-domain instrumented test, pointed at the real harness with no emulator running, fails fast (proves it needs real services); a leak-probe instrumented test fails until the real reset exists.

**GREEN:** build the real-emulator Koin module + real reset rule; migrate the proof domain off `Fake*Repository`; run on the real device/emulator green. Confirm the 22-Fake baseline can begin shrinking (the proof domain's fakes removed + baseline updated).

**Frameworks:** Android instrumented (`androidTest`) on the real device gauntlet + local emulator stack; Gradle build (`./gradlew --stop` before push); frontmatter validator. **Real backend:** Firebase/RTDB emulator + real LiveKit. **Gauntlet:** REQUIRED — operator-gated.

## Out of Scope
- Migrating the other androidTest domains (room/seat/voice · message/PM/typing · economy/gift · moderation/report · translation/appconfig/storage) — each its own follow-on SHY using this harness (≈6 domain SHYs, EPIC Phase 2).
- The 61 Kotlin **unit** `mockk`/`Mockito` files — those are unit-layer; doubles permitted there per the keystone policy unless they exercise a real collaborator (assessed per file).

## Dependencies
- **SHY-0112** (keystone) — unit↔integration boundary + ratchet (Kotlin categories) first.
- Local emulator stack incl. real LiveKit; real Android device.
- Koin test wiring + the existing `ResetFakesRule` (the thing being replaced).

## Risks & Mitigations
- **Risk:** instrumented tests can't reach the emulator from the device (network). **Mitigation:** the documented `adb reverse` tunnels (3000/7880/9000/9099/8080) from the local-stack bring-up; assert reachability up front.
- **Risk:** real reset is slow/flaky across domains. **Mitigation:** batched real deletes; prove isolation with a leak-probe before scaling to other domains.
- **Risk:** XL scope. **Mitigation:** harness + one proof domain only; other domains are separate 1-SHY-1-PR migrations.

## Definition of Done
- Real-emulator Koin harness + real per-test reset exist + are proven; one domain migrated off `Fake*Repository`; baseline shrinks accordingly.
- Surfaced bugs filed + `@known-failure`-tagged with intact assertions.
- Gauntlet green; Gradle build clean; `code-reviewer` zero findings; CI green by name.
- Judgment-merge. Story → In Review → Done on its release cut.

## Notes (running log)
- **2026-06-17 — created Draft (P1, the Android keystone).** Mirrors SHY-0109's role for express: build the real harness + one proof migration, then the per-domain androidTest migrations follow as 1-SHY-1-PR slices. XL → harness + one domain only.

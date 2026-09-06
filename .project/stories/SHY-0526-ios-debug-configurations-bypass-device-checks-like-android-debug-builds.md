---
id: SHY-0526
status: Draft
owner: claude
created: 2026-09-06
priority: P1
effort: S
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0526 — iOS Debug configurations bypass the auth-stage device checks like Android's debug build type

## User Story

As **the operator running persona journeys on a real iPhone against dev**, I
want the iOS Debug-Dev build to skip the one-account-per-device lock the same
way the Android devDebug build does, so that personas can rotate on one phone
and a dev proof never stops at "Account Restricted" on a device that a
debugger build has bound.

## Why

- Android's `buildTypes.debug` sets `BYPASS_DEVICE_CHECKS = true` for every
  `*-debug` build, overriding the `dev` flavour's `false`; the runner's
  `assembleDevDebug` APK therefore never calls `/api/devices/lock-check` and
  personas rotate freely (`app/build.gradle.kts` lines 94 and 199).
- iOS decides the bypass per variant only (`AppEnvironment.resolve`: local →
  true, dev → false, release → false), so the Debug-Dev build the journey
  runner installs enforces the lock. The SHY-0500 dev proof on 2026-09-06
  (run `dev-2026-09-06T02-54-12-660Z`) failed J02 and J08 at "Land on Home"
  with "This device is already linked to another account": the iPhone is
  bound to a non-persona account, so no persona can sign in on it.
- The Swift pin `test_dev_enforcesDeviceChecks` asserts "dev mirrors Android's
  BYPASS_DEVICE_CHECKS=false"; it read Android's flavour line and missed the
  build-type override, so the pin documents a parity that does not exist.
- Distributable builds are unaffected: TestFlight archives use the `Release`
  configuration, which defines no `DEBUG` compilation condition.

## Acceptance Criteria

### Happy path

- [ ] `AppEnvironment.resolve(variant:personasPassword:isDebugBuild:)` returns
      `bypassDeviceChecks == true` for `.dev` when `isDebugBuild` is true and
      `false` when it is false; `.local` is true either way; `.release`
      follows the same rule as `.dev` (Android's `prodDebug` also bypasses).
- [ ] `AppEnvironment.isDebugBuild` is `true` under the `DEBUG` compilation
      condition and `false` otherwise, and `iOSApp.swift` passes it into
      `resolve` unchanged, with no literal at the call site.
- [ ] A Debug-Dev build on a real iPhone bound to another account signs a
      persona in and reaches Home; the runner's dev J02 and J08 pass.

### Error paths

- [ ] A Release configuration (no `DEBUG`) keeps enforcing: `.dev` and
      `.release` resolve to `bypassDeviceChecks == false`, so TestFlight
      testers still meet the device lock and ban checks.
- [ ] A dropped `isDebugBuild` argument does not compile (no default value),
      so the decision can never fall back silently.

### Edge cases

- [ ] `Debug-Local` still bypasses (local variant, whatever the flag).
- [ ] `Debug` (prod backend, debugger build) bypasses, the same as Android's
      `prodDebug`; the tests document this on purpose.
- [ ] A `Release*` build configuration that lists `DEBUG` in
      `SWIFT_ACTIVE_COMPILATION_CONDITIONS` fails the source pin.

### Performance

- [ ] Unchanged: the flag is a compile-time constant; no extra work at boot.

### Security

- [ ] The bypass never reaches a distributable build: the pin scans
      `project.pbxproj` and fails if any `Release*` configuration defines
      `DEBUG`; `Release` is the only configuration `deploy-dev.yml` archives.
- [ ] The server stays authoritative: the bypass only skips the client call,
      as on Android; nothing in `express-api` changes.
- [ ] Kotlin's default stays `false` (enforce) if the argument is ever
      dropped from `doInitKoin`.

### UX

- [ ] Debugger builds on a phone that already carries a tester's account no
      longer show "Account Restricted" to the developer; distributable builds
      show it exactly as before.

### i18n

- [ ] Unchanged: no user-facing copy is added or altered.

### Observability

- [ ] The Debug-Dev boot log states whether device checks are bypassed, so a
      device log shows which rule applied.

## BDD Scenarios

**Scenario: A persona signs in on a bound iPhone from a debugger build**
- **Given** the iPhone is bound to another account on dev
- **When** the runner installs the Debug-Dev build and picks a persona
- **Then** the persona reaches Home without the "Account Restricted" screen

**Scenario: A TestFlight tester still meets the device lock**
- **Given** a Release build is installed on a phone bound to another account
- **When** the tester signs in with a second account
- **Then** the app shows "Account Restricted" and signs the account out

**Scenario: A release configuration can never carry the bypass**
- **Given** a Release build configuration lists the DEBUG condition
- **When** the pin tests run
- **Then** they fail and name the configuration

## Test Plan

- Unit (`iosApp/iosAppTests/AppEnvironmentTests.swift`): the resolve rule for
  every variant × `isDebugBuild`; `isDebugBuild` is true under the test
  build's DEBUG condition; every existing resolve test passes the flag
  explicitly.
- Source pin (`shared/src/jvmTest/.../IosDebugBuildBypassPinTest.kt`, host
  JVM): `isDebugBuild` is derived from `#if DEBUG`; `iOSApp.swift` passes
  `AppEnvironment.isDebugBuild` (no literal); `project.pbxproj` has an
  anchored block count, no `Release*` configuration with `DEBUG`, and a
  `Debug-Dev` with it.
- Device (pre-merge, real iPhone): the Swift unit tests run on the iPhone
  through `xcodebuild test -configuration Debug-Dev`.
- Device (post-merge, dev from `develop`): J-SMOKE, J02, J08 on the iPhone
  with the runner's Debug-Dev build; run dir linked in Notes.

## Out of Scope

- Releasing or reassigning the iPhone's existing `deviceBindings` document on
  dev (it belongs to a non-persona account; the operator decides).
- Teaching the journey runner to release persona bindings through the admin
  API.
- Changing Android's build-type override or the API's lock rule.

## Dependencies

- None. Touches `iosApp/iosApp/AppEnvironment.swift`,
  `iosApp/iosApp/iOSApp.swift`, `iosApp/iosAppTests/AppEnvironmentTests.swift`,
  one new jvmTest pin, and the doc comments in `BuildVariant.kt` and
  `KoinHelper.kt`.

## Risks & Mitigations

- **Risk:** a future configuration duplicated from Debug and named `Release-*`
  keeps `DEBUG` and ships the bypass. **Mitigation:** the pbxproj pin fails on
  any `Release*` configuration with `DEBUG`.
- **Risk:** the runtime flag cannot be unit-tested for the Release side.
  **Mitigation:** the resolve rule is tested for both values, and the pin
  proves the Release configurations lack the condition that makes it true.
- **Risk:** developers forget that debugger builds skip the lock.
  **Mitigation:** the boot log line and the doc comments say so on both
  platforms.

## Definition of Done

- [ ] Merged to `develop`, all checks green, deployed to dev.
- [ ] iPhone dev run from `develop`: J-SMOKE, J02, J08 pass; linked in Notes.
- [ ] No doc comment in the repo still claims iOS dev builds always enforce.

## Notes

- 2026-09-06 10:15 WIB — **Filed** from the SHY-0500 dev proof: iOS run
  `dev-2026-09-06T02-54-12-660Z` failed J02/J08 at "Land on Home" with
  "Account Restricted"; dev carries two bindings (owners 10000001 and
  50000010), neither a persona of that run; Android's devDebug bypassed the
  lock through `buildTypes.debug`.

---
id: SHY-0275
status: In Progress
owner: claude
created: 2026-08-04
priority: P1
effort: M
type: bug
roadmap_ids: []
pr:
mvp: false
---

# SHY-0275: The iOS local build points a real iPhone at itself

## User Story

As someone testing ShyTalk on a real iPhone against the local stack,
I want the app to actually reach the stack running on my Mac,
So that I can walk iOS journeys locally instead of only ever testing iOS against dev.

## Why

The iOS `Debug-Local` build cannot reach the local stack from a physical iPhone. Not voice —
**nothing**. Measured on device 2026-08-04 (iPhone Air, built with `LOCAL_HOST=192.168.1.9`
passed to `xcodebuild`), the device console reads:

```
[ShyTalk] DEBUG build — using Firebase Emulators (project=demo-shytalk, db=localhost:9000)
I/KoinHelper: Firebase emulators: Firestore=localhost:8080, Auth=localhost:9099, RTDB=localhost:9000
D/PreviewWatermark: server health unknown -> false
```

An iPhone has no `adb reverse` equivalent, so `localhost` **is the phone**. Every backend call
goes to a port on the handset itself. Sign-in cannot work, so the whole iOS-local leg of the
journey gauntlet is unrunnable — and has been reported as "iOS-local unsupported" rather than
as this bug.

There are three independent causes, and all three must go for iOS-local to work:

1. **`LOCAL_HOST` is dead configuration.** `iosApp/Configurations/Local.xcconfig` defines
   `LOCAL_HOST`, `LOCAL_API_BASE_URL`, `LOCAL_LIVEKIT_URL` and `LOCAL_FIREBASE_RTDB_URL`, and
   **nothing reads them** — a repo-wide search over `*.swift` / `*.plist` / `*.xcconfig` /
   `*.pbxproj` returns only their own definitions and their own comments. The real values are
   Swift literals: `AppEnvironment.swift` `localApiBaseUrl = "http://localhost:3000"`,
   `iOSApp.swift` `options.databaseURL = "http://localhost:9000?ns=demo-shytalk"`, and
   `KoinHelper.kt` `val host = "localhost"`. Passing `LOCAL_HOST=` to `xcodebuild` therefore
   sets a build setting that reaches no code — which is worse than having no knob at all,
   because the recipe *looks* followed.

2. **iOS has no local LiveKit URL at all.** `express-api/src/routes/livekit.js` deliberately
   omits `url` from the token response when `NODE_ENV === 'local'`, leaving the client to use
   its own. Android has one (`BuildConfig.LIVEKIT_SERVER_URL`); iOS has no equivalent, so
   `IosLiveKitVoiceService` takes `response.url ?: ""` and tries to connect to the empty
   string. Symmetry gap, not a design decision.

3. **The LiveKit URL allow-list cannot express "my Mac".** `LiveKitBridge.isAllowedURL()`
   permits cleartext `ws://` only for `localhost` / `127.0.0.1`; everything else must be
   `wss://` to the two Oracle hosts. A real iPhone must use the Mac's LAN address, so
   `ws://192.168.1.9:7880` is rejected before any network call.

Cause 3 is a **deliberate and correct** security boundary — cleartext signalling carries the
join token — so it is relaxed only for private-LAN addresses and only in `DEBUG` builds. The
shipped Release boundary is unchanged.

Discovered while device-proving SHY-0273. Distinct root cause: SHY-0273 was LiveKit
advertising an unreachable ICE candidate (server-side), and is Android-proven.

## Acceptance Criteria

### Happy path
- [x] A real iPhone on the same Wi-Fi as the Mac reaches the local API, Firestore, Auth and RTDB
- [x] A tester can sign in as a seeded persona on a real iPhone against the local stack
- [x] Voice connects in a room on a real iPhone against the local stack
- [x] Every emulator a device must reach listens on the LAN, not only on loopback

### Error paths
- [ ] When no local host is configured, the app falls back to `localhost` and says so in the
      startup log rather than failing silently
- [ ] An empty or blank LiveKit URL is still refused, as today

### Edge cases
- [ ] A build made with no `LOCAL_HOST` override behaves exactly as it does today
- [ ] `dev` and `release` builds are unaffected — they never read the local host

### Performance
- [ ] N/A — one string resolved once at app launch.

### Security
- [ ] Cleartext `ws://` to a private-LAN address is accepted ONLY in `DEBUG` builds; a Release
      build's allow-list is byte-for-byte unchanged in behaviour
- [ ] Only RFC1918 private ranges are accepted, decided by NUMERIC octet comparison, never by
      string prefix
- [ ] A public address over cleartext is still rejected, in every build

### UX
- [ ] The resolved host appears in the startup log so a wrong one is obvious immediately

### i18n
- [ ] N/A — developer tooling; no user-facing strings.

### Observability
- [ ] The startup log names the resolved host for API, emulators and LiveKit

## BDD Scenarios

**Scenario: A tester signs in on a real iPhone against the local stack**
- **Given** the local stack is running and the iPhone is on the same network
- **When** the tester signs in as a seeded persona
- **Then** they reach the app's main screen

**Scenario: Voice connects on a real iPhone**
- **Given** a tester is signed in on a real iPhone against the local stack
- **When** they join a voice room
- **Then** the audio connects

**Scenario: A misconfigured build says so instead of failing quietly**
- **Given** a build made without a local host configured
- **When** the app starts
- **Then** the startup log names the host it fell back to

**Scenario: A shipped build still refuses cleartext voice**
- **Given** a release build of the app
- **When** it is handed a cleartext voice address on a local network
- **Then** it refuses the connection

## Test Plan

**RED first.** `iosApp/iosAppTests/AppEnvironmentTests.swift` gains cases pinning that the
resolved API / RTDB / LiveKit URLs carry the configured host rather than a literal `localhost`,
including a stub `Bundle` so the READ-the-plist-key path is exercised and not only the fallback.
`iosApp/iosAppTests/AgeSegregationTests.swift` — the file that already owns the LiveKit
allow-list boundary — gains the matrix below. `shared/src/commonTest/.../BuildVariantTest.kt`
gains the `liveKitUrl` slot and `resolveVoiceServerUrl` cases. All fail against current code.

**Allow-list matrix** — the security-sensitive part, so it is enumerated rather than sampled:
accepted in DEBUG (`ws://10.0.0.5:7880`, `ws://172.16.0.1`, `ws://192.168.1.9`,
`ws://127.0.0.1`, `ws://localhost`); rejected in EVERY build (`ws://8.8.8.8`,
`ws://172.32.0.1` — just outside the 172.16/12 block and the case a string-prefix check gets
wrong, `ws://192.169.1.1`, `ws://evil.com`, `ws://10.0.0.5.evil.com`, empty, whitespace);
`wss://` to the two Oracle hosts accepted everywhere. The `172.32` and `10.0.0.5.evil.com`
cases exist specifically to kill a `hasPrefix` implementation.

**Structural pins** — `express-api/tests/scripts/ios-local-host-wiring.test.js`: `Info.plist`
carries the `$(LOCAL_HOST)` substitution; no Swift or Kotlin file on the iOS path reassigns a
literal `localhost` for API / emulator / LiveKit; the helper script detects the LAN address
rather than committing one (same detector SHY-0273 pins for `start.sh`).

**Device walk** — real iPhone over USB `devicectl`: install, launch, read the device console
for the resolved host, sign in as a persona, join a voice room, and confirm on the LiveKit
server side that `connectionType` is not `unknown` and a `mediaTrack` is published. That last
step is the one that distinguishes "ICE completed" from "audio flows"; SHY-0273 showed the
first can happen without the second being checked.

**Regression** — Android is untouched and must stay green: SHY-0273's 16 pins,
`tests/scripts/` in full, and a re-walk of the Android voice journey.

## Out of Scope

- `BUNDLE_ID_SUFFIX` not being wired to `PRODUCT_BUNDLE_IDENTIFIER`, so the local build
  installs as `com.shyden.shytalk` and overwrites the dev build. Real, separate, filed apart.
- Making dev/prod iOS read a local host — they never should.
- The three-RTC-sessions-per-join churn observed on Android in SHY-0273.

## Dependencies

- SHY-0273 (LiveKit advertises a reachable ICE candidate). Without it, fixing the URL only
  gets iOS as far as the same `connectionType: "unknown"` Android had. This story is branched
  on top of it.

## Risks & Mitigations

- **Risk:** relaxing the allow-list weakens a shipped build.
  **Mitigation:** the relaxation is inside `#if DEBUG`, so it is absent from the Release
  binary at compile time; a test asserts the public-address rejection holds unconditionally.
- **Risk:** an RFC1918 check written with string prefixes accepts `172.32.x` or
  `10.0.0.5.evil.com`.
  **Mitigation:** octets are parsed and compared numerically, and both cases are explicit
  rejection tests.
- **Risk:** the LAN address changes between builds, as it did three times during SHY-0273.
  **Mitigation:** the helper script detects it at build time; the app logs what it resolved.

## Definition of Done

- [x] RED tests written first and seen to fail (7 of 11 structural pins RED before the fix;
      3 emulator-binding pins RED before `firebase.json` changed)
- [x] iOS unit + structural pins green; Android regression suite unchanged
      (7462/7462 `tests/scripts`, `shared:jvmTest`, `compileKotlinIosArm64`)
- [x] **Sign-in verified on a real iPhone against the local stack** — persona P-02,
      watermark `UID: 50000010 · adult`, route `splash`
- [x] **Voice verified connecting on a real iPhone** — `sdk: SWIFT`,
      `deviceModel: iPhone18,4`, `connectionType: "udp"` in 335ms, ICE pair
      `192.168.1.9:52089` ↔ `192.168.1.3:50477`, and `mediaTrack published
      source: MICROPHONE mime: audio/red`
- [x] Release-build allow-list behaviour proven unchanged — the relaxation is inside
      `#if DEBUG`; the public-address rejections are asserted unconditionally
- [x] `code-reviewer` findings applied (7, all mutation-verified)
- [ ] Journey gauntlet green on both devices (local, then dev)
- [ ] Merged to develop; `released_in:` at the next release cut

## Notes (running log)

- **2026-08-04 17:1x WIB** — Found while device-proving SHY-0273: with Android green, the
  iPhone was built and installed the same way and its console showed every backend pointing at
  `localhost`. The `LOCAL_HOST` build setting had been passed exactly as the working recipe
  documents, which is why this survived — the recipe looked followed. Operator asked for
  everything fixed before the gauntlet runs, so this is being fixed rather than filed.
- **2026-08-04 18:5x WIB** — A FOURTH cause, found only by walking it: with the host routing
  fixed, sign-in still failed with `FIRAuthErrorDomain 17020` /
  `NSURLErrorDomain -1004 "Could not connect to the server"` against
  `http://192.168.1.9:9099/…/verifyPassword` (ECONNREFUSED 61). All three Firebase emulators
  bound to `127.0.0.1` while Express (`*:3000`) and the web serve (`*:8888`) bind to all
  interfaces — precisely why the health check passed while Auth was refused: the stack
  *looked* reachable when it was only half reachable. `firebase.json` now binds
  auth/firestore/database to `0.0.0.0`; the UI stays on loopback deliberately.
- **2026-08-04 19:0x WIB** — DONE on device. Sign-in as P-02 (UID 50000010), then joined the
  room the ANDROID phone had created (cross-device state sync working) and unmuted. LiveKit:
  `sdk: SWIFT`, `deviceModel: iPhone18,4`, `connectionType: "udp"`, 335ms,
  `mediaTrack published source: MICROPHONE`. iOS-local was never "unsupported" — it was four
  bugs, three of which only a device walk could reveal.
- **2026-08-04 19:0x WIB** — `code-reviewer`: 7 findings, all applied and mutation-verified;
  the `isPrivateLAN` security boundary came back clean against every bypass class probed
  (172.32, hostname-lookalikes, leading zeros, signs, unicode digits, IPv6, trailing dots,
  and `ws://192.168.1.9@evil.com`). Two were Critical and correct: `liveKitUrl` had zero
  tests, and the fallback chain was pinned only by a substring — so swapping the operands
  would have stayed green while breaking dev and prod voice. Fixed by extracting
  `resolveVoiceServerUrl` into commonMain, where it is testable at all. The no-stubs ratchet
  then caught a stand-in `Bundle` added for a test; rather than whitelist it, resolution now
  takes the raw plist value and is tested with real strings.
  `Reviewed-up-to: ea75d9d6175`

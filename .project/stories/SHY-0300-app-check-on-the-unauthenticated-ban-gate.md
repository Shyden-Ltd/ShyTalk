---
id: SHY-0300
status: Done
owner: claude
created: 2026-08-16
priority: P0
effort: L
type: feature
roadmap_ids: []
epic: EPIC-0005
mvp: true
released_in: v0.99.0
---

# SHY-0300: Attest the unauthenticated ban gate with App Check

## User Story

As a **safety operator**, I want `GET /api/ban-status` to require a Firebase
App Check attestation, so that **only a genuine ShyTalk install can query it**
and an automated caller cannot exhaust the shared geolocation quota that
ASN-scoped bans depend on.

## Why

SHY-0143 added `GET /api/ban-status` — unauthenticated by necessity, because a
banned user must learn they are banned *before* routing, and at that moment
there may be no Firebase session. Its only protection today is per-IP rate
limiting.

**Operator decision, 2026-08-16:** App Check must be in place before this
reaches production. Merging to develop is not shipping; the develop→main
promotion is the gate this blocks.

The concrete abuse this closes was found by review on SHY-0143. The endpoint
resolves the caller's ASN through ip-api, whose free tier is ~45 requests per
minute **per calling IP** — and the API server has one egress IP shared by
every user. A caller that can hit the endpoint freely can starve that budget,
and while it is starved `networkBanMatches` refuses every ASN-scoped ban for
*everyone*. SHY-0143 bounded that with negative caching and a 429 pause;
attestation removes the cheap way to reach it at all.

Attestation is also the only remaining control that distinguishes "our app
asking whether this device is banned" from "anyone asking about any device
id".

## Acceptance Criteria

### Happy path

- [ ] A request from a genuine app install carries an App Check token and is
      served exactly as today.
- [ ] Android obtains tokens via **Play Integrity**; iOS via **App Attest**
      (DeviceCheck fallback below iOS 14); both are wired at app start, before
      the cold-start ban check runs.
- [ ] The token is attached by the shared API client, so a future
      unauthenticated endpoint inherits it without a per-call change.

### Error paths

- [ ] A **missing or invalid** App Check token is refused with `401` and a
      distinct error code (`app-check-required`), never conflated with an
      auth-token failure.
- [ ] Attestation failing on the CLIENT (Play Integrity unavailable, App
      Attest unsupported, device offline) does not block the cold start: the
      client proceeds without a token, the server refuses, and the client
      treats that exactly as today's ban-check failure — **fail-open, logged**.
      Locking a legitimate user out of their own app because Google's
      attestation service is down is worse than the abuse this prevents.
- [ ] The server's App Check verification failing for an infrastructure reason
      (SDK error, not a bad token) is logged at error and treated as a pass —
      a broken verifier must not become an outage.

### Edge cases

- [ ] **Rollout order is enforced:** the server runs in `monitor` mode first,
      logging attested-vs-not without refusing, so a client that has not
      updated is not locked out. Enforcement flips only after the dashboard
      shows the attested share above the agreed threshold.
- [ ] Local and dev builds use the **App Check debug provider** with a
      registered debug token; the emulator stack does not require attestation.
- [ ] The web client (`public/**`) does NOT call this endpoint today. If that
      changes it needs the reCAPTCHA provider, which is a separate decision.
- [ ] A replayed token is rejected — App Check tokens are short-lived and
      single-project; the server verifies audience and expiry.

### Performance

- [ ] Token acquisition is **not** on the cold-start critical path: the client
      requests a token at startup and attaches whatever it has, rather than
      awaiting attestation before the ban check.
- [ ] Verification adds no Firestore reads; `admin.appCheck().verifyToken()`
      is local signature verification against cached public keys.

### Security

- [ ] With enforcement on, a request with no valid attestation cannot reach
      `checkBans`, and therefore cannot reach `getIpGeo`.
- [ ] The refusal happens **before** the rate limiter's bucket is spent, so an
      unattested flood cannot exhaust a legitimate IP's allowance.
- [ ] No App Check secret ships in the client; the debug token is local-only
      and never committed (`~/.shytalk/`, per the existing convention).

### UX

- [ ] No user-visible change on the happy path. On attestation failure the
      user sees exactly what they see today when the ban check cannot run —
      the app continues to its normal destination.

### i18n

- [ ] N/A — no new user-facing strings. The failure path is silent by design.

### Observability

- [ ] Every request logs `appCheck: verified | missing | invalid | error`, so
      the monitor-mode rollout can be read from logs as well as the console.
- [ ] A counter of refusals is exposed on the existing health/system endpoint,
      so a botched enforcement flip is visible without log diving.

## BDD Scenarios

**Scenario: a genuine install is served**
- **Given** the app has a valid App Check token
- **When** it asks whether the device is banned
- **Then** it receives the ban status as before

**Scenario: an unattested caller is refused**
- **Given** enforcement is on
- **When** a request arrives with no App Check token
- **Then** it is refused with `401` and the code `app-check-required`
- **And** the ban engine is never consulted

**Scenario: attestation being unavailable does not lock the user out**
- **Given** the device cannot obtain an App Check token
- **When** the app cold-starts
- **Then** the ban check fails open exactly as it does when the ban service is
  unreachable, and the user reaches their normal destination

**Scenario: monitor mode refuses nobody**
- **Given** the server is in monitor mode
- **When** a request arrives with no App Check token
- **Then** it is served, and the outcome is logged as `missing`

## Test Plan

**RED first.**

- `express-api/tests/middleware/app-check.unit.test.js` — the verifier as a
  pure predicate: valid token → pass; malformed → `invalid`; absent →
  `missing`; SDK throwing → `error` and treated as a pass; monitor mode never
  refuses; enforcement mode refuses `missing` and `invalid` only.
- `express-api/tests/middleware/auth-skip-composition.test.js` — extend the
  existing composed-gate suite: with enforcement on, `GET /api/ban-status`
  with no App Check header is `401` and `checkBans` is never called (spy);
  with a valid token it is `200`.
- `express-api/tests/routes/ban-status.test.js` — real emulator, monitor mode:
  behaviour unchanged from today, proving the rollout step is safe.
- **Ordering:** a test that the App Check refusal precedes the rate limiter,
  by asserting `RateLimit-Remaining` is unchanged across refused requests.
- Kotlin: `shared/src/jvmTest/.../AppCheckWiringPinTest.kt` — both platforms
  install a provider at startup and the shared API client attaches the header;
  pinned per-platform, because every earlier single-platform pin on this epic
  turned out to be green against the wrong file.
- Android instrumented + iOS XCTest: a real token is obtained on a real
  device, and the cold-start ban check succeeds. **This is the acceptance
  test** — attestation cannot be proven on an emulator.

**Classification:** backend + both clients ⇒ the FULL device and browser
gauntlet.

## Out of Scope

- The other thirteen unauthenticated paths in `auth-skip.js` (`/health`,
  `/auth/*`, the `/suggestions` family, `/translate`,
  `/apple-notifications/v2`, `/portal/totp-recovery/*`, the data-export
  download). The framework this story builds makes each a one-line addition,
  but each has its own caller set and its own rollout risk — notably
  `/apple-notifications/v2`, which Apple calls and which can never carry an
  App Check token.
- The web client. `public/**` does not call `/api/ban-status`, and the
  reCAPTCHA provider is a different trade-off.
- Replacing per-IP rate limiting. App Check complements it; the limiter still
  bounds an attested client.

## Dependencies

- `firebase-admin` ≥ 13 is already a dependency and provides
  `admin.appCheck().verifyToken()` — no new server package.
- Android: `firebase-appcheck-playintegrity`. iOS: `FirebaseAppCheck` via the
  existing CocoaPods workspace.
- Play Integrity and App Attest must be enabled in the Firebase console for
  both projects (`shytalk-dev`, `shytalk-7ba69`) — operator action.
- `express-api/src/middleware/auth-skip.js` — the skip list App Check sits
  behind; App Check runs INSTEAD of auth for these paths, not as well as.

## Risks & Mitigations

- **Risk:** enforcement locks out users on older app versions. **Mitigation:**
  monitor mode first, and the enforcement flip is a config change, not a
  deploy — reversible in seconds.
- **Risk:** Play Integrity has a daily quota on the free tier and can throttle.
  **Mitigation:** the client fails open, and the server treats an
  infrastructure error as a pass; only a *well-formed but invalid* token is
  refused.
- **Risk:** fail-open on the client means the abuse path still exists for
  anyone willing to forge the failure. **Mitigation:** accepted, and it is the
  right trade — the endpoint is read-only, the ban decision is not weakened
  (a real ban still returns a ban to an attested caller), and the quota
  starvation it protects is separately bounded by SHY-0143's negative cache
  and 429 pause. Attestation raises the cost; it is not the only control.
- **Risk:** a single-platform wiring pin passes against the wrong file — this
  happened three times on SHY-0143. **Mitigation:** every pin reads both
  platform files, asserted in the same test.

## Definition of Done

- [ ] Server middleware + monitor mode + enforcement flag, with the tests
      above RED first.
- [ ] Both clients obtain and attach tokens; wiring pinned per-platform.
- [ ] Deployed to dev in **monitor** mode; the attested share observed on real
      devices before any enforcement flip.
- [ ] Enforcement enabled in dev, real-device cold start still works on both
      platforms.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded.
- [ ] Full gauntlet, LOCAL then DEV.
- [ ] Merged to develop → deploy develop to dev.
- [ ] **Blocks the develop→main promotion until enforcement is on in prod.**

## Notes (running log)

- **2026-08-16 — filed** on the operator's decision that App Check must be in
  place before SHY-0143 reaches production. They chose this over "file a
  follow-up before go-live", so it is the next work item rather than a
  deferred ticket. Scoped to `/api/ban-status` because that is the endpoint
  the decision was about; the framework makes the other thirteen
  unauthenticated paths a one-line addition each, deliberately left out of
  scope so their rollout risks are considered individually.
- **2026-08-16 — built, both halves.** Server: `app-check.js` classifies into
  `verified | missing | invalid | error`, `missing`/`invalid` are refusable and
  `error` never is, `BAD_TOKEN_CODES` is an ALLOW-list so an unknown SDK
  failure degrades toward availability. Modes `off/monitor/enforce`, default
  monitor, a misspelled mode warns rather than silently doing nothing. Wired
  into the `/api` gate AHEAD of `generalLimiter`. Counters on an
  AUTHENTICATED `GET /api/system/app-check` — NOT `/system/health`, which is
  public, and publishing `mode` there would tell an abuser exactly when
  attestation is off.

  Client: `AppCheckTokenProvider` expect/actual (Play Integrity on Android, a
  Swift `AppCheckBridge` on iOS with App Attest → DeviceCheck fallback, null on
  JVM), attached in BOTH platforms' `getPublic` so a future unauthenticated
  endpoint inherits it. Both request a CACHED token; forcing a refresh would
  put an attestation round trip in front of the cold-start ban check. Every
  failure is a null and the request goes out unattested — the server decides,
  and it can be reconfigured without shipping a release.

  The debug provider is confined to debug builds on both platforms:
  `debugImplementation` plus reflective lookup on Android, `#if DEBUG` on iOS.
  It mints a token for anyone holding the debug secret, so on a release
  classpath it would defeat the control completely.

  **Nine mutants verified.** Three of them exposed defects in the PIN rather
  than the code, all the same family — the pin was matching text that is not
  code: an `import` line, and twice its own KDoc quoting the call it was
  checking. Deleting the entire header attach from `IosApiClient` left the pin
  GREEN. Fixed by filtering comments AND imports and asserting a syntactic
  form (`header(APP_CHECK_HEADER`) rather than an identifier;
  [[feedback-comments-are-not-code-references]] extended with both cases.

  **Not done, and it is the acceptance test:** a real token obtained on a real
  device. Attestation cannot be proven on an emulator or a simulator, so
  Android instrumented + iOS XCTest on real hardware is what closes this, in
  the batch gauntlet before the release cut. iOS also needs `pod install` for
  the new `FirebaseAppCheck` pod. The Swift lives in `AppDelegate.swift`
  deliberately — a new Swift file would need a `project.pbxproj` change, which
  is operator-authorised territory, and AppDelegate is where Firebase is
  already configured and the push bridge already registered.

  **Operator action still outstanding:** Play Integrity and App Attest must be
  enabled in the Firebase console for `shytalk-dev` and `shytalk-7ba69`, and a
  debug token registered for local builds. Until then the client obtains no
  token and the server, in monitor mode, records `missing` — which is the
  designed-for state, not a failure.

Reviewed-up-to: 91cb2b56de0f5b8ca23566529e452cf0400c2e4d

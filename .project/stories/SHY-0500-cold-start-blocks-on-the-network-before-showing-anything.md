---
id: SHY-0500
status: In Review
owner: claude
created: 2026-09-01
priority: P1
effort: L
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0004
---

# SHY-0500: Opening the app waits on the network before it shows anything

## User Story

As **somebody who is already signed in**, I want the app to open on the room
list immediately, so that launching it feels like opening an app I use rather
than logging into a service.

## Why

EPIC-0004's vision is *"a returning user never sees a login screen or a loading
screen again"*. SHY-0143 was supposed to deliver it and is marked **Done**. It
does not, and the operator reported the symptom directly on 2026-09-01: the app
shows the sign-in screen first and then moves on.

Read the launch path and it is plain:

- `MainActivity` holds **every** render behind `!checkComplete`, so nothing at
  all is on screen until the pre-routing phase finishes.
- `ColdStartSequencer.run()` awaits `checkBans()` — a network call — and then
  `refreshToken()`, another one, **before it returns a destination**.
- `initialRoute` stays null until that completes, and the NavHost does not mount
  before it.

So every cold start pays two network round trips before the first pixel of the
app, on a connection we do not control. That is not an optimistic cold start; it
is a blocking one with a spinner in front of it. And when the network is slow
the user watches, which is precisely what the epic exists to remove.

The "no session at all" case is worse, because it needs **no network to answer**.
Whether a session exists is a local question — Firebase either holds a user or
it does not — and it is currently answered after the same two round trips.

**Operator's specification, 2026-09-01, verbatim in intent:**

> if session exists — open the app on the room list screen — confirm session is
> valid — if not valid, throw them back to the sign-in page and tell the user
> that they need to sign in again. However if there's no session at all we should
> be able to check that instantly and not show anything.

## Acceptance Criteria

### Happy path

- [ ] With a valid session, the room list is the first thing drawn. No spinner,
      no sign-in screen, no splash — and no network call is waited on first.
- [ ] With no session at all, the sign-in screen is the first thing drawn, and
      nothing else is shown before it. That decision is made locally.
- [ ] Private data appears in the room list as it arrives, without the shell
      having waited for it.

### Error paths

- [ ] A session that turns out to be INVALID returns the person to sign-in **and
      tells them they need to sign in again**. They are not dropped there with no
      explanation.
- [ ] That message names the reason in ordinary words and is not a technical
      error string.
- [ ] A session that cannot be confirmed because the device is OFFLINE keeps the
      person where they are. A transport failure must never read as "signed out".

### Edge cases

- [ ] A device or network ban still ends on the ban screen, and the person never
      sees any of their own data on the way there.
- [ ] App-Lock still comes before the room list when it is required.
- [ ] Killing the app while the background confirmation is in flight and
      reopening it behaves the same as any other launch.
- [ ] A session invalidated while the app was backgrounded is caught on return.

### Performance

- [ ] Time from launch to first drawn screen does not depend on network latency.
      Measured, on a real device, against a throttled connection.

### Security

- [ ] No cohort-scoped read is issued before a freshly refreshed token confirms
      the cohort claim. This is the SHY-0132/0137 boundary and it does not move.
- [ ] The optimistic path is not a way around the device/network ban gate.

### UX

- [ ] No flash: the first screen drawn is the final screen for that launch,
      except where a background check legitimately changes it (ban, invalid
      session, App-Lock, a mandatory update — each a server verdict the
      shell cannot know locally).

### i18n

- [ ] The "sign in again" message is translated in every supported locale.

### Observability

- [ ] Which launch path was taken, and why, is visible in a device log without
      attaching a debugger.

## BDD Scenarios

**Scenario: A returning person lands in the app**

- **Given** somebody who was signed in last time
- **When** they open the app
- **Then** the room list is the first thing they see

**Scenario: A session that is no longer good sends them back with a reason**

- **Given** somebody whose session is no longer valid
- **When** they open the app
- **Then** they are returned to the sign-in screen
- **And** they are told they need to sign in again

**Scenario: Nobody signed in goes straight to sign-in**

- **Given** a device with no session at all
- **When** the app is opened
- **Then** the sign-in screen is the first thing drawn

## Test Plan

- Unit: the launch decision, including no-session, valid-session,
  invalid-session and offline, asserted as a SEQUENCE — what is drawn first, and
  what changes it afterwards.
- Unit: no cohort-scoped read is issued before the claim is confirmed, asserted
  by ordering rather than by reading the code.
- Device: real launches on both phones — signed in, signed out, session revoked
  server-side, and offline — watching what is drawn FIRST in each.

## Out of Scope

- Retiring the remaining splash surfaces. SHY-0144 did that.
- The web surfaces. SHY-0148 covered them.
- Changing what the room list itself renders.

## Dependencies

- SHY-0143 (built the sequencer this changes).
- SHY-0497 (sign-out must complete before navigating; without it the bounce-back
  to sign-in races the sign-out).

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Rendering the shell before the ban verdict lets a banned user glimpse it | The shell carries no data before the cohort claim is confirmed, so there is nothing of theirs to see. Flagged for the operator as the one deliberate trade-off. |
| "Optimistic" becomes "unauthenticated" | The cohort gate does not move. Only the SHELL is optimistic; every read still waits. |
| An invalid session bounces in a loop | The bounce signs out first and carries a reason, so the sign-in screen is a destination rather than a retry. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Device-proven on both phones: signed in, signed out, and revoked.

## Notes

- Filed 2026-09-01 from the operator's direct report. SHY-0143 is Done and
  claimed this; the launch path shows it is not delivered, which is why this is
  filed as a defect against the epic rather than as new scope.
- 2026-09-01 — **Android delivered.** `immediateDestination()` does no I/O and is drawn at once; `confirm()` runs behind it and returns Stay or Redirect. The gate ORDER is unchanged — bans resolve before the session is touched, and the cohort claim is refreshed before any cohort-scoped read, so the SHY-0132/0137 boundary does not move. What changed is when the person sees something, not what is enforced.
- 2026-09-01 — **Operator decision on the one trade-off:** the room-list shell is drawn before the ban verdict returns. It carries none of the person's data because `cohortVerified` still gates every read, so a banned device sees an empty shell for the length of one ban round trip and is then ejected. Chosen over blocking, 2026-09-01, against EPIC-0004's original "no room-list shell flashes first" wording.
- 2026-09-01 — **A dead session now says so.** `SESSION_EXPIRED` reaches the sign-in screen as *"Your session has ended. Please sign in again."* rather than depositing somebody there with no explanation. An OFFLINE device is untouched — a transport failure is not a sign-out.
- 2026-09-01 — Two source pins caught real things while this was written: a second `startCohortScopedReads` call site, and the sequencer no longer consuming the shared resolver. Both fixed properly rather than by relaxing the pin — `run()` now delegates to the new pair, and bans are mapped by `resolveColdStartDestination` so "a ban beats every other input" still has one definition.
- 2026-09-01 — **OWED: iOS.** `MainViewController` still calls `run()`, which delegates to the same pair and is therefore correct, but does not get the instant draw. Device proof is owed on both phones.
- 2026-09-01 — Gate: `:app:testDevDebugUnitTest` 2271/0, `:shared:jvmTest` 1756/0, `compileKotlinIosArm64` green, `detekt` + `ktlintCheck` clean. 12 new tests assert both halves — that the immediate decision touches nothing, and that the confirmation still enforces every gate.

- 2026-09-04 — **Device proof, Android: 6/6 journeys green on the OnePlus (CPH2653, Android 16), run `local-2026-09-03T19-05-01-168Z`.** J40 is the story's device proof: four cold launches, watching what is drawn first and reading the app's own log for why — signed in (room list first, 2.4s after launch, confirmed behind it), invalidated on the server (room list first, then sign-in with "Your session has ended. Please sign in again." on screen), offline (room list first and still there 8s later, unverified), signed out (sign-in first, nothing before it). The core set ran first, as it must.
- 2026-09-04 — **The device proof found the headline defect still present.** Every cold start after a persona sign-in logged `immediate: destination=SignIn` for a signed-in, identity-cached person, then reached Home through the network — the launch this story exists to remove. The cascade's FIRST step read "no App-Lock credential" as "no session", and the credential is enrolled only from the Lock screen's reset path, so none enrolled is every signed-in person's normal state. Moved to the END of the cascade (`LaunchDestination.kt`): an enrolled credential still locks first, a live resolved session draws Main, a credential with a dead session locks, and only then sign-in. The story's own fixture defaulted `hasStoredCredential = true`, which is how 12 green unit tests coexisted with a phone that flashed sign-in.
- 2026-09-04 — **iPhone: the observability criterion was not met.** The iOS logger wrote to stdout, which no device log carries (35,833 syslog lines across a launch, none from the app); NSLog reaches the log but redacts every message as `<private>` (3,688 lines, all redacted). Fixed as a Kotlin `IosLogSink` that `iOSApp.swift` points at `os_log("%{public}@")` before anything else runs, pinned on both files. `idevicesyslog` now shows `D/ColdStartSequencer: immediate: destination=…` with nothing attached.
- 2026-09-04 — **Local only, deliberately.** The Auth emulator ignores `revokeRefreshTokens` for the refresh exchange (the old refresh token still minted a fresh ID token), so the invalid session is a disabled account, restored in `finally`. The journey declares `requiresLocalState` and is skipped loudly on dev, the SHY-0488 shape.
- 2026-09-04 — Four infrastructure defects fixed on the way, each pinned: the LiveKit address chooser aborted on bash 3.2 (`serial[@]: unbound variable`) and advertised loopback to a phone that could reach the Mac; `local/stop.sh` never matched the API it started, so the API outlived every stop; the shared Appium started without `ANDROID_HOME`, so every Android session was refused and the screen was read at 2.3s a frame; and the offline cut must leave mobile data alone (the OnePlus answers `svc data enable` with a system dialog over the app).
- 2026-09-04 — **iPhone run, first pass: 3/6, and it found three more things, each fixed and pinned.** (1) The launch decision ran before the iOS SDK had restored the persisted user — it loads from the keychain asynchronously where Android is synchronous — so `currentUser` read as nobody, the identity cache missed, and the phone drew sign-in first for a signed-in person; `awaitPersistedSession()` now waits, bounded, for the SDK's first auth-state report before the decision (a keychain read, never the network). (2) The iOS keyboard was never dismissed: the driver posted WebDriverAgent's `/wda/keyboard/dismiss`, which Appium never routes for a client, and swallowed the 404 as best effort; iOS 27.0's taller keyboard put J07's send button under it. It now uses `mobile: hideKeyboard`. (3) The smoke journey does no reinstall on iOS, so its launch was its only action and SHY-0457's guard failed it as "never touched the device"; it launches through `openApp` like J40. The rebuilt app is installed on the phone.
- 2026-09-04 06:27 — **OWED: iPhone device proof (deferred by the operator — no devices available).** The rerun needs the phone on USB (its link dropped twice after the iOS 27.0 update) and the per-boot UI-automation consent approved on-device. Until it runs green, the Definition of Done's second line is open and the story does not merge.
- 2026-09-04 — **Review against develop: ten rounds, every real finding fixed with a failing test first.** (1) `ColdStartClaimGate`: the shell now mounts before `confirm()` returns, so "claim refreshed before any cohort-scoped read" stopped being structural; the sequencer engages one Koin-provided gate when it draws the room list and `HomeViewModel.observeRooms()` waits on it before `getActiveRooms(cohort)`. Open at rest, so a fresh sign-in never waits. (2) The session-expired reason is consumed once — `SignInScreen` reports the snackbar shown (also when cancelled mid-show) and each host clears `launchRedirect` — so a deliberate sign-out no longer shows "Your session has ended" again. (3) Both hosts NAVIGATE on every redirect with `popUpTo(0)`; iOS used to rewrite a mounted NavHost's start destination, which moves nothing. (4) `confirm()` before `immediateDestination()` is a programming error and fails with `checkNotNull`. (5) The iPhone driver's `readAppLog()` no longer tears down the capture it reads (J40 reads the same launch twice), a capture that errors or dies makes the next read throw naming `idevicesyslog` and its stderr, and `quit()` stops whatever is still streaming. (6) `awaitPersistedSession()` has no silent `{}` default on the interface — Android states its synchronous no-op, iOS keeps its bounded wait, and its timeout log no longer fires on every signed-out start. (7) `MainActivity` starts the version and health checks as deferreds BEFORE the draw and applies the verdict — redirect and ban facts — as the first thing after `confirm()`, so nothing is awaited between `begin()` and `settle()` and a banned device is not left on the optimistic room list. (8) **Only a Stay releases the gate.** A ban verdict must never let the room list drawn underneath read on the claim the confirmation did not refresh — before this story a banned cold start never mounted it — and a dead-session verdict must not let it fire against a session `confirm()` has just signed out. So every Redirect leaves the gate to the host: both hosts navigate with `popUpTo(0)`, which pops that room list and its ViewModel, and settle the gate only afterwards. A transport failure is a Stay and releases: the claim cannot be refreshed offline and the cached room list is all there is, as it always was. (9) **A throw inside `confirm()` keeps it engaged too**: there is no verdict to release reads on; the exception reaches the host (where, as before this story, it ends the launch effect) and the next draw supersedes the gate (`immediateDestination()` resets it to whatever it draws now, so a cancelled launch cannot hold a later one). (10) J40's account-disabling lever refuses any project id that is not a `demo-` project and uses its own named admin app pointed at the Auth emulator, so it can never inherit an app initialised for a real project; `initDb()` looks for the `[DEFAULT]` app by name for the same reason. (11) The sequencer's dead `run()` is gone. (12) `local/stop.sh`'s port sweep stops only the stack's own node, java and firebase listeners and names anything it leaves alone, instead of SIGTERMing whatever holds one of the stack's ports (Docker's port proxy for LiveKit, an unrelated dev server on 8080).
- 2026-09-04 — **Two later objections answered by the record above rather than by code:** a round asked for a `try/finally` so a throw inside `confirm()` releases the gate ("Home renders permanently empty") — the opposite of the round that made it fail closed; the decision stands, because on both hosts a throw there ends the launch effect exactly as it did before this story, so a held gate never faces a reader, and a relaunch supersedes it. And a round read the transport-failure Stay as removing SHY-0143's ordering guard — but `startCohortScopedReads` was a no-op on both hosts, the NavHost mounted and the room list read from cache offline before this story too; the guard applies when a refresh is possible, and offline it is not. A follow-up worth filing: confirm the claim when the network returns after an offline cold start, instead of waiting for the SDK's hourly refresh. The throw objection came back a third time ("a permanently empty room list with no recovery short of a restart"): on both hosts the sequence runs inside `LaunchedEffect` / `produceState`, so a throw there ends the launch as it did before this story; the held gate never meets a reader, and a restart IS the recovery — that is what a crashed launch has always meant.
- 2026-09-04 — **A mandatory update is drawn AFTER the shell, and the UX criterion now says so.** `checkComplete` is set on the immediate draw and the version verdict lands behind it, so a launch that needs a forced update draws the room list and then the update screen. Waiting for the version check first would put a network round trip back in front of the first frame — the thing this story removes — and a mandatory update is a server verdict of the same shape as a ban. The "no flash" criterion's exception list names it. Follow-up worth filing: cache the last minimum-version verdict locally so that decision, too, can be drawn first.
- 2026-09-04 — **Four findings verified NOT to be defects, recorded so they are not re-raised:** the launch cascade drawing Main for "App-Lock enabled, lock required, no credential" is the everyday state of every signed-in person who never enrolled a PIN (`AppLockRepositoryImpl` enables App-Lock by default and reports the lock required whenever no last-active timestamp exists) — routing it to Lock presents a lock nothing can open and routing it to Sign-In is this story's defect; Android's Redirect branch not navigating for a ban was read without its `BanScreen` overlay (and Android now navigates as well); a live session whose identity cache missed draws Sign-In exactly as the old cascade did (its first branch was `!hasStoredCredential -> SignIn`), and `AuthViewModel`'s migration path resolves the identity over the network from there — the one launch that still needs the network, because nothing local names the account; and the claim gate's "settle on every exit" was the reviewer's correct objection that produced (8) and (9).
- 2026-09-04 — Gates at `7a5d22cd5a4`: `:shared:jvmTest` 1786/0, `:app:testDevDebugUnitTest` 2277/0, `:app:compileDevDebugAndroidTestKotlin`, `compileKotlinIosArm64`, `ktlintCheck` ×2, `detekt` clean; jest 65/65 across the runner and iOS driver suites; eslint and prettier clean. **Not device-proven since `13d0e02`**: J40 on both phones at the branch head is owed with the iPhone proof, on the local stack and then on dev after the deploy.
- 2026-09-04 11:01 WIB — **Review loop finished: the twelfth pass returned no findings** over every production hunk (sequencer, gate, cascade, both hosts, HomeViewModel, sign-in, auth repositories, the iOS log sink, the runner, the iOS driver, the gauntlet script, stop.sh, the LiveKit chooser).
- 2026-09-04 11:25 WIB — **The first push was refused by the pre-push Playwright run, and none of it was this diff.** Five admin tests failed (support image upload, maintenance storage audit, backups list, banners with an image, one reports test left dirty by an earlier interrupted hook run): every one a presigned PUT or a storage read against `192.168.1.8`, the LAN address the stack was started on before the operator changed networks, baked into `express-api/.env.local` as `MINIO_ENDPOINT` and `CDN_URL`; the Mac was on `10.179.17.89`. Restarting the stack re-synced the address and the five specs passed (65/65, one pre-existing flake green on retry). The restart itself exposed one more defect, fixed and pinned: `stop.sh` returned before its ports had closed, so `start.sh`'s pre-flight refused on emulators still shutting down; it now waits, bounded, and names whatever is still held.
- 2026-09-04 11:34 WIB — Thirteenth review pass (the stop.sh wait): no findings.

- 2026-09-05 08:25 WIB — **Both phones on USB; device proof at the branch head begins.** Android run `local-2026-09-05T01-25-09-961Z` 6/6 (core set + J40) on the previous APK; iPhone run `local-2026-09-05T01-31-40-704Z` 4/6 — J07 and J40 red, and the runner's iOS `readAppLog` came back EMPTY while the phone had logged: the live `idevicesyslog` relay drops whole windows of lines.
- 2026-09-05 09:08 WIB — **Fix A (8d4d75afb04): Keychain bridging.** Kotlin/Native `CFTypeRef as? NSData` never succeeds (the compiler had said so — CAST_NEVER_SUCCEEDS was suppressed), so the Keychain read could never hand back the stored bytes; bridged properly and swept the class. Follow-ups noted: `createQuery` CFBridgingRetain leak; X9.63 vs SPKI public-key export.
- 2026-09-05 09:15 WIB — **Fix B (970d4a1e08d): iOS app log from the persisted archive.** `drivers/ios-journey-device.js` `readAppLog` now pulls `idevicesyslog archive` for the run window and reads it with `log show`, so log-based assertions on the iPhone see every line. Diagnostic iPhone run `local-2026-09-05T02-34-14-217Z` (4/5) confirmed the archive read.
- 2026-09-05 09:56 WIB — **At 970d4a1e08d: Android `local-2026-09-05T02-47-26-998Z` 6/6; iPhone `local-2026-09-05T02-56-46-302Z` 4/6; Kotlin gates green.** J07 red on the iPhone is NOT this ticket: `IosPrivateMessageRepositoryImpl.getOrCreateConversation` reads Firestore directly and the conversations `get` rule null-derefs on the missing document (PERMISSION_DENIED; app log `E/firebaseCall: Failed to get or create conversation`) — filed as SHY-0522 (P1). J40 red at "private data reaches the room list": the app logged `Received 0 active rooms` but XCUITest saw no `roomList_emptyState` — the empty-state Box carried only a testTag, which Compose on iOS does not expose as an accessibility element (uiautomator exposes every testTag, so Android never showed it).
- 2026-09-05 10:25 WIB — **bc1ee43b4ab: the empty state is an accessibility element.** `semantics(mergeDescendants = true)` on the tagged Box; pin test `RoomListEmptyStateIsAnAccessibilityElementPinTest` red → green; shared `testsupport/RepoSource` for source-anchored pins (chore to file: 16 older pin tests each define their own `repoRoot()`). Gates green; both apps rebuilt and reinstalled.
- 2026-09-05 10:17 WIB — **Android `local-2026-09-05T03-17-26-912Z` 6/6 at bc1ee43b4ab.**
- 2026-09-05 10:33 WIB — **iPhone `local-2026-09-05T03-22-52-484Z` at bc1ee43b4ab: 4/6.** J07 still fails on the first DM (SHY-0522: iOS private messages bypass the API). J40 step 7 passes now. Step 8 was reported as passed, but the phone's crash log says the app ABORTED 218 ms after drawing the redirect: `iosApp-2026-09-05-102748.ips`, SIGABRT via `propagateExceptionFinalResort` — the revoke makes Firestore rules deny a listener, gitlive closes the `snapshots` Flow with the error, and on Kotlin/Native an exception escaping a `launch` aborts the process. Android swallows the same listener error, which is why it passed there. → SHY-0523 (P0, PR #2156), merged into this branch at d1e74846a62.
- 2026-09-05 11:38 WIB — **fbebcf8d222: the runner now detects a dead app.** Why the crash passed J40: the next WebDriverAgent call lost its session and the recovery reopened one, which on XCUITest LAUNCHES the app when none is running; the step judged pid 1648 after pid 1645 had aborted (proven on the phone: a new session does not relaunch a running app, it only launches a missing one). Now `launch()` records the devicectl pid, `assertAppAlive` compares it with the running `iosApp` (a different pid is a relaunch), pulls the `.ips` over USB (`idevicecrashreport -k`) and puts the signal + Kotlin frames in the error; every session reopen that was not `launch()`'s own drop proves liveness first; `revokedColdStart` asserts the app survived the redirect on both backends; Android reads `logcat -b crash` since the launch. Fixture = the real crash report. 47 suites / 3015 tests green.
- 2026-09-05 11:49 WIB — **iPhone run 5 `local-2026-09-05T04-43-57-507Z` at fbebcf8d222 (SHY-0523 merged in): 4/6, and the abort is gone.** The newest crash report on the phone is still `iosApp-2026-09-05-102748.ips` (pre-fix); J40 steps 8–13 pass with the app alive through the revoke, the redirect and the re-sign-in. J07 = SHY-0522, unchanged. J40 red AFTER step 13, outside any step: `POST /element -> 404` from the driver's Airplane Mode lookup in Settings — the first time an iPhone J40 reached the offline step. Probed on the phone: `activate_app` for Settings returns before WDA's snapshot has moved off ShyTalk (a lookup 131 ms later misses; the same lookup 1.5 s later finds the switch, whose stable identifier is `com.apple.settings.airplaneMode`). Driver fix: poll for the switch up to 8 s, match by identifier as well as the English/UK labels, and name the Settings screen in the timeout error (3 tests). Found while gating it: the two previous commits were gated on 47 of 539 jest suites — `revokedColdStart`'s fake device lacked `assertAppAlive` (2 red tests) and the archive-based `clearAppLog` (970d4a1e08d) had shipped with its old live-relay test still red; both fixed, the fake now records the liveness check. Also silenced the pre-existing `MetadataLookupWarning` in every run log: `METADATA_SERVER_DETECTION=none` in local mode only (API + runner, 4 tests).
- 2026-09-05 12:47 WIB — **iPhone run 6 `local-2026-09-05T05-47-39-736Z` at 984eb4df0b9 (SHY-0523 merged): 4/6, no abort.** J-SMOKE/J09/J02/J08 pass; J07 fails on the first DM as before (SHY-0522, to be filed); J40 clears its 13 preamble steps and fails in `setOffline`: "Airplane Mode reads 0 after the tap; wanted 1". Two runner fixes, tests first: `5859d776a59` gives `initDb` the same `METADATA_SERVER_DETECTION=none` as `localAdminAuth` (the MetadataLookupWarning in the Android run-5 log came from the third firebase-admin init site; four tests), and `c74c9cce282` makes `setOffline` poll the switch for up to 3 s after a tap and tap once more on a miss (three cold-start tests plus the recovery list). Crash reports on the phone: 28 before, 28 after.
- 2026-09-05 13:10 WIB — **iPhone run 7 `local-2026-09-05T06-05-12-899Z`: 4/6, J40 now fails "Airplane Mode reads 0 after 2 taps", and the video shows why the settle fix could not help.** Settings is fully drawn and the switch stays off through both taps. A WebDriverAgent probe explains it: the Airplane Mode row is reported as ONE `XCUIElementTypeSwitch` 380 points wide (x 20, width 380 on a 420-point screen), so `/element/:id/click` taps the row's centre, which is the label, and iOS does nothing; a pointer tap 24 points in from the row's right edge flipped the switch on and back off. `c86a6c77a75`: `setOffline` reads the switch's frame and touches the toggle control 40 points in from its trailing edge (`_tapSwitchKnob` over the shared `_tapPoint` that `tap()` now uses); the fakes in journey-cold-start flip only for a touch inside the 51-point control, so an element click cannot pass them again. Proven through the real `setOffline` path before run 8: on in 3.1 s, off in 4.4 s. Crash reports: 28 before, 28 after.
- 2026-09-05 13:24 WIB — **iPhone run 8 `local-2026-09-05T06-17-58-201Z` at `c86a6c77a75` (the switch-knob fix): 5/6, J40 PASSES.** J-SMOKE, J09, J02, J08 and J40 pass; J07 fails on the first DM (SHY-0522) and is the only red. The Airplane Mode row toggled on the first knob tap in both directions. The phone's own cold-start log (16 `ColdStartSequencer` lines over the run window, read from the persisted archive with `idevicesyslog archive` + `log show --style syslog`; the live relay held none) shows five warm cold starts drawing Main with no I/O and then confirming the claim, the offline cold start drawing Main and staying unverified on the transport failure (`confirm: refresh FAILED; sessionAlive=true` then `transport failure, staying unverified`), and the signed-out cold start drawing SignIn. Crash reports on the phone: 28 before, 28 after (no abort). Device proof at the head is therefore: Android run `local-2026-09-05T05-42-02-104Z` 6/6 (APK at 984eb4df0b9) and iPhone run 8 5/6 with the one known red; every commit after 984eb4df0b9 touches only the runner, its tests and baselines, plus a five-line `firebase.js` metadata-probe default that silences a warning, so both phone builds are app-equivalent to the head.
- 2026-09-05 13:30 WIB — **Evidence page regenerated for the sign-off:** https://claude.ai/code/artifact/1e049bf7-f58e-45f5-bed4-484c030203c8 — Android run 5b and iPhone run 8 with every step screenshot, the cold-start log lines per scenario from both phones, the gates table, J07 shown red against SHY-0522, and the Android J40 recording; the iPhone walk recording is kept local because its Settings frames show the account holder's name and the Wi-Fi SSID.
- 2026-09-05 14:10 WIB — Review round 14 (over 4226a070ed4..c86a6c77a75, the ten runner/driver commits and the two merges) returned three findings, each verified in source and fixed under TDD: **P0** `CryptoKeyPair.ios.kt` handed a possibly-NULL `SecKeyCopyPublicKey` result to `SecKeyCopyExternalRepresentation` (the rewrite had dropped the pre-rewrite `?: return null`) — pinned in `IosKeychainResultsAreBridgedPinTest` (red first), guarded with a log + `CFRelease(privateKey)` + `return null` (47438aae33a); **P1** J40 asserted the launched process only in the revoked scenario — `launchLog(label)` now asserts `assertAppAlive` before every cold-start log read, the four verdicts name themselves, `revokedColdStart` reads through it and no longer takes `pkg`; pinned in `device-journey-app-alive.test.js` (three pins red first) and the `journey-cold-start` fake models the seam (0a8625b3ded); **P2** sixteen jvmTest pins carried a private copy of `repoRoot()` (three also of `read()`) identical to `testsupport.RepoSource` — swept onto the shared object, unused `File`/`assertTrue` imports removed (65bc19f7403). Gates at 65bc19f7403: `:shared:jvmTest --rerun` 1,812 passed / 0 failed + detekt clean, 0 compiler warnings; express-api full `npm test` 540 suites / 15,414 tests passed, 0 warnings (the rerun after prettier's reformat is recorded below); eslint + prettier clean. The iosMain change means the run-8 iPhone build is no longer app-equivalent to the head: the iPhone is rebuilt and re-proven (run 9, below); the Android proof (run 5b) stands, no common/android source changed.
- 2026-09-05 14:29 WIB — **iPhone run 9 `local-2026-09-05T07-20-39-776Z` at `65bc19f7403` (the round-14 fixes, rebuilt and proven in the installed dylib): 5/6, J40 PASSES 15/15.** J-SMOKE, J09, J02, J08 and J40 pass; J07 fails on the first DM as before (SHY-0522, not a cold-start defect). Cold-start numbers from the report: signed-in room list drawn 722 ms after launch; revoked — the first tree read at 526 ms already showed sign-in with "Your session has ended" on the launch frame, the log recording Main drawn first and the session invalidated beforehand; offline — main drawn at 768 ms, still the room list 8 s later, unverified, log "transport failure, staying unverified"; signed-out — sign-in drawn at 318 ms, nothing before it. The new liveness assertion ran at every verdict, including the offline one with Airplane Mode on, and passed (devicectl reaches the phone over USB). Crash reports pulled before and after: zero new `.ips`, retired set identical. The persisted iPhone log for the run window holds 16 ColdStartSequencer lines (6× immediate Main, 3× immediate SignIn, 2× confirm refresh, 1× transport failure).
- 2026-09-05 14:40 WIB — **Review round 15 (Sonnet, 56 tool uses) over `4226a070ed4..65bc19f7403`: 1 Critical, 2 Important, 1 informational, all closed.** Critical: no unit test drove the death path through `revokedColdStart` — added ``674c33b539c``, a test whose fake `assertAppAlive` throws `AppProcessDiedError` and which asserts the step rejects with that very error (identity, not message) and records it on the reporter; proven to bite by a throwaway mutation that swallowed the death (red), then reverted (green). Important #2 (the offline verdict's liveness check might need Wi-Fi): disproven by run 9 above — no change. Important #3: the three remaining private `read()` copies (AgeVerificationCta, AppLock, IosBypassDeviceChecks pins) plus ReportGuide's assertion-free reader and NavGraph's `readStripped` now go through `RepoSource.read` — ``9ac896961a6``. Informational #4: the gates row now names the Kotlin/Native compile of iosMain (proven by the gradle link in the iPhone rebuild).
- 2026-09-05 14:58 WIB — **Review round 16 (Sonnet, 32 tool uses) over `65bc19f7403..9ac896961a6`: 0 Critical, 1 Important, 1 informational.** Important: the new death test seeded a device that never showed the redirect message, so step 1's watch polled its full 5 s before the death at the verdict — fixed in ``b2ab6c7351b`` by seeding the snackbar frame (254 ms instead of ~5.5 s), verified by the same reviewer. Informational: RepoSource's assertion message differs from the removed readers' ("moved:" vs "expected source file to exist:"); nothing asserts on it, and ReportGuide's reader gained the existence assertion it lacked. Verified clean: the comment-stripping pipeline in NavGraph is unchanged, no dangling imports, the death propagates unwrapped so the identity assertion is strict, the fake reporter records exactly once per step.

- 2026-09-05 17:10 WIB — **CI flagged `lint / Lint` at `f964075a9e4`: the SHY-0245 ratchet counted 2 > 1 fixed-duration waits in `ios-journey-device.js`.** Root cause: the branch added a `const sleep = …` helper and the ratchet counted the helper's DEFINITION but none of its CALLS — the runner already carried 29 `await sleep(...)` calls the pattern never saw, so a name laundered the debt. Fix (TDD, red first): new `express-api/scripts/drivers/poll-until.js` — `pollUntil(probe, accept, { intervalMs, deadlineMs | maxLooks })` returns the first accepted value or the last one probed when the bound is spent, refuses an unbounded poll, pauses at most a quarter of the window; the driver's crash-report pull, Airplane Mode value wait and Airplane Mode switch wait, and the runner's first-frame and room-list waits now poll a condition. The offline soak keeps its fixed wait under a reasoned `sleep-ok:` because the soak IS the check. `scripts/check-no-test-sleeps.sh` now also matches `await|return <x>.sleep|delay|pause(` and `timers/promises`, honours same-line `sleep-ok: <reason>` exemptions, and its harness proves a helper cannot launder a wait. Baseline regenerated at 346 across 62 files: every increase is PRE-EXISTING debt the hardened pattern made visible (runner 1→30, ui-dump-retry 1→2, safety-audit 1→2, three translate scripts), none from this branch — follow-up **SHY-0524**. `poll-until.js` is listed as a helper in `driver-contract.test.js` (the first full gate caught that at 6 failures). Gates: ratchet 346 ≤ baseline; full `npm test` 541 suites / 15440 tests green; prettier, eslint, shellcheck clean. Inline review of the driver and runner diffs: CLEAN, one round. Journey audit: J40 first frame, room-list arrival and offline soak, plus the crash-report pull path — pinned by the unit suites, owed on-device at the dev deploy (J40 + core set, both phones).
- 2026-09-05 22:40 WIB — merged develop (`40cae39372b`) once, after #2157 (the
  handover) and #2156 (SHY-0523) landed. Conflicts: the SHY-0523 story
  (add/add — develop's copy taken, it differed only by a newer review marker)
  and the SHY-INDEX.md row block (develop's SHY-0519/0523/0524 rows kept in
  ID order). The app-code delta against the device-proven head `e1dbfe42bb9`
  is the SHY-0521 express-api lockfile and its test only; `shared/`, `iosApp/`
  and `androidApp/` are byte-identical, so both phone proofs stand.

Reviewed-up-to: 40cae39372b

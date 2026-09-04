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
Reviewed-up-to: afd502187d7

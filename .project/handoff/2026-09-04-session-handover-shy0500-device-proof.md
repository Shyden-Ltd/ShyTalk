# Handover — 2026-09-04 06:45 WIB (compact requested by the operator)

Branch `story/SHY-0500-instant-cold-start`, **29 commits ahead of origin, NOT
pushed**. HEAD is a deliberately RED checkpoint (`d0e1620cb1a`): the pins for
four review findings exist, the implementation does not yet, so
`:shared:jvmTest` does not compile. **Do not push until the next commit turns
it green.** Everything else below is committed and green.

## What is proven

- **Android device proof: 6/6 journeys green** on the OnePlus (CPH2653,
  Android 16), run `journey-results/runs/local-2026-09-03T19-05-01-168Z`
  (report.json, 68 screenshots, walk video, four `J40-first-frame-*.png`).
  APK built at `13d0e02` (the badge in every screenshot says so). J40 is the
  story's device proof: signed in / invalidated / offline / signed out, each
  read from the screen AND the app's own log.
- **iPhone: 3/6, deferred by the operator** ("no devices available"). The
  three reds each had a cause, all fixed and pinned (below). The rebuilt app
  with all fixes is installed on the phone (over the network tunnel). The
  rerun needs the phone on **USB** (its link dropped twice after iOS 27.0)
  and the per-boot UI-automation consent approved on-device.

## Defects the device proof found (all fixed, tested, committed)

1. **Launch cascade** (`LaunchDestination.kt`): "no App-Lock credential" was
   read as "no session" — every signed-in cold start drew sign-in first, then
   reached Home through the network. Now last in the cascade. The story's own
   fixture defaulted `hasStoredCredential = true`.
2. **iOS device log**: `println` reached no device log; NSLog reached it
   redacted as `<private>`. `IosLogSink` + `iOSApp.swift` installs
   `os_log("%{public}@")`. `idevicesyslog -p iosApp` (process name is
   `iosApp`, not ShyTalk).
3. **iOS persisted user**: the SDK restores its user asynchronously;
   `awaitPersistedSession()` (bounded, keychain, never network) runs before
   the decision.
4. **iOS keyboard never dismissed**: the driver posted `/wda/keyboard/dismiss`,
   which Appium never routes for a client (404 swallowed); now
   `mobile: hideKeyboard`.
5. Infra: LiveKit chooser aborted on bash 3.2 (`serial[@]`); `stop.sh` never
   matched the API it started; shared Appium started without `ANDROID_HOME`;
   `svc data enable` raises a OnePlus system dialog (offline cut is Wi-Fi +
   tunnels only); smoke journey's launch counts as using the product.
6. Emulator ignores `revokeRefreshTokens` for the refresh exchange (verified);
   J40 invalidates by DISABLING the account and restores it in `finally`;
   `requiresLocalState: true`.

## In progress — the four review findings (`/code-review low origin/develop`)

Pins written (RED). Implementation decided, not yet written:

- **Claim gate** — `ColdStartClaimGate` (commonMain, class with `begin()`,
  `settle()`, `refreshInFlight: StateFlow<Boolean>`, `suspend awaitSettled()`).
  Sequencer takes `claimGate` (default a shared instance): `begin()` when
  `immediateDestination()` draws Main from a stored session; `settle()` in a
  `finally` around `confirm()`. `HomeViewModel.observeRooms()` does
  `claimGate.awaitSettled()` before `.getActiveRooms(cohort)` (new defaulted
  ctor param `claimGate: ColdStartClaimGate = ColdStartClaimGate.shared`).
  Reason: the shell mounts before `confirm()` now, so "claim refreshed before
  any cohort-scoped read" is no longer structural. Rewrite the stale comment
  at `MainActivity.kt` ~445-452 and name the gate there.
- **One-shot redirect** — `SignInScreen(onSessionExpiredShown: () -> Unit = {})`
  called AFTER `showSnackbar` inside `LaunchedEffect(sessionExpired)`;
  `SignInScreenParams.onSessionExpiredShown`; `IosPlatformScreens` passes it;
  `SharedNavGraph`/`NavGraph` take `onLaunchRedirectConsumed: () -> Unit = {}`
  and pass `onSessionExpiredShown = onLaunchRedirectConsumed`; MainActivity +
  MainViewController pass `onLaunchRedirectConsumed = { launchRedirect = null }`.
- **iOS navigates on redirect** — `MainViewController`: add
  `LaunchedEffect(launchRedirect) { if (launchRedirect != null) navController.navigate(Screen.SignIn.route) { popUpTo(0) { inclusive = true } } }`
  next to `SharedNavGraph(...)`; DELETE `value = confirmation.screen.route`
  (rewriting a mounted NavHost's start destination moves nothing; bans flow
  through `coldStartBan` state).
- **confirm() before draw** — `checkNotNull(drawnFirst) { "confirm() before immediateDestination(): ..." }`.
- Then: `./gradlew :shared:jvmTest :app:testDevDebugUnitTest :shared:compileKotlinIosArm64 :shared:ktlintCheck :app:ktlintCheck detekt`,
  commit, re-run `/code-review low origin/develop` until clean, bump
  `Reviewed-up-to:` in the story, push ONCE, CI.

## Operator report under triage — dev admin page "Your account could not be identified"

- Message = `express-api/src/middleware/auth.js` `rejectMissingIdentity` (403
  `no_identity`): `resolveUniqueId(uid)` = `users where firebaseUid == uid`
  returned empty (cached 5 min per uid). Middleware unchanged since 08-27.
- Dev API serves sha `47255b6a64f` (health endpoint) — **#2131 (SHY-0289) is
  merged on develop but NOT deployed to dev** (rule: deploy after every
  develop merge). Deploy is owed; it is unlikely to be the cause.
- Admin console (`public/admin`) calls `/api/portal/me` first (strict auth).
  Next steps: (1) reproduce with the admin persona on dev: sign in
  `admin@shytalk.dev` via Firebase REST (`FIREBASE_DEV_API_KEY` +
  `PERSONAS_PASSWORD` in `~/.shytalk/dev-personas.env`), call
  `GET https://dev-api.shytalk.shyden.co.uk/api/portal/me` — persona refused
  too ⇒ systemic; persona fine ⇒ the operator's account has no `users` doc
  with his `firebaseUid` on dev (ask which account he signed in with).
  (2) Dev VM logs: `ssh -i $SSH_KEY ubuntu@$DEV_HOST` per
  `express-api/scripts/dev-runner-deploy-and-run.sh`; pm2 logs carry
  "Refused a caller with no resolved identity {uid, method, path}".

## Also owed

- Evidence page for the operator's sign-off (Android proof + iPhone marked
  owed). Media prepared: `scratchpad/evidence/` (J40 cut, 1080w/12fps,
  2.4MB; 20 PNGs). Every claim must be written after OPENING its screenshot.
- Handover PR #2136 (docs-only) still open: the permission classifier refused
  `gh pr merge` twice.

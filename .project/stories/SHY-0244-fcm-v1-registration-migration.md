---
id: SHY-0244
status: Draft
owner: claude
created: 2026-07-25
priority: P1
effort: L
type: refactor
roadmap_ids: []
---

# SHY-0244: Migrate push from FCM registration tokens to V1 Installation-ID registration

## User Story

As **a ShyTalk user who must reliably receive a message, room invite or moderation notice on whichever device I am holding**,
I want **push delivery to keep working as Firebase retires the registration-token API in favour of Installation-ID registration**,
So that **notifications do not silently stop when the deprecated path is eventually removed, and the app can keep taking Firebase security updates in the meantime**.

## Why

Firebase Messaging **25.1.0** deprecated `getToken()`, `deleteToken()` and `FirebaseMessagingService.onNewToken()` together, in favour of a **V1 registration model**: `FirebaseMessaging.register()` returns `Task<Void>` and fires `FirebaseMessagingService.onRegistered(String)` with the **Firebase Installation ID (FID)** instead of an FCM registration token. Verified directly from the SDK source, not inferred from the compiler message (Kotlin only reports the bare "Deprecated in Java", because the Java annotation carries no `ReplaceWith`).

The two models are **mutually exclusive and switched by a manifest flag**:

- `register()` throws `IllegalStateException` unless `<meta-data android:name="firebase_messaging_installation_id_enabled" android:value="true" />` is present.
- `getToken()` throws `IllegalStateException` when that flag **is** set to `true`.

So this cannot be a gradual, call-site-by-call-site migration inside one app build — the flag flips the whole app instance from one model to the other. Every producer and every consumer of the identifier has to move together, and the identifier's meaning changes from "an FCM registration token" to "a Firebase Installation ID".

**Discovered 2026-07-25** while grinding the Dependabot backlog: `firebaseBom 34.14.1 → 34.15.0` (#1650 patch group) fails `Build & Test` with six `-Werror` errors. The deprecated APIs still **work** — nothing breaks at runtime — the build fails only because Kotlin treats warnings as errors. Operator ruling the same day: **drop `firebase-bom` out of the dependency sweep entirely and file the migration as its own story**, to be picked up immediately after develop is tested, verified and merged. `firebaseBom` therefore stays pinned at `34.14.1` until this story lands.

### Why this is the NEXT ticket once develop is cleared

Not "important eventually" — it is the next thing to pick up, for five reasons that compound:

1. **Holding the BOM freezes the entire Firebase update channel, not just Messaging.** `firebase-auth`, `firebase-database`, `firebase-firestore` and `firebase-messaging` carry **no `version.ref` of their own** in `gradle/libs.versions.toml` — they all resolve their versions from the `firebase-bom` platform. Pinning the BOM at `34.14.1` to dodge the `-Werror` wall therefore blocks **every** Firebase update: Auth, Firestore and RTDB included. No Firebase security advisory is open today (all six current Dependabot alerts are npm), so this is about a **closed channel rather than a live exposure** — but the next Firebase advisory would find us unable to patch without doing this whole migration under incident pressure. That is the expensive way to do it.
2. **The failure mode when the deprecated path is finally removed is SILENT.** Push does not error — notifications simply stop arriving. Nobody gets an exception, no dashboard goes red, and the sender sees success. On a minors-facing app that path carries moderation notices and ban notifications, so a silent outage is a **safety** regression that could run undetected.
3. **The cost only grows.** Migrating from one BOM release behind is the cheapest this will ever be. Every release skipped adds more intermediate change to absorb in the same jump, and raises the odds that the eventual migration collides with something else urgent.
4. **It is launch-shaped.** Push is core to a social app. Entering the MVP on a frozen, deprecated transport means the migration eventually happens on **live users** instead of pre-launch, with real notification loss as the blast radius.
5. **It taxes every future dependency sweep.** Dependabot re-proposes `firebase-bom` on schedule and it goes red each time. No ignore rule has been added — deliberately, because an ignore would also mask a future Firebase **security** patch (see 1) — so the noise is the price of keeping that channel visible, and it persists until this lands.

## Acceptance Criteria

### Happy path

- [ ] A fresh install on a real Android device registers via `FirebaseMessaging.register()`, `onRegistered(String)` fires, and the identifier reaches the backend through the Express API.
- [ ] A fresh install on a real iPhone reaches the equivalent registered state, and the identifier reaches the backend through the Express API.
- [ ] A message, room invite and moderation notice each arrive as a real push on both real devices, proven in **dev** — not asserted from unit tests.
- [ ] `firebaseBom` is bumped to the current release and `./gradlew assembleDevDebug` compiles with **zero** warnings under `-Werror`.

### Error paths

- [ ] `register()` failing (no network, Play Services missing/stale, backend unreachable) leaves the app usable and retries on next foreground — it never wedges the user in a blocked state and never crashes.
- [ ] The manifest flag being absent while `register()` is called is caught in CI, not at runtime: a guard test asserts the flag and the call path agree, since the SDK's response to the mismatch is a thrown `IllegalStateException`.
- [ ] An identifier the backend rejects as unregistered is reaped by the same cleanup path that `cleanupInvalidTokens` performs today, so dead entries cannot accumulate.

### Edge cases

- [ ] A user signed in on several devices keeps receiving push on **all** of them — the stored collection stays multi-device (`User.fcmTokens` today is a `List<String>`).
- [ ] Identifier rotation mid-session is picked up without a restart, matching the existing iOS behaviour that re-syncs on foreground to catch rotation that happened while suspended.
- [ ] Sign-out then sign-in as a different persona does not deliver the previous user's notifications to the new session — a cross-account leak here would be a safety defect in a minors-facing app.
- [ ] An app instance upgrading from a token-model build to a registration-model build migrates cleanly: the stale token is removed and the new identifier stored, with no window in which the user is unreachable.

### Performance

- [ ] Registration is off the critical path of first paint — cold start is not measurably slower than the token model on the lowest-spec target device.
- [ ] Fan-out cost per notification does not regress against today's `sendEachForMulticast` batch.

### Security

- [ ] The identifier is never logged in full, never committed, and never returned to a client other than its owner.
- [ ] Delivery targeting stays server-side behind the Express API — no client gains the ability to address another device directly (the API-only-backend rule).
- [ ] The identifier is deleted on account deletion and on sign-out, and covered by the GDPR export/erasure path that already handles `fcmTokens`.

### UX

- [ ] No new user-visible prompt, dialog or permission step is introduced — the OS notification permission flow is unchanged.
- [ ] A user who has granted notification permission sees no interruption or re-prompt across the upgrade.

### i18n

- N/A — no user-facing strings are added or changed; the migration is entirely below the presentation layer.

### Observability

- [ ] Registration success, failure and rotation each emit a debug log locally and in dev, sufficient to diagnose a non-delivering device without attaching a debugger.
- [ ] A dispatch that finds zero valid identifiers for a user logs loudly rather than succeeding silently — a silent no-op here is indistinguishable from a delivered push.

## BDD Scenarios

**Scenario: a fresh Android install becomes reachable**
- **Given** the app is installed on a real Android device and the user signs in
- **When** registration completes
- **Then** the backend holds an identifier for that user
- **And** a notification sent to that user arrives on the device

**Scenario: a fresh iPhone install becomes reachable**
- **Given** the app is installed on a real iPhone and the user signs in
- **When** registration completes
- **Then** the backend holds an identifier for that user
- **And** a notification sent to that user arrives on the device

**Scenario: a user with two devices receives on both**
- **Given** the same user is signed in on a real Android device and a real iPhone
- **When** one notification is sent to that user
- **Then** it arrives on both devices

**Scenario: upgrading from the token model leaves no gap**
- **Given** a device already registered under the old token model
- **When** the user updates to the registration-model build and opens the app
- **Then** the stale token is removed from the backend
- **And** the new identifier is stored
- **And** a notification sent immediately afterwards still arrives

**Scenario: signing out stops delivery to that device**
- **Given** a signed-in device receiving notifications
- **When** the user signs out
- **Then** a notification for that account no longer arrives on that device

**Scenario: the manifest flag and the call path cannot disagree**
- **Given** the codebase calls `register()`
- **When** the guard test runs in CI
- **Then** it fails unless the installation-ID manifest flag is present
- **And** the failure message names the flag and the file it belongs in

**Scenario: registration failure degrades quietly for the user and loudly for the log**
- **Given** a device with no network
- **When** the app starts and registration fails
- **Then** the user can still use the app normally
- **And** the failure is visible in the debug log
- **And** registration is retried when the app next comes to the foreground

## Test Plan

**Classification: FULL protocol.** This changes app runtime (`app/**`, `shared/**`, `iosApp/**`) and backend runtime (`express-api/src/**`). No exemption applies, and the backend⇒full-gauntlet rule (SHY-0127) is in force: the complete real-device + all-browser matrix runs.

### Red (must fail first)

- **Kotlin/JVM** — `PlatformNavCallbacksTest`, `UserTest`, `UserToMapTest`: assert the identifier is sourced from the registration callback and round-trips through the user model. RED because the model and call path still speak tokens.
- **CI guard** — a new test asserting the manifest flag and the `register()` call path agree. RED before the flag exists.
- **Express/Jest** — `express-api/tests/**` around `utils/fcm.js`: dispatch targets the migrated identifier and reaps rejected entries. RED before the dispatch changes.
- **iOS XCTest** — `iosApp/iosAppTests`: the AppDelegate publishes the migrated identifier to the shared cache. RED before the delegate changes.

### Green

- Full framework sweep: `./gradlew testDevDebugUnitTest :shared:jvmTest`, `detekt`, `ktlint`, `:shared:compileKotlinIosArm64`, `cd express-api && npm test`, `npm run lint`, Playwright e2e + integration, `connectedDevDebugAndroidTest`, iOS unit + UI, SonarCloud.
- **Real push proof, local then dev, on a real Android device AND a real iPhone.** Per [[feedback-fcm-real-proof-in-dev]] a green unit suite is not evidence that push works — delivery is proven by a notification actually arriving.
- State verification: Firestore agrees with the UI after registration, rotation, sign-out and account deletion.

### Mutation proof

- Neuter the identifier-reaping path → the invalid-entry test fails.
- Remove the manifest flag → the CI guard test fails.
- Point dispatch at an empty identifier collection → the loud-failure observability test fails.

## Out of Scope

- Any change to notification **content**, grouping, channels or the permission UX — this is a transport-identifier migration only.
- The `-Werror` policy itself. Warnings stay failures; this story removes the warnings rather than silencing them.
- Web push. ShyTalk web does not use FCM registration tokens today.
- The other Dependabot bumps in flight (GH-Actions SHAs, detekt, billing, lifecycle) — unaffected, and landing separately.

## Dependencies

- **Blocked on:** develop being tested, verified and merged (operator ruling 2026-07-25). Not to be started before that.
- **HARD PREREQUISITE — `firebase-admin` 13 → 14 (Dependabot #1520).** The server cannot address an FID on v13 at all. Settled 2026-07-25 by reading the shipped type definitions of both versions rather than the docs:
  - **v13.10.0 (currently installed):** `export type Message = TokenMessage | TopicMessage | ConditionMessage` — no installation-ID targeting anywhere in `lib/messaging/*.d.ts`.
  - **v14.1.0:** `export type Message = FidMessage | TokenMessage | TopicMessage | ConditionMessage`, with `FidMessage { fid: string }` and `FidMulticastMessage { fids: string[] }`. `TokenMessage` is now marked `@deprecated Use FidMessage instead`, and `MulticastMessage` likewise, having gained an optional `fids?: string[]` alongside its deprecated `tokens`.

  So the **open question is closed and the answer is favourable**: direct-send by FID exists and is not weaker than multicast — `FidMulticastMessage` is the like-for-like replacement. The server change in `express-api/src/utils/fcm.js` is `sendEachForMulticast({ tokens })` → `sendEachForMulticast({ fids })`: the same method, a different field. The SDK even notes `FidMulticastMessage` is temporary and will be renamed back to `MulticastMessage` once the token form is removed, so the eventual end state is the shape we have today.

  **This re-orders the dependency sweep:** #1520 stops being "just another major bump to defer" and becomes the enabling step for this story. It should land before (or as the opening move of) SHY-0244, and must NOT be closed as stale.
- Real Android device + real iPhone over USB, and dev Firebase, for delivery proof.
- iOS parity: the Apple SDK's own deprecation timeline for `MessagingDelegate.messaging(_:didReceiveRegistrationToken:)` must be confirmed, since Android and iOS have to land together under the tri-platform policy. **Still open** — the client side is not yet settled the way the server side now is.

## Risks & Mitigations

- **Risk: push silently stops for some users after the flag flip** — the worst outcome, because a missing notification is invisible to the sender. **Mitigation:** delivery is proven on real devices in dev before merge, the upgrade path is tested from an already-registered install, and zero-identifier dispatch logs loudly instead of succeeding quietly.
- **Risk: the manifest flag makes this a one-way door per app instance** — `getToken()` starts throwing once it is set. **Mitigation:** treat rollback as a code revert plus flag removal, and verify a downgrade path on a real device before merge rather than discovering it during an incident.
- ~~**Risk: Admin SDK cannot target FIDs the way multicast targets tokens.**~~ **RETIRED 2026-07-25** — verified against firebase-admin 14.1.0's shipped types: `FidMessage`/`FidMulticastMessage` exist and are the like-for-like replacement. The residual risk moved to the dependency: this story now hard-depends on the `firebase-admin` 14 bump (#1520) landing.
- **Risk: Android and iOS drift apart mid-migration**, leaving one platform on each model. **Mitigation:** tri-platform policy — they ship together or not at all.
- **Risk: Dependabot keeps re-proposing `firebase-bom` while this is pending**, adding noise to every sweep. **Mitigation:** decide explicitly whether to hold the bump open as a known-red reminder or add a scoped ignore, and record the choice here.

## Definition of Done

- [ ] Real push delivered and observed on a real Android device AND a real iPhone, in local AND dev.
- [ ] `firebaseBom` bumped, `-Werror` clean, zero suppressions added.
- [ ] Full pre-merge gauntlet green: all frameworks, real devices, all browsers, local then dev.
- [ ] `code-reviewer` 100% clean on the local commit before push.
- [ ] Upgrade path proven from a build using the old token model.
- [ ] Status flipped to `In Review` before merge; `released_in:` set when the release is cut.

## Notes (running log)

- **2026-07-25 ~13:45 WIB** — Filed. Surfaced by the Dependabot sweep: `firebaseBom 34.14.1 → 34.15.0` fails `Build & Test` with six `-Werror` errors across two APIs and four call sites — `FirebaseMessaging.getInstance().token` at `AndroidPlatformNavCallbacks.kt:38,49` and `NavGraph.kt:325,653`, plus the `onNewToken` override at `ShyTalkMessagingService.kt:24`. Read the SDK source rather than trusting the bare "Deprecated in Java" message; found `getToken()`/`deleteToken()`/`onNewToken()` all deprecated in messaging 25.1.0 in favour of `register()` → `onRegistered(FID)`, gated by a mutually-exclusive manifest flag.

  Current architecture inventory (for sizing): `User.fcmTokens: List<String>` in `shared/src/commonMain/.../core/model/User.kt:49` (multi-device); Android producer `ShyTalkMessagingService.onNewToken` + four `getInstance().token.await()` sites; iOS producer `AppDelegate.messaging(_:didReceiveRegistrationToken:)` caching to `NSUserDefaults`; server dispatch `express-api/src/utils/fcm.js` via `messaging.sendEachForMulticast({ tokens })` with `cleanupInvalidTokens`; consumers across `rooms.js`, `users.js`, `conversations.js`, `suggestions.js`, `admin-users.js`, `reports.js`, `notifications.js`, `age-verification-fcm.js`, `alertManager.js`.

  Operator ruling the same day: drop `firebase-bom` from the dependency sweep entirely; file this as its own story; start it immediately after develop is tested, verified and merged.

- **2026-07-25 ~14:45 WIB — the story's one blocking unknown is CLOSED, favourably.** Settled by diffing the shipped `lib/messaging/*.d.ts` of `firebase-admin` 13.10.0 (installed) against 14.1.0 (`npm pack`), rather than trusting docs. v13 has **no** installation-ID targeting of any kind — `Message = TokenMessage | TopicMessage | ConditionMessage`. v14.1.0 adds `FidMessage { fid: string }` and `FidMulticastMessage { fids: string[] }`, deprecates `TokenMessage` in favour of `FidMessage`, and gives the existing `MulticastMessage` an optional `fids?` alongside its now-deprecated `tokens`.

  Consequences: (a) the server migration is a field swap on the same call — `sendEachForMulticast({ tokens })` → `sendEachForMulticast({ fids })`; (b) **`firebase-admin` 14 (#1520) is now a hard prerequisite**, not a deferrable major bump, and must not be closed as stale; (c) the "STOP and escalate if FID targeting is unavailable" branch of this story is dead — no operator decision is needed on that point. The iOS-side deprecation timeline remains the one genuinely open question.

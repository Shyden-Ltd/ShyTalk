---
id: SHY-0324
status: Draft
owner: claude
created: 2026-08-17
priority: P1
effort: L
type: refactor
roadmap_ids: []
mvp: true
---

# SHY-0324: Firebase deprecated the FCM token API we target push with, and the build already refuses to compile without it

## User Story

As a **developer keeping Firebase current**, I want push notifications migrated
off the deprecated FCM registration-token API and onto the supported
registration flow, so that Firebase BOM upgrades stop failing the build and push
keeps working on both platforms.

## Why

**This is already blocking.** Dependabot PR #1519 bumps `firebase-bom`
34.14.1 → 34.15.0 and the Android build fails, because 34.15.0 deprecates the
token API and this project compiles with `-Werror`:

```
e: ShyTalkMessagingService.kt:24:18 This declaration overrides a deprecated
   member but is not marked as deprecated itself.
e: ShyTalkMessagingService.kt:25:15 'fun onNewToken(p0: String): Unit' is deprecated.
e: AndroidPlatformNavCallbacks.kt:38:61 'val token: Task<String!>' is deprecated.
e: AndroidPlatformNavCallbacks.kt:49:61 'val token: Task<String!>' is deprecated.
e: NavGraph.kt:325:69 'val token: Task<String!>' is deprecated.
e: NavGraph.kt:653:81 'val token: Task<String!>' is deprecated.
```

Suppressing them is not available: this repo's rule is *fix or upgrade, never
suppress*. So #1519 cannot merge until this lands, and neither can any later
Firebase BOM bump.

**It is not a rename — the replacement changes what you target push at.** Read
from the SDK source rather than assumed:

| Deprecated | Replacement | What it hands you |
| --- | --- | --- |
| `FirebaseMessaging.getToken(): Task<String>` | `register(): Task<Void>` | nothing directly |
| `FirebaseMessagingService.onNewToken(String)` | `onRegistered(String)` | the **FID**, not the FCM token |

Three consequences that make this a real migration:

1. **The identifier changes.** `getToken()` returns an FCM *registration token*;
   `onRegistered` delivers the *Firebase Installation ID*. Anything storing or
   targeting by the old value has to change.
2. **They are mutually exclusive.** `register()` throws `IllegalStateException`
   unless `firebase_messaging_installation_id_enabled` is `true` in the
   manifest — and `getToken()` throws when that flag *is* true. There is no
   overlap window where both work, so client and server must cut over together.
3. **The server is in scope.** Six server files reference the stored token
   (`utils/fcm.js`, `utils/age-verification-fcm.js`, `utils/alertManager.js`,
   `utils/data-export-builder.js`, `routes/rooms.js`, `routes/users.js`), plus
   18 client call sites across 10 files on Android **and** iOS.

Because push is how bans, suspensions, age-verification outcomes and room
invites reach users, a botched cutover is silent: nothing errors, messages just
stop arriving. That shapes the whole test plan below.

## Acceptance Criteria

### Happy path

- [ ] A fresh install registers and the server can push to it, proven by a real notification arriving on a real Android device.
- [ ] The same, proven on a real iPhone.
- [ ] `firebase-bom` 34.15.0 (or later) compiles with `-Werror` and zero deprecation warnings.
- [ ] PR #1519 (or its successor bump) merges green.

### Error paths

- [ ] Registration failure is surfaced and retried on next launch, not swallowed.
- [ ] A caller reaching the old endpoint shape after cutover gets a clear failure rather than a silent no-op.
- [ ] `register()` called without the manifest flag fails loudly in a test, pinning the mutual-exclusivity trap so a future edit cannot half-apply it.
- [ ] A user whose stored identifier is the OLD token form is migrated or re-registered rather than left unreachable.

### Edge cases

- [ ] An existing install upgrading across the cutover keeps receiving push — the migration path for already-stored tokens is exercised, not assumed.
- [ ] Sign-out then sign-in on the same device re-registers correctly and does not leave a stale identifier targeting the previous user.
- [ ] Two accounts on one device do not cross-target.
- [ ] Uninstall/reinstall produces a new identifier and the stale one is reaped.
- [ ] iOS and Android are cut over in the same release; a mixed fleet must not silently lose one platform.

### Performance

- [ ] Registration adds no measurable delay to cold start, measured on a real device against a pre-change baseline (it must not join the EPIC-0004 critical path).
- [ ] No additional per-request Firestore read on the server push path.

### Security

- [ ] The identifier is never logged in full, on client or server — it is a push-targeting capability.
- [ ] Registration is authenticated; an unauthenticated caller cannot register an identifier against another user's account.
- [ ] The stored identifier is readable only via the Express API, never by a direct client read (EPIC-0006 rule).
- [ ] A banned or suspended user's registration does not become a way to bypass the existing ban/suspension gates in `middleware/auth.js`.

### UX

- [ ] The migration is invisible to users: no re-prompt, no new permission dialog, no visible interruption.
- [ ] A user who previously granted notification permission is not asked again.
- [ ] Verified by eye on a real Android device and a real iPhone across the upgrade.

### i18n

- [ ] N/A for new copy — the migration adds no user-facing strings. Existing notification bodies are unchanged and keep their 20-locale coverage, which is asserted by the existing locale-content tests rather than re-derived here.

### Observability

- [ ] Registration success and failure are logged with the reason, so a fleet-wide failure is visible rather than inferred from silence.
- [ ] The count of users on the old vs new identifier form is queryable during rollout, so the cutover's progress is measurable.
- [ ] A push send to a stale identifier logs distinctly from a genuine delivery failure.

## BDD Scenarios

**Scenario: Notifications keep arriving after the upgrade**

- **Given** a user who was receiving notifications before the update
- **When** they install the updated app
- **Then** they keep receiving notifications without doing anything

**Scenario: A brand-new install receives its first notification**

- **Given** someone installing the app for the first time
- **When** the server sends them a notification
- **Then** it arrives on their device

**Scenario: Signing in as someone else does not misdeliver**

- **Given** a device where one user signs out and another signs in
- **When** the server sends a notification to the first user
- **Then** it does not arrive on that device

**Scenario: A user who allowed notifications is not asked again**

- **Given** a user who already allowed notifications
- **When** they install the updated app
- **Then** they are not asked for permission again

## Test Plan

**RED first.** The upgrade itself is the first failing test: with
`firebase-bom` 34.15.0 the build does not compile, and that is the starting
state.

### Compile gate (the RED)

- `./gradlew assembleDevDebug` with the BOM bumped — must fail with the six
  deprecation errors listed in Why, then pass once migrated.
- `./gradlew :shared:compileKotlinIosArm64`.

### Kotlin unit (`app/src/test/`, `shared/src/commonTest/`)

- `AndroidPlatformNavCallbacksTest` — extend: registration success stores the identifier; failure is logged and retried, not swallowed.
- `NotificationRepositoryImplTest` — extend: save/remove keyed on the new identifier form.
- New: `register() without the manifest flag fails loudly` (pins the mutual-exclusivity trap).
- New: identifier is never logged in full.

### Node / Jest (`express-api/tests/`)

- `utils/fcm.test.js` — send path against the new identifier form.
- New: an unauthenticated registration attempt is refused.
- New: registering against another user's account is refused.
- New: a banned caller's registration does not bypass the `auth.js` gates.
- New: a send to a stale identifier logs distinctly from a delivery failure.
- New: old-form identifiers are migrated or re-registered, not orphaned.

### Device — REAL Android + REAL iPhone (the only honest proof)

Per this repo's FCM rule, push requires **real proof in dev**, not a local
assertion:

1. Fresh install on each device → server push arrives.
2. **Upgrade path:** install the pre-change build, register, then upgrade
   in place → push still arrives with no user action. This is the scenario
   that fails silently and must be walked by hand.
3. Sign-out/sign-in on the same device → no cross-targeting.
4. Uninstall/reinstall → new identifier, stale one reaped.
5. Both platforms in the same release.

### Mutation proof

| Mutation | Must kill |
| -------- | --------- |
| manifest flag removed | `register() without the manifest flag fails loudly` |
| registration failure swallowed instead of retried | the retry test |
| identifier logged in full | the no-full-logging test |
| ban gate bypassed on the registration route | the banned-caller test |
| old-form identifiers left unmigrated | the migration test |

### Backend change ⇒ FULL gauntlet

Touches `express-api/src/**`; the full device + all-browser matrix runs.

## Out of Scope

- Changing notification content, categories or scheduling.
- The notification-permission UX (`core/push/**`) — untouched; the migration
  must be invisible to it.
- Migrating any other deprecated Firebase API surfaced by the same bump — if the
  BOM deprecates something unrelated, that is its own story.
- Upgrading past 34.15.0 in this story. Land the migration at a known-good BOM,
  then let Dependabot proceed.

## Dependencies

- **Blocks PR #1519** (`firebase-bom` 34.14.1 → 34.15.0) and every later BOM
  bump. #1519 stays open and failing until this merges.
- **firebase-admin** (`express-api`) may need a matching version for the server
  side to accept the new identifier form — check against PR #1520, which is
  the admin-SDK bump and is separately blocked.
- Coordinates with **[[project-phone-push-active-suppression-and-presence-file]]**
  — that behaviour must survive the cutover unchanged.
- Should NOT overlap **EPIC-0004**: registration must stay off the cold-start
  critical path.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---------- |
| **Silent fleet-wide push loss** — nothing errors, messages just stop | The upgrade-in-place device walk is mandatory, on both real devices, and is the scenario most likely to break. Old-vs-new identifier counts are queryable during rollout. |
| Client and server cut over at different times | They cannot be split: the two APIs are mutually exclusive by construction. One release, both platforms, asserted in the AC. |
| Existing users become unreachable | Explicit migration/re-registration path with its own test and mutation. |
| The identifier leaks via logs | Never logged in full, asserted, with a mutation. It is a push-targeting capability. |
| Registration lands on the cold-start critical path and undoes EPIC-0004 | Measured against a real-device baseline; stated in Dependencies. |
| Scope creeps into the notification UX | Explicitly out of scope. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] `firebase-bom` 34.15.0 compiles with `-Werror` and **zero** deprecation warnings; no `@Suppress` was added anywhere.
- [ ] **Real push proven on a real Android device AND a real iPhone in dev** — fresh install AND upgrade-in-place.
- [ ] Sign-out/sign-in and uninstall/reinstall walked on both devices.
- [ ] Backend change ⇒ FULL gauntlet green, then DEV green.
- [ ] `./gradlew :shared:compileKotlinIosArm64` passes.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] `bash scripts/pre-merge-check.sh <PR#>` emits `PRE-MERGE-CHECK: OK`.
- [ ] **PR #1519 re-run and merged green** — that is the proof this story closed the blockage.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-17** — Raised while triaging the open-PR backlog. #1519's `Build & Test` failure was diagnosed to the exact six `-Werror` deprecation errors rather than assumed to be flake.
- **2026-08-17** — The replacement API was read from the Firebase Android SDK source, not guessed. `getToken()` is deprecated in favour of `register()`, and `onNewToken` in favour of `onRegistered(String)` — which delivers the **FID, not the FCM token**. `register()` requires `firebase_messaging_installation_id_enabled=true`, and `getToken()` throws when that flag is set: mutually exclusive, so no phased client-then-server cutover is possible.
- **2026-08-17** — Surface measured, not estimated: 18 client call sites across 10 files (Android + iOS), 6 server files referencing the stored token. That is why this is L and its own story rather than something folded into a Dependabot PR.
- **2026-08-17** — Operator asked for this to be filed while #1519 stays blocked. Suppressing the warnings was considered and rejected under the repo's fix-or-upgrade-never-suppress rule.

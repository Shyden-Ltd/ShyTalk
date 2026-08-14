---
id: SHY-0291
status: Draft
owner: claude
created: 2026-08-06
priority: P2
effort: S
type: refactor
roadmap_ids: []
pr:
mvp: false
---

# SHY-0291: FCM deprecations block the firebase-bom bump, and -Werror turns them into a wall

## User Story

As someone keeping ShyTalk's dependencies current,
I want the Android app to use the FCM APIs Firebase actually supports,
So that a routine BOM bump stops being a blocked pull request.

## Why

Dependabot PR **#1519** (firebase-bom 34.14.0 → 34.15.0) fails `Build & Test`.
Not because the BOM is broken — because 34.15.0 deprecates APIs the app still
calls, and the Kotlin build runs with `-Werror`, so every deprecation warning is
a compile error:

```
e: warnings found and -Werror specified
ShyTalkMessagingService.kt:24 overrides a deprecated member but is not marked deprecated itself
ShyTalkMessagingService.kt:25 'fun onNewToken(p0: String): Unit' is deprecated
AndroidPlatformNavCallbacks.kt:38,49 'val token: Task<String!>' is deprecated
NavGraph.kt:325,653 'val token: Task<String!>' is deprecated
```

`-Werror` is doing exactly its job: the deprecation is real, and the app is on
notice. Suppressing it with `@Deprecated` or `@Suppress` would silence the only
warning we get before the API is removed outright in a later BOM — and the
repo's rule is fix or upgrade, never suppress.

This blocks a dependency the whole Firebase surface rides on, so it will block
every future BOM bump too until it is done.

## Acceptance Criteria

### Happy path

- [ ] The app compiles clean against firebase-bom 34.15.0 with `-Werror` still
      on, with no `@Suppress` and no `@Deprecated` added to silence it.
- [ ] Push tokens are still obtained and refreshed through the supported API.

### Error paths

- [ ] A token fetch that fails is handled as it is today — no new silent
      catch, no swallowed exception introduced by the migration.
- [ ] A device with no Play Services still degrades exactly as before.

### Edge cases

- [ ] Token refresh on reinstall and on app-data clear still reaches the
      backend.
- [ ] The five call sites are migrated consistently — two in
      `AndroidPlatformNavCallbacks.kt`, two in `NavGraph.kt`, one service
      override — rather than one being left on the old shape.

### Performance

- [ ] No additional main-thread work at startup; token retrieval stays
      asynchronous.

### Security

- [ ] The token is still sent only to the Express API over the existing
      authenticated route. No new sink.

### UX

- [ ] N/A — no user-visible surface changes; this is an API migration behind
      the existing push behaviour.

### i18n

- [ ] N/A — no user-facing strings.

### Observability

- [ ] Token acquisition and refresh keep their existing logging, so a failure
      after the migration is diagnosable from a device log.

## BDD Scenarios

**Scenario: A fresh install registers for push**

- **Given** ShyTalk is installed on a device with push allowed
- **When** someone opens the app for the first time
- **Then** the device receives a push token
- **And** the backend records it against that account

**Scenario: A refreshed token reaches the backend**

- **Given** the device's push token is refreshed by the system
- **When** the app next runs
- **Then** the backend holds the new token, not the old one

**Scenario: The build stays honest**

- **Given** the migration is complete
- **When** the app is built with warnings-as-errors
- **Then** it compiles with no deprecation suppressed anywhere

## Test Plan

**RED first:**

- `./gradlew :app:assembleDevRelease` against firebase-bom 34.15.0 — fails
  today with the five deprecation errors above. That IS the red.
- `app/src/test/.../PushTokenRegistrationTest.kt` — token acquisition and the
  refresh path, against the migrated API.
- A structural test asserting no `@Suppress("DEPRECATION")` and no
  `@Deprecated` appears in the five touched files, so the wall cannot be
  papered over later.

**GREEN:** migrate the five call sites.

**Device proof — REQUIRED, not optional.** Push is the one surface where a
green build proves nothing: `[[feedback-fcm-real-proof-in-dev]]` requires a
real token, a real notification delivered to a real device in dev. Both
platforms.

## Out of Scope

- firebase-admin on the backend (SHY-0292) — different SDK, different failure.
- Removing `-Werror`. It is the reason this was caught at all.
- Any change to what notifications say or when they are sent.

## Dependencies

- Dependabot PR #1519 is the trigger and stays open until this lands; the bump
  merges with it or immediately after.

## Risks & Mitigations

- **Push is easy to break silently** — a token that stops refreshing looks
  fine until someone stops receiving notifications days later. Mitigation: the
  device proof above is a hard gate, and the refresh path gets its own
  scenario rather than being assumed from the install path.
- **The deprecated API may still work**, tempting a suppression. It does work,
  today; the warning is the notice period. Suppressing converts a compile
  error now into a runtime failure at some later BOM.

## Definition of Done

- [ ] All AC met; tests written RED first.
- [ ] Real push received on a real Android device AND a real iPhone in dev.
- [ ] #1519 merges green.
- [ ] `code-reviewer` 100% clean; CI green by name; `Reviewed-up-to:` recorded.

## Notes (running log)

- **2026-08-06 10:30 WIB** — Found by bringing #1519 up to date with develop
  (it was 85 commits behind, failing on runs that predated the WebKit fix). The
  rebase cleared the stale failures and exposed this real one underneath, which
  is the point of rebasing before diagnosing.

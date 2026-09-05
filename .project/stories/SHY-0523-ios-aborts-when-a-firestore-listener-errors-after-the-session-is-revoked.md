---
id: SHY-0523
status: In Review
owner: claude
created: 2026-09-05
priority: P0
effort: S
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0006
---

# SHY-0523 — iOS aborts when a Firestore listener errors after the session is revoked

## User Story

As a learner on iPhone whose session has been revoked (a ban, a password reset,
an administrator disabling the account), I want the app to take me to sign-in
instead of vanishing, so that I understand what happened and can act on it.

## Why

- SHY-0500's J40 on the iPhone (run `local-2026-09-05T03-22-52-484Z`, head
  `bc1ee43b4ab`) drew the room list first and decided the `SESSION_EXPIRED`
  redirect correctly, then the process `exited due to SIGABRT` 218 ms later.
  The crash report `iosApp-2026-09-05-102748.ips` shows `abort()` reached from
  Kotlin/Native's `terminateWithUnhandledException` through
  `StandaloneCoroutine.handleJobException`, dispatched from a
  `FIRDocumentReference` snapshot callback.
- Disabling the account revoked the token. The four live listeners behind the
  home screen (`config/economy`, `config/moderation`, `users/<uid>`, the
  conversations query) were denied by rules (`false for 'get' @ L554`, `@ L74`,
  `false for 'list' @ L358`). gitlive's `.snapshots` closes the Flow with the
  `FirebaseFirestoreException`; a collector with no `catch` completes
  exceptionally, and on Kotlin/Native an uncaught coroutine exception aborts
  the process. Android's native listeners swallow the error, so Android passed.
- SHY-0185 fixed this class for ONE listener (`observeUserFlags`, via
  `recoverListenerErrors`) and left 17 of the 18 iOS `.snapshots` listeners
  unguarded: the instance was fixed, not the class
  ([[feedback-guard-the-class-not-the-instance]]).
- The journey runner hid the crash: the iOS driver's session recovery relaunched
  the dead app and the runner judged the second launch's first frame. That
  runner gap is fixed under SHY-0500.

## Acceptance Criteria

### Happy path

- Every iOS realtime listener goes through one guarded accessor
  (`guardedSnapshots`); a raw `.snapshots` outside that accessor fails a pin
  test.
- Values emitted before a listener error are delivered to the collector.

### Error paths

- A listener error (rules denial, network drop, revoked token) on ANY iOS
  Firestore listener completes the Flow; the app keeps running and the
  revoked-session redirect to sign-in is shown. The error never reaches the
  collector.
- A fatal `Error` (out of memory, stack overflow) is rethrown, never masked.

### Edge cases

- `CancellationException` is never swallowed: cancelling the collecting scope
  still cancels the listener and emits nothing further.
- A downstream fallback (`recoverListenerErrors` after `.map`) still composes
  after the guarded accessor; the SHY-0185 `observeUserFlags` site keeps its
  safe default.
- A listener that fails before its first value completes empty; the screen keeps
  whatever it already showed, as on Android.

### Performance

- No hot-loop retry: the listener stays down until the collector re-subscribes
  (next sign-in), the same accepted residual as SHY-0185. No extra work on the
  happy path beyond one `catch` operator per listener.

### Security

- Nothing new is read or written; a rules denial is still a denial, only no
  longer fatal to the process.

### UX

- After a revoke the learner sees the room list, then the sign-in screen with
  the session-expired notice; the app never disappears.

### i18n

- No new user-facing copy; the WARN log line is developer-facing English.

### Observability

- Each listener failure is logged once at WARN, tag `FirestoreListener`, naming
  the document or collection path (`document config/economy`) or `query`, with
  the exception attached, and marked `SHY-0523`.

## BDD Scenarios

**Scenario: Revoked session on the home screen (J40 on the iPhone)**

- **Given** adult-power is signed in on the iPhone and the app is on the room list
- **When** the account is disabled server-side and the app is cold-started
- **Then** the room list is drawn first, the sign-in screen follows with
  `SESSION_EXPIRED`, and the process is still alive (same pid, no crash report)

**Scenario: A listener error is logged and the Flow completes**

- **Given** a guarded listener Flow that has already emitted a value
- **When** the underlying listener fails with an Exception
- **Then** the collector receives the value and then completion, no exception,
  and a WARN line naming the path is logged

**Scenario: Fatal errors are not masked**

- **Given** a guarded listener Flow
- **When** the upstream throws an `Error`
- **Then** the Error propagates to the collector

**Scenario: Cancellation still propagates**

- **Given** a collector of a guarded listener Flow
- **When** its scope is cancelled
- **Then** the job is cancelled and nothing further is emitted

## Test Plan

- commonTest `ListenerFlowCompletionTest`: emits-then-errors gives the values
  and completion; a healthy flow is untouched; an `Error` is rethrown;
  cancellation propagates.
- jvmTest `IosFirestoreListenersAreGuardedPinTest`: scans `shared/src/iosMain`
  for raw `.snapshots` outside `core/util/GuardedSnapshots.kt` (must be zero),
  and anchors itself on the accessor file, the iosMain file count and at least
  one `guardedSnapshots` use so a moved directory cannot pass vacuously.
- Gates: `:shared:jvmTest :shared:compileKotlinIosArm64 :shared:ktlintCheck detekt`.
- Device: J40 plus the mandatory core set on the iPhone at the merged SHY-0500
  head, local first and then dev; pull the phone's log archive for the window
  and confirm no `SIGABRT` and no iosApp crash report.

## Out of Scope

- Android's native listeners swallow the error silently, without a log line;
  parity logging is a separate chore.
- Retrying a failed listener; EPIC-0006 moves these reads behind the API.
- The journey runner's crash detection (fixed under SHY-0500).

## Dependencies

- None to merge. SHY-0500's iPhone proof depends on this fix: its branch merges
  this branch in until this story lands on `develop` first.

## Risks & Mitigations

- Risk: a guarded Flow completes quietly and a screen keeps stale data.
  Mitigation: the WARN log names the path, and the behaviour matches Android
  today.
- Risk: masking a programming error inside a `.map`. Mitigation: the guard wraps
  only the listener itself, so `map` errors still surface, and an `Error` always
  propagates.

## Definition of Done

- [ ] Merged to `develop`, all checks green, deployed to dev.
- [ ] J40 and the core set green on the iPhone at the merged head, local then
      dev, with no iosApp crash report in the run window; evidence page linked
      in Notes.
- [ ] Pin test and unit tests run in CI.

## Notes

- 2026-09-05 10:50 WIB — **Filed** from the SHY-0500 iPhone J40 crash analysis:
  crash report `iosApp-2026-09-05-102748.ips`, launchd `exited due to SIGABRT`
  at 10:27:47.047, 218 ms after `Redirect(screen=SignIn, reason=SESSION_EXPIRED)`.

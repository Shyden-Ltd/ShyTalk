---
id: SHY-0497
status: In Review
owner: claude
created: 2026-08-30
priority: P2
effort: M
type: bug
roadmap_ids: []
---

# SHY-0497: The app returns to Home after sign-out has reached the SignIn screen

## User Story

As **somebody who has just signed out**,
I want **to stay signed out**,
So that **I am not put back into my account, on a device I may have just handed to somebody else**.

## Why

Observed on dev, 2026-08-30, driving J12 on the OnePlus. The sequence:

1. `ensureAtSignIn` signs out and **reaches the SignIn screen** — the step
   passes.
2. The very next step finds the app on **Home**, fully signed in, with the room
   list, all three tabs and the create-room button on screen:

   ```
   SignIn not reached within 27133ms; screen showed:
   com.shyden.shytalk.dev:id/action_bar_root, android:id/content,
   roomList_emptyState, main_roomsTab, main_messagesTab, main_profileTab,
   main_createRoomFab
   ```

Nothing in the walk navigates back to Home. The app returned there on its own,
after sign-out had already landed on SignIn.

The likely mechanism is a **persisted session being restored** after the
sign-out navigation — a cold-start/session-restore path racing the sign-out it
should be observing. That is a guess and the story must confirm it before any
fix, the way SHY-0494's guess turned out to be wrong.

**Why it matters beyond the tests:** if a real person signs out and the app
puts them back in, the next person holding that phone is inside somebody else's
account. On a platform with a minor cohort that is a safeguarding problem, not
a UX one. It is also the second finding in a week in this area — SHY-0494 was
sign-out failing to release the push identifier.

Found because SHY-0495 took J12 off the skip list, so it ran on dev for the
first time. A journey that never runs cannot report anything.

## Acceptance Criteria

### Happy path

- [ ] After signing out, the app stays on the sign-in screen until somebody signs in again.
- [ ] Signing out and immediately signing in as a DIFFERENT person lands in that person's account, never the previous one.

### Error paths

- [ ] A session-restore that fails does not leave the app on a blank or half-signed-in screen.
- [ ] Losing the network during sign-out does not leave the person signed in without saying so.

### Edge cases

- [ ] Sign-out during a cold start (restore in flight) still ends signed out.
- [ ] Backgrounding the app immediately after signing out and returning still shows the sign-in screen.
- [ ] Repeated sign-out/sign-in cycles do not accumulate state from earlier sessions.

### Security

- [ ] No screen reachable after sign-out reads data belonging to the person who signed out.
- [ ] The restored session is not re-established from a credential that sign-out should have cleared.

### Performance

- [ ] Sign-out remains prompt; the fix must not add a visible wait.

### Observability

- [ ] A session restore that is CANCELLED by a sign-out is logged, so this race is diagnosable from a device log rather than by watching the screen.

### UX

- [ ] No new dialog or interstitial; the person simply stays signed out.

### i18n

- N/A — no strings change.

## BDD Scenarios

**Scenario: signing out keeps you signed out**
- **Given** somebody signs out
- **When** the sign-in screen appears
- **Then** the app stays there

**Scenario: the next person gets their own account**
- **Given** somebody signed out on a shared phone
- **When** a different person signs in
- **Then** they see their own account

**Scenario: signing out during a cold start still signs you out**
- **Given** the app is restoring a session at launch
- **When** the person signs out
- **Then** the app finishes on the sign-in screen

## Test Plan

**Classification: FULL protocol.** App runtime, and the failure is a
safeguarding one.

### Red (must fail first)

- A device journey that signs out and then asserts the app is STILL on sign-in a few seconds later — RED today.
- A unit test around the session-restore path: a restore that completes after a sign-out must not re-establish the session.

### Green

- Full matrix on a real Android device AND a real iPhone, local then dev.
- J12 passes on dev without a picker failure.

### Mutation proof

- Remove the sign-out's cancellation of an in-flight restore → the unit test fails.

## Out of Scope

- The journey runner's timeouts and dialog handling. SHY-0495 covered those, and this reproduces with them all working.
- Push identifier release on sign-out — that is SHY-0494, already fixed.

## Dependencies

- Surfaced by **SHY-0495**, which made J12 run on dev.
- Real devices and dev Firebase.

## Risks & Mitigations

- **Risk: the guessed cause is wrong**, as SHY-0494's was. **Mitigation:** the story requires confirming the mechanism on a device before any fix; the first task is instrumentation, not a change.
- **Risk: cancelling a restore too aggressively breaks ordinary cold start.** **Mitigation:** cold-start-without-sign-out is an explicit AC.

## Definition of Done

- [ ] Mechanism confirmed on a device before any fix is written.
- [ ] Proven on a real Android device and a real iPhone, local then dev.
- [ ] Full pre-merge gauntlet green.
- [ ] Status flipped to `In Review` before merge; `released_in:` set at release.

## Notes (running log)

- **2026-08-30** — Found while proving SHY-0495's third slice. The picker budget
  and dialog handling were both working by then: the modal cleared, and the
  dump showed a complete Home screen rather than the covered-window signature.
  So this is not a test-harness problem.

- 2026-09-01 — **The guess in Why is wrong, and the story said to confirm it first.** Nothing is restored. The sign-out has simply not happened yet. `onSignOut` launched `authRepository.signOut()` on a process-scoped coroutine and RETURNED; the nav graph navigated to `Screen.SignIn` on the next line; `SignInScreen` composed a fresh `AuthViewModel` whose `init` asks `authRepository.isAuthenticated` — which is `auth.currentUser != null` and was still non-null; `init` set `isAuthenticated = true`, and the auth gate left for Main. That also explains why the earlier investigation kept finding a CLEAN sign-out: by the time anything looked, it had finished.
- 2026-09-01 — **`SignOutCoordinator` was already right.** Its `signOut` parameter is `suspend () -> Unit`, so it can be awaited. Both nav graphs subverted it by passing a lambda whose body was a `() -> Unit` that launched and returned — the coordinator awaited a function that finished instantly without signing anybody out. The fix is a type, not new machinery: `onSignOut` is `suspend () -> Unit` in both graphs, and `MainActivity` joins the process-scoped job. Process scoping stays — the sign-out must still outlive the Activity the navigation destroys — it just has to be waited for too. The ban-screen binding is deliberately NOT joined and says so: it signs out and stays put, so nothing races it.
- 2026-09-01 — **Acceptance criteria need a second look, and are deliberately left unticked.** Several were written around the session-restore hypothesis and do not describe anything that exists: *"the restored session is not re-established from a credential that sign-out should have cleared"* and *"a session restore that is CANCELLED by a sign-out is logged"* both presuppose a restore. There is none. The remaining criteria are behavioural and need device proof, which is deferred. Rewriting them to match the fix would be moving the goalposts, so they stand as written for the operator to revise.
- 2026-09-01 — Tests. `SignOutCoordinatorTest` gains a behavioural one: `signOut()` must not return until its lambda has completed, which is exactly the contract the callers broke. `SignOutOrderingGuardTest` pins the signatures, because the signature IS the fix and a signature is what a later refactor reverts quietly; it anchors on the navigation still being present, so it cannot pass while guarding a sequence that moved. Mutation-proven: deleting `signOutJob.join()` turns it red.
- 2026-09-01 — **Device proof is owed.** This was found on a device and should be closed on one: sign out on the OnePlus, confirm the app stays on sign-in, then sign in as a different persona and confirm whose account opens. Deferred with the rest of the device work.
- 2026-09-01 — Gate: `:app:testDevDebugUnitTest` 2269/0, `:shared:jvmTest` 1745/0, `:app:compileDevDebugAndroidTestKotlin` green, `:shared:compileKotlinIosArm64` green, `detekt` + `ktlintCheck` clean.

Reviewed-up-to: b16bd3004bf

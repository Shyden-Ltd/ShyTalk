---
id: SHY-0442
status: Draft
owner: claude
created: 2026-08-23
priority: P1
effort: M
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0442: The app says it cannot connect, then works when reopened

## User Story

As **somebody opening ShyTalk**, I want it to reach our servers on the first
try, so that my first impression is not an error screen telling me to check my
own internet.

## Why

Observed on the real iPhone on 2026-08-22, from the J38 recording and the
runner's own dumps.

For the **first ~20 seconds after launch** the app showed a full-screen:

> **Unable to Connect**
> ShyTalk is having trouble reaching our servers. Please check your internet
> connection and try again.
> [ Retry ]

Twenty-one consecutive dumps, no taps attempted. The walk recovered only
because its first `settle` is allowed to fail, so it force-stopped and
relaunched — and on the second launch the app connected immediately and the
journey ran clean.

**A real person does not force-stop and relaunch.** They read "check your
internet connection", believe us, and go and look at their wifi.

### The server was reachable the whole time

This was not the network. In the same session the API answered normally, the
walk went on to sign in, raise tickets and upload attachments against that same
stack, and an earlier check drove the phone's own Safari to the API's health
endpoint successfully. The app failed to reach a server that was up.

### Nothing noticed

No assertion registers this. The twenty seconds are absorbed into step 2's
duration, and the report shows a passing step. It also explains a screenshot
the operator queried: step 1's frame shows this error screen, because step 1 is
an API-only seeding step whose screenshot happens to catch whatever the phone
is showing — which was this.

### Why P1

- It is the **first thing** somebody sees, and it blames them.
- It self-heals on relaunch, which is exactly the shape that gets dismissed as
  "works on my machine" and never investigated.
- We have no idea how often it happens in the wild, because nothing measures it.

## Cause, confirmed in the code

`AuthViewModel.handleBackendError(errorMessage)` classifies the failure. If the
message looks like an auth problem — "Not authenticated", "Token refresh",
`INVALID_REFRESH_TOKEN`, `UNAUTHENTICATED`, or a 401 — it clears the session and
routes to sign-in. **Otherwise:**

```kotlin
} else {
    _uiState.update { it.copy(isLoading = false, isBackendUnreachable = true) }
}
```

`SignInScreen` renders the full-screen "Unable to Connect" whenever
`isBackendUnreachable` is set.

So **any single non-auth failure puts the app into the error state**. There is no
retry before it: `retryConnection()` exists, but only behind the Retry button a
person has to press. One transient failure on the very first call — a connection
reset before the network is fully up after launch — produces exactly what was
filmed: a full-screen error, for as long as nobody presses Retry, on a stack that
is up and answering.

That also explains why a relaunch fixes it. The second launch's first call
succeeds, so the state is never entered.

### What is still open

- Whether the first call is made before connectivity is ready, or whether it
  simply lost a race. Either way the handling is the same.
- Whether Retry recovers reliably, or leaves other state stale.
- How often real people hit this. Nothing measures it.

## Acceptance Criteria

### Happy path

- [ ] A cold start against a reachable server reaches sign-in or home without
      showing an error.
- [ ] A transient first-call failure is retried, bounded, before anything is
      shown to the person.
- [ ] Only a failure that survives those retries reaches the error screen.

### Error paths

- [ ] When the server genuinely cannot be reached, the message is still shown —
      this must not become a silent hang.
- [ ] Retry genuinely retries and can succeed without a restart.
- [ ] The copy does not assert the fault is the person's connection unless we
      have reason to believe it is.

### Edge cases

- [ ] Holds on a slow network where the first call takes several seconds.
- [ ] Holds when the app is launched with no network and network arrives
      afterwards — it should recover without a restart.
- [ ] Holds on both platforms; the recording is from iOS but nothing suggests
      the cause is iOS-only.
- [ ] Holds on a cold start after install, which is when it was seen.

### Performance

- [ ] Retries are bounded and do not delay a successful start.

### Security

- [ ] No change.

### UX

- [ ] Somebody who waits a moment sees the app work, not an error that outlives
      the problem.

### i18n

- [ ] Any copy change is translated for all five MVP locales.

### Observability

- [ ] Reaching this screen is recorded, with whether a retry then succeeded. We
      currently cannot tell how often this happens to real people.

## BDD Scenarios

**Scenario: Opening the app**

- **Given** somebody opening ShyTalk with a working connection
- **When** the app starts
- **Then** they reach the app, without being told to check their internet

**Scenario: A blip on the first try**

- **Given** somebody whose very first request fails momentarily
- **When** the app tries again
- **Then** it carries on, and they never see an error

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | A single failed first call does not put the app into the unreachable state; a sustained failure does. |
| Unit | Retry re-attempts and can leave the state. |
| Device | Twenty cold starts on each phone against a healthy stack show the error zero times. |
| Device | With the stack stopped, the error IS shown, and Retry recovers once it is back — without a restart. |
| Journey | A walk that hits this screen fails rather than absorbing it into a step's duration. |

## Out of Scope

- The runner's tolerance of a failed first settle. That is what let the walk
  recover, and it is reasonable behaviour for a test harness — but it should
  REPORT the screen rather than pass through it silently, which belongs with
  SHY-0441.

## Dependencies

- None known until the cause is established.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Adding retries hides a real outage behind a spinner | The error still appears for a sustained failure; only the first transient one is absorbed. |
| It is dismissed as a local-stack artefact | Twenty cold starts on a healthy stack is the acceptance bar; if it never reproduces there, that is a real answer and the ticket says so. |
| It is intermittent and hard to catch | Observability first — we cannot currently tell whether real people see this at all. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Twenty cold starts on each real device against a healthy stack, no error.
- [ ] The genuine-outage path still shows the message and recovers on Retry.

## Notes

- Found on 2026-08-22 while verifying the locator work on the iPhone. It is
  visible in the first twenty seconds of
  `journey-results-ios/runs/local-2026-08-22T16-39-17-015Z/walk-ios-*.mp4`.
- The operator asked earlier how a step could be a "pass" while its screenshot
  showed "Unable to Connect". The screenshot belonged to an API-only step and
  was not evidence of it — but the error screen it caught was real, and this is
  it.

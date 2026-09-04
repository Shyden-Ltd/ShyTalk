---
id: SHY-0515
status: Draft
owner: unassigned
created: 2026-09-04
priority: P2
effort: M
type: feature
roadmap_ids: []
mvp: false
epic: EPIC-0004
---

# SHY-0515: An offline cold start confirms the session when the network returns

## User Story

As **ShyTalk**, I want a session that was drawn from cache because the phone
was offline to be confirmed with the server the moment the network returns,
so that a ban or a dead session is applied within seconds of being reachable,
not at the next cold start.

## Why

SHY-0500 draws the room list instantly and then confirms the session in the
background (`ColdStartSequencer.confirm()`). When the confirmation fails for
transport reasons — offline, DNS, a dropped connection — the sequencer answers
*Stay* (`ColdStartSequencer.kt:152-160`: "the session survives, so the failure
was transport"), releases the claim gate so cached reads proceed, and never
asks again. The next confirmation is the next cold start.

That is the right first answer: an offline phone must not be logged out or
shown a ban screen for lack of signal. But it leaves a window with no closing
edge. A person whose ban landed while they were on a plane keeps their cached
room list, and the app's own state, until they restart it — even though every
request they make once online is refused by the server (`checkUserBans` on
each authenticated call). The server is safe; the client is stale, and the
person sees generic failures instead of the ban screen SHY-0149 built.

Recorded as a follow-up in SHY-0500's review (2026-09-04) and deliberately left
out of it: it needs a connectivity signal the app does not yet have.

## Acceptance Criteria

### Happy path

- [ ] A small `ConnectivityObserver` (expect in `commonMain`; Android actual on
      `ConnectivityManager.NetworkCallback`, iOS actual on `NWPathMonitor`)
      exposes `isOnline: StateFlow<Boolean>`.
- [ ] When `confirm()` answered *Stay* for a transport failure, the host
      subscribes once: on the first offline → online edge it calls `confirm()`
      again and applies the verdict exactly as the cold-start path does — a
      *Redirect* navigates with the back stack cleared and the claim gate
      settled by the host; a *Stay* does nothing further.
- [ ] The re-confirmation runs at most once per cold start; a confirmed
      session (a *Stay* from a real answer) never subscribes at all.

### Error paths

- [ ] The re-confirmation fails for transport again: stay subscribed, try on
      the next edge; no error is shown.
- [ ] The re-confirmation throws: the failure is logged with its class and the
      app stays as drawn — fail closed for the gate is not needed here because
      the gate is already settled; the log line is the evidence.

### Edge cases

- [ ] Network flapping (online for 200 ms then offline) does not start two
      confirmations: the call is guarded by a mutex and the edge is debounced
      to one second.
- [ ] The app in the background when the network returns: the confirmation
      runs on the next foreground (`ON_START`) instead — no work while
      backgrounded.
- [ ] The person signs out before the network returns: the subscription is
      cancelled with the session.
- [ ] A cold start that was online but whose confirmation timed out is treated
      as a transport failure (it is one).

### Performance

- [ ] No polling: the observer is callback-driven on both platforms. The
      re-confirmation is the same single request as the cold-start one.

### Security

- [ ] The verdict path is the existing one (`confirm()`), so bans and dead
      sessions are enforced by the same code the cold start uses; nothing is
      re-implemented.

### UX

- [ ] A person who was banned while offline sees the ban screen within five
      seconds of regaining signal, not a string of failed requests.

### i18n

- [ ] N/A — no new strings; the ban and session-expired screens already exist
      in all locales.

### Observability

- [ ] Log lines: `coldstart:reconfirm scheduled` when a transport *Stay* is
      drawn, `coldstart:reconfirm ran verdict=<Stay|Redirect>` when it runs —
      public `os_log` on iOS so the journey log shows them.

## BDD Scenarios

**Scenario: A ban that landed while offline is applied when signal returns**

- **Given** somebody banned while their phone was in airplane mode who then opens the app
- **When** airplane mode is switched off
- **Then** within a few seconds they see the ban screen

**Scenario: A healthy session is left alone**

- **Given** somebody who opened the app offline and whose account is in good standing
- **When** the network returns
- **Then** nothing changes on screen

**Scenario: Flapping signal does not cause repeated checks**

- **Given** somebody whose connection drops and returns several times a second
- **When** it finally settles
- **Then** the session is confirmed once

**Scenario: A session confirmed online never re-checks**

- **Given** somebody who opened the app online and was confirmed
- **When** their connection later drops and returns
- **Then** no extra confirmation happens

## Test Plan

### Red

- `shared/src/jvmTest/.../ColdStartReconfirmOnReconnectTest.kt` — with a fake
  `ConnectivityObserver` flow: transport-Stay subscribes; edge triggers one
  `confirm()`; flapping triggers one; real Stay never subscribes; Redirect
  navigates and settles the gate through the host callback.
- `J41` journey on both phones: airplane mode on, cold start, disable the
  account through the Auth-emulator lever J40 uses, airplane mode off, assert
  the ban or session-ended screen and the two log lines.

### Green

- Observer actuals, host wiring in `MainActivity` and `MainViewController`,
  log lines.

## Out of Scope

- Refreshing cached room data on reconnect — the existing listeners do that.
- Any change to what `confirm()` decides.

## Dependencies

- SHY-0500 (PR #2129) merged: this builds on its sequencer and claim gate.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The observer leaks a callback across configuration changes | Registered in a lifecycle-aware scope; the test asserts unregister on cancel. |
| A false "online" edge with no real route | The confirmation simply fails transport again and waits for the next edge. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Device-proven on both phones with J41; evidence page signed off.

## Notes

- **2026-09-04** — Filed as a SHY-0500 follow-up, from that story's review
  record (rounds 10–11 raised "offline Stay removes ordering"; the answer was
  that the gate must release on a transport Stay, and the missing piece is this
  closing edge).

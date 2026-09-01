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
      session, App-Lock).

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

Reviewed-up-to: afd502187d7

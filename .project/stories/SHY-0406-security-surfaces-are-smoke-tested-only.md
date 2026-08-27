---
id: SHY-0406
status: Draft
owner: unassigned
created: 2026-08-21
priority: P0
effort: M
type: chore
roadmap_ids: []
mvp: true
---

# SHY-0406: App lock and linked accounts are proven to render, not to work

## User Story

As **somebody who turned on App Lock because my phone gets picked up by other
people**, I want that lock to have been tested by someone actually leaving and
coming back, so that it is known to lock and not merely known to have a toggle.

## Why

The audit found these surfaces covered only by render assertions.

**App Lock — 5 steps, all about the toggle:**

```gherkin
Then I should see the element with tag "appLockToggle"
Then I should see the text "App Lock"
When I tap the element with tag "appLockToggle"
```

Nothing backgrounds the app and comes back. **The entire purpose of App Lock —
that leaving and returning demands credentials — is unwalked.** A regression that
left the app unlocked on return would pass every one of these.

**Linked accounts — 4 scenarios, all render:** providers listed, Unlink buttons
visible, tapping Unlink shows a dialog, the page shows a unique ID. **Nobody ever
completes an unlink.** Unlinking is how somebody removes a sign-in route from
their account; getting it wrong either locks them out permanently or leaves a
route they believe they removed.

**PIN — `lock_screen` does better:** wrong PIN errors, correct PIN unlocks,
lockout after five failures. That is the standard the other two should meet.

App Lock is also being redesigned onto the device OS credential ([[SHY-0196]]),
which makes an unwalked baseline worse: there is nothing to regress against.

## Acceptance Criteria

### Happy path

- [ ] With App Lock on, leaving the app and returning demands credentials.
- [ ] Providing them returns the person to where they were.
- [ ] With App Lock off, returning does not demand anything.
- [ ] Unlinking a provider removes it, and the remaining providers still sign in.

### Error paths

- [ ] Failing the App Lock credential does not reveal the screen behind it.
- [ ] Cancelling the credential prompt leaves the app locked, not open.
- [ ] Unlinking the **last** remaining provider is refused with a reason — this
      is the one that locks somebody out forever.
- [ ] A failed unlink leaves the provider linked, not in a half state.

### Edge cases

- [ ] The timeout boundary — returning just before it does not lock; just after
      does. Both walked, because a lock that never triggers and a lock that
      always triggers both "pass" a single-sided test.
- [ ] Force-killing and relaunching locks.
- [ ] App Lock plus a PIN configured — the interaction is defined and walked.
- [ ] Rotating the device while locked does not reveal the screen behind.
- [ ] Screenshot/recents preview does not show content while locked.
- [ ] Walked on real Android **and** real iPhone. The OS credential path differs
      per platform, so one platform proves nothing about the other.

### Performance

- [ ] Unlocking is prompt enough not to feel broken.

### Security

- [ ] A deeplink into a screen while locked lands on the lock, not the screen.
- [ ] A push notification tapped while locked lands on the lock first.
- [ ] Unlinking another account's provider is refused.
- [ ] The lock cannot be bypassed by back-press or relaunch — the same pin
      `j10` already applies to the warning screen.

### UX

- [ ] The lock explains what it wants and offers a way forward.

### i18n

- [ ] Lock and unlink copy asserted on rendered text in a non-English locale.

### Observability

- [ ] An unlink is auditable — which provider, when.

## BDD Scenarios

**Scenario: Coming back to a locked app**

- **Given** somebody with App Lock switched on
- **When** they leave the app and return after the timeout
- **Then** they are asked for their credentials before seeing anything

**Scenario: The screen behind stays hidden**

- **Given** somebody facing the lock
- **When** they fail the credential
- **Then** they still cannot see the screen behind it

**Scenario: Just inside the timeout**

- **Given** somebody with App Lock switched on
- **When** they return before the timeout has passed
- **Then** they are not asked for anything

**Scenario: A notification cannot open a locked app**

- **Given** somebody with a locked app and a new message notification
- **When** they tap the notification
- **Then** they reach the lock, not the message

**Scenario: Removing a sign-in route**

- **Given** somebody with two sign-in providers linked
- **When** they unlink one
- **Then** it is gone and the other still signs them in

**Scenario: The last route cannot be removed**

- **Given** somebody with only one sign-in provider
- **When** they try to unlink it
- **Then** they are refused and told why

## Test Plan

| Layer | What it proves |
| --- | --- |
| **Journey, both devices** | Background and return, for real, on both platforms — the OS credential path is platform-specific and cannot be inferred. |
| Boundary | Both sides of the timeout, because a lock that always fires and one that never fires each pass a one-sided test. |
| Leak | Recents preview, rotation, deeplink and notification tap each asserted not to reveal content. |
| Unlink | Completed unlink asserted by SIGNING IN again with the remaining provider — the only proof that matters. |
| Refusal | Last-provider unlink refused, cross-account unlink refused, each its own scenario. |

## Out of Scope

- Building [[SHY-0196]]'s redesign. This is the baseline it will be measured
  against, and should land first or alongside.

## Dependencies

- A journey step for backgrounding and restoring the app, and for satisfying or
  cancelling an OS credential prompt, on each platform.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The lock is tested by toggling it, which is what happens today | Every AC is phrased as leaving and returning; no assertion is about the toggle. |
| One platform is walked and the other assumed | Both required; the OS credential differs per platform. |
| "Locked" is asserted by seeing the lock, not by failing to see the content | Leak scenarios assert the ABSENCE of the underlying screen. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Walked on a real Android device and a real iPhone.

## Notes

- Found 2026-08-21 in the deeper journey audit. `lock_screen`'s PIN coverage
  (wrong PIN, correct PIN, lockout after five) is the model — it walks behaviour,
  not widgets.

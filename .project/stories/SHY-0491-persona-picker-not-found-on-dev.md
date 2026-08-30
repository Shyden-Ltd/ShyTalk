---
id: SHY-0491
status: In Review
owner: unassigned
created: 2026-08-28
priority: P2
effort: S
type: bug
roadmap_ids: []
mvp: false
epic: EPIC-0003
---

# SHY-0491: The persona picker is sometimes gone by the time dev tries to tap it

## User Story

As **whoever reads a dev journey report**, I want a missing control to mean the
app is wrong, so that a slow environment does not look like a defect.

## Why

On the first full dev matrix run, **J-ALICE** failed with:

```
tap target #persona_picker_open not found on screen
```

Every other persona journey in the same run signed in successfully, including
ones using the same account. So the control exists and usually appears — it was
simply not there at the moment this journey looked.

The likely mechanism is already documented in the runner, for the iPhone:

> Signing out is a network round trip and a navigation … the symptom was a
> perfectly ALTERNATING matrix: a journey that succeeded left the app on Home,
> the next one's sign-out timed out and failed, that sign-out then completed
> anyway, and the journey after it passed.

That timeout was raised to 45s **for Android on local**. Dev is a real network
rather than a loopback, so the same round trip is slower and the same race is
plausible.

Not yet proven — which is why this is Draft and P2 rather than a fix.

## Acceptance Criteria

### Happy path

- [ ] The persona journeys pass on dev across consecutive runs.

### Error paths

- [ ] A genuinely missing picker still fails — the wait is not turned into a
      blanket retry that hides a real absence.

### Edge cases

- [ ] The failure distinguishes "never appeared" from "appeared then went",
      because those have different causes.

### Performance

- [ ] Any added wait is condition-based and exits the moment the control
      appears; no fixed sleep (the repo forbids them).

### Security

- [ ] None.

### UX

- [ ] None.

### i18n

- [ ] None.

### Observability

- [ ] The failure records what WAS on screen, as it already does, and how long
      it waited.

## BDD Scenarios

**Scenario: Signing in on a slower connection**

- **Given** somebody on a slower connection
- **When** they go to sign in
- **Then** the sign-in choices are there when they arrive

## Test Plan

| Layer | What it proves |
| --- | --- |
| Device (real, dev) | Three consecutive dev runs with no picker failure. |
| Device (real, local) | The local matrix still passes 15/15. |
| Mutation | Removing the picker entirely still fails the journey. |

## Out of Scope

- The skipped journeys (SHY-0488) and the local-only product (SHY-0490).

## Dependencies

- Needs SHY-0488, without which the dev leg does not run far enough to see this.

## Risks & Mitigations

- **Risk:** treated as flake and retried away, hiding a real regression.
  **Mitigation:** an AC and a mutation check require a genuinely absent picker
  to still fail.

## Definition of Done

- [ ] Three consecutive clean dev runs.
- [ ] A missing picker still fails.

## Notes

One occurrence so far. Filed to be counted rather than fixed on a single
sighting — if it does not recur across the next few dev runs, it should be
cancelled rather than chased.

- **2026-08-30 — root cause found, and it is not the sign-out timeout.**

  The story guessed a slow sign-out on dev left the app mid-navigation, which
  is *half* right — but the defect is that `openPersonaPicker` never waited for
  the button at all:

  ```js
  for (let attempt = 1; ; attempt++) {
    await tapId(device, 'persona_picker_open');   // no wait, ever
  ```

  `tapId` throws `tap target #persona_picker_open not found on screen` when the
  control is absent, which is verbatim what J-ALICE reported.

  The retry loop *looks* like it covers this. It does not: after a failed
  attempt it breaks out **precisely when the button is absent**. That guard is
  correct for a swallowed tap and wrong for a screen that has not arrived yet,
  so the one case it needed to survive is the one it exits on.

  **Why dev and never local:** sign-out is a network round trip. On loopback it
  completes inside the walk's own latency; on dev's real network it does not.
  The runner already documents this exact race for the iPhone and raised a
  timeout for it — this is the same race, one screen earlier.

  Fixed by waiting for `persona_picker_open` to exist before each tap, bounded
  by the same deadline. Reproduced first in a unit test with a phone that is
  mid-navigation rather than broken; it failed with the production message.
  Mutation-tested: removing the wait re-fails that test.

- **2026-08-30 — DEVICE-PROVEN on dev.** J-ALICE's `Pick persona
  adult-power@shytalk.dev` step, which failed on every previous dev run with
  `tap target #persona_picker_open not found on screen`, **passed**.

  The run also shows the trigger plainly: `Reach SignIn (for
  adult-power@shytalk.dev) ... ✓ (60.4s)`. Sixty seconds for a sign-out is
  exactly the window in which the old code tapped a button that was not yet on
  screen.

  Matrix result: **8/8 on dev** — up from 6/8, then 7/8. First fully green dev
  run.

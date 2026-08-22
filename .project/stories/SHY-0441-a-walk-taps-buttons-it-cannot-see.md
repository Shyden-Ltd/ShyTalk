---
id: SHY-0441
status: Draft
owner: claude
created: 2026-08-23
priority: P1
effort: M
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0441: The walk taps buttons it cannot see

## User Story

As **whoever reads a green journey report**, I want a step that "tapped Send" to
mean a person could have tapped Send, so that a button hidden behind the keyboard
is a failure rather than a pass.

## Why

Observed on the real iPhone on 2026-08-22, at t≈67s of the J38 recording: **the
Send button is completely hidden behind the keyboard while typing.** A second
later the keyboard drops and it reappears.

The walk never noticed. `tapIdScrolling` checks that the node is PRESENT IN THE
TREE. An occluded button is still in the tree — it has an id, sane bounds, and
reports as enabled — so the walk clicks it and moves on.

### Why this is P1 rather than a nicety

**SHY-0419 was exactly "the Send button is under the keyboard on iPhone".**

That defect cost three separate readings to fix, shipped twice, and was
ultimately caught by a human looking at the screen. The journey written to prove
it stays fixed **cannot detect it**. If SHY-0419 regressed tomorrow, J38 would go
green.

SHY-0428 is the same class from the other side: Send drawn under the Android
navigation bar, its tappable centre landing on HOME. Also invisible to
assertions, also caught by eye.

So this is the third instance of one pattern: *the element is findable, and
that is not the same as reachable.* Every green step that taps a control is
currently making a claim it has not checked.

### It is also the operator's original complaint

> "leading you to click the wrong things, see a result and assume it's passed"

An occluded tap is precisely that. The element route (SHY-0428's locator work)
does not help here — Appium clicks the element's centre, and if something covers
it, the tap lands on the overlay. Locating correctly and being reachable are
different properties.

## What "reachable" means, per platform

- **iOS / XCUITest** exposes `visible` in the source tree, and `hittable` —
  which is the exact question: would a tap at this element's point reach this
  element?
- **Android / uiautomator** reports bounds and `clickable`, but the tree does not
  say what is on top. The check has to be geometric: is the element's centre
  inside the bounds of a later-drawn sibling — the keyboard, a dialog, a system
  bar.

Both must be checked before the tap, and a failure must name what was in the
way.

## Acceptance Criteria

### Happy path

- [ ] A tap on a fully visible control behaves exactly as it does today.
- [ ] A step that taps a control asserts the control was reachable at the moment
      of the tap.

### Error paths

- [ ] Tapping a control covered by the keyboard FAILS, naming the keyboard.
- [ ] Tapping a control covered by a dialog or system bar FAILS, naming it.
- [ ] The failure includes the covering element's bounds, so the frame can be
      read without re-running.

### Edge cases

- [ ] A control PARTLY covered — the SHY-0428 case, where the lower half was
      under the navigation bar — fails, because the tappable centre is what
      matters.
- [ ] A control that is off-screen and needs scrolling is scrolled to, as today,
      and then checked.
- [ ] A control behind a transparent but tap-absorbing overlay fails.
- [ ] Deliberate taps on empty space, used to dismiss, are not treated as
      occluded.

### Performance

- [ ] The check reuses the dump the tap already takes; no extra round trip per
      tap on iOS, where `hittable` is already in the source.

### Security

- [ ] No change.

### UX

- [ ] No product change. This is test infrastructure.

### i18n

- [ ] No change.

### Observability

- [ ] A step that fails on occlusion says so distinctly, so it is never confused
      with "element not found".

## BDD Scenarios

**Scenario: A button nobody could press**

- **Given** a walk that reaches a screen where the keyboard covers Send
- **When** it tries to press Send
- **Then** the step fails, saying the keyboard was in the way

**Scenario: An ordinary tap**

- **Given** a walk on a screen where the button is plainly visible
- **When** it presses the button
- **Then** it behaves exactly as before

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | Given a tree where the target's centre falls inside a later sibling's bounds, the reachability check fails and names it. |
| Mutation | With the check removed, a fixture reproducing SHY-0419's geometry passes — proving the check is what catches it. |
| Regression | A fixture built from the ACTUAL SHY-0419 and SHY-0428 screens fails without their fixes and passes with them. |
| Device | Both phones: the existing journeys still pass, and a deliberately occluded build fails. |

## Out of Scope

- Changing any product screen. If this surfaces a real occlusion, that is a
  separate defect with its own ticket.
- Visual diffing or screenshot comparison. This is a geometry and accessibility
  question, not an image one.

## Dependencies

- Builds on the locator work: taps already resolve elements, so the reachability
  check has an element to ask about.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The check is too strict and reddens healthy walks | Introduced as a hard failure only after a run across every journey on both devices confirms it is quiet on healthy screens. |
| Android geometry gives false positives from decorative overlays | Only elements that ABSORB taps count as covering; asserted with fixtures from real dumps. |
| It is added and the journeys are not re-run, so nobody learns whether it holds | The Definition of Done requires a full matrix run on both phones. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Mutation-proven: removing the check lets an SHY-0419-shaped fixture pass.
- [ ] A full journey run on both real devices, green, with the check live.

## Notes

- Found by the iOS device agent on 2026-08-22 while verifying the locator work,
  from the recording rather than from any assertion — which is itself the point.
- The honest summary: **every green "tapped X" step in every journey today is an
  unverified claim that X was reachable.** This ticket converts it into a checked
  one.

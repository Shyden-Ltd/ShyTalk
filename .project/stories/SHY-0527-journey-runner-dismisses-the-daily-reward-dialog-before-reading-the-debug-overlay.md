---
id: SHY-0527
status: Draft
owner: claude
created: 2026-09-06
priority: P1
effort: S
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0527 — Journey runner dismisses the daily-reward dialog before it reads the debug overlay

## User Story

As **the operator proving a build with persona journeys on real phones**, I
want the runner to close the daily-reward calendar before it confirms which
account the phone is signed in as, so that a journey never fails on a
first-of-the-day sheet that hides the debug overlay it needs to read.

## Why

- The SHY-0500 dev proof on Android (run `dev-2026-09-06T02-52-39-583Z`)
  failed J08 in its preamble step "Confirm the phone is signed in as
  50000040" with "the debug overlay is not showing an account id". The
  screen dump held only `android:id/content`, `dailyReward_dialog` and
  `dailyReward_claimButton`: while a dialog window is up, uiautomator
  reports that window alone, so the debug overlay in the main window is
  invisible to the reader.
- The runner already knows the sheet (`HOME_OVERLAY_IDS` in
  `device-journey-runner.js`) and lets "Land on Home" pass with it up, but
  no step ever closes it, so every later dump-reading step inherits the
  problem.
- Nothing can close it deterministically: only the claim button carries a
  test tag. The "Later" text button and the "Close" button shown once the
  reward is claimed are untagged, and when the reward is already claimed the
  "Later" button still renders with an empty label.

## Acceptance Criteria

### Happy path

- [ ] "Land on Home" closes the daily-reward sheet when any id in
      `HOME_OVERLAY_IDS` is present: it taps `dailyReward_dismissButton`,
      re-reads the screen and asserts no overlay id remains.
- [ ] The dismissal never claims the reward, so a persona's bean balance and
      claim calendar are exactly as the journey found them.
- [ ] `DailyRewardDialog` carries `dailyReward_dismissButton` on the "Later"
      button and `dailyReward_closeButton` on the "Close" button shown after
      a claim; the "Later" button is not rendered at all once the reward is
      claimed (no empty-label button).
- [ ] Android dev J08 passes its signed-in preamble with the sheet present at
      launch; iOS dev J08 passes the same way once SHY-0526 lands.

### Error paths

- [ ] If the sheet is still present after the tap, "Land on Home" fails and
      names the overlay ids it still sees.
- [ ] "Confirm the phone is signed in as …" fails with "the `<id>` overlay
      hides the debug overlay" when an overlay id is in the dump, instead of
      the current "not showing an account id".
- [ ] A dismiss button that is missing from the dump (tags removed, dialog
      redesigned) fails the step with the ids seen, never a silent skip.

### Edge cases

- [ ] The sheet in its already-claimed state (only `dailyReward_closeButton`
      present) is closed through that button.
- [ ] A Home with no sheet is untouched: no tap, no extra dump, no delay.
- [ ] Both drivers behave the same: Android (dialog-only dump) and iOS (dialog
      and overlay both in the dump).

### Performance

- [ ] Dismissal adds at most one tap and one dump to a journey, only when the
      sheet is present.

### Security

- [ ] Unchanged: test tags carry no data, and the dismissal issues no API
      call.

### UX

- [ ] Unchanged for users: the tags are invisible; removing the empty-label
      button only stops an empty tappable area rendering after a claim.

### i18n

- [ ] The runner locates buttons by test tag, never by their localised label.

### Observability

- [ ] The step log records that the sheet was dismissed and which button it
      used; the failure messages above name the overlay ids seen.

## BDD Scenarios

**Scenario: The first launch of the day shows the reward calendar**
- **Given** a persona whose reward calendar opens over Home at launch
- **When** the journey lands on Home
- **Then** the runner closes the calendar without claiming and confirms the signed-in account

**Scenario: The calendar cannot be closed**
- **Given** the calendar's dismiss button is missing from the screen
- **When** the journey lands on Home
- **Then** the step fails and names the overlay ids still on screen

**Scenario: The reward was already claimed today**
- **Given** a persona who claimed today's reward earlier
- **When** the calendar opens over Home
- **Then** the runner closes it through the Close button and the empty Later button is not rendered

## Test Plan

- Unit (`express-api/tests/scripts/device-journey-dismisses-the-daily-reward-dialog.test.js`):
  the J08 dump from `report.json` as a fixture; the dismiss helper taps the
  dismiss button, then the close button, fails naming the ids when neither
  is present, and does nothing on a clean Home; the signed-in reader's
  message names the overlay.
- Source pin (jvmTest, `RepoSource.read`): both tags present in
  `DailyRewardDialog.kt`, the "Later" button guarded by `hasClaimedToday`,
  no empty-label `Text("")`.
- Device (post-merge, dev from `develop`): J-SMOKE, J02, J08 on both phones;
  a persona whose sheet is up at launch; run dirs linked in Notes.

## Out of Scope

- Claiming rewards inside journeys, or asserting the reward calendar itself.
- The iOS device-lock parity fix (SHY-0526).

## Dependencies

- None for the runner and tags. The iOS J08 proof needs SHY-0526 merged.

## Risks & Mitigations

- **Risk:** the sheet reappears after dismissal on a later Home landing.
  **Mitigation:** the dismissal runs inside "Land on Home" every time, not
  once per journey.
- **Risk:** a driver taps the label instead of the control. **Mitigation:**
  tap by test tag frame on both drivers, as the settings-row lesson requires.

## Definition of Done

- [ ] Merged to `develop`, all checks green, deployed to dev.
- [ ] Android and iOS dev runs from `develop`: J-SMOKE, J02, J08 pass;
      linked in Notes.
- [ ] The J08 preamble failure text in this story can no longer occur.

## Notes

- 2026-09-06 10:31 WIB — **Filed** from the SHY-0500 dev proof: Android run
  `dev-2026-09-06T02-52-39-583Z`, J08 preamble "Confirm the phone is signed
  in as 50000040" failed with "the debug overlay is not showing an account
  id"; the dump held only `dailyReward_dialog` and `dailyReward_claimButton`.

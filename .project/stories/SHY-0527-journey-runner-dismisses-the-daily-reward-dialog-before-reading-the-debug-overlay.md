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
- "Land on Home" clears the sheet through `handleRewardCalendar`, but the
  sheet is presented a moment after Home renders, so the landing step can
  declare arrival before it appears; the signed-in step then polls raw dumps
  with no overlay handling and stares at the dialog window for eight seconds.
- The handler finds the buttons by their English labels ("Later", "Claim
  Today") and taps "Claim Today" when "Later" is absent, so it claims the
  reward on a persona's behalf and does nothing at all in the already-claimed
  state, where the "Later" button renders with an empty label and the "Close"
  button is untagged. Only the claim button carries a test tag.

## Acceptance Criteria

### Happy path

- [ ] `handleRewardCalendar` closes the sheet by test tag: it taps
      `dailyReward_dismissButton`, or `dailyReward_closeButton` in the
      already-claimed state, and never any label.
- [ ] "Confirm the phone is signed in as …" clears overlays on every poll,
      through the same handlers "Land on Home" uses, before it reads the
      debug overlay.
- [ ] The dismissal never claims the reward, so a persona's bean balance and
      claim calendar are exactly as the journey found them.
- [ ] `DailyRewardDialog` carries `dailyReward_dismissButton` on the "Later"
      button and `dailyReward_closeButton` on the "Close" button shown after
      a claim; the "Later" button is not rendered at all once the reward is
      claimed (no empty-label button).
- [ ] Android dev J08 passes its signed-in preamble with the sheet present at
      launch; iOS dev J08 passes the same way once SHY-0526 lands.

### Error paths

- [ ] A sheet whose dismiss and close buttons are both missing from the dump
      (tags removed, dialog redesigned, older build) fails the step at once
      with the ids seen, never a silent skip and never a tap on the claim
      button.
- [ ] "Confirm the phone is signed in as …" keeps its two failure texts and
      appends the overlay ids still on screen when the account line is
      missing, so the message says what hid it.

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

- Unit (`express-api/tests/scripts/device-journey-daily-reward-dismissal.test.js`):
  the J08 dump shape as a fixture; `confirmAccountOnDevice` dismisses the
  sheet by tag and then reads the account, closes the already-claimed sheet
  through its Close button, fails naming the ids when neither button is
  tagged with zero taps, taps nothing on a clean Home, and keeps the
  wrong-account and missing-overlay failures; `handleRewardCalendar` never
  taps the claim button. The ordering test's fixture gains the tag.
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

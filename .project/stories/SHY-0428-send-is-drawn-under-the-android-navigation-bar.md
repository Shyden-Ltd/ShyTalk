---
id: SHY-0428
status: In Review
owner: claude
created: 2026-08-22
priority: P1
effort: XS
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0428: On Android, pressing Send goes to the home screen

## User Story

As **somebody on Android finishing a support request**, I want pressing Send to
send it, so that the problem I took the time to describe actually reaches
someone.

## Why

`SupportPage` pins Send in the Scaffold's `bottomBar` and lifts the Scaffold with
`imePadding()` (SHY-0419). That accounts for the **keyboard** and nothing else.

With the keyboard **closed** the IME inset is `0`, so the bar sits flush to the
bottom of the window — underneath Android's system navigation bar. Android then
draws back / home / recents **on top of the lower half of the Send button**. The
button's tappable centre coincides with **HOME**, so pressing Send leaves the app
for the launcher instead of submitting.

### Why it survived every test

Nothing an assertion can reach was wrong. The button existed, carried
`TAG_SUPPORT_SEND`, reported sane bounds, and answered "visible" to every query.
Only the **pixels** showed the navigation bar painted over it.

It was found at step 12 of journey J38 on a real OnePlus CPH2653, on video, on
2026-08-22 — the first walk recorded after screen recording was built.

### Why step 12 and not step 8

The journey's *first* Send (step 8) passes, because the keyboard is up at that
point and `imePadding()` has lifted the whole Scaffold clear. Step 12 comes
immediately after **"Go back"**, which dismisses the keyboard. Same button, same
screen, opposite outcome — which is exactly the shape that reads as flakiness.

### iOS had it too — measured after the fix

The ticket was written believing this was Android-only. Frame measurement of the
pre-change and post-change iOS walks says otherwise (screen 2736px = 912pt at 3x):

| | Send's bottom edge | Bottom-bar surface |
| --- | --- | --- |
| Before (`imePadding()`) | **20.0 pt** from the screen bottom | edge to edge |
| After (`ime ∪ navigationBars`) | **54.0 pt** | stops at 34.0 pt |

iOS's bottom safe area is **34 pt**, so Send's lower ~14 pt sat underneath the
home indicator. Same defect, same cause — one inset reasoned about while the
screen has two — on both platforms. The measured 34.0 pt also confirms
`WindowInsets.navigationBars` maps correctly to the iOS safe area.

### Scope

`MainScreen` is the only other screen with a `bottomBar` and is **not** affected:
its bar is a Material3 `NavigationBar`, which consumes system-bar insets itself.
`SupportPage` hand-rolls a `Surface`, which does not. That difference is why
precisely one screen was wrong.

## Acceptance Criteria

### Happy path

- [ ] With the keyboard closed, the whole Send button is visible above the system
      navigation bar and a tap at its centre submits the request.
- [ ] With the keyboard open, Send sits directly above the keyboard, exactly as
      SHY-0419 established — no gap opens up.

### Error paths

- [ ] Pressing Send never navigates away from the app.

### Edge cases

- [ ] Holds for gesture navigation as well as three-button navigation.
- [ ] Holds through open → close → reopen of the keyboard within one visit.
- [ ] Holds on the duplicate-choice screen, which replaces the form.
- [ ] On iOS, Send clears the home indicator as well as the keyboard, and the
      form does not collapse (the SHY-0419 regression).

### Performance

- [ ] No change.

### Security

- [ ] No change.

### UX

- [ ] The Send button reads as a deliberate, fully visible control at rest — not
      one that happens to peek out above the system bar.
- [ ] Nothing shifts position between the keyboard opening and closing beyond the
      keyboard's own height.

### i18n

- [ ] Holds for every MVP locale, including where the Send label is longest and
      the button is tallest.
- [ ] Holds under right-to-left layout.

### Observability

- [ ] A journey step that taps Send and lands outside the app fails loudly, naming
      the screen it ended on, rather than timing out on a missing element.

## BDD Scenarios

**Scenario: Sending with the keyboard closed**

- **Given** somebody on Android who has written their request and put the keyboard away
- **When** they press Send
- **Then** the request is sent and they stay in ShyTalk

**Scenario: Sending with the keyboard open**

- **Given** somebody still typing their request
- **When** they press Send
- **Then** the request is sent, with the button sitting just above the keyboard

**Scenario: Coming back and trying again**

- **Given** somebody who chose to go back from the duplicate question
- **When** they press Send a second time
- **Then** they are asked again, rather than being sent to the home screen

## Test Plan

| Layer | What it proves |
| --- | --- |
| Guard | The screen accounts for the navigation bar as well as the keyboard, exactly once, at the Scaffold. |
| Journey | On the real OnePlus: J38 step 12 passes, which is the Send that follows a keyboard dismissal. |
| Video | The recorded walk shows the whole button clear of the navigation bar. |
| iOS | The iOS journey still passes, so the SHY-0419 fix has not regressed. |

## Out of Scope

- Any other screen. `MainScreen` uses a Material3 bar that handles its own insets.

## Dependencies

- Builds directly on SHY-0419 (Send pinned above the keyboard).

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Padding the bar separately double-counts the inset and collapses the form, as in SHY-0419's second reading | `union` applies ONE padding at the Scaffold, taking the larger inset per side. The guard fails if the bar pads itself as well. |
| iOS regresses, where the IME inset is consumed upstream | `windowInsetsPadding` still respects consumed insets; verified by compiling `iosArm64` and by the iOS journey. |
| A future screen hand-rolls a bottomBar and repeats this | Noted in the test: Material3 bars handle their own insets, hand-rolled ones do not. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Proven on the real OnePlus: J38 step 12 passes, with video showing Send
      clear of the navigation bar.
- [ ] iOS journey still green.

## Notes

- **Introduced by the fix, tracked as SHY-0431:** `windowInsetsPadding` on the
  Scaffold insets the bar's BACKGROUND along with its content, so on iOS the
  bottom 34 pt is now unpainted black. Android is unaffected because the system
  navigation bar paints that band itself. Cosmetic, and a fair trade against the
  overlap it fixes, but it is a real inconsistency this change caused.

- Fixed by replacing `Modifier.imePadding()` with
  `Modifier.windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars))`.
  `union` takes the larger inset per side: the navigation bar when the keyboard
  is down, the keyboard when it is up — since the keyboard already spans the
  navigation bar's region.
- This is the Android sibling of SHY-0419 (iOS, Send behind the *keyboard*).
  Both are the same underlying mistake: reasoning about one inset while the
  screen has two.
- Honest nuance from the walk: a determined person could still hit the thin
  sliver of button above the navigation bar, so the pre-fix behaviour was
  "obscured and unreliable" rather than provably impossible. The obvious centre
  tap threw you to the home screen.

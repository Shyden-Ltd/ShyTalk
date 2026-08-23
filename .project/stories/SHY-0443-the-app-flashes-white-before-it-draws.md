---
id: SHY-0443
status: In Review
owner: claude
created: 2026-08-23
priority: P2
effort: XS
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0443: The app flashes white every time it opens

## User Story

As **somebody opening ShyTalk on a phone set to dark**, I want the app to come
up dark, so that the first thing I see is not a bright white rectangle.

## Why

Seen on the real OnePlus on 2026-08-22, on every cold start, and raised by the
operator as one of six issues to fix.

Android paints the activity's window background the moment the process starts
and holds it until the first composition. `Theme.ShyTalk` inherited
`Theme.AppCompat.Light.NoActionBar`, whose window background is **white**.
`ShyTalkTheme` picks its scheme from `isSystemInDarkTheme()`, so on a phone in
dark mode the launch window painted white and the first Compose frame then
painted `#141218` over it.

### Why it is worth more than a shrug

- It is the **first frame of every session**. A white flash on a dark app reads
  as cheap, and reads as a bug even to somebody who could not name it.
- It is worst in exactly the conditions where it is most visible: a dark room,
  which is when somebody has their phone in dark mode.
- Nothing measures or asserts it. It survived every green run this project has
  ever had.

## Acceptance Criteria

### Happy path

- [ ] A cold start on a phone in dark mode shows no white frame.
- [ ] A cold start on a phone in light mode shows no dark frame.

### Error paths

- [ ] N/A — this is a static resource declaration.

### Edge cases

- [ ] Holds when the system theme is changed while the app is backgrounded.
- [ ] Holds on a cold start after install, and after a force-stop.

### Performance

- [ ] No change. This removes a repaint rather than adding one.

### Security

- [ ] No change.

### UX

- [ ] The launch window is the SAME shade as the first Compose frame, not
      merely also dark — two dark greys still read as a flash.

### i18n

- [ ] No change.

### Observability

- [ ] None. There is nothing to measure once the colours match.

## BDD Scenarios

**Scenario: Opening the app at night**

- **Given** somebody whose phone is set to dark
- **When** they open ShyTalk
- **Then** it comes up dark, with no white flash

## Test Plan

| Layer | What it proves |
| --- | --- |
| Guard | The launch theme is not a Light theme and names its own window background. |
| Guard | The dark window background equals the colour measured on the device. |
| Mutation | Restoring the Light parent, or changing the measured colour, reddens the guard. |
| Device | A recorded cold start on both phones shows no white frame. |

## Out of Scope

- iOS. `UILaunchScreen` is an empty dict, which lets the system supply a
  background that already adapts to light and dark. Nothing observed suggests
  a flash there, and changing a launch screen that works on the strength of a
  guess is how the recorder and the scrcpy flags went wrong earlier this week.
  The device re-run is the place to confirm it.

## Dependencies

- None.

## How it was built

`Theme.AppCompat.DayNight.NoActionBar`, plus an explicit
`android:windowBackground` naming a colour defined in both `values/` and
`values-night/`.

The dark value is **measured, not guessed**: sampled from an on-device
screenshot of the real app in dark mode (journey J38, OnePlus CPH2653) at four
separate empty-background points, all `#141218` — Material 3's baseline dark
`surface`, which is what `darkColorScheme()` resolves to while `ShyTalkTheme`
sets no explicit `background`. The light value is that token's documented pair.

Guarded by reading the resource FILES rather than through a resource id: the
app module has no Robolectric. Every read anchors first, so a renamed or moved
file fails the test loudly instead of passing on a string it never found.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| DayNight changes AppCompat widget colours | The UI is entirely Compose; AppCompat theming reaches nothing that is drawn. |
| The measured colour drifts if the scheme sets an explicit background | The guard pins the value and the comment says how to re-measure. |
| It is dismissed as cosmetic | It is the first frame of every session, and it survived every green run this project has had. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [x] Mutation-proven: the Light parent and a wrong colour both redden the guard.
- [ ] A recorded cold start on both real devices shows no white frame.

## Notes

- Found on 2026-08-22 during the J38 device runs; raised by the operator as
  issue 4 of six.

---
id: SHY-0431
status: In Review
owner: claude
created: 2026-08-22
priority: P3
effort: XS
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0431: On iPhone, a black strip sits under the Send bar

## User Story

As **somebody on an iPhone finishing a support request**, I want the bottom of
the screen to look like the rest of the app, so that nothing reads as unfinished.

## Why

SHY-0428 fixed Send being drawn under the system navigation bar (Android) and
under the home indicator (iOS) by insetting the Scaffold:

```kotlin
Modifier.windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars))
```

`windowInsetsPadding` insets the bar's **background** along with its content. On
Android that is invisible, because the system navigation bar paints that band
itself. On iOS nothing paints below the inset, so the bottom **34 pt** is left as
pure black — measured at luma 2, against the bar's own 35.

Every other screen in the same build paints edge to edge: the Rooms bottom
navigation reads luma 33 at every row down to the last pixel, and the Support bar
did too before this change. So Support is now the only screen with a black gutter.

The iOS convention is the opposite of what we have: background edge to edge,
**content** inset.

### Why P3 and not lower

Purely cosmetic, and a fair trade against the home-indicator overlap it fixed —
a partly-covered Send button is far worse than a dark strip. But it is a visible
inconsistency this project introduced, on the screen somebody reaches when
something has already gone wrong for them.

## Acceptance Criteria

### Happy path

- [ ] The Send bar's background reaches the bottom of the screen on iOS, with no
      unpainted strip.
- [ ] Send itself still sits clear of the home indicator, as SHY-0428 requires.

### Error paths

- [ ] N/A.

### Edge cases

- [ ] Holds with the keyboard open, where the bar is lifted — no gap opens
      between the bar and the keyboard, and Send does not float.
- [ ] Holds on Android: Send stays clear of the navigation bar and nothing
      double-counts.
- [ ] Holds on a device with no home indicator, where the bottom inset is 0.
- [ ] Holds on the duplicate-choice screen, which replaces the form.

### Performance

- [ ] No change.

### Security

- [ ] No change.

### UX

- [ ] The Support screen's bottom edge is indistinguishable from every other
      screen's.

### i18n

- [ ] Holds where the Send label is longest and the button tallest.
- [ ] Holds under right-to-left layout.

### Observability

- [ ] No change.

## BDD Scenarios

**Scenario: The bottom of the screen looks finished**

- **Given** somebody on an iPhone writing a support request
- **When** they look at the bottom of the screen
- **Then** the bar reaches the edge, with Send sitting clear of the home indicator

## Test Plan

| Layer | What it proves |
| --- | --- |
| Guard | The bar's background is not inset while its content is. |
| Device | A frame from the iOS walk shows the bar painted to the last row, and Send still 20 pt clear of the indicator. |
| Regression | Android still counts the navigation bar exactly once; the form does not collapse with the keyboard up (SHY-0419). |

## Out of Scope

- Any other screen. Every other bottom bar already paints edge to edge.

## Dependencies

- Introduced by SHY-0428. Do not "fix" this by reverting that.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Moving the inset from the Scaffold to the bar's content reintroduces the double-count that collapsed this form in SHY-0419 | Whatever shape is chosen, the inset must still be applied exactly ONCE. The existing guard fails if the bar pads itself as well as the Scaffold. |
| Fixing the paint reintroduces the overlap | The device check asserts BOTH: background to the last row, and Send clear of the indicator. |
| It is treated as not worth doing | It is the screen people reach when something has already gone wrong; looking unfinished there costs more than elsewhere. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] An iOS device frame shows the bar painted to the bottom row with Send still
      clear of the home indicator.
- [ ] The Android walk still passes.

## How it was built

The inset moved off the Scaffold's own modifier and onto the things that need
it. `windowInsetsPadding` on the Scaffold shrinks the Scaffold — background
included — which is invisible on Android, where the system paints that band
itself, and is the black strip on iOS, where nothing does.

Now: the bar's `Surface` takes no inset and reaches the bottom edge, and the
Send button inside it carries `windowInsetsPadding(bottomInset)` so SHY-0428
still holds. `bottomInset` is `WindowInsets.ime.union(WindowInsets.navigationBars)`,
defined once — the union is what keeps the keyboard and the navigation bar
counted once rather than stacked.

**`contentWindowInsets = WindowInsets(0)` is deliberate.** Scaffold reports the
body's bottom padding as EITHER the bottom bar's height OR its content insets,
depending on which layout branch runs, and that is an internal this screen should
not depend on. Zeroing it collapses both branches to the same answer: the bar's
height, which now includes the inset. The two branches that REPLACE the form and
hide the bar — the sent confirmation and the duplicate choice — apply the inset
themselves, stated at each call site.

`SupportPageInsetWiringPinTest` pins both directions: insetting the Scaffold or
the Surface again brings the strip back, and dropping it from Send brings
SHY-0428 back. The pin is structural because the assertion is about layout on a
device the test does not run on — the device screenshots are the other half.

## Notes

- Measured on the real iPhone Air on 2026-08-22 by comparing the pre-change and
  post-change walk recordings frame by frame. Bar surface stops at 34.0 pt; the
  strip below reads luma 2 against the bar's 35.
- Likely shape: let the `Surface` fill and inset its CONTENT, rather than
  insetting the Scaffold — but that must be reconciled with the keyboard case,
  which is why this is its own ticket rather than a quick edit.

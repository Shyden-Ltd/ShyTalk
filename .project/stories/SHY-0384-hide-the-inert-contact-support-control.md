---
id: SHY-0384
status: In Review
owner: shyden
created: 2026-08-20
priority: P1
effort: S
type: bug
roadmap_ids: []
epic: EPIC-0012
mvp: true
---

# SHY-0384: Stop showing a Contact support button that does nothing

## User Story

As **someone refused by the age check**, I want to not be pointed at a button
that does nothing, so that I am not left believing I have asked for help when
nobody has heard me.

## Why

**Operator decision, 2026-08-20**, choosing the interim while SHY-0380 and
SHY-0385 build the real thing: *"if its not meant to be do anything, don't
display it."*

The age-restriction dialog offers **Contact support**, and both call sites wire
it to the dismiss action:

| Call site | What it passes |
| --- | --- |
| `RoomScreen.kt:1279` | `onContactSupport = { gachaViewModel.dismissAgeRestrictionDialog() }` |
| `PrivateChatScreen.kt:1022` | `onContactSupport = { viewModel.dismissAgeRestrictionDialog() }` |

So the confirm button is behaviourally identical to Cancel. The real fix is a
support ticket (SHY-0380, then SHY-0385), which is effort M each and cannot ship
today. Leaving a dead control in the meantime is the worse option: someone taps
it, believes they have contacted support, and waits for an answer that was never
requested.

### The body text has to go with it

The dialog says:

> If you believe this is wrong, please **contact support** — we cannot accept ID
> submissions to override the date of birth on file.

Removing the button while keeping that sentence is worse than either extreme —
it tells someone to do a thing and then removes the only means of doing it. The
sentence must be trimmed to what remains true, and restored with SHY-0385.

**This is a deliberately temporary change.** It is reversed by SHY-0385, which
restores both the control and the sentence, pointing at a real form.

## Acceptance Criteria

### Happy path

- [ ] The age-restriction message no longer offers a control that does nothing.
- [ ] What remains still explains why the person cannot use the feature.
- [ ] Dismissing the message works exactly as before.

### Error paths

- [ ] No path through the dialog leaves the person unable to close it.

### Edge cases

- [ ] Both places the dialog appears — a room and a private chat — are changed
      together. Neither keeps the dead control.
- [ ] The not-yet-verified variant of the dialog, which offers a genuinely
      working verification route, is **not** touched.

### Performance

- [ ] No change.

### Security

- [ ] The age gate itself is untouched. This story changes what is shown, not
      who is allowed in.

### UX

- [ ] Nothing on screen instructs the person to contact support while there is
      no way to do so.

### i18n

- [ ] The trimmed copy is updated in the **5 MVP locales only** (en, zh, id, vi,
      th) — not the retired `values-*` directories.

### Observability

- [ ] Not applicable; no behaviour is added.

## Device proof — OnePlus CPH2653 (Android 16), dev, 2026-08-20

Walked as **[SEED] Marcus (P-04 minor power)**, UID 60000010, cohort `minor`.
Build `0.97.15-bdeaa059a232 (176)`, commit `deaa059*`, against dev `api 487ef30`.

Tapped **1x SPIN** in Lucky Spin to raise the sub-eighteen dialog:

| Checked | Result |
| --- | --- |
| Buttons present | **exactly one — "OK"** |
| "Contact support" | **absent** |
| "Cancel" | absent |
| Body text | *"Private messages and gacha are only available to users 18 or older. Based on the date of birth on your account, you are not yet eligible. We cannot accept ID submissions to override the date of birth on file."* |
| Tapping OK | dialog closes |
| After closing | **1x / 10x / 100x all present** — SHY-0372's recovery still works |
| Coin balance | 350 → 350, nothing charged |

Read both from the accessibility tree and from a screenshot, so the assertion is
on **rendered text**, not on a resource key.

The last two rows matter beyond this story: they are a regression check that
SHY-0384 did not undo SHY-0372. The dialog's single action is wired to
`onDismiss`, which is the same path the wheel's recovery depends on.

### iOS still owed

The change is in `commonMain` and `:shared:compileKotlinIosArm64` is clean, but
it has **not** been seen on a real iPhone. The Definition of Done is not met
until it has been.

## BDD Scenarios

**Scenario: No dead control is offered**

- **Given** someone is shown the age-restriction message
- **When** they read it
- **Then** there is no button that does nothing

**Scenario: The message no longer asks for something impossible**

- **Given** someone is shown the age-restriction message
- **When** they read it
- **Then** it does not tell them to contact support

**Scenario: The verification route is untouched**

- **Given** someone over 18 who has not yet verified
- **When** they are prompted
- **Then** they can still verify, exactly as before

## Test Plan

| Layer | What it proves |
| --- | --- |
| Source guard | No `onContactSupport` call site remains wired to a dismiss-only lambda. Written so it also passes once SHY-0385 wires it to a real form — the guard is "not inert", not "absent". |
| Copy tests | The rendered dialog text no longer instructs contacting support, asserted on the **rendered string** in all 5 MVP locales, not on the key. |
| Regression | Every existing age-gate refusal test still passes unmodified. |
| Device | Real Android and real iPhone: the dialog shows, reads coherently, and closes. |

## Out of Scope

- Building the support ticket. That is SHY-0380 and SHY-0385.
- The rest of the dialog's wording.
- SHY-0379, which stops showing this dialog to known under-18s entirely.

## Dependencies

- None. This ships before SHY-0380.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A genuinely misclassified adult now has no route at all | They had none before — the button never worked. SHY-0385 restores a real one, and the remaining copy still explains the situation. |
| The change is forgotten and never reversed | SHY-0385 lists reversing it as an explicit acceptance criterion, and both stories sit under EPIC-0012. |
| Copy is changed in the wrong locale set | Locale scope is the 5 MVP locales, asserted on rendered text. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Seen on a real Android device and a real iPhone.
- [ ] Source guard present and proven to fail against today's wiring.

## Notes

- Interim by design. Operator chose this over leaving the dead control, and over
  a `mailto:` stopgap they explicitly ruled out.
- Reversed by [[SHY-0385]].

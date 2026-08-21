---
id: SHY-0419
status: Draft
owner: unassigned
created: 2026-08-22
priority: P1
effort: M
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0419: On iPhone you can fill in the support form but you cannot send it

## User Story

As **somebody on an iPhone who needs help**, I want to be able to send the
support request I just typed, so that asking for help is not itself the thing
that fails.

## Why

Found on a **real iPhone Air (iOS 27)**, walking SHY-0387 before merging #1940.

Measured from the live accessibility tree:

| Element | Position |
| --- | --- |
| Software keyboard | y = 609 → 854 |
| `support_send` ("Send") | y = 616 → 665, `visible="false"` |

The Send button sits **entirely inside the keyboard's area**. The keyboard opens
as soon as the message field is touched, and the message field must be touched
because an empty message is refused.

**Every route a real person has was tried, and none of them works:**

| Attempt | Result |
| --- | --- |
| Tap empty right margin | keyboard stays up |
| Tap empty area under the title | keyboard stays up |
| Tap the gap between the hint and the categories | keyboard stays up |
| Tap a category button (works, it is above y=609) | keyboard stays up |
| Swipe down over the keyboard (the iOS convention) | keyboard stays up |
| Drag the page upward (700 ms, with hold) | `support_send` stays at y=616 — the page does not scroll |

So on iOS the support form can be filled in and cannot be submitted.

### Why this is P1 and MVP

This is the surface a person reaches when something has already gone wrong for
them — a wrong date of birth, a payment problem, a safety report. Failing there
fails the people least able to route around it, and it is the only in-app way to
reach us: the operator confirmed on 2026-08-20 that there is no monitored
inbound mailbox, which is the whole reason SHY-0385 replaced the mail composer.

It also blocks **#1940**, since that PR is what introduces the page.

### What was tried and did NOT fix it

`SupportPage.kt`'s content Column carries no `imePadding()`, which looked like
the obvious cause — three sibling screens already use it (`RoomScreen.kt:649`,
`EmailOtpScreen.kt:94`, `PrivateChatScreen.kt:420`).

**Both placements were built and installed on the device, and neither changed
anything:**

1. `.verticalScroll(...).imePadding()` — the sibling screens' ordering.
   `support_send` stayed at y=616, `visible="false"`.
2. `.imePadding().verticalScroll(...)` — before the scroll, so the viewport
   itself should shrink. `support_send` stayed at y=616, `visible="false"`.

If `imePadding()` had any effect the layout would have moved. It did not, in
either order. The working conclusion is that **`WindowInsets.ime` is not
reported on iOS** in this Compose Multiplatform version, which would make
`imePadding()` a no-op there — and would mean the three sibling screens above
have the same problem and nobody has noticed, because nothing walks them on a
real iPhone.

That is a hypothesis with strong evidence, not a confirmed finding. Confirming
it is the first job of this story: instrument `WindowInsets.ime` on iOS and
print the reported height while the keyboard is open. If it reads zero, the fix
is a platform keyboard-height source, not a modifier.

The speculative change was **reverted rather than shipped** — a change that does
not move the button is not a fix, and merging it would have made the next person
believe this was handled.

## Acceptance Criteria

### Happy path

- [ ] On a real iPhone, after typing a message, the Send button is reachable and
      the request sends.
- [ ] The confirmation is shown, and the ticket exists server-side.

### Error paths

- [ ] With the keyboard open and a failure to send, the error text is visible —
      not hidden behind the keyboard the same way the button was.
- [ ] An empty message is still refused, and the refusal is readable.

### Edge cases

- [ ] Works with a long message that scrolls the field.
- [ ] Works with the largest Dynamic Type setting, where everything is taller.
- [ ] Works in landscape, where the keyboard takes proportionally more height.
- [ ] Works with an external/Bluetooth keyboard attached (no software keyboard).
- [ ] Works with attachments listed, which push the button further down.

### Performance

- [ ] No layout thrash when the keyboard opens or closes.

### Security

- [ ] N/A — layout only. No change to what is sent.

### UX

- [ ] Nothing a person must press is ever behind the keyboard on this page.
- [ ] The fix generalises: whatever mechanism is used is available to the other
      text-entry screens rather than being special-cased here.

### i18n

- [ ] Verified in a language with longer labels (the button and the categories
      grow), asserted on rendered text.

### Observability

- [ ] N/A.

## BDD Scenarios

**Scenario: somebody on an iPhone sends a support request**

- **Given** somebody on an iPhone has typed their problem
- **When** they look for the send button
- **Then** they can see it and send the request

**Scenario: the keyboard never hides what they must press**

- **Given** the keyboard is open on the support page
- **When** they scroll the page
- **Then** every control stays reachable

## Test Plan

| Layer | What it proves |
| --- | --- |
| Device walk (real iPhone, Appium) | With the keyboard open, `support_send` reports `visible="true"` and a tap sends the request. This is the only layer that can prove it. |
| Device walk (real Android) | The same journey still works, so the fix does not regress the platform that was fine. |
| Guard | Every Compose screen that takes text input handles the keyboard inset by the agreed mechanism — the check that stops the 16th screen repeating this. |
| Journey | The "I need help" journey ends in a sent request on BOTH platforms, not in a rendered form. |

## Out of Scope

- The other 14 screens with text input and no keyboard handling — see the
  sweep in Notes. They need the same mechanism, but each needs its own device
  verification and should not ride on this one.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A fix is declared from a green build without a device walk — exactly how this shipped | The Test Plan makes the device walk the proving layer; no other layer can see it. |
| `imePadding()` is added again by someone reading the sibling screens | This story records that both orderings were measured on the device and neither moved the button. |
| Fixed only on the support page while 14 other screens stay broken | The guard AC, plus the sweep recorded below. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] A support request **sent from a real iPhone**, with the ticket id recorded.
- [ ] The same journey re-walked on a real Android device.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded.

## Notes

- Found 2026-08-22 during the iOS device walk of SHY-0387 on #1940. The page
  itself renders correctly: title, all six categories, the entry point's default
  category pre-selected (`support_categoryother value='1'` from Settings), the
  message field, the attachment control, and Send. Selecting a category works.
  Only sending is impossible.
- Sweep — Compose files under `shared/src/commonMain` that take text input and
  do NOT reference `imePadding`, at the time of writing (15):
  `core/ui/ReportMessageDialog.kt`, `feature/settings/AppSettingsScreen.kt`,
  `feature/home/CreateRoomDialog.kt`, `feature/room/components/UserCardPopup.kt`,
  `feature/room/components/ChatPanel.kt`, `feature/profile/CountryPickerDialog.kt`,
  `feature/profile/ProfileScreen.kt`, `feature/messaging/NewMessageScreen.kt`,
  `feature/messaging/ConversationListScreen.kt`,
  `feature/messaging/ReportUserDialog.kt`, `feature/profile/ProfileSetupScreen.kt`,
  `feature/messaging/GroupSettingsSheet.kt`, `feature/support/SupportPage.kt`,
  `feature/messaging/GroupSetupScreen.kt`, `feature/suspension/SuspensionScreen.kt`.
  Not all are necessarily broken — a centred dialog may reposition — but none of
  them has been walked on an iPhone.
- Caveat worth stating plainly: both `imePadding()` attempts were verified by a
  full rebuild and reinstall (`scripts/ios/build-debug-dev.sh`, exit 0, "App
  installed") followed by a fresh Appium session. If a later attempt finds
  `imePadding()` does work, check first that the build genuinely shipped.

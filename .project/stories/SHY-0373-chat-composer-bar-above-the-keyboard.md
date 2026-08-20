---
id: SHY-0373
status: Draft
owner: unassigned
created: 2026-08-20
priority: P2
effort: M
type: feature
roadmap_ids: []
mvp: true
---

# SHY-0373: A chat composer bar that sits above the keyboard

## User Story

As **someone typing in a room**, I want the message box and send button to sit
directly above the keyboard, so that I can see what I am writing and send it
without hunting for the button.

## Why

**Operator request, 2026-08-20:** tapping to send a message should open the
keyboard and present an input bar docked above it, carrying the send control.
For MVP that bar holds only send; it is the surface that later gains the rest of
the message-sending features (attachments, emoji, voice), so it should be built
as an extensible bar rather than a one-off row.

The send control must be **an icon, not a text label** — deliberately, so the
control needs no translated visible string.

### What already exists

Worth stating so the work is not re-done:

| Piece | State |
| --- | --- |
| `android:windowSoftInputMode="adjustResize"` | present (`AndroidManifest.xml:33`) |
| `imePadding()` on the room layout | present (`RoomScreen.kt:645`) |
| Icon-only send button | present (`ChatPanel.kt`, `Icons.AutoMirrored.Filled.Send`) |
| A dedicated, reusable composer component | **missing** |

### What is actually missing

1. **The composer is not a component.** It is a `Row` inlined in
   `ChatPanel.kt`. There is nowhere for future send features to live, which is
   the stated point of the bar.
2. **The send button is conditional.** It renders only when
   `isInputFocused || isEditing` (`ChatPanel.kt`), so the bar's contents shift as
   focus changes rather than being a stable surface.
3. **Direct messages duplicate the whole thing.** `PrivateChatScreen.kt` has its
   own `OutlinedTextField` (:897), its own send icon (:930) and its own
   `imePadding()` (:416). `ChatPanel` is used only by `RoomScreen`. Two
   composers means every future send feature gets built twice, or lands in one
   surface and silently not the other.

## Acceptance Criteria

### Happy path

- [ ] Tapping the message field opens the keyboard and the composer bar sits
      directly above it, with no gap and nothing hidden behind it.
- [ ] The bar carries the message field and an **icon-only** send control.
- [ ] Sending clears the field and keeps the keyboard open, so a second message
      can be typed straight away.
- [ ] The most recent messages remain visible above the bar while typing.

### Error paths

- [ ] Send is unavailable while the field is empty or whitespace-only.
- [ ] A failed send keeps the typed text — it is never silently discarded.

### Edge cases

- [ ] Dismissing the keyboard returns the bar to its resting position without
      the layout jumping.
- [ ] Rotation and split-screen keep the bar docked correctly.
- [ ] A multi-line message grows the bar up to its existing 4-line cap and the
      send control stays reachable.
- [ ] Editing an existing message uses the same bar.
- [ ] Behaves correctly with a hardware keyboard attached (no phantom gap).

### Performance

- [ ] The bar tracks the keyboard without visible lag or a two-stage jump on
      open and close.

### Security

- [ ] No change to what may be sent; the existing 200-character cap and all
      moderation paths are unchanged.

### UX

- [ ] The bar is one stable surface — controls do not appear and disappear as
      focus changes.
- [ ] The send control has a touch target of at least 48dp.

### i18n

- [ ] **No new visible strings.** The send control is an icon.
- [ ] Its `contentDescription` **stays translated** — that is the screen-reader
      label, not visible text, and dropping it would make the only send control
      unusable with TalkBack/VoiceOver. Any string work goes to the **5 MVP
      locales only** (en, zh, id, vi, th).

### Observability

- [ ] No new logging required.

## BDD Scenarios

**Scenario: The message box follows the keyboard**

- **Given** someone is in a chat room
- **When** they tap the message box
- **Then** the keyboard opens with the message box and send button just above it

**Scenario: Sending keeps them typing**

- **Given** someone has typed a message
- **When** they tap send
- **Then** the message is sent and the box is ready for the next one

## Test Plan

1. Compose UI tests for the new composer component: send disabled when blank,
   enabled when not, clears on send, retains text on failure, respects the
   200-char cap, and honours the edit path.
2. Assert the send control is an **icon** with a non-empty `contentDescription`
   — this is the a11y contract and the reason no visible string exists.
3. Assert a 48dp minimum touch target.
4. androidTest Gherkin for the journey: open room → tap field → keyboard opens →
   bar is above it → type → send → field cleared, keyboard still open.
5. **Device verification is mandatory and cannot be substituted by an emulator**
   — keyboard inset behaviour is exactly what emulators model badly. Real
   OnePlus and real iPhone, both orientations.
6. Screenshot every state (resting, focused, multi-line, editing) on both
   devices — a green assertion does not prove a bar is docked correctly.

## Out of Scope

- The future contents of the bar (attachments, emoji, voice notes). This story
  delivers the surface plus send only.
- Changing how messages are sent, stored, or moderated.

## Open question for the operator

**Should the bar be shared with direct messages in this story, or room-only?**

Room-only is the literal request and the smaller change. But DMs currently
duplicate the composer, so a shared component means every future send feature is
built once instead of twice — and avoids the two surfaces drifting apart.
Recommendation: **build it shared, adopt it in the room in this story, and adopt
it in DMs in a fast follow** so the room change is not held up by DM regression
testing.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Keyboard insets behave differently on Android and iOS | Device-verified on both; emulators explicitly not accepted for this AC. |
| A shared component regresses DMs | Adopt in the room first; DM adoption is its own change with its own journey run. |
| "Icon not text" is read as "no translation at all" | An explicit AC keeps `contentDescription` translated for screen readers. |

## Definition of Done

- [ ] Journey passes on a real Android device and a real iPhone, both
      orientations, with screenshots.
- [ ] Story `In Review` before merge; CI green by name; merged to develop; dev
      deploy dispatched and its health gate observed passing.
- [ ] `released_in:` set on the next release cut.

## Notes (running log)

- **2026-08-20 — operator request.** Recorded that much of the plumbing already
  exists (`adjustResize`, `imePadding`, an icon send button); the real work is
  extracting a stable, extensible composer component and deciding the DM question
  above.

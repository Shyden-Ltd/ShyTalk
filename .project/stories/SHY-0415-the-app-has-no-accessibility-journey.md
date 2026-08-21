---
id: SHY-0415
status: Draft
owner: unassigned
created: 2026-08-21
priority: P1
effort: M
type: chore
roadmap_ids: []
mvp: true
---

# SHY-0415: The app cannot be shown to work for somebody who cannot see it

## User Story

As **somebody who uses a screen reader, or needs larger text**, I want the app to
have been used the way I use it, so that it works for me rather than merely not
having been tested against me.

## Why

The fifth audit pass looked at cross-cutting states rather than features, and
found three.

### Accessibility — the app has nothing

**The web is fine.** Seven Playwright spec files cover aria labels, screen-reader
-only labels and their localisation: `portal-a11y`, `aria-label-i18n`,
`language-selector-aria-i18n`, `suggestions-board-aria-i18n` and others, down to
"TOTP code input has associated label".

**The app has nothing.** Of 733 scenarios, the three matching "accessible" use
the word in its other sense — *"Legal screens are accessible from settings"*,
*"Settings screen is accessible"*. Those are navigation assertions. No journey
navigates with TalkBack or VoiceOver, scales the font, or checks contrast. The
only Kotlin references to `contentDescription` are two component tests.

This matters here more than average. ShyTalk has a **minor cohort**, Shyden Ltd
is a UK company, and this is a communication platform — the case for it working
for a blind user is not a compliance checkbox.

There is also direct evidence of the cost. While walking the support form on a
device during this session, the control that opens Settings turned out to be an
**icon button with no content description at all** — invisible to a screen
reader, and found only because somebody was looking at the accessibility tree to
drive a test.

### A session that expires while you are using it

One mention in 733 scenarios, and it is `j11`'s suspension cascade — a session
revoked as **punishment**. Nothing covers the ordinary case: a token expiring
mid-use. Either it refreshes silently, or somebody is dumped to sign-in holding a
half-typed message. Which one happens is currently unknown.

### Rotation and text size

Zero. The two "rotation" matches are seat rotation in `j16`. Nothing turns a
device sideways or scales the system font — the two things that most commonly
break a Compose layout.

## Acceptance Criteria

### Happy path

- [ ] The main journey — sign in, open a room, send a message — is completed with
      a screen reader on Android and on iOS.
- [ ] Every control on that path is announced with a meaningful name.
- [ ] The app is usable at the largest system font size.
- [ ] The app is usable in landscape.

### Error paths

- [ ] An error message is announced by the screen reader, not shown silently.
- [ ] A validation failure moves focus somewhere useful.

### Edge cases

- [ ] An icon-only button has a description — the specific defect found on the
      settings control during this session.
- [ ] Text that grows does not truncate its own meaning or push actions off
      screen.
- [ ] A session that expires mid-use either refreshes silently or returns the
      person to what they were doing — whichever it is, it is asserted rather
      than discovered.
- [ ] A session that expires while a message is half-typed does not lose it.
- [ ] Rotating mid-flow keeps what was entered.
- [ ] Walked on real Android **and** real iPhone.

### Performance

- [ ] Screen-reader navigation is not slowed by an unreasonable number of stops.

### Security

- [ ] A locked app announces nothing about the content behind the lock — pairs
      with `j24`'s leak scenarios.
- [ ] An expired session cannot keep reading data it no longer has rights to.

### UX

- [ ] Reading order matches visual order on the main screens.

### i18n

- [ ] Announcements are in the reader's language, asserted on the announced text
      — the same standard already applied to rendered text.

### Observability

- [ ] Not applicable.

## BDD Scenarios

**Scenario: Sending a message without seeing the screen**

- **Given** somebody using the app with a screen reader
- **When** they send a message in a room
- **Then** the message is sent and they are told it was

**Scenario: Every control says what it is**

- **Given** somebody using the app with a screen reader
- **When** they move through the settings screen
- **Then** every control announces a meaningful name

**Scenario: The app works at the largest text size**

- **Given** somebody whose system font is at its largest
- **When** they open a room
- **Then** they can read the messages and reach the controls

**Scenario: Turning the phone sideways keeps what I typed**

- **Given** somebody part-way through typing a message
- **When** they rotate the device
- **Then** what they typed is still there

**Scenario: A session that runs out mid-message**

- **Given** somebody with a half-typed message whose session expires
- **When** they send it
- **Then** they are not silently dropped and their words are not lost

## Test Plan

| Layer | What it proves |
| --- | --- |
| **Screen reader, both devices** | The main journey completed with TalkBack and with VoiceOver. Driving by accessibility node rather than by coordinate is the assertion: a control with no name cannot be reached that way, which is exactly the defect found this session. |
| Naming | Every control on the walked path has a non-empty description — table-driven, so a new icon button joins the check automatically. |
| Font scaling | Largest system size, asserting controls remain reachable and text remains whole. |
| Session | Expiry mid-use asserted for both the refresh and the sign-out outcome, whichever the product chooses — and the half-typed message surviving either way. |
| Rotation | Entered text survives a rotation. |

## Out of Scope

- A full WCAG audit of every screen. This story establishes the journey and the
  main path; breadth follows once there is something to extend.

## Dependencies

- Journey steps for enabling a screen reader and for setting the system font
  size, on each platform.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Accessibility is asserted by reading the code for contentDescription | The journey is DRIVEN through the accessibility tree — an unnamed control is unreachable, so the test fails by being unable to proceed. |
| Only Android is walked | Both required; TalkBack and VoiceOver behave differently. |
| Session expiry is tested by signing out | The token is expired for real, mid-flow, with text in the field. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] The main journey completed with a screen reader on a real Android device
      and a real iPhone.

## Notes

- Found 2026-08-21 in the fifth audit pass, which changed axis from features to
  cross-cutting STATES — accessibility, offline, session expiry, rotation, empty
  states. Offline turned out to be genuinely covered by `j14`; the rest were not.
- The settings icon button with no content description was found by accident
  while driving the device for another test. That is the whole argument for
  accessibility-driven journeys: they find these without looking.

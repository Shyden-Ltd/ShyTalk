---
id: SHY-0271
status: In Progress
owner: claude
created: 2026-08-04
priority: P1
effort: S
type: bug
roadmap_ids: []
pr:
mvp: true
---

# SHY-0271: Translations are never checked for what they actually say

## User Story

As someone verifying their age,
I want the buttons to be written in plain, correct English,
So that I trust the screen enough to hand it a photo of my ID.

## Why

The operator read this off the age-verification screen on a real device:

```
Driver\'s license
```

A literal backslash, on a compliance screen, in production copy. It had shipped.

**The trap.** `\'` and `\"` are ANDROID XML escaping. Compose Multiplatform's `composeResources`
does not unescape them, so they reach the screen verbatim. The English file was already
self-contradictory about this — 11 apostrophes written plainly alongside 17 escaped — and
nothing noticed, because nothing was reading the values at all.

**Why every existing check passed it.** This is the part worth recording, because the defect
was visible and the suite was large:

- **Locale parity counts KEYS, not values.** All 21 files carry 838 keys; the check compares
  those key sets. A key whose value is garbage is a perfectly good key.
- **UI assertions match by `testTag`.** `AgeVerificationSubmitScreenTest` *clicks*
  `TAG_AGE_VERIF_METHOD_DRIVERS` in two separate tests. The tag is on the `Button`; the corrupt
  string is on a `Text` inside it. Both tests drove the broken button and passed.
- **Nothing read the locale files as text.** No test in any framework opened `strings.xml` and
  looked at what was between the tags.
- **The journey corpus asserts screens, not sentences.** Steps are declarative ("they are shown
  the verification screen"), which is correct BDD but says nothing about the copy.

So the string was rendered, clicked, screenshotted and shipped without one assertion ever
reading it. The gap is not that a check was wrong — it is that **content was not a test surface**.

Scope of the rot: **221 strings across 18 of the 21 locales** (`values` 15, `values-fr` 93,
`values-it` 47, `values-tr` 41, `values-uk` 12, and one each in thirteen others).

The equivalent web catalogs (`public/js/*-translations.js`, `public/portal`, `public/admin`)
were checked and are clean — in JavaScript `\'` is a *parser* escape and is consumed before the
string exists, so the defect is specific to the Compose XML surface.

## Acceptance Criteria

### Happy path
- [ ] The age-verification method buttons read `Passport`, `Driver's license`, `National ID card`

### Error paths
- [ ] A re-introduced `\'` fails a test rather than reaching a screen

### Edge cases
- [ ] `\n` is preserved — it is a real line break, not an escaping artefact
- [ ] Spanish/Portuguese `TODO` ("all") is not mistaken for a developer marker

### Performance
- [ ] N/A — a string-content fix plus two file-reading tests; no runtime cost.

### Security
- [ ] N/A — no authorisation, identity, or data path is touched.

### UX
- [ ] No user-facing string renders a stray backslash in any of the 21 locales

### i18n
- [ ] All 21 locales are checked, not just English
- [ ] Key parity is unchanged at 838 keys per locale

### Observability
- [ ] The failure names the offending locale, key, and value, so the fix is obvious

## BDD Scenarios

**Scenario: The ID buttons are written in plain English**
- **Given** someone is choosing which ID to submit
- **Then** the options read "Passport", "Driver's license" and "National ID card"

**Scenario: Corrupt copy is caught before it ships**
- **Given** a translation containing a stray escape character
- **When** the test suite runs
- **Then** it fails and names the locale and key

## Test Plan

**Red first — proven on a real device, not asserted.** The exact defect was re-introduced
verbatim into `values/strings.xml` and the instrumented suite run on a real OnePlus (CPH2653):

```
methodButtonsRenderTheirLabels_notJustTheirTags            FAILED
  AssertionError: Failed to assert the following: (Text + EditableText = [Driver's license])
noRenderedTextOnThisScreenCarriesAnEscapeSequence          FAILED
```

Restoring the fix turns both green (`BUILD SUCCESSFUL`). The mutant was the operator's string
character-for-character, so this is a demonstrated catch, not a claimed one.

**New — `express-api/tests/scripts/locale-string-content.test.js`** reads all 21 locale files as
text and asserts no escaped apostrophe or quote, no empty value, no leaked markup, and no
developer marker — with a vacuous-pass guard (≥20 files, >15,000 strings) so it cannot silently
stop reading, and a self-mutation guard proving the escape predicate fires.

**New — two tests in `AgeVerificationSubmitScreenTest`**: one asserting the three labels by text
via `assertTextEquals`, one sweeping every text node on the screen for a backslash so future
strings are covered without being named.

**Green** — 6/6 locale-content tests; instrumented suite green on device; key parity unchanged
at 838 per locale; `\n` count in English unchanged at 9.

## Out of Scope

- Translation *quality* (whether the French is good French). This story is about mechanical
  corruption of the copy, which is objectively checkable.
- The web catalogs, which were checked and found clean.

## Dependencies

- None.

## Risks & Mitigations

- **Risk:** the value-scoped rewrite mangles `\n` or an attribute.
  **Mitigation:** the replacement is scoped to text between `<string>` tags and targets only
  `\'`/`\"`; `\n` count and key parity were both measured before and after and are unchanged.
- **Risk:** the marker check false-positives on a real word.
  **Mitigation:** it already did — Spanish `RECOGER TODO` ("collect all"). `TODO` is excluded for
  es/pt with the reason written at the exclusion.

## Definition of Done

- [ ] 221 strings fixed across 18 locales
- [ ] Content guard green and mutation-verified
- [ ] Instrumented text assertions green on a real Android device
- [ ] Merged to develop; `released_in:` at the next release cut

## Notes (running log)

- **2026-08-04 00:0x BST** — Operator reported `Driver\'s license` on the age-verification
  screen and asked how it got past testing. It got past because content was never a test
  surface: parity counts keys, UI assertions match tags, and nothing read the files as text.
  Worth recording that I had printed that exact string in a device dump earlier in the session
  and read past it — the guard now is mechanical rather than attentional.

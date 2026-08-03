---
id: SHY-0271
status: In Progress
owner: claude
created: 2026-08-04
priority: P0
effort: M
type: bug
roadmap_ids: []
pr:
mvp: true
---

# SHY-0271: Translations are never checked for what they actually say

## User Story

As someone using the app in my own language,
I want the words on screen to be written properly and to include the numbers they promise,
So that the app reads like it was made for me rather than machine-translated at me.

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
was visible and the suite is large:

- **Locale parity counts KEYS, not values.** All 21 files carry 838 keys; the check compares
  those key sets. A key whose value is garbage is a perfectly good key.
- **UI assertions match by `testTag`.** `AgeVerificationSubmitScreenTest` *clicks*
  `TAG_AGE_VERIF_METHOD_DRIVERS` in two separate tests. The tag is on the `Button`; the corrupt
  string is on a `Text` inside it. Both tests drove the broken button and passed.
- **Nothing read the locale files as text.** No test in any framework opened `strings.xml` and
  looked at what was between the tags.
- **The journey corpus asserts screens, not sentences.** Steps are declarative ("they are shown
  the verification screen"), which is correct BDD but says nothing about the copy.

So the string was rendered, clicked and shipped without one assertion ever reading it. The gap
is not that a check was wrong — **content was not a test surface at all**.

**The generator was still writing the defect, and a green test demanded it.** Fixing the 221
strings would have been useless on its own: `scripts/translate-strings.js` converted every
apostrophe to `\'` on every write, so the next translation run would have restored all of them.
Worse, `translate-strings.test.js` asserted `toContain("it\\'s")` — the suite was *green on the
operator's defect*, pinning the bug as the contract. Both `escapeXml` and `unescapeXml` were
exported "for testing" and neither had a single direct test.

**What Compose actually unescapes was settled by measurement, not argument.** `Res.allStringResources`
exposes every key at runtime, so a device test resolves all 838 through the real pipeline and
asserts on what a user would read. Result: **`\uXXXX` IS unescaped; `\'` is NOT.** That matters,
because the corpus held 57 `…` — had they rendered literally, `Loading…` was on the
first screen of every session. They do not. The corpus was normalised anyway, so the rule can be
a flat "no backslash except `\n`" with no allowlist to maintain.

**Pulling that thread found worse than backslashes.** Once translations were compared for
content rather than key names, six strings turned out to have had their *format specifier*
translated:

| locale | key | shipped | should be |
|---|---|---|---|
| ar | `user_id` | `المعرف: %1$د` | `%1$d` |
| ar | `seat_number` | `المقعد %1$د` | `%1$d` |
| id | `day_streak` | `%1$hari berturut-turut` | `%1$d hari …` |
| ko | `day_streak` | `%1$일 연속` | `%1$d일 연속` |
| ru | `active_days_ago` | `Активен %1$дд назад` | `%1$dд` |
| ru | `active_minutes_ago` | `Активен %1$дм назад` | `%1$dм` |

The machine translator read the `d` in `%1$d` as the first letter of a word and localised it.
On Android `stringResource(res, arg)` routes to `String.format`, and `%1$د` is an unknown
conversion — **`UnknownFormatConversionException`, a crash**, in Arabic, Korean, Russian and
Indonesian. Two more (`de` and `fr` `success_redeemed_beans_bonus`) had the `%%` escape broken
apart into `% %` and `% `, the same crash by a different route. English, Spanish and Italian had
it right, which is why nobody looked.

Scope: **221 escaped apostrophes/quotes** (18 locales), **58 further escape artefacts** (21
locales, incl. zh's `\“…\”`), **8 broken format strings** (6 locales).

The web catalogs (`public/js/*-translations.js`, `public/portal`, `public/admin`) were checked
and are clean — in JavaScript `\'` is a *parser* escape, consumed before the string exists.

## Acceptance Criteria

### Happy path
- [ ] The age-verification method buttons read `Passport`, `Driver's license`, `National ID card`

### Error paths
- [ ] A re-introduced `\'` fails a test rather than reaching a screen
- [ ] The generator can no longer write an escaped apostrophe

### Edge cases
- [ ] `\n` is preserved — it is a real line break, not an escaping artefact
- [ ] `%%` is preserved where a literal percent is intended
- [ ] Spanish `all_caps` / `collect_all` (`TODO` = "all") are not mistaken for developer markers

### Performance
- [ ] N/A — string content plus file-reading tests; no runtime cost.

### Security
- [ ] N/A — no authorisation, identity, or data path is touched.

### UX
- [ ] No user-facing string renders a stray backslash in any of the 21 locales

### i18n
- [ ] Every translation takes the same format arguments as the English it replaces
- [ ] No locale can crash `String.format` with a translated or unescaped specifier
- [ ] Key parity unchanged at 838 keys per locale

### Observability
- [ ] Each failure names the offending locale, key and value, so the fix is obvious

## BDD Scenarios

**Scenario: The ID buttons are written in plain English**
- **Given** someone is verifying their age
- **When** they reach the step that asks which ID they will use
- **Then** the options read "Passport", "Driver's license" and "National ID card"

**Scenario: A translation keeps the number it promises**
- **Given** a profile shown in Arabic
- **When** the member views their ID
- **Then** the number appears, and the screen does not crash

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
noRenderedTextOnAnyStepCarriesAnEscapeSequence            FAILED
```

Restoring the fix turns both green. The mutant was the operator's string character-for-character.

**New — `express-api/tests/scripts/locale-string-content.test.js`** (9 tests) reads all 21 locale
files and asserts: no backslash except `\n`; no empty value; no leaked markup; no developer
marker; **placeholder parity against English per key**; and **no unescaped `%` in a format
string**. Guards on the guard: per-file parse-completeness (the parser's yield must equal the
raw `<string` count, so a reformat cannot silently blank a file), an allowlist-rot check, and two
mutation guards that call the *same* predicate the real checks use rather than an inline copy.

**New — `app/src/androidTest/.../resources/StringResourceContentTest.kt`** resolves all 838 keys
through `Res.allStringResources` + `getString` on a real device — the actual Compose pipeline,
not a proxy for it. This is what established that `\uXXXX` is unescaped and `\'` is not.

**New — three tests in `AgeVerificationSubmitScreenTest`**: the three labels by text; a sweep of
`Text` + `EditableText` + `ContentDescription` across **all** steps of the flow; and a guard that
the walk actually advances, so the sweep cannot quietly shrink to one step.

**New — `express-api/tests/scripts/pr-checks-locale-guard-gating.test.js`** pins that a
locale-only PR runs these guards at all. It did not: `shared/*` set only the app flags, so
`test-backend` was skipped and the content guard ran incidentally inside sonarcloud's unfiltered
suite. `pr-checks.yml` now has a `composeResources` arm setting `BACKEND`, ordered before
`shared/*` because `case` is first-match.

**Root cause — `scripts/translate-strings.js`**: `escapeXml` no longer escapes apostrophes, the
test that demanded `it\'s` is inverted (and now also asserts `not.toContain("\\'")`), and both
`escapeXml` and `unescapeXml` gained direct tests including a round-trip and a
"never emits a backslash" property.

**Green** — 99/99 across the four locale-related suites; 9/9 instrumented on device; 3/3 whole-
corpus runtime tests on device; key parity unchanged at 838; 412 `\n` preserved; the no-new-stubs
ratchet clean.

## Out of Scope

- Translation *quality* (whether the French reads well). This story is about mechanical
  corruption, which is objectively checkable.
- The web catalogs, checked and found clean.
- The pre-existing anonymous `AgeVerificationRepository` double in `AgeVerificationSubmitScreenTest`.
  It predates this story, the no-new-stubs ratchet does not flag it, and replacing it means giving
  a Compose UI test a real upload backend — a separate piece of work, noted here so it is not lost.

## Dependencies

- None.

## Risks & Mitigations

- **Risk:** the value-scoped rewrite mangles `\n` or an attribute.
  **Mitigation:** the diff was verified mechanically — 221 removed / 221 added, every pair
  differing *only* by removed backslashes; `\n` count and key parity measured before and after.
- **Risk:** the strict "no backslash" rule rejects a legitimate future string.
  **Mitigation:** it is the correct rule for this corpus — no user-facing copy in this app needs
  a backslash — and a genuine need would be a deliberate, reviewed change to one named predicate.
- **Risk:** the format-specifier fixes change meaning in languages I do not read.
  **Mitigation:** each fix restores the *specifier only*, leaving translated words untouched, and
  the surrounding text was already reviewed against the sibling locales that were correct.

## Definition of Done

- [ ] 221 escapes + 58 artefacts + 8 broken format strings fixed
- [ ] Generator no longer writes the defect; its test no longer demands it
- [ ] Guards green and mutation-verified; CI gating pinned
- [ ] Instrumented + whole-corpus runtime tests green on a real Android device
- [ ] iOS device walk of the same screen
- [ ] Merged to develop; `released_in:` at the next release cut

## Notes (running log)

- **2026-08-04 00:0x BST** — Operator reported `Driver\'s license` and asked how it got past
  testing. It got past because content was never a test surface: parity counts keys, UI
  assertions match tags, and nothing read the files as text. Recording that I had printed that
  exact string in a device dump earlier in the session and read past it — which is why the guard
  is mechanical rather than attentional.
- **2026-08-04 00:4x BST** — Review found the generator still writing the defect and a green test
  demanding it. Fixed at source. Chased the class rather than the instance: added a whole-corpus
  runtime test, which disproved the worry that 57 `\uXXXX` were live defects, and added
  placeholder parity, which found 8 genuine `String.format` crashes across 6 locales that had
  been shipping unnoticed.
- **2026-08-04 02:5x BST** — Second review round found the SAME defect in its entity form:
  `unescapeXml` did not decode `&apos;`, while `escapeXml` re-escapes `&`, so the next
  translation run would have written `&amp;apos;` — which DOES render literally — into all 20
  locales. Six English strings carried `&apos;`. Fixed the decode (ordered before `&amp;`, which
  stays last), normalised the six, and added a corpus rule that only `&amp;`/`&lt;`/`&gt;` may
  appear. Settled the render question on the device rather than reasoning about it, the same way
  `\uXXXX` was settled: **Compose DOES decode entities**, so `&apos;` was not itself visible —
  but `&amp;apos;` would have been.
  Also closed: the sweep now shares its walk with its own guard (the guard used to do a private
  walk and stayed green if the sweep shrank), covers the Explanation step it previously skipped,
  and the parity test now uses the shared parser instead of a second private regex.

Reviewed-up-to: (this commit)

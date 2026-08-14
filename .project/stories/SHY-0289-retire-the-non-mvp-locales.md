---
id: SHY-0289
status: Draft
owner: claude
created: 2026-08-06
priority: P1
effort: M
type: chore
roadmap_ids: []
epic: EPIC-0010
pr:
---

# SHY-0289: Retire the 15 non-MVP locales from both surfaces

## User Story

As the operator shipping ShyTalk's first public release,
I want the app and website to support exactly the five languages we can stand behind,
So that we are not shipping fifteen half-reviewed translations to real children.

## Why

ShyTalk carries 20 locales. Nobody has reviewed most of them, several were
machine-generated, and every one is a surface that can render a legal or safety
sentence wrongly to a minor. Supporting a language is a promise about the
quality of what it says, and we can only make that promise for five.

Keeping the files "in case" costs real money: every new string must be added to
20 files or fail parity, so 15 unreviewed locales tax every piece of work
forever. They are recoverable from git if a language returns.

The same is true of the 19 translated root READMEs. They are the first thing a
contributor sees, and a README offering Polish for a product that no longer
speaks Polish is a promise the repository cannot keep.

## Acceptance Criteria

### Happy path

- [ ] Exactly five locale directories remain under
      `shared/src/commonMain/composeResources`: base, zh, id, vi, th.
- [ ] Exactly five web string tables remain.
- [ ] Nothing references a removed locale anywhere in the tree.
- [ ] Exactly five root READMEs remain: `README.md` (English), `README.zh.md`,
      `README.id.md`, `README.vi.md`, `README.th.md`. The other 15 are deleted.

### Error paths

- [ ] A device set to a removed language renders the app in English rather than
      crashing or showing empty strings.
- [ ] A request for a removed locale prefix on the web returns the 404 page.
- [ ] No surviving README links to a deleted one. `README.md` carries a
      19-entry language table and each translated README carries its own
      18-entry table, so deleting the files without editing the tables leaves
      a dead link in every survivor — 15 of them in `README.md` alone.

### Edge cases

- [ ] `values` (the base, English) is NOT deleted along with `values-*`.
- [ ] Khmer is handled despite being asymmetric: `values-km` exists but there
      has never been a `README.km.md`. A sweep that assumes one README per
      locale will either miss the directory or fail looking for the file.
- [ ] A locale removed from the app but still listed in any manifest, allowlist
      or test fixture fails a test rather than silently drifting.

### Performance

- [ ] The app's resource footprint drops; asserted as a measured APK/IPA size
      comparison rather than assumed.

### Security

- [ ] N/A — removing translation files introduces no new data flow or
      permission surface.

### UX

- [ ] No screen shows an untranslated key or an empty label in any of the five
      remaining languages, on a real device.

### i18n

- [ ] The five remaining locales have identical key sets and no blank values.
- [ ] A test enumerates the supported set from ONE definition, so app and web
      cannot disagree about which five are supported.

### Observability

- [ ] The supported-locale list is asserted by count and by value, so a
      sixteenth cannot reappear unnoticed.

## BDD Scenarios

**Scenario: Only the five agreed languages remain**

- **Given** the retirement has been applied
- **When** the supported languages are listed
- **Then** there are exactly five: English, Mandarin, Bahasa Indonesia, Vietnamese and Thai

**Scenario: A dropped language falls back rather than breaking**

- **Given** a phone set to Korean
- **When** someone opens ShyTalk
- **Then** the app is in English
- **And** no screen shows an empty or missing label

**Scenario: The README language list matches the languages we support**

- **Given** the retirement has been applied
- **When** someone opens the README in any supported language
- **Then** every language it offers is one that still exists
- **And** the five it offers are the five the product supports

**Scenario: A dropped language cannot reappear unnoticed**

- **Given** the retirement has been applied
- **When** a developer adds a sixteenth locale file
- **Then** the test suite fails

## Test Plan

**RED first:**

- `shared/src/commonTest/.../SupportedLocalesTest.kt` — the supported set is
  exactly the five, by value; a sixteenth directory fails.
- `express-api/tests/scripts/locale-inventory.test.js` — the web tables and the
  app locale directories agree on the same five, read from one definition.
- `app/src/androidTest/.../FallbackLocaleTest.kt` — a device in a removed
  language renders English with no empty labels, on a real device.
- `tests/web/removed-locale-404.spec.ts` — `/fr/`, `/de/`, `/ar/` return the
  404 page.
- `express-api/tests/scripts/readme-locale-parity.test.js` — the set of root
  `README.*.md` files equals the supported set minus English; every
  `README.*.md` link inside every surviving README resolves to a file that
  exists; no README references a retired locale. Reads the supported set from
  the SAME single definition as the app and web inventories, so the three
  surfaces cannot drift apart.

**GREEN:** delete the 15 directories and their web equivalents; collapse any
allowlist to the five.

**Regression:** full Kotlin unit + instrumented BDD corpus; full Playwright
suite; journeys in all five languages on a real Android and a real iPhone.

## Out of Scope

- Adding a sixth language later — that is a new story, and cheap once this
  lands.
- Right-to-left support: Arabic and Hebrew leave here, so no RTL surface
  remains.
- Runtime translation of user-generated content (EPIC-0002), which is not
  limited to the five.

## Dependencies

- SHY-0287 — the web must be off the old machinery before its tables are cut.
- SHY-0288 — the app must resolve from the device before its locales are cut,
  so a removed language falls back rather than resolving to nothing.

## Risks & Mitigations

- **Deleting real translation work is irreversible-feeling.** Mitigation: it is
  fully recoverable from git history; the epic records the commit that removed
  them.
- **An existing user in a removed language sees the app change under them.**
  Mitigation: they fall back to English rather than breaking, covered by an
  instrumented test on a real device; the release note says so.
- **A stale reference to a removed locale can linger in a fixture.**
  Mitigation: the inventory test reads one definition and compares both
  surfaces against it.

## Definition of Done

- [ ] All AC met; tests written RED first.
- [ ] `ls README.*.md` returns exactly the five supported languages, and no
      link in any of them points at a file that no longer exists.
- [ ] Journeys walked in all five languages on a real Android device AND a real
      iPhone, local then dev.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded.
- [ ] CI green by name.

## Notes (running log)

- 2026-08-06 — Created under EPIC-0010. Operator chose deletion over keeping
  the files unbuilt, and confirmed the MVP set is FIVE (en, zh, id, vi, th),
  correcting SHY-0194 which named only four.
- 2026-08-06 — Operator addition: the retirement must remove the corresponding
  root README files too. Surveyed rather than assumed: there are 19
  (`README.ar.md` … `README.zh.md`), so exactly 15 go and 5 stay. `README.md`
  links to all 19 and each translation links to the other 18, so deleting the
  files without editing the tables would leave a dead link in every survivor.
  Khmer is the asymmetric case — `values-km` exists but `README.km.md` never
  did.

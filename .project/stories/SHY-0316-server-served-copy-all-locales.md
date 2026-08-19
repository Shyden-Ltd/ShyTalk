---
id: SHY-0316
status: Draft
owner: claude
created: 2026-08-17
priority: P1
effort: M
type: feature
roadmap_ids: []
epic: EPIC-0011
mvp: true
---

# SHY-0316: Fix any wording in the app from the server, in all 20 languages

## User Story

As the **operator**, I want to correct or change any user-facing wording from the
server, so that a typo, a wrong term or a bad translation is fixed in minutes
rather than in a store release.

## Why

Copy is the highest-frequency change in any app and the most embarrassing to get
wrong. It is also the change that most obviously should not cost a week.

But server-served copy has a trap that server-served *structure* does not: a
manifest can reference a label key that exists in some locales and not others.
The result is not a missing item — it is a user in Vietnamese seeing
`set_support` where a word should be. That is worse than the original typo, and
it will only ever be noticed by the users least likely to report it.

So the design decision is that **validation happens at publish time, not render
time.** A manifest referencing a key absent from any of the 20 locales **cannot
be published at all.** Catching it in the client is too late: by then it is
already in front of someone.

The override model is deliberately simple: a server string **replaces** the
bundled one for the same key, and a key absent from the manifest falls back to
the bundled resource. That means the app always has a complete string set, and
the manifest carries only what has changed — which keeps the document small and
makes a diff readable.

This overlaps with SHY-0072 (lazy translation service) and must **share its
translation path** rather than growing a second one. Two independent translation
pipelines is how a product ends up with two different words for the same thing.

## Acceptance Criteria

### Happy path

- [ ] A server-supplied string replaces the bundled one for the same key, in the user's active locale, with no reinstall.
- [ ] A key not present in the manifest falls back to its bundled value.
- [ ] Changing a string takes effect without a restart.
- [ ] All 20 locales can be overridden in a single manifest.

### Error paths

- [ ] Publishing a manifest that references a label key missing from ANY of the 20 locales fails, naming the key and the missing locales.
- [ ] A manifest whose `strings` section is malformed falls back entirely to bundled strings and records `strings` as degraded.
- [ ] A string value that is not a string (number, object, null) degrades that one key, not the section.
- [ ] An override for a locale the app does not support is ignored without error.

### Edge cases

- [ ] An empty-string override is honoured as an empty string — deliberate blanking is a legitimate edit and must not be mistaken for absence.
- [ ] A very long override does not truncate or overflow its container on the smallest supported viewport, verified on a real device.
- [ ] An override containing an emoji or a combining character renders correctly on both platforms.
- [ ] Overriding a string used in two places changes both.
- [ ] Switching locale mid-session applies the override for the new locale with no refetch.

### Performance

- [ ] String resolution is O(1) per lookup — a map, not a scan — asserted with a 5,000-key manifest.
- [ ] Publish-time locale validation across 20 locales completes in under 5 s, so it can sit in `lint.yml`.

### Security

- [ ] A string is rendered as opaque text — never interpreted as markup, a format template, or a link target.
- [ ] A string containing `%s`, `{0}` or `<b>` renders those characters literally, asserted, so a manifest cannot become a format-string or injection vector.
- [ ] Overriding a string belonging to a sealed screen is refused at publish time (SHY-0311) — copy is the crack through which structure follows.

### UX

- [ ] A changed string never leaves a stale value visible next to a fresh one on the same screen.
- [ ] Screenshots on real Android and real iPhone, at every supported viewport, with a long override and a short one, reviewed by eye.
- [ ] Low-resolution rendering verified, per the repo's proportional-sizing rule.

### i18n

- [ ] All 20 locales are exercised, each asserted on rendered TEXT rather than on element presence.
- [ ] `ar` renders an override with correct RTL alignment.
- [ ] A locale whose override is absent falls back to bundled for that locale only, not for all.
- [ ] Publish validation is the mechanism guaranteeing no locale is left behind, and is proven by a fixture that fails it.

### Observability

- [ ] Every applied override logs its key count and `manifestVersion`.
- [ ] A degraded `strings` section logs at warn level with the reason.
- [ ] A publish rejection names every offending key and locale in one message, so the fix is one pass rather than twenty.

## BDD Scenarios

**Scenario: A typo is fixed without an app update**

- **Given** the app shows a misspelled label
- **When** the operator corrects that wording on the server
- **Then** the app shows the corrected wording without reinstalling it

**Scenario: Wording that is missing a translation cannot be published**

- **Given** new wording that has no Vietnamese translation
- **When** the operator tries to publish it
- **Then** publishing is refused
- **And** the message names Vietnamese

**Scenario: Untouched wording is left alone**

- **Given** the operator changes one label
- **When** the app applies the change
- **Then** every other label is unchanged

**Scenario: Wording is shown exactly as written**

- **Given** wording that contains characters used by code, such as a percent sign
- **When** the app shows it
- **Then** those characters appear exactly as written

## Test Plan

**RED first.**

### Kotlin unit (`shared/src/commonTest/kotlin/.../manifest/ManifestStringsTest.kt`)

- `an override replaces the bundled string for the active locale`
- `an absent key falls back to bundled`
- `an empty-string override is honoured as empty`
- `a non-string value degrades only that key`
- `a malformed strings section degrades the whole section`
- `an unsupported locale is ignored`
- `switching locale applies that locale's override without refetch`
- `renders percent-s, brace-zero and angle-b literally`
- `resolution is O(1) with a 5000-key manifest`

### Node / Jest (`express-api/tests/utils/manifest-validate.test.js`)

- `rejects a manifest whose key is missing from one locale, naming key and locale`
- `rejects a manifest overriding a sealed screen's string`
- `accepts a manifest whose keys exist in all 20 locales`
- `names every offending key and locale in a single message`
- `completes 20-locale validation in under 5 seconds`

### Fixtures (committed, real)

- `manifests/__fixtures__/missing-vi-translation.json` — must fail publish.
- `manifests/__fixtures__/complete-20-locales.json` — must pass.

### Device, REAL Android + REAL iPhone

- Operator changes a string; both devices show it with no reinstall.
- A long override and a short one at every viewport, screenshots reviewed by eye.
- `ar` RTL verified on a real device.
- Emoji and combining characters verified on both platforms.

### Mutation proof

| Mutation | Must kill |
| -------- | --------- |
| publish validation checks only `en` | `rejects a manifest whose key is missing from one locale, naming key and locale` |
| empty-string override treated as absent | `an empty-string override is honoured as empty` |
| strings passed through a format function | `renders percent-s, brace-zero and angle-b literally` |
| sealed-screen string override permitted | `rejects a manifest overriding a sealed screen's string` |
| malformed value degrades whole section instead of one key | `a non-string value degrades only that key` |

### Backend change ⇒ FULL gauntlet

Touches `express-api/src/**`; the full device + all-browser matrix runs.

## Out of Scope

- Machine translation of new strings — that is SHY-0072's job; this story
  consumes its path rather than duplicating it.
- Adding new bundled strings — a normal code change.
- Rich text or markup in strings. Deliberately excluded: opaque text is the
  security property, and markup would forfeit it.

## Dependencies

- **SHY-0310**, **SHY-0312**, **SHY-0313** — pipeline below.
- **SHY-0311** — sealed-screen string overrides are refused.
- **SHY-0072** — must share the translation path; if SHY-0072 is not yet Done,
  this story wires to its interface and the two land in either order.
- **EPIC-0004 must be Done** (EPIC-0011 dependency gate).

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---------- |
| A key missing in one locale reaches users who will never report it | Refused at publish time across all 20 locales, proven by a committed failing fixture. Checking only `en` is the first mutation. |
| A string becomes an injection or format-string vector | Rendered as opaque text, asserted on `%s`, `{0}` and `<b>`; passing strings through a formatter is in the mutation table. |
| A second translation pipeline diverges from SHY-0072's | Shared path is a Dependency, not a suggestion. |
| A long override breaks a small-screen layout | Long-override screenshots at every viewport on real devices, per the repo's eyes-on-UI rule. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] A manifest missing one locale's translation is **proven unable to publish**.
- [ ] A string change proven on a real Android device and a real iPhone with no reinstall.
- [ ] All 20 locales verified on rendered text; `ar` verified RTL on a real device.
- [ ] Long-override screenshots at every viewport, reviewed by eye.
- [ ] Backend change ⇒ FULL gauntlet green, then DEV green.
- [ ] `./gradlew :shared:compileKotlinIosArm64` passes.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] `bash scripts/pre-merge-check.sh <PR#>` emits `PRE-MERGE-CHECK: OK`.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-17** — Story raised from design doc §5.4. Publish-time rather than render-time locale validation is the central decision: a missing translation caught in the client is already in front of a user.
- **2026-08-17** — Empty-string override honoured as empty is called out because "falsy means absent" is the natural implementation and it silently removes the operator's ability to blank a label deliberately.
- **2026-08-17** — Sealed-screen copy overrides refused, per the operator's choice of the strict option. Copy was the one carve-out considered and declined.

---
id: SHY-0194
status: Draft
owner: claude
created: 2026-07-16
priority: P1
effort: L
type: chore
roadmap_ids: []
mvp: true
---

# SHY-0194: Retire 16 locales — support English (default), Mandarin, Bahasa Indonesia, Vietnamese, Thai only

## User Story

- **As the** ShyTalk operator
- **I want** the product to ship in exactly five languages — English (default), Mandarin (`zh`), Bahasa Indonesia (`id`), Vietnamese (`vi`), Thai (`th`) — with the other 16 retired for now
- **So that** every new feature stops paying a 20-locale translation/maintenance tax in time, money, and review surface

## Why

Operator directive 2026-07-16: "To save time, money and resources. I want to reduce the number of languages we support to: English (default), Mandarin, Bahasa Indonesia, vietnamese. let's retire the other languages for now." Amended 2026-07-31: "i want to add thai to my list of mvp languages, so there should be 5 now."

Every user-facing string currently fans out to 20 locale files (app) plus parallel web bundles, all pinned by completeness tests — a 21× multiplier on copy changes (the SHY-0192 row-copy tweak touched 21 files). "For now" = retirement, not deletion of the capability: git history retains the translations; the sweep must leave re-adding a locale mechanical.

Retired: `ar de es fr hi it ja km ko nl pl pt ru sv tr uk` (16). Kept: base English + `zh` + `id` + `vi` + `th`.

**Thai costs almost nothing to keep, measured 2026-07-31 before this amendment:** `values-th/strings.xml` is at **full parity — 838 strings, zero keys missing** against base English; `legal-translations.js` (5 blocks), `homepage-translations.js`, `suggestions-i18n.js` and `event-translations.js` all carry `th` at exactly the coverage they give `vi`; `th` is already in `supported-locales.js` and `language-selector.js`. Because the sweep never ran, keeping Thai is a **deletion this story does not perform**, not a translation project. The single real gap is in Express email subjects (see the i18n AC).

## Acceptance Criteria

### Happy path

- [ ] App: `shared/src/commonMain/composeResources/` contains only `values/` (en), `values-zh/`, `values-id/`, `values-vi/`, `values-th/`; the app builds and every screen renders correctly in all five.
- [ ] App language picker (`AppSettingsScreen.kt` list) offers exactly English, 中文, Bahasa Indonesia, Tiếng Việt, ไทย.
- [ ] Web language selector (`public/js/language-selector.js`, the authoritative web list) offers exactly the five; every public page renders in each.
- [ ] Server allowlist (`express-api/src/utils/supported-locales.js`) is `['id','th','vi','zh']` (non-English locales) and the grep-pin test asserting selector↔server agreement passes against the NEW set.

### Error paths

- [ ] A user whose SAVED preference is a retired locale (app `LanguagePreference` storage; web localStorage/cookie) falls back to English silently on next launch/visit — no crash, no missing-resource exception, no blank strings; picker shows English selected.
- [ ] `/api/translate` (and any translation-serving endpoint) called with a retired locale returns the defined fallback behaviour (English payload or explicit 4xx per current contract — decide + test both request shapes), never a 5xx.
- [ ] Deep links / URLs carrying a retired `?lang=` (SHY-0181 site-wide lang flag) resolve to English without redirect loops.
- [ ] `?lang=th` continues to resolve to Thai — a regression here is the specific risk of editing the retire list, so it is pinned rather than assumed.

### Edge cases

- [ ] Seasonal-event content (`public/events/events.json` + `event-translations.js`) with retired-locale entries: retired keys removed; events render in the five kept locales.
- [ ] `public/roadmap-data.json` phase `titleI18n` maps hold only kept locales; the sync script (`sync-shy-to-roadmap-data.mjs`) emits only kept locales going forward.
- [ ] hreflang/SEO annotations (sitemap.xml, `<link rel="alternate">` if present) list only the five kept languages.
- [ ] RTL support: Arabic was the only RTL locale — any RTL-specific code paths remain compilable/dormant (do NOT rip out RTL plumbing; it is not part of this retirement).

### Performance

- [ ] App bundle/APK size shrinks or stays equal (16 resource dirs removed); no locale-related startup regression. Record before/after APK size in Notes.

### Security

- [ ] N/A — no auth/data-plane surface; the `?lang` parameter handling keeps its existing validation (unknown values already cannot inject — regression-guarded by the SHY-0181 tests updated to the new set).

### UX

- [ ] No page or screen shows a language it can no longer fully render (no mixed-language fallback soup): pickers, footers, and any "available languages" copy list exactly five.
- [ ] Retired-locale users see English immediately (no one-time error toast about their language disappearing — silent fallback is the chosen UX).
- [ ] **Thai typography renders without clipping.** Thai stacks a vowel mark above the consonant and a tone mark above that, so a line box tuned for Latin text crops the tone mark — which changes the word, not merely its looks. Every surface with a constrained line box (buttons, badges, chips, snackbars, the persona watermark, table cells) is walked in Thai on a real device and on web; any clipped mark is fixed by relaxing line-height, never by shrinking the font.
- [ ] **Thai wrapping does not overflow.** Thai is written without spaces between words, so break-on-space finds no break opportunity and the line runs past its container. Narrow layouts (small-phone widths, the low-resolution sizing rule in CLAUDE.md) are checked in Thai; web sets `line-break`/`word-break` as needed and Compose wrapping is verified rather than assumed.

### i18n

- [ ] The five kept locales are COMPLETE for every user-facing string (base parity check passes for zh/id/vi/th across app strings.xml and each web bundle). Measured 2026-07-31: app `values-th` is already 838/838 — the gate must confirm this, not repair it.
- [ ] **`express-api/src/utils/suggestion-email-templates.js` gains `th` subjects.** Its `rejected` / `planned` / `completed` / `merged` / `comment` maps were filled for en+zh+id+vi only (SHY-0246) and `getSubject()` falls back to `en` SILENTLY — so a Thai recipient receives an English subject with nothing failing. `accepted` already carries Thai. This is the only measured Thai gap in the codebase.
- [ ] CLAUDE.md translation rule + the story-template i18n AC wording updated from "all 20 locale files" to the new five-locale contract (also fix the stale wording in SHY-0193's i18n AC, and the four-locale wording inherited by SHY-0196, SHY-0204, SHY-0220, SHY-0222, SHY-0246, SHY-0247, SHY-0248 and SHY-0259).

### Observability

- [ ] Retired-locale fallback logs once at debug level (web console/app logD) naming the requested locale — diagnosable without being noisy.

## BDD Scenarios

**Scenario: picker offers exactly five languages**

- **Given** any signed-in user opens app Settings → Language (or the web 🌐 selector)
- **When** the language list renders
- **Then** it contains exactly English, 中文 (Mandarin), Bahasa Indonesia, Tiếng Việt and ไทย (Thai) — none of the retired 16

**Scenario: retired saved preference falls back silently**

- **Given** a device/browser whose stored language preference is `de` (retired)
- **When** the app cold-launches / the page loads after the change ships
- **Then** all UI renders in English with no error surfaced
- **And** the picker shows English as the active selection

**Scenario: retired locale in a URL resolves to English**

- **Given** a visitor opens `shytalk.com/?lang=ru`
- **When** the page renders
- **Then** content is English and no redirect loop or JS error occurs

**Scenario: Thai survives the sweep**

- **Given** a visitor opens `shytalk.com/?lang=th` after the retirement ships
- **When** the page renders
- **Then** the content is in Thai, not English
- **And** the language selector shows ไทย as the active choice

**Scenario: kept locales still fully translate**

- **Given** a user selects ไทย (or Tiếng Việt / 中文 / Bahasa Indonesia)
- **When** they browse app screens and public pages
- **Then** every string renders translated (no raw keys, no English bleed-through in tested surfaces)

**Scenario: Thai tone marks are not clipped**

- **Given** a user reading the app in Thai on a real phone
- **When** they view a button, badge, chip or snackbar whose text box is tightly sized
- **Then** the marks stacked above each Thai character are fully visible, with no row of glyphs cut off at the top

**Scenario: a Thai member's notification email is in Thai**

- **Given** a member whose language is Thai has a suggestion declined
- **When** the notification email is sent
- **Then** its subject line is in Thai, not English

**Scenario: the completeness gates enforce the NEW set**

- **Given** the test suites run
- **When** a future PR adds a user-facing string missing from `th`
- **Then** a completeness test fails naming the gap (the old "all 20 locales" pins now pin the five)

## Test Plan

Touches app resources + `public/**` + `express-api/src/**` → **full protocol + backend⇒full-gauntlet** (device gauntlet segment deferred while devices are unavailable; runs when they return).

**Red → Green (update pins FIRST so they demand the new set, watch them fail, then sweep):**

- **Express Jest — the `translate-public` pin suite** (server↔selector agreement) + `/api/translate` route tests: flip the expected locale set to `['id','th','vi','zh']`; add retired-locale request tests (fallback behaviour). RED against the current 20-locale lists.
- **Express Jest — `suggestion-email-templates`**: assert `getSubject(kind, 'th')` returns Thai rather than the English fallback for all six kinds. RED today for `rejected` / `planned` / `completed` / `merged` / `comment`.
- **Playwright — the "all 20 locales" specs** (`tests/web/404-i18n.spec.ts` locale-completeness test, legal/homepage/suggestions/admin i18n contract specs): flip to the five-locale contract; add a retired-`?lang=` fallback spec AND a `?lang=th` still-Thai spec (SHY-0181 surface). RED first.
- **Kotlin — resource parity check** (existing locale-completeness unit/lint gates if present; else add a jvmTest scanning composeResources dirs): pins exactly `values`, `values-zh`, `values-id`, `values-vi`, `values-th`. RED while 20 dirs exist.
- **Sweep**: delete 16 `values-*` dirs; shrink `language-selector.js`, `supported-locales.js`, `AppSettingsScreen` list, all web bundles (`legal-translations.js`, `homepage-translations.js`, `event-translations.js`, `suggestions-i18n.js`, `portal-translations.js`, admin translations, roadmap i18n, 404 inline i18n), `roadmap-data.json` titleI18n, events.json. **Thai leaves the retire list; it does not leave the product** — verify each sweep grep spares `th`.
- **Docs**: CLAUDE.md (Key Constraints "20 locales" line + architecture line), SHY-0193 i18n AC wording, and the four-locale wording in the eight dependent stories named in the i18n AC.
- **Verification**: full local gates (jvmTest, app unit, detekt, ktlint, iosArm64 compile, express `npm test`, eslint/prettier, full Playwright) + a manual five-locale walk on web including the Thai typography pass; device gauntlet when devices return.

## Out of Scope

- Removing RTL layout plumbing (Arabic may return; keep the capability dormant).
- Translating any currently-missing strings for the five kept locales beyond the parity gaps the completeness tests surface.
- A native-speaker review of the existing Thai corpus (those 838 strings predate this story; translation _quality_ is separate work — see the SHY-0149 precedent, where review rounds found semantically wrong ban/suspension wording that no parity check can catch).
- App Store / Play Store listing localisation changes (store metadata is managed outside this repo).
- Deleting translations from git history (retirement, not erasure — history is the archive).

## Dependencies

- Sequenced AFTER the in-flight SHY-0187+SHY-0192 stack review/park and the deploy-pipeline fix story (operator-ordered queue 2026-07-16).
- Interacts with SHY-0181 (site-wide lang flag) tests and SHY-0072 (server locale copy) pin tests — both get their locale sets updated here.
- SHY-0222 plans `scripts/test/active-locales.mjs` as the single home for the active-locale set (not yet created). Whichever story lands first creates it; the other reads it. The set must not be restated in prose in a third place.
- INTERIM RULE effective immediately (pre-implementation): new user-facing strings are added to the five kept locales only.

## Risks & Mitigations

- **Risk:** a missed surface keeps offering a retired language that now half-renders. **Mitigation:** repo-wide sweep greps (`values-([a-z]{2})`, each retired code as a quoted literal, `titleI18n`, `hreflang`) recorded in Notes; completeness pins flipped RED-first so the gates demand the new set.
- **Risk:** the sweep deletes Thai from muscle memory, because `th` sat in the retire list from 2026-07-16 to 2026-07-31 and survives in that form in git history, in the old filename, and in eight dependent stories. **Mitigation:** the `?lang=th` and `values-th` pins are written RED-first and must stay GREEN throughout the sweep, so a deletion is caught by a test rather than by review.
- **Risk:** stored retired-locale preferences crash resource lookup on launch. **Mitigation:** explicit fallback AC + tests for the app and web storage paths before the resource dirs are deleted.
- **Risk:** the lazy public-translations architecture (hard rule) is disturbed by shrinking bundles. **Mitigation:** only locale SETS shrink; the lazy-loading mechanism is untouched and its tests keep passing.
- **Risk:** Thai looks correct in a desktop browser during review and clips on a real phone, because the outcome depends on the platform text engine and the display density. **Mitigation:** the typography AC is walked on the real Android device and the real iPhone in the gauntlet, not in a desktop browser alone.

## Definition of Done

Exactly five languages selectable and fully rendering on app + web; Thai proven present after the sweep by its own pins; retired-locale preferences/URLs fall back to English silently; the server allowlist and every pin test enforce the new set; the Thai email-subject gap closed; CLAUDE.md + story-template + dependent-story wording updated; `code-reviewer` 100% clean; full local gates green (device gauntlet segment on device return); merged; released.

## Notes

- 2026-07-16 — Filed from the operator's mid-session directive (verbatim in Why). Queued behind the SHY-0187/0192 stack close-out and the Deploy-To-Dev fix per WIP=1. The interim locale rule for new strings starts NOW (this session's earlier `security_set_pin` strings landed in all 21 files while the 20-locale contract was still in force; the sweep deletes the retired copies wholesale — no pre-work needed).
- 2026-07-31 — Operator: "i want to add thai to my list of mvp languages, so there should be 5 now." Kept set is now en+zh+id+vi+th; retired count 17 → 16. File renamed `…-keep-en-zh-id-vi` → `…-keep-en-zh-id-vi-th`. Verified before amending, so the cost is known rather than assumed: `values-th` 838/838 at parity, and `th` already present in `supported-locales.js`, `language-selector.js` and every web bundle at `vi`-equal coverage. Because the sweep never ran, nothing needs restoring — Thai simply leaves the retire list. One genuine gap found: `suggestion-email-templates.js` fills only en/zh/id/vi for five of six subject kinds while `getSubject()` falls back to English silently, so Thai recipients get English subjects. Captured as an i18n AC plus a RED Express test rather than fixed ad hoc, because it is backend runtime code and therefore carries the full gauntlet.

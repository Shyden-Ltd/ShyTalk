---
id: SHY-0194
status: Cancelled
owner: claude
created: 2026-07-16
priority: P1
effort: L
type: chore
roadmap_ids: []
mvp: true
---

# SHY-0194: Retire 17 locales — support English (default), Mandarin, Bahasa Indonesia, Vietnamese only

## User Story

- **As the** ShyTalk operator
- **I want** the product to ship in exactly four languages — English (default), Mandarin (`zh`), Bahasa Indonesia (`id`), Vietnamese (`vi`) — with the other 17 retired for now
- **So that** every new feature stops paying a 20-locale translation/maintenance tax in time, money, and review surface

## Why

Operator directive 2026-07-16: "To save time, money and resources. I want to reduce the number of languages we support to: English (default), Mandarin, Bahasa Indonesia, vietnamese. let's retire the other languages for now." Every user-facing string currently fans out to 20 locale files (app) plus parallel web bundles, all pinned by completeness tests — a 21× multiplier on copy changes (today's SHY-0192 row-copy tweak touched 21 files). "For now" = retirement, not deletion of the capability: git history retains the translations; the sweep must leave re-adding a locale mechanical.

Retired: `ar de es fr hi it ja km ko nl pl pt ru sv th tr uk` (17). Kept: base English + `zh` + `id` + `vi`.

## Acceptance Criteria

### Happy path
- [ ] App: `shared/src/commonMain/composeResources/` contains only `values/` (en), `values-zh/`, `values-id/`, `values-vi/`; the app builds and every screen renders correctly in all four.
- [ ] App language picker (`AppSettingsScreen.kt` list) offers exactly English, 中文, Bahasa Indonesia, Tiếng Việt.
- [ ] Web language selector (`public/js/language-selector.js`, the authoritative web list) offers exactly the four; every public page renders in each.
- [ ] Server allowlist (`express-api/src/utils/supported-locales.js`) is `['id','vi','zh']` (non-English locales) and the grep-pin test asserting selector↔server agreement passes against the NEW set.

### Error paths
- [ ] A user whose SAVED preference is a retired locale (app `LanguagePreference` storage; web localStorage/cookie) falls back to English silently on next launch/visit — no crash, no missing-resource exception, no blank strings; picker shows English selected.
- [ ] `/api/translate` (and any translation-serving endpoint) called with a retired locale returns the defined fallback behaviour (English payload or explicit 4xx per current contract — decide + test both request shapes), never a 5xx.
- [ ] Deep links / URLs carrying a retired `?lang=` (SHY-0181 site-wide lang flag) resolve to English without redirect loops.

### Edge cases
- [ ] Seasonal-event content (`public/events/events.json` + `event-translations.js`) with retired-locale entries: retired keys removed; events render in the four kept locales.
- [ ] `public/roadmap-data.json` phase `titleI18n` maps hold only kept locales; the sync script (`sync-shy-to-roadmap-data.mjs`) emits only kept locales going forward.
- [ ] hreflang/SEO annotations (sitemap.xml, `<link rel="alternate">` if present) list only the four kept languages.
- [ ] RTL support: Arabic was the only RTL locale — any RTL-specific code paths remain compilable/dormant (do NOT rip out RTL plumbing; it is not part of this retirement).

### Performance
- [ ] App bundle/APK size shrinks or stays equal (17 resource dirs removed); no locale-related startup regression. Record before/after APK size in Notes.

### Security
- [ ] N/A — no auth/data-plane surface; the `?lang` parameter handling keeps its existing validation (unknown values already cannot inject — regression-guarded by the SHY-0181 tests updated to the new set).

### UX
- [ ] No page or screen shows a language it can no longer fully render (no mixed-language fallback soup): pickers, footers, and any "available languages" copy list exactly four.
- [ ] Retired-locale users see English immediately (no one-time error toast about their language disappearing — silent fallback is the chosen UX).

### i18n
- [ ] The four kept locales are COMPLETE for every user-facing string (base parity check passes for zh/id/vi across app strings.xml and each web bundle).
- [ ] CLAUDE.md translation rule + the story-template i18n AC wording updated from "all 20 locale files" to the new four-locale contract (also fix the stale wording in SHY-0193's i18n AC).

### Observability
- [ ] Retired-locale fallback logs once at debug level (web console/app logD) naming the requested locale — diagnosable without being noisy.

## BDD Scenarios

**Scenario: picker offers exactly four languages**
- **Given** any signed-in user opens app Settings → Language (or the web 🌐 selector)
- **When** the language list renders
- **Then** it contains exactly English, 中文 (Mandarin), Bahasa Indonesia, and Tiếng Việt — none of the retired 17

**Scenario: retired saved preference falls back silently**
- **Given** a device/browser whose stored language preference is `de` (retired)
- **When** the app cold-launches / the page loads after the change ships
- **Then** all UI renders in English with no error surfaced
- **And** the picker shows English as the active selection

**Scenario: retired locale in a URL resolves to English**
- **Given** a visitor opens `shytalk.com/?lang=ru`
- **When** the page renders
- **Then** content is English and no redirect loop or JS error occurs

**Scenario: kept locales still fully translate**
- **Given** a user selects Tiếng Việt (or 中文 / Bahasa Indonesia)
- **When** they browse app screens and public pages
- **Then** every string renders translated (no raw keys, no English bleed-through in tested surfaces)

**Scenario: the completeness gates enforce the NEW set**
- **Given** the test suites run
- **When** a future PR adds a user-facing string missing from `vi`
- **Then** a completeness test fails naming the gap (the old "all 20 locales" pins now pin the four)

## Test Plan

Touches app resources + `public/**` + `express-api/src/**` → **full protocol + backend⇒full-gauntlet** (device gauntlet segment deferred while devices are unavailable; runs when they return).

**Red → Green (update pins FIRST so they demand the new set, watch them fail, then sweep):**
- **Express Jest — the `translate-public` pin suite** (server↔selector agreement) + `/api/translate` route tests: flip expected locale set to `['id','vi','zh']`; add retired-locale request tests (fallback behaviour). RED against the current 20-locale lists.
- **Playwright — the "all 20 locales" specs** (`tests/web/404-i18n.spec.ts` locale-completeness test, legal/homepage/suggestions/admin i18n contract specs): flip to the four-locale contract; add a retired-`?lang=` fallback spec (SHY-0181 surface). RED first.
- **Kotlin — resource parity check** (existing locale-completeness unit/lint gates if present; else add a jvmTest scanning composeResources dirs): pins exactly `values`, `values-zh`, `values-id`, `values-vi`. RED while 20 dirs exist.
- **Sweep**: delete 17 `values-*` dirs; shrink `language-selector.js`, `supported-locales.js`, `AppSettingsScreen` list, all web bundles (`legal-translations.js`, `homepage-translations.js`, `event-translations.js`, `suggestions-i18n.js`, `portal-translations.js`, admin translations, roadmap i18n, 404 inline i18n), `roadmap-data.json` titleI18n, events.json.
- **Docs**: CLAUDE.md (Key Constraints "20 locales" line + architecture line), SHY-0193 i18n AC wording.
- **Verification**: full local gates (jvmTest, app unit, detekt, ktlint, iosArm64 compile, express `npm test`, eslint/prettier, full Playwright) + manual four-locale walk on web; device gauntlet when devices return.

## Out of Scope

- Removing RTL layout plumbing (Arabic may return; keep the capability dormant).
- Translating any currently-missing strings for the four kept locales beyond parity gaps the completeness tests surface.
- App Store / Play Store listing localisation changes (store metadata is managed outside this repo).
- Deleting translations from git history (retirement, not erasure — history is the archive).

## Dependencies

- Sequenced AFTER the in-flight SHY-0187+SHY-0192 stack review/park and the deploy-pipeline fix story (operator-ordered queue 2026-07-16).
- Interacts with SHY-0181 (site-wide lang flag) tests and SHY-0072 (server locale copy) pin tests — both get their locale sets updated here.
- INTERIM RULE effective immediately (pre-implementation): new user-facing strings are added to the four kept locales only.

## Risks & Mitigations

- **Risk:** a missed surface keeps offering a retired language that now half-renders. **Mitigation:** repo-wide sweep greps (`values-([a-z]{2})`, each retired code as a quoted literal, `titleI18n`, `hreflang`) recorded in Notes; completeness pins flipped RED-first so gates demand the new set.
- **Risk:** stored retired-locale preferences crash resource lookup on launch. **Mitigation:** explicit fallback AC + tests for app and web storage paths before the resource dirs are deleted.
- **Risk:** the lazy public-translations architecture (hard rule) is disturbed by shrinking bundles. **Mitigation:** only locale SETS shrink; the lazy-loading mechanism is untouched and its tests keep passing.

## Definition of Done

Exactly four languages selectable and fully rendering on app + web; retired-locale preferences/URLs fall back to English silently; server allowlist + every pin test enforces the new set; CLAUDE.md + story-template wording updated; `code-reviewer` 100% clean; full local gates green (device gauntlet segment on device return); merged; released.

## Notes

- 2026-07-16 — Filed from the operator's mid-session directive (verbatim in Why). Queued behind the SHY-0187/0192 stack close-out and the Deploy-To-Dev fix per WIP=1. Interim four-locale rule for new strings starts NOW (this session's earlier `security_set_pin` strings landed in all 21 files while the 20-locale contract was still in force; SHY-0194's sweep deletes the 17 retired copies wholesale — no pre-work needed).

- 2026-08-06 — **CANCELLED, superseded by EPIC-0010.** The operator replaced every language mechanism with the shyden.co.uk model (real per-locale URLs on the web; device-locale in the app) and narrowed the set to five MVP languages. See EPIC-0010's Notes for the per-ticket disposition table. Specifically: superseded by SHY-0289, which retires 15 locales and keeps FIVE — 0194 named only four.

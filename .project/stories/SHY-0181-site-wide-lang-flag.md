---
id: SHY-0181
status: In Progress
owner: claude
created: 2026-07-13
priority: P1
type: feature
effort: M
roadmap_ids: []
epic: EPIC-0007
mvp: true
---

# SHY-0181: Site-wide `?lang=` locale flag — every owned web page (public + admin + portal + future) honors the requested language

> **Scope note (EPIC-0007 split):** this story is the **WEB** half — the shared `?lang=` resolver + CI guard + Playwright coverage. The **APP** half (opening the environment-correct pages, appending `?lang=<appLocale>`, dev-page access, legal link/content coverage, device gauntlet) is **[[SHY-0182]]**. The bundled-legal follow-up is **[[SHY-0184]]**.

## User Story

**As** a ShyTalk user whose app language differs from their device language (or who opens a deep link with an explicit locale),
**I want** every ShyTalk web page — the legal/acceptance pages, the public site, the admin panel, the portal, and any page we add later — to render in that requested language,
**So that** I read legal terms, admin tools, and every owned web surface in **my** language, not my device's — which for the **legal-acceptance gate of a minors-facing app is a compliance requirement**, not a nicety.

## Why

The legal-acceptance screen's four links (Privacy Policy, Terms, Community Standards, CyberBullying) open in-app `PlatformWebView`s of `shytalk.shyden.co.uk/{privacy,terms,community-guidelines,cyber-bullying}.html`, but the app passes **no locale**. Each page resolves its language via `window.ShyTalkLanguage.get()` (`public/js/language-selector.js`), which today reads only `localStorage` → `navigator.language`. In an app WebView `navigator.language` is the **device** language and the `localStorage` key is unset — so a user whose **in-app** language (`LanguagePreference`, set via Settings across 20 locales) differs from their device sees the **legal pages in the wrong language**. Same for every other page the app opens or any deep link.

Operator directive (2026-07-13): the locale flag must work on **every web page we own — public site, admin panel, portal — now and in the future.** Investigation found the tidy path: **all 11 owned HTML pages already load the shared `language-selector.js` resolver** (public site, `admin/`, `portal/`, `events/`), and admin (`translations.js`, 77 `data-i18n`) + portal (`portal-translations.js`, 109 `data-i18n`) already have i18n. So honoring `?lang=` in the **single** `getLanguage()` resolver fixes the whole estate at once; a CI guard keeps future pages covered.

## Acceptance Criteria

### Happy path
- [ ] `getLanguage()` in `public/js/language-selector.js` returns the `?lang=<code>` URL-param value when present and valid (one of the 20 supported locales), taking priority over `localStorage` and `navigator.language`.
- [ ] A valid `?lang=` is persisted to `localStorage` so the chosen language sticks across in-site navigation (internal links without the param).
- [ ] Every owned HTML page (public site, `admin/`, `portal/`, `events/`) renders its `data-i18n` content in the `?lang=` language — verified on a representative page per surface, because all load the shared resolver.
- [ ] A CI guard fails if any `public/**/*.html` page does NOT include the shared resolver (`language-selector.js`), so a future page can't silently opt out of `?lang=`.
- [ ] _(App-side `?lang=<appLocale>` passing is [[SHY-0182]].)_

### Error paths
- [ ] An invalid / unsupported `?lang=` value (e.g. `?lang=xx`, `?lang=<script>`) is ignored — falls through to `localStorage` → `navigator.language` → `en`; never applied, never injected into the DOM.
- [ ] A malformed query string / absent `URLSearchParams` (old engine) does not throw — resolution falls through cleanly.

### Edge cases
- [ ] An RTL `?lang=` (ar) sets `document.dir = 'rtl'` (reuses the existing RTL handling), so a forced RTL locale lays out correctly.
- [ ] `?lang=` on the legal pages drives BOTH the page chrome (`data-i18n`) AND the lazy-translated body where applicable.
- [ ] The in-page language picker still works and overrides a `?lang=` afterwards (user choice wins after arrival).

### Performance
- [ ] Resolution stays synchronous + O(1)-ish (a `URLSearchParams.get` + a membership check against the 20-entry list); no added network or render-blocking work.

### Security
- [ ] `?lang=` is validated against the fixed supported-locale allowlist before use OR persistence — an attacker-supplied value can never reach `document.documentElement.lang`, `applyLanguage()`, `localStorage`, or the DOM unless it is an exact known code (no reflected-XSS via the param).

### UX
- [ ] No flash of the wrong language: `?lang=` is resolved on first `getLanguage()` call during initial render, same point the page already resolves language — no visible re-translate flip.

### i18n
- [ ] Works for all 20 supported locales; the allowlist is the single `LANGUAGES` list already in `language-selector.js` (no second source of truth).

### Observability
- [ ] N/A — client-side resolver; a rejected `?lang=` silently falls back (logging a user-supplied value would be noise + a mild info leak). The CI guard (below) is the durable signal that coverage is complete.

## BDD Scenarios

**Scenario: a forced locale renders every surface in that language**
- **Given** the admin panel URL with `?lang=fr`
- **When** it loads
- **Then** its `data-i18n` text shows in French (not the browser default)
- **And** the same holds for a public page (privacy.html) and the portal with `?lang=fr`

**Scenario: the app opens legal pages in the app's language**
- **Given** the app's in-app language is set to German while the device is English
- **When** the user taps the Privacy Policy link on the legal-acceptance screen
- **Then** the Privacy Policy page renders in German

**Scenario: an unsupported locale is ignored safely**
- **Given** a page URL with `?lang=<script>alert(1)</script>`
- **When** it loads
- **Then** the value is never applied and the page falls back to the browser/default language with no script execution

**Scenario: a new page is protected for the future**
- **Given** a newly-added `public/**/*.html` page that forgets the shared resolver
- **When** CI runs the web-page lint
- **Then** it fails, naming the page that must include `language-selector.js`

## Test Plan

Touches `public/**` (website runtime) → **full protocol** on the affected web surfaces (all browsers). App-side + device gauntlet live in [[SHY-0182]].

**Red → Green:**
- **Playwright web (real pages, real browser)** — `tests/web/lang-flag.spec.ts` (NEW): `?lang=fr` on a public page, an `admin/` page, and the `portal` each renders known `data-i18n` strings in French; `?lang=ar` sets `dir=rtl`; an invalid `?lang=` (`?lang=xx`, `?lang=<script>`) falls back + injects nothing; `?lang=` persists across an internal link. Real navigation, no mocks.
- **Resolver unit (jsdom or node)** — pin `getLanguage()` priority order (url > storage > navigator), allowlist rejection, persistence, malformed-query safety — value-level.
- **CI guard** — `scripts/check-web-pages-have-lang-resolver.sh` (NEW) + its meta-test: every `public/**/*.html` must include `language-selector.js`; fails naming any that don't (the "future" guarantee). Wired into `lint.yml`.

## Out of Scope

- **Migrating the legal-acceptance text to bundled/offline (RECOMMENDED FOLLOW-UP — see Notes assessment).** This story makes the WebView locale-correct; it does NOT solve offline-readability or version-audit for the consent gate. Filed as a follow-up.
- Adding NEW translations / new locales — this is plumbing the locale *flag*, not authoring content.
- Server-side `Accept-Language` negotiation — the `?lang=` param is the explicit, testable contract; header negotiation is a separate lever.

## Dependencies

- None hard. Uses the existing `LANGUAGES` allowlist + `applyLanguage()` + RTL handling already in `language-selector.js`, and `LanguagePreference` for the app locale.

## Risks & Mitigations

- **Persisting `?lang=` to localStorage changes the user's site language for later visits** → acceptable: an explicit `?lang=` is a strong intent signal, and the in-page picker still overrides. If session-only is preferred, that's a one-line change; flagged for operator.
- **A page renders language before `getLanguage()` is called** → the resolver is called at the existing first-resolve point; verified no wrong-language flash in the Playwright test.
- **The lazy-translated legal *body* (vs the `data-i18n` chrome) may not honor `?lang=`** → the Playwright legal test asserts the body language too; if the lazy-translation layer needs the param separately, that's covered within this story.

## Definition of Done

- `getLanguage()` honors + persists a validated `?lang=`; all 11 owned pages verified (representative per surface); CI guard green + wired into `lint.yml`; Playwright + resolver-unit green across all browsers; `code-reviewer` 100% clean; merged to develop; released. (App-side passing + device gauntlet: [[SHY-0182]].)

## Notes (running log)

- 2026-07-13 — **Filed from the operator's legal-acceptance-translation instruction, expanded to every owned web surface (public + admin + portal + future).** Root cause: app passes no locale to the legal WebViews; the shared `getLanguage()` resolver reads only localStorage/navigator.language. All 11 owned HTML pages already load that resolver → a single-point fix covers the estate; a CI guard covers future pages.
- 2026-07-13 — **DESIGN ASSESSMENT (operator asked: WebView vs bundled for the legal pages).** Recommendation: **this story keeps the WebView but makes it locale-correct** (the acute, site-wide fix). SEPARATELY I recommend a follow-up story to move the **legal-acceptance-GATE** text to **bundled + version-pinned** in-app content, because a consent gate has three needs a live WebView cannot meet: (1) **offline readability** — a user with no network must still be able to read what they consent to; (2) **auditability** — you must be able to prove the exact text of the version accepted, but a live page can change after acceptance; (3) **translation reliability** — binding legal terms shouldn't depend on lazy machine translation; they need reviewed strings. The WebView remains appropriate for the informational "view policy" links in Settings (online, latest-version acceptable). The bundled migration is the higher-stakes compliance fix; filing it as a follow-up (do NOT fold into this locale-flag infra story).

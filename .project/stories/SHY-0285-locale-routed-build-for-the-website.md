---
id: SHY-0285
status: Draft
owner: claude
created: 2026-08-06
priority: P1
effort: L
type: infra
roadmap_ids: []
epic: EPIC-0010
pr:
---

# SHY-0285: Locale-routed build for the website, proven on one page

## User Story

As a Vietnamese parent deciding whether ShyTalk is safe for my child,
I want the privacy policy to exist at its own Vietnamese address,
So that I can find it in a search, open it, and send the link to my partner.

## Why

Today every ShyTalk page has exactly one URL and swaps its text in the browser.
Three consequences, all bad: search engines index only the English text, so a
Vietnamese search never finds us; the language choice cannot be shared, because
the link carries no language; and a visitor with JavaScript blocked reads
English regardless of what they chose.

shyden.co.uk solves this by building each page once per locale. This story
introduces that machinery and proves it on ONE page — the homepage — so the
pattern is reviewed and settled before it is applied to seven more.

## Acceptance Criteria

### Happy path

- [ ] `public/index.html` is generated, not hand-written, at five URLs: `/`
      (English, unprefixed) and `/zh/`, `/id/`, `/vi/`, `/th/`.
- [ ] Each page's visible text is in its own language, present in the served
      HTML before any script runs.
- [ ] The header carries a language control that moves to the SAME page in
      another language.

### Error paths

- [ ] A string key present in the English table and missing from any other
      fails the build with a message naming the key and the locale.
- [ ] A blank or whitespace-only string in any locale fails the build.
- [ ] An unknown locale prefix (`/fr/`) returns the 404 page, not an empty one.

### Edge cases

- [ ] `/identity`-style paths are not mistaken for the `/id/` prefix.
- [ ] Trailing and non-trailing slash forms resolve consistently.
- [ ] A locale whose translation is longer than English does not overflow the
      layout at 320px.

### Performance

- [ ] The generated page ships no language-switching JavaScript; the language
      costs zero bytes of script.
- [ ] The build completes in under 30s for five locales.

### Security

- [ ] No string is interpolated into markup as HTML; all copy reaches the DOM as
      text, so a translation cannot inject an element.

### UX

- [ ] The language control is reachable by keyboard and meets the 44px touch
      target.
- [ ] Choosing a language lands on the same content, never the homepage.

### i18n

- [ ] English is the reference locale; the other four are checked against it.
- [ ] `canonical`, `hreflang` for all five, `x-default` pointing at English, and
      `og:locale` are emitted on every generated page, asserted BY VALUE.

### Observability

- [ ] The build prints how many pages it generated per locale, and the count is
      asserted so a silently-empty run cannot pass.

## BDD Scenarios

**Scenario: A visitor reads the homepage in Vietnamese**

- **Given** the site has been built
- **When** a visitor opens `/vi/`
- **Then** the page's heading is in Vietnamese
- **And** the served HTML contains that heading before any script runs

**Scenario: The language control keeps the visitor on the same page**

- **Given** a visitor is reading the Thai homepage
- **When** they choose Bahasa Indonesia from the language control
- **Then** they arrive at the Indonesian homepage, not the English one

**Scenario: A missing translation stops the build**

- **Given** the Vietnamese table is missing a key the English table defines
- **When** the site is built
- **Then** the build fails and names the missing key and the locale

**Scenario: Search engines are told the pages are translations**

- **Given** the site has been built
- **When** the Mandarin homepage is inspected
- **Then** it declares its own canonical URL and an alternate for each language
- **And** `x-default` points at the English homepage

## Test Plan

**RED first:**

- `tests/web/locale-routing.spec.ts` — `/zh/`, `/id/`, `/vi/`, `/th/` return 200
  with the expected heading; fails before the generator exists.
- `tests/web/head-alternates.spec.ts` — canonical, four hreflang, x-default and
  og:locale asserted by exact value for all five pages.
- `express-api/tests/scripts/locale-tables.test.js` — reference-locale parity:
  a table missing a key, and a table with a blank value, each fail the build.
- `tests/web/language-control.spec.ts` — from each locale, switching lands on
  the same page in the target locale (20 pairs).

**GREEN:**

- Generator + string tables + header control until all of the above pass.

**Regression:** full Playwright suite on all five engines; the existing
`shared-header` specs must stay green.

## Out of Scope

- The other seven pages (SHY-0286).
- Removing the old globe modal and `?lang=` flag (SHY-0287) — they coexist for
  one story so this one stays reviewable.
- The app (SHY-0288) and deleting old locales (SHY-0289).
- Runtime translation of user-generated content (EPIC-0002) — unaffected.

## Dependencies

- None. This is the foundation the rest of EPIC-0010 builds on.

## Risks & Mitigations

- **A build step is new for `public/`.** Mitigation: it emits plain static HTML
  to the same directory Cloudflare Pages already serves, so deployment is
  unchanged; the generator is the only new moving part.
- **Five locales x eight pages is a lot of generated files to review.** This
  story generates ONE page, so the pattern is reviewed on 5 files, not 40.
- **A generator can silently emit nothing.** Mitigation: the page-count
  assertion in the Observability AC — a zero-page build fails.

## Definition of Done

- [ ] All AC met; all named tests written RED first, then green.
- [ ] Full pre-merge gauntlet: local (real Android + real iPhone + all browsers)
      then dev, per the Pre-Merge Testing Protocol.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded in Notes.
- [ ] CI green by name: Detect Changes, Analyze JavaScript, PR Gate.

## Notes (running log)

- 2026-08-06 — Created under EPIC-0010 after the operator chose the full shyden
  model over a same-URL redress, knowing it requires a build step.

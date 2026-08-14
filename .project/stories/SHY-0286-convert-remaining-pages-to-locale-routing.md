---
id: SHY-0286
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

# SHY-0286: Convert the remaining seven pages to locale routing

## User Story

As a Thai teenager checking what ShyTalk does with my data,
I want the terms, privacy and safety pages in Thai at their own addresses,
So that the pages that decide whether I trust this app are ones I can read.

## Why

SHY-0285 proves the pattern on the homepage. The pages that matter most for
trust are the other seven — terms, privacy, community guidelines,
cyber-bullying, do-not-sell, roadmap and 404 — and they are exactly the pages a
worried parent or a regulator reaches for. Leaving them English-only would mean
the legal surface of a minors-facing app is readable by a fraction of its users.

## Acceptance Criteria

### Happy path

- [ ] All seven remaining pages are generated at five URLs each, in their own
      language, from the same tables and generator as SHY-0285.
- [ ] Every internal link on every page is locale-aware — an Indonesian visitor
      never lands on an English page by following a link.

### Error paths

- [ ] The 404 page answers in the visitor's language where the prefix says so,
      and declares `noindex` with no canonical or hreflang, because it is not a
      real address.
- [ ] A page whose translation is missing fails the build, as in SHY-0285.

### Edge cases

- [ ] The roadmap page's own chrome is build-time translated while its story
      list stays runtime-translated (EPIC-0002) — the two do not fight.
- [ ] Legal copy containing company numbers and addresses renders with its
      spacing intact in every locale.

### Performance

- [ ] Forty generated pages build in under 60s.

### Security

- [ ] Legal text is verified verbatim against the source of record per locale;
      no translation silently alters a legal fact.

### UX

- [ ] No horizontal scroll at 320/375/768/1280 on any page in any locale.
- [ ] The header language control is present and consistent on all 40 pages.

### i18n

- [ ] Every one of the 40 pages carries canonical, four hreflang, x-default and
      og:locale, asserted BY VALUE.
- [ ] A sitemap lists all 40 URLs and declares the language relationships.

### Observability

- [ ] The build asserts 8 pages x 5 locales = 40; a short build fails.

## BDD Scenarios

**Scenario: The privacy policy is readable in Thai**

- **Given** the site has been built
- **When** a visitor opens the Thai privacy policy
- **Then** its heading and body are in Thai

**Scenario: Following a link keeps the visitor's language**

- **Given** a visitor is reading the Indonesian terms page
- **When** they follow the link to the privacy policy
- **Then** they arrive at the Indonesian privacy policy

**Scenario: The sitemap pairs the translations**

- **Given** the site has been built
- **When** the sitemap is read
- **Then** it lists forty addresses
- **And** each page is paired with its translation in the other four languages

**Scenario: An unknown address answers without claiming to be a page**

- **Given** the site has been built
- **When** a visitor opens an address that does not exist
- **Then** the page asks not to be indexed and declares no canonical address

## Test Plan

**RED first:**

- `tests/web/locale-routing.spec.ts` — extend to all 40 URLs with a
  per-page-per-locale heading assertion.
- `tests/web/head-alternates.spec.ts` — extend the by-value head assertions to
  all 40.
- `tests/web/locale-aware-links.spec.ts` — from each locale, every internal link
  on every page stays inside that locale.
- `tests/web/sitemap.spec.ts` — 40 `<loc>` entries and the alternate pairs.
- `tests/web/legal-copy.spec.ts` — whole-sentence assertions for the legal
  disclosure in each locale.

**GREEN:** convert the seven pages; extend the tables.

**Regression:** full Playwright suite, five engines.

## Out of Scope

- Removing the old machinery (SHY-0287).
- Runtime translation of roadmap story content (EPIC-0002).
- The app (SHY-0288).

## Dependencies

- SHY-0285 — the generator, tables and header control.

## Risks & Mitigations

- **Legal copy translated wrongly is a compliance risk, not a typo.**
  Mitigation: legal pages get whole-sentence assertions per locale, and the
  translations are flagged for native-speaker review before the epic closes.
- **40 pages is a large diff.** Mitigation: the pattern was reviewed in
  SHY-0285, so this story is application, not design.

## Definition of Done

- [ ] All AC met; tests written RED first.
- [ ] Full pre-merge gauntlet local then dev.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded.
- [ ] CI green by name.

## Notes (running log)

- 2026-08-06 — Created under EPIC-0010.

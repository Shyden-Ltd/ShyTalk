---
id: SHY-0287
status: Draft
owner: claude
created: 2026-08-06
priority: P1
effort: M
type: refactor
roadmap_ids: []
epic: EPIC-0010
pr:
---

# SHY-0287: Delete the old web language machinery

## User Story

As a developer changing a sentence on the ShyTalk website,
I want exactly one place where that sentence lives,
So that I cannot fix the English and leave four other copies saying the old thing.

## Why

Once SHY-0285 and SHY-0286 land, ShyTalk's website has TWO language systems
running at once: the new build-time one, and the globe modal with its
`localStorage` preference, `?lang=` flag and per-page `*-translations.js`
files. Two systems is worse than either alone — they disagree, and a visitor can
reach a state where the URL says one language and the stored preference says
another.

Leaving the old one in place "just in case" is how the current four-system mess
was built. It goes.

## Acceptance Criteria

### Happy path

- [ ] `public/js/language-selector.js`, `public/css/language-selector.css`,
      `homepage-translations.js`, `legal-translations.js`,
      `event-translations.js` and `suggestions-i18n.js` are deleted.
- [ ] No page renders a globe button; language is chosen by the header control
      alone.

### Error paths

- [ ] A visitor arriving at a stale bookmarked `?lang=vi` URL is served the page
      normally; the flag is ignored, not honoured and not an error.
- [ ] A stale `localStorage` language preference from a previous visit changes
      nothing.

### Edge cases

- [ ] The seasonal-theme and shared-header scripts, which are NOT language
      machinery, keep working.
- [ ] The suggestions board keeps its runtime translation of user posts —
      only its static chrome moves to build-time strings.

### Performance

- [ ] Every page ships less JavaScript than before; asserted as a byte
      comparison, not assumed.

### Security

- [ ] No remaining code path writes a language preference into `localStorage`.

### UX

- [ ] A visitor who had chosen a language previously is not stranded in
      English: the header control is visible on every page.

### i18n

- [ ] `grep -r` across `public/` finds no `applyLanguage`, no `?lang=`, no
      `language-selector`, and no reference to a deleted translations file.

### Observability

- [ ] A test asserts the absence by grep, so re-adding any of them fails CI.

## BDD Scenarios

**Scenario: The globe is gone**

- **Given** the old machinery has been removed
- **When** a visitor opens any ShyTalk page
- **Then** no floating language button is shown
- **And** the header language control is

**Scenario: A stale language link still works**

- **Given** a visitor has an old bookmark carrying a language flag
- **When** they open it
- **Then** the page loads normally in the language of its address

**Scenario: A deleted script cannot come back unnoticed**

- **Given** the old machinery has been removed
- **When** a developer re-adds a reference to the language selector
- **Then** the test suite fails

## Test Plan

**RED first:**

- `tests/web/no-legacy-language-machinery.spec.ts` — greps `public/` for each
  removed name and for `applyLanguage`/`?lang=`; RED while they exist.
- `tests/web/no-globe-button.spec.ts` — the button is absent on all 40 pages.
- `tests/web/stale-lang-flag.spec.ts` — `?lang=vi` on the English page serves
  English and does not throw.
- `tests/web/script-weight.spec.ts` — per-page script bytes are lower than the
  recorded baseline.

**GREEN:** delete the files and their references.

**Regression:** full Playwright suite, five engines; suggestions board and
roadmap runtime translation still work.

## Out of Scope

- The app (SHY-0288).
- The lazy translation service for user content (EPIC-0002) — untouched.

## Dependencies

- SHY-0286 — all pages must be locale-routed before the old system is removed,
  or non-English content disappears.

## Risks & Mitigations

- **Removing the old system before every page is converted would lose
  translations.** Mitigation: hard dependency on SHY-0286; the grep test is
  written to run only after all 40 pages exist.
- **A deleted file may be referenced from somewhere unsearched.** Mitigation:
  the grep test covers `public/` wholesale rather than a list of pages.

## Definition of Done

- [ ] All AC met; tests written RED first.
- [ ] Full pre-merge gauntlet local then dev.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded.
- [ ] CI green by name.

## Notes (running log)

- 2026-08-06 — Created under EPIC-0010.

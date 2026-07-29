---
id: SHY-0252
status: In Progress
owner: claude
created: 2026-07-29
priority: P1
effort: S
type: bug
roadmap_ids: []
epic: EPIC-0008
---

# SHY-0252: Switching language leaves the suggestions board in English

## User Story

**As a** person reading the roadmap in a language other than English
**I want** the suggestions board to actually change language when I switch it
**So that** I can read the filters, buttons and statuses in my own language instead of guessing.

## Why

Surfaced 2026-07-29 while writing the seven empty i18n tests under SHY-0245.

Switching language changed `document.documentElement.lang` and re-translated
every element carrying `data-i18n` — and left the entire suggestions board in
the previous language until the reader happened to reload. Four independent
defects, each sufficient on its own:

1. **No re-render on switch.** Every string on the board is produced by `sgT()`
   *at render time*. `setLanguage` (`public/js/language-selector.js`) called
   `window.applyLanguage`, which only walks `[data-i18n]` elements — nothing told
   the board to rebuild, so its filters, buttons and badges kept the old locale.

2. **Frozen option lists.** `STATUS_OPTIONS`, `TAG_OPTIONS`, `LANG_OPTIONS`,
   `PHASE_OPTIONS` and `CHANNEL_LABELS` were module-level `var`s built with
   `sgT()` **once at script load**. Even a re-render could not fix them: the
   strings were already baked in. The status filter read "All statuses" in every
   language.

3. **Login modal translated only for screen readers.** The Google/Apple buttons
   set `aria-label` from `sgT()` while their VISIBLE `<span>` text was hardcoded
   English, as was the "Sign in with your ShyTalk account to…" prompt. A German
   speaker using a screen reader heard German; a German speaker looking at the
   screen read English.

4. **Status badges hardcoded.** The card badge rendered literal
   `"Shipped!"`/`"Planned"`/`"Declined"` regardless of locale, on an otherwise
   translated card.

Nothing caught any of it because the seven tests covering this area had **empty
bodies** — a comment describing the intended assertion and no code — so they
reported green while proving nothing.

## Acceptance Criteria

### Happy path

- [ ] Switching to German translates the board's buttons (`+ Vorschlagen`), search placeholder, filter labels (`Alle Status` / `Alle Tags` / `Alle Sprachen`) and status badges without a reload.
- [ ] The login modal's visible button text is translated, matching its `aria-label`.
- [ ] Switching back to English restores the English strings.

### Error paths

- [ ] A locale with no entry for a key falls back to English, then to the key — the existing `sgT` chain — rather than rendering blank.
- [ ] A failure inside a board re-render cannot leave the board blank; the language switch itself still applies.

### Edge cases

- [ ] Badge copy keeps its distinct wording: the badge says "Shipped!"/"Declined" where the FILTER says "Completed"/"Rejected", so badges use dedicated `badge_*` keys rather than reusing filter keys.
- [ ] An RTL locale sets `dir` on the document, and per-card descriptions carry `dir="auto"` so mixed-direction content still reads correctly.
- [ ] Switching language twice in a row leaves no stale strings from either previous locale.

### Performance

- [ ] The option lists are rebuilt per render rather than per loop iteration (hoisted to a local), so making them dynamic does not turn an O(n) render into O(n²).

### Security

- [ ] Every translated string continues to pass through `escapeHtml` before insertion — a translation file is still untrusted input to the DOM.
- [ ] N/A otherwise — no authz surface changes.

### UX

- [ ] The switch takes effect immediately; no reload, no flash of the previous language on the board.

### i18n

- [ ] `badge_pending|accepted|planned|completed|rejected` exist for `en` and `de`; every other locale resolves through the English fallback until translated.

### Observability

- [ ] N/A — a language switch is an ordinary user action; the existing console/error reporting already covers a failed render.

## BDD Scenarios

**Scenario: the board follows the language switch**
- **Given** I am reading the roadmap in English
- **When** I switch the language to German
- **Then** the suggest button reads "+ Vorschlagen"
- **And** the status filter's first option reads "Alle Status"
- **And** I did not have to reload the page

**Scenario: status badges translate**
- **Given** a planned suggestion is on the board
- **When** I switch to German
- **Then** its badge reads "Geplant" rather than "Planned"

**Scenario: the login prompt translates for everyone, not just screen readers**
- **Given** I have switched to German
- **When** I press the suggest button while signed out
- **Then** the sign-in buttons READ "Mit Google anmelden" and "Mit Apple anmelden"

**Scenario: an untranslated locale falls back rather than blanking**
- **Given** a locale with no `badge_completed` entry
- **When** a completed suggestion renders
- **Then** its badge shows the English "Shipped!" rather than an empty badge

## Test Plan

**RED first** — `tests/web/suggestions-security.spec.ts`, the seven tests whose
bodies were empty, now written against the real German strings in
`public/js/suggestions-i18n.js`:

- `switch language: all buttons translated`
- `switch language: all status badges translated`
- `switch language: info banner translated`
- `switch language: filter labels translated`
- `switch language: suggestion form labels translated`
- `switch language: subscribe modal labels translated`
- `switch language: error messages translated`

**GREEN:**
1. `setLanguage` dispatches `shytalk-language-changed` after applying the locale.
2. The board listens for it and calls `renderBoard()`.
3. The five frozen option lists become functions evaluated per render.
4. The login modal's visible text and the status badges read from `sgT()`.

**Mutation checks:** removing the event dispatch must fail the filter-label test;
reverting any option list to a load-time `var` must fail it too; restoring either
hardcoded English literal must fail its corresponding test.

## Out of Scope

- Translating the `.sg-info-banner` copy, which is still a hardcoded English sentence with no i18n key (filed as a follow-up — it needs a new key across the locale set, not just a wiring change).
- Adding `badge_*` translations beyond `en`/`de`; the fallback covers the rest until a translation pass.
- The 20-locale translation sweep tracked separately under SHY-0194.

## Dependencies

- None. `sgT`, `applyLanguage` and the locale table already exist; this wires them to the board.

## Risks & Mitigations

- **Risk:** re-rendering the board on every language change discards transient UI state (an open modal, a half-typed comment).
  **Mitigation:** the same `renderBoard()` already runs on `shytalk-auth-changed`, so the behaviour is established rather than new; language switches are rare and deliberate.
- **Risk:** reusing filter keys for badges would silently change English copy that other tests pin ("Shipped!" → "Completed").
  **Mitigation:** dedicated `badge_*` keys, with a test asserting the English wording is unchanged.

## Definition of Done

- [ ] All seven previously-empty tests written and passing.
- [ ] Board follows a live language switch with no reload.
- [ ] English copy unchanged (the "Shipped!" badge test still passes).
- [ ] Mutations killed.
- [ ] `npx playwright test` green on chromium.
- [ ] LOCAL gauntlet green on real Android + real iPhone + all browsers.
- [ ] `code-reviewer` 100% clean.

## Notes

- 2026-07-29 — Found by writing bodies for seven `test.fixme`s that had none. An empty test body is the purest form of the silently-passing defect: it cannot fail, and it occupies the slot where the real test would have gone.

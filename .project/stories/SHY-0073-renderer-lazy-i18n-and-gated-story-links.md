---
id: SHY-0073
status: Draft
owner: claude
created: 2026-06-10
priority: P1
effort: M
type: feature
roadmap_ids: []
pr:
epic: EPIC-0002
public: true
phase: Website & Presence
---

# SHY-0073: Roadmap renderer — lazy item translations + gated GitHub story links

## User Story

As a non-English visitor to shytalk.com/roadmap, I want story-derived entries shown in my language (fetched lazily, cached server-side) and a clear once-per-session heads-up before I follow a link to an English-only story on GitHub, so the page stays fully native while the underlying specs remain English.

## Why

Companion to SHY-0072 (the service) — this is the consumption half plus the operator-specified link gating: "roadmap page needs to still be fully translated always… only the github stories are english only… have a pop-up informing the user it will be in English only and confirm before they visit the page." Items gained badges in SHY-0061 but no links; migrated items (SHY-0062 batches) will be English-sourced, so without this story non-English visitors would see English names — violating the always-translated rule.

## Acceptance Criteria

### Happy path
- [ ] When `currentLang !== 'en'`, after render the page collects every item-derived visible string (item names + descriptions from `items[]`/`currentlyWorkingOn`) and calls `POST /api/translate` ONCE (batched); returned translations are applied in place (text-node swap — same `escapeHtml` discipline as initial render).
- [ ] Legacy `features[]` entries keep their existing embedded `i18n` payloads (untouched path); only story-derived items use the service. As migration batches land, the service path naturally takes over.
- [ ] Each item row's shyId badge becomes an anchor to the story file on GitHub (`https://github.com/Shyden-Ltd/ShyTalk/blob/main/.project/stories/<slug>.md`; the sync emits the slug — extend `sync-shy-to-roadmap-data.mjs` to include `slug` per item, additive field).
- [ ] For `currentLang === 'en'`: links navigate directly; NO translate call is made at all (zero overhead for the majority locale).
- [ ] For non-English: first story-link click in a session shows a translated confirm dialog ("This story is available in English only — continue?" — dialog strings added to the renderer's LABELS map ×21, per-locale-block coverage test extended); confirm → navigates (new tab) and sets `sessionStorage` so later clicks pass straight through; cancel → stays, no navigation.

### Error paths
- [ ] Translate call fails/times out (service down, network): page KEEPS the English strings it already rendered — no spinner, no layout shift, no user-visible error; a single `console.error('[translate] …')` fires (the operator's dev-console surface) and the page reads `X-Translation-Missed` / `missed` to log WHICH strings fell back.
- [ ] Partial response (`missed` non-empty): translated strings apply, missed ones stay English — per-string granularity, never all-or-nothing.
- [ ] `sessionStorage` unavailable (privacy mode): dialog falls back to once-per-page-load (never blocks navigation permanently).

### Edge cases
- [ ] Items rendered in BOTH the In Progress lift and a phase body translate consistently (one batched call covers both; same text = same translation by construction).
- [ ] RTL locales (ar): translated strings render correctly in the existing RTL layout (Playwright assertion in `ar`).
- [ ] An item whose name the service echoes back unchanged displays without a re-render loop (apply-once semantics).
- [ ] Dialog is keyboard-accessible (focus-trapped, Esc cancels) and announced via `role="dialog"` + translated `aria-label` — matches the page's existing a11y conventions.

### Performance
- [ ] Exactly ONE translate request per page view per non-English locale (batched); cache-warm responses apply within one frame budget (no observable flash for repeat visitors); cold first-view may visibly swap (accepted — lazy-by-design).

### Security
- [ ] Translated strings are inserted via text nodes/`textContent` (or `escapeHtml`-piped) — service output is treated as untrusted (defence-in-depth; the provider is third-party).
- [ ] GitHub links carry `rel="noopener noreferrer"` + `target="_blank"`.

### UX
- [ ] Dialog copy is plain and friendly; confirm/cancel buttons translated; no dark patterns (cancel is equally prominent).

### i18n
- [ ] New LABELS keys (`storyEnglishOnlyTitle`, `storyEnglishOnlyBody`, `continueBtn`, `cancelBtn` — exact names at implementation) present in ALL 21 locale blocks, enforced by extending the per-locale-block structural test (same mechanism as `storyBadge`).

### Observability
- [ ] `console.error` on translate failure (dev-console surface per operator); `console.info` with missed-count when `missed` non-empty. Console-errors-all-pages sweep updated expectation: the sweep must still pass with the service MOCKED HEALTHY (a failing service in that sweep is a finding, not noise).

## BDD Scenarios

**Scenario: German visitor sees German items**
- **Given** the translate service (mocked) returns German for the fixture item names
- **When** the roadmap renders with locale `de`
- **Then** one batched POST occurs and item rows display the German names
- **And** legacy feature rows still show their embedded German payloads

**Scenario: service down — page intact in English**
- **Given** the translate route is mocked to 503
- **When** the page renders with locale `fr`
- **Then** items display English, layout unbroken, exactly one console.error fires, and the test's error-collection (filtered per the network-noise convention) records the translate failure as the ONLY console error

**Scenario: gated link, once per session**
- **Given** locale `ar` and a rendered item link
- **When** the visitor clicks it
- **Then** a translated RTL confirm dialog appears; cancel keeps them on the page
- **And** after confirming once, a second item click navigates with no dialog

**Scenario: English visitors pay zero cost**
- **Given** locale `en`
- **When** the page renders and a story link is clicked
- **Then** no translate request is made and navigation is direct

## Test Plan

**Red first:** extend `tests/web/roadmap-shy-items.spec.ts` patterns into `tests/web/roadmap-i18n-lazy.spec.ts` (page.route mocks for BOTH roadmap-data.json AND /api/translate; scenarios above incl. ar/RTL + dialog a11y + sessionStorage privacy-mode via context override) + extend `express-api/tests/scripts/web-i18n-coverage.test.js` for the new LABELS keys ×21 + a sync-script test pinning the additive `slug` field (`sync-shy-to-roadmap-data` test file — locate at pickup-review).
**Green:** roadmap-app.js (batched fetch + apply + dialog + links), LABELS ×21, sync-script slug emission, dialog CSS (neutral tokens).
**Verify-by-running:** local stack with the REAL service (SHY-0072) — walk de + ar journeys per every-commit-tested; console sweep green.

## Out of Scope

- Translating page chrome (already translated via LABELS) or legacy features[] (embedded i18n stays).
- The service itself (SHY-0072 — hard dependency).
- Story-detail pages on shytalk.com (links go to GitHub by design).

## Dependencies

- **SHY-0072 merged** (the endpoint this consumes) — hard blocker.
- SHY-0061 (badges, merged v0.97.9) — extends its row markup.
- Pickup-review must verify: SHY-0061's final DOM shape, the sync test file location, dialog-precedent in the codebase (language-selector modal patterns to reuse).

## Risks & Mitigations

- **Risk:** visible English→translated swap on cold views. **Mitigation:** accepted by design (lazy); cache makes it once per locale ever.
- **Risk:** dialog annoys multilingual users. **Mitigation:** once per session + sessionStorage; copy is one short sentence.
- **Risk:** console sweep starts flaking from translate noise. **Mitigation:** sweep runs with healthy-mocked service; real-failure noise is filtered by the established network-noise convention.

## Definition of Done

- [ ] All AC checked; red→green; Playwright + i18n + sync tests green; console sweep green; reviewer ZERO; auto-merged; local de+ar journey walk evidence in Notes.
- [ ] `status: Done` deferred to release cut; SHY-INDEX + EPIC-0002 synced.

## Notes (running log)

- 2026-06-10 ~10:20 BST — Authored fully-refined per the operator's corrected design (page always translated; stories English-only; gated links). Dialog + link scope confirmed by operator ("Yes — link + gated confirm").

---
id: SHY-0038
status: Draft
owner: claude
created: 2026-06-08
priority: P1
effort: S
type: feature
roadmap_ids: []
epic: EPIC-0001
pr:
---

# SHY-0038: Refactor public roadmap webpage to surface GitHub Project board link + extend JSON schema for future EPIC/SHY grouping

## User Story

As **(a)** a ShyTalk maintainer triaging contributor questions about roadmap status, and **(b)** an outside contributor / observer of the project, I want **a prominent link from the public `shytalk.com/roadmap` webpage to the canonical ShyTalk Stories GitHub Project board** so that anyone reading the public roadmap can drill into the live triage view without having to know the org/repo URL, and so that future per-EPIC and per-SHY surfacing on the webpage can land incrementally without re-shaping the JSON each time.

## Why

[[feedback-stories-epics-and-two-surface-sync]] HARD GLOBAL rule (operator 2026-06-07 ~20:48 BST): "every SHY status flip MUST sync to BOTH the public roadmap webpage on shytalk.com AND the GitHub Project board on the repo page". Today the two surfaces are unlinked — a reader of the public roadmap has no path to the board. This SHY closes the gap with the smallest visible UI affordance (footer link) and extends the data schema so future SHYs (SHY-0042+ reserved for grouping UI) can render EPIC/SHY badges without another JSON migration.

**Scope alternatives explored** (recorded for architect/operator review):

- **Option A (Minimal — link only)** — single footer link "View on GitHub Project". ~3 lines HTML + ~1 i18n key per locale. Zero JSON schema change. Rejected as standalone: would force a JSON migration the very next SHY (SHY-0042) when grouping UI lands.
- **Option B (Link + schema extension — CHOSEN)** — A + add optional `epicId` (`^EPIC-[0-9]{4}$`) and `shyId` (`^SHY-[0-9]{4}$`) string fields per item in `roadmap-data.json`. No rendering of the new fields in this PR. Sets up the field shape so SHY-0042 can pure-CSS+JS add badges. ~10 lines impl + ~150 line spec.
- **Option C (Link + schema + EPIC grouping UI)** — full grouping-by-EPIC redesign with phase/EPIC toggle. ~500 LOC. Rejected per [[feedback-rate-limit-slowdown-strategies]] (~150-line spec budget) and per [[feedback-quality-explore-alternatives-validate]] — operator should see EPIC badges in a smaller PR first before a UI redesign.

Option B is the smallest change that delivers the operator's rule + unblocks the future without re-work.

## Acceptance Criteria

### Happy path

- [ ] `public/roadmap.html` footer (or near the existing subscribe area) gains a visible link element with text "View on GitHub Project" (i18n key `viewProjectBoard`) targeting the canonical ShyTalk Stories Project URL (operator-confirmed URL written into the link's `href`; current best-guess `https://github.com/orgs/Shyden-Ltd/projects/3` based on SHY-0032 Stage 2 board creation — verify before push).
- [ ] Link opens in a new tab (`target="_blank" rel="noopener noreferrer"`).
- [ ] Link is keyboard-focusable, has a visible focus ring matching the existing link styles, and has an `aria-label` localised via the `viewProjectBoardAria` key.
- [ ] `public/roadmap-data.json` schema gains two OPTIONAL per-item fields: `epicId` (string, `^EPIC-[0-9]{4}$`) and `shyId` (string, `^SHY-[0-9]{4}$`). At least one item is updated as a worked example (e.g., the first `currentlyWorkingOn` entry gains `epicId: "EPIC-0001", shyId: "SHY-0038"` if applicable, else two demonstration items elsewhere).
- [ ] i18n: the new `viewProjectBoard` + `viewProjectBoardAria` keys exist in EVERY language already present in `public/roadmap.html`'s i18n table (English baseline + the 10 existing locales: ar/de/es/fr/hi/id/ja/ko/pt/zh).
- [ ] No regression: existing rendering of phases, items, donut chart, legend, sticky-nav remains pixel-equivalent on desktop AND mobile breakpoints (verified by Playwright visual smoke + manual viewport check at 360px, 768px, 1280px).

### Error paths

- [ ] If `roadmap-data.json` fetch fails (network error), the page renders existing skeleton/error state unchanged — link to GH Project still appears in footer (independent of data fetch).
- [ ] If `epicId` or `shyId` on an item is malformed (fails regex), the page MUST render the item normally (treating the bad field as absent), MUST NOT throw, MUST log to `console.warn` with the offending value for triage.
- [ ] Schema validator (`scripts/check-roadmap-data.mjs` — if exists; otherwise authored fresh in scope or deferred to SHY-0039) accepts the extended schema. If validator doesn't exist yet, document deferral to SHY-0039 in Out of Scope.

### Edge cases

- [ ] Locale fallback: if a user's locale lacks `viewProjectBoard`, fall back to English string (matches existing i18n fallback chain).
- [ ] RTL languages (Arabic): footer link reads right-to-left correctly, icon (if any) flipped via existing RTL CSS pattern.
- [ ] Print stylesheet: link to GH Project may be hidden in print (`@media print`) — consistent with how the subscribe button behaves today.
- [ ] Items can have `epicId` without `shyId` and vice versa — both fields are independently optional.
- [ ] Items can have both, or neither.

### Performance

- [ ] No new network requests from the link itself (it's a plain `<a href>`).
- [ ] JSON file size increase: <2KB net for adding both fields on the worked-example items (~2 fields × ~12 chars × ~3 items = ~70 bytes; budget covers larger demonstration).
- [ ] First Contentful Paint unaffected (link in footer renders after the data-driven phase grid).

### Security

- [ ] `rel="noopener noreferrer"` mandatory on the new external link to prevent reverse tabnabbing.
- [ ] No user-controlled data is rendered into the link's href — it's a literal hardcoded URL in `public/roadmap.html`.
- [ ] CSP impact: the existing `public/_headers` Content-Security-Policy must continue to allow the GH Project URL as a navigation target (HTTP nav, not iframe — so no `frame-src` change needed; verify `connect-src` is unaffected since the link is not a fetch).

### UX

- [ ] Link uses the existing primary-link colour + hover state (matches subscribe/footer styling).
- [ ] Mobile: link has ≥44px touch target (WCAG AA).
- [ ] Tooltip on hover (`title=` attr) localised, explains "Opens the public GitHub Project board for ShyTalk Stories".

### i18n

- [ ] Two new keys (`viewProjectBoard`, `viewProjectBoardAria`) added to the i18n table in `public/roadmap.html` for EN + 10 existing locales (ar/de/es/fr/hi/id/ja/ko/pt/zh). Translations may use machine translation for the first pass; flag in PR description so the operator can correct any non-natural phrasing later.
- [ ] No string concatenation in the rendered link text — full sentence is one i18n key.

### Observability

- [ ] Add a one-time `console.info` on page load reporting the schema version: `roadmap-data.json schema v2 (with epicId/shyId)` so a future migration is detectable in the browser console.
- [ ] No analytics/tracking is added (consistent with the existing roadmap page which is analytics-free).

## BDD Scenarios

**Scenario: Anonymous visitor sees the GitHub Project link**

- Given I navigate to shytalk.com/roadmap
- When the page finishes loading
- Then I see a footer link with text "View on GitHub Project"
- And the link's `href` points to the canonical Shyden-Ltd ShyTalk Stories project URL
- And the link has `target="_blank"` and `rel="noopener noreferrer"`

**Scenario: Schema accepts extended optional item fields**

- Given `roadmap-data.json` contains an item with `epicId: "EPIC-0001"` and `shyId: "SHY-0038"`
- When the page renders
- Then the item appears in the phase list exactly as before (no new badge in this PR)
- And the browser console contains no errors

**Scenario: Malformed schema field is tolerated, not fatal**

- Given `roadmap-data.json` contains an item with `epicId: "not-an-epic"` (fails the `^EPIC-[0-9]{4}$` regex)
- When the page renders
- Then the item appears in the phase list (bad field treated as absent)
- And `console.warn` was called naming the offending value
- And no uncaught exception is thrown

**Scenario: i18n fallback for missing locale string**

- Given a user's browser locale lacks the `viewProjectBoard` translation
- When the page renders
- Then the link text falls back to the English baseline string

**Scenario: Keyboard navigation reaches the new footer link**

- Given I land on `shytalk.com/roadmap` with keyboard focus
- When I tab through the page
- Then the new footer link becomes focusable in document-order with a visible focus ring
- And pressing Enter opens the GH Project URL in a new tab

## Test Plan

- **Jest (express-api/tests/scripts/check-roadmap-data.test.js — NEW)**: schema validator unit tests covering `epicId`/`shyId` accept/reject; malformed regex rejection; both-fields-optional combinatorics. Mirrors `check-story-frontmatter.test.js` patterns. Target ≥20 cases.
- **Playwright smoke (existing public-pages spec)**: add 4 cases — link present + correct href + opens-in-new-tab attrs + keyboard-focus visible. Visual diff at 360/768/1280 for regression check.
- **Manual QA**: operator opens `public/roadmap.html` locally (or staging), tabs through to the new link, verifies open-in-new-tab works, verifies RTL (ar) renders cleanly.
- **i18n parity check**: a small bash assertion in `lint.yml` verifies the new keys exist in all 11 locale objects (EN + 10).

## Out of Scope

- **Visual redesign / EPIC grouping UI** — deferred to SHY-0042 (reserved). This PR does not render any new badges or grouping; it ONLY adds the footer link and the optional JSON schema fields.
- **Backfilling `epicId`/`shyId` across all existing items** — only worked-example items get the new fields here. Mass backfill deferred to SHY-0043 (reserved).
- **CI auto-sync of `roadmap-data.json` from SHY frontmatter** — that is SHY-0039.
- **Schema-versioning in the JSON itself** (e.g. top-level `"schemaVersion": 2`) — explicit field reserved for the SHY-0039 CI workflow; this PR keeps the JSON top-level shape unchanged.

## Dependencies

- ✅ SHY-0037 (EPIC concept defined, validator landed; PR #1043 merged 2026-06-08 18:10 BST). Without this, `epicId` field would have no semantic anchor.
- 🚧 **Operator confirmation of the canonical GH Project URL** — best-guess is `https://github.com/orgs/Shyden-Ltd/projects/3` based on the SHY-0032 Stage 2 board creation memory entry, but the `gh` CLI's `read:project` scope is missing locally so I cannot enumerate via API. Operator to confirm or correct before push.
- ⬜ SHY-0039 (CI auto-sync) is a downstream consumer; this PR's schema extension MUST be backward-compatible so SHY-0039 can land without re-migrating items.

## Risks & Mitigations

- **Risk: GH Project URL guess wrong** → footer link 404s. Mitigation: operator verification step gates push; AC line for verified URL is explicit.
- **Risk: i18n translations for the new keys read awkwardly** → minor UX impact for non-EN users. Mitigation: PR description flags machine-translated strings for native-speaker review; operator can correct via follow-up SHY.
- **Risk: optional fields trigger schema validator failures** if there is an existing strict schema in CI. Mitigation: grep CI for any existing JSON schema gate on `roadmap-data.json` before push; if found, extend it; if absent, plan it in SHY-0039.
- **Risk: footer link visually crowds the subscribe button on mobile** → layout breakage at narrow viewports. Mitigation: 360px screenshot diff in the test plan; iterate position (could move above subscribe, or stack vertically below) per visual review.
- **Risk: SHY-0037 status flip rolled into this PR introduces unrelated diff noise** → reviewer confusion. Mitigation: PR description explicitly enumerates the rolled-in status flip (~3 lines: frontmatter `status`, frontmatter `pr`, INDEX row) as a separate logical block; commit message has a `chore(status):` co-trailer.

## Definition of Done

- [ ] `public/roadmap.html` footer contains the new link (text, i18n, attrs all per AC).
- [ ] `public/roadmap-data.json` schema accepts optional `epicId`/`shyId`; at least one worked example uses them.
- [ ] 11 locales (EN + 10) have both new i18n keys.
- [ ] Jest schema validator test file authored + passes (≥20 cases).
- [ ] Playwright public-pages smoke covers link presence + attrs + visual diff.
- [ ] `lint.yml` i18n parity assertion added (or existing one extended).
- [ ] No regression on existing roadmap rendering (Playwright visual diff clean at 360/768/1280).
- [ ] SHY-0037 status flipped to Done with PR #1043 link (rolled into this PR per established pattern; INDEX row updated; EPIC-0001 no-op since child_shys already lists SHY-0037).
- [ ] CI green; reviewer ZERO findings (dispatched BEFORE push per [[feedback-reviewer-before-push-not-parallel]]).
- [ ] PR squash-merged; SHY-0038 status flip rolls into SHY-0039 PR per established pattern.

## Notes (running log)

- 2026-06-08 ~18:15 BST — Spec authored on `story/SHY-0038-public-roadmap-gh-project-link` branch (HEAD `d1be9efac17` — SHY-0037 close-out commit on main). Scope locked to Option B per the alternatives exploration above. Operator review pending; per [[feedback-rate-limit-slowdown-strategies]] architect-skip is intended for this docs/spec PR (low-risk, no novel design). Reviewer cycle BEFORE push per [[feedback-reviewer-before-push-not-parallel]]. Operator needs to confirm canonical GH Project URL before TDD red phase begins (cannot enumerate via API — `gh` token lacks `read:project` scope).

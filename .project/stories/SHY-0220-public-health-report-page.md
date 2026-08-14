---
id: SHY-0220
status: Draft
owner: claude
created: 2026-07-19
priority: P0
type: feature
effort: L
roadmap_ids: []
epic: EPIC-0008
mvp: true
pr:
---

# SHY-0220: Public health-report page + reporting-engine decision

## User Story

As a member of the public (a prospective user, or a parent deciding whether ShyTalk is safe for their teenager), I want a plain-language page on the ShyTalk website that shows, at a glance, whether the app is safe and working — Safety, Sign-in, Voice rooms, Messaging, Payments as green/amber/red with when it was last checked — and lets me expand for a little more detail, so I can trust the app without needing to understand test jargon; and as the operator I want the reporting engine chosen deliberately (Allure re-evaluated) and a $0 static page fed automatically from our test results.

## Why

The audit found our only published test reporting is **Allure on GitHub Pages** — built for engineers (suites/steps/stacktraces), not legible to the public, and bloat-prone (gh-pages hit 12.75 GiB; SHY-0128 capped it). The operator wants results **published for the public to see**, on a **page on our public site**, in **less jargon / plain language**, with a **simple summary on top and detail below**. This story makes the **reporting-engine decision** (keep a slim Allure/Sonar internal; build a new $0 static public health page — alternatives evaluated + rejected for cost/external-dependency) and delivers that public page, fed automatically from the SHY-0212 result feed every other EPIC-0008 story emits. It is the public-transparency pillar of EPIC-0008.

## Acceptance Criteria

### Happy path

- [ ] A **reporting-engine decision record** (`docs/testing/reporting-decision.md`) evaluates Allure vs alternatives (ReportPortal, Testspace, native GitHub summaries, custom static) against the constraints ($0, public-legible, no external dependency, no bloat) and records the choice: **slim internal Allure/Sonar for engineers + a new $0 static public health page** for the public, with rationale + rejected options.
- [ ] A **public health page** exists on the public site (`public/health/` served at `shytalk.com/health` or equivalent) showing five user-area cards — **Safety, Sign-in, Voice rooms, Messaging, Payments** — each green/amber/red with a "last checked" timestamp and a simple trend indicator (up/down/steady).
- [ ] **Simple-top / detail-below (operator's choice):** the five cards are the top summary; an expandable section below each (or a single expandable panel) shows plain-language detail — which aspects were checked and their status, rendered from each framework's `details` object (SHY-0212 contract) translated into plain language — **with no test jargon** (no "suites", "assertions", "stack traces").
- [ ] The page is fed by a generated `public/health-data.json` built from the SHY-0212 `run-summary.json` + per-framework `metadata.json` (including the optional **`details`** object and the **`test-results/trends/<id>.jsonl`** trend store) by a sync script (`scripts/sync-health-data.mjs`), using SHY-0212's documented `publicArea` → five-card mapping **with the `Cross-cutting` fan-out so every card — including Payments — is populated** (a sync-time assertion fails if any of the five cards has no contributing framework). Mirrors the existing `sync-shy-to-roadmap-data.mjs` architecture.
- [ ] The page is **static + $0** (no server, no external SaaS), self-contained, and follows the lazy/static public-site architecture ([[feedback-public-translations-lazy-architecture]]).
- [ ] A "What does this mean?" plain-language explainer + a link to the internal detail (for engineers) is present; the footer links to the same board/roadmap surfaces the roadmap page uses.

### Error paths

- [ ] If a user area's contributing checks include a **failing critical check**, its card is **red** with a plain-language line ("Sign-in is having problems") — never falsely green.
- [ ] If a user area's results are **stale** (not refreshed within the freshness window), its card is **amber** with "last checked" showing the age — stale is visibly distinct from healthy ([[feedback-environmental-is-not-a-diagnosis]]).
- [ ] If `health-data.json` is missing/malformed, the page renders a graceful "status temporarily unavailable" state, not a broken page or a false green.
- [ ] The sync script FAILS (non-zero) if a registered framework's `metadata.json` is absent when expected, so a silently-missing signal is caught in CI, not shown as green.

### Edge cases

- [ ] A framework mapped to `Cross-cutting` (a11y, perf, security, contract) contributes to the relevant user-area cards per a documented mapping, not dropped — the mapping (framework `publicArea` → user-area card) lives once in the sync script + is documented.
- [ ] Amber vs red thresholds are defined (critical-check-failing = red; non-critical-failing or stale = amber; all-fresh-and-passing = green) and documented so the color is deterministic, not vibes.
- [ ] Device-only frameworks that legitimately didn't run in a given cycle show "last checked" honestly rather than dropping the area to red for absence — absence = amber (stale), failure = red.
- [ ] The page works with JavaScript on (interactive expand) and degrades to a readable summary with JS off (progressive enhancement) — a health page must be robust.

### Performance

- [ ] The page is a small static bundle (well under any size budget), loads fast, and adds no repo bloat — `health-data.json` is compact (rollup only, not raw reports) and history is bounded ([[feedback-cache-and-reuse-principle]], SHY-0128 discipline).
- [ ] The sync step is sub-second and runs in the existing publish workflow (no new heavy job).

### Security

- [ ] The page exposes **status + counts only** — never finding detail, never security specifics, never PII (SHY-0217 feeds severity counts only; SHY-0223 verifies no PII in any published feed).
- [ ] `health-data.json` is generated from the normalized `metadata.json` (which by SHY-0212 contract carries no secrets/PII) — a sync-time assertion rejects any field outside the allowed shape.
- [ ] No client→backend access from the page (it reads a static JSON only; upholds [[feedback-no-direct-backend-all-via-api]] trivially).

### UX

- [ ] Language is plain and reassuring-but-honest — a non-technical adult understands each card in seconds; reviewed explicitly for jargon (operator's core requirement).
- [ ] The five cards are scannable at a glance (color + label + last-checked); detail is one tap/click away, not forced on the reader.
- [ ] Visual design matches the existing public site (shared header `public/js/shared-header.js`, seasonal theme) so it feels part of shytalk.com.
- [ ] Color is not the only signal (icons/text accompany green/amber/red) — the health page itself must pass SHY-0213's a11y bar.

### i18n

- [ ] All page copy is localized across the **4 active locales** (en + zh + id + vi per [[project-locales-reduced-to-four]]) — a public page must be readable in the user's language; strings live in the public-site localization system, not hardcoded.
- [ ] The "last checked" relative time + trend labels are localized; RTL-safe layout if/when an RTL locale returns.

### Observability

- [ ] The page's own health (does it render, is data fresh) is covered by a Playwright e2e test + fed into the suite like any surface; a broken health page is itself a caught regression.
- [ ] The sync step logs which frameworks contributed to each area + the freshness of each, greppable in the publish workflow.
- [ ] SHY-0224 (synthetic/uptime) can post its live signal into the same `health-data.json` so the page reflects real production health, not just last CI run.

## BDD Scenarios

**Scenario: A parent sees at-a-glance safety status**
- **Given** the latest test cycle passed all Safety-area checks recently
- **When** a visitor opens shytalk.com/health
- **Then** the Safety card is green with a recent "last checked" time
- **And** expanding it shows plain-language detail with no test jargon

**Scenario: A failing critical check shows red, not green**
- **Given** a Sign-in critical check failed in the latest cycle
- **When** the page renders from `health-data.json`
- **Then** the Sign-in card is red with a plain-language problem line

**Scenario: Stale results show amber, not a false green**
- **Given** the Voice-rooms checks have not refreshed within the freshness window
- **When** the page renders
- **Then** the Voice-rooms card is amber with the age of the last check

**Scenario: The page never leaks detail**
- **Given** a security finding contributed to the Safety area
- **When** the public page renders
- **Then** it shows only status/counts — no finding detail, no PII, no security specifics

**Scenario: Reporting decision is recorded**
- **Given** the evaluation of Allure vs alternatives
- **When** a reviewer reads `docs/testing/reporting-decision.md`
- **Then** it states the chosen approach (slim internal + $0 public static page) with rationale and rejected options

**Scenario: Missing data degrades gracefully**
- **Given** `health-data.json` is temporarily absent
- **When** a visitor opens the page
- **Then** it shows "status temporarily unavailable", not a broken page or a false green

**Scenario: The page is localized**
- **Given** a visitor with a non-English active locale (zh/id/vi)
- **When** they open the health page
- **Then** all card labels, detail, and timestamps render in their language

## Test Plan

**Classification:** feature (public web page) + a sync script. The page is tested real-only via Playwright against the real built static site (`stack`/web); the sync script has host unit tests over fixture `metadata.json`/`run-summary.json` inputs (fixtures are real captured data, not mock collaborators). No live backend — the page reads static JSON by design.

### Red — write failing tests first

- `tests/health-page.spec.ts` (Playwright, real browser matrix) — `test('renders five user-area cards with color+label+last-checked')`, `test('a failing critical check shows red')`, `test('stale results show amber')`, `test('detail expands with no jargon terms')`, `test('degrades gracefully with missing data')`, `test('degrades readable with JS off')`, `test('passes axe a11y')` (ties to SHY-0213).
- `express-api/tests/scripts/health/sync-health-data.test.js` — `it('maps publicArea onto the five user areas')`, `it('marks a critical-fail area red')`, `it('marks a stale area amber')`, `it('rejects any field outside the allowed no-PII shape')`, `it('fails when an expected framework metadata is absent')`.
- i18n: `it('every page string is localized across the 4 active locales')`.
- Reporting decision: a doc-presence + content check that `reporting-decision.md` records choice + rationale + rejected options.

### Green — implement

1. Write `docs/testing/reporting-decision.md` (Allure re-evaluation + decision).
2. Build `scripts/sync-health-data.mjs` (rollup `metadata.json`/`run-summary.json` → `public/health-data.json`, with the publicArea→user-area mapping + no-PII assertion).
3. Build the static page `public/health/` (5 cards, simple-top/detail-below, plain copy, localized, shared header/theme, progressive enhancement).
4. Wire the sync into the existing publish workflow ($0, no new heavy job); bounded history.
5. Add the Playwright + sync unit tests; ensure the page passes a11y.

### Gauntlet

Touches the public website (`public/**`) → FULL Pre-Merge Testing Protocol on the web surfaces (all browsers, both devices' browsers per the local matrix), plus the sync-script unit tests + lint + `code-reviewer` 100% clean. Dev gauntlet on the deployed page before merge.

## Out of Scope

- Deleting/replacing the internal Allure entirely (kept, slimmed — the decision record explains) — a separate cleanup SHY if slimming is substantial.
- Live per-request production telemetry on the page (SHY-0224 feeds a periodic real signal; true RUM is out of scope).
- A public detailed test-result browser (the public page is a plain rollup; engineers use the internal Allure/Sonar).
- Surfacing the raw per-test data publicly (privacy + jargon) — status/counts only.

## Dependencies

- **Blocks:** none — it is the terminal consumer of the epic's signals.
- **Blocked by:** SHY-0212 (the `run-summary.json` + per-framework `metadata.json` contract — including the `details` object, the trend store, and the resolved `publicArea` → five-card mapping it rolls up). Benefits from every other child (0213–0219, 0221–0225) emitting their feed, but renders gracefully with partial data. SHY-0224 can post a live signal into the same JSON. **Soft-depends on SHY-0180** (replace `npx serve` with a stable static-serve) for a deterministic host of the page in its own Playwright tests — if SHY-0180 hasn't landed, the page tests use the interim serve and note the flake risk.
- **Tooling:** the existing static public-site infra + `roadmap-data.json`-style sync (`.mjs`); Playwright for page tests. All $0.

## Risks & Mitigations

- **Risk:** The page shows green while something is actually broken (false assurance — worst outcome for a trust page). **Mitigation:** Critical-fail = red, stale = amber, deterministic documented thresholds, graceful "unavailable" over false green; freshness is explicit ([[feedback-environmental-is-not-a-diagnosis]]).
- **Risk:** Leaking security/PII detail publicly. **Mitigation:** Status/counts only; sync-time no-PII shape assertion; SHY-0217 feeds counts only; SHY-0223 verifies the feed.
- **Risk:** Repo/gh-pages bloat (the SHY-0128 problem) from published data/history. **Mitigation:** Compact rollup JSON, bounded history, no raw reports on the public surface ([[feedback-cache-and-reuse-principle]]).
- **Risk:** Jargon creeps into public copy. **Mitigation:** Explicit jargon-review AC (operator's core requirement); plain-language pass by a non-engineer lens; the detail section is curated, not a raw dump.
- **Risk:** i18n drift (English-only slips in). **Mitigation:** All strings in the localization system across the 4 active locales; a test asserts no hardcoded page string.
- **Risk:** The health page itself becomes an unmonitored surface. **Mitigation:** Its own Playwright e2e + a11y coverage; SHY-0224 can watch it live.

## Definition of Done

- [ ] All AC boxes across the 8 dimensions checked.
- [ ] `docs/testing/reporting-decision.md` records the Allure-vs-alternatives decision with rationale + rejected options.
- [ ] The public health page is live on the public site: 5 user-area cards, green/amber/red + last-checked + trend, simple-top/detail-below, plain non-jargon language, localized across the 4 active locales, a11y-clean, $0 static.
- [ ] `scripts/sync-health-data.mjs` builds `public/health-data.json` from the SHY-0212 feed with the documented mapping + no-PII assertion; wired into the publish workflow.
- [ ] Playwright page tests + sync unit tests green; page passes SHY-0213's a11y bar.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded; status `In Review`; `pre-merge-check.sh` OK.
- [ ] Branch `story/SHY-0220-public-health-report-page`; PR title `SHY-0220: Public health-report page + reporting-engine decision`; FULL web gauntlet passed; `released_in:` at release.

## Notes

- 2026-07-19 — Created as an EPIC-0008 child (the public-transparency pillar). Reporting decision pre-figured by the audit: Allure is engineer-facing + bloat-prone → keep slim internal, build a $0 static public health page rolling up the SHY-0212 feed by `publicArea`. Operator choices baked in: five user-area cards, simple-top/detail-below, plain language, $0. Architecture mirrors `sync-shy-to-roadmap-data.mjs` (generated JSON + static render) per [[feedback-public-translations-lazy-architecture]]. Deliberately status/counts-only (never detail/PII) so a trust page can't become a leak. Possible follow-up: set `public: true` + a `phase:` to surface this story on the roadmap once a phase is chosen.

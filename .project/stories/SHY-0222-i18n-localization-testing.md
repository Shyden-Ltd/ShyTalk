---
id: SHY-0222
status: Draft
owner: claude
created: 2026-07-19
priority: P0
effort: M
type: infra
roadmap_ids: []
epic: EPIC-0008
mvp: true
pr:
---

# SHY-0222: i18n / localization testing — key parity, placeholder safety, pseudo-localization, RTL

## User Story

As a ShyTalk user reading the app in my own language, I want every screen fully and correctly translated — no missing text, no English leaking through, no crash from a broken placeholder, no clipped or reversed layout — and as the operator I want an automated localization framework that catches these before launch, because a translation bug is invisible to English-only testing and a mismatched placeholder is a runtime crash in someone else's language.

## Why

The audit listed **i18n depth** as a candidate gap: `scripts/check-orphan-i18n-keys.sh` already gates web `data-i18n` orphan keys and a web i18n test corpus exists (`aria-label-i18n`, `language-selector-rtl.spec.ts`, the `admin-*-i18n` specs, `roadmap-i18n-lazy`), but there is **no systematic gate** for Compose `strings.xml` key-parity, format-placeholder safety, hardcoded (non-externalized) strings, or truncation/RTL breakage across the app. ShyTalk ships user-facing strings that must live in every active locale, and a `%1$s`→`%s` drift or a missing key is a crash or a blank screen in production for non-English users. This story **extends** the existing web-key gate into a **real**, systematic, all-surface localization framework — parsing the real resource files and rendering the real UI (per EPIC-0003) — registers into SHY-0212's runner, and feeds SHY-0220 a plain-language "Fully translated ✓" signal. It enforces parity across the **currently-active locale set (4: en + zh + id + vi)**, defined once so it tracks the SHY-0194 full-locale decision ([[project-locales-reduced-to-four]]).

## Acceptance Criteria

### Happy path

- [ ] **Key parity gate:** every user-facing string key present in the base locale exists in **every active locale** with a non-empty value, and there are no orphan keys (present in a translation, absent from base). Active-locale set defined ONCE in `scripts/test/active-locales.mjs` (currently `en, zh, id, vi`), read by the gate. Registered `i18n-parity` (`host`, `publicArea: Cross-cutting`). Covers Compose `strings.xml` (`shared/src/commonMain/composeResources/values-{locale}/`), web locale files, and — once it lands — the transactional-email locales introduced by SHY-0211 (a planned sibling not yet on `develop`; the email-locale coverage activates when SHY-0211 merges, so this reference is forward-looking, not a hard dependency).
- [ ] **Placeholder-safety gate:** for each key, the set/count/type of format placeholders (`%s`, `%1$s`, `{0}`, `{name}`) matches across all locales — a translation that drops/renames/reorders a placeholder FAILS (this is a runtime crash class). Part of `i18n-parity`.
- [ ] **Pseudo-localization:** the app/web renders under a pseudo-locale (accented + ~40% expanded text) to surface hardcoded strings (they stay un-accented) and truncation (expanded text clips). Registered `i18n-pseudo` (`stack`/`device`, `publicArea: Cross-cutting`).
- [ ] **No-hardcoded-string gate:** a lint catches user-facing string literals in UI code that should be resource references (scoped to UI layers, allowlisting genuinely-non-user-facing literals with rationale). Part of `i18n-parity`.
- [ ] All register into `scripts/test/framework-registry.mjs`, emit normalized `metadata.json` (SHY-0212 contract) with per-locale coverage, and `docs/testing/i18n.md` explains in plain language what "fully translated" means + how the active-locale set is governed.

### Error paths

- [ ] A key added to base but missing in one active locale FAILS `i18n-parity` naming the key + locale.
- [ ] A translation with a mismatched placeholder (`%1$s` vs `%s`, missing `{0}`) FAILS naming the key + locale + the placeholder diff — before it crashes a user.
- [ ] A new user-facing string hardcoded in UI code (not externalized) FAILS the no-hardcoded gate naming the file/line.
- [ ] A string that overflows/clips under pseudo-localization FAILS `i18n-pseudo` naming the screen.
- [ ] The gates FAIL (not skip) if a locale file is unreadable/malformed — a parse error is a failure, not a silent pass ([[feedback-environmental-is-not-a-diagnosis]]).

### Edge cases

- [ ] Plurals/quantity strings are checked per locale's plural rules (a locale needing `zero`/`few`/`many` forms isn't held to English's one/other) — no false fail, no missed gap.
- [ ] An intentionally-untranslated proper noun (brand name "ShyTalk") is allowlisted with rationale and doesn't trip the "identical to base = untranslated" heuristic.
- [ ] Adding a NEW active locale (or the SHY-0194 sweep expanding the set) requires only editing `active-locales.mjs` — every gate picks it up; a test asserts the set is the single source.
- [ ] RTL: the framework is RTL-ready (mirroring assertions) so when an RTL locale (e.g. `ar`) rejoins the active set, layout mirroring is gated — currently no active RTL locale, but the capability is present + tested via a pseudo-RTL locale.
- [ ] CJK/Arabic glyphs render without tofu (□) on the key screens (ties to SHY-0215 visual + SHY-0213 a11y).

### Performance

- [ ] `i18n-parity` (file parsing) is host-fast and part of the default `--profile host` run.
- [ ] `i18n-pseudo` rendering reuses the existing UI test harness (piggybacks screens visited by visual/a11y) to bound wall-clock.

### Security

- [ ] Translation files + i18n reports carry no secrets/PII (they're UI copy; belt with SHY-0223).
- [ ] A translation cannot inject markup/format-string exploits — placeholder-safety + escaping is asserted (a `%n`-style or markup-injection translation is rejected).

### UX

- [ ] Failure output is plain: "The Chinese translation of the room-full message is missing" / "The Vietnamese welcome string dropped the {name} placeholder — this would crash." Not a raw key dump.
- [ ] `docs/testing/i18n.md` explains the checks + the active-locale governance + the one command each.

### i18n

- [ ] This IS the i18n framework — it enforces the localization quality of the whole product. Its own tooling messages are English (CI convention), matching the validator-stderr ruling.

### Observability

- [ ] `metadata.json` records per-locale key coverage + placeholder-safety + pseudo-loc pass, feeding a plain-language "Fully translated ✓" signal per locale for SHY-0220.
- [ ] Missing keys / placeholder diffs are logged with `[framework:i18n-parity|i18n-pseudo]`, greppable in CI.
- [ ] A translation-coverage trend is retained so a slow drift (new strings outpacing translations) is visible.

## BDD Scenarios

**Scenario: A missing translation key fails the parity gate**
- **Given** a new string added to the base locale but not to Chinese
- **When** `i18n-parity` runs across the active locale set
- **Then** it fails naming the key and the missing locale

**Scenario: A dropped placeholder is caught before it crashes**
- **Given** a Vietnamese translation that drops the `{name}` placeholder present in base
- **When** the placeholder-safety gate runs
- **Then** it fails naming the key, the locale, and the placeholder diff

**Scenario: A hardcoded string is caught**
- **Given** a new UI label written as a literal instead of a resource reference
- **When** the no-hardcoded gate runs
- **Then** it fails naming the file and line

**Scenario: Text overflow is caught by pseudo-localization**
- **Given** a button whose label overflows when text expands ~40%
- **When** `i18n-pseudo` renders the screen
- **Then** it fails naming the clipped screen/control

**Scenario: The active-locale set is the single source of truth**
- **Given** the SHY-0194 sweep expands the active set in `active-locales.mjs`
- **When** the gates run
- **Then** every gate enforces the new set with no other edit

**Scenario: i18n verdict reaches the public page**
- **Given** a completed i18n run
- **When** SHY-0220's page reads the i18n `metadata.json`
- **Then** it can show "Fully translated ✓" per locale

## Test Plan

**Classification:** `i18n-parity` is host over the REAL resource files (real data, no doubles). `i18n-pseudo` renders the REAL UI on the real web/device harness (`stack`/`device`). No mocked translations.

### Red — write failing tests first

- `express-api/tests/scripts/i18n/parity.test.js` — `it('fails a key missing in an active locale')`, `it('fails a placeholder mismatch')`, `it('passes the live resource set')`, `it('reads the active set from active-locales.mjs')`, `it('handles plural forms per locale rules')`.
- `express-api/tests/scripts/i18n/no-hardcoded.test.js` — `it('flags a user-facing literal in UI code')`, `it('allowlists a rationale-bearing non-user-facing literal')`.
- Pseudo-loc: web `tests/i18n/pseudo.spec.ts` + an Android/iOS pseudo-locale render check — `test('no hardcoded string survives pseudo-localization')`, `test('no key screen clips under expansion')`; a RED fixture with a hardcoded string + a too-tight button proves failure.
- `it('metadata records per-locale coverage')`.

### Green — implement

1. Build `scripts/test/active-locales.mjs` + the parity/placeholder/no-hardcoded gates (parsing Compose `strings.xml` + web + email locales).
2. Add pseudo-localization rendering to the web + device UI harness.
3. Register all; write `docs/testing/i18n.md`; wire the host gates into `lint.yml`.
4. Fix every real localization gap surfaced (add missing keys, fix placeholders, externalize hardcoded strings, fix truncation) — real fixes, coordinated with the translation workflow.

### Gauntlet

Touches app strings (`shared/**`) + web (`public/**`) + email locales → FULL Pre-Merge Testing Protocol on the affected surfaces (pseudo-loc rendered across the browser matrix + both devices); host parity gates in CI.

## Out of Scope

- The full 20-locale re-expansion sweep (that is SHY-0194) — this story builds the framework + enforces the current active set; expansion is a one-line set change later.
- Machine-translation of missing strings (translation content is a separate workflow) — this story GATES completeness, it doesn't author translations.
- Locale-specific formatting of numbers/dates/currency beyond placeholder safety (a possible follow-up if gaps appear).
- The public rollup page — SHY-0220.

## Dependencies

- **Blocks:** contributes an i18n signal to SHY-0220; complements SHY-0213 (a11y localized labels) + SHY-0215 (visual locale baselines).
- **Blocked by:** SHY-0212 (registry/runner/docs/metadata). Uses existing resource files + UI harness. Coordinates with SHY-0211 (transactional email locales) + SHY-0194 (locale set).
- **Tooling:** resource-file parsers (host, $0); pseudo-locale generation; existing Playwright/device harness. All $0.

## Risks & Mitigations

- **Risk:** Hardcoding "20 locales" (stale) vs the live 4-locale interim. **Mitigation:** Single source `active-locales.mjs` (currently 4); a test asserts every gate reads it; tracks [[project-locales-reduced-to-four]] + SHY-0194.
- **Risk:** No-hardcoded gate false-positives on legitimate non-user-facing literals. **Mitigation:** Scoped to UI layers + a reviewed rationale-bearing allowlist that can't grow silently ([[feedback-never-suppress-fix-or-upgrade]]).
- **Risk:** Plural-rule differences cause false fails. **Mitigation:** Per-locale plural-rule awareness in the parity check.
- **Risk:** Pseudo-loc flakiness on dynamic content. **Mitigation:** Deterministic settled-state rendering (ties to SHY-0215 discipline); a flake is root-caused, not retried.
- **Risk:** Placeholder check misses framework-specific formats. **Mitigation:** Cover the format families actually used (Android positional `%1$s`, ICU `{0}`, named `{name}`); documented.

## Definition of Done

- [ ] All AC boxes across the 8 dimensions checked.
- [ ] `i18n-parity` (keys + placeholders + no-hardcoded) + `i18n-pseudo` green across the active locale set; active set read from the single source.
- [ ] Every real localization gap surfaced is fixed (keys added, placeholders fixed, strings externalized, truncation fixed).
- [ ] All registered; `docs/testing/i18n.md` present + plain-language; `metadata.json` per-locale emitted; host gates in `lint.yml`.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded; status `In Review`; `pre-merge-check.sh` OK.
- [ ] Branch `story/SHY-0222-i18n-localization-testing`; PR title `SHY-0222: i18n / localization testing — parity, placeholders, pseudo-loc, RTL`; relevant gauntlet passed; `released_in:` at release.

## Notes

- 2026-07-19 — Created as an EPIC-0008 child (operator: i18n depth candidate). Governs the currently-active 4-locale set ([[project-locales-reduced-to-four]]) via a single source `active-locales.mjs` so it tracks SHY-0194's full-locale decision without a rewrite. Highest-value checks: placeholder safety (a runtime crash class) + missing-key parity + no-hardcoded + pseudo-loc truncation. RTL-ready for when `ar` rejoins. Real-only: parses real resource files, renders real UI.

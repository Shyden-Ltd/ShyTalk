---
id: SHY-0182
status: Cancelled
owner: claude
created: 2026-07-13
priority: P1
type: bug
effort: L
roadmap_ids: []
epic: EPIC-0007
mvp: true
---

# SHY-0182: App opens the environment-correct web pages, in the app's language, never crossing environments

## User Story

**As** a ShyTalk user (and as a QA tester on a dev/local build),
**I want** every web page the app opens to come from **my build's own environment** (local→local, dev→dev, prod→prod) and render in **my app language**,
**So that** I never see prod content in a dev build (or vice-versa), a dev build can actually verify dev-only web changes in-app, and I read legal terms in my language.

## Why

`Constants.LEGAL_BASE_URL` is hardcoded to `https://shytalk.shyden.co.uk` (prod), so **dev and local builds open PROD web pages** — a silent cross-environment leak ([[feedback-web-urls-env-derived-never-cross]], HARD rule). And the app passes no locale, so pages fall back to the device language ([[SHY-0181]] adds the `?lang=` flag the app must now use). Dev web pages are also public-restricted, so the app can't reach its own dev pages without being auto-allowed. `BuildVariant.environment` (local/dev/prod) already drives `apiBaseUrl`; web URLs must derive from the same source.

## Acceptance Criteria

### Happy path
- [ ] Every web URL the app opens (the 4 legal pages + any future in-app web link) is built from `BuildVariant.environment`: `local` → the locally-served host (device-localhost bridge), `dev` → the dev web host, `prod` → the prod host.
- [ ] Each such URL carries `?lang=<appLocale>` (from `LanguagePreference`), so [[SHY-0181]]'s resolver renders it in the app language.
- [ ] A `dev` build reaching a restricted dev web page is **automatically allowed** (the app carries the required token/header/allowlist credential) — the operator does not manually auth per run.

### Error paths
- [ ] If the environment host is somehow unresolved, the app fails **closed + loud** (no silent fallback to a prod URL) — never crosses environments to recover.
- [ ] A dev-page access-credential failure surfaces a clear diagnostic, not a blank WebView.

### Edge cases
- [ ] `local` on a real device resolves the host the device can actually reach (the `adb reverse` / localhost bridge), not `localhost` literally from the Mac's perspective where wrong.
- [ ] Locale + environment compose correctly: `<envHost>/privacy.html?lang=<code>` for every (env × locale) pair.

### Performance
- [ ] URL building is pure/synchronous; no added network round-trip to resolve host or locale.

### Security
- [ ] The dev-page access mechanism allows **the app specifically** into its own env's pages — it does NOT widen the dev-page restriction to the public.
- [ ] No credential/token for dev-page access is logged or embedded in a way that ships to prod builds.

### UX
- [ ] The user never sees a wrong-environment or wrong-language page; legal pages open in the app language on the correct host.

### i18n
- [ ] Works for all 20 locales × 3 environments.

### Observability
- [ ] Env + locale used for a web-page open is logged (unredacted in local/dev per [[feedback-comprehensive-default-debug-logging]]); the resolved host is greppable for cross-env debugging. No secret token logged.

## BDD Scenarios

**Scenario: a dev build opens dev web pages, never prod**
- **Given** a `dev` build
- **When** the user taps the Privacy Policy link
- **Then** the page loads from the **dev** web host (not `shytalk.shyden.co.uk`)
- **And** it renders in the app language

**Scenario: a local build opens the locally-served pages**
- **Given** a `local` build on a real device with the localhost bridge
- **When** any in-app web page opens
- **Then** it loads from the locally-served host, not dev or prod

**Scenario: the app is auto-allowed into restricted dev pages**
- **Given** a `dev` build and a public-restricted dev web page
- **When** the app opens it
- **Then** the app is allowed through (it carries the credential) without a manual step, while a public browser is still blocked

**Scenario: no cross-environment contamination**
- **Given** any single build environment
- **When** every web URL the app can open is computed
- **Then** none of them point at a different environment's host

## Test Plan

Touches `shared/**` (+ platform host bridging) → **full protocol**: all app frameworks + real-device gauntlet.

**Red → Green:**
- **Kotlin jvmTest — cross-environment-contamination suite (operator-mandated):** for each of `local`/`dev`/`prod`, assert every web URL builds with THAT env's host; NEGATIVE tests that a given env's build yields **zero** other-env hosts across all web URLs × all 20 locales; the `?lang=` param equals the app locale. Value-level, exhaustive per (env × locale).
- **Kotlin jvmTest — env-derivation helper** mirrors `apiBaseUrl`: a `webBaseUrl(environment)` (or equivalent) pinned per env; fail-closed on unknown env.
- **Legal-link coverage (the original operator ask):** extend `LegalAcceptanceTest.kt` + `legal_acceptance.feature` — each of the 4 links opens the **correct** screen with the **correct** env+locale URL (not just "no crash").
- **Playwright (dev-access):** the app credential lets the app-flavored request through a restricted dev page while an un-credentialed request is blocked (real request, no mock).
- **Device gauntlet:** real iPhone + real Android, `dev` build with app-language ≠ device-language → open each legal link → page renders from the **dev** host in the **app** language; repeat local build → locally-served host.
- **CI guard (shared with EPIC):** lint fails a hardcoded cross-env web URL literal in `shared/**`, `app/**`, `iosApp/**`.

## Out of Scope

- The `?lang=` **web resolver** itself ([[SHY-0181]]).
- Bundled/offline legal text ([[SHY-0184]]).
- Non-web env routing (API base URL already env-derived).

## Dependencies

- **[[SHY-0181]]** (the pages must honor `?lang=` before the app passing it has an effect).
- The dev web host + its restriction mechanism (operator confirms the dev-page auth scheme the app must satisfy).

## Risks & Mitigations

- **The dev-page restriction scheme isn't documented** → surface as a blocker + confirm with operator before wiring the credential; don't guess an auth scheme.
- **`local` host on-device differs from the Mac's `localhost`** → reuse the existing `-PlocalHost` / `adb reverse` bridge pattern the app already uses for the API; pin it in the device test.
- **A future web URL added without the env-derivation** → the CI guard + the contamination tests catch it.

## Definition of Done

- All web URLs env-derived + locale-carrying; dev-access working; cross-environment-contamination tests green; legal-link coverage green; CI guard green; device gauntlet green on dev + local (correct host + app language); `code-reviewer` 100% clean; merged; released.

## Notes

- 2026-07-13 — Filed under EPIC-0007 as the APP half of the web-surface-correctness theme; the WEB `?lang=` resolver is [[SHY-0181]]. Hard rule + CI + contamination-tests per [[feedback-web-urls-env-derived-never-cross]] (operator 2026-07-13: "do not cross-over between environments ever" + "tests must confirm no cross-environment contaminations"). `type: bug` because the hardcoded prod URL is a live cross-env defect. `mvp: true` (compliance-adjacent + a real leak).

- 2026-08-06 — **CANCELLED, superseded by EPIC-0010.** The operator replaced every language mechanism with the shyden.co.uk model (real per-locale URLs on the web; device-locale in the app) and narrowed the set to five MVP languages. See EPIC-0010's Notes for the per-ticket disposition table. Specifically: the app no longer has a language of its own to open web pages in; locale-aware URLs are SHY-0285/0286. The environment half stays with EPIC-0007.

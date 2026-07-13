---
id: SHY-0182
status: In Progress
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

- 2026-07-13 ~18:05 WIB — **Core landed (commit `d90c6f6646f`, branch `story/SHY-0182-app-env-correct-web-urls`) — TDD RED→GREEN.**
  - `WebUrls` (commonMain): `baseUrl(env, localHost?)` (local/dev/prod pinned; **fail-closed + loud** throw on unknown env), `legal(doc, env, locale, localHost?)` (appends `?lang=`), `legalForCurrentBuild(doc)` (reads `BuildVariant.environment` + `LanguagePreference.get()`; local host derived from the injected `apiBaseUrl` via `localWebHostFromApi` port 3000→8888), `originOf(url)` (WebView nav-gate boundary).
  - **`WebUrlsTest` — 22 tests, all green**: exact URL per (4 docs × prod/dev × 21 locales); the operator-mandated **contamination negatives** (authority-exact — prod host is a strict *suffix* of dev host, so a bare `contains` false-positives; that trap is called out in-test); fail-closed; blank-locale; local-host-from-api; originOf.
  - Wired all 4 legal screens (commonMain → Android **+ iOS**) + the Android `PlatformWebView` nav-gate to the env-derived origin; **removed** the hardcoded `Constants.LEGAL_BASE_URL` + `*_URL` (the leak) + their obsolete `startsWith` tests (commonTest `ConstantsTest` trimmed; app `ConstantsLegalUrlsTest` deleted).
  - **Verified:** `:shared:jvmTest` (WebUrls 22/0, Constants 40/0) · `:shared:compileKotlinIosArm64` ✓ · `:app:compileDevDebugKotlin` + unit-test compile ✓ · ktlint clean · detekt clean.
  - **Remaining on this branch (none operator-free-blocked except noted):** (1) **CI guard** — lint fails a hardcoded cross-env web-page URL literal (`*.shytalk.shyden.co.uk/*.html`) outside `WebUrls.kt`+tests; needs a fixture-tested detector (many legit non-page uses of the domain: email/R2/api/livekit — don't false-positive) per [[feedback-detector-must-report-not-guess]]. **SCOPING NUANCE to resolve first:** `RoadmapNotificationTest.kt:274` hardcodes `https://shytalk.shyden.co.uk/roadmap.html#...` — the roadmap-notification link. Decide whether roadmap-notification URLs are ALSO env-derived (fold into WebUrls) or intentionally always-prod (allowlist them); a bare `.html`-on-web-host anchor would flag it, so the scope must be settled before the guard is written. `dev.shytalk.shyden.co.uk` (distinct from `dev-api.`) is a clean high-signal anchor — only WebUrls uses it in app code today. (2) **Dev-page Basic-auth credential** wiring — mirror `DEV_QA_PERSONAS_PASSWORD`→BuildVariant to inject `DEV_BASIC_AUTH_PASSWORD` (empty on prod); the app sends `Authorization: Basic base64("x:<pw>")` (username ignored) on dev web opens. **Operator dep:** provision the secret into the app build config. (3) **Playwright dev-access** test + **LegalAcceptanceTest**/`legal_acceptance.feature` link coverage. (4) **Device gauntlet** — blocked on the iPhone (see [[reference-ios27-ui-automation-consent-gate]]). NOT merge-ready until (1)-(4).
- 2026-07-13 ~17:35 WIB — **Pickup-fitness review — the two "unknowns" RESOLVED by investigation (not guessing), so the story is buildable autonomously except the secret-provisioning + device gauntlet.**
  - **Hosts (all three now pinned):** prod web `https://shytalk.shyden.co.uk` (Cloudflare Pages project `shytalk-site`), **dev web `https://dev.shytalk.shyden.co.uk`** (`shytalk-site-dev`, per `deploy-dev.yml:259/872`), local web = the `:8888` server via the on-device localhost bridge (same pattern as `apiBaseUrl`).
  - **Dev-page restriction scheme:** HTTP **Basic auth**, `realm="ShyTalk Non-Prod"` — the edge middleware `functions/_lib/lockdown.js::basicAuthOk` **ignores the username and checks only the password** (`= DEV_BASIC_AUTH_PASSWORD` secret; fails closed if unset). So the app's dev-access credential is `Authorization: Basic base64("x:<DEV_BASIC_AUTH_PASSWORD>")`. The value is a build-time secret that MUST be empty on prod builds (mirror the `DEV_QA_PERSONAS_PASSWORD` → `BuildVariant` injection pattern). **Only genuine operator dependency left:** provisioning that secret into the app build config + the device gauntlet (real iPhone currently blocked — see [[reference-ios27-ui-automation-consent-gate]]).
  - **The actual bug (confirmed):** `Constants.kt:76` `LEGAL_BASE_URL = "https://shytalk.shyden.co.uk"` is a compile-time `const val`, and the 4 legal `*_URL` constants derive from it → **every dev/local build opens PROD legal pages**. Real page names: `privacy.html`, `terms.html`, `community-guidelines.html`, `cyber-bullying.html` (NOT the story-shorthand). Consumers: `PrivacyPolicyScreen`/`TermsAndConditionsScreen`/`CommunityStandardsScreen`/`CyberBullyingPolicyScreen` (pass `Constants.*_URL` to `PlatformWebView`), and `PlatformWebView.android.kt:70` gates in-WebView nav on `LEGAL_BASE_URL` prefix — that gate MUST follow the dynamic base. Existing `ConstantsTest.kt:224+` `startsWith(LEGAL_BASE_URL)` tests will change (URLs become runtime-built).
  - **Design:** a pure `WebUrls.baseUrl(environment, localHostOverride)` (dev/prod static, local injected, **fail-closed on unknown env**) + `WebUrls.legal(doc, environment, locale)` appending `?lang=<LanguagePreference.get()>`. Pure → the exhaustive (env × 20 locale) contamination suite drops straight onto it. App locale source = `LanguagePreference.get(): String`.
- 2026-07-13 — Filed under EPIC-0007 as the APP half of the web-surface-correctness theme; the WEB `?lang=` resolver is [[SHY-0181]]. Hard rule + CI + contamination-tests per [[feedback-web-urls-env-derived-never-cross]] (operator 2026-07-13: "do not cross-over between environments ever" + "tests must confirm no cross-environment contaminations"). `type: bug` because the hardcoded prod URL is a live cross-env defect. `mvp: true` (compliance-adjacent + a real leak).

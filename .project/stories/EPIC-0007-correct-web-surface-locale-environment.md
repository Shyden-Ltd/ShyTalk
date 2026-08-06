---
id: EPIC-0007
status: In Progress
owner: claude
created: 2026-07-13
priority: P1
title: Correct web surface — every owned web page renders in the right language AND the right environment
child_shys: [SHY-0181, SHY-0182, SHY-0184]
---

# EPIC-0007: Correct web surface — right language, right environment

## Vision

Every web page ShyTalk owns — the public site, the legal/acceptance pages, the admin panel, the portal, seasonal-event pages, and anything we add later — must render in the **language the user/app requests** and be served from the **environment the app belongs to**. Two boundaries the codebase currently crosses silently:

1. **Language:** the app opens legal WebViews with no locale, so pages fall back to the *device* language (not the in-app language). For a legal-acceptance gate on a minors-facing app, showing terms in the wrong language is a compliance defect.
2. **Environment:** `Constants.LEGAL_BASE_URL` is hardcoded to prod, so dev/local builds open **prod** web pages — a cross-environment leak. Dev pages are also public-restricted, so the app can't reach its own env's pages without being auto-allowed.

The end state: a `?lang=` flag honored by every owned page (one shared resolver), the app passing its locale AND its environment host into every web URL it opens, dev pages that let the app in, and CI + tests that make a wrong-language or cross-environment regression impossible — now and for future pages.

## Scope

**In:** the `?lang=` URL-param locale flag across all owned pages; the app appending `?lang=<appLocale>` and selecting the environment-correct host; dev-page access for the app; a CI guard that every owned HTML page carries the shared resolver; cross-environment-contamination tests; the recommended migration of the legal-acceptance *gate* text to bundled/version-pinned content.

**Out:** authoring new translations or new locales; server-side `Accept-Language` negotiation; non-app web-to-web navigation policy.

## Child SHYs

- **SHY-0181** — Web: `getLanguage()` honors `?lang=` site-wide (public + admin + portal + events) + CI guard for future pages + Playwright coverage. Independent, foundational.
- **SHY-0182** — App: opens the environment-correct web pages (local→local, dev→dev, prod→prod, **never cross** — [[feedback-web-urls-env-derived-never-cross]]) + appends `?lang=<appLocale>` + dev-page access bypass + legal link→page→content→translation coverage + cross-environment-contamination tests + device gauntlet. Depends on SHY-0181.
- **SHY-0184** — Follow-up: migrate the legal-acceptance *gate* text to bundled + version-pinned in-app content (offline readability, audit of the exact accepted version, reviewed translations — a consent gate needs what a live WebView can't give).

## DoD at Epic Level

Every owned web page renders in the requested `?lang=`; the app opens only its own environment's pages in the app's language; a new page or a hardcoded cross-env URL fails CI; cross-environment-contamination tests are green; the legal-gate bundled migration is filed (and done or consciously deferred). All child SHYs Done + released.

## Notes

- 2026-07-13 — Filed from an operator thread that grew from "test the legal link translations" into a full web-surface-correctness theme (locale flag → every page → admin/portal too → environment-correctness → dev access → no cross-contamination). The shared `language-selector.js` resolver (loaded by all 11 owned pages) makes the language half a single-point fix; the environment half mirrors `apiBaseUrl`'s per-env derivation in `BuildVariant`.

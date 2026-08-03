---
id: SHY-0184
status: Draft
owner: claude
created: 2026-07-13
priority: P2
type: feature
effort: L
roadmap_ids: []
epic: EPIC-0007
mvp: false
---

# SHY-0184: Bundle the legal-acceptance-gate text (offline, version-pinned, reviewed translations)

## User Story

**As** a user (often a minor) being asked to accept ShyTalk's legal terms,
**I want** the terms shown at the acceptance gate to be readable **offline**, to be the **exact version** recorded against my acceptance, and to be in **my language via reviewed translations**,
**So that** my consent is genuinely informed and provable, not dependent on a live web page that can change, fail offline, or be machine-translated.

## Why

Assessment during [[SHY-0181]]/[[SHY-0182]]: the legal-acceptance gate currently shows the terms via a live `PlatformWebView` of the public site. [[SHY-0181]]/[[SHY-0182]] make that WebView locale- and environment-correct, but three needs remain that a **live** WebView structurally cannot meet for a **consent gate**:

1. **Offline readability** — a user with no network can't read what they're consenting to (blank WebView) → not informed consent.
2. **Auditability** — `usersAcceptedPolicies` records a version number, but the live page can change after acceptance, so you can't prove the exact text the user saw for that version.
3. **Translation reliability** — binding legal terms shouldn't depend on lazy machine translation; they need reviewed strings.

The informational "view policy" links in Settings can stay WebView (online, latest-version acceptable). This story is specifically the **acceptance gate**.

## Acceptance Criteria

### Happy path
- [ ] The 4 acceptance-gate documents (Privacy, Terms, Community, CyberBullying) are shown from **bundled, in-app content** version-matched to the acceptance version, readable with **no network**.
- [ ] The bundled text is shown in the app language from **reviewed translations** (app resources / bundled per-locale content), not lazy machine translation.

### Error paths
- [ ] Offline at the gate → the terms still render fully (the core reason for bundling).

### Edge cases
- [ ] A legal-version bump ships new bundled content + bumps the recorded version atomically; an old accepted version remains provable.
- [ ] A locale with no reviewed translation yet falls back to English **explicitly** (never a blank or a silent machine-translation).

### Performance
- [ ] Bundled content adds acceptable app size (measured); render is instant (local read, no network).

### Security
- N/A — content is read-only bundled assets; no new data flow.

### UX
- [ ] The acceptance gate reads identically online and offline; the "view full policy" affordance still exists.

### i18n
- [ ] All 20 locales have (or explicitly fall back for) each of the 4 documents.

### Observability
- [ ] The version + locale of the bundled text shown at acceptance is logged with the acceptance record for audit.

## BDD Scenarios

**Scenario: the terms are readable with no network**

- **Given** an offline device at the legal-acceptance gate
- **When** the user opens each policy
- **Then** the full text renders from bundled content, in the app language

**Scenario: the accepted version is provable**

- **Given** a user accepted Privacy v4
- **When** Privacy v5 later ships
- **Then** the exact v4 text they accepted is still recoverable (bundled + versioned), not overwritten by the live page

## Test Plan

Touches `shared/**` (bundled content + acceptance flow) → **full protocol**.

**Red → Green:**
- **Kotlin jvmTest** — the acceptance gate reads bundled content for the recorded version; offline path renders full text; missing-locale → explicit English fallback; version bump keeps old version recoverable.
- **Device gauntlet** — real devices, airplane mode: each policy renders fully at the gate in the app language.
- **Content parity** — a check that the bundled documents match the canonical source for the shipped version (no drift).

## Out of Scope

- The Settings informational "view policy" links (stay WebView).
- Re-authoring the legal text itself; this is delivery mechanism, not content.

## Dependencies

- Follows [[SHY-0181]] + [[SHY-0182]] (do the locale/env WebView fix first; this supersedes the gate's delivery mechanism afterward). Operator prioritisation — filed as the recommended compliance follow-up, `mvp: false` pending that decision.

## Risks & Mitigations

- **App-size growth (4 docs × 20 locales)** → measure; consider compressed bundled HTML or markdown; only the gate needs bundling, not every page.
- **Keeping bundled ↔ canonical in sync** → the content-parity check + a release step that regenerates bundled content from source.

## Definition of Done

- Acceptance gate renders bundled, version-pinned, reviewed-translation content offline; audit logs version+locale; parity check green; device gauntlet green offline; `code-reviewer` clean; merged; released. (Or consciously deferred by the operator with rationale in Notes.)

## Notes

- 2026-07-13 — Filed as the recommended compliance follow-up from the EPIC-0007 WebView-vs-bundled assessment (operator asked me to assess; I recommend bundling the *gate* specifically). `mvp: false` until the operator prioritises; the acute wrong-language/cross-env bugs are fixed by [[SHY-0181]]/[[SHY-0182]] first.

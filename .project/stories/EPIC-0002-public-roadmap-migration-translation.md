---
id: EPIC-0002
status: In Progress
owner: claude
created: 2026-06-10
priority: P1
title: Public roadmap story-migration + lazy translation platform
child_shys: [SHY-0062, SHY-0072, SHY-0073]
---

# EPIC-0002: Public roadmap story-migration + lazy translation platform

## Vision

shytalk.com/roadmap becomes fully story-driven: every entry a tracked SHY, auto-synced on merge (SHY-0038 pipeline), rendered with story badges and GitHub links (SHY-0061 + SHY-0073) — while staying **fully translated in all 20 locales, always** (operator hard rule, 2026-06-10). Translation moves to a platform-level lazy service: translate on first view per locale, server-cache, fail silently to English (admin-logged), Claude backfills misses via PRs — the operator-chosen standard for all future public translation, strictly $0.

## Scope

- **SHY-0062** — meta/tracking story for the ~95-entry migration (8 phase batches; batch SHYs filed at pickup, listed in SHY-0062's tracking table, added to `child_shys` as filed).
- **SHY-0072** — lazy translation service (Express): unofficial-Google provider → server cache → English fail-silent + admin log + miss queue.
- **SHY-0073** — renderer: items consume the translation service when locale ≠ en; items link to their GitHub story gated by a once-per-session translated confirm dialog for non-English visitors.
- Future children: SHY-0074+ per-phase migration batches; pickup-review lifecycle formalisation rides separately (process, not this EPIC).

## Child SHYs

| SHY | Role | Status |
|---|---|---|
| SHY-0062 | Migration meta/tracker | In Progress |
| SHY-0072 | Lazy translation service | Draft |
| SHY-0073 | Renderer: lazy i18n + gated story links | Draft |

## DoD at Epic Level

- [ ] All 95 legacy `features[]` entries exist as `public: true` SHY files; `phases[].features` arrays retired from the renderer's read path.
- [ ] Non-English visitors see translated names/descriptions for every entry (lazy service live, cache warm for visited locales, miss queue near-empty).
- [ ] Every roadmap item links to its GitHub story; non-English visitors get the gated confirm exactly once per session.
- [ ] No regression in the 20-locale page chrome; console-errors sweep green; $0 posture intact (no paid API anywhere).

## Notes

- 2026-06-10 ~10:10 BST — EPIC opened after three operator clarification rounds settled the design: stories English-only; webpage always translated; lazy-translate architecture with unofficial-Google + Claude-backfill chosen after the $0 reality check (official API is paid post-trial). Decisions codified in memory `feedback-public-translations-lazy-architecture`.

# SHY Story Index

Live backlog of every piece of work captured under the Agile way of working ([[feedback-agile-user-stories]]). Each row maps one PR-bundle to one detailed story file at `.project/stories/SHY-XXXX-slug.md`.

**Status legend:** 📝 Draft · 🚧 In Progress · 👀 In Review · ✅ Done · ❌ Cancelled

**Sort order (Active section):** `priority` ascending, then `created` ascending. P0 always tops.

## Active

| ID                                              | Pri | Effort | Type  | Title                                                  | Status   | Roadmap IDs           | PR  |
| ----------------------------------------------- | --- | ------ | ----- | ------------------------------------------------------ | -------- | --------------------- | --- |
| [SHY-0002](SHY-0002-wire-github-integration.md) | P1  | M      | infra | Wire GitHub Issues + Projects v2 integration           | 📝 Draft | —                     | —   |
| _SHY-0003 (planned, draft staged)_              | P1  | L      | chore | Convert zero-gap roadmap to user stories + cross-label | —        | G055 (new — gh-pages) | —   |

## Done

| ID                                               | Pri | Effort | Type  | Title                                     | Status  | Roadmap IDs | PR                                                       |
| ------------------------------------------------ | --- | ------ | ----- | ----------------------------------------- | ------- | ----------- | -------------------------------------------------------- |
| [SHY-0001](SHY-0001-establish-agile-workflow.md) | P1  | M      | infra | Establish Agile user-story way of working | ✅ Done | —           | [#1034](https://github.com/Shyden-Ltd/ShyTalk/pull/1034) |

## Cancelled

_None yet._

---

## Conventions

- **ID:** `SHY-XXXX` (4-digit zero-padded, sequential; no recycling).
- **File path:** `.project/stories/SHY-XXXX-kebab-slug.md`.
- **Granularity:** 1 PR-bundle = 1 SHY (multi-G bundles list every G-ID in `roadmap_ids` frontmatter).
- **Lifecycle:** stories stay in place after merge; `status` flips in frontmatter; this index updates in lockstep.
- **Tooling:** `scripts/check-story-frontmatter.sh` validates every `SHY-[0-9][0-9][0-9][0-9]-*.md` in CI. This `SHY-INDEX.md` file is human-maintained — the 4-digit ID glob excludes it from validation.

See `CLAUDE.md` § "Agile Way of Working" for the full spec (frontmatter, body sections, AC depth, BDD format, lifecycle, naming convention, Done bar per `type`).

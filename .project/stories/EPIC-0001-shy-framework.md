---
id: EPIC-0001
status: In Progress
owner: claude
created: 2026-06-08
priority: P0
title: ShyTalk SHY framework (stories, validator, GH sync, EPICs)
child_shys: [SHY-0001, SHY-0002, SHY-0003, SHY-0037]
---

# EPIC-0001: ShyTalk SHY framework (stories, validator, GH sync, EPICs)

## Vision

Establish the durable infrastructure that turns the ShyTalk roadmap into an executable, validated, multi-surface workflow:

- One **canonical story format** (`.project/stories/SHY-NNNN-*.md`) with strict frontmatter + body schema so machines can parse what humans author.
- A **validator** that fails CI on schema drift, so the format stays trustworthy as the corpus grows.
- An **automated sync** that mirrors story state to the GitHub Project board and Issues, so the operator can plan from either surface without manual upkeep.
- An **EPIC grouping mechanism** that lets related SHYs roll up into a coherent theme for prioritisation + roadmap surfacing, without requiring all 60+ SHYs to migrate at once.

This EPIC is the meta-layer. Every other ShyTalk EPIC (auth, sync, infra, etc.) depends on this framework being stable.

## Scope

In scope:

- Validator script + Jest test suite (SHY-0001)
- GitHub Issues + Project board sync workflow (SHY-0002)
- One-shot historic roadmap → stories converter (SHY-0003)
- EPIC concept + `epic:` frontmatter field + EPIC validator + CLAUDE.md spec (SHY-0037)

Out of scope (tracked separately):

- Public roadmap webpage refactor — SHY-0038
- CI auto-sync from SHY .md to `roadmap-data.json` — SHY-0039
- Per-file sync optimisation — SHY-0040
- Backfilling `epic:` field across remaining ~56 SHYs — SHY-0060 (reserved)
- Authoring EPICs 0002-0009 — SHY-0061..0068 (reserved)

## Child SHYs

The 4 SHYs below collectively define + enforce the framework. Each was authored independently but they form one cohesive layer:

- **SHY-0001** — `scripts/check-story-frontmatter.sh` + 143 Jest tests + CLAUDE.md spec. The schema enforcement contract.
- **SHY-0002** — `.github/workflows/sync-stories-to-issues.yml` + `scripts/sync-stories-to-issues.sh`. SHY .md → GitHub Issues + Project board mirror, on every story merge.
- **SHY-0003** — `scripts/convert-roadmap-to-stories.sh` (historic one-shot). Bootstrapped 28 SHYs from the roadmap.html ↔ G-ID list. Not re-runnable after authoring SHY-0036 closed the G-ID-gap loop.
- **SHY-0037** — EPIC concept itself. Optional `epic:` field on SHY frontmatter, separate EPIC validator, `EPIC-0001-*.md` file format, CLAUDE.md spec updates. This EPIC file is the proof-of-concept output.

## DoD at Epic Level

- [x] SHY-0001 merged (#1034) — validator + tests + CLAUDE.md spec live
- [x] SHY-0002 merged (#1035) — sync workflow runs on every merge to main
- [x] SHY-0003 merged (#1036) — converter shipped + 28 SHYs bootstrapped
- [ ] SHY-0037 merged — EPICs concept live (`epic:` field validated + EPIC validator in CI + this file passes the EPIC validator)
- [ ] All 4 SHYs cross-link back to EPIC-0001 via `epic:` frontmatter
- [ ] CLAUDE.md `### EPICs` subsection documents the format
- [ ] `SHY-INDEX.md` `## EPICs` section lists this EPIC

When all 4 boxes above flip, EPIC-0001 transitions `In Progress → Done`. The framework is then considered stable; subsequent expansion (per-file sync perf, additional EPICs, roadmap webpage) lives outside this EPIC.

## Notes

- 2026-06-08 — EPIC-0001 authored as proof-of-concept for SHY-0037. First EPIC in the system; sets the tone for the concise EPIC format (~100 lines, not story-length).
- The `child_shys: [SHY-0001, SHY-0002, SHY-0003, SHY-0037]` set is closed by design. Per architect Finding 6, framework-adjacent work (e.g. SHY-0032 "no-skeleton rule" or SHY-0036 "fill G-ID gap") is NOT a child of this EPIC — those are policy/data-quality SHYs that happen to use the framework, not framework-defining SHYs.

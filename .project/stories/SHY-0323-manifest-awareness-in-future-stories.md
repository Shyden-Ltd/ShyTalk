---
id: SHY-0323
status: Draft
owner: claude
created: 2026-08-17
priority: P1
effort: S
type: chore
roadmap_ids: []
mvp: true
---

# SHY-0323: Every future story has to say whether its UI is server-driven or native

## User Story

As the **operator**, I want every future story that adds UI to declare whether
it is manifest-driven or native, so that the server-driven architecture is
applied by default instead of being forgotten by the next story that ships a
hard-coded screen.

## Why

The operator's instruction was explicit: *"make sure all the future tickets are
aware of this major change."*

A note in a design document does not achieve that. Documents are read once, by
whoever was in the room. Six weeks from now a story will add a settings screen
with a hard-coded menu, it will pass every existing check, and the server-driven
architecture will have quietly acquired an exception — and exceptions are what
architectures die of.

So awareness has to be **mechanical**, and there are exactly three places it can
live:

1. **CLAUDE.md** — the file loaded into every session's context. This is where a
   convention becomes something the next session knows without being told.
2. **The story template + validator** — a required question means a story cannot
   be written without answering it. `scripts/check-story-frontmatter.sh` already
   enforces ten sections and eight AC dimensions; this is one more of the same
   kind.
3. **A sweep of existing Draft stories** — the backlog was written before this
   decision. Every Draft that adds UI needs tagging now, so it is re-scoped
   *before* pickup rather than discovered mid-implementation.

The default is **manifest-driven**, and native requires a stated reason. That
direction matters: a default of "native unless you argue otherwise" would leave
the architecture as an opt-in that nobody opts into.

## Acceptance Criteria

### Happy path

- [ ] CLAUDE.md carries a server-driven UI section: the manifest contract, the five sealed screens, and the manifest-driven-by-default rule.
- [ ] The story template (`SHY-0001`, the canonical seed) carries the required declaration.
- [ ] `scripts/check-story-frontmatter.sh` fails a story that adds UI and does not declare which it is.
- [ ] Every existing Draft story that adds UI is tagged with its declaration.

### Error paths

- [ ] The validator's new check fails with a specific, documented exit code and a message naming the missing declaration.
- [ ] A story declaring `native` with no stated reason fails the check — the reason is the point, not the label.
- [ ] A story that adds no UI is unaffected and needs no declaration.

### Edge cases

- [ ] The check is skipped for `type: docs`, `type: chore` and `type: spike` stories, which do not add UI by definition.
- [ ] A story adding only web UI declares correctly, given web joins the manifest in Phase 2 — so `native` is currently the correct answer for web and must be statable without looking wrong.
- [ ] The check runs in both per-file and `--scan` modes with consistent results.
- [ ] Existing Done and Cancelled stories are exempt — retro-tagging closed work is churn, and CLAUDE.md already forbids retro stories for shipped rows.

### Performance

- [ ] The added check does not measurably slow the validator across all 242 story files.

### Security

- [ ] The CLAUDE.md section states that the five sealed screens are never manifest-driven, so a future story cannot propose it from ignorance.
- [ ] The section states that a client-side feature flag requires a matching server-side refusal (the SHY-0315 rule), so the theatre version is not reinvented.

### UX

- [ ] N/A — no end-user surface. This story changes how stories are written, not what users see.

### i18n

- [ ] N/A — no user-facing strings. The convention it documents governs how future stories handle the 20 locales, but adds no copy itself.

### Observability

- [ ] The sweep's output is recorded: which Draft stories were tagged, and with which declaration.
- [ ] The validator's new exit code is documented in its `--help`, consistent with the eight already documented.

## BDD Scenarios

**Scenario: A new story that adds UI must say how**

- **Given** someone writes a story that adds a new screen
- **When** the story checks run
- **Then** the story is refused until it says whether the screen is server-driven

**Scenario: Choosing a built-in screen requires a reason**

- **Given** a story that says its screen is built into the app
- **When** the story checks run
- **Then** the story is refused unless it explains why

**Scenario: A story with no new screens is unaffected**

- **Given** a story that only changes server behaviour
- **When** the story checks run
- **Then** the story passes without any such declaration

**Scenario: Existing draft stories are brought up to date**

- **Given** draft stories written before this change
- **When** the sweep is done
- **Then** every draft that adds a screen carries its declaration

## Test Plan

**RED first** — the validator check is written against failing fixtures before
it exists.

### Bash / validator (`express-api/tests/scripts/story-frontmatter.test.js`)

- `fails a feature story that adds UI with no declaration`
- `fails a story declaring native with no reason`
- `passes a story declaring manifest-driven`
- `passes a story declaring native with a reason`
- `passes a feature story that adds no UI`
- `skips the check for docs, chore and spike types`
- `behaves identically in per-file and --scan modes`
- `exempts Done and Cancelled stories`
- `documents the new exit code in --help`
- `does not measurably slow validation across all story files`

### Fixtures (committed, real story files)

`.project/stories/__fixtures__/` — one per case, real files run through the real
script, matching how the validator is already tested.

### Sweep verification

- Every Draft story is enumerated and its declaration recorded in this story's
  Notes. The sweep is not "done when it feels done": the count of Draft stories
  tagged must equal the count of Draft stories that add UI, and both numbers are
  written down.

### CLAUDE.md verification

- The new section is read back and checked against the design doc for
  contradictions. A convention document that disagrees with the design is worse
  than none, because it will be trusted.

### Mutation proof

| Mutation | Must kill |
| -------- | --------- |
| the reason requirement dropped for `native` | `fails a story declaring native with no reason` |
| the check applied to `docs`/`chore`/`spike` | `skips the check for docs, chore and spike types` |
| the check applied to Done/Cancelled stories | `exempts Done and Cancelled stories` |
| the check runs in `--scan` but not per-file | `behaves identically in per-file and --scan modes` |
| default flipped so native needs no reason | `fails a story declaring native with no reason` |

### md-only + validator change

This story touches `.project/**`, `CLAUDE.md` and
`scripts/check-story-frontmatter.sh`. No app, backend or website runtime surface
— so per the CLAUDE.md exemptions it skips the device/browser gauntlet and runs
the story validator, lint, the affected Jest script tests, and `code-reviewer`.

## Out of Scope

- Retro-tagging Done or Cancelled stories.
- Re-scoping the Draft stories the sweep tags. Tagging identifies them; each
  story's own pickup re-validates it, per this repo's pickup-fitness rule.
- Enforcing the convention on stories in other repositories.
- Any change to the manifest itself.

## Dependencies

- The design doc and Phase 1 plan, which the CLAUDE.md section summarises. It
  must not restate them in a way that can drift — it links and summarises.
- Best written **after SHY-0311** merges, so the sealed set it documents is real
  rather than proposed. Not a hard block: the set is fixed by operator decision
  already.
- `scripts/check-story-frontmatter.sh` and its existing eight exit codes.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---------- |
| The convention is documented but never enforced, so it is forgotten exactly as a design-doc note would have been | The validator check is the enforcement, and the whole point of the story. A CLAUDE.md-only version of this story would not be worth writing. |
| CLAUDE.md drifts from the design doc | The section links rather than restating, and a verification step reads it back against the design for contradictions. |
| The default is set the wrong way round, making the architecture opt-in | Default is manifest-driven with native requiring a reason; flipping it is in the mutation table. |
| The sweep is declared done without being complete | Two counts are recorded in Notes and must match. |
| The new check annoys authors of non-UI stories into working around it | Skipped for `docs`/`chore`/`spike` and for stories adding no UI, so it only fires where it is relevant. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] CLAUDE.md carries the server-driven UI section, read back and checked against the design doc for contradictions.
- [ ] The story template carries the required declaration.
- [ ] `scripts/check-story-frontmatter.sh` enforces it, with the new exit code documented in `--help`.
- [ ] **The sweep is complete and both counts are recorded in Notes** — Draft stories tagged, and Draft stories that add UI.
- [ ] `cd express-api && npm test` passes; `npm run lint` clean at `--max-warnings=0`.
- [ ] The story validator passes in `--scan` mode across all story files.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] `bash scripts/pre-merge-check.sh <PR#>` emits `PRE-MERGE-CHECK: OK`.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-17** — Story raised from the operator's instruction: *"make sure all the future tickets are aware of this major change."* Three mechanisms rather than a document note, because a note is read once by whoever was in the room.
- **2026-08-17** — Default is manifest-driven with native requiring a stated reason. The reverse default would make the architecture an opt-in that nobody opts into.
- **2026-08-17** — `native` is currently the correct declaration for web-only UI, since the operator's decision puts web in Phase 2. The check must accept that answer without making it look like a violation.

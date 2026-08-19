---
id: SHY-0320
status: Draft
owner: claude
created: 2026-08-17
priority: P1
effort: S
type: spike
roadmap_ids: []
epic: EPIC-0011
mvp: true
---

# SHY-0320: How much of the app can server-driven theming actually reach?

## User Story

As the **operator**, I want to know how much of the app a server-driven colour
and spacing change would actually reach, so that the theming story is scoped
against a real number instead of an assumption.

## Why

Design tokens are the highest-leverage item in EPIC-0011: one token map reaches
every screen at once, with no per-screen work. That is true **only for
composables that read the theme.** Any composable holding a literal — `Color(0xFF7C3AED)`,
`16.dp`, a hard-coded `TextStyle` — is invisible to a server-driven token and
will simply not change.

There are 236 composables across 109 files in `shared/src/commonMain`. Nobody
knows what fraction of them consume the theme. That single unknown is the
difference between "theming reaches 90% of the app" — a headline capability —
and "theming reaches 40%" — a feature that makes the app look broken when used,
because half the screen changes and half does not.

**A partially-applied theme is worse than no theming at all.** So this must be
measured before the theming story is written, and this repo forbids skeleton
stories — a story cannot honestly carry an effort estimate that depends on an
unmeasured number. Hence a spike whose only output is the number and the story it
justifies.

Per the `spike` lifecycle in CLAUDE.md: the decision is recorded in Notes,
follow-up stories are filed, and the spike reaches `Done` without a release.

## Acceptance Criteria

### Happy path

- [ ] The count of hard-coded colour literals in `shared/src/commonMain` is recorded, with a per-file breakdown.
- [ ] The count of hard-coded dimension literals (`.dp`, `.sp`) is recorded, with a per-file breakdown.
- [ ] The count of composables reading the theme versus holding literals is recorded.
- [ ] The percentage of the 236 composables reachable by a server-driven token change is stated as a single number.

### Error paths

- [ ] The counting method distinguishes a genuine literal from a token *definition* — the theme's own palette must define literals and must not be counted as debt.
- [ ] Commented-out code and test sources are excluded, and the exclusion is stated.
- [ ] A literal inside a `@Preview` or sample composable is counted separately, since it is not user-facing.

### Edge cases

- [ ] A literal passed as a default parameter value is counted — it is real debt that a caller may never override.
- [ ] A colour built arithmetically (`baseColor.copy(alpha = …)`) is classified as theme-reading if its base is, not as a literal.
- [ ] Platform-specific sources (`androidMain`, `iosMain`) are counted separately from `commonMain`, since they may need different remediation.
- [ ] `app/` and `iosApp/` are counted separately from `shared/`, since only `shared/` is in the tri-platform theming path.

### Performance

- [ ] The counting script completes in under 30 s, so it can be re-run to track the debt over time rather than being a one-off.

### Security

- [ ] N/A — this spike reads source files and writes a report. It changes no product code, touches no backend, and has no runtime surface.

### UX

- [ ] N/A — no user-facing surface. The spike's user-facing consequence is indirect: it prevents shipping a half-applied theme, which is the UX failure it exists to avoid.

### i18n

- [ ] N/A — no user-facing strings. The spike adds no copy and changes no locale file.

### Observability

- [ ] The counting script is committed so the number can be re-measured, not just asserted once in a document.
- [ ] The report names the ten worst files by literal count, so remediation has an obvious starting order.

## BDD Scenarios

**Scenario: The reachable share of the app is measured**

- **Given** the app's shared interface code
- **When** the count is run
- **Then** it reports what share of screens a server-driven colour change would reach

**Scenario: The theme's own colours are not counted as a problem**

- **Given** the file that defines the app's colour palette
- **When** the count is run
- **Then** those colours are not counted as debt

**Scenario: The worst files are identified**

- **Given** the completed count
- **When** the report is produced
- **Then** it names the files most in need of attention

**Scenario: The follow-up work is written up with a real number**

- **Given** a completed count
- **When** the spike closes
- **Then** a theming story is filed carrying that number as its scope

## Test Plan

This is a spike, so its "tests" verify the **measurement**, not a product
behaviour. An uninstrumented counting script that reports a confident wrong
number is the specific failure to avoid.

### Node / Jest (`express-api/tests/scripts/count-theming-debt.test.js`)

- `counts a known literal in a fixture file`
- `does not count a literal inside the theme palette definition`
- `does not count a literal in a commented-out line`
- `does not count a literal in a test source`
- `counts a literal used as a default parameter value`
- `classifies an arithmetic colour by its base, not as a literal`
- `counts commonMain, androidMain and iosMain separately`
- `reports the ten worst files by count`
- `completes in under 30 seconds`

### Fixtures (committed, real)

`.project/audit/__fixtures__/theming/` — small real Kotlin files with known
counts, so the script is validated against a known answer before it is trusted
on 279 real ones.

### Verification of the result itself

- The script's `commonMain` total is hand-verified against three files chosen at
  random. A script that agrees with itself is not evidence.

### Deliverables

- `scripts/count-theming-debt.sh` (committed, re-runnable)
- `.project/audit/2026-XX-XX-theming-debt.md` — the report
- A filed theming implementation story carrying the real number and a real effort

### Not run for this spike

No device gauntlet: no product code, no backend, no `public/**`. Runs the
relevant non-device frameworks (Jest, eslint, `code-reviewer`) plus CI.

## Out of Scope

- **Fixing any of the debt.** This spike counts; the story it files fixes. Mixing
  the two would mean starting remediation before knowing its size, which is the
  thing being avoided.
- Web CSS custom properties — Phase 2, per the operator's decision that web joins
  in Phase 2.
- Typography and iconography debt beyond colour and dimension, unless the count
  reveals it dominates — in which case that becomes a Notes finding and a second
  filed story.

## Dependencies

- None. This spike reads existing source and is independent of every other story
  in EPIC-0011 — it can run at any time, including before EPIC-0004 lands.
- Its **output** is a dependency of the theming implementation story, which
  cannot be honestly sized until this closes.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---------- |
| The script reports a confident wrong number and the theming story is mis-scoped | Validated against committed fixtures with known counts, plus hand-verification of three randomly chosen real files. |
| The count is treated as the answer rather than as input to a decision | The spike's deliverable is explicitly a filed story with a real effort, not a number in isolation. |
| Scope creep into fixing the debt while counting it | Fixing is the first item in Out of Scope. |
| The number is measured once and rots | The script is committed and re-runnable, and the debt can be tracked over time. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] `scripts/count-theming-debt.sh` is committed and re-runnable.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] The script is validated against committed fixtures with known counts.
- [ ] The `commonMain` total is hand-verified against three randomly chosen files.
- [ ] `.project/audit/2026-XX-XX-theming-debt.md` records the counts, the per-file breakdown, the ten worst files, and the reachable percentage.
- [ ] The decision and the number are recorded in this story's Notes.
- [ ] **A theming implementation story is filed**, carrying the real number and a real effort.
- [ ] `cd express-api && npm test` passes; `npm run lint` clean at `--max-warnings=0`.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] Status flipped to `Done` on the recorded decision — a spike needs no release cut, per CLAUDE.md.

## Notes (running log)

- **2026-08-17** — Spike raised as open question 2 in the design doc, resolved on operator instruction to measure before sizing. 236 composables across 109 files in `shared/src/commonMain`; the theme-consuming fraction is unknown and is the difference between theming being a headline capability and a half-applied embarrassment.
- **2026-08-17** — Deliberately a spike rather than a story with a guessed effort. This repo forbids skeleton stories, and an effort estimate resting on an unmeasured number is a skeleton wearing a number.
- **2026-08-17** — Independent of EPIC-0004, so it can run while that work is in flight.

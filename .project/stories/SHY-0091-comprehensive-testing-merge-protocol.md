---
id: SHY-0091
status: In Progress
owner: claude
created: 2026-06-12
priority: P0
effort: XL
type: chore
roadmap_ids: []
pr:
mvp: false
---

# SHY-0091: Adopt the comprehensive Pre-Merge Testing Protocol

## User Story

**As** the ShyTalk engineering process (and any Claude session picking up work),
**I want** a single canonical Pre-Merge Testing Protocol codified in `CLAUDE.md` and embedded into every not-Done story's Test Plan + Definition of Done,
**So that** no story can merge until it has passed a deep, multi-framework, real-device, all-browser gauntlet and is genuinely production-ready — closing the gap where stories shipped on unit-tests-and-CI alone.

## Why

Operator 2026-06-12: the "before push" step was a one-line "code review agent" that silently ignored most of our test frameworks and skipped real-device, all-browser user-journey testing. Merging must be an assertion of production-readiness ("any doubt → it must not merge"), not "CI is green". The protocol must be the canonical rule AND baked into every existing not-Done ticket, because tickets written before the protocol existed do not carry the testing depth.

## Acceptance Criteria

### Happy path
- [ ] `CLAUDE.md` contains a `## Pre-Merge Testing Protocol` section enumerating all 12 frameworks + the 4 phases (LOCAL gauntlet → review+push → DEV gauntlet → judgment-merge).
- [ ] The Lifecycle section reflects: In Progress → local-gauntlet + reviewer → In Review → dev-gauntlet → judgment-merge → Done-on-release.
- [ ] Every not-Done story (54 at adoption) has its `## Test Plan` + `## Definition of Done` updated to name its specific frameworks/surfaces and assert the gauntlet; `*.md`-only stories record the exemption instead.
- [ ] `CLAUDE.md` also codifies the companion **No Stubs / Mocks / Fakes — Real Only** HARD GLOBAL rule (operator 2026-06-13): every implementation fully operational; tests run against real services (local emulator stack / real backends / real devices), no in-process test doubles; new mocks/fakes/stubs banned, existing migrated opportunistically; genuinely-impossible-to-induce cases escalate to the operator (never a silent mock).

### Error paths
- [ ] `scripts/check-story-frontmatter.sh --scan .project/stories` exits 0 across the whole corpus after refinement (no malformed frontmatter / missing sections introduced).
- [ ] The protocol explicitly states the failure loop: any gauntlet failure → fix TDD across all frameworks → restart from the LOCAL gauntlet.

### Edge cases
- [ ] Stories that touch no app/web surface but are not `*.md`-only (workflow/script infra) still assert the FULL protocol (only `*.md`-only is exempt).
- [ ] Terminal-status stories (Done/Cancelled) are excluded from refinement; SHY-0089 (Cancelled) carries no gauntlet assertion.
- [ ] **In-flight `In Review` stories whose code already merged before the protocol existed** (SHY-0087, SHY-0088) receive a **Note-only carve-out** (operator AFK decision #4, 2026-06-13): the protocol is NOT retroactively rewritten into their Test Plan/DoD; it binds on any FUTURE change to their surface. This is the sole not-Done exception to the "every not-Done story gets the embed" rule above.

### Performance
- N/A — documentation/process change, no runtime surface. (The protocol's own regression-scope rule — impact-selected loops + full corpus at the gate — is the mitigation for the gauntlet's wall-clock cost.)

### Security
- N/A — no code, credentials, or rules changed; `CLAUDE.md` + story `.md` only. (The protocol mandates the Security QA dimension on every future story — that is the security uplift this delivers.)

### UX
- [ ] The protocol is DRY: stories reference `## Pre-Merge Testing Protocol` and carry only surface-specific detail (no 54-way duplication that would drift).

### i18n
- N/A — internal engineering docs, English-only per the public-vs-internal policy (GitHub/spec content is English; only public webpages are translated).

### Observability
- [ ] SHY-0091's `## Notes (running log)` records the per-ticket refinement progress (which SHY embedded, in commit order) so a resuming session can continue mid-corpus without re-deriving state.

## BDD Scenarios

**Scenario: the protocol is the single source of truth**
- **Given** a story is being refined to embed testing
- **When** I add its Definition-of-Done gauntlet assertion
- **Then** it references `## Pre-Merge Testing Protocol` in `CLAUDE.md`
- **And** it lists only the frameworks/surfaces that specific story exercises

**Scenario: a `*.md`-only story is exempt**
- **Given** a not-Done story whose change set is `*.md`-only (e.g. a docs story)
- **When** it is refined
- **Then** its DoD records "`*.md`-only → device gauntlet exempt; validator + lint + review + CI only"
- **And** it does NOT assert real-device journey coverage

**Scenario: a non-md infra story is NOT exempt**
- **Given** a not-Done infra/chore story that changes a workflow or script (not `*.md`-only)
- **When** it is refined
- **Then** it asserts the FULL protocol (its relevant frameworks run; the gauntlet validates the pipeline output)

**Scenario: the corpus stays valid after refinement**
- **Given** all 54 not-Done stories have been refined
- **When** `scripts/check-story-frontmatter.sh --scan .project/stories` runs
- **Then** it exits 0
- **And** `scripts/check-epic-frontmatter.sh --scan .project/stories` exits 0

## Test Plan

This story is `*.md`-only (CLAUDE.md + story files + out-of-repo memory) → **device/browser gauntlet exempt** (the sole exemption). Verification:

**Red (before):**
- `CLAUDE.md` carried only the thin "PR Quality Gate" checklist — no real-device/all-browser/all-framework gauntlet, no judgment-merge gate.
- 54 not-Done stories carried no gauntlet assertion in DoD/Test Plan.

**Green (after):**
- `scripts/check-story-frontmatter.sh --scan .project/stories` → exit 0.
- `scripts/check-epic-frontmatter.sh --scan .project/stories` → exit 0.
- Every non-`*.md` not-Done story contains the string `Pre-Merge Testing Protocol` in its DoD (verify: `grep -L 'Pre-Merge Testing Protocol' <each applicable story>` is empty).
- `cd express-api && npm run lint` → 0 warnings.
- `code-reviewer` agent on the full diff → 0 findings.
- CI required checks (Detect Changes, Analyze JavaScript, PR Gate) → SUCCESS by name.

## Out of Scope
- BUILDING the test-framework matrix (making the currently-non-functional iOS-UI / Mac-browser / mobile-browser drivers FULLY OPERATIONAL — no stubs, per the No-Stubs rule) — that is **EPIC-0003** + its SHYs, sequenced after this.
- Refining Done/Cancelled stories.
- Running the gauntlet on any feature work — this story only embeds the requirement into the specs.

## Dependencies
- The `## Pre-Merge Testing Protocol` section in `CLAUDE.md` (delivered by this story's first commit, 482eb9b).
- `scripts/check-story-frontmatter.sh` + `scripts/check-epic-frontmatter.sh` (validators, already present).

## Risks & Mitigations
- **Risk:** the 54-file refinement drifts from the canonical protocol. **Mitigation:** stories reference the `CLAUDE.md` section rather than copy it; only surface-specific detail is per-ticket.
- **Risk:** a single 54-file PR is hard to review. **Mitigation:** one commit per ticket (operator directive) yields a per-SHY reviewable history.
- **Risk:** a story mis-classified `*.md`-only when it actually ships code → wrongly exempted. **Mitigation:** verify each "docs"/"chore" story's real change surface before applying the exemption.

## Definition of Done
- [ ] `## Pre-Merge Testing Protocol` codified in `CLAUDE.md` + Lifecycle + dev-verify rule updated.
- [ ] `## No Stubs / Mocks / Fakes — Real Only` HARD GLOBAL rule codified in `CLAUDE.md`; memory `feedback-no-stubs-mocks-fakes-real-only` written + `MEMORY.md` pointer (operator directive 2026-06-13, folded into this testing-standards PR to keep one active branch).
- [ ] Memory `feedback-pre-merge-testing-protocol` written; `MEMORY.md` pointer added.
- [ ] SHY-0088 → In Review; SHY-0089 → Cancelled (reject evidence) — closed out in this PR.
- [ ] All 54 not-Done stories refined (one commit each) to embed the protocol; `*.md`-only stories record the exemption.
- [ ] `check-story-frontmatter.sh --scan` + `check-epic-frontmatter.sh --scan` exit 0; lint clean; `code-reviewer` 0 findings.
- [ ] `*.md`-only PR → device gauntlet exempt; merged only when production-ready with zero doubt (operator approves the protocol wording).
- [ ] Done on the next release cut + `released_in: vX.Y.Z`.

## Notes (running log)
- 2026-06-12 ~22:45 BST — Created as the umbrella adoption story (operator 2026-06-12: "go through EVERY not-done ticket and refine them to include all this testing"). Consolidates codification + the 54-ticket embed into one PR with per-ticket commits (operator: "one single PR… commit and review each ticket individually… complete the PR once all committed"). Decisions from the Q&A: merge = production-ready / zero-doubt, Claude merges autonomously when certain; devices connected now; dev includes real-iOS app journeys (web = Chrome only); regression = impact-loops + full-corpus-at-gate; exemption = `*.md`-only; release = the cut (pre-merge gauntlet is the gate). Framework build (making today's non-functional drivers fully operational — NO stubs, per the new rule) = EPIC-0003, after this.
- 2026-06-12 — Commit 1: codified `## Pre-Merge Testing Protocol` in `CLAUDE.md` (482eb9b).
- 2026-06-13 ~00:26 BST — Operator added a companion HARD GLOBAL rule: **No Stubs / Mocks / Fakes — Real Only** ("real only... stubs is no longer allowed"; chose the sweeping scope incl. test doubles after being shown it reworks mock-gh / FakeGiftRepository / recording-diff). Codified into `CLAUDE.md` § No Stubs — Real Only + memory, folded into THIS PR (one-active-branch). EPIC-0003 reframed to build the matrix FULLY OPERATIONAL (no stubbed cells). Already-refined ticket Test Plans naming test doubles (0046 FakeGiftRepository, 0071 mock-gh recording-diff, 0019 fetch-mocks) get a real-backend scrub before the PR completes. Interpretation recorded for operator review: "real" = local emulator stack / real backends / real devices; new-work-forward + opportunistic migration (no 12k big-bang); impossible-to-induce conditions escalate, never silently mock.

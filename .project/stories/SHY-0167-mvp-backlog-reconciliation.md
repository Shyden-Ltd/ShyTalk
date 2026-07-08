---
id: SHY-0167
status: In Review
owner: claude
created: 2026-07-09
priority: P2
effort: S
type: chore
roadmap_ids: []
pr:
mvp: false
---

# SHY-0167: Reconcile the stale MVP-Draft backlog against current code

## User Story

As the ShyTalk operator, I want the `mvp: true` Draft stories reconciled against what the code actually contains, so that the board shows the **true** remaining MVP scope instead of stale "Draft" rows for work that already shipped — and I can plan launch against reality.

## Why

The `SHY-INDEX.md` + board statuses had drifted: a fitness pass on pickup found story after story marked `Draft` whose work is already in the codebase (e.g. SHY-0044's `firestore.rules` admin-claim fix; a whole batch of ViewModel tests). Picking the "next MVP ticket" off a stale board wastes effort re-doing done work and hides the genuinely-remaining scope. An evidence-based audit of all 45 `mvp:true` Draft stories reconciles the board and produces a "what's genuinely left before launch" picture. Triggered by the operator (2026-07-08) after 3 clean merges exhausted the obvious backend work and the next pick kept landing on already-done stories.

## Acceptance Criteria

### Happy path
- [ ] Every `mvp: true` Draft story is categorized against current code as DONE-IN-CODE, OPEN, or CANT-TELL, with concrete file:line / test-file / config evidence recorded in the audit report.
- [ ] Stories whose deliverable is provably present AND released (in `v0.97.15`) are flipped `Draft → Done` with `released_in: v0.97.15`.
- [ ] Stories whose deliverable is provably present but only on `develop` (merged after the last release) are flipped `Draft → In Review` (merged-not-released, per the lifecycle).
- [ ] Stories whose deliverable is moot/superseded are flipped `Draft → Cancelled` with the reason.
- [ ] Each flipped story carries a dated Notes entry citing the evidence + this story.

### Error paths
- [ ] N/A — a read-and-reclassify audit; the only writes are story-metadata edits, each validator-checked.

### Edge cases
- [ ] A story whose *cited* target is fixed but which has an adjacent residual (SHY-0053's separate gradle `|| true`; SHY-0052's unrelated data-guard skips) is flipped on its cited scope, with the residual recorded as a distinct follow-up rather than silently folded in or used to block the flip.
- [ ] `released_in` is set to a release that *verifiably contains* the change (`v0.97.15`); the earliest-containing release is not back-traced (noted as a caveat, not claimed).
- [ ] Develop-only vs released is the conservative call: a false "develop-only" only understates to In Review (never over-claims Done).

### Performance
- [ ] N/A — metadata audit.

### Security
- [ ] N/A — no runtime/security surface; `firestore.rules` (SHY-0044) is only *read* to confirm the already-merged fix, not modified.

### UX
- [ ] N/A — board/docs only.

### i18n
- [ ] N/A.

### Observability
- [ ] The audit report (`.project/audit/mvp-backlog-reconciliation-2026-07-08.md`) is the durable artefact: full 45-row evidence table + the remaining-scope breakdown by gate (device / web-stack / operator / infra-autonomous).

## BDD Scenarios

**Scenario: a shipped-but-Draft story is corrected**
- **Given** SHY-0044, marked Draft, whose `firestore.rules` admin-claim fix is already in the code and released
- **When** the backlog is reconciled
- **Then** SHY-0044 is marked Done with `released_in: v0.97.15`
- **And** its Notes cite the current-code evidence

**Scenario: a delivered-but-unreleased story is marked In Review not Done**
- **Given** SHY-0010, whose ViewModel tests exist on develop but are absent from the v0.97.15 release
- **When** the backlog is reconciled
- **Then** SHY-0010 is marked In Review (not Done), matching the merged-not-released lifecycle rule

**Scenario: a superseded story is cancelled**
- **Given** SHY-0050 (add a rationale comment for the biometric *alpha* pin)
- **And** SHY-0005 already moved biometric to stable 1.1.0
- **When** the backlog is reconciled
- **Then** SHY-0050 is Cancelled as moot

## Test Plan

**This is a `.md`-only board-reconciliation** (story-metadata + a new audit doc + a `SHY-INDEX.md` refresh) → gauntlet-exempt per CLAUDE.md; the gate is the story-frontmatter validator + `code-reviewer` + evidence re-verification.

- **Red/verify:** every flipped story's evidence was re-verified against current code (config bumps in `gradle/libs.versions.toml`, the 10 ViewModel test files, `firestore.rules` `isAdmin()`, `sonarcloud.yml`/`manual-qa-matrix.yml`, the spec skip-removals) AND checked for presence at `v0.97.15` (`git show v0.97.15:<path>`) to decide Done-vs-In-Review — NOT taken on an agent's word.
- **Green:** `scripts/check-story-frontmatter.sh` passes for all 13 flipped stories + SHY-0167; the audit report enumerates all 45 with evidence.
- No product code touched → no Jest/Playwright/gradle run applies; `code-reviewer` confirms the reclassifications match the cited evidence.

## Out of Scope

- Implementing any of the OPEN stories (this only reclassifies; the open work stays Draft).
- The follow-up findings surfaced during the audit (SHY-0053's residual gradle `|| true` at `sonarcloud.yml:150`; SHY-0070's `errors`-counting design question) — each recorded for its own ticket.
- Back-tracing the exact first-containing release for each Done story (v0.97.15 is used as a verified-containing release).
- The 6 CANT-TELL stories (0016, 0027, 0028, 0030, 0054, 0062) stay Draft pending a runtime/dispatch check.

## Dependencies

- None. Reads current code + `git show v0.97.15`. `.md`-only writes.

## Risks & Mitigations

- **Risk:** a wrong "Done" flip hides a real MVP gap. **Mitigation:** every flip re-verified against current code by the author (not delegated); develop-only is the conservative default (understates to In Review, never over-claims Done); residuals recorded as follow-ups.
- **Risk:** `released_in: v0.97.15` overstates the release for a story that shipped earlier. **Mitigation:** it is a *verified-containing* release (checked via `git show`), with the "earliest not back-traced" caveat in each Notes entry — true, if imprecise.

## Definition of Done

- 10 stories reclassified (6 Done, 3 In Review, 1 Cancelled) with evidence Notes; 3 more (0010/0012/0042) kept Draft with a documented iOS-coverage gap; all pass the validator.
- Audit report committed with the full 45-row table + remaining-scope-by-gate breakdown.
- `SHY-INDEX.md` refreshed to match.
- `code-reviewer` 100% clean; PR to **develop**; judgment-merge (`.md`-only).
- `status: Done` on the next release cut.

## Notes (running log)

- 2026-07-09 — Reconciliation run. Verified all 45 `mvp:true` Draft stories vs current code (fitness greps + `git show v0.97.15` for released-vs-develop). Full evidence + remaining-scope breakdown in `.project/audit/mvp-backlog-reconciliation-2026-07-08.md`.
- 2026-07-09 — **code-reviewer verification of the flips → 1 Critical + 3 Important, all applied.** Reviewer re-derived every flip against current code and caught that **SHY-0010/0012/0042's ViewModel tests, though present, are at `app/src/test` (JUnit4 + MockK, Android-only) not `shared/commonTest` (kotlin.test)** as their AC requires → the cross-platform ViewModels have zero iOS test-execution proof (I'd verified filename existence, not AC-satisfaction — the reconciliation analogue of [[feedback-test-must-fail-if-logic-skipped]]). **Reverted those 3 from In Review → Draft** with the gap documented; result is now **10 reclassified (6 Done, 3 In Review, 1 Cancelled) + 3 kept-Draft-with-gap**, 26 OPEN, 6 CANT-TELL. Also applied: stripped pre-existing tool-artifact corruption (`</content>`/`</invoke>`) from SHY-0005/0050/0043 (drive-by); noted SHY-0055's unmet optional `<!-- last verified -->` sub-bullet (Done stands on the correct+released count); recorded the stale `manual-qa-matrix.yml:66-70` comment as a nit follow-up. Verified the reviewer's Critical myself before acting (tests are in `app/src/test/java/**` importing `io.mockk`; VMs in `shared/commonMain`; no `commonTest`/`iosTest` for them). Follow-ups (in the report): G003 iOS-coverage decision, SHY-0053 residual, SHY-0070 errors-semantics, + 2 nits.

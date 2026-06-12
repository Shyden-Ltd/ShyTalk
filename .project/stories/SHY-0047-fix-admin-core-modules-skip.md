---
id: SHY-0047
status: Draft
owner: claude
created: 2026-06-08
priority: P1
effort: XS
type: bug
roadmap_ids: [G024]
pr:
mvp: true
---

# SHY-0047: Fix bare `test.skip()` at `admin-core-modules.spec.ts:133` — identify intent + implement or remove

## User Story

As a coverage-conscious ShyTalk maintainer, I want **the bare `test.skip()` at `tests/web/admin-core-modules.spec.ts:133`** (which has no rationale comment, no condition, no follow-up issue) **either implemented as a real test with the required fixtures OR removed with a recorded reason** (per [[feedback-fill-gaps-always-no-skip]] HARD GLOBAL RULE), so that the test suite doesn't carry silent skip debt.

## Why

Roadmap row (line 92, 2026-06-05): `G024 | 🟠 Important | bare test.skip() — admin-core-modules | tests/web/admin-core-modules.spec.ts:133 | Unconditional skip with no rationale | Identify scenario intent, implement with fixtures | XS`.

[[feedback-fill-gaps-always-no-skip]] HARD GLOBAL RULE (operator 2026-06-04): "every test.skip / TODO / FIXME / stub / missing feature / parity gap MUST be planned → implemented TDD → reviewed → SHIPPED + ROADMAP UPDATED; NEVER just delete the placeholder."

So the path is: implement, NOT delete. Removal is only allowed if the skipped test was tracking an obsolete feature.

## Acceptance Criteria

### Happy path

- [ ] Open `tests/web/admin-core-modules.spec.ts` line 133; read the surrounding `test(...)` block + commit history (`git log -L 130,140:tests/web/admin-core-modules.spec.ts`) to determine intent.
- [ ] Categorise: (a) feature still exists + test was deferred → implement; (b) feature was removed + test is obsolete → delete with rationale comment + commit message naming the obsoleted feature.
- [ ] If implementing: write the test body using existing helpers (Playwright fixtures in `tests/web/helpers/`); verify it passes against local dev stack.
- [ ] If deleting: the test() block is removed entirely; commit message names the obsolete-feature reason.
- [ ] No `test.skip()` remains in `admin-core-modules.spec.ts`.
- [ ] `npx playwright test tests/web/admin-core-modules.spec.ts` passes (all non-skipped tests green).

### Error paths

- [ ] **Git log doesn't reveal intent**: read PR that added the skip via `git log --all --source -- tests/web/admin-core-modules.spec.ts | grep -B 5 'line 133'`; if still unclear, ask via Notes + escalate to operator review.
- [ ] **Implementing requires data that doesn't exist in seed**: extend the global-setup seed via the established pattern (provision-test-personas.js or playwright global-setup); document in Notes.
- [ ] **Implementing surfaces a real production bug**: file a follow-up SHY for the bug; this SHY's PR may still ship if the test correctly fails (red) — but per [[feedback-think-like-qa-real-fixes]] the right move is to fix the bug in the same SHY/PR if XS.
- [ ] **Test depends on a feature flag that's off in dev**: use Playwright env-aware feature-flag override; documented in test plan.

### Edge cases

- [ ] **The test was skipped because of a known infrastructure issue** (e.g. dev API instability for one endpoint): fix the underlying issue OR explicitly mark as `@flaky` + add a TODO with a clear path-to-green (NOT a permanent skip).
- [ ] **The test was placeholder for unwritten functionality**: convert to a `.todo` Playwright marker (which shows in reports) instead of `.skip` — only if the feature is genuinely planned + tracked.
- [ ] **Test was duplicated elsewhere**: dedupe — keep the canonical one.
- [ ] **Adjacent tests have similar skips**: handle in this SHY if they're trivially the same root cause; else file follow-up.

### Performance

- [ ] No regression — adding 1 real test adds <2s to the spec file's runtime.

### Security

- [ ] If the test covers an admin-only operation, ensure the test persona has the correct admin claim (consistent with other admin tests).
- [ ] No bypass of auth in the test setup.

### UX

- [ ] N/A — backend test only.

### i18n

- [ ] If the test asserts text, use locale-aware lookups consistent with other admin-* specs.

### Observability

- [ ] Commit message names the categorisation: `[SHY-0047] tests/web/admin-core-modules: <implement|remove> test at line N (was unconditional skip)`.
- [ ] Notes capture the audit + decision rationale.

## BDD Scenarios

**Scenario: Implementation path — feature still exists**

- **Given** `tests/web/admin-core-modules.spec.ts:133` has `test.skip(...)`
- **When** the contributor audits git history + finds the feature still ships
- **Then** the skip is replaced with a real test body
- **And** the test passes against the local dev stack
- **And** the diff shows `test.skip(` → `test(` at that line

**Scenario: Removal path — feature was deprecated**

- **Given** the audit shows the feature targeted by the skipped test was removed in PR #X
- **When** the contributor deletes the test
- **Then** the diff shows the test block removed
- **And** the commit message references PR #X as the obsoleted-feature reason

**Scenario: Suite passes after change**

- **Given** the SHY's PR is open
- **When** `npx playwright test tests/web/admin-core-modules.spec.ts` runs
- **Then** the exit code is 0
- **And** zero tests are skipped in the file

## Test Plan

**Red:**
- Current: `npx playwright test tests/web/admin-core-modules.spec.ts --list | grep -i skip` — should list the skipped test.

**Green:**
- Audit step (read file + git log).
- Either implement OR delete per categorisation.
- Re-run Playwright; verify zero skips.

**Coverage gate:** Playwright suite green; grep for `test.skip` in this file returns no matches (or only the bare `test.skip(` if the test still skipped for documented reasons — should be ZERO per AC).

### Pre-Merge Testing Protocol (per `CLAUDE.md` § Pre-Merge Testing Protocol)

**Not `*.md`-only** (un-skips / removes a Playwright test, possibly extends global-setup fixtures) → the FULL gauntlet applies. The admin-core-modules tool is a **web** surface, so the all-browser web gauntlet is the headline.

**Frameworks exercised (RED→GREEN):**
- ✅ **Web E2E (Playwright, all browsers)** — `tests/web/admin-core-modules.spec.ts` with the bare skip resolved (real test OR documented removal), run across the `local` browser matrix (Mac chromium/firefox/webkit/edge + the device browsers); 0 bare skips at the end.
- ✅ **eslint** (`--max-warnings=0`) — the edited spec (+ any fixture/global-setup change).
- ✅ **Test isolation** ([[feedback-test-isolation-no-leaks]]) — if the implement-path needs seeded admin data, it's provenance-tagged + cleaned per-test.
- ⬜ **Kotlin / detekt / ktlint / iOS compile / Express Jest** — N/A (web-only admin tool, no app/Kotlin/server change); the apps run the regression corpus as the net.
- ✅ **SonarCloud** — quality gate.

**LOCAL gauntlet:** the resolved admin-core-modules spec green across the **full `local` browser matrix** (Mac + device browsers), 0 bare skips, clean fixture teardown → impact-selected each loop, full web corpus at the pre-push gate. Any failure → fix TDD → restart.
**DEV gauntlet:** redeploy the unmerged branch via Deploy-To-Dev `ref`; re-run the admin-core-modules suite on **Chrome only** + apps regression on real devices. Restart from LOCAL on failure. **Judgment-merge** only when production-ready with zero doubt.

## Out of Scope

- Other `test.skip(true, ...)` in this file (covered by [[SHY-0023]] data-fixture remediation for admin-* specs).
- Other admin-* spec files (each has its own SHY).
- Refactoring the test framework itself.

## Dependencies

- `tests/web/admin-core-modules.spec.ts` (must exist; audit verifies).
- Playwright + helpers in `tests/web/helpers/`.
- Local dev stack for Green-verification (per [[reference-local-stack-runner-setup]]).
- Possibly extending `tests/web/playwright.global-setup.ts` if new fixtures needed.

## Risks & Mitigations

- **Risk: audit reveals the skip is intentional + needed forever** (e.g. tests a CI-only flag). Mitigation: convert to conditional skip with explicit comment; ZERO bare skips left.
- **Risk: implementing surfaces a deeper bug requiring scope-creep.** Mitigation: file follow-up SHY; ship this PR with the test as `.fixme` if needed (last-resort).
- **Risk: removing the test loses coverage for live functionality.** Mitigation: removal only on confirmed obsolete-feature evidence (git log + PR ref).

## Definition of Done

- [ ] Audit done; categorisation recorded.
- [ ] Implementation OR removal applied.
- [ ] Playwright suite green.
- [ ] **Pre-Merge Testing Protocol satisfied** (`CLAUDE.md` § Pre-Merge Testing Protocol): admin-core-modules spec green across the **full `local` browser matrix** (0 bare skips, clean teardown) → `code-reviewer` 100% clean → push → CI green by name → DEV gauntlet green (Chrome) → **judgment-merge** (zero doubt; NO auto-merge).
- [ ] `released_in: vX.Y.Z` set after the release cut.
- [ ] `status: Done`; `pr:` populated.

## Notes (running log)

- 2026-06-08 ~13:08 BST — Spec created by SHY-0036 batch fill. Source: zero-gap roadmap line 92 (G024). Reserved ID SHY-0047.
- 2026-06-13 ~00:11 BST — **Embedded the Pre-Merge Testing Protocol** ([[SHY-0091]] pass): web admin bare-skip remediation → all-browser Playwright headline (0 bare skips, provenance-tagged fixtures if the implement-path needs seed data). DoD auto-merge → judgment-merge. Pickup-fitness: Out-of-Scope cross-refs verified current — the *data-dependent* `test.skip(true,...)` siblings remain [[SHY-0023]]'s scope (admin-* data fixtures), distinct from this bare/unconditional skip; no stale refs.

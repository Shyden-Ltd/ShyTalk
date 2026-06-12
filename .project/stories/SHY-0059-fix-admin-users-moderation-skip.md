---
id: SHY-0059
status: Draft
owner: claude
created: 2026-06-08
priority: P2
effort: XS
type: bug
roadmap_ids: [G051]
pr:
mvp: true
---

# SHY-0059: Audit admin-users-moderation.spec.ts:149 conditional skip + seed required data

## User Story

As a coverage-conscious ShyTalk maintainer, I want **`tests/web/admin-users-moderation.spec.ts:149`'s conditional `test.skip(...)`** (likely seed-data-dependent) **audited and either fixed by seeding the required state in global-setup OR converted to a documented assertion** per [[feedback-fill-gaps-always-no-skip]] HARD RULE.

## Why

Roadmap row (line 98, 2026-06-05): `G051 | 🟡 Polish | admin-users-moderation conditional skip | tests/web/admin-users-moderation.spec.ts:149 | Condition + seed data status need review | Read condition; ensure seeded in global-setup | XS`.

Pattern: same as the broader admin-* test-skip family — these were left to skip because dev seed didn't include the prerequisite state. The fix is to extend the seed.

## Acceptance Criteria

### Happy path

- [ ] Read `tests/web/admin-users-moderation.spec.ts:149` and identify the skip condition + the data it requires.
- [ ] Cross-check `tests/web/playwright.global-setup.ts` (or equivalent) to determine if the required data IS seeded.
- [ ] If seeded but skip still fires: bug in the condition; fix.
- [ ] If NOT seeded: extend global-setup to seed it.
- [ ] Remove the skip; test runs + passes.

### Error paths

- [ ] **Seed data requires admin SDK calls** that fail locally: ensure the seed is idempotent + handles re-runs cleanly.
- [ ] **The condition is on a feature flag**: gate via Playwright env-aware flag override, not skip.

### Edge cases

- [ ] **Adjacent tests have similar skips**: handle in this PR if trivially same root cause; else file follow-up.
- [ ] **Test was deliberately gated on a property the seed shouldn't provide** (e.g. real S3 connectivity in CI): preserve the skip with a clear conditional + comment.

### Performance

- [ ] Seed extension may add seconds to global-setup; verify acceptable.

### Security

- [ ] Seeded data must NOT include real PII or credentials; use test-only personas.

### UX

- [ ] N/A — test.

### i18n

- [ ] N/A.

### Observability

- [ ] Post-fix: test runs in CI without skip; coverage delta visible in report.

## BDD Scenarios

**Scenario: Skip removed after seed extension**

- **Given** global-setup seeds the required state
- **When** `npx playwright test tests/web/admin-users-moderation.spec.ts` runs
- **Then** the test at line 149 runs (not skipped)
- **And** passes

**Scenario: Audit reveals genuine conditional**

- **Given** the skip condition is on something seed can't provide (e.g. real-S3)
- **When** the contributor categorises
- **Then** the skip remains but with a clear comment + condition

## Test Plan

**Red:**
- Current: `npx playwright test tests/web/admin-users-moderation.spec.ts --list | grep -i skip` lists the test.

**Green:**
- Audit + apply seed extension OR document conditional.
- Re-run; verify zero skip OR documented skip.

**Coverage gate:** Playwright suite green; skip reduced.

## Out of Scope

- Other tests in this file unless trivially adjacent root cause.
- Refactoring global-setup beyond adding the required seed.

## Dependencies

- `tests/web/admin-users-moderation.spec.ts` exists.
- `tests/web/playwright.global-setup.ts` (or equivalent) for seed extension.
- Local dev stack.

## Risks & Mitigations

- **Risk: seed extension breaks other tests** (over-seeded state). Mitigation: per-test isolation; ensure new seed entries don't conflict.
- **Risk: condition turns out to be unrelated to seed** (e.g. browser-specific). Mitigation: audit step before patching.

## Definition of Done

- [ ] Audit done; categorisation recorded.
- [ ] Fix applied per categorisation.
- [ ] Playwright suite green.
- [ ] Reviewer ZERO findings.
- [ ] `status: Done`.

## Notes (running log)

- 2026-06-08 ~13:22 BST — Spec created by SHY-0036 batch fill. Source: zero-gap roadmap line 98 (G051). Reserved ID SHY-0059.

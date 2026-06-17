---
id: SHY-0124
status: Draft
owner: claude
created: 2026-06-17
priority: P2
effort: M
type: refactor
roadmap_ids: []
epic: EPIC-0003
pr:
mvp: false
---

# SHY-0124: Migrate Playwright integration e2e off `page.route` fulfilment to the real backend (EPIC-0003)

## User Story

**As** the team executing EPIC-0003,
**I want** the 6 integration Playwright e2e tests that fulfil requests via `page.route` moved onto the real local backend (real Express API + real emulator), keeping the 2 genuinely-unit Playwright tests (XSS / i18n string handling) as-is,
**So that** the web e2e proves real round-trips against real services instead of intercepted, faked responses.

## Why

`page.route` fulfilment makes a Playwright "e2e" assert against a response the test itself authored — the opposite of end-to-end. The sweep found 8 `page.route` usages: 6 are integration e2e that should hit the real backend, and 2 are genuine unit-level checks (XSS sanitisation / i18n rendering) where no real collaborator is involved (double permitted per the keystone policy). This M-sized area is P2 (last) because the web surface is also covered by the broader gauntlet, but the `page.route` debt must still be cleared so the ratchet category can reach zero.

## Acceptance Criteria

### Happy path
- [ ] The 6 integration Playwright e2e tests run against the **real** local backend (real Express API + real emulator) with no `page.route` fulfilment; each asserts on a real round-trip outcome.
- [ ] The 2 genuine-unit Playwright tests (XSS / i18n) are explicitly classified as unit per the keystone convention and retained (their `page.route`/doubles permitted + recorded in the baseline as allowed, or relocated to a unit-test location).

### Error paths
- [ ] A real backend error path (real 4xx/denial from the real API) is exercised by at least one migrated e2e — not an intercepted fake response.
- [ ] A real empty-state is rendered from the real backend (genuine clean slate).

### Edge cases
- [ ] A real slow/again-real network condition is exercised where the original `page.route` simulated latency (real throttling, not faked).
- [ ] The 2 retained unit tests are proven to NOT trip the policy-aware ratchet (they sit in a unit-test location / allowed set); the 6 migrated ones drop out of the `page.route` baseline entirely.
- [ ] Surfaced bugs: non-blocking → `type: bug` SHY + `@known-failure-SHY-NNNN` (assertion intact); blocking → pivot-fix TDD-first.

### Performance
- [ ] Real-backend e2e complete within the existing Playwright budget; no excessive real round-trip latency added.

### Security
- [ ] Real-rules/real-auth enforced on the real round-trips; no secrets logged; local stack only.

### UX
- [ ] Each migrated e2e walks the real user flow in the browser (the consumer experience) against real data.

### i18n
- [ ] The i18n unit test's coverage is preserved; migrated e2e spot-check ≥1 RTL + ≥1 CJK locale on the real surface.

### Observability
- [ ] Real backend logs run unmocked during the e2e (exercised, not asserted).

## BDD Scenarios

**Scenario: a migrated e2e asserts a real round-trip**
- **Given** the real local backend up
- **When** the migrated Playwright e2e drives the web flow
- **Then** it asserts on the real backend response (no `page.route` fulfilment)

**Scenario: a real error path is rendered**
- **Given** the real backend will return a real denial for the action
- **When** the e2e triggers it
- **Then** the UI renders the real error (not an intercepted fake)

**Scenario: genuine-unit Playwright tests are preserved + allowed**
- **Given** the XSS / i18n unit tests
- **When** the policy-aware ratchet scans
- **Then** they are classified unit (allowed) and do not count as offenders; the 6 migrated ones leave the `page.route` baseline

**Scenario: a surfaced web bug is catalogued**
- **Given** a migrated e2e exposes a non-blocking defect
- **When** triaged
- **Then** a `type: bug` SHY is filed + the test tagged `@known-failure-SHY-NNNN` with its correct assertion intact

## Test Plan

**RED:** rewrite each of the 6 integration e2e to drive the real backend (remove `page.route` fulfilment) → fails until pointed at the real local stack.

**GREEN:** point the 6 at the real Express API + emulator; exercise real success/error/empty/throttle paths; classify + retain the 2 unit tests per the keystone convention; shrink the `page.route` baseline to only the 2 allowed unit cases; file + `@known-failure`-tag surfaced bugs. Run the real Playwright suite green against the local stack.

**Frameworks:** Playwright (real local backend), the policy-aware ratchet, frontmatter validator. **Real backend:** real Express API + Firebase emulator (local stack). **Gauntlet:** the Playwright web cells run against the real backend (operator-gated for the full gauntlet; CI runs the web e2e).

## Out of Scope
- The 2 genuine-unit Playwright tests' behaviour (preserved, only classified/relocated).
- Native app journeys (covered by the device gauntlet areas).
- Fixes for non-blocking surfaced bugs (own SHYs, drained post-epic).

## Dependencies
- **SHY-0112** (keystone) — the policy-aware ratchet must recognise the 2 unit Playwright tests as allowed and the 6 as offenders-to-clear.
- **SHY-0109** + local stack (real Express API + emulator).

## Risks & Mitigations
- **Risk:** real round-trips make web e2e slower/flakier than intercepted ones. **Mitigation:** bounded real waits + the local stack as the real-but-fast backend; assert real state.
- **Risk:** mis-classifying one of the 2 unit tests as integration (or vice-versa). **Mitigation:** apply the keystone "by what it exercises" rule; `code-reviewer` confirms.

## Definition of Done
- The 6 integration e2e run on the real backend with no `page.route` fulfilment; the 2 unit tests classified + retained; `page.route` baseline reduced to only the allowed unit cases.
- Surfaced bugs filed + `@known-failure`-tagged with intact assertions.
- Real Playwright suite green; `code-reviewer` zero findings; CI green by name.
- Judgment-merge. Story → In Review → Done on its release cut.

## Notes (running log)
- **2026-06-17 — created Draft (P2, M, the last migration area).** Clears the `page.route` ratchet category: 6 integration e2e → real backend, 2 genuine-unit tests (XSS/i18n) classified + kept. P2/last because the web surface is also gauntlet-covered, but the debt must reach zero.

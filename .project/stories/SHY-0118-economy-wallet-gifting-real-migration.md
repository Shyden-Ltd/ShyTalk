---
id: SHY-0118
status: Draft
owner: claude
created: 2026-06-17
priority: P1
effort: XL
type: refactor
roadmap_ids: []
epic: EPIC-0003
pr:
mvp: false
---

# SHY-0118: Migrate Economy / Wallet / Gifting tests to real services (EPIC-0003)

## User Story

**As** the team executing EPIC-0003,
**I want** every Economy test (express `economy` / `purchase` / `gacha` / `gifts`, ~35 files) moved off in-process doubles and onto the real Firestore emulator + real purchase/transaction paths,
**So that** money-adjacent behaviour (balances, transactions, daily rewards, gacha odds, gift transfers) is proven against real state — where a faked pass risks balance corruption or double-claims.

## Why

Economy is integrity-critical: a daily reward that double-claims under a double-tap, a gift that debits but never credits, or gacha odds that drift are exactly the defects mocked transaction tests cannot catch (the mock just confirms the call shape). ~35 files makes this XL. It is sequenced after the safety areas but before the P2 areas because balance integrity is core to user trust (and to any future Revenue work, though Revenue itself is out of MVP scope per [[project-mvp-golive-parameters]]).

## Acceptance Criteria

### Happy path
- [ ] Every economy/purchase/gacha/gifts test runs against the real Firestore emulator with real transaction semantics; no `jest.mock`/`jest.fn` collaborator/`makeStatefulFakeDb` remains.
- [ ] A real gift A→B debits A and credits B atomically in real state (sum conserved); a real daily-reward claim increments the real balance exactly once.
- [ ] Real gacha pull writes a real inventory item + decrements real currency; the real odds distribution is asserted over a seeded run.

### Error paths
- [ ] Insufficient-balance purchase/gift is rejected by the **real** backend (no negative balance), asserted on real state.
- [ ] Double-claim / double-tap on a daily reward is prevented by the **real** transaction (idempotency) — proven by a real concurrent attempt, not a mocked guard.
- [ ] Invalid SKU / unknown gift / unauthorised wallet access rejected by the real contract.

### Edge cases
- [ ] Concurrency: two real concurrent gift sends from the same wallet converge without over-spend (real transaction isolation).
- [ ] Boundary balances (exactly-enough, zero, max) handled at the real value level (not "the mock was called").
- [ ] Surfaced bugs: non-blocking → `type: bug` SHY + `@known-failure-SHY-NNNN` (assertion intact); blocking → pivot-fix TDD-first.

### Performance
- [ ] Wallet/economy reads within an asserted budget; migrated suite completes in a few seconds against a warm emulator.

### Security
- [ ] Real-rules enforcement (a user mutates only their own wallet); transactions atomic; no secrets logged; sandbox purchase keys only.

### UX
- [ ] The real claim → balance-updates → gift → recipient-sees-it flow is walked as the consumer.

### i18n
- [ ] Currency/amount formatting + economy strings render in ≥1 RTL + ≥1 CJK + ≥1 long-word locale on the real surface (spot-check).

### Observability
- [ ] Real economy/transaction logs run unmocked during tests (exercised, not asserted).

## BDD Scenarios

**Scenario: a real gift conserves total currency**
- **Given** real personas A (balance 100) and B (balance 0)
- **When** A gifts B 30 on the real path
- **Then** real state shows A=70, B=30 (atomic, sum conserved)

**Scenario: a daily reward cannot double-claim**
- **Given** a real persona eligible for the daily reward
- **When** two concurrent claims fire
- **Then** the real transaction credits exactly once (real idempotency), not twice

**Scenario: an over-spend is rejected by the real backend**
- **Given** a real persona with balance 10
- **When** they attempt to gift 30
- **Then** the real backend rejects it and the balance stays 10

**Scenario: a surfaced economy bug is catalogued**
- **Given** a migrated real test exposes a non-blocking defect
- **When** triaged
- **Then** a `type: bug` SHY is filed + the test tagged `@known-failure-SHY-NNNN` with its correct assertion intact

## Test Plan

**RED:** rewrite each economy test to require the real emulator with real transaction semantics → fails until seeded real; a real concurrent double-claim test fails until idempotency is proven real.

**GREEN:** seed real wallets/inventories; exercise real gift/claim/gacha/over-spend/concurrency paths; assert real value-level outcomes; file + `@known-failure`-tag surfaced bugs. Canonical `npm test` green; device journey spot-check where an economy UI path is involved.

**Frameworks:** express Jest (real Firestore emulator, real transactions), frontmatter validator; gauntlet where an economy journey UI is touched. **Real backend:** Firestore emulator + sandbox purchase path.

## Out of Scope
- Fixes for non-blocking surfaced bugs (own SHYs, drained post-epic).
- Revenue/monetisation features (excluded from MVP per [[project-mvp-golive-parameters]]).
- The androidTest economy/gift domain (rides SHY-0115's harness — its own slice).
- Sub-splitting: ~35 files delivered as 1-SHY-1-PR slices (wallet · purchase · gacha · gifts) at pickup.

## Dependencies
- **SHY-0112** (keystone) first.
- **SHY-0114** (auth) — real signed-in wallets.
- **SHY-0109** + `firebase-emulator.js`; real Firestore transactions.

## Risks & Mitigations
- **Risk:** real transaction concurrency is hard to assert deterministically. **Mitigation:** drive genuine concurrent calls + assert the converged real state (the real isolation IS the contract).
- **Risk:** XL scope. **Mitigation:** vertical 1-SHY-1-PR slices.
- **Risk:** sandbox purchase provider un-inducible conditions. **Mitigation:** operator escape-hatch escalation, never a silent mock.

## Definition of Done
- All economy tests double-free + asserting real value-level state; baseline shrinks per file.
- Surfaced bugs filed + `@known-failure`-tagged with intact assertions.
- Canonical `npm test` green; `code-reviewer` + `security-reviewer` zero findings; CI green by name; gauntlet where a UI path is touched.
- Judgment-merge per slice. Each slice → In Review → Done on its release cut.

## Notes (running log)
- **2026-06-17 — created Draft (P1, integrity-critical, ~35 files XL).** Money-adjacent; real transaction semantics (atomicity + idempotency) are the contract mocks were hiding. XL → sub-split at pickup.

---
id: SHY-0490
status: Draft
owner: unassigned
created: 2026-08-28
priority: P2
effort: S
type: bug
roadmap_ids: []
mvp: false
epic: EPIC-0003
---

# SHY-0490: The purchase journey buys a product that only exists locally

## User Story

As **whoever runs the journeys against dev**, I want the purchase assertions to
buy something that exists there, so that a 404 means a broken route rather than
a missing fixture.

## Why

J06's receipt-replay assertion posts a hardcoded SKU:

```js
body: { productId: 'local_100_coins', purchaseToken: dupToken }
```

`local_100_coins` exists in the local seed and **not on dev**, so the route
correctly answers 404 and the journey fails with
`first purchase expected 200; got 404`.

The route is fine — an unauthenticated call returns 401 on both environments, so
it is deployed and reachable. Only the fixture is target-blind.

This is the same shape as SHY-0473: a constant baked into a runner that has a
`--target`. That story fixed the API base and the auth endpoint; this is the
same class, one layer up, in the test DATA.

## Acceptance Criteria

### Happy path

- [ ] The purchase assertions use a product the selected target actually has.
- [ ] The local run is unchanged.

### Error paths

- [ ] A missing product on the chosen target fails with a message naming the
      product and the target, not a bare 404.
- [ ] The deliberate unknown-product assertion still expects 404 — that one is
      supposed to be missing.

### Edge cases

- [ ] A target with no purchasable products declares the assertion
      unavailable rather than inventing one.

### Performance

- [ ] None.

### Security

- [ ] No real payment is involved; these are validation-path assertions only.

### UX

- [ ] None.

### i18n

- [ ] None.

### Observability

- [ ] The step names the product it bought, so a fixture drift is legible.

## BDD Scenarios

**Scenario: Buying a coin pack**

- **Given** somebody buying a pack of coins
- **When** the purchase is submitted twice with the same receipt
- **Then** they are charged once

## Test Plan

| Layer | What it proves |
| --- | --- |
| Device (real, dev) | J06 completes against dev. |
| Device (real, local) | J06 still passes locally. |
| Unit | The product id resolves per target, with no constant left. |

## Out of Scope

- Seeding a full economy catalogue on dev. Picking an existing product is
  enough; creating one is a data decision.

## Dependencies

- Follows SHY-0473 (target-aware API) and SHY-0488 (the dev leg running at all).

## Risks & Mitigations

- **Risk:** the chosen dev product changes. **Mitigation:** resolve it from the
  target's own catalogue rather than hardcoding a second constant.

## Definition of Done

- [ ] J06 passes on both targets.
- [ ] No product id constant remains in the runner.

## Notes

Found on the first dev matrix run that got far enough to reach it (SHY-0488).

---
id: SHY-0407
status: Draft
owner: unassigned
created: 2026-08-21
priority: P1
effort: M
type: chore
roadmap_ids: []
mvp: true
---

# SHY-0407: Nobody ever subscribes, renews, lapses or cancels

## User Story

As **somebody paying monthly for SuperShy**, I want the subscription lifecycle to
be walked, so that the month I stop being charged is also the month the perks
stop — and not some other month.

## Why

SuperShy is a recurring paid tier. `routes/subscriptions.js` has 7 endpoints and
`apple-notifications.js` receives store lifecycle callbacks.

The audit found **no scenario that subscribes**. The four steps mentioning
subscriptions are:

- `Subscriptions removed, no further notifications` — notification subscriptions,
  a different thing entirely
- `Stalkers tab shows SuperShy gate when user is not SuperShy` — the gate, from
  the *outside*

So the gate is walked from outside and never from inside. **Nobody has walked
being a subscriber.**

Renewal and expiry are where subscription bugs live, and both are invisible
without a journey: perks that outlive payment cost money silently, and perks that
expire early cost trust loudly.

## Acceptance Criteria

### Happy path

- [ ] Somebody subscribes and the perk unlocks — the Stalkers tab opens for the
      same account that saw the gate.
- [ ] The subscription shows as active with its renewal date.
- [ ] It renews and access continues without interruption.
- [ ] Cancelling keeps access until the paid period ends.
- [ ] After expiry, the gate returns.

### Error paths

- [ ] A failed payment does not grant the perk.
- [ ] A store callback that cannot be verified is refused and grants nothing.
- [ ] A cancellation that fails leaves the subscription active, not in limbo.

### Edge cases

- [ ] Subscribing twice does not double-charge or double-grant — the same
      idempotency `j06` already proves for coin purchases.
- [ ] A subscription that expires while the person is mid-session — the perk
      closes cleanly rather than half-working.
- [ ] Re-subscribing after a lapse restores access.
- [ ] A refunded subscription revokes the perk.
- [ ] Restoring purchases on a new device grants the perk there.
- [ ] Walked on real Android **and** real iPhone — the stores differ.

### Performance

- [ ] The perk unlocks promptly after purchase, without a relaunch.

### Security

- [ ] A replayed store receipt does not grant a second period — the shape
      [[j06]] pins for coins.
- [ ] One account cannot activate a subscription for another.
- [ ] A forged store callback grants nothing.

### UX

- [ ] What the subscription costs, when it renews, and how to cancel are all
      visible before purchase.

### i18n

- [ ] Price and renewal date render correctly in a non-English locale.

### Observability

- [ ] Subscribe, renew, cancel and expire are each auditable afterwards.

## BDD Scenarios

**Scenario: Subscribing opens the gate**

- **Given** somebody blocked by the SuperShy gate
- **When** they subscribe
- **Then** the gated feature opens for them

**Scenario: Cancelling keeps what was paid for**

- **Given** a subscriber who cancels mid-period
- **When** they use the gated feature before the period ends
- **Then** it still works

**Scenario: The gate returns when the period ends**

- **Given** a cancelled subscription whose paid period has ended
- **When** they open the gated feature
- **Then** the gate is back

**Scenario: A failed payment grants nothing**

- **Given** somebody whose payment fails
- **When** they open the gated feature
- **Then** it is still gated

**Scenario: A replayed receipt does not extend anything**

- **Given** a store receipt that has already been processed
- **When** it is submitted again
- **Then** the subscription period is unchanged

## Test Plan

| Layer | What it proves |
| --- | --- |
| **Journey, both stores** | Subscribe → perk opens → cancel → still works → expire → gate returns, on real Android and real iPhone. The far end is the GATED FEATURE, not a receipt. |
| Idempotency | Replayed receipt and double purchase, against the real receipt store — the same shape `j06` proves for coins. |
| Callback | A forged/unverifiable store callback grants nothing; asserted against the real verifier. |
| Lifecycle | Expiry mid-session closes the perk cleanly; re-subscribe restores it. |
| Security | Cross-account activation refused, its own assertion. |

## Out of Scope

- Changing pricing, perks or renewal terms.

## Dependencies

- Sandbox store accounts on both platforms, and a way to force renewal and
  expiry without waiting a month.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Only the purchase is walked, and expiry is assumed | Expiry and post-expiry gating are separate required scenarios. |
| One store is walked and the other inferred | Both required; the stores' callback shapes differ. |
| The perk is asserted by a flag in the database | Asserted at the gated FEATURE, from the same account that saw the gate. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Full lifecycle walked on a real Android device and a real iPhone.

## Notes

- Found 2026-08-21 in the deeper journey audit. Sibling of [[SHY-0402]], which
  covers the admin economy surfaces and transaction history.

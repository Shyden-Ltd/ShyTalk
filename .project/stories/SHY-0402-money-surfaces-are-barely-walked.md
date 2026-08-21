---
id: SHY-0402
status: Draft
owner: unassigned
created: 2026-08-21
priority: P1
effort: M
type: chore
roadmap_ids: []
mvp: true
---

# SHY-0402: The surfaces that handle money are barely walked

## User Story

As **somebody who spends real money in ShyTalk**, I want the screens that show
what I bought and what I have left to be walked before release, so that a mistake
about my balance is caught by us and not by me.

## Why

The 2026-08-21 journey audit measured coverage per surface. The economy surfaces
are the thinnest in the product:

| Surface | Files that mention it |
| --- | --- |
| Admin **spin-monitor** | **0** |
| Admin **economy-config** | 1 |
| **Transaction history** | 1 |
| **Expiry upsell** | 1 |

Lucky Spin is a gacha mechanic taking real currency, and the tab an admin uses to
watch it has **no test naming it at all**. `economy-config` sets the values those
spins pay out.

This matters beyond ordinary risk: [[SHY-0372]] shipped a Lucky Spin defect where
a refused pull left the wheel permanently dead, and it was found by a person
walking the journey on a device — not by the suite.

Transaction history is the screen somebody opens when they think they have been
charged wrongly. It is the evidence surface for a money dispute.

## Acceptance Criteria

### Happy path

- [ ] Transaction history shows a purchase that was just made, with the right
      amount and time.
- [ ] The admin spin-monitor shows a spin that just happened.
- [ ] An economy-config change is visible in what the app then offers.
- [ ] The expiry upsell appears when a subscription is near its end.

### Error paths

- [ ] A failed purchase appears as failed, not as nothing.
- [ ] A refused spin leaves the wheel usable — the [[SHY-0372]] regression, pinned
      as a journey rather than only a unit test.
- [ ] Transaction history with no transactions shows an empty state, not a blank
      screen or a spinner that never stops.

### Edge cases

- [ ] A balance of exactly zero renders correctly everywhere it appears.
- [ ] Transaction history pages beyond the first screenful.
- [ ] A spin at the moment a config change lands does not pay out twice or zero.
- [ ] Walked on real Android **and** real iPhone.

### Performance

- [ ] Transaction history opens promptly with a long history.

### Security

- [ ] One account cannot see another's transactions — its own scenario.
- [ ] economy-config and spin-monitor refuse a non-admin — its own scenario per
      tab, because "admin only" that was never walked is how an admin surface
      leaks.

### UX

- [ ] Amounts and currency read correctly in a non-English locale.

### i18n

- [ ] Asserted on rendered text in at least one non-Latin locale.

### Observability

- [ ] A spin and a purchase are both traceable from the admin side afterwards.

## BDD Scenarios

**Scenario: A purchase shows up in the history**

- **Given** somebody who has just bought coins
- **When** they open their transaction history
- **Then** the purchase is listed with its amount

**Scenario: An admin can see spins as they happen**

- **Given** somebody has just used Lucky Spin
- **When** an admin opens the spin monitor
- **Then** that spin is shown

**Scenario: Another person's transactions stay private**

- **Given** somebody else's purchase history
- **When** an account that does not own it asks for it
- **Then** it is refused

## Test Plan

| Layer | What it proves |
| --- | --- |
| Journey, both devices | Buy, spin, and read the history end to end, confirmed on the admin side. |
| Regression | The [[SHY-0372]] dead-wheel case walked as a journey, so it cannot return quietly. |
| Security | Non-admin refused on each admin economy tab; cross-account transaction read refused. |
| Empty/boundary | Zero balance, empty history, pagination past the first page. |

## Out of Scope

- Changing any economy behaviour. This is coverage for what exists.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Money journeys are written happy-path only | Failure, empty and boundary cases are each required and counted separately. |
| An admin tab is assumed protected because it "requires admin" | Each tab gets its own non-admin refusal scenario. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Walked on a real Android device and a real iPhone.

## Notes

- Sibling of [[SHY-0401]] from the same audit. The method: count journey files
  mentioning each surface, then read the actual steps rather than trusting the
  count.

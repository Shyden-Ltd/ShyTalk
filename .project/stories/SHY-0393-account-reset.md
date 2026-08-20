---
id: SHY-0393
status: Draft
owner: unassigned
created: 2026-08-21
priority: P1
effort: L
type: feature
roadmap_ids: []
mvp: true
---

# SHY-0393: Resetting an account, without losing what was paid for

## User Story

As **somebody whose corrected age changes what I am allowed to do**, I want to
start again cleanly without losing what I paid for, so that fixing an honest
mistake does not cost me money.

## Why

**Operator, 2026-08-21:** where a date-of-birth correction crosses the age
threshold, *"we can provide the user the ability to fully reset their account"* —
and *"the reset will reset everything apart from paid-for items."*

Then, importantly: *"that account reset should also be actionable by an admin
manually, and it should also be reversible by an admin, in case of any error."*

This is the humane alternative to [[SHY-0389]]'s suspension. Somebody whose age
turns out to be lower than their profile claimed has, on their account, history
built under a status they were not entitled to. A reset lets them continue
honestly rather than only be locked out.

## Reversible means it cannot delete

**Reversibility is the hard constraint and it shapes everything else.** A reset
that hard-deletes cannot be undone, so the reset must **snapshot and archive**
rather than destroy, and an admin restore must put it all back.

There is precedent in this codebase: suspension already stores
`preSuspensionDisplayName`, `preSuspensionProfilePhotoUrl`, and
`preSuspensionCoverPhotoUrl`, and restores them on unsuspend. This is the same
shape, larger. **Follow it rather than invent a second one.**

## What survives

**Operator decision:** purchases and their entitlements.

| Survives | Reset |
| --- | --- |
| Coins and beans bought with real money | Coins and beans that were earned |
| Super Shy and any paid entitlement | Gifts, backpack, gift wall |
| The purchase record itself | GCS, warnings, spin history |
| The corrected date of birth | Followers, rooms, messages, history |

The boundary needs stating precisely in the implementation: a balance is a single
number, so **earned and purchased amounts must be distinguishable** before this
can be correct. If they are not today, that is the first piece of work, not a
detail — and it decides whether this story is even buildable as specified.

## Acceptance Criteria

### Happy path

- [ ] Somebody offered a reset can take it and continue with a clean account.
- [ ] Everything paid for is still there afterwards.
- [ ] The corrected date of birth is in place, and the age gates behave for the
      new age.
- [ ] An admin can perform a reset from the dashboard.
- [ ] An admin can **reverse** a reset and the account returns to what it was.

### Error paths

- [ ] A reset that fails part-way leaves the account usable, not half-wiped.
- [ ] A reversal that fails says so and changes nothing.
- [ ] Reversing a reset that was already reversed is refused, not applied twice.

### Edge cases

- [ ] A reset while the person is in a room is handled coherently.
- [ ] Two resets in a row — the second must not destroy the first's archive and
      make it unrecoverable.
- [ ] How long an archive is retained is stated explicitly, and enforced.
- [ ] A reset for somebody with no purchases works.

### Performance

- [ ] The reset completes without the person watching a spinner indefinitely.

### Security

- [ ] Only the account holder or an admin can trigger it; nobody can reset
      anybody else.
- [ ] Both reset and reversal are **audit-logged** with who did it and why.
- [ ] The archive is admin-only and is not readable by the account holder.
- [ ] A reset cannot be used to escape moderation — warnings, GCS and any active
      suspension must be considered deliberately, not wiped by default. **State
      the decision explicitly; do not let it fall out of the implementation.**

### UX

- [ ] The person is told plainly what they will lose and what they will keep,
      before confirming.
- [ ] The confirmation is deliberate — this is not an accidental tap.

### i18n

- [ ] All copy in all 21 locale files.

### Observability

- [ ] Resets and reversals are countable and attributable.

## BDD Scenarios

**Scenario: A fresh start that keeps what was paid for**

- **Given** somebody whose corrected age crosses the limit
- **When** they choose to reset
- **Then** their account starts over with everything they paid for intact

**Scenario: An admin can undo a mistake**

- **Given** an account was reset in error
- **When** an admin reverses it
- **Then** the account is as it was

**Scenario: A reset is not an escape route**

- **Given** somebody with active warnings
- **When** their account is reset
- **Then** their moderation history is handled per the stated rule, not silently cleared

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | Purchased balances survive; earned balances do not. This is the test the whole story rests on. |
| API | Reset and reversal are admin-or-owner only, audit-logged, and idempotent. |
| Reversal | An account reset then reversed is byte-for-byte what it was — asserted on the whole document, not on a few fields. |
| Mutation | Make the reset delete rather than archive; the reversal test must go red. |
| Moderation | Warnings and GCS behave per the stated rule, with a test naming that rule. |
| Journey | Real device: correction crosses the threshold → offered a reset → takes it → purchases intact. |

## Out of Scope

- The correction flow ([[SHY-0392]]) and the suspension ([[SHY-0389]]).
- Account deletion, which already exists and is a different thing.

## Dependencies

- **Earned versus purchased balances must be distinguishable.** If they are not,
  that is the first piece of work and it may be a story of its own.
- [[SHY-0392]] hands off to this.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A reset cannot be reversed because it deleted | Archive-and-restore, following the suspension precedent; a mutation test proves the reversal actually depends on it. |
| Purchased and earned balances are one number | Called out as a hard dependency, not a detail. |
| A reset quietly clears moderation history | The rule must be stated and tested, never implied. |
| A second reset destroys the first archive | Explicit test for two in a row. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Reset and reversal both walked on a real device.
- [ ] Purchases proven intact after a reset.
- [ ] Audit entries verified for both directions.

## Notes

- Reversibility is the constraint that makes this L rather than M.

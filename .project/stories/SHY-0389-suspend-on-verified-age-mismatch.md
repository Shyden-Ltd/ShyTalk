---
id: SHY-0389
status: Draft
owner: unassigned
created: 2026-08-21
priority: P1
effort: M
type: feature
roadmap_ids: []
mvp: true
---

# SHY-0389: Entering a false adult date of birth costs the account

## User Story

As **the operator**, I want an account suspended when verification proves the
person is under age despite an adult date of birth on file, so that lying about
age to reach 18+ features is not a free attempt.

## Why

**Operator, 2026-08-21:** *"Suspend the account, the user would need to contact
support to rectify the situation. most likely the account will remain locked due
to attempts to provide false data and access restricted areas."*

ShyTalk has a minor cohort, which is why age segregation exists. Somebody
entering a false adult date of birth to reach gacha and private messages is not a
data-entry error; it is a deliberate attempt to defeat a safeguarding control.

## Three things this story must get right

### 1. The warning ships first

[[SHY-0388]] adds a warning at date-of-birth entry that false data may lead to
permanent suspension. **That must land before or with this story.** Penalising
somebody for something they were never warned about is unfair, and indefensible
on a platform with minors.

### 2. A human pulls the trigger

Verification is an admin reading an identity document. A misread suspends a real
person, and the operator's position is that the account *"will most likely remain
locked"* — so the consequence is close to irreversible.

**Recommendation: the system flags the mismatch and an admin confirms it.** Same
outcome, one human check on an action that is hard to undo. Fully automatic
suspension is possible and is the operator's call, but it should be a decision
taken deliberately rather than inherited from this story's default.

### 3. The route out is appeals, not support

ShyTalk already has a suspension appeal flow — `POST /appeals`, an admin tab, and
a refusal when an appeal is already pending. A suspended person should use it.
Sending them to the new support queue instead would split the same conversation
across two systems.

The operator said *"contact support to rectify"*; appeals **is** the support
route for a suspension, and it already exists.

## Acceptance Criteria

### Happy path

- [ ] When verification concludes the person is under age and the stored date of
      birth says otherwise, the account is suspended.
- [ ] The suspended person is told why, and how to appeal.
- [ ] Age-gated features are hidden, per [[SHY-0379]].

### Error paths

- [ ] A verification that is inconclusive suspends nobody.
- [ ] A verification that **agrees** with the stored date of birth changes
      nothing.
- [ ] If the suspension write fails, the account is not left half-suspended.

### Edge cases

- [ ] Somebody whose stored date of birth is under age already — no adult claim
      was made, so there is nothing to suspend for.
- [ ] A mismatch of days rather than years is handled deliberately, not treated
      as fraud by rounding.
- [ ] Re-verification after a correction is possible, or the person is
      permanently stuck by design — state which.

### Performance

- [ ] No change to the verification flow's timing.

### Security

- [ ] The suspension is applied server-side; a client cannot trigger or avoid it.
- [ ] Every suspension is **audit-logged** with who or what triggered it.
- [ ] The verified date of birth is stored so downstream checks agree, rather
      than leaving a false one other code trusts.
- [ ] No verification image or document detail is written to logs.

### UX

- [ ] The person is not left guessing what happened or what to do next.

### i18n

- [ ] All copy in all 21 locale files.

### Observability

- [ ] A suspension of this kind is distinguishable in logs and audit from a
      moderation suspension.

## BDD Scenarios

**Scenario: A false adult age costs the account**

- **Given** somebody whose date of birth says they are an adult
- **When** verification shows they are under age
- **Then** their account is suspended and they are told how to appeal

**Scenario: An honest mismatch is not treated as fraud**

- **Given** somebody whose stored age was already under the limit
- **When** verification confirms it
- **Then** nothing is suspended

**Scenario: An inconclusive check does nothing**

- **Given** a verification that cannot establish an age
- **When** it completes
- **Then** no account is suspended

## Test Plan

| Layer | What it proves |
| --- | --- |
| API | Suspension applied only on a genuine adult-claim mismatch; audit entry written; verified date of birth stored. |
| Mutation | Remove the audit write and the suspension guard separately; each must go red on its own test. |
| Negative | Inconclusive and agreeing verifications suspend nobody — the tests that protect real users from a false positive. |
| Journey | Suspended account sees the reason and can reach the appeal route. |

## Out of Scope

- The warning copy ([[SHY-0388]]).
- Hiding the features ([[SHY-0379]]).
- Changing how verification itself decides an age.

## Dependencies

- **[[SHY-0388]] must ship first or together.** Not after.
- [[SHY-0379]] for the hiding behaviour.
- The existing appeals flow is the route out.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A misread document suspends a real person | Admin confirms rather than the system acting alone — pending the operator's decision. Appeals remains open. |
| Somebody is suspended without ever being warned | SHY-0388 is a hard dependency, stated in both stories. |
| The account keeps a false date of birth that other code trusts | The verified value is written, so cohort and segregation agree. |
| Suspensions of this kind are indistinguishable from moderation ones | Recorded distinctly in audit and logs. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] SHY-0388 already shipped.
- [ ] Audit entry verified.
- [ ] Walked end to end: mismatch → suspension → appeal route reachable.

## Notes

- **Open for the operator:** admin-confirmed or fully automatic. This story
  assumes admin-confirmed, on the grounds that the action is close to
  irreversible and rests on a human reading a document.

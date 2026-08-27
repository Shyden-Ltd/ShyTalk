---
id: SHY-0388
status: Draft
owner: unassigned
created: 2026-08-21
priority: P1
effort: S
type: feature
roadmap_ids: []
mvp: true
---

# SHY-0388: Warn people what a false date of birth costs, before they enter one

## User Story

As **somebody entering my date of birth**, I want to be told what happens if I
enter a false one, so that I am not punished for something nobody warned me
about.

## Why

**Operator, 2026-08-21:** *"We should also display this as a warning during the
Date of Birth entry that invalid data may lead to permanent suspension if
caught."*

This exists because of [[SHY-0389]], which suspends an account when verification
proves somebody is under age despite an adult date of birth on file.

**The order matters and is not negotiable.** A penalty for something the person
was never warned about is unfair, and on a platform with a minor cohort and real
compliance exposure it is also a poor position to defend. **This must ship before
or with SHY-0389, never after.**

## What the screen must say

**Operator, 2026-08-21**, expanding the ask. The screen carries three messages,
and the order is deliberate — the reason first, the consequence second, the
reassurance third:

1. **Why it matters.** To protect the community and everyone in it, and to keep
   the place pleasant to be in, this has to be accurate and verifiable.
2. **What a false entry costs.** It may lead to permanent suspension.
3. **What is not at stake.** The date of birth itself is never shown to anybody.

The operator noted the wider onboarding rework is already ticketed, and that this
cannot wait for it.

### The third message forces a behaviour change

The profile does not show a date of birth — it shows a derived **age**
(`ProfileScreen.kt` renders `age_years_old`), gated on `isOwn || !user.hideAge`.
And `hideAge` defaults to **false**, so age is public unless somebody opts out.

Telling people their information is private while their age is public by default
would be copy that lies on a safeguarding screen. **Operator decision: flip the
default to private and migrate existing accounts** — [[SHY-0391]]. That story is
a hard dependency of this one; the reassurance must be true before it is written.

## Acceptance Criteria

### Happy path

- [ ] The date-of-birth entry screen states, before submission, why accuracy
      matters, that a false entry may lead to permanent suspension, and that the
      date of birth is never displayed to others.
- [ ] The warning is legible without scrolling or expanding anything.
- [ ] Somebody entering a true date of birth is not made to feel accused.
- [ ] Every claim on the screen is true of the shipped behaviour — checked, not
      assumed.

### Error paths

- [ ] The warning is present on every path that sets a date of birth, not only
      the first-run one.

### Edge cases

- [ ] It appears for both the under-age-refused case and the accepted case —
      it is about honesty, not about the outcome.

### Performance

- [ ] No change.

### Security

- [ ] The warning does not disclose how verification detects a mismatch.

### UX

- [ ] Firm and plain, not threatening. The aim is that nobody is surprised
      later.

### i18n

- [ ] Copy in all 21 locale files, per the parity guard and pinned count.

### Observability

- [ ] Not applicable; no behaviour is added.

## BDD Scenarios

**Scenario: Nobody is surprised later**

- **Given** somebody is entering their date of birth
- **When** they read the screen
- **Then** they are told a false date of birth may cost them their account

## Test Plan

| Layer | What it proves |
| --- | --- |
| Copy tests | The warning renders on the date-of-birth screen, asserted on **rendered text**, in every locale. |
| Coverage | Every route that sets a date of birth shows it — found by scanning for the setter, not by listing the two we remember. |
| Device | Seen on a real Android device and a real iPhone. |

## Out of Scope

- The suspension itself ([[SHY-0389]]).
- The minimum-age rule, which is unchanged.

## Dependencies

- **[[SHY-0391]] must ship first or together** — the privacy claim on this screen
  is not true until the age default is flipped.
- Ships before [[SHY-0389]], which is the consequence this warns about.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| SHY-0389 ships first and somebody is suspended unwarned | This story is an explicit dependency of SHY-0389, stated in both. |
| The privacy reassurance is written while age is still public | SHY-0391 is a hard dependency; a copy test asserts the claim against the shipped default rather than against intent. |
| A second date-of-birth entry path is added later without the warning | The coverage test scans for the setter rather than listing known screens. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Seen on a real Android device and a real iPhone.
- [ ] Confirmed present on every date-of-birth entry path.

## Notes

- Prerequisite for [[SHY-0389]]. Do not let that one land first.

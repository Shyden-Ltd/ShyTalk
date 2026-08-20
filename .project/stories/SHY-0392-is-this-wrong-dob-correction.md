---
id: SHY-0392
status: Draft
owner: unassigned
created: 2026-08-21
priority: P1
effort: M
type: feature
roadmap_ids: []
mvp: true
---

# SHY-0392: "Is this wrong?" — a way to correct a date of birth

## User Story

As **somebody whose age is wrong on my profile**, I want an obvious way to say
so and prove the right one, so that a mistake I made once does not follow me.

## Why

**Operator, 2026-08-21:** *"in the user's profile we show them their date of
birth. next to it should be a link that says, 'is this wrong?' clicking it will
take them to a new page where they will be informed of the importance of it being
correctly entered. we can then give them the opportunity to provide ID to fix the
Date of Birth."*

Today there is no route at all. Somebody who mistypes their year at signup is
stuck with it, and the only escalation the app offers is a dialog telling them to
contact support — which until [[SHY-0385]] did nothing.

### One correction to the framing

The profile shows a derived **age**, not the date of birth — `ProfileScreen.kt`
renders `age_years_old`, gated on `isOwn || !user.hideAge`. So the link sits next
to the **age**, and the page behind it corrects the underlying date of birth.
Worth stating so nobody goes looking for a date that is not on screen.

### Why this matters more than convenience

[[SHY-0389]] suspends an account when verification proves somebody is under age
despite an adult date of birth. A person who genuinely mistyped needs a route to
fix it **before** that happens. Without this story, the only people who correct a
date of birth are the ones who get caught.

## Acceptance Criteria

### Happy path

- [ ] The person's own profile shows an "Is this wrong?" link beside their age.
- [ ] It opens a page explaining why an accurate date of birth matters.
- [ ] From there they can submit identification to have it corrected.
- [ ] They are told what happens next and roughly how long it takes.

### Error paths

- [ ] A failed submission keeps what they provided.
- [ ] An unreadable or unsupported document is refused with a reason, before
      upload where possible.
- [ ] A submission already in progress is explained rather than silently
      duplicated.

### Edge cases

- [ ] The link appears only on **their own** profile, never on somebody else's.
- [ ] Somebody whose age is hidden still sees their own age and the link.
- [ ] A correction that **crosses the age threshold** hands off to the reset
      route in [[SHY-0393]] rather than dead-ending.
- [ ] A correction that does not cross any threshold simply updates the date.

### Performance

- [ ] Documents are compressed before upload, as reporting already does.

### Security

- [ ] Uploads use the existing signed-URL path; no long-lived storage credential
      reaches the client.
- [ ] The submitted document is admin-only and is not retained longer than the
      decision needs.
- [ ] Only an admin decision changes the stored date of birth — a submission
      alone never does.
- [ ] Every change of a stored date of birth is **audit-logged** with who
      approved it.

### UX

- [ ] The explanation is the reason, not a warning — somebody correcting an
      honest mistake should not feel accused.
- [ ] The link is findable without being alarming.

### i18n

- [ ] All copy in all 21 locale files.

### Observability

- [ ] A correction request and its outcome are traceable, without logging the
      document or the date.

## BDD Scenarios

**Scenario: Somebody fixes an honest mistake**

- **Given** somebody whose age is wrong on their profile
- **When** they say so and provide identification
- **Then** their date of birth is corrected once an admin agrees

**Scenario: Only an admin can change it**

- **Given** somebody has submitted identification
- **When** nobody has reviewed it yet
- **Then** their date of birth is unchanged

**Scenario: Crossing the threshold is handed off**

- **Given** a correction that would move somebody across the age limit
- **When** it is approved
- **Then** they are taken through the reset route rather than left in place

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | The link renders only on one's own profile, and still renders when the age is hidden. |
| API | A submission alone never changes the date of birth; only an admin decision does, and it writes an audit entry. |
| Mutation | Remove the admin gate; the "only an admin can change it" test must go red. |
| Journey | Real device: link → explanation → submit → admin approves → age updates. |

## Out of Scope

- The reset itself ([[SHY-0393]]).
- The suspension path ([[SHY-0389]]).
- Reworking onboarding, which is separately ticketed.

## Dependencies

- The existing age-verification upload path is the mechanism to reuse.
- Hands off to [[SHY-0393]] when a correction crosses the threshold.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Somebody edits their way past the age gate | A submission never changes anything; only an admin decision does, and it is audit-logged. |
| The link reads as an accusation | Copy is the reason, not the warning; the warning lives on the entry screen. |
| A threshold-crossing correction dead-ends | Explicit hand-off to SHY-0393, with its own test. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Walked on a real Android device and a real iPhone.
- [ ] Audit entry verified for an approved correction.

## Notes

- The profile shows **age**; the page corrects the **date of birth**.

---
id: SHY-0403
status: Draft
owner: unassigned
created: 2026-08-21
priority: P1
effort: M
type: chore
roadmap_ids: []
mvp: true
---

# SHY-0403: Safety and identity surfaces nobody walks

## User Story

As **somebody relying on ShyTalk's safety rules to hold**, I want the screens
those rules run through to be walked, so that a rule that quietly stopped working
is caught before it matters.

## Why

The 2026-08-21 journey audit found these surfaces at or near zero:

| Surface | Files that mention it | Why it matters |
| --- | --- | --- |
| **Country picker** | **0** | jurisdiction drives age gating; the operator's UK→Indonesia move made jurisdiction follow the USER |
| **Message edit history** | **0** | a moderator's record of what a message said BEFORE it was edited |
| Admin **starting-screens** | 2 | what a person sees first, including the blocked and banned states |
| Admin **age-segregation** | 4 | the safeguarding boundary itself |

**Edit history at zero is the sharpest.** Its whole purpose is that somebody
cannot say something abusive, be reported, and edit it into something innocent. If
that record silently stopped being written, nothing in the suite would notice, and
the failure would only surface as a moderator being unable to act on a real report.

**Country picker at zero** matters because the jurisdiction it sets decides which
age rules apply. A picker that writes the wrong value, or fails to write at all,
would put somebody under the wrong regime — and Indonesia is stricter than the UK
on exactly the mechanics ShyTalk contains.

## Acceptance Criteria

### Happy path

- [ ] Choosing a country stores it and the app then behaves per that jurisdiction.
- [ ] Editing a message records what it said before, and a moderator can read it.
- [ ] The starting screen an admin configures is the one a person then sees.
- [ ] Age segregation keeps a minor and an adult apart on the surfaces it governs.

### Error paths

- [ ] Cancelling the country picker leaves the previous value, not an empty one.
- [ ] A failed edit leaves the original message intact and readable.
- [ ] An unreachable starting-screen config falls back to something sensible
      rather than a blank first screen.

### Edge cases

- [ ] A country whose name is not Latin script renders and stores correctly.
- [ ] A message edited several times keeps every version in order.
- [ ] A person whose cohort flips between edit and report — the history still
      reads correctly for the moderator.
- [ ] Walked on real Android **and** real iPhone.

### Performance

- [ ] A long edit history opens without stalling the moderation screen.

### Security

- [ ] Edit history is visible to moderators, not to the other participant, unless
      that is the intended design — decide and assert it either way.
- [ ] A non-admin is refused on starting-screens and age-segregation — its own
      scenario per tab.
- [ ] Somebody cannot set another account's country.

### UX

- [ ] The country picker is usable with a long list — searching or scrolling to a
      late-alphabet country is walked, not assumed.

### i18n

- [ ] Country names render in the reader's language, asserted on rendered text.

### Observability

- [ ] An edit is traceable to who made it and when.

## BDD Scenarios

**Scenario: A moderator can read what a message said before**

- **Given** a message that was edited after being reported
- **When** a moderator opens its history
- **Then** they can read the original wording

**Scenario: Choosing a country sets the rules that apply**

- **Given** somebody choosing their country
- **When** they confirm it
- **Then** the app applies that country's age rules

**Scenario: Cancelling the picker changes nothing**

- **Given** somebody who opens the country picker and backs out
- **When** they return to their profile
- **Then** their previous country is unchanged

## Test Plan

| Layer | What it proves |
| --- | --- |
| Journey, both devices | Each surface walked end to end, with the far-end confirmation — the moderator's view, the applied rule, the screen actually shown. |
| Regression | Edit history is asserted from the MODERATOR side, because that is the only side that matters and the only one a bug would hide from. |
| Security | Non-admin refusal per admin tab; cross-account country write refused. |
| i18n | A non-Latin country name, asserted on rendered text. |

## Out of Scope

- Changing any of these behaviours. This is coverage for what exists.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Edit history is tested from the author's side, where it looks fine | The AC requires the moderator's view specifically. |
| Country picker is walked with an easy country only | A non-Latin, late-alphabet country is required. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Walked on a real Android device and a real iPhone.

## Notes

- Sibling of [[SHY-0401]] and [[SHY-0402]] from the same audit.

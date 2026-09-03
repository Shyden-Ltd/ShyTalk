---
id: SHY-0502
status: Draft
owner: unassigned
created: 2026-09-03
priority: P1
effort: S
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0010
---

# SHY-0502: The cyber-bullying policy is translated into no language we ship

## User Story

As **somebody being bullied who does not read English**, I want the policy that
tells me what ShyTalk will do about it to be in my language, so that the document
written to protect me is one I can actually read.

## Why

Found on 2026-09-03 while retiring the non-MVP locales (SHY-0289). Every legal
section in `LEGAL_T` carries all twenty locales — except one:

| Section | Locales | Any of the five MVP languages? |
| --- | --- | --- |
| `footer` | 20 | yes |
| `privacy` | 20 | yes |
| `terms` | 20 | yes |
| `guidelines` | 20 | yes |
| **`cyber`** | **3** (`ar`, `de`, `km`) | **NONE** |
| `notfound` | 20 | yes |

The cyber-bullying policy was translated into Arabic, German and Khmer — and all
three were retired, because none of them is a language ShyTalk ships. So the page
now falls back to English in every supported locale, and did so for four of the
five even before the retirement.

**Why this one matters more than a missing footer link.** ShyTalk has a minor
cohort, which is why age segregation exists at all. The cyber-bullying policy is
the document a bullied minor is pointed at, and it is the only legal page with no
translation in any language we claim to support. A safety document nobody can
read is a safety document that does not exist.

It hid for as long as it did because `translation-verification` picked one locale
to prove the page translates, and the locale it picked happened to be one of the
three. Twenty locales made the gap invisible; five made it obvious the moment the
suite ran.

## Acceptance Criteria

### Happy path

- [ ] The cyber-bullying page renders fully translated in all five supported
      languages, with no English left on the page.
- [ ] `LEGAL_T.cyber` carries the same key set as the other legal sections, for
      every supported locale.

### Error paths

- [ ] A key missing from one locale fails a test rather than silently rendering
      the English fallback — which is exactly how this went unnoticed.

### Edge cases

- [ ] The keys the page actually uses are the ones translated. A section that is
      complete against its own key list but disagrees with the HTML is the same
      failure wearing a different hat.

### Performance

- [ ] N/A.

### Security

- [ ] The translations are reviewed by somebody who reads the language. This is
      safeguarding copy for minors; a machine translation that softens or
      mis-states what ShyTalk will do is worse than English.

### UX

- [ ] No layout break in any of the five, including the longer languages.

### i18n

- [ ] Covered by the happy path — this story IS the i18n.

### Observability

- [ ] A section missing an entire locale is reported by the existing legal
      parity checks, so the next one cannot hide behind a lucky test locale.

## BDD Scenarios

**Scenario: A bullied minor reads the policy in their language**

- **Given** somebody using ShyTalk in Thai
- **When** they open the cyber-bullying policy
- **Then** it is written in Thai

**Scenario: A missing translation is noticed**

- **Given** a legal section missing one supported language
- **When** the checks run
- **Then** they fail and name the section and the language

## Test Plan

- Static: every legal section defines every key for every supported locale —
  generalised from the existing per-section checks so no section can be exempt.
- Browser: open the page in each of the five and assert no English remains.
- Review: a reader of each language signs off the safeguarding wording.

## Out of Scope

- Retranslating the other legal pages. They are complete for the five.
- Reinstating Arabic, German or Khmer. SHY-0289 retired them deliberately.

## Dependencies

- SHY-0289 (retired the locales that exposed this).

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Machine translation ships unreviewed safeguarding copy | Explicit Security criterion: a human reader of the language signs it off. |
| Only this section is fixed and the next gap hides the same way | The parity check is generalised across sections, not patched for `cyber`. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] The page reads correctly in all five, confirmed by somebody who reads each.

## Notes

- Found 2026-09-03 by SHY-0289. `translation-verification`'s cyber-bullying case
  is marked `fixme` pointing here rather than deleted: the coverage is correct
  and the product is wrong, so the test should start passing when this is fixed
  rather than be quietly removed.

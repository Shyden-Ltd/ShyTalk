---
id: SHY-0423
status: Draft
owner: unassigned
created: 2026-08-22
priority: P3
effort: XS
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0423: The resolved cohort is never recomputed after somebody sets their date of birth

## User Story

As **somebody who has just given my date of birth**, I want the app to know
which cohort I am in from that moment, so that nothing downstream is working
from the answer it had before I told it.

## Why

`AuthViewModel.resolveProfileState` sets `authRepository.resolvedCohort =
user.effectiveCohort` once, when the profile is first resolved. Somebody who
signs in without a stored date of birth is sent to the "One More Step" gate,
gives their date of birth, and continues — and `resolvedCohort` still holds the
value from before.

Observed on a real iPhone on 2026-08-22: after storing a 1995 date of birth, the
preview overlay still read `UID: 50000010 · minor` for the rest of the session.

### What it does and does not affect today

`resolvedCohort` is read in exactly two places:

- `core/PreviewWatermark.kt` — the debug overlay, preview builds only.
- `IosAuthRepositoryImpl` — the value written into the SESSION CACHE, which
  `MainViewController` restores into `resolvedCohort` at the next cold start.

**No age gate reads it.** The cohort walls read the user document, so nothing a
person can see or reach is wrong today. That is why this is P3 and not P1.

**Why file it anyway.** The stale value is PERSISTED into the session cache and
restored on the next launch, so it is not merely a display bug that a refresh
clears — it survives. And the loop is closed only for as long as nobody uses
`resolvedCohort` for a decision. In an app with a minor cohort and age
segregation, a field named "resolved cohort" that can hold a value contradicting
the account is a trap sitting in wait, not a cosmetic slip.

## Acceptance Criteria

### Happy path

- [ ] Completing the date-of-birth gate recomputes `resolvedCohort` from the
      stored profile, in the same session, with no relaunch.
- [ ] The session cache is written with the recomputed value, so the next cold
      start restores the right one.

### Error paths

- [ ] If the profile cannot be re-read after the gate, `resolvedCohort` is
      CLEARED rather than left stale. Absent is honest; wrong is not.

### Edge cases

- [ ] The same holds for any other route that changes the stored date of birth,
      including an admin correcting it — the cohort must not outlive the fact it
      was derived from.

### Performance

- [ ] No extra network call on the ordinary sign-in path, which already resolves
      the profile.

### Security

- [ ] Nothing may begin reading `resolvedCohort` for a cohort gate as part of
      this story. The gates stay server-backed.

### UX

- [ ] No user-visible change on a correct build; the preview overlay stops
      contradicting the account.

### i18n

- [ ] No new strings.

### Observability

- [ ] The recompute is logged with the before and after value, so a future
      "wrong cohort" report has evidence.

## BDD Scenarios

**Scenario: The cohort follows the date of birth**

- **Given** somebody who has just given their date of birth
- **When** they carry on using the app
- **Then** the app treats them as the cohort that date puts them in

**Scenario: It is still right after a relaunch**

- **Given** somebody who gave their date of birth last session
- **When** they open the app again
- **Then** the cohort restored from the cache matches their account

## Test Plan

| Layer | What it proves |
| --- | --- |
| ViewModel | Completing the gate recomputes the cohort; a failed re-read clears it rather than keeping the old one. |
| Contract | What is written to the session cache matches what the profile says, so a cold start cannot restore a contradiction. |
| Guard | `resolvedCohort` is not read by any cohort GATE — the check that stops this latent trap becoming a real one. |
| Journey | Walked on a real device: sign in without a date of birth, give one, confirm the app agrees. |

## Out of Scope

- Changing how cohort walls are enforced. They read the server and must keep
  doing so.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Somebody "fixes" this by pointing a gate at `resolvedCohort` | The AC forbids it and a guard asserts it. |
| The recompute races the navigation off the gate | Assert the value AFTER the gate completes, not during. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Seen correct on a real device, in the same session and after a relaunch.

## Notes

- Found on 2026-08-22 during the [[SHY-0396]] iPhone walk. The persona's local
  seed had no date of birth, which is what surfaced the gate at all — worth
  noting because it means the ordinary walk never hits this path.
- `AuthRepositorySignOutContractTest` already asserts `resolvedCohort` is
  cleared on sign-out (SHY-0205). This is the same field's other lifecycle
  moment, which was never given the same treatment.

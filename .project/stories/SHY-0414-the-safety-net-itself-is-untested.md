---
id: SHY-0414
status: Draft
owner: unassigned
created: 2026-08-21
priority: P0
effort: M
type: chore
roadmap_ids: []
mvp: true
---

# SHY-0414: The backup, the alarm, and the DOB an admin can change

## User Story

As **the operator relying on a safety net**, I want the net tested before I fall
into it, so that "we have backups" and "we would be alerted" are facts rather
than beliefs.

## Why

The fourth audit pass found the safety net itself unwalked. Three things, each
of which is only discovered to be broken at the worst possible moment.

### The restore

`POST /admin/backups/restore/:date` and `POST /admin/backups/recover-photos`,
alongside trigger and listing. **An untested restore is not a backup — it is a
hope.** Nothing in 711 scenarios triggers a backup, lists one, restores from one,
or recovers photos. The day that matters is the day something has already gone
wrong, which is the worst possible day to learn the restore path does not work.

### The alarm

`routes/admin-alerts.js` — list, create, acknowledge, resolve, and **alert
thresholds** that decide when anything fires at all. This is a meta-failure:
**if alerting is broken, every other failure becomes invisible.** A threshold
misconfigured to never fire looks exactly like a healthy system.

### The date of birth an admin can change

`POST /admin/age-verification/:id/modify-dob` lets an admin change somebody's
date of birth. That moves a person between cohorts, and cohort is the boundary
the entire safeguarding design rests on. `j04` covers `reject_and_dob_down`
thoroughly — the atomic flip, the session invalidation, the eviction from a voice
room — and `modify-dob` is a **different endpoint** with none of it.

Also here: `POST /user/:uniqueId/notify-changes`, an admin sending a member a
notification, with no scenario.

## Acceptance Criteria

### Happy path

- [ ] An admin triggers a backup and it appears in the list.
- [ ] An admin restores from a backup and the restored data is readable.
- [ ] Photo recovery returns photos that were lost.
- [ ] An alert fires when its threshold is crossed.
- [ ] An admin acknowledges and then resolves an alert.
- [ ] Changing a date of birth moves the person to the right cohort.
- [ ] An admin notifies a member and the member receives it.

### Error paths

- [ ] Restoring from a date with no backup is refused with a reason.
- [ ] A corrupt or incomplete backup is refused rather than half-restored.
- [ ] An alert that cannot be delivered is itself visible somewhere.
- [ ] A DOB change that fails leaves the previous date, not a blank one.

### Edge cases

- [ ] A restore that would overwrite newer data — the behaviour is defined and
      asserted rather than discovered.
- [ ] Two restores at once do not interleave.
- [ ] A threshold set so nothing can ever fire is visible as such — the
      misconfiguration that looks identical to health.
- [ ] The same alert condition twice does not create two alerts.
- [ ] A DOB change that moves an adult to minor evicts them from adult rooms,
      exactly as `j04` requires of the other path.
- [ ] A DOB change to the same value is harmless.

### Performance

- [ ] A backup of a large collection completes within its documented window.

### Security

- [ ] Every backup endpoint refuses a non-admin — list, trigger, read, restore,
      recover — five separate scenarios.
- [ ] Every alert endpoint refuses a non-admin.
- [ ] Changing a date of birth refuses a non-admin.
- [ ] A restore is auditable: who, when, from which backup.
- [ ] A backup cannot be read by guessing its date as a non-admin.

### UX

- [ ] The admin panel says what a restore will replace before it runs.

### i18n

- [ ] The member-facing notification renders in the member's locale, not the
      admin's — the rule `j18` pins for system PMs.

### Observability

- [ ] Backup, restore, alert lifecycle and DOB changes are all auditable.

## BDD Scenarios

**Scenario: A backup can be restored**

- **Given** a backup taken before data was lost
- **When** an admin restores from it
- **Then** the lost data is readable again

**Scenario: Restoring from nothing is refused**

- **Given** a date with no backup
- **When** an admin tries to restore from it
- **Then** they are refused

**Scenario: An alarm that cannot fire is visible**

- **Given** an alert threshold set so that nothing can ever cross it
- **When** an admin reviews the alert configuration
- **Then** it is apparent that this alert cannot fire

**Scenario: An alert fires and is resolved**

- **Given** a condition that crosses its threshold
- **When** an admin acknowledges and resolves the alert
- **Then** the alert shows as resolved with who resolved it

**Scenario: Changing a date of birth moves the person's cohort**

- **Given** an adult member whose real date of birth is under eighteen
- **When** an admin corrects it
- **Then** the member is treated as a minor

**Scenario: A corrected date evicts them from adult space**

- **Given** an adult member in an adult room
- **When** an admin corrects their date of birth to under eighteen
- **Then** they are removed from that room

**Scenario: Restoring is not open to everyone**

- **Given** somebody who is not an admin
- **When** they try to restore a backup
- **Then** they are refused

## Test Plan

| Layer | What it proves |
| --- | --- |
| **Restore** | Data destroyed in a disposable environment and restored from a real backup, asserted by READING IT BACK. A restore endpoint returning 200 proves nothing. |
| Alarm | A threshold crossed for real and an alert observed; and a threshold that cannot fire surfaced as a finding rather than as silence. |
| Cohort | DOB change asserted through the same consequences `j04` requires — cohort, session, eviction — because it is the same safeguarding boundary reached by a different door. |
| Security | Five backup refusals, alert refusals, and a DOB-change refusal, each its own scenario. |
| Isolation | Runs only against a disposable environment, asserted before anything destructive. |

## Out of Scope

- Changing backup retention, alert thresholds or the DOB-change design.

## Dependencies

- A disposable environment with a real backup taken in it.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The restore test runs somewhere real | Disposable environment asserted in the Background, as `j32` does. |
| A restore is asserted by its response | Asserted by reading the restored data back. |
| Alerting is tested by creating an alert manually | A real threshold is crossed; manual creation is a separate, weaker scenario. |
| `modify-dob` is assumed to behave like `reject_and_dob_down` | Its consequences are asserted independently — same boundary, different door. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] A real restore performed and verified in a disposable environment.

## Notes

- Found 2026-08-21 in the fourth audit pass. Remaining after this pass are
  genuinely internal: `migrate`, `sweep`, `graphs`, `trace`, and cleanup
  sub-paths already covered generically by `j32`.

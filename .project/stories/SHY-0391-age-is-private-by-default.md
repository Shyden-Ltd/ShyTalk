---
id: SHY-0391
status: Draft
owner: unassigned
created: 2026-08-21
priority: P1
effort: S
type: feature
roadmap_ids: []
mvp: true
---

# SHY-0391: Age should be private unless somebody chooses to show it

## User Story

As **somebody on ShyTalk**, I want my age hidden unless I decide otherwise, so
that joining does not quietly publish something about me.

## Why

`User.hideAge` defaults to **false**, and `ProfileScreen.kt` renders the derived
age when `isOwn || !user.hideAge`. So **age is public by default** and people
must opt out.

This surfaced while writing [[SHY-0388]], the date-of-birth warning. The operator
wants that screen to reassure people their date of birth is not displayed unless
they choose. The date itself never is — only the derived age — but somebody
reading "not displayed unless you choose" will reasonably assume their age is
private too, and today it is not.

**Writing that reassurance against today's behaviour would put a false statement
on a safeguarding screen.** Rather than weaken the copy, the operator chose to
make it true.

**Operator decision, 2026-08-21:** flip the default to private **and migrate
existing accounts**.

### The migration is the deliberate part

Flipping the default only helps new accounts. Migrating existing ones overrides a
setting some people may have knowingly left visible — which is a real cost, and
the operator weighed it. On a platform with a minor cohort, defaulting somebody's
age to public is the worse failure of the two.

## Acceptance Criteria

### Happy path

- [ ] A new account has its age hidden from others.
- [ ] Somebody can turn it on in privacy settings, and it then shows.
- [ ] Everybody still sees their own age on their own profile.

### Error paths

- [ ] If the setting cannot be read, the age is **hidden**. Fail closed: a
      failure must not publish something.

### Edge cases

- [ ] Existing accounts are migrated to hidden, including those that never had
      the field set.
- [ ] The migration is idempotent — running it twice changes nothing the second
      time.
- [ ] Somebody who turns it back on after the migration stays on.

### Performance

- [ ] The migration runs without downtime and is safe to resume.

### Security

- [ ] Age visibility is enforced where the profile is **served**, not only where
      it is rendered — a client must not be able to read a hidden age.
- [ ] The date of birth itself is never returned to another user, hidden or not.

### UX

- [ ] The privacy setting states plainly what it controls.
- [ ] Nobody is surprised to find their age newly hidden — decide whether to
      tell them, and state the decision.

### i18n

- [ ] Any copy change goes to all 21 locale files.

### Observability

- [ ] The migration reports how many accounts it changed.

## BDD Scenarios

**Scenario: A new account keeps its age to itself**

- **Given** somebody has just joined
- **When** another person views their profile
- **Then** no age is shown

**Scenario: Showing it is a choice**

- **Given** somebody turns on age visibility
- **When** another person views their profile
- **Then** the age is shown

**Scenario: A failure hides rather than reveals**

- **Given** the visibility setting cannot be read
- **When** a profile is served
- **Then** the age is withheld

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | Default is hidden; an unreadable setting fails closed. |
| API | A hidden age is absent from the served payload, not merely unrendered — the check that stops a client reading it anyway. |
| Migration | Idempotent, resumable, and reports a count. Run against a copy first. |
| Copy | The SHY-0388 reassurance is true of the shipped default, asserted together rather than separately. |

## Out of Scope

- The date-of-birth warning copy ([[SHY-0388]]) beyond making its claim true.
- Any other privacy default.

## Dependencies

- Blocks [[SHY-0388]].

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Somebody deliberately chose to show their age and is silently overridden | Operator decision, taken knowingly; consider telling affected accounts. |
| The age is hidden in the UI but still served | Enforced server-side, with a test asserting absence from the payload. |
| The migration half-runs | Idempotent and resumable, with a reported count. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Migration run on dev and the count checked.
- [ ] A hidden age proven absent from the API payload, not just the screen.

## Notes

- Found while writing [[SHY-0388]]: the copy would have been false. Worth
  remembering that a copy change can expose a behaviour that needs changing.

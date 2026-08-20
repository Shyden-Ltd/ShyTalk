---
id: SHY-0380
status: In Review
owner: shyden
created: 2026-08-20
priority: P1
effort: M
type: feature
roadmap_ids: []
epic: EPIC-0012
mvp: true
---

# SHY-0380: A support-ticket queue an admin can action

## User Story

As **an administrator**, I want support requests to arrive in a queue I can work
through, so that nobody's request is sitting in a place nobody looks.

## Why

**Operator design, 2026-08-20:** *"contacting support should open a form, similar
to reporting, where the support becomes a ticket for an admin on the admin
dashboard to action. not an email."*

This is **part one of two**, split at the operator's direction: the queue and its
admin surface first, the in-app form second ([[SHY-0385]]). Building it this way
means the form is written against a surface already proven to work, rather than
two unproven halves at once.

The origin is a broken control. **Contact support** on the age-restriction dialog
closed the dialog and did nothing else — both call sites passed the dismiss
action. That control is removed in the interim by [[SHY-0384]] and restored by
SHY-0385 once there is something real behind it.

An email was considered and ruled out by the operator. It leaves support with no
queue, no status, no audit trail, and no way to know whether anything was
answered, and it fails outright on a device with no mail app.

### Copy the appeals shape; do not invent a third one

**Appeals** is structurally the same thing — someone submits free text about
their account, it queues, an admin actions it:

| Layer | Existing appeals implementation |
| --- | --- |
| Submit | `POST /appeals` (`express-api/src/routes/reports.js:1363`), takes `appealText`, writes `suspensionAppeals`, **409s if one is already pending** |
| Admin list | `GET /appeals` (`:1415`) |
| Admin action | `PATCH /appeals/:id` (`:1465`) |
| Dashboard | `public/admin/js/tabs/appeals.js`, registered in `main.js:77` |

ShyTalk already has two user→admin queues (reports, appeals). A **third**
differently-shaped one would be the wrong outcome.

### Deliberately the interim surface

[[EPIC-0012]] takes this further — a dedicated support-agent user type working
tickets from the **website portal**, which is gated on the portal existing. This
story ships an **admin-dashboard** surface on purpose and must not grow features
that epic will replace.

## Acceptance Criteria

### Happy path

- [ ] A ticket can be raised by an authenticated account and is stored.
- [ ] An admin sees open tickets in the dashboard, newest first.
- [ ] An admin can mark a ticket handled, and the change persists.
- [ ] An admin can see how many are open.

### Error paths

- [ ] An empty or whitespace-only message is refused with a reason.
- [ ] A second ticket while one is still open is refused with a clear response,
      matching what `POST /appeals` already does.
- [ ] A malformed request is refused without a stack trace reaching the caller.

### Edge cases

- [ ] Two near-simultaneous submissions produce one ticket, not two.
- [ ] A very long message is bounded explicitly, never silently truncated.
- [ ] A ticket raised by an account that is later deleted does not break the
      queue view.

### Performance

- [ ] Listing the queue is paginated or bounded; it must not degrade as tickets
      accumulate.

### Security

- [ ] Raising a ticket is authenticated, and the ticket is bound to that account.
      Nobody can raise or read a ticket for another account.
- [ ] Listing and actioning are **admin-only**, enforced server-side.
- [ ] Rate-limited, so the queue cannot be flooded.
- [ ] The message body is treated as untrusted text wherever it is rendered,
      including the dashboard.
- [ ] Every admin action is **audit-logged**. `PUT /config/:key` currently writes
      no audit entry and that is a known gap — do not repeat it.

### UX

- [ ] The dashboard tab reads consistently with the existing appeals and reports
      tabs.

### i18n

- [ ] Any admin-facing copy follows the existing dashboard's conventions.

### Observability

- [ ] A raised ticket is visible in logs **without** recording the message body.
- [ ] Open count and age of the oldest ticket are obtainable, as
      `GET /reports/stats` does for reports.

## BDD Scenarios

**Scenario: A raised ticket reaches the queue**

- **Given** somebody has asked for help
- **When** an admin opens the dashboard
- **Then** the request is listed and can be marked handled

**Scenario: A second request is not silently duplicated**

- **Given** somebody already has an open request
- **When** they raise another
- **Then** they are told about the one they already have

**Scenario: Only admins can read the queue**

- **Given** somebody who is not an admin
- **When** they try to list tickets
- **Then** they are refused

## Test Plan

| Layer | What it proves |
| --- | --- |
| API tests | Submit, list, action. Ownership enforced. Non-admin refused. Duplicate-pending refused. Admin action writes an audit entry. Uses **supertest with a mocked Firestore**, which is this codebase's established convention for route tests (`express-api/tests/routes/`). |
| Integration | The real-service proof lives in `tests/integration/*.spec.ts`, where a ticket is raised and read back against running services. Route tests prove the logic; the integration spec proves the wiring. |
| Mutation | Remove the admin check; the authorisation test must go red. Remove the audit write; its test must go red. |
| Dashboard tests | Ticket renders, action changes status, the message body is escaped — asserted with a payload that would execute if it were not. |
| Journey | Raise a ticket via the API, action it in a real browser, verify the stored state agrees with the UI. |

## Out of Scope

- The in-app form ([[SHY-0385]]).
- Removing the dead control ([[SHY-0384]]).
- Replying to the person in-app; that belongs to [[EPIC-0012]].
- Migrating appeals or reports onto this model.

## Dependencies

- None to start. [[SHY-0385]] depends on this.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A third user→admin queue diverges from appeals and reports | Follow the appeals shape exactly; call it out in review. |
| The queue is floodable | Rate limit plus duplicate-pending refusal, both already proven in `POST /appeals`. |
| Admin actions are untraceable | Audit entry is an explicit criterion, with a mutation test, because the config endpoint already got this wrong. |
| Untrusted text rendered into the dashboard | Escaping asserted with a payload that would execute if unescaped. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Ticket raised via the API and actioned in a real browser.
- [ ] Audit entry verified for the admin action.
- [ ] Mutation tests confirm the authorisation and audit guards can fail.

## Notes

- Part one of two. Order: [[SHY-0384]] → this → [[SHY-0385]].
- Under [[EPIC-0012]], which replaces this admin surface with a support-agent
  portal once the website portal exists.
- Origin: the operator found **Contact support** did nothing during SHY-0372.

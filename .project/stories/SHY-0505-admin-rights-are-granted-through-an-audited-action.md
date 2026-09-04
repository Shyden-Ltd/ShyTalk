---
id: SHY-0505
status: Draft
owner: unassigned
created: 2026-09-04
priority: P1
effort: M
type: feature
roadmap_ids: []
mvp: true
epic: EPIC-0013
---

# SHY-0505: Administrator rights are granted and removed through an audited action, never the console

## User Story

As **the operator**, I want to grant or remove administrator rights from the
admin tools, with every change recorded, so that who holds the keys is always
known and never depends on a console edit nobody can see.

## Why

Administrator rights are a Firebase custom claim, `admin: true`, re-checked
live on every admin request (`express-api/src/middleware/auth.js:600-662`).
Today exactly two things set it:

- the seeded-persona provisioning script, for the dev admin persona only
  (`express-api/scripts/provision-test-personas.js:454`, run by
  `.github/workflows/seed-dev-personas.yml`, which refuses any project whose
  id does not contain `dev` or `local`);
- the Firebase console, by hand.

The API can only **remove** it: the change-role route clears the claim when a
user is demoted (`express-api/src/routes/admin-users.js:685-750`). Nothing can
grant it. So the operator's own rights on dev were set by hand — a path the
no-direct-backend rule (EPIC-0006) forbids, and one that leaves no audit
entry — and production has **no way to create its first administrator** short
of the console.

EPIC-0013 makes "admin" a role on a ShyTalk account. A role needs an owner:
one audited action that grants and removes it, a control in the tools, and a
provisioning bootstrap for the first administrator of each environment.

## Acceptance Criteria

### Happy path

- [ ] `POST /api/admin/user/:uniqueId/admin-role` with `{ admin: true, reason }`
      grants the role: `mintClaimsMerging(firebaseUid, { admin: true })`
      (`express-api/src/utils/firebase-claims.js:20`), `users/{id}.isAdmin = true`,
      `clearAdminClaimCache(firebaseUid)` (`auth.js:691`), and an
      `adminAuditLog` entry `{ adminId, action: 'GRANT_ADMIN', targetUniqueId,
      details: reason, createdAt }` in the shape `admin-devices.js:235` uses.
- [ ] The same route with `{ admin: false, reason }` removes it: claim
      `admin: false`, `isAdmin = false`, cache cleared, refresh tokens revoked
      (as the change-role demotion does today), audit `REVOKE_ADMIN`.
- [ ] The change-role demotion path and this route share one helper
      (`express-api/src/utils/admin-role.js`); there is exactly one
      implementation of "remove the admin role".
- [ ] Users tab: an **Administrator** toggle on the user record, visible only
      to administrators, asks for a reason in an in-page dialog (no browser
      `confirm`), calls the route, and shows the outcome.
- [ ] Bootstrap: `express-api/scripts/bootstrap-admins.js` reads
      `BOOTSTRAP_ADMIN_EMAILS` (comma-separated), and for each email whose
      Firebase user exists **and** has a `users` document, grants the role via
      the same helper with `adminId: 'bootstrap'` in the audit entry. Run by
      `seed-dev-personas.yml` on dev from `DEV_BOOTSTRAP_ADMIN_EMAILS`, and by
      `deploy-prod.yml` from `PROD_BOOTSTRAP_ADMIN_EMAILS` with
      `FIREBASE_SERVICE_ACCOUNT_PROD`. Both names registered in
      `.github/known-secrets.yml`.

### Error paths

- [ ] Non-admin caller: refused with `code: 'admin_required'` (SHY-0503).
- [ ] Caller targets their own account: refused, `code: 'self_change_refused'`
      — nobody removes their own rights, so an actor always remains.
- [ ] Unknown `uniqueId`: not found. Target with no `firebaseUid`: unprocessable
      with a message saying the account has no sign-in to attach the role to.
- [ ] Missing or over-long `reason` (limit 500, as cohort-override): rejected.
- [ ] Granting to an existing administrator, or removing from a non-admin:
      conflict, no audit entry, no claim write.
- [ ] Bootstrap: an email with no Firebase user, or a Firebase user with no
      ShyTalk account, is skipped with a loud log line naming the email and the
      reason; the run still exits 0 so one bad entry does not block a deploy.
      An unparseable list exits non-zero.

### Edge cases

- [ ] Two simultaneous grants for the same target: one claim write, one audit
      entry (the helper reads the current claim inside the write and the second
      call sees the conflict).
- [ ] A newly granted administrator's current token lacks the claim until it
      refreshes; the response says `signInAgain: true` and the dialog tells the
      administrator to tell them so.
- [ ] A removed administrator loses access within `ADMIN_CLAIM_TTL` (60 s) even
      with a live token — the existing live re-check, now asserted for this
      route.
- [ ] Bootstrap is idempotent: a second run over the same list writes nothing
      and logs "already an administrator" per entry. It only ever grants; it
      never removes.
- [ ] The seeded admin persona keeps its role: provisioning still sets it, and
      bootstrap does not touch accounts not in its list.

### Performance

- [ ] The route completes in under 500 ms on the local stack: one claim read,
      one claim write, one user update, one audit write. Bootstrap handles ten
      emails in under ten seconds.

### Security

- [ ] `requireAdmin` plus the live claim re-check guard the route; the audit
      entry is written before the response.
- [ ] `reason` is stored in the audit entry and never written to the server
      log; emails are never logged on the route path.
- [ ] The bootstrap secret is read only by the two workflows, is listed in the
      secrets inventory (`express-api/tests/scripts/workflow-secrets-inventory.
      test.js` fails otherwise), and the script refuses to run without a
      service account for the target project.
- [ ] The existing admin rate limiter covers the route.

### UX

- [ ] Dialog copy: "Grant administrator rights to <name> (#<id>)? They will
      need to sign in again." with a required reason; outcome toast "Granted.
      Ask them to sign in again." / "Removed." Errors in plain words.

### i18n

- [ ] Dialog and toast strings in all five shipped locales in
      `public/admin/translations.js`; rendered text asserted.

### Observability

- [ ] Every grant and removal is an `adminAuditLog` entry visible in the Audit
      Log tab, and a `log.info('admin-users', 'Admin role changed', { adminId,
      targetUniqueId, admin })` line. Bootstrap logs one line per email with the
      outcome (`granted`, `already`, `skipped:<reason>`).

## BDD Scenarios

**Scenario: An administrator grants the role to a member**

- **Given** an administrator viewing a member's record
- **When** they switch on Administrator and give a reason
- **Then** the member becomes an administrator the next time they sign in
- **And** the change appears in the audit log with who, whom and why

**Scenario: Removing the role takes effect within a minute**

- **Given** an administrator who is signed in to the dashboard
- **When** another administrator removes their rights
- **Then** within a minute their next action is refused

**Scenario: Nobody can remove their own rights**

- **Given** an administrator viewing their own record
- **When** they try to switch Administrator off
- **Then** they are told they cannot change their own rights

**Scenario: The first administrator of an environment comes from provisioning**

- **Given** an environment with no administrator and an operator who has a ShyTalk account
- **When** the environment is deployed with that operator listed as a bootstrap administrator
- **Then** the operator is an administrator
- **And** the audit log records the grant as done by provisioning

**Scenario: Provisioning skips a login that is not a ShyTalk account**

- **Given** a bootstrap list naming a login that never created a ShyTalk account
- **When** the environment is deployed
- **Then** that login is skipped with the reason recorded
- **And** the deploy is not blocked

**Scenario: Granting to an existing administrator changes nothing**

- **Given** somebody who is already an administrator
- **When** an administrator tries to grant them the role again
- **Then** they are told the person is already an administrator
- **And** nothing is recorded

## Test Plan

### Red

- `express-api/tests/routes/admin-role.test.js` (real Auth and Firestore
  emulators, `AUTH_FORCE_LIVE_ADMIN_CHECK` as `livekit-cohort.test.js` does):
  grant writes claim, `isAdmin`, cache clear and audit; revoke also revokes
  tokens; self-change refused; non-admin refused with `admin_required`; unknown
  and uid-less targets; conflict cases write nothing; the revoked admin's live
  token is refused after the cache is cleared.
- `express-api/tests/utils/admin-role.test.js` — the helper is the only caller
  of `mintClaimsMerging` with an `admin` key (source scan) and change-role
  uses it.
- `express-api/tests/scripts/bootstrap-admins.test.js` — grants once,
  idempotent second run, skips no-user and no-account emails loudly, exits
  non-zero on an unparseable list, refuses without a service account.
- `express-api/tests/scripts/workflow-secrets-inventory.test.js` — the two new
  secret names present in both the workflows and the registry.
- `tests/web/admin-users-admin-role.spec.ts` — toggle with reason grants; the
  Audit Log tab shows the entry; own record refused.

### Green

- Helper, route, script, workflow steps, registry entries, Users-tab control,
  strings.

## Out of Scope

- A support-agent role — EPIC-0012, on top of SHY-0506's permission model.
- Turning administrator rights into a permission set — SHY-0506.
- Removing console access from the Firebase project — an organisational
  control, not code.

## Dependencies

- SHY-0503 and SHY-0504: the operator's Google ShyTalk account must be able to
  sign in for the grant to mean anything.
- Operator: set `DEV_BOOTSTRAP_ADMIN_EMAILS` and `PROD_BOOTSTRAP_ADMIN_EMAILS`
  in repository secrets, and create the ShyTalk account (sign in to the app on
  dev with Google) before the first dev run.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Every administrator removed and nobody left | Self-removal is refused, so the actor always remains an administrator. |
| Bootstrap runs on every production deploy | Idempotent, grant-only, and skips anything not in the list; asserted by test. |
| Provisioning grants to a login that is not a ShyTalk account (today's defect, automated) | Bootstrap requires a `users` document and skips loudly otherwise. |
| A second place learns to set the claim | Source-scan test: the helper is the sole caller with an `admin` key. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Dev-verified: the operator's Google ShyTalk account is granted the role
      on dev (bootstrap or toggle), the operator signs in to the dashboard as
      himself, and the Audit Log tab shows the grant.
- [ ] Evidence page signed off.

## Notes

- **2026-09-04** — Filed with EPIC-0013. The immediate trigger: the operator's
  admin flag on dev was set in the Firebase console on a login that has no
  ShyTalk account (SHY-0503). This story is what makes that impossible to
  repeat and gives production a first administrator without the console.

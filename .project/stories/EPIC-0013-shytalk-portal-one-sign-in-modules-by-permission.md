---
id: EPIC-0013
status: Draft
owner: unassigned
created: 2026-09-04
priority: P1
title: ShyTalk portal — one sign-in for every ShyTalk account, modules loaded by permission and account type
child_shys: [SHY-0503, SHY-0504, SHY-0505, SHY-0506, SHY-0507, SHY-0508, SHY-0509, SHY-0510, SHY-0511, SHY-0417]
---

# EPIC-0013: The ShyTalk portal — one sign-in for every ShyTalk account

## Vision

Anybody with a ShyTalk account signs in to **one place on the website**, with
the **same Google or Apple identity they use in the app**, and sees only the
tools their account is allowed to use. A member sees their profile, security
and privacy tools. An administrator additionally sees administration. A
support agent (EPIC-0012) sees the ticket queue and nothing else. A login that
is not a ShyTalk account does not get in at all — not to a broken page, not to
a dashboard where nothing works; it is turned away at the door and told why.

**Operator, 2026-09-04:** *"in the future, it should be only shytalk accounts
that can log in, via the portal … everyone with a shytalk account can login and
modules are loaded based on permissions and account types."* And, on the
dashboard he had just been shown with every tab present and nothing working:
*"if there's no account, it should not be able to log in at all."*

### What is wrong today

Two web surfaces, two doors, two identity rules — and one of them is wrong.

- The **admin dashboard** (`public/admin/`) decides who gets in from a single
  flag inside the sign-in token (`public/admin/js/main.js:327-349`). It never
  asks the server who the person is. Since SHY-0426 the server refuses every
  request from a login that has no ShyTalk account, so a login with the admin
  flag but no account is shown the whole dashboard and then every tab fails
  with "Your account could not be identified". That is exactly what the
  operator hit.
- The dashboard signs in with **email and password only**
  (`public/admin/js/main.js:457`), while the app offers **only Google and
  Apple** (`shared/…/AuthRepository.kt:71-73`). So the only way to be an
  administrator has been a password login created outside the product, with
  its admin flag set in the Firebase console — a path the no-direct-backend
  rule (EPIC-0006) forbids, and one that leaves no audit trail.
- The **portal** (`public/portal/`) does ask the server first, and has a
  "no account" screen — but SHY-0426 changed the refusal it receives, and the
  screen has been unreachable since. A login without an account is silently
  bounced back to sign-in.
- The API can **remove** administrator rights
  (`express-api/src/routes/admin-users.js:685-750`) but nothing can grant
  them. Production has no way to create its first administrator at all.

### Decisions locked in on 2026-09-04

| Decision | Chosen | Rejected, and why |
| --- | --- | --- |
| Identity for staff | Google or Apple ShyTalk accounts, the same as the app. Password sign-in survives only for the seeded test personas, on local and dev, behind the same server gate. | Password accounts for staff: a second identity kind to protect and a creation flow to build. Email sign-up for everyone: a real product change with safeguarding implications — **EPIC-0014, post-MVP**. |
| Who decides which modules load | **The server.** The identity call the portal already makes answers with the account's permissions and modules; every module's API routes are guarded by the same permission. | The page deriving modules from account type: logic duplicated in page and tests, and every new role is a page change. Modules in the token: size-capped and stale for up to an hour. |
| Where administration lives | **Inside the portal**, as modules loaded only for accounts with admin permission. The separate admin page is retired when the last tab has moved. | Two shells with two doors — the class of defect this epic exists to remove. |
| What "admin" is | A **role** on a ShyTalk account, granted and removed only through an audited action, with a provisioning bootstrap for the first administrator of each environment. | An account type: it would conflate what somebody *is* (member, teacher, MC) with what they may *do*. |
| The door | Both surfaces verify identity **with the server** before showing anything. No ShyTalk account means the existing "no account" screen, then sign-out. | Trusting the token alone — which is today's bug. |

## Scope

### In

- The admin dashboard refuses a login with no ShyTalk account at the door,
  and the portal's "no account" screen works again (SHY-0503).
- Staff sign in to the dashboard with Google or Apple (SHY-0504).
- Administrator rights are granted and removed through an audited API action
  with a dashboard control, plus a bootstrap for the first administrator per
  environment (SHY-0505).
- A server-side permission model: account type plus roles resolve to
  permissions and modules, returned on the identity call and enforced on the
  routes (SHY-0506).
- A portal shell that loads only the modules the server lists, using the
  module contract the dashboard's tabs already follow (SHY-0507).
- The dashboard's seventeen tabs move into the portal in three groups —
  safety, configuration, operations (SHY-0508, SHY-0509, SHY-0510).
- The separate admin page is retired (SHY-0511).
- SHY-0417 (a banned person on portal or admin routes is told nothing) joins
  this epic: the ban notice is part of the door.

### Out

- **Email sign-up and sign-in for everyone** — EPIC-0014, post-MVP.
- **The support-agent role and ticket queue** — EPIC-0012, which is gated on
  SHY-0506 and SHY-0507 of this epic and stays its own epic.
- **New member-facing features** in the portal. This epic moves doors and
  tools; it does not invent tools.
- **Teacher and MC modules.** The account types exist (`UserType.kt`); no
  portal tool for them has been defined. The registry leaves the slot.
- **Removing the dashboard's remaining direct Firestore reads.** That is
  EPIC-0006's job; the migration stories carry existing behaviour across and
  add no new direct access.

### Ordering and gates

1. **SHY-0503 → SHY-0504 → SHY-0505** are the MVP slice. They fix a live
   defect, end console-granted privilege, and let the operator work as
   himself. Until SHY-0505 lands the operator uses the seeded admin persona
   on dev.
2. **SHY-0506 → SHY-0507** define and build the portal proper. EPIC-0012's
   agent stories are filed only after these two are Done.
3. **SHY-0508, SHY-0509, SHY-0510** may run in any order once SHY-0507 is
   Done; board WIP limit makes them sequential in practice.
4. **SHY-0511** runs last, when nothing is left on `/admin/`.

## Child SHYs

| # | Story | Type | Effort | MVP | What |
| --- | --- | --- | --- | --- | --- |
| 1 | **SHY-0503** | bug | S | yes | The admin dashboard lets a login with no ShyTalk account in; the portal's "no account" screen is unreachable. Both surfaces verify identity with the server before showing anything. |
| 2 | **SHY-0504** | feature | S | yes | Staff sign in to the dashboard with Google or Apple, like the app. Password sign-in only where the seeded personas live. |
| 3 | **SHY-0505** | feature | M | yes | Administrator rights are granted and removed through an audited action, never the console. Bootstrap for the first administrator per environment. |
| 4 | **SHY-0506** | feature | M | no | The server tells the portal which modules an account may use: permissions and modules on the identity call, enforced on the routes. |
| 5 | **SHY-0507** | feature | L | no | The portal shell loads only the modules the server allows. Profile, security and data privacy become the first member modules. |
| 6 | **SHY-0508** | refactor | L | no | Safety tools move into the portal: users, reports, appeals, support, suggestions. |
| 7 | **SHY-0509** | refactor | L | no | Configuration tools move into the portal: economy, gifts, spins, banners, starting screens. |
| 8 | **SHY-0510** | refactor | L | no | Operations tools move into the portal: logs, audit log, devices, backups, maintenance, age tools. |
| 9 | **SHY-0511** | chore | S | no | Retire the separate admin page once the last group has moved. |
| — | **SHY-0417** | bug | S | no | Adopted: a banned person on portal or admin routes is told they are banned, not nothing. |

## DoD at Epic Level

- [ ] **The acceptance test for the whole epic:** the operator signs in to the
      portal on a real browser with his own Google-backed ShyTalk account, sees
      administration because that account holds the admin role, and a second
      real browser signed in with a Google login that has no ShyTalk account is
      turned away with the "no account" message — nothing else rendered.
- [ ] No web surface shows any tool before the server has confirmed who the
      person is; proven by a browser test that watches the network and asserts
      no module script is fetched for a refused login.
- [ ] Every grant or removal of administrator rights in every environment has
      an audit entry naming who did it, to whom, and why; the Firebase console
      has not been used for it since SHY-0505 shipped.
- [ ] Production has a first administrator created by the bootstrap, not by
      hand.
- [ ] A member, an administrator and (via EPIC-0012) a support agent each see
      a different module set, decided by the server, proven by browser tests
      against the local stack and by the operator on dev.
- [ ] `/admin/` no longer exists; every former tab is reachable in the portal
      with its browser specs passing there.
- [ ] Every child SHY satisfies the pre-merge testing protocol and reaches
      `Done` on its release cut.

## Notes

- **2026-09-04** — Epic raised after the operator's report that the dev admin
  dashboard opened with every tab present and nothing working for a login
  (`sasteberis@hotmail.co.uk`) that has an admin flag but no ShyTalk account.
  Root cause recorded in SHY-0503. The claim on that login was set outside any
  API, which is what SHY-0505 ends.
- **2026-09-04** — Two operator decisions in the brainstorming session:
  *staff sign in with Google or Apple ShyTalk accounts only for now, email
  sign-up for everyone later as its own post-MVP epic* (EPIC-0014); *the admin
  dashboard folds into the portal*. Design alternatives and rationale are in
  the decisions table above.
- **2026-09-04** — Checked before filing: no portal epic or story existed in
  the working tree, on any remote branch, or in the trees of the 135 branch
  tips deleted in the 2026-09-04 cleanup. EPIC-0012 names "the website
  portal" as its prerequisite; this epic is that prerequisite.

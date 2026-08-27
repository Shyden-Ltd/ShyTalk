---
id: EPIC-0012
status: Draft
owner: unassigned
created: 2026-08-20
priority: P2
title: Support ticketing — a dedicated agent role working tickets from the website portal
child_shys: [SHY-0384, SHY-0380, SHY-0385, SHY-0437, SHY-0438, SHY-0439]
---

# EPIC-0012: Support ticketing and the support-agent role

## Vision

Someone who needs help writes to ShyTalk from inside the app, and a **support
agent** — not an administrator — picks that ticket up in the website portal,
claims it, works it, and closes it. Support becomes a job somebody can do
without being handed the keys to the admin dashboard.

**Operator, 2026-08-20:** "for now i want to be able to see and action tickets in
the admin dashboard. but later i want to have a dedicated customer support role,
with a new user type. the support agent will log in to the portal on the shytalk
website to claim and handle support tickets. we need to build a full support
ticketing system for this in the future, this will be an epic but requires the
website portal work to be done first."

Two things follow from that, and both matter:

1. **The admin-dashboard surface in SHY-0380 is deliberately interim.** It is not
   a half-built version of this epic; it is the smallest thing that makes an
   inert button work. It should not grow features this epic will replace.
2. **This epic is gated on the website portal.** Until agents have somewhere to
   log in, there is nothing to build the role against.

### Why a separate role, and not just another admin

Today the only way to action a user's request is the admin dashboard, which
carries maintenance actions, economy configuration, nuclear reset, and every
user's record. Handing that to a support agent to answer "my date of birth is
wrong" is a safeguarding and least-privilege problem, not a convenience one.
ShyTalk has a minor cohort; the set of people who can read a minor's account
should be as small as the job allows.

## Scope

### In

- A **support-agent user type**, distinct from both a normal user and an admin,
  with its own permissions and its own audit trail.
- Agent sign-in to the **website portal** (not the admin dashboard, not the app).
- Ticket lifecycle: raised → **claimed by an agent** → in progress → resolved,
  with the claim visible so two agents cannot work the same ticket.
- Assignment, reassignment, and what happens to a claimed ticket when an agent
  stops working.
- A reply path, so the person who raised the ticket hears back inside ShyTalk.
- Agent-facing history: what this account has raised before, without exposing
  the whole admin record.
- Auditing of every agent action, and metrics an operator can look at
  (open count, age of oldest ticket, time to first response).

### Out

- SHY-0380's admin-dashboard surface, which ships first and stands alone.
- Merging **appeals** and **reports** into this ticket model. Tempting, and
  possibly right later; not while the first ticket queue is being proven.
- Anything that requires the website portal to exist before it does.

## Child SHYs

| Story | State | What |
| --- | --- | --- |
| **SHY-0384** | Draft | Remove the inert Contact support control, and the copy telling people to use it. Interim; reversed by SHY-0385. |
| **SHY-0380** | Draft | The ticket queue and its admin-dashboard surface. Part one of two. |
| **SHY-0385** | Draft | The in-app form, and restoring the control SHY-0384 removed. Part two of two. |
| _to be filed_ | — | Support-agent user type and permission model |
| _to be filed_ | — | Agent sign-in and ticket queue in the website portal |
| _to be filed_ | — | Claim / assign / reassign lifecycle |
| _to be filed_ | — | Reply path back to the person in-app |
| _to be filed_ | — | Agent audit trail and support metrics |

Children beyond SHY-0380 are deliberately **not** filed yet. The portal work
they depend on is not defined, and a story written now would be refined against
assumptions rather than a real surface.

## DoD at Epic Level

- [ ] A support agent can sign in to the website portal with a support-agent
      account, and cannot reach the admin dashboard.
- [ ] An agent can claim a ticket, and no second agent can claim the same one.
- [ ] The person who raised a ticket hears back inside ShyTalk.
- [ ] Every agent action is audit-logged and attributable.
- [ ] An operator can see how many tickets are open and how old the oldest is.
- [ ] A support agent cannot read anything about an account beyond what the job
      requires — proven by test, not by policy.
- [ ] Walked end to end on real devices and a real browser.

## Notes

- **Blocked on the website portal.** This is a hard sequencing constraint from
  the operator, not an estimate. Do not start child stories before it exists.
- The **appeals** flow (`express-api/src/routes/reports.js:1363-1500`,
  `public/admin/js/tabs/appeals.js`) is the closest existing shape and is the
  template SHY-0380 follows. If this epic later unifies appeals, reports, and
  support tickets, that is a migration story of its own.
- Least privilege is the point of the separate role, and ShyTalk's minor cohort
  is why it matters more here than in a typical product.

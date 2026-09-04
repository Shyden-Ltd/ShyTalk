---
id: EPIC-0014
status: Draft
owner: unassigned
created: 2026-09-04
priority: P3
title: Email sign-up and sign-in for everyone — post-MVP
child_shys: []
---

# EPIC-0014: Email sign-up and sign-in for everyone (post-MVP)

## Vision

Somebody who has no Google or Apple account — or who does not want to use it
for ShyTalk — can still join: they sign up with an email address and a
password, verify the address, and use ShyTalk exactly like everyone else, in
the app and in the portal. Staff and members share one identity model either
way (EPIC-0013), so nothing about roles or permissions changes.

**Operator, 2026-09-04**, answering how staff should sign in: Google or Apple
ShyTalk accounts only for now, *"but we should implement [email sign-up for
everyone] at a later date. post-mvp, new ticket, probably an epic."* This is
that epic.

### Why it is post-MVP, and why it is an epic

The API already accepts an `email` provider on account creation
(`express-api/src/routes/users.js:44`) and the app already maps a password
login to it (`shared/…/AuthRepository.kt:73`); the portal signs password users
in and enforces two-factor for them. What does not exist is everything that
makes email accounts *safe to offer to the public*: verification, password
reset, linking rules when the same address arrives through two providers,
abuse controls, and the safeguarding review for a minor cohort where an email
address is the easiest identity to fabricate. That is several stories with
real product decisions inside them, not a form.

## Scope

### In

- Email sign-up in the app with address verification before the account is
  usable; sign-in with email and password on the app and the portal.
- Password reset by email, and password change while signed in.
- Account-linking rules: the same address arriving through Google, Apple and
  email resolves to one ShyTalk account, with the person's consent, never
  silently.
- Abuse controls proportionate to a free public sign-up: rate limits per
  device and address, disposable-domain policy, and the existing device-lock
  and ban gates applying unchanged.
- Safeguarding review: date-of-birth and cohort rules unchanged; a written
  assessment of how email identities affect age segregation, signed off before
  the first story is picked up.
- Two-factor for email accounts on the portal stays mandatory (it is today for
  password users); the app decides whether to offer it.
- The five shipped locales for every new screen and message.

### Out

- Phone-number sign-in.
- Passwordless magic links (a possible later slice; not part of this epic's
  definition).
- Any change to roles, permissions or portal modules — EPIC-0013 owns those.
- Retiring Google or Apple sign-in.

### Slices this epic will need

Filed as fully refined stories when the epic is picked up, not before —
written now they would be refined against a product that has not yet decided
its abuse posture (the same reasoning EPIC-0012 recorded for its portal-gated
children).

1. Safeguarding and abuse assessment for public email identities — a spike
   with a written decision, first.
2. Email sign-up with verification in the app.
3. Sign-in with email and password in the app and the portal, sharing the
   existing session and cold-start behaviour (EPIC-0004).
4. Password reset and change.
5. Provider linking: one address, one account, with consent.
6. Rate limiting and disposable-domain policy on the account-creation route.
7. Support-facing tooling: an administrator can see an account's sign-in
   methods and trigger a reset, through the audited paths EPIC-0013 provides.

## Child SHYs

(none yet — pre-creation; see *Slices this epic will need* above)

## DoD at Epic Level

- [ ] A person with only an email address can create a ShyTalk account, verify
      it, sign in on a real Android device, a real iPhone and the portal, and
      reset a forgotten password — walked end to end on real devices and a real
      browser.
- [ ] The same email address arriving through Google, Apple and email never
      produces two accounts, and never merges without the person agreeing.
- [ ] The device-lock, ban and cohort gates apply to email accounts exactly as
      to provider accounts — proven by the existing journeys run against an
      email persona.
- [ ] The safeguarding assessment is recorded in this epic's Notes and its
      conditions are met by the shipped stories.
- [ ] Every child SHY reaches `Done` on its release cut.

## Notes

- **2026-09-04** — Epic raised from the EPIC-0013 brainstorming session at the
  operator's direction. Deliberately post-MVP (`priority: P3`); nothing in it is
  launch-blocking, and the MVP identity decision is Google and Apple only.

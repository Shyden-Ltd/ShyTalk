---
id: SHY-0395
status: Draft
owner: unassigned
created: 2026-08-21
priority: P0
effort: M
type: chore
roadmap_ids: []
mvp: true
---

# SHY-0395: ShyTalk's email is unauthenticated and can receive nothing

## User Story

As **somebody who asked ShyTalk to email me**, I want that email to arrive and to
be answerable, so that a sign-in code reaches my inbox and a reply reaches a
person.

## Why

**Operator, 2026-08-21:** official ShyTalk email should come from
`shytalk.shyden.co.uk`, company email from `shyden.co.uk`, and there should be a
mailbox that can actually receive. This story is the foundation; it was believed
to exist already and did not — all 314 ShyTalk issues, both repos' stories,
epics, plans and `roadmap-data.json` were searched.

### What the DNS says today

| Record | `shyden.co.uk` | `shytalk.shyden.co.uk` |
| --- | --- | --- |
| MX | `mail.shyden.co.uk` | **none** |
| SPF | `v=spf1 include:rp.oracleemaildelivery.com ~all` | **none** |
| DMARC | `v=DMARC1; p=none;` | **none** |

**The product sends from a domain with no SPF record.** `email.js` sends every
message as `"ShyTalk" <noreply@shytalk.shyden.co.uk>`, and six modules use it —
`auth.js`, `users.js`, `admin-users.js`, `data-export.js`, `portal.js` and the
account-deletion cron. Nothing authorises that sender, so Gmail and Outlook —
which have required authentication from bulk senders since 2024 — are entitled to
spam-folder or reject all of it.

**One of those is a sign-in path.** Email OTP delivers a code somebody needs to
get into their account. If it does not arrive, they cannot sign in, and the
channel they would use to tell us is the one that is broken. This is why the
priority is P0 rather than the "future" it was assumed to be.

`shyden.co.uk` is comparatively healthy — it has MX and SPF — but its DMARC is
`p=none`, which observes and enforces nothing.

### Nothing can be received

`shytalk.shyden.co.uk` has no MX record, so mail to it is undeliverable. The
address the product shows people instead is `shytalk.help@gmail.com`, which
appears **139 times** across the app, the locales and the site — and which the
operator has confirmed nobody monitors. Every one of those is an invitation to
write to a mailbox that answers nothing.

### It blocks the support reply loop

Support replies by email were chosen on 2026-08-21, with customers able to reply
to update their ticket. The sending provider is **Oracle Email Delivery**, which
is outbound-only and has no inbound parse. So receiving is not a configuration
change on what exists — it needs either a second provider for inbound or a real
mailbox polled over IMAP. That decision belongs here, because everything else
about support-by-email depends on it.

## Acceptance Criteria

### Happy path

- [ ] Mail sent by the product authenticates on the domain it is sent from, and
      arrives in the inbox rather than the spam folder.
- [ ] `shytalk.shyden.co.uk` can **receive** mail addressed to it.
- [ ] Company mail uses `shyden.co.uk`; product mail uses
      `shytalk.shyden.co.uk`. Neither borrows the other's identity.
- [ ] Somebody replying to a ShyTalk email reaches a real destination.

### Error paths

- [ ] A message that fails authentication is visible to us as a failure rather
      than disappearing silently.
- [ ] Mail to an address nobody owns is rejected at the door, not accepted and
      dropped.

### Edge cases

- [ ] An Apple sign-in user's private-relay address still receives.
- [ ] An account with no usable email address still works — nothing assumes one
      exists.
- [ ] The address shown in the product matches the one that receives. Today it
      does not: **139 occurrences** of `shytalk.help@gmail.com` point at a
      mailbox nobody reads.

### Performance

- [ ] Sending stays a background concern; no user-facing flow waits on delivery.

### Security

- [ ] SPF, DKIM and DMARC all present on the sending domain, with DMARC moved off
      `p=none` once the reports are clean.
- [ ] Mailbox credentials live in the secret store, never in the repo, and follow
      the pattern used for `MFA_REMEMBER_SECRET`.
- [ ] Inbound mail is treated as untrusted input — it is attacker-controlled.

### UX

- [ ] No surface tells somebody to write to an address that answers nothing.

### i18n

- [ ] The address change lands in **all 21** locale files. The MVP-5 rule governs
      which languages ship, not which files stay in parity.

### Observability

- [ ] Delivery failures and DMARC reports reach somebody, on a schedule.
- [ ] A green send is distinguishable from a send that was accepted and dropped.

## BDD Scenarios

**Scenario: A sign-in code arrives**

- **Given** somebody asking to sign in by email
- **When** the code is sent
- **Then** it arrives in their inbox

**Scenario: Writing to the address on screen reaches somebody**

- **Given** the contact address the product displays
- **When** somebody sends a message to it
- **Then** it is received rather than silently lost

**Scenario: Company and product mail stay separate**

- **Given** an email from ShyTalk and an email from Shyden Ltd
- **When** somebody looks at who sent each
- **Then** they come from their own domains

## Test Plan

| Layer | What it proves |
| --- | --- |
| DNS assertion | SPF, DKIM, DMARC and MX resolve for each domain — run as a scheduled check, not once by hand, because DNS drifts silently. |
| Delivery | A real send to a real external inbox lands and passes authentication, asserted on the received headers rather than on a 250 from the relay. |
| Receipt | A real message to the published address is received end to end. |
| Guard | No source file, locale or page references an address that does not receive — the check that stops the 140th occurrence. |

## Out of Scope

- The support ticket reply THREAD and inbound parsing of replies. That is its own
  story and depends on the provider decision made here.
- Migrating away from Oracle Email Delivery for outbound, unless the inbound
  answer forces it.

## Dependencies

- **Operator decision required:** whether inbound is a second provider with an
  inbound-parse webhook, or a real mailbox on `mail.shyden.co.uk` polled over
  IMAP. Everything about receiving follows from it.
- DNS access for both domains.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Enforcing DMARC too early silently drops legitimate mail | Move to `p=none` first, read the reports, then tighten — the reason the existing `p=none` is not itself the bug. |
| Changing the sending domain re-starts reputation from zero | Warm it before enforcing, and keep the existing sender working until the new one is proven. |
| The published address changes in 139 places and one is missed | A guard asserts no unreachable address survives anywhere, including locale files and the public site. |
| Fixing DNS and believing it is done | Delivery is asserted against a real external inbox on received headers; a relay accepting a message proves nothing about arrival. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] A real sign-in code sent to a real external inbox, arriving in the inbox,
      with authentication passing in its headers.
- [ ] A real reply to the published address received.

## Notes

- Found while answering "how do customers receive support ticket replies?" — the
  answer today is that they do not, and the reason reaches further than support.
- The **139** figure is occurrences, not files; the locale set alone accounts for
  most of them.
- Related: [[SHY-0386]] (`routes/health.js` never mounted) is the same shape —
  infrastructure that was configured but never actually connected to anything.

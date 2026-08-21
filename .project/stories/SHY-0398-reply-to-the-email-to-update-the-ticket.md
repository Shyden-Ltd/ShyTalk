---
id: SHY-0398
status: Draft
owner: unassigned
created: 2026-08-21
priority: P1
effort: L
type: feature
roadmap_ids: []
epic: EPIC-0012
mvp: true
---

# SHY-0398: Replying to the email updates the ticket

## User Story

As **somebody who got an email about my support ticket**, I want to just reply to
it, so that adding information costs me nothing and does not need the app.

## Why

**Operator, 2026-08-21:** the customer should be able to reply to the email to
update their ticket.

This is the cheapest possible follow-up route — no app, no account recovery, no
new surface to learn. It is also the only route that works for the person whose
problem is *that they cannot get into the app*, which is one of the approved
support categories.

### The obstacle is real and named

`shyden.co.uk`'s SPF names **Oracle Email Delivery**, which is outbound-only and
has no inbound parse. So this cannot be a configuration change to what exists.
Receiving needs one of:

| Option | Shape |
| --- | --- |
| Inbound-parse provider | a second provider (SendGrid / Mailgun / Postmark) posts inbound mail to an API endpoint |
| Real mailbox + IMAP | a mailbox on `mail.shyden.co.uk`, polled, messages consumed and marked |

**That choice belongs to [[SHY-0395]]** and must be made before this is built.
Nobody monitors a mailbox by hand either way — the operator's "we don't have an
inbound mailbox" means no *human* one.

## Two things that will break this if got wrong

**Match on a signed token, never on the sender's address.** Somebody who signed in
with Apple replies from a `@privaterelay.appleid.com` address that matches nothing
on their account. Address matching silently drops exactly those customers, and
they are the ones least able to tell us.

**The token must be signed, not a ticket id.** Inbound email is attacker-written
input. A `Reply-To: ticket+<id>@` carrying a raw id lets anybody who guesses one
append to a stranger's support case. `MFA_REMEMBER_SECRET` and
`EXPORT_DOWNLOAD_SECRET` are the existing precedent for the shape.

## Acceptance Criteria

### Happy path

- [ ] Replying to a ticket email adds that reply to the ticket.
- [ ] The admin sees it as part of the same conversation, in order.
- [ ] Quoted history and signatures are stripped, so the ticket does not grow a
      copy of itself with every exchange.
- [ ] A reply to a **closed** ticket reopens it — the operator's stated route for
      new information.

### Error paths

- [ ] A reply carrying no valid token is discarded and logged, never guessed at.
- [ ] A reply to a ticket that no longer exists is discarded and logged.
- [ ] Inbound processing failing does not lose the message — it is retryable or
      preserved for inspection.

### Edge cases

- [ ] An Apple private-relay sender is accepted, because matching is on the token.
- [ ] An auto-reply or out-of-office does not append anything.
- [ ] A reply from an address that is not the ticket owner's is **not** trusted
      merely for holding the token — decide and state the rule.
- [ ] An empty reply, or one that is only quoted text, adds nothing.
- [ ] Attachments on a reply are handled or explicitly refused, never dropped
      silently.

### Performance

- [ ] Inbound processing is bounded and cannot be used to exhaust the API.

### Security

- [ ] The token is **signed and verified**; a forged or altered one is refused.
- [ ] Tokens are per-ticket and expire.
- [ ] The body is treated as untrusted — stored as text, escaped everywhere it is
      displayed, never rendered as HTML in the admin panel.
- [ ] Size limits are enforced before parsing, not after.
- [ ] The endpoint authenticates the *provider*, so anybody on the internet
      cannot post fake inbound mail to it.

### UX

- [ ] The email says clearly that replying works and what it does.
- [ ] A reply that could not be attached does not vanish in silence.

### i18n

- [ ] Any copy this adds lands in all 21 locale files.

### Observability

- [ ] Every inbound message is logged with its outcome — attached, discarded, or
      failed — and why.
- [ ] Discards are countable, because a rising discard rate is how this feature
      fails quietly.

## BDD Scenarios

**Scenario: A reply is added to the ticket**

- **Given** somebody who received an email about their request
- **When** they reply to it
- **Then** their reply is added to that request

**Scenario: A reply to a closed request reopens it**

- **Given** a request that was closed
- **When** the person replies to its email
- **Then** it is open again with their reply on it

**Scenario: A forged reply is refused**

- **Given** a reply carrying a tampered reference
- **When** it arrives
- **Then** it is discarded and nothing is added

## Test Plan

| Layer | What it proves |
| --- | --- |
| Token | Signing and verification round-trip; a tampered, expired or foreign token is refused. Table-driven over the real signer, not a stub. |
| Inbound | A real message through the chosen path lands on the right ticket, with quoted history stripped, asserted on the stored record. |
| Security | Forged token, wrong sender, oversized body, HTML body, and an unauthenticated call to the endpoint are each refused, each with its own assertion. |
| Reopen | A reply to a closed ticket reopens it and preserves the original. |
| Isolation | A failure in inbound processing preserves the message rather than dropping it. |

## Out of Scope

- The in-app ticket surface — [[SHY-0399]].
- Outbound email itself — [[SHY-0397]].

## Dependencies

- **[[SHY-0395]]** — the inbound mechanism decision, and a domain that can
  receive at all. `shytalk.shyden.co.uk` has no MX record today.
- **[[SHY-0397]]** — there is nothing to reply to until email is being sent.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A guessable reference lets somebody read or write another person's case | The token is signed and per-ticket; forgery and tampering each have their own refusal test. |
| Apple relay users silently stop working | Matching is on the token, never the address, and a private-relay sender is an explicit test case. |
| Quoted history doubles the ticket every exchange | Stripping is asserted on the stored record, not assumed from the parser. |
| The endpoint becomes an open door for fake mail | The provider is authenticated; an unauthenticated post is a refusal test. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] A real reply, from a real inbox, lands on a real ticket in dev.

## Notes

- Filed from the operator's 2026-08-21 decision. The apparent contradiction —
  "we don't have an inbound mailbox" alongside "the customer can reply" — resolves
  as: no human-monitored mailbox, a machine-processed inbound address.

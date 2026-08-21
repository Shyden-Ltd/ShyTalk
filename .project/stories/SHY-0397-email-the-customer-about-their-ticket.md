---
id: SHY-0397
status: Draft
owner: unassigned
created: 2026-08-21
priority: P1
effort: M
type: feature
roadmap_ids: []
epic: EPIC-0012
mvp: true
---

# SHY-0397: Tell somebody, by email, what happened to their ticket

## User Story

As **somebody who raised a support ticket**, I want an email when it is received
and when somebody answers it, so that I am not left wondering whether it went
anywhere.

## Why

**Operator, 2026-08-21:** support requests should be emailed, and an admin's
answer should reach the customer.

Today nothing reaches them, ever. `POST /api/support-tickets` writes a document
and returns an id the app logs and discards. `GET` and `PATCH` are both
`requireAdmin`, and `adminNote` is internal. A customer sends one message into
silence and never hears anything again — the app even says "we will reply to that
one", which is not true until this story ships.

**Outbound email already exists.** `express-api/src/utils/email.js` sends via
nodemailer as `"ShyTalk" <noreply@shytalk.shyden.co.uk>`, and six modules already
use it. This is not new infrastructure; it is a new caller.

## Two emails

| When | Contains |
| --- | --- |
| Ticket raised | confirmation, the ticket reference, what happens next, and how to add to it |
| Admin answers | the answer, the same reference, and how to reply |

The admin answer is a **new field**. `adminNote` is explicitly internal
(SHY-0380, operator decision) and must not be emailed to anybody — a note written
for colleagues is not a customer reply, and sending it would be a disclosure bug,
not a feature.

## Acceptance Criteria

### Happy path

- [ ] Raising a ticket sends a confirmation email carrying its reference.
- [ ] An admin answering a ticket sends that answer to the customer.
- [ ] Both come from the ShyTalk domain, not the company one.
- [ ] The in-app confirmation and the email agree about what happens next.

### Error paths

- [ ] **Email failing must never fail the ticket.** The ticket is the record; the
      email is a courtesy. A send failure is logged and surfaced, not raised to
      the caller.
- [ ] An account with no usable email address still raises tickets normally, and
      that is visible to the admin so they know the customer cannot be reached.
- [ ] A bounced message is visible to us rather than silently discarded.

### Edge cases

- [ ] An Apple private-relay address receives.
- [ ] An admin answering twice sends twice; answering with an empty body sends
      nothing.
- [ ] `adminNote` is **never** included in any email.

### Performance

- [ ] Sending does not block the request that triggered it.

### Security

- [ ] The email carries no credentials, no tokens the recipient did not earn, and
      no other customer's data.
- [ ] The customer's own message may be echoed back; nothing else from the record
      is.
- [ ] Address is read from the account, never from client input — otherwise
      anyone could have a ticket emailed anywhere.

### UX

- [ ] Readable as plain text, not only as HTML.
- [ ] Says plainly whether replying will do anything — and until [[SHY-0398]]
      ships, replying does nothing, so it must not claim otherwise.

### i18n

- [ ] Sent in the account's language, across all 21 locale files.

### Observability

- [ ] Every send is logged with the ticket reference and its outcome.
- [ ] A send that was accepted by the relay but never delivered is
      distinguishable from one that arrived.

## BDD Scenarios

**Scenario: Raising a ticket is confirmed by email**

- **Given** somebody raising a support request
- **When** it is received
- **Then** they get an email confirming it

**Scenario: An answer reaches them**

- **Given** an admin answering a request
- **When** they send the answer
- **Then** it arrives in the customer's inbox

**Scenario: A failed email does not lose the request**

- **Given** email is not working
- **When** somebody raises a request
- **Then** it is still recorded and they are still told in the app

## Test Plan

| Layer | What it proves |
| --- | --- |
| Route | The ticket is created and the answer stored, against the real emulator. |
| Delivery | Both emails land in a real inbox — Mailpit locally, a real external inbox for dev — asserted on the received message, not on the relay's acceptance. |
| Isolation | A forced send failure leaves the ticket intact and the caller unaffected. |
| Disclosure | `adminNote` appears in no email, asserted against the rendered body. |
| Copy | Both templates render per locale, asserted on rendered text. |

## Out of Scope

- Receiving replies — [[SHY-0398]].
- The in-app ticket surface — [[SHY-0399]].

## Dependencies

- **[[SHY-0395]] is a hard prerequisite.** `shytalk.shyden.co.uk` has no SPF,
  DKIM or MX today, so mail sent from it is unauthenticated and may never arrive.
  Building this on top of that would produce a feature that is green in every
  test and invisible to real customers.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Emails land in spam and the feature appears to work | Blocked on SHY-0395, and delivery is asserted against a real external inbox on received headers. |
| An internal note is emailed to a customer | The customer answer is a separate field; a test asserts `adminNote` never appears in a rendered body. |
| An email failure loses somebody's support request | The ticket is written first and the email is a courtesy; a forced-failure test pins it. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] A real confirmation and a real answer received in a real external inbox,
      authentication passing.

## Notes

- The app string `support_form_error_already_open` says "We will reply to that
  one." That sentence becomes true when this ships. Until then it is a promise
  the product cannot keep — noted deliberately rather than reworded twice.

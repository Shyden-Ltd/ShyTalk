---
id: SHY-0422
status: Draft
owner: unassigned
created: 2026-08-22
priority: P1
effort: M
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0422: The app tells people to email an address nobody reads

## User Story

As **somebody who needs help**, I want the app to send me somewhere a human will
answer, so that asking for help actually reaches somebody.

## Why

The operator's decision on 2026-08-20 was explicit: *support is a ticket an admin
actions, not an email. There is no support mailbox.* [[SHY-0385]] acted on it for
the Settings tap — the row now opens the in-app support form instead of a mail
composer.

**The address is still printed all over the app.** Four separate strings name it,
in all 21 locales, plus a constant:

| Where | String |
| --- | --- |
| Settings → Contact us | the row opens the form, but still DISPLAYS `shytalk.help@gmail.com` beside it |
| `contact_support_help` | "If you need help, contact shytalk.help@gmail.com" |
| `contact_support_hint` | "If the problem persists, contact shytalk.help@gmail.com" |
| `device_locked_description` | "For support, contact shytalk.help@gmail.com" |
| `support_contact` | "For support, contact shytalk.help@gmail.com" |
| `Constants.CONTACT_EMAIL` | the literal, asserted by a test as "correct" |

So the fix landed on the one surface somebody happened to be looking at, and
every other surface kept advertising a mailbox nobody monitors. `SupportPage`'s
own KDoc says every "contact us" route in the product eventually points at the
ticket queue. Today most of them point at an inbox.

### Why this is worse than a stale string

The people who read these lines are the people already in trouble: the device is
locked to another account, something has failed twice, or they have been refused
a feature. They are told to email, they email, and nothing happens — no reply, no
ticket, no queue, no record that they ever asked. That is indistinguishable from
being ignored, and it lands on exactly the cohort least able to shrug it off.

The **Technical Difficulties** screen is the sharpest case: it appears when the
app cannot reach the API, and it tells people to email. If the mailbox is not
read, the one screen shown when everything is broken offers no working route to
help at all.

## Acceptance Criteria

### Happy path

- [ ] No user-facing surface tells somebody to email support. Every one of them
      offers the in-app support form instead.
- [ ] Settings → Contact us no longer displays an email address beside the row.

### Error paths

- [ ] The **device-locked** screen offers a route that works even though the
      person cannot sign in. If the in-app form requires a session, this screen
      needs an answer that does not — decide it deliberately and write down what
      it is, rather than leaving the address because it is the only thing there.
- [ ] The **Technical Difficulties** screen is reached when the API is
      unreachable, so a route that needs the API is no route at all. Same
      requirement: decide what it offers and say why.

### Edge cases

- [ ] Any surface that genuinely CANNOT reach the ticket queue is listed
      explicitly in this story with the alternative it offers. "Still shows the
      email" is an acceptable outcome only if the mailbox is actually monitored,
      and only if somebody says so.

### Performance

- [ ] No change.

### Security

- [ ] No new unauthenticated route into the ticket queue as a side effect of
      solving the signed-out cases.

### UX

- [ ] Somebody in trouble is never left with a dead end.

### i18n

- [ ] All 21 locale files, asserted on rendered text per locale — the address is
      currently embedded IN the translated sentences, so this is not a key
      deletion, it is a rewrite in every language.

### Observability

- [ ] Somebody arriving at support from one of these surfaces is
      distinguishable, via the existing `SupportSource` context, so we can see
      whether the replacements are used.

## BDD Scenarios

**Scenario: Asking for help reaches somebody**

- **Given** somebody who cannot get past an error screen
- **When** they follow the offer of help
- **Then** they reach a route that records their request

**Scenario: No screen offers an unread mailbox**

- **Given** somebody reading any screen in the app
- **When** they look for how to get help
- **Then** they are never given an email address to write to

## Test Plan

| Layer | What it proves |
| --- | --- |
| Guard | No user-facing string in ANY locale contains a support email address — the check that stops the fifth one appearing. |
| Copy | Each replaced sentence renders correctly in every locale, asserted on rendered text. |
| Wiring | Every replaced surface actually reaches the support form, not a dead control — the shape [[SHY-0384]] was filed for. |
| Journey | The signed-out and offline surfaces are walked on a real device, because those are the two the in-app form cannot obviously serve. |

## Out of Scope

- Building a reply channel — [[SHY-0397]], [[SHY-0398]].
- Whether the mailbox should exist at all. If the operator decides it should be
  monitored, this story becomes "say so accurately" instead, and the guard
  changes to allow it in the surfaces that genuinely need it.

## Dependencies

- The signed-out and offline cases may need a route the support form does not
  currently offer. That is the real work in this story; the string edits are the
  easy half.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Removing the address leaves a signed-out person with no route at all | The two hard surfaces are named in the AC and must have an answer before this can be Done. |
| A rewrite in 21 languages drifts | Rendered-text assertions per locale, and a guard on the address itself. |
| The operator actually wants the mailbox | Raised as a question in Out of Scope rather than assumed either way. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Walked on both real devices, including the device-locked and offline
      screens.
- [ ] Operator has confirmed what the signed-out and offline surfaces should
      offer.

## Notes

- Found on 2026-08-22 while walking [[SHY-0396]] on a real phone: the
  Technical Difficulties screen appeared and offered the email, and the Settings
  row displayed it beside a link that correctly opens the form.
- The pattern is the same one [[SHY-0421]] records from the same afternoon: a
  decision was applied at the surface somebody was looking at, and the other
  surfaces that encode the same decision were never revisited.
- `Constants.CONTACT_EMAIL` has a test asserting the value is "correct". If the
  address stops being used, that test is asserting the wrong thing and must be
  inverted rather than deleted.

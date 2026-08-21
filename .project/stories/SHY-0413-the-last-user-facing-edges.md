---
id: SHY-0413
status: Draft
owner: unassigned
created: 2026-08-21
priority: P2
effort: S
type: chore
roadmap_ids: []
mvp: true
---

# SHY-0413: The last four user-facing paths with no journey

## User Story

As **somebody buying coins, reading a broadcast, turning off emails, or signing in
with my fingerprint**, I want those four ordinary things to have been walked.

## Why

After three audit passes closed sixteen gaps, four user-facing paths remain with
no scenario:

| Path | What it is |
| --- | --- |
| `GET /coin-packages` | what a member can buy — the shop |
| `GET /broadcasts` | messages pushed to members |
| `POST /subscriptions/unsubscribe` | turning notifications off |
| `GET /auth/biometric/challenge` | signing in with a fingerprint or face |

**Unsubscribe is the one with legal weight.** An unsubscribe that does not
unsubscribe is a consent failure, and the person it fails is by definition
someone who no longer wants to hear from us — so they will not tell us it is
broken, they will report us instead.

**Biometric sign-in is a security path.** `j24` covers App Lock, which is a
different thing: App Lock guards a running app, biometric challenge is a way IN.

**Coin packages is the shop.** `j05` and `j06` buy coins thoroughly, including
receipt replay and refunds, but nothing reads the list of what is on sale — so a
misconfigured package would be discovered by a member.

## Acceptance Criteria

### Happy path

- [ ] A member sees the packages available to buy, with prices.
- [ ] A member sees a broadcast that has been sent to them.
- [ ] Turning notifications off stops them arriving.
- [ ] A member signs in with biometrics.

### Error paths

- [ ] Packages failing to load shows a readable state, not an empty shop.
- [ ] An unsubscribe that fails says so rather than appearing to succeed — the
      silent-success case is the dangerous one.
- [ ] A failed biometric attempt falls back to another way in.

### Edge cases

- [ ] No packages configured — the shop says so rather than showing nothing.
- [ ] No broadcasts — no empty space.
- [ ] Unsubscribing twice is harmless.
- [ ] Biometrics not enrolled on the device — the member is offered another way.
- [ ] Biometrics changed on the device since enrolment — re-authentication is
      required rather than the old enrolment being trusted.
- [ ] Walked on real Android **and** real iPhone.

### Performance

- [ ] The shop loads within the same budget as the wallet.

### Security

- [ ] A biometric challenge issued to one account does not work for another.
- [ ] A challenge cannot be replayed.
- [ ] Nobody can unsubscribe somebody else.
- [ ] Prices come from the server, and a client-supplied price is ignored.

### UX

- [ ] Prices show in a form the member recognises.

### i18n

- [ ] Prices, broadcasts and the unsubscribe confirmation render per locale,
      asserted on rendered text.

### Observability

- [ ] An unsubscribe is auditable — consent changes need a record.

## BDD Scenarios

**Scenario: Seeing what is for sale**

- **Given** a member opening the shop
- **When** the packages load
- **Then** they see each package with its price

**Scenario: Turning notifications off stops them**

- **Given** a member who has unsubscribed from an event
- **When** that event happens
- **Then** no notification arrives

**Scenario: Nobody can unsubscribe somebody else**

- **Given** another member's notification settings
- **When** somebody tries to unsubscribe them
- **Then** they are refused

**Scenario: Signing in with a fingerprint**

- **Given** a member with biometrics enrolled
- **When** they sign in with their fingerprint
- **Then** they reach their account

**Scenario: A challenge cannot be reused**

- **Given** a biometric challenge that has already been used
- **When** it is presented again
- **Then** it is refused

## Test Plan

| Layer | What it proves |
| --- | --- |
| Journey, both devices | Shop read, broadcast seen, unsubscribe honoured, biometric sign-in completed. |
| Consent | Unsubscribe asserted by the notification NOT arriving — not by a flag flipping. That is the only assertion that matters legally. |
| Security | Cross-account challenge, replayed challenge, cross-account unsubscribe, client-supplied price — four separate refusals. |
| Device state | Biometrics absent and biometrics changed since enrolment are separate scenarios. |

## Out of Scope

- Changing pricing, broadcast or notification behaviour.

## Dependencies

- A device with biometrics enrolled, and a way to change them mid-test.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Unsubscribe is asserted by reading a setting back | Asserted by the notification not arriving. |
| Biometric sign-in is walked only where biometrics exist | Not-enrolled and changed-since-enrolment are required scenarios. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Walked on a real Android device and a real iPhone.

## Notes

- Found 2026-08-21 in the third audit pass. These are the last route-derived
  user-facing capabilities with no scenario.

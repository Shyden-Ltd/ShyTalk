---
id: SHY-0409
status: Draft
owner: unassigned
created: 2026-08-21
priority: P0
effort: M
type: chore
roadmap_ids: []
mvp: true
---

# SHY-0409: Nobody has ever used two-factor authentication

## User Story

As **somebody who turned on two-factor authentication**, I want that second
factor to have been used by somebody before me, so that the thing standing
between an attacker and my account is known to stand.

## Why

The portal has a full MFA implementation: TOTP enrolment, `totpVerified` claims,
a **remembered-browser** token with an epoch that revokes every remembered
browser at once, session revocation, and account recovery.
`MFA_REMEMBER_SECRET` was provisioned in **production** on 2026-08-20.

The portal does have Playwright specs — and they are good CSP and XSS hardening
tests. But every one of them is a **static DOM assertion**:

```
has correct title · displays ShyTalk logo · no inline scripts in portal HTML
script tag in hash is not rendered · password field is type=password
```

**Nobody enrols. Nobody signs in with a code. Nobody uses a remembered browser.
Nobody revokes a session.** The second factor protecting admin accounts has never
been exercised end to end.

The remembered-browser epoch deserves naming: it is one number that invalidates
every remembered browser at once, and the code comments say a failure to bump it
must never turn a successful sign-out into a 500. That is careful design guarding
a path nothing walks.

## Acceptance Criteria

### Happy path

- [ ] Somebody enrols in two-factor and is shown a secret to store.
- [ ] Signing out and back in asks for a code.
- [ ] The correct code lets them in.
- [ ] Choosing to be remembered means the next sign-in does not ask for a code.
- [ ] Turning two-factor off means sign-in stops asking.

### Error paths

- [ ] A wrong code is refused and does not sign them in.
- [ ] A reused code is refused.
- [ ] A code from outside its time window is refused.
- [ ] Repeated wrong codes are rate-limited rather than allowed to run forever.

### Edge cases

- [ ] A clock slightly out of step still accepts a valid code.
- [ ] Enrolling twice does not leave two secrets.
- [ ] Revoking all sessions signs them out everywhere, including remembered
      browsers — the epoch bump, asserted from a second browser.
- [ ] Recovery gets somebody back in when they have lost their authenticator, and
      **only** them.
- [ ] Signing out when the epoch bump fails still signs them out.

### Performance

- [ ] Code verification is prompt enough not to look broken.

### Security

- [ ] Two-factor cannot be turned off without proving the current factor.
- [ ] A remembered-browser token from one account does not work for another.
- [ ] A remembered-browser token stops working after the epoch is bumped.
- [ ] Recovery cannot be started for somebody else's account.
- [ ] The TOTP secret is never returned again after enrolment.
- [ ] An admin account with two-factor cannot reach admin endpoints on a session
      that has not satisfied it.

### UX

- [ ] Somebody who has lost their authenticator is told how to get back in.

### i18n

- [ ] The code prompt and its errors render per locale, asserted on rendered text.

### Observability

- [ ] Enrolment, disablement, session revocation and recovery are each auditable.

## BDD Scenarios

**Scenario: Turning on two-factor and using it**

- **Given** somebody who has just enrolled in two-factor
- **When** they sign out and sign back in
- **Then** they are asked for a code before they get in

**Scenario: A wrong code does not let anybody in**

- **Given** somebody at the code prompt
- **When** they enter the wrong code
- **Then** they are refused

**Scenario: A code cannot be used twice**

- **Given** a code that has already been accepted
- **When** it is entered again
- **Then** it is refused

**Scenario: Being remembered**

- **Given** somebody who chose to be remembered on this browser
- **When** they sign in again from it
- **Then** they are not asked for a code

**Scenario: Revoking everything**

- **Given** somebody remembered on a second browser
- **When** they revoke all sessions
- **Then** the second browser asks for a code again

**Scenario: Getting back in without the authenticator**

- **Given** somebody who has lost their authenticator
- **When** they complete recovery
- **Then** they reach their account

**Scenario: Recovery is not a way into somebody else's account**

- **Given** an account that is not theirs
- **When** somebody tries to recover it
- **Then** they are refused

## Test Plan

| Layer | What it proves |
| --- | --- |
| **Journey, Web** | Enrol, sign out, sign in with a real generated code, be remembered, revoke, be asked again. Against the real TOTP verifier — a stubbed verifier proves nothing about the algorithm or the window. |
| Replay | A used code and an out-of-window code each refused, separately. |
| Epoch | Remembered on browser A, revoke from browser B, A must re-prompt. This is the one number that governs the whole feature. |
| Security | Cross-account remembered token, cross-account recovery, disable-without-proof, and admin-endpoint-without-MFA are four separate refusals. |
| Resilience | Sign-out still succeeds when the epoch bump fails — the behaviour the code comments promise. |

## Out of Scope

- Changing the MFA design. This is coverage for what exists.

## Dependencies

- A way to generate valid TOTP codes for a test account, and to advance the clock
  for the window cases.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| MFA is tested with a stubbed verifier that always accepts | Real verifier, real generated codes, real time window. |
| The remembered-browser path is assumed because a token is issued | Asserted from a SECOND browser, before and after the epoch bump. |
| Recovery is walked only for the rightful owner | Cross-account recovery refusal is its own required scenario. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Full enrol-to-revoke cycle walked in a real browser.

## Notes

- Found 2026-08-21 in the third audit pass, by deriving capability keywords from
  route paths rather than from surface names — `totp`, `recovery` and `sessions`
  appear in `routes/portal.js` and nowhere in 610 scenarios.

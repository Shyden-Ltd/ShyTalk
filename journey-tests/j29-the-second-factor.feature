# j29 — Greta protects the admin account that can ban people, and gets back in when
# she loses the thing that protects it.
#
# Personas: P-12 Greta (Web Admin — the account worth attacking),
#           P-07 Vexa (Web — tries every way in),
#           P-02 Alice (Web — a second browser, for the remembered-browser epoch)
#
# Why this journey exists (SHY-0409): the portal has a complete MFA implementation — TOTP
# enrolment, totpVerified claims, a remembered-browser token, an epoch that revokes every
# remembered browser at once, session revocation and account recovery — and
# MFA_REMEMBER_SECRET is provisioned in PRODUCTION. The portal's Playwright specs are good
# CSP and XSS hardening tests and every one of them is a static DOM assertion: "has correct
# title", "no inline scripts in portal HTML", "script tag in hash is not rendered". Nobody
# had ever enrolled, entered a code, been remembered, or revoked a session. The second factor
# standing between an attacker and the account that can ban people was entirely unexercised.

Feature: j29 — the second factor actually stands
  As the holder of an account that can ban people
  I want the second factor to be exercised before an attacker exercises it
  So that the protection is known to work rather than known to be implemented

  Background:
    Given Greta [P-12] has an admin account with a password she knows

  @blocker @security
  Scenario: Greta turns on two-factor
    When Greta on Web enrols in two-factor
    Then Greta is shown a secret to keep

  @blocker @security
  Scenario: Signing in now asks for a code
    Given Greta has enrolled in two-factor and signed out
    When Greta signs in with her password
    Then Greta is asked for a code before she gets in

  @blocker @security
  Scenario: The right code lets her in
    Given Greta has been asked for a code
    When Greta enters the current code
    Then Greta reaches her account

  @blocker @security
  Scenario: The wrong code does not
    Given Greta has been asked for a code
    When Vexa [P-07] enters a wrong code
    Then Vexa is refused

  @blocker @security
  Scenario: A code cannot be used twice
    Given Greta has just signed in with a code
    When Vexa enters that same code
    Then Vexa is refused

  @blocker @security
  Scenario: An old code does not work
    Given a code from outside its time window
    When Vexa enters it
    Then Vexa is refused

  @blocker @security
  Scenario: Guessing is slowed down
    Given Vexa is at the code prompt
    When Vexa enters wrong codes repeatedly
    Then Vexa is made to wait

  @blocker @security
  Scenario: Being remembered on this browser
    Given Greta chose to be remembered when she last signed in
    When Greta signs in again from the same browser
    Then Greta is not asked for a code

  @blocker @security
  Scenario: Another browser is still asked
    Given Greta is remembered on her own browser
    When Greta signs in from a browser she has not used
    Then Greta is asked for a code

  # The epoch: one number that invalidates every remembered browser at once.
  @blocker @security
  Scenario: Revoking everything un-remembers every browser
    Given Greta is remembered on a second browser
    When Greta revokes all her sessions
    Then the second browser asks for a code again

  @blocker @security
  Scenario: A remembered browser belongs to one account
    Given Greta is remembered on her browser
    When Vexa tries to use Greta's remembered browser for her own account
    Then Vexa is asked for her own code

  @blocker @security
  Scenario: Two-factor cannot be switched off without proving it
    Given Greta is signed in
    When Greta tries to turn two-factor off without entering a code
    Then Greta is refused

  @blocker @security
  Scenario: The secret is shown once
    Given Greta has already enrolled
    When Greta asks to see her secret again
    Then Greta is not shown it

  @blocker @security
  Scenario: Admin work needs the second factor satisfied
    Given Greta has a session that has not satisfied two-factor
    When Greta tries to ban somebody
    Then Greta is refused

  @blocker @security
  Scenario: Getting back in without the authenticator
    Given Greta has lost her authenticator
    When Greta completes recovery
    Then Greta reaches her account

  @blocker @security
  Scenario: Recovery is not a way into somebody else's account
    Given Greta's account exists
    When Vexa tries to recover Greta's account
    Then Vexa is refused

  # The code comments promise this explicitly: a failed epoch bump must never turn a
  # successful sign-out into a 500.
  @blocker @edge
  Scenario: Signing out works even when the epoch cannot be bumped
    Given the remembered-browser epoch cannot be written
    When Greta signs out
    Then Greta is signed out

  @blocker @edge
  Scenario: A clock slightly out of step still works
    Given Greta's device clock is a little ahead
    When Greta enters the code her authenticator shows
    Then Greta reaches her account

  @blocker @edge
  Scenario: Enrolling twice leaves one secret
    Given Greta has already enrolled in two-factor
    When Greta enrols again
    Then Greta has one working second factor, not two

  @observability
  Scenario: Turning two-factor on and off is recorded
    Given Greta has enrolled and then disabled two-factor
    When the record is examined
    Then both actions are there with their times

  @i18n
  Scenario: The code prompt reads in Greta's language
    Given Greta's portal is in Spanish
    When Greta is asked for a code
    Then Greta reads the prompt in Spanish

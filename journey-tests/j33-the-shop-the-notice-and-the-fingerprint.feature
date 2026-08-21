# j33 — the last four ordinary things: buying, being told, being left alone, and
# getting in with a fingerprint.
#
# Personas: P-02 Alice (Android + iPhone — buys, reads, unsubscribes, signs in),
#           P-07 Vexa (Web — reaches for what is not hers),
#           P-12 Greta (Web Admin — sends the broadcast)
#
# Why this journey exists (SHY-0413): after three audit passes closed sixteen gaps, four
# user-facing paths were still at zero. Unsubscribe is the one with legal weight — an
# unsubscribe that does not unsubscribe is a consent failure, and the person it fails is by
# definition somebody who no longer wants to hear from us, so they will not report it, they
# will report US. The shop is read by every member and never read by a test, so a
# misconfigured package would first be found by a customer. Biometric sign-in is a way IN,
# which is a different thing from App Lock in j24 guarding an app already running.
#
# The unsubscribe scenarios assert the NOTIFICATION NOT ARRIVING, never a setting reading
# back as off. A flag is not consent.

Feature: j33 — buying, being told, being left alone, getting in
  As an ordinary member doing ordinary things
  I want the shop, the notices, the off switch and my fingerprint to work
  So that the everyday parts of the product are as proven as the dramatic ones

  Background:
    Given Alice [P-02] has an account and a device with biometrics enrolled

  @blocker @android-physical
  Scenario: Seeing what is for sale
    When Alice on Android opens the shop
    Then Alice sees each package with its price

  @blocker @edge @android-physical
  Scenario: A shop with nothing in it
    Given no packages are configured
    When Alice opens the shop
    Then Alice is told there is nothing available rather than shown a blank screen

  @blocker @edge @android-physical
  Scenario: A shop that cannot load
    Given the shop cannot be loaded
    When Alice opens it
    Then Alice is told it is unavailable

  @blocker @security
  Scenario: The price comes from us, not the app
    Given Alice is buying a package
    When a different price is supplied by the client
    Then the purchase uses our price

  @i18n @ios-device
  Scenario: Prices read in Alice's language
    Given Alice's app is in Vietnamese
    When Alice opens the shop
    Then Alice reads the prices in Vietnamese

  @blocker @android-physical
  Scenario: A broadcast reaches Alice
    Given Greta [P-12] has sent a broadcast
    When Alice opens the app
    Then Alice sees it

  @blocker @edge @android-physical
  Scenario: No broadcasts, no empty space
    Given no broadcasts have been sent
    When Alice opens the app
    Then Alice sees no empty space where a broadcast would be

  # Consent: asserted by the notification NOT arriving. A flag is not consent.
  @blocker @android-physical
  Scenario: Turning notifications off stops them
    Given Alice has unsubscribed from an event
    When that event happens
    Then no notification reaches Alice

  @blocker @edge @android-physical
  Scenario: Unsubscribing twice is harmless
    Given Alice has already unsubscribed from an event
    When Alice unsubscribes again
    Then Alice remains unsubscribed and nothing breaks

  @blocker
  Scenario: An unsubscribe that fails says so
    Given unsubscribing is failing
    When Alice unsubscribes from an event
    Then Alice is told it did not work

  @blocker @security
  Scenario: Nobody can unsubscribe somebody else
    Given Alice is subscribed to an event
    When Vexa [P-07] tries to unsubscribe Alice
    Then Vexa is refused

  @observability
  Scenario: Changing consent is recorded
    Given Alice has unsubscribed from an event
    When the record is examined
    Then the change is there with the time

  @blocker @security @android-physical
  Scenario: Signing in with a fingerprint
    Given Alice has set up biometric sign-in
    When Alice signs in with her fingerprint
    Then Alice reaches her account

  @blocker @security @ios-device
  Scenario: The same on her iPhone
    Given Alice has set up biometric sign-in on iOS
    When Alice signs in with her face
    Then Alice reaches her account

  @blocker @security
  Scenario: A challenge cannot be used twice
    Given a biometric challenge that has already been used
    When it is presented again
    Then it is refused

  @blocker @security
  Scenario: A challenge belongs to one account
    Given a biometric challenge issued to Alice
    When Vexa presents it for her own account
    Then Vexa is refused

  @blocker @edge @android-physical
  Scenario: A failed fingerprint offers another way
    Given Alice is signing in with her fingerprint
    When the fingerprint is not recognised
    Then Alice is offered another way to sign in

  @blocker @edge @android-physical
  Scenario: No biometrics on the device
    Given Alice's device has no biometrics enrolled
    When Alice opens the sign-in screen
    Then Alice is offered another way to sign in

  @blocker @security @android-physical
  Scenario: Biometrics changed since Alice set it up
    Given the biometrics on Alice's device have changed
    When Alice tries to sign in with them
    Then Alice must prove who she is another way

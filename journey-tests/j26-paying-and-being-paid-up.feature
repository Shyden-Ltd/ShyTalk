# j26 — Alice subscribes, lapses and comes back, and can see where her money went.
#
# Personas: P-02 Alice (Android + iPhone — the subscriber),
#           P-07 Vexa (Web — tries to reach Alice's money),
#           P-12 Greta (Web Admin — the economy surfaces nobody watches)
#
# Why this journey exists (SHY-0402, SHY-0407): the audit found the SuperShy gate walked from
# OUTSIDE and never from inside — "Stalkers tab shows SuperShy gate when user is not
# SuperShy" — so nobody had ever been a subscriber. Renewal and expiry are where subscription
# bugs live, and both are invisible without a journey: perks outliving payment cost money
# quietly, perks expiring early cost trust loudly. The admin spin-monitor had ZERO test
# naming it, on a gacha mechanic that takes real currency and has already shipped a dead
# wheel (SHY-0372) that a person found on a device rather than the suite. Transaction history
# is the screen somebody opens when they believe they were charged wrongly — the evidence
# surface for a money dispute — and it had one passing mention.

Feature: j26 — Alice's money is accounted for
  As someone who pays real money into ShyTalk
  I want what I bought to start and stop when I expect
  So that a mistake about my balance is found by you and not by me

  Background:
    Given Alice [P-02] has an account with no active subscription

  @blocker @android-physical
  Scenario: Subscribing opens the door that was closed
    Given Alice on Android has been shown the SuperShy gate
    When Alice subscribes
    Then Alice can use the feature that was gated

  @blocker @android-physical
  Scenario: Alice can see what she is paying for
    Given Alice is a subscriber
    When Alice opens her subscription
    Then Alice sees that it is active and when it renews

  @blocker @android-physical
  Scenario: Renewing keeps the door open
    Given Alice's subscription has renewed
    When Alice uses the gated feature
    Then Alice can still use it

  @blocker @android-physical
  Scenario: Cancelling keeps what she has already paid for
    Given Alice has cancelled but her paid period has not ended
    When Alice uses the gated feature
    Then Alice can still use it

  @blocker @android-physical
  Scenario: The gate returns when the paid period ends
    Given Alice's cancelled subscription has expired
    When Alice opens the gated feature
    Then Alice is shown the gate again

  @blocker @android-physical
  Scenario: Coming back after a lapse
    Given Alice's subscription expired some time ago
    When Alice subscribes again
    Then Alice can use the gated feature

  @blocker
  Scenario: A payment that fails buys nothing
    Given Alice's payment fails
    When Alice opens the gated feature
    Then Alice is shown the gate

  @blocker @security
  Scenario: A receipt cannot be used twice
    Given Alice's subscription receipt has already been processed
    When the same receipt is submitted again
    Then Alice's paid period is unchanged

  @blocker @security
  Scenario: A forged confirmation buys nothing
    Given a subscription confirmation that cannot be verified
    When it is submitted
    Then no subscription is granted

  @blocker @security
  Scenario: Nobody can subscribe on somebody else's behalf
    Given Vexa [P-07] has no subscription
    When Vexa tries to activate a subscription for Alice
    Then Vexa is refused

  @blocker @edge @ios-device
  Scenario: Restoring a purchase on a second device
    Given Alice is a subscriber and signs in on her iPhone
    When Alice restores her purchases
    Then Alice can use the gated feature on her iPhone

  @blocker @edge @android-physical
  Scenario: A refund closes the door
    Given Alice's subscription has been refunded
    When Alice opens the gated feature
    Then Alice is shown the gate

  @blocker @android-physical
  Scenario: A purchase shows up in her history
    Given Alice has just bought coins
    When Alice opens her transaction history
    Then Alice sees that purchase with its amount

  @blocker @edge @android-physical
  Scenario: A history with nothing in it
    Given Marcus [P-04] has never bought anything
    When Marcus opens his transaction history
    Then Marcus is told there is nothing there yet

  @blocker @edge @android-physical
  Scenario: A history longer than one screen
    Given Alice has more transactions than fit on one screen
    When Alice scrolls to the end of her history
    Then Alice reaches her oldest transaction

  @blocker @security
  Scenario: Nobody can read somebody else's transactions
    Given Alice has a purchase history
    When Vexa asks for Alice's transactions
    Then Vexa is refused

  @blocker
  Scenario: An admin can see a spin that just happened
    Given Alice has just used Lucky Spin
    When Greta [P-12] opens the spin monitor
    Then Greta sees Alice's spin

  # SHY-0372 shipped exactly this and a person found it on a device, not the suite.
  @blocker @regression @android-physical
  Scenario: A refused spin leaves the wheel usable
    Given Alice does not have enough coins to spin
    When Alice tries to spin
    Then Alice is told why, and can spin again once she has coins

  @blocker @security
  Scenario: The spin monitor is not open to everyone
    Given Alice is not an admin
    When Alice opens the spin monitor
    Then Alice is refused

  @blocker @security
  Scenario: Economy settings are not open to everyone
    Given Alice is not an admin
    When Alice opens the economy settings
    Then Alice is refused

  @blocker
  Scenario: Changing what a spin pays out changes what people get
    Given Greta has changed what Lucky Spin pays out
    When Alice spins
    Then Alice receives the new amount

  @i18n @android-physical
  Scenario: Alice reads her balance in her own language
    Given Alice's app is in Arabic
    When Alice opens her wallet
    Then Alice reads her balance in Arabic with Arabic numerals

  @edge @android-physical
  Scenario: A balance of nothing
    Given Alice has spent every coin she had
    When Alice opens her wallet
    Then Alice sees a balance of zero rather than an empty space

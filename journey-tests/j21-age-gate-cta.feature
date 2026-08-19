# j21 — Adam, 18+ but unverified — meets the age wall on every blocked feature
# and verifies from where he stands.
#
# Personas: P-01 Adam (Android + iPhone, adult date of birth, never approved),
#           P-03 Mia (Android, under 18 — the cohort that must NOT be offered the flow),
#           P-12 Greta (Web Admin — approves the ID Adam submits from the wall)
#
# Why this journey exists (SHY-0268): j01 already covers age verification, but Adam always
# starts it from his profile — never from the wall that blocked him. That blind spot shipped
# a P0: on Android, tapping "Verify now" on the gacha wall closed the app outright, and the
# same button in private messages did nothing at all. This journey walks every wall and
# proves each one leads somewhere.

Feature: j21 — Adam meets the age wall and verifies from where he stands
  As a member old enough to use the app but not yet approved
  I want every "verify now" offer on every blocked feature to actually open verification
  So that I am never dead-ended, or closed out of the app, at the moment I try to comply

  Background:
    Given Adam [P-01] is 18 or over but has never had his ID approved
    And Adam has 500 coins and is in the room "Chill Zone"

  @blocker @android-physical
  Scenario: The gacha wall stops the spin and offers Adam a way to verify
    When Adam on Android tries to spin the gacha
    Then Adam is told he must verify his age first
    And Adam is offered the chance to verify now
    And Adam's coins are untouched

  @blocker @android-physical
  Scenario: Accepting the offer opens verification instead of closing the app
    Given Adam on Android has been stopped by the age wall on the gacha
    When Adam on Android chooses to verify now
    Then Adam is shown the start of the age-verification flow
    And Adam's app is still open

  @blocker @android-physical
  Scenario: Adam submits his passport from the wall that stopped him
    Given Adam on Android has opened age verification from the gacha wall
    When Adam on Android submits a photo of his passport
    Then Adam is told his ID is waiting to be reviewed

  @blocker @android-physical
  Scenario: Declining the offer returns Adam to the room with his coins
    Given Adam on Android has been stopped by the age wall on the gacha
    When Adam on Android dismisses the age wall
    Then Adam is back in the room
    And Adam's coins are untouched

  @blocker @android-physical
  Scenario: The wall in private messages leads to the same place
    Given Adam on Android has been stopped by the age wall in a private chat
    When Adam on Android chooses to verify now
    Then Adam is shown the start of the age-verification flow
    And Adam's app is still open

  @blocker @android-physical
  Scenario: The wall in the room's message panel leads to the same place
    Given Adam on Android has been stopped by the age wall in the room's message panel
    When Adam on Android chooses to verify now
    Then Adam is shown the start of the age-verification flow
    And Adam's app is still open

  @blocker @ios-device
  Scenario: Adam gets the same way out on his iPhone
    Given Adam on iOS has been stopped by the age wall on the gacha
    When Adam on iOS chooses to verify now
    Then Adam is shown the start of the age-verification flow
    And Adam's app is still open

  @blocker @android-physical @cross-cohort
  Scenario: A member under 18 is offered support, never the verification flow
    Given Mia [P-03] is under 18 and is in the room "Chill Zone"
    When Mia on Android tries to spin the gacha
    Then Mia is told she cannot spin and is offered support
    And Mia is never offered the chance to verify now

  @blocker @android-physical
  Scenario: The spin is refused even when the wall is bypassed
    When Adam on Android spins the gacha without passing the age wall
    Then the spin is refused
    And Adam's coins are untouched

  @blocker @android-physical @browser-chromium
  Scenario: Once Greta approves the ID, the wall is gone
    Given Greta [P-12] has approved the ID Adam submitted from the gacha wall
    When Adam on Android spins the gacha after reopening the app
    Then the spin succeeds
    And Adam's coins are spent

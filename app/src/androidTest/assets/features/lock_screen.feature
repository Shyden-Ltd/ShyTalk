Feature: Lock Screen
  As a returning user
  I want to unlock the app with my PIN
  So that I can resume without re-authenticating

  Background:
    Given I am authenticated as "test-user-1"
    And I have default user flags
    And I am on the "lock" screen

  Scenario: Shows PIN keypad and dots
    Then I should see the text "Enter your PIN"
    And I should see the element with tag "pinKeypad"
    And I should see the element with tag "pinDots"

  Scenario: Wrong PIN shows error
    When I enter PIN "0000"
    And I tap the text "Unlock"
    Then I should see the text "Wrong PIN"

  Scenario: Correct PIN unlocks app
    When I enter PIN "1234"
    And I tap the text "Unlock"
    Then I should see the element with tag "main_roomsTab"

  Scenario: Lockout after five failures
    When I fail PIN entry 5 times
    Then I should see the text "Account Locked"

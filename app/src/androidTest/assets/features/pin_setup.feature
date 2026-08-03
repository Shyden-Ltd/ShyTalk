Feature: PIN Setup
  As a new or migrating user
  I want to create a PIN after signing in
  So that I can unlock the app quickly

  Background:
    Given I am authenticated as "test-user-1"
    And I have default user flags
    And I am on the "pin_setup" screen

  Scenario: Shows PIN length chooser
    Then I should see the text "Choose PIN length"
    And I should see the element with tag "pinLength4"
    And I should see the element with tag "pinLength8"

  Scenario: Selecting length shows create screen
    When I tap the element with tag "pinLength4"
    Then I should see the text "Create a PIN"
    And I should see the element with tag "pinKeypad"

  Scenario: Entering PIN advances to confirm step
    When I tap the element with tag "pinLength4"
    And I enter PIN "1234"
    And I tap the text "Next"
    Then I should see the text "Confirm your PIN"

  Scenario: Mismatched confirm resets to create
    When I tap the element with tag "pinLength4"
    And I enter PIN "1234"
    And I tap the text "Next"
    And I enter PIN "5678"
    And I tap the text "Confirm"
    Then I should see the text "PINs don't match"

  Scenario: Matching confirm completes setup
    When I tap the element with tag "pinLength4"
    And I enter PIN "1234"
    And I tap the text "Next"
    And I enter PIN "1234"
    And I tap the text "Confirm"
    Then I should see the text "Security settings"

  Scenario: Shows security settings info text
    Then I should see the text "Security settings"

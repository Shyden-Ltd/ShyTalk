Feature: Email OTP Sign-In
  As a user without Google or Apple
  I want to sign in with a one-time email code
  So that I can access the app

  Background:
    Given I am not authenticated
    And I am on the "email_sign_in" screen

  Scenario: Shows email input and send button
    Then I should see the element with tag "emailInput"
    And I should see the text "Send code"

  Scenario: Rejects invalid email
    When I type "not-an-email" into the field with tag "emailInput"
    And I tap the text "Send code"
    Then I should see the text "valid email"

  Scenario: Valid email shows code entry
    When I type "test@example.com" into the field with tag "emailInput"
    And I tap the text "Send code"
    Then I should see the text "Code sent to"
    And I should see the element with tag "codeInput"

  Scenario: Code screen shows resend and expiry info
    When I type "test@example.com" into the field with tag "emailInput"
    And I tap the text "Send code"
    Then I should see the text "Resend"
    And I should see the text "10 minutes"

  Scenario: Invalid code shows error
    When I type "test@example.com" into the field with tag "emailInput"
    And I tap the text "Send code"
    And I type "000000" into the field with tag "codeInput"
    And I tap the text "Verify"
    Then I should see the text "Invalid code"

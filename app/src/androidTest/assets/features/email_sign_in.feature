Feature: Email Sign-In
  As a user
  I want to sign in with my email
  So that I can access the app without Google or Apple

  Background:
    Given I am not authenticated
    And I am on the "email_sign_in" screen

  Scenario: Shows OTP email input
    Then I should see the element with tag "emailInput"
    And I should see the text "Send code"

  Scenario: Back returns to sign-in screen
    When I tap the text "Back"
    Then I should see the element with tag "signIn_googleButton"

Feature: Email Sign-In
  As a user
  I want to sign in with my email
  So that I can access the app without Google or Apple

  Scenario: Email sign-in screen shows email input and send button
    Given I am not authenticated
    And I am on the "email_sign_in" screen
    Then I should see the element with tag "emailSignIn_emailField"
    And I should see the element with tag "emailSignIn_sendButton"
    And I should see the element with tag "emailSignIn_backButton"

  Scenario: Back button returns to sign-in screen
    Given I am not authenticated
    And I am on the "email_sign_in" screen
    When I tap the element with tag "emailSignIn_backButton"
    And I wait 1000 milliseconds
    Then I should see the element with tag "signIn_googleButton"

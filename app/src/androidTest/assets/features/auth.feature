Feature: Authentication Flow
  As a user
  I want to sign in and set up my profile
  So that I can use the app

  Scenario: Sign-in screen shows Google button
    Given I am not authenticated
    And I am on the sign-in screen
    Then I should see the element with tag "signIn_googleButton"

  Scenario: Sign-in screen shows app title
    Given I am not authenticated
    And I am on the sign-in screen
    Then I should see the text "ShyTalk"

  Scenario: Existing user navigates to main screen
    Given I am authenticated as "test-user-1"
    And I have default user flags
    And I am on the main screen
    Then I should see the element with tag "main_roomsTab"

  Scenario: Profile setup shows form fields
    Given I am authenticated as "test-user-1"
    And I am on the "profile_setup" screen
    Then I should see the element with tag "profileSetup_displayNameField"
    And I should see the element with tag "profileSetup_dobButton"
    And I should see the element with tag "profileSetup_continueButton"

Feature: Profile Setup
  As a new user
  I want to set up my profile
  So that other users can identify me

  Scenario: Profile setup shows all required fields
    Given I am authenticated as "test-user-1"
    And I am on the "profile_setup" screen
    Then I should see the element with tag "profileSetup_displayNameField"
    And I should see the element with tag "profileSetup_dobButton"
    And I should see the element with tag "profileSetup_continueButton"

  Scenario: User can enter display name
    Given I am authenticated as "test-user-1"
    And I am on the "profile_setup" screen
    When I type "MyDisplayName" into the field with tag "profileSetup_displayNameField"
    Then I should see the element with tag "profileSetup_continueButton"

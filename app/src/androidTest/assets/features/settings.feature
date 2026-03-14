Feature: Settings
  As a user
  I want to access app settings
  So that I can configure the app

  Scenario: Settings screen is accessible
    Given I am on the main screen
    When I tap the element with tag "main_settingsButton"
    Then I should see the element with tag "settings_backButton"
    And I should see the element with tag "settings_signOutButton"

  Scenario: Back button returns to main
    Given I am on the main screen
    When I tap the element with tag "main_settingsButton"
    And I tap the element with tag "settings_backButton"
    And I wait 1000 milliseconds
    Then I should see the element with tag "main_roomsTab"

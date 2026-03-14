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

  Scenario: Settings reached via profile tab shows sign-out button
    Given I am on the main screen
    When I tap the "Profile" tab
    And I wait for the element with tag "main_settingsButton"
    And I tap the element with tag "main_settingsButton"
    Then I should see the element with tag "settings_signOutButton"

  Scenario: Sign-out button is visible when launching settings directly
    Given I am on the "settings" screen
    When I wait for the element with tag "settings_signOutButton"
    Then I should see the element with tag "settings_signOutButton"

  Scenario: Sign-out button is tappable without crash
    Given I am on the "settings" screen
    When I wait for the element with tag "settings_signOutButton"
    And I tap the element with tag "settings_signOutButton"
    And I wait 1000 milliseconds
    Then I should see the element with tag "settings_signOutButton"

  Scenario: Privacy Policy is accessible via About section
    Given I am on the "settings" screen
    When I wait for the element with tag "settings_signOutButton"
    And I tap the text "About"
    And I wait for the text "Privacy Policy"
    And I tap the text "Privacy Policy"
    And I wait 1000 milliseconds
    Then I should see the element with tag "settings_signOutButton"

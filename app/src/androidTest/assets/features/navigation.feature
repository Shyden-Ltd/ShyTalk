Feature: Bottom Navigation
  As a user
  I want to navigate between tabs
  So that I can access different sections of the app

  Background:
    Given I am on the main screen

  Scenario: All bottom tabs are navigable
    When I tap the "Messages" tab
    Then I should see the element with tag "main_messagesTab"

  Scenario: I tap the "Profile" tab
    Given I tap the "Messages" tab
    When I tap the "Profile" tab
    Then I should see the element with tag "main_profileTab"

  Scenario: I tap the "Rooms" tab
    Given I tap the "Messages" tab
    And I tap the "Profile" tab
    When I tap the "Rooms" tab
    Then I should see the element with tag "main_roomsTab"

  Scenario: Rooms tab shows room list
    Then I should see the text "Chill Zone"

  Scenario: Profile tab shows user profile
    When I tap the "Profile" tab
    Then I should see the element with tag "profile_displayName"

  Scenario: Create room FAB is visible on rooms tab
    Then I should see the element with tag "main_createRoomFab"

  Scenario: New message FAB is visible on messages tab
    When I tap the "Messages" tab
    Then I should see the element with tag "main_newMessageFab"

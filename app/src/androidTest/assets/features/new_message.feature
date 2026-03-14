Feature: New Message
  As a user
  I want to start new conversations
  So that I can message people I haven't chatted with

  Scenario: New message screen shows search and create group
    Given I am on the main screen
    When I tap the "Messages" tab
    And I tap the element with tag "main_newMessageFab"
    Then I should see the element with tag "newMessage_searchField"
    And I should see the element with tag "newMessage_createGroupButton"

  Scenario: Search for a user
    Given I am on the main screen
    When I tap the "Messages" tab
    And I tap the element with tag "main_newMessageFab"
    And I type "TestUser" into the field with tag "newMessage_searchField"
    Then I should see the element with tag "newMessage_searchField"

  Scenario: New message screen shows search field when launched directly
    Given I am on the "new_message" screen
    When I wait for the element with tag "newMessage_searchField"
    Then I should see the element with tag "newMessage_searchField"

  Scenario: Group setup screen shows name field
    Given I am on the "group_setup/test-user-2" screen
    When I wait for the element with tag "groupSetup_nameField"
    Then I should see the element with tag "groupSetup_nameField"

  Scenario: Group setup screen shows create button
    Given I am on the "group_setup/test-user-2" screen
    When I wait for the element with tag "groupSetup_createButton"
    Then I should see the element with tag "groupSetup_createButton"

Feature: Room
  As a user
  I want to browse and join voice rooms
  So that I can socialize with other users

  Scenario: Room list shows available rooms
    Given I am on the main screen
    Then I should see the text "Chill Zone"

  Scenario: Create room FAB is visible
    Given I am on the main screen
    Then I should see the element with tag "main_createRoomFab"

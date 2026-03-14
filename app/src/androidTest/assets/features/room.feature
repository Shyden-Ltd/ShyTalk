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

  Scenario: Room list shows multiple rooms
    Given I am on the main screen
    Then I should see the text "Chill Zone"
    And I should see the text "Music Room"

  Scenario: Tapping a room navigates to room screen
    Given I am on the main screen
    When I tap the text "Chill Zone"
    Then I should see the element with tag "room_roomName"

  # Skipped: roomsTab_emptyState_showsEmptyMessage — requires mutating FakeRoomRepository
  # to clear the room list, which cannot be done with available steps.

  Scenario: Room screen shows seat grid
    Given I am on the main screen
    When I tap the text "Chill Zone"
    And I wait for the element with tag "room_seatGrid"
    Then I should see the element with tag "room_seatGrid"

  Scenario: Room screen back button returns to main
    Given I am on the main screen
    When I tap the text "Chill Zone"
    And I wait for the element with tag "room_backButton"
    And I tap the element with tag "room_backButton"
    Then I should see the element with tag "main_roomsTab"

  Scenario: Create room FAB opens creation dialog
    Given I am on the main screen
    When I tap the element with tag "main_createRoomFab"
    Then I should see the element with tag "createRoom_nameField"

  # Skipped: createRoom_emptyName_buttonDisabled — requires assertIsNotEnabled,
  # which is not available in the current step definitions.

  Scenario: Submitting room creation form navigates to new room
    Given I am on the main screen
    When I tap the element with tag "main_createRoomFab"
    And I wait for the element with tag "createRoom_nameField"
    And I type "My New Room" into the field with tag "createRoom_nameField"
    And I tap the element with tag "createRoom_createButton"
    Then I should see the element with tag "room_roomName"

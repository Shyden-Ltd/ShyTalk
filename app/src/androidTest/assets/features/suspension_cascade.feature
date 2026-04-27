Feature: Suspension Cascade
  As a moderation enforcer
  I want a suspension to propagate the right way through every active room
  So that suspended users can't continue participating and owner closures are immediate

  Scenario: Suspending the room owner closes the room for everyone
    Given I am attendee "User D" in a fully-occupied room owned by "User A"
    When admin suspends owner "User A"
    Then I should see the element with tag "main_roomsTab"
    And the room "TestRoom" should not be in the active rooms list

  Scenario Outline: Suspending a non-owner clears their seat but leaves room open
    Given I am the owner of a fully-occupied 8-seat room with <role> "<user>" in seat <seat>
    When admin suspends <role> "<user>"
    Then seat <seat> should be empty within 5 seconds
    And the room should still be displayed for me

    Examples:
      | role     | user    | seat |
      | host     | User B  | 1    |
      | attendee | User D  | 3    |

  Scenario: Suspending a visitor (not seated) does not affect any seats
    Given I am the owner of a fully-occupied 8-seat room with visitor "User V" in the audience
    When admin suspends visitor "User V"
    Then no seat should change state

  Scenario: Suspending the owner of an abandoned room still closes it
    Given owner "User A" has navigated away from a room they own
    When admin suspends owner "User A"
    Then the room should have state CLOSED

  Scenario: Suspending a user who owns one room and hosts another cascades both
    Given user "User M" owns "RoomA" and is a seated host in "RoomB"
    When admin suspends user "User M"
    Then "RoomA" should have state CLOSED
    And "RoomB" should still be ACTIVE
    And in "RoomB" user "User M" should not be in hostIds
    And in "RoomB" the seat held by "User M" should be empty

  Scenario: Suspended user is shown the suspension screen on next launch
    Given I am attendee "User D" in a room
    When admin suspends me
    And I sign out and back in
    Then the suspension screen is displayed for me

  Scenario: Suspended host loses host privileges before any subsequent action
    Given user "User B" was a seated host in a room
    When admin suspends host "User B"
    And admin lifts the suspension on "User B"
    And "User B" rejoins the room as a returning user
    Then "User B" should be a regular attendee with no host privileges

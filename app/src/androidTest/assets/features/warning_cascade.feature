Feature: Warning Cascade
  Warnings are soft moderation actions: they update user GCS and surface a
  WarningScreen, but do NOT touch room state or remove the user from any seat.

  Scenario Outline: Warning preserves the warned user's seat and the room
    Given I am <role> "<user>" in seat <seat> of a fully-occupied 8-seat room
    When admin issues a warning for me
    Then I should see the element with tag "warning_title"
    When I tap the element with tag "warning_acknowledgeButton"
    Then I should still be in seat <seat>
    And the room should still be active

    Examples:
      | role     | user    | seat |
      | owner    | User A  | 0    |
      | host     | User B  | 1    |
      | attendee | User D  | 3    |

  Scenario: Warning a visitor preserves their presence in the audience
    Given I am visitor "User V" in the audience of a room
    When admin issues a warning for me
    Then I should see the element with tag "warning_title"
    When I tap the element with tag "warning_acknowledgeButton"
    Then I should still be in the room as a visitor

  Scenario: Warned host retains host privileges after acknowledging
    Given I am host "User B" seated in seat 1 of a fully-occupied 8-seat room
    When admin issues a warning for me
    And I tap the element with tag "warning_acknowledgeButton"
    Then I should still have host privileges in the room

  Scenario: Warning fields update on user doc but room doc is untouched
    Given I am attendee "User D" in seat 3 of a room
    When admin issues a warning for me with severity 3
    Then my user document should have hasActiveWarning equal to true
    And my user document should have warningCount incremented by 1
    And the room document should have no changes

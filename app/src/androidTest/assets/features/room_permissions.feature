Feature: Room Permissions Matrix
  As a moderation policy enforcer
  I want owner / host / attendee actions to follow the role hierarchy
  So that hosts can moderate without being able to override the owner

  # Layout used throughout these scenarios — a fully-occupied 8-seat room:
  #
  #   seat 0 → owner (User A)
  #   seat 1 → host  (User B)
  #   seat 2 → host  (User C)
  #   seat 3 → attendee (User D)
  #   seat 4 → attendee (User E)
  #   seat 5 → attendee (User F)
  #   seat 6 → attendee (User G)
  #   seat 7 → attendee (User H)

  # ── Kick action — positive cases ────────────────────────────────

  Scenario: Owner can kick a host
    Given I am the owner of a fully-occupied 8-seat room
    When I long-press the seat occupied by host "User B"
    And I tap the element with tag "seatAction_kick"
    And I tap the text "Kick"
    Then host "User B" should no longer be in the room

  Scenario: Owner can kick an attendee
    Given I am the owner of a fully-occupied 8-seat room
    When I long-press the seat occupied by attendee "User D"
    And I tap the element with tag "seatAction_kick"
    And I tap the text "Kick"
    Then attendee "User D" should no longer be in the room

  Scenario: Host can kick an attendee
    Given I am host "User B" in a fully-occupied 8-seat room
    When I long-press the seat occupied by attendee "User D"
    And I tap the element with tag "seatAction_kick"
    And I tap the text "Kick"
    Then attendee "User D" should no longer be in the room

  # ── Kick action — negative cases (Scenario Outline) ─────────────

  Scenario Outline: Kick action is not exposed in disallowed combinations
    Given I am <actor_role> "<actor>" in a fully-occupied 8-seat room
    When I long-press the seat occupied by <target_role> "<target>"
    Then I should not see the element with tag "seatAction_kick"

    Examples:
      | actor_role | actor   | target_role | target  |
      | owner      | User A  | self        | User A  |
      | host       | User B  | owner       | User A  |
      | host       | User B  | host        | User C  |
      | attendee   | User D  | owner       | User A  |
      | attendee   | User D  | host        | User B  |
      | attendee   | User D  | attendee    | User E  |

  # ── Remove from seat — positive cases ───────────────────────────

  Scenario: Owner can remove a host from their seat
    Given I am the owner of a fully-occupied 8-seat room
    When I long-press the seat occupied by host "User B"
    And I tap the element with tag "seatAction_removeFromSeat"
    Then seat 1 should be empty

  Scenario: Host can remove an attendee from their seat
    Given I am host "User B" in a fully-occupied 8-seat room
    When I long-press the seat occupied by attendee "User D"
    And I tap the element with tag "seatAction_removeFromSeat"
    Then seat 3 should be empty

  # ── Remove from seat — negative cases ───────────────────────────

  Scenario Outline: Remove-from-seat is not exposed in disallowed combinations
    Given I am <actor_role> "<actor>" in a fully-occupied 8-seat room
    When I long-press the seat occupied by <target_role> "<target>"
    Then I should not see the element with tag "seatAction_removeFromSeat"

    Examples:
      | actor_role | actor   | target_role | target  |
      | owner      | User A  | self        | User A  |
      | host       | User B  | host        | User C  |
      | attendee   | User D  | host        | User B  |
      | attendee   | User D  | attendee    | User E  |

  # ── Force-mute — positive cases ─────────────────────────────────

  Scenario: Owner can force-mute a host
    Given I am the owner of a fully-occupied 8-seat room with all mics open
    When I long-press the seat occupied by host "User B"
    And I tap the element with tag "seatAction_forceMute"
    Then seat 1 should show the muted indicator

  Scenario: Host can force-mute an attendee
    Given I am host "User B" in a fully-occupied 8-seat room with all mics open
    When I long-press the seat occupied by attendee "User D"
    And I tap the element with tag "seatAction_forceMute"
    Then seat 3 should show the muted indicator

  # ── Force-mute — negative cases ─────────────────────────────────

  Scenario Outline: Force-mute is not exposed in disallowed combinations
    Given I am <actor_role> "<actor>" in a fully-occupied 8-seat room
    When I long-press the seat occupied by <target_role> "<target>"
    Then I should not see the element with tag "seatAction_forceMute"

    Examples:
      | actor_role | actor   | target_role | target  |
      | owner      | User A  | self        | User A  |
      | host       | User B  | owner       | User A  |
      | host       | User B  | host        | User C  |
      | attendee   | User D  | host        | User B  |
      | attendee   | User D  | attendee    | User E  |

  Scenario: Already-muted seat cannot be force-muted again
    Given I am the owner of an 8-seat room where attendee "User D" has self-muted
    When I long-press the seat occupied by attendee "User D"
    Then I should not see the element with tag "seatAction_forceMute"

  # ── Seat policy — owner seat 0 ──────────────────────────────────

  Scenario Outline: Only the owner can sit in seat 0
    Given I am <role> "<actor>" in a room where the owner has temporarily left seat 0
    When I tap the empty seat at index 0
    Then seat 0 should still be empty

    Examples:
      | role     | actor  |
      | host     | User B |
      | attendee | User D |

  Scenario: Owner can re-take seat 0 when empty
    Given I am the owner of a room where the owner has temporarily left seat 0
    When I tap the empty seat at index 0
    Then seat 0 should now be occupied by the owner

  Scenario: Owner cannot sit in a non-owner seat
    Given I am the owner of a room with an empty seat at index 5
    When I tap the empty seat at index 5
    Then seat 5 should still be empty

  # ── Seat policy — self-invite vs seat-request ───────────────────

  Scenario: Host can self-invite to a non-owner seat in an open room
    Given I am host "User B" in an open room with an empty seat at index 5
    When I tap the empty seat at index 5
    Then seat 5 should now be occupied by host "User B"

  Scenario: Host cannot bypass approval — they queue with attendees
    Given I am host "User B" in an approval-required room with an empty seat at index 5
    When I tap the empty seat at index 5
    Then a seat request should be created for host "User B" at index 5
    And seat 5 should still be empty

  Scenario Outline: Attendee always goes through the seat-request queue
    Given I am attendee "User D" in a <approval> room with an empty seat at index 5
    When I tap the empty seat at index 5
    Then a seat request should be created for attendee "User D" at index 5
    And seat 5 should still be empty

    Examples:
      | approval         |
      | open             |
      | approval-required|

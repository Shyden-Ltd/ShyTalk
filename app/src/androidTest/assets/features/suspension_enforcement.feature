Feature: Suspension enforcement
  As the ShyTalk system
  I want to enforce suspensions correctly
  So that suspended users cannot misuse the platform

  Scenario: Fully suspended user cannot open rooms
    Given I am authenticated as "suspended-user-1"
    And my account has a full suspension
    When I try to navigate to "rooms"
    Then I should see the suspension screen
    And I should not be able to leave the suspension screen

  Scenario: Fully suspended user cannot send messages
    Given I am authenticated as "suspended-user-1"
    And my account has a full suspension
    When I try to navigate to "messaging"
    Then I should see the suspension screen

  Scenario: Fully suspended user cannot access profile settings
    Given I am authenticated as "suspended-user-1"
    And my account has a full suspension
    When I try to navigate to "settings"
    Then I should see the suspension screen

  Scenario: Suggestions-only suspended user can open rooms normally
    Given I am authenticated as "suggestions-suspended-user"
    And my account has a suggestions-only suspension
    When I navigate to "rooms"
    Then I should see the rooms list
    And I should not see the suspension screen

  Scenario: Suspension expires and user regains access without app restart
    Given I am authenticated as "expiring-suspended-user"
    And my suspension expires in 1 second
    When I wait for the suspension to expire
    And the app checks suspension status
    Then I should not see the suspension screen
    And I should be able to navigate normally

  Scenario: User suspended while in a room is kicked
    Given I am authenticated as "test-user-1"
    And I am in room "test-room-1"
    When my account receives a full suspension
    Then I should be removed from the room
    And I should see the suspension screen

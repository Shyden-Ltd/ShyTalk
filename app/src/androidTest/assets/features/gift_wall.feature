Feature: Gift Wall
  As a user
  I want to view and interact with the gift wall
  So that I can send and receive gifts

  Scenario: Gift wall screen is navigable and shows gift grid
    Given I am on the "gift_wall/test-user-1" screen
    When I wait for the element with tag "giftWall_grid"
    Then I should see the element with tag "giftWall_grid"

  Scenario: User profile shows Gift Wall tab
    Given I am on the "user_profile/test-user-1" screen
    When I wait for the text "Gift Wall"
    Then I should see the text "Gift Wall"

  Scenario: Gift Wall tab on profile is tappable
    Given I am on the "user_profile/test-user-1" screen
    When I wait for the text "Gift Wall"
    And I tap the text "Gift Wall"
    And I wait 500 milliseconds
    Then I should see the text "Gift Wall"

Feature: Account deletion with suggestions
  As a ShyTalk user
  I want my suggestions to be handled correctly when I delete my account
  So that content integrity is maintained

  Scenario: Pending suggestion withdrawn on account deletion
    Given I am authenticated as "deleting-user"
    And I have a pending suggestion titled "My idea"
    When I delete my account
    Then my pending suggestion should be withdrawn

  Scenario: Accepted suggestion remains, author shows Deleted User
    Given I am authenticated as "deleting-user"
    And I have an accepted suggestion titled "Good idea"
    When I delete my account
    Then the accepted suggestion should still exist
    And the author should show "Deleted User"

  Scenario: Votes removed, counts updated on deletion
    Given I am authenticated as "deleting-user"
    And I have voted on suggestion "popular-sug"
    When I delete my account
    Then my vote on "popular-sug" should be removed
    And the vote count on "popular-sug" should be updated

  Scenario: Subscriptions removed, no further notifications
    Given I am authenticated as "deleting-user"
    And I am watching 3 features
    When I delete my account
    Then all my subscriptions should be removed
    And I should receive no further notifications

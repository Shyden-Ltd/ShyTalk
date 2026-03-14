Feature: Follow List
  As a user
  I want to view followers and following lists
  So that I can manage my social connections

  Scenario: Followers tab is visible when navigating to follow list
    Given I am on the "follow_list/test-user-1/followers" screen
    Then I should see the element with tag "followList_followersTab"

  Scenario: Following tab is visible when navigating to follow list
    Given I am on the "follow_list/test-user-1/following" screen
    Then I should see the element with tag "followList_followingTab"

  Scenario: Switch between followers and following tabs
    Given I am on the "follow_list/test-user-1/followers" screen
    When I wait for the element with tag "followList_followersTab"
    And I tap the element with tag "followList_followingTab"
    And I wait 500 milliseconds
    And I tap the element with tag "followList_followersTab"
    And I wait 500 milliseconds
    Then I should see the element with tag "followList_followersTab"

  # Skipped: stalkersTab_notShown_forOtherUser — requires assertDoesNotExist on text with substring match,
  # which cannot be expressed with available steps.

  Scenario: Stalkers tab is visible on own follow list
    Given I am on the "follow_list/test-user-1/followers" screen
    When I wait for the element with tag "followList_followersTab"
    Then I should see the text "Stalkers (0)"

  Scenario: Stalkers tab shows SuperShy gate when user is not SuperShy
    Given I am on the "follow_list/test-user-1/stalkers" screen
    Then I should see the text "Super Shy Benefit"
    And I should see the text "Get Super Shy"

  Scenario: Tapping Stalkers tab from Followers shows SuperShy gate
    Given I am on the "follow_list/test-user-1/followers" screen
    When I wait for the text "Stalkers (0)"
    And I tap the text "Stalkers (0)"
    And I wait 500 milliseconds
    Then I should see the text "Super Shy Benefit"
    And I should see the text "Get Super Shy"

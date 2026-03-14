Feature: Daily Reward
  As a user
  I want to receive a daily login reward
  So that I am rewarded for returning to the app each day

  Scenario: Daily reward dialog appears on main screen
    Given I am on the main screen
    Then I should see the element with tag "dailyReward_dialog"

  Scenario: Claiming daily reward dismisses the dialog
    Given I am on the main screen
    When I wait for the element with tag "dailyReward_claimButton"
    And I tap the element with tag "dailyReward_claimButton"
    And I wait 1000 milliseconds
    And I tap the text "Awesome!"
    And I wait 1000 milliseconds
    Then I should not see the element with tag "dailyReward_dialog"

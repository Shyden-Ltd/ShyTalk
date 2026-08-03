Feature: Degraded Mode
  As the app
  I want to inform users about technical difficulties
  So that they know the service is temporarily impaired

  Scenario: Shows technical difficulties title
    Given I am on the "degraded_mode" screen
    Then I should see the element with tag "degraded_title"

  Scenario: Shows acknowledge button
    Given I am on the "degraded_mode" screen
    Then I should see the element with tag "degraded_acknowledgeButton"

  Scenario: Acknowledge dismisses the screen
    Given I am on the "degraded_mode" screen
    When I tap the element with tag "degraded_acknowledgeButton"
    Then I should not see the element with tag "degraded_title"

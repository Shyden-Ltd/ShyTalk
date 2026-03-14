Feature: Warning Acknowledgment
  As a user who has received an official warning
  I want to acknowledge the warning
  So that I can continue using the app

  Scenario: Warning screen shows warning content
    Given I am on the "warning" screen
    When I wait for the element with tag "warning_title"
    Then I should see the element with tag "warning_title"
    And I should see the text "Official Warning"

  Scenario: Accepting the warning navigates to main screen
    Given I am on the "warning" screen
    When I wait for the element with tag "warning_acceptButton"
    And I tap the element with tag "warning_acceptButton"
    Then I should see the element with tag "main_roomsTab"

  Scenario: Tapping community standards link navigates to community standards
    Given I am on the "warning" screen
    When I wait for the element with tag "warning_communityStandardsLink"
    And I tap the element with tag "warning_communityStandardsLink"
    Then I should see the text "Community Standards"

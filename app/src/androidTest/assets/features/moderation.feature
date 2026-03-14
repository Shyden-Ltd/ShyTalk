Feature: Moderation Screens
  As an app enforcing community standards
  I want to show ban and suspension screens
  So that users understand their account status

  Scenario: Device ban screen shows title and sign out
    Given the ban screen is displayed for a "device" ban
    Then I should see the element with tag "ban_title"
    And I should see the element with tag "ban_reason"
    And I should see the element with tag "ban_expires"
    And I should see the element with tag "ban_signOutButton"

  Scenario: Network ban screen shows appropriate title
    Given the ban screen is displayed for a "network" ban
    Then I should see the element with tag "ban_title"
    And I should see the element with tag "ban_signOutButton"

  Scenario: Permanent ban shows permanent text
    Given the permanent ban screen is displayed
    Then I should see the element with tag "ban_title"
    And I should see the element with tag "ban_permanent"
    And I should see the element with tag "ban_signOutButton"

  Scenario: Suspension with appeal shows appeal form
    Given the suspension screen is displayed with appeal option
    Then I should see the element with tag "suspension_title"
    And I should see the element with tag "suspension_appealField"
    And I should see the element with tag "suspension_submitAppealButton"
    And I should see the element with tag "suspension_signOutButton"

  Scenario: Permanent suspension without appeal
    Given the suspension screen is displayed without appeal
    Then I should see the element with tag "suspension_title"
    And I should see the element with tag "suspension_signOutButton"

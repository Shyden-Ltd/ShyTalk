Feature: Roadmap notifications
  As a ShyTalk user
  I want to receive notifications about roadmap and suggestion updates
  So that I stay informed about features I care about

  Background:
    Given I am authenticated as "test-user-1"

  Scenario: User receives in-app notification when watched feature status changes
    Given I have subscribed to feature "account-deletion"
    When the feature "account-deletion" status changes to "done"
    Then I should see the notification bell badge
    And I should see a notification with text "Account deletion is now complete"

  Scenario: User receives system message when their suggestion is accepted
    Given I have submitted a suggestion titled "Add dark mode"
    When an admin accepts my suggestion
    Then I should see a system message from "SHYTALK_SYSTEM"
    And the system message should contain "accepted"

  Scenario: User receives system message when their suggestion is rejected
    Given I have submitted a suggestion titled "Free premium"
    When an admin rejects my suggestion with reason "Not feasible"
    Then I should see a system message from "SHYTALK_SYSTEM"
    And the system message should contain "declined"
    And the system message should contain "Not feasible"

  Scenario: User taps notification and is taken to roadmap page in browser
    Given I have a notification of type "roadmap_update"
    When I tap the notification
    Then a browser should open with URL containing "roadmap"

  Scenario: User taps system message and sees suggestion details
    Given I have a system message about suggestion "sug-123"
    When I tap the system message
    Then I should be in the "SHYTALK_SYSTEM" conversation

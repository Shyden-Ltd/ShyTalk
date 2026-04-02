Feature: Subscription management
  As a ShyTalk user
  I want to manage my notification preferences for roadmap and suggestions
  So that I only receive the notifications I care about

  Background:
    Given I am authenticated as "test-user-1"
    And I am on the "settings" screen

  Scenario: User opens notification settings and sees per-event channel toggles
    When I navigate to notification preferences
    Then I should see toggle options for "roadmap updates"
    And I should see toggle options for "suggestion accepted"
    And I should see channel options for "in-app"
    And I should see channel options for "push"

  Scenario: User enables email notifications with GDPR consent
    When I navigate to notification preferences
    And I enable "email" for "roadmap updates"
    Then I should see a GDPR consent prompt
    When I accept the GDPR consent
    Then the "email" toggle for "roadmap updates" should be enabled

  Scenario: User disables all notifications for an event type
    When I navigate to notification preferences
    And I disable all channels for "suggestion accepted"
    Then all toggles for "suggestion accepted" should be off

  Scenario: User views watched features list and removes one
    Given I am watching feature "account-deletion"
    When I navigate to notification preferences
    Then I should see "account-deletion" in my watch list
    When I remove "account-deletion" from my watch list
    Then "account-deletion" should not be in my watch list

Feature: Linked Accounts
  As a user
  I want to view and manage my linked authentication providers
  So that I can control how I sign in to the app

  # Note: These scenarios depend on fake repository state pre-configured with multiple providers.
  # The default test user (test-user-1) has Google + Email providers linked.

  Scenario: Navigate to Linked Accounts shows providers
    Given I am on the "settings" screen
    When I wait for the text "Account"
    And I tap the text "Account"
    And I wait for the text "Linked Accounts"
    And I tap the text "Linked Accounts"
    Then I should see the text "Google"
    And I should see the text "Email"

  Scenario: Linked Accounts shows Unlink buttons when multiple providers are active
    Given I am on the "settings" screen
    When I wait for the text "Account"
    And I tap the text "Account"
    And I wait for the text "Linked Accounts"
    And I tap the text "Linked Accounts"
    Then I should see the text "Unlink"

  # Skipped: linkedAccounts_singleProvider_noUnlinkButton — requires mutating fake repo state
  # mid-scenario (setting single provider), which cannot be done with available steps.

  Scenario: Tapping Unlink shows confirmation dialog
    Given I am on the "settings" screen
    When I wait for the text "Account"
    And I tap the text "Account"
    And I wait for the text "Linked Accounts"
    And I tap the text "Linked Accounts"
    And I wait for the text "Unlink"
    And I tap the text "Unlink"
    Then I should see the text "Cancel"

  # Skipped: linkedAccounts_showsDeactivatedProvider — requires mutating fake repo state
  # to set a deactivated provider (active=false), which cannot be done with available steps.

  Scenario: Account page shows unique ID
    Given I am on the "settings" screen
    When I wait for the text "Account"
    And I tap the text "Account"
    Then I should see the text "10000001"

  # Skipped: accountPage_showsLinkedCount ("2 linked") — requires specific fake data setup
  # with exactly 2 providers, which cannot be guaranteed with available steps.

Feature: Legal Acceptance
  As a user
  I want to accept the terms of service
  So that I can use the app

  Scenario: Legal acceptance shows accept button
    Given I am authenticated as "test-user-1"
    And I am on the "legal_acceptance" screen
    Then I should see the element with tag "legal_acceptButton"

  Scenario: Legal acceptance screen shows welcome text
    Given I am on the "legal_acceptance" screen
    When I wait for the element with tag "legal_acceptButton"
    Then I should see the text "Welcome to ShyTalk"

  # Skipped: legalScreen_acceptButton_disabledUntilAllChecked — requires assertIsNotEnabled
  # and assertIsEnabled, which are not available in the current step definitions.

  Scenario: Tapping checkboxes on legal acceptance screen
    Given I am on the "legal_acceptance" screen
    When I wait for the element with tag "legal_acceptButton"
    And I tap the element with tag "legal_checkbox_PrivacyPolicy"
    And I tap the element with tag "legal_checkbox_CommunityStandards"
    And I tap the element with tag "legal_checkbox_TermsAndConditions"
    And I tap the element with tag "legal_checkbox_CyberBullyingPolicy"
    Then I should see the element with tag "legal_acceptButton"

  Scenario: Tapping Privacy Policy link navigates without crash
    Given I am on the "legal_acceptance" screen
    When I wait for the element with tag "legal_acceptButton"
    And I tap the text "Privacy Policy"
    And I wait 1000 milliseconds
    Then I should see the element with tag "legal_acceptButton"

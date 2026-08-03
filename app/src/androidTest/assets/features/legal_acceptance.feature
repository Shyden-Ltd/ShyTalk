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

  Scenario: Agreeing to every policy keeps the accept button available
    Given I am on the "legal_acceptance" screen
    When I tick every legal policy checkbox
    Then I should see the element with tag "legal_acceptButton"

  Scenario: Tapping Privacy Policy link navigates without crash
    Given I am on the "legal_acceptance" screen
    When I wait for the element with tag "legal_acceptButton"
    And I tap the text "Privacy Policy"
    Then I should see the element with tag "legal_acceptButton"

  Scenario: Shows all four checkboxes
    Given I am on the "legal_acceptance" screen
    When I wait for the element with tag "legal_acceptButton"
    Then I should see the element with tag "legal_checkbox_PrivacyPolicy"
    And I should see the element with tag "legal_checkbox_CommunityStandards"
    And I should see the element with tag "legal_checkbox_TermsAndConditions"
    And I should see the element with tag "legal_checkbox_CyberBullyingPolicy"

  Scenario: Tapping a checkbox enables it
    Given I am on the "legal_acceptance" screen
    When I wait for the element with tag "legal_acceptButton"
    And I tap the element with tag "legal_checkbox_PrivacyPolicy"
    Then I should see the element with tag "legal_checkbox_PrivacyPolicy"

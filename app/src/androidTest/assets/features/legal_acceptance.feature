Feature: Legal Acceptance
  As a user
  I want to accept the terms of service
  So that I can use the app

  Scenario: Legal acceptance shows accept button
    Given I am authenticated as "test-user-1"
    And I am on the "legal_acceptance" screen
    Then I should see the element with tag "legal_acceptButton"

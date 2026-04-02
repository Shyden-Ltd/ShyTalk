Feature: Multi-account detection
  As the ShyTalk system
  I want to detect when multiple accounts use the same device
  So that abuse via multiple accounts is prevented

  Scenario: Second account login triggers suspension for both accounts
    Given I am authenticated as "test-user-1" on device "device-shared"
    And I sign out
    When I authenticate as "test-user-2" on device "device-shared"
    Then both "test-user-1" and "test-user-2" should be suspended
    And the suspension reason should contain "Multiple accounts"

  Scenario: Suspended user sees multi-account reason
    Given I am authenticated as "multi-account-user"
    And my account was suspended for multi-account detection
    Then I should see the suspension screen
    And the suspension reason should contain "Multiple accounts detected"

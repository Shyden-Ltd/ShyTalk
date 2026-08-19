Feature: Security Settings
  As a user
  I want to manage my security preferences
  So that I can control app lock, biometric, and PIN

  Background:
    Given I am authenticated as "test-user-1"
    And I have default user flags
    And I am on the "security_settings" screen

  Scenario: Shows all security options
    Then I should see the element with tag "appLockToggle"
    And I should see the element with tag "biometricToggle"
    And I should see the element with tag "resetPinSetting"

  Scenario: App lock enabled by default with timeout visible
    Then I should see the text "App Lock"
    And I should see the element with tag "lockTimeoutSetting"

  Scenario: Disabling app lock hides timeout
    When I tap the element with tag "appLockToggle"
    And I wait 500 milliseconds
    Then I should not see the element with tag "lockTimeoutSetting"

# NOTE (SHY-0187): the reset-PIN flow is covered elsewhere, not here, because it
# needs the real PIN backend (PinRepository -> API -> Firebase) which the fake
# Compose harness does not provide:
#   - the identity-gate wiring (reset re-verifies when a credential exists) is
#     pinned at the host level in AppLockWiringPinTest;
#   - the Settings -> Security click-through is a runnable journey test
#     (SettingsNavigationTest.securityRow_navigatesToSecurityScreen);
#   - the live verify-dialog + first-set behaviours are proven on the real
#     device against the local stack in the batched device gauntlet.

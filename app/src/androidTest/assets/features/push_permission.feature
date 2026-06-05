Feature: Push permission denial UX
  As a ShyTalk user whose OS notifications are blocked
  I want a visible, persistent reminder with a one-tap path to Settings
  So that I can re-enable notifications without hunting through the OS

  Background:
    Given I am authenticated as "test-user-1"
    And I am on the main screen

  Scenario: Banner visible when push permission is DENIED
    Given the push permission state is "DENIED"
    Then I should see the element with tag "pushDeniedBanner"

  Scenario: Banner hidden when push permission is AUTHORIZED
    Given the push permission state is "AUTHORIZED"
    Then I should not see the element with tag "pushDeniedBanner"

  Scenario: Banner hidden when push permission is NOT_DETERMINED
    Given the push permission state is "NOT_DETERMINED"
    Then I should not see the element with tag "pushDeniedBanner"

  Scenario: Banner hidden when push permission is PROVISIONAL
    Given the push permission state is "PROVISIONAL"
    Then I should not see the element with tag "pushDeniedBanner"

  Scenario: Tapping the banner invokes the system settings deeplink
    Given the push permission state is "DENIED"
    When I tap the element with tag "pushDeniedBanner"
    Then the system settings deeplink should be invoked

  Scenario: Banner disappears when user grants permission via Settings (late grant)
    Given the push permission state is "DENIED"
    And I should see the element with tag "pushDeniedBanner"
    When the push permission state changes to "AUTHORIZED"
    Then I should not see the element with tag "pushDeniedBanner"

  Scenario: Banner appears when user revokes permission via Settings (late revoke)
    Given the push permission state is "AUTHORIZED"
    And I should not see the element with tag "pushDeniedBanner"
    When the push permission state changes to "DENIED"
    Then I should see the element with tag "pushDeniedBanner"

  Scenario: Banner is non-dismissible — tapping it does NOT hide it
    Given the push permission state is "DENIED"
    And I should see the element with tag "pushDeniedBanner"
    When I tap the element with tag "pushDeniedBanner"
    Then I should see the element with tag "pushDeniedBanner"
    And the system settings deeplink should be invoked

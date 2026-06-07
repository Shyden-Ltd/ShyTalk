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

  # ── OS-facts → state mapping (PR-B2b: integration coverage for #1015) ──
  # These exercise the END-TO-END mapping from raw OS facts (enabled flag,
  # SDK version, hasAsked sentinel) through `refreshPushPermissionState` →
  # `PushPermissionStore.updateState` → HomeViewModel.collect → uiState →
  # banner. The mapping function itself is unit-tested in
  # `shared/src/androidHostTest/.../AndroidPushPermissionTest`; this layer
  # adds the integration assertion that the banner UX reflects the mapping
  # result correctly across SDK paths.
  #
  # NOT covered at the BDD layer: `enabled=true + SDK>=33 + hasAsked=false`.
  # At the banner layer the outcome is identical to the next scenario
  # (Pre-Tiramisu enabled → AUTHORIZED → no banner). The unique side
  # effect of this tuple is `shouldBackfillSentinel→true→markAsked()`,
  # which `seedPushPermissionStateForTesting` deliberately passes as a
  # no-op (its `markAsked` callback is empty). Backfill behaviour is
  # covered by `AndroidPushPermissionTest` at the unit layer.

  Scenario: Pre-Tiramisu Android with notifications disabled → banner visible
    Given OS notifications enabled is "false" on Android SDK 32 with hasAsked "true"
    Then I should see the element with tag "pushDeniedBanner"

  Scenario: Pre-Tiramisu Android with notifications enabled → banner hidden
    Given OS notifications enabled is "true" on Android SDK 32 with hasAsked "false"
    Then I should not see the element with tag "pushDeniedBanner"

  Scenario: Tiramisu+ Android first launch (not yet asked) → banner hidden (NOT_DETERMINED)
    Given OS notifications enabled is "false" on Android SDK 34 with hasAsked "false"
    Then I should not see the element with tag "pushDeniedBanner"

  Scenario: Tiramisu+ Android post-denial (already asked) → banner visible
    Given OS notifications enabled is "false" on Android SDK 34 with hasAsked "true"
    Then I should see the element with tag "pushDeniedBanner"

Feature: Age Segregation — minor → adult age-up (UK OSA #17)
  As a user whose 18th birthday has passed
  I want the next sign-in to move me into the wider adult cohort
  So that I see and interact with adults without needing manual intervention

  # The full age-up state machine (DOB → cohort flip → forceTokenRefresh →
  # custom-claim refresh → adult-cohort welcome PM) is exercised by:
  #   - shared/src/commonTest/.../CohortDerivationTest (DOB → cohort math)
  #   - express-api/tests/routes/pm-lock-check.test.js (server-side flip + claim mint)
  #   - shared/src/commonTest/.../AuthRepositoryTokenRefreshTest (token refresh round-trip)
  # This E2E confirms the user-facing strings + UI wiring exist and survive a sign-in.

  Scenario: Welcome PM copy ships in the English bundle
    Given I am authenticated as "test-user-1"
    And I am on the main screen
    Then the locale bundle contains the string "age_seg_age_up_welcome_pm"

  Scenario: Admin-DOB-down PM copy ships in the English bundle
    Given I am authenticated as "test-user-1"
    And I am on the main screen
    Then the locale bundle contains the string "age_seg_age_down_admin_pm"

  Scenario: Generic cross-cohort placeholder ships in the English bundle
    Given I am authenticated as "test-user-1"
    And I am on the main screen
    Then the locale bundle contains the string "age_seg_unavailable"

  Scenario: Sign-in surface loads with cohort-aware repository wiring (smoke)
    Given I am authenticated as "test-user-1"
    And I am on the main screen
    Then I should see the element with tag "main_messagesTab"
    And I should see the element with tag "main_roomsTab"
    And I should see the element with tag "main_profileTab"

Feature: Age Segregation — discovery & messaging filter (UK OSA #17)
  As a user in a particular cohort (minor / adult)
  I want the app to only surface same-cohort people to me
  So that mixed-cohort interactions are prevented in line with UK OSA

  # E2E fakes are single-cohort by construction (see
  # FakeRoomRepository / FakeUserRepository — `cohort` arg accepted but
  # not modelled). These scenarios pin the user-facing TAG / TEXT
  # surface that the cohort filter (CohortAwareItemFilter, PR 12) and
  # the cross-cohort placeholder copy (age_seg_user_unavailable,
  # age_seg_room_unavailable) attach to. The full cross-cohort
  # filtering contract is enforced by the JVM-level
  # CohortAwareItemFilterTest suite and the Express middleware
  # tests; this E2E confirms the wiring is present and unbroken.

  Scenario: Same-cohort follow list renders in the new-message picker (smoke)
    Given I am authenticated as "test-user-1"
    And I am on the main screen
    When I tap the "Messages" tab
    And I tap the element with tag "main_newMessageFab"
    Then I should see the element with tag "newMessage_searchField"

  Scenario: New-message picker loads without crashing under the cohort filter (smoke)
    Given I am authenticated as "test-user-1"
    And I am on the "new_message" screen
    Then I should see the element with tag "newMessage_searchField"
    And I should see the element with tag "newMessage_createGroupButton"

  Scenario: Cross-cohort profile placeholder copy ships in the English bundle
    Given I am authenticated as "test-user-1"
    And I am on the main screen
    Then the locale bundle contains the string "age_seg_user_unavailable"
    And the locale bundle contains the string "age_seg_room_unavailable"
    And the locale bundle contains the string "age_seg_cross_cohort_blocked_toast"

  Scenario: Cross-cohort PM copy ships in the English bundle
    Given I am authenticated as "test-user-1"
    And I am on the main screen
    Then the locale bundle contains the string "age_seg_relationship_removed_pm"
    And the locale bundle contains the string "age_seg_room_removed_pm"
    And the locale bundle contains the string "age_seg_thread_hidden_pm"
    And the locale bundle contains the string "age_seg_group_frozen_banner"

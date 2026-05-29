# j02 — Mia, minor new user — restricted UX, same-cohort discovery, cross-cohort wall.
#
# Personas: P-03 Mia (iOS Sim — primary), P-04 Marcus (Android — same-cohort follow target),
#           P-02 Alice (cross-cohort target — must be invisible / 404)
#
# This journey proves the minor cohort is properly isolated: signup, age-verification entry,
# PM tab, leaderboard, discovery — every adult surface is gated. Cross-cohort follow attempts
# return 404 with audit. Same-cohort interactions succeed.

Feature: j02 — Mia's restricted minor experience
  As a 15-year-old signing up on iOS
  I want the app to enforce the OSA minor cohort everywhere
  So that I never see, contact, or interact with adults

  Background:
    Given the local stack is healthy
    Given the device locale is "en"
    Given Mia [P-03] is on iOS Sim with the app installed but no Firebase session
    Given Marcus [P-04] is on Android signed in (same-cohort minor) at the "discovery" screen
    Given Alice [P-02] is on Web Chromium signed in (cross-cohort adult)

  # The original 39-step "Mia signs up, sees restricted UX, follows Marcus,
  # fails to follow Alice" scenario is split into 10 phase-focused scenarios
  # sharing the Background install state. Each later scenario sets up the prior
  # phase's outcome via setup-style `Given`. Full minor-cohort isolation coverage
  # preserved across signup → legal → restricted UX → blocked age-verification
  # → same-cohort discovery → cross-cohort wall → follow → leaderboard → stalkers.
  @blocker @ios-sim
  Scenario: Mia signs up with a minor DOB — user doc records cohort=minor and exact dateOfBirth
    When Mia on iOS Sim taps "signin_signUpLink"
    When Mia on iOS Sim types "mia-new-{ts}@shytalk.dev" into "signup_emailField"
    When Mia on iOS Sim types "TestPassw0rd!" into "signup_passwordField"
    When Mia on iOS Sim picks DOB "2010-08-20" in "signup_dobPicker"
    When Mia on iOS Sim taps "signup_createAccountButton"
    Then within 5000ms the database has document "users/{newUniqueId}" with field "cohort" equal to "minor"
    Then the database has document "users/{newUniqueId}" with field "dateOfBirth" equal to 1282262400000

  @blocker @ios-sim
  Scenario: Mia accepts legal — rooms tab appears on the main UI
    Given Mia has just signed up as a minor
    When Mia on iOS Sim accepts both legal checkboxes and continues
    Then within 3000ms Mia's iOS Sim UI shows the element with tag "main_roomsTab"

  @blocker @ios-sim
  Scenario: Mia's minor UI hides adult-only features (messages, buy coins, gacha)
    Given Mia has accepted legal as a minor
    Then Mia's iOS Sim UI does not show the element with tag "main_messagesTab"
    Then Mia's iOS Sim UI does not show the element with tag "wallet_buyCoinsButton"
    Then Mia's iOS Sim UI does not show the element with tag "main_gachaTab"

  @blocker @ios-sim
  Scenario: Mia cannot access age-verification (UI hidden + deep-link blocked + API 403)
    Given Mia has accepted legal as a minor
    When Mia on iOS Sim opens the "profile" screen
    Then Mia's iOS Sim UI does not show the element with tag "profile_ageVerificationEntry"
    When Mia on iOS Sim attempts to navigate to "/age-verification" via deep link
    Then Mia's iOS Sim UI shows "You must be 18 or older to use this feature"
    When POST /api/age-verification/submit with any payload as Mia
    Then the response status is 403

  @blocker @ios-sim
  Scenario: Mia's same-cohort discovery search shows Marcus and only minor rows
    Given Mia has accepted legal as a minor
    When Mia on iOS Sim opens the "discovery" screen
    When Mia on iOS Sim types "minor-power" into the search field
    Then within 3000ms Mia's iOS Sim UI shows Marcus in the results
    Then the response from /api/users/search as Mia has 1 result and "cohort=minor" in every row

  @blocker @ios-sim @cross-cohort
  Scenario: Mia's cross-cohort search for "adult-power" returns no results (Alice invisible)
    Given Mia has accepted legal as a minor
    When Mia on iOS Sim types "adult-power" into the search field
    Then within 3000ms Mia's iOS Sim UI shows "No results found"
    Then the response from /api/users/search has 0 results

  @blocker @ios-sim @android-physical
  Scenario: Mia follows Marcus (same cohort) — graph mirrors + Marcus's counter ticks
    Given Mia has accepted legal as a minor
    When Mia on iOS Sim taps Marcus's user card
    When Mia on iOS Sim taps "profile_followButton"
    Then within 3000ms the database has document "users/{newUniqueId}" with field "followingIds" containing 60000010
    Then within 3000ms the database has document "users/60000010" with field "followerIds" containing {newUniqueId}
    Then within 5000ms Marcus's Android UI shows a +1 in the "Followers" count

  @blocker @ios-sim @cross-cohort
  Scenario: Mia's cross-cohort follow attempt at Alice returns 404 with an audit row
    Given Mia has accepted legal as a minor
    When POST /api/users/follow with targetUniqueId=50000010 as Mia
    Then the response status is 404
    Then the database has 1 entries in "auditLog" matching {action: "blocked", targetId: 50000010, sourceId: {newUniqueId}, reason: "cohort_mismatch"}
    Then Mia's iOS Sim UI does not show Alice anywhere

  @blocker @ios-sim
  Scenario: Mia's leaderboard is filtered to her cohort — only minor rows
    Given Mia has accepted legal as a minor
    When Mia on iOS Sim opens the "leaderboard" screen
    Then within 3000ms Mia's iOS Sim UI shows only minor-cohort users in the rankings
    Then the response from /api/economy/leaderboards has "cohort=minor" in every row

  @ios-sim
  Scenario: Mia's stalkers screen filters out adult-cohort visitors
    Given Mia has accepted legal as a minor
    When Mia on iOS Sim opens the "stalkers" screen
    Then Mia's iOS Sim UI does not show any adult-cohort visitor

  @blocker @ios-sim @cross-cohort
  Scenario: Cross-cohort PM-creation attempt by minor is rejected
    Given Mia [P-03] is signed in on iOS Sim
    When POST /api/conversations with targetUniqueId=50000010 as Mia
    Then the response status is 404
    Then no conversation doc is created
    Then the database has 1 entries in "auditLog" matching {action: "blocked", targetId: 50000010, reason: "cohort_mismatch"}

  @ios-sim
  Scenario: Defence-in-depth — stale followingIds entry pointing at an adult is hidden in UI
    Given Mia's user doc was manipulated to have followingIds=[50000010] (cross-cohort, stale)
    When Mia on iOS Sim opens the "following" screen
    Then Mia's iOS Sim UI does not show "Alice"
    Then Mia's iOS Sim UI renders the placeholder "age_seg_user_unavailable" in that slot

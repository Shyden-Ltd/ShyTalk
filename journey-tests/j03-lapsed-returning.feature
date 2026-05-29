# j03 — Lena, lapsed adult, German locale — forced re-acceptance + streak reset.
#
# Personas: P-05 Lena (Web Chromium — primary, locale=de)
# Platforms: Web only (web is the lapsed-user re-engagement channel)
#
# This journey proves: lapsed sign-in still works, the new privacy version forces re-acceptance,
# decayed streak resets to 1 on claim, German strings render, FCM token re-registers, and
# all of the user's followers from before remain intact.

Feature: j03 — Lena's lapsed return
  As a user who hasn't signed in for 45 days
  I want to be re-engaged without losing my account history
  So that I can pick up where I left off, but be re-prompted for any policy changes

  Background:
    Given the local stack is healthy
    Given the device locale is "de"
    Given Lena [P-05] has user doc with acceptedPrivacyVersion=2, lastLoginRewardDate="2026-04-01", loginStreak=0, fcmTokens=[]
    Given the current privacy version is 4 in /api/legal/versions
    Given Lena [P-05] is on Web Chromium at "/" with no Firebase session

  # The original "Lena signs in after 45 days — re-acceptance + streak reset +
  # German UI" scenario was 26 steps. Split into 6 phase-focused scenarios sharing
  # the Background lapsed-state setup. Each runs in isolation against the seeded
  # privacy/streak/fcm state.
  @blocker @browser-chromium @locale
  Scenario: Lena signs in via login.html with German UI labels
    When Lena on Web navigates to "/login.html"
    Then Lena's Web UI document direction is "ltr"
    Then Lena's Web UI shows German translation of "Sign in" in the page heading
    When Lena on Web types "lapsed-adult@shytalk.dev" + "{PERSONAS_PASSWORD}" and submits
    Then within 5000ms Lena's Web UI navigates to "/"

  @blocker @browser-chromium @locale
  Scenario: Lena is forced through the new-privacy acceptance flow on first post-lapse load
    Given Lena has just signed in after 45 days with accepted privacy v2 (current is v4)
    Then within 3000ms Lena's Web UI shows the legal acceptance screen
    Then Lena's Web UI shows a "What's changed" highlight pointing at section 11 (UK OSA cohorts)
    Then Lena's Web UI shows the heading in German
    When Lena on Web checks both legal checkboxes and continues
    Then within 5000ms the database has document "usersAcceptedPolicies/50000020" with field "privacyVersion" equal to 4
    Then the database has document "usersAcceptedPolicies/50000020" with field "termsVersion" equal to 4

  @blocker @browser-chromium @locale
  Scenario: Lena's daily-reward streak resets to 1 with the German "Streak reset" toast
    Given Lena has accepted the new privacy version after her 45-day lapse
    When Lena on Web opens the "/daily-reward" screen
    Then Lena's Web UI shows "Streak reset" toast in German
    When Lena on Web taps the claim button
    Then within 3000ms the database has document "users/50000020" with field "loginStreak" equal to 1
    Then the database has document "users/50000020" with field "shyCoins" greater than 800
    Then the database has document "users/50000020" with field "lastLoginRewardDate" equal to today

  @browser-chromium
  Scenario: Lena's web push FCM token re-registers after the lapse
    Given Lena has signed in and accepted the new privacy version
    When Lena on Web grants the browser notification permission
    Then within 5000ms POST /api/notifications/token receives a request with a web push token from Lena
    Then within 5000ms the database has document "users/50000020" with field "fcmTokens" array length 1

  @browser-chromium
  Scenario: Lena's social graph survived the 45-day lapse — Alice still in followed list
    Given Lena has signed in after 45 days with pre-lapse followingIds=[50000010]
    When Lena on Web opens the "following" screen
    Then Lena's Web UI shows Alice (P-02 adult power) in the followed list
    Then the database has document "users/50000020" with field "followingIds" containing 50000010

  @browser-chromium @locale
  Scenario: Lena's wallet screen renders German labels with locale-appropriate currency name
    Given Lena has signed in with locale=de
    When Lena on Web opens the "wallet" screen
    Then Lena's Web UI shows German translation of "Wallet"
    Then Lena's Web UI shows "Münzen" or "Coins" (locale-appropriate)

  @browser-chromium
  Scenario: Lena dismisses the re-acceptance — cannot reach main app
    Given Lena is on the legal acceptance screen
    When Lena on Web closes the modal via the X button without checking boxes
    Then Lena's Web UI does not show the element with tag "main_roomsTab"
    Then the database does not have a new "usersAcceptedPolicies/50000020" with version 4

  @browser-chromium @perf-budget:3000
  Scenario: Lena's sign-in completes within 3s on a cold session
    When Lena on Web signs in with valid credentials
    Then the time from submit to "main_roomsTab" rendering is less than 3000ms

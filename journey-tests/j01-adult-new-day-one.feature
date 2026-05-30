# j01 — Adam, adult new user — full first-day flow.
#
# Personas: P-01 Adam (Android), P-02 Alice (Web — recipient of first gift), P-12 Greta (Web Admin — approves age verification)
# Platforms: Android (primary), Web (Alice), Web Admin (Greta)
#
# This journey threads through: install → signup → DOB → cohort=minor → legal acceptance →
# age verification submission → admin approve → cohort flip to adult → token refresh → wallet
# daily reward → discovery → follow → first gift sent → recipient's gift wall updates.
#
# This is the canonical "happy path" for a brand-new adult. Every other journey builds on this.

Feature: j01 — Adam's first day
  As a new adult signing up on Android
  I want a working end-to-end flow from install to my first gift sent
  So that we know the OSA cohort gate doesn't trap legitimate adults

  Background:
    Given the local stack is healthy
    Given the device locale is "en"
    Given Adam [P-01] is on Android with the app installed but no Firebase session
    Given Alice [P-02] is on Web Chromium signed in at the "discovery" screen
    Given Greta [P-12] is on Web Admin signed in at the "/admin#age-verification" tab

  # The original 60-step "Adam signs up, gets age-verified, and sends his first
  # gift to Alice" scenario is split into 10 phase-focused scenarios sharing the
  # Background install state. Each later scenario sets up the prior phase's
  # outcome via setup-style `Given`. Full first-day adult onboarding coverage
  # preserved across signup → legal → minor-default UX → verification → admin
  # approve → token refresh → daily reward → discover/follow → first gift →
  # cross-platform propagation.
  @blocker @android-emulator
  Scenario: Adam signs up with email/password/DOB — minor cohort + unverified by default
    When Adam on Android taps "signin_signUpLink"
    When Adam on Android types "adam-new-{ts}@shytalk.dev" into "signup_emailField"
    When Adam on Android types "TestPassw0rd!" into "signup_passwordField"
    When Adam on Android picks DOB "2004-01-01" in "signup_dobPicker"
    When Adam on Android taps "signup_createAccountButton"
    Then within 5000ms the database has document "identityMap/email:adam-new-{ts}@shytalk.dev" with field "uniqueId" of type "number"
    Then Adam's uniqueId is recorded as {newUniqueId} for the rest of this scenario
    Then within 5000ms the database has document "users/{newUniqueId}" with field "cohort" equal to "minor"
    Then the database has document "users/{newUniqueId}" with field "isAgeVerified" equal to false

  @blocker @android-emulator
  Scenario: Adam accepts privacy + terms — usersAcceptedPolicies doc written, main UI shown
    Given Adam has just signed up with a minor-default cohort
    Then within 5000ms Adam's Android UI shows the legal acceptance screen
    When Adam on Android taps "legal_acceptPrivacyCheckbox"
    When Adam on Android taps "legal_acceptTermsCheckbox"
    When Adam on Android taps "legal_continueButton"
    Then the database has document "usersAcceptedPolicies/{newUniqueId}" with field "privacyVersion" greater than 0
    Then within 3000ms Adam's Android UI shows the element with tag "main_roomsTab"

  @blocker @android-emulator
  Scenario: Pre-verification Adam's UI hides adult-only features (messages tab + buy coins)
    Given Adam has accepted legal as a minor-default user
    Then Adam's Android UI does not show the element with tag "main_messagesTab"
    Then Adam's Android UI does not show the element with tag "wallet_buyCoinsButton"

  @blocker @android-emulator
  Scenario: Adam submits a passport ID for age verification — PENDING row + "Submitted" UI
    Given Adam has accepted legal as a minor-default user
    When Adam on Android opens the "profile" screen
    Then Adam's Android UI shows the element with tag "profile_ageVerificationEntry"
    When Adam on Android taps "profile_ageVerificationEntry"
    When Adam on Android picks ID type "passport"
    When Adam on Android selects test image "test-passport-adult.jpg" from the gallery
    When Adam on Android taps "ageVerification_submitButton"
    Then within 5000ms the database has 1 entries in "ageVerificationSubmissions" matching {userId: "{newUniqueId}", status: "PENDING"}
    Then Adam's Android UI shows "Submitted — awaiting review"

  @blocker @browser-chromium
  Scenario: Greta approves Adam's submission — cohort flips to adult, audit row written
    Given Adam has a PENDING age-verification submission
    When Greta on Web Admin refreshes the age-verification tab
    Then within 3000ms Greta's Web Admin UI shows 1 row for "{newUniqueId}" with status "PENDING"
    When Greta on Web Admin taps "approve" on the submission for "{newUniqueId}"
    Then within 5000ms the database has document "users/{newUniqueId}" with field "isAgeVerified" equal to true
    Then the database has document "users/{newUniqueId}" with field "cohort" equal to "adult"
    Then the database has 1 entries in "auditLog" matching {action: "age_verification.approve", targetId: "{newUniqueId}", adminId: 90000001}

  @blocker @android-emulator
  Scenario: Adam force-refreshes the JWT — adult features unlock in the UI
    Given Adam has just been approved to cohort=adult by Greta
    When Adam on Android kills and relaunches the app
    Then Adam's Android JWT custom claim "cohort" equals "adult"
    Then within 3000ms Adam's Android UI shows the element with tag "main_messagesTab"
    Then Adam's Android UI shows the element with tag "wallet_buyCoinsButton"

  @blocker @android-emulator
  Scenario: Adam claims his daily wallet reward — coins credit + reward animation
    Given Adam is verified adult with adult features unlocked
    When Adam on Android opens the "daily_reward" screen
    When Adam on Android taps "dailyReward_claimButton"
    Then within 3000ms the database has document "users/{newUniqueId}" with field "shyCoins" greater than 0
    Then Adam's Android UI shows the "+{coins}" reward animation

  @blocker @android-emulator @browser-chromium
  Scenario: Adam discovers + follows Alice — graph mirrors + Alice's Web counter ticks
    Given Adam is verified adult with adult features unlocked
    When Adam on Android opens the "discovery" screen
    When Adam on Android types "adult-power" into the search field
    Then within 3000ms Adam's Android UI shows Alice in the results with displayName "Alice (P-02 adult power)"
    When Adam on Android taps Alice's user card
    When Adam on Android taps "profile_followButton"
    Then within 3000ms the database has document "users/{newUniqueId}" with field "followingIds" containing 50000010
    Then within 3000ms the database has document "users/50000010" with field "followerIds" containing {newUniqueId}
    Then within 5000ms Alice's Web UI shows a +1 in the "Followers" count

  @blocker @android-emulator
  Scenario: Adam sends his first gift to Alice — coins debit, beans credit, both transactions + gift wall entry
    Given Adam is verified adult with adult features unlocked
    Given Adam has user doc with shyCoins=200
    When Adam on Android opens the "wallet" screen
    When Adam on Android taps "wallet_sendGiftButton"
    When Adam on Android selects gift "rose" and recipient "Alice"
    When Adam on Android taps "sendGift_confirmButton"
    Then within 3000ms the database has document "users/{newUniqueId}" with field "shyCoins" decreased by 10
    Then the database has document "users/50000010" with field "beans" increased by 5
    Then the database has 1 entries in "users/{newUniqueId}/transactions" matching {type: "GIFT_SENT", amount: -10}
    Then the database has 1 entries in "users/50000010/transactions" matching {type: "GIFT_RECEIVED", amount: 5}
    Then the database has 1 entries in "giftWalls/50000010/gifts" matching {giftId: "rose", senderId: {newUniqueId}}

  @blocker @browser-chromium
  Scenario: Alice's Web gift wall shows Adam's new rose gift with his displayName
    Given Adam has just sent Alice his first gift (a rose)
    When Alice on Web opens her "gift_wall" screen
    Then within 3000ms Alice's Web UI shows a "rose" gift from Adam
    Then Alice's Web UI shows Adam's displayName

  @android-emulator
  Scenario: Adam signs up + immediately tries to access adult features (must be gated)
    When Adam on Android signs up with DOB "2004-01-01" and accepts legal
    Then Adam's Android UI shows main tabs but PM tab is hidden
    When Adam on Android attempts to navigate to "/pm" via deep link
    Then Adam's Android UI shows "PMs are only available after age verification"
    Then no PM screen renders

  @android-emulator
  Scenario: Adam submits a too-large ID image — client-side rejection, no Firestore write
    Given Adam on Android is on the "age_verification" screen
    When Adam on Android picks a 15MB test image
    Then Adam's Android UI shows "Image too large"
    Then no submission doc is created in "ageVerificationSubmissions" for Adam

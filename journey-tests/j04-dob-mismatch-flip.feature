# j04 — Hayato, DOB mismatch — admin downgrades cohort to minor after ID review.
#
# Personas: P-06 Hayato (Android — primary), P-12 Greta (Web Admin — reviews + rejects),
#           P-19 Officia (server bot — sends age-down system PM)
#
# This is the most safety-critical journey: an adult-by-claim user whose ID shows they're
# actually a minor must be force-downgraded. Their adult-tier interactions (follows of
# adults, PMs, gifts) must collapse. Their token must invalidate. The system PM in their
# native locale must explain the change.

Feature: j04 — Hayato's DOB mismatch + cohort downgrade
  As an admin reviewing an age verification submission
  I want to reject + downgrade DOB + flip cohort to minor in one atomic action
  So that minors mis-claiming as adults can't keep adult features

  Background:
    Given the local stack is healthy
    Given the device locale is "ja"
    Given Hayato [P-06] is signed in on Android with cohort=adult (DOB=2007-01-01 in users doc)
    Given Hayato has followingIds=[50000010, 50000060] (two adult follows)
    Given Hayato has shyCoins=100 and isAgeVerified=false
    Given Hayato submitted an ageVerificationSubmission with status="PENDING" and an ID image showing DOB=2011-05-12
    Given Greta [P-12] is on Web Admin at "/admin#age-verification"

  # The original 37-step end-to-end scenario is split into 8 phase-focused
  # scenarios sharing the Background DOB-mismatch seed. Each scenario establishes
  # its precondition via setup-style `Given` so it can run in isolation. Full
  # journey coverage preserved across the downgrade pipeline + UI collapse.
  @blocker @android-physical
  Scenario: Hayato's initial state is adult with adult follows and an unverified age
    Then the database has document "users/50000030" with field "cohort" equal to "adult"
    Then the database has document "users/50000030" with field "followingIds" containing 50000010
    Then Hayato's Android UI shows the element with tag "main_messagesTab"

  @blocker @browser-chromium
  Scenario: Greta reviews Hayato's age-verification submission and sees the parsed DOB
    When Greta on Web Admin opens the age-verification tab
    Then within 3000ms Greta's Web Admin UI shows 1 row for "50000030" with status "PENDING"
    When Greta on Web Admin taps "review" on Hayato's submission
    Then Greta's Web Admin UI shows the ID image
    Then Greta's Web Admin UI shows the parsed DOB candidate "2011-05-12"

  @blocker @browser-chromium @cross-cohort
  Scenario: Greta's reject_and_dob_down atomically flips cohort + dob + audit log
    Given Greta has reviewed Hayato's age-verification submission
    When Greta on Web Admin taps "reject_and_dob_down" with reason "DOB on ID is 2011-05-12" and dobOverride="2011-05-12"
    Then within 5000ms the database has document "users/50000030" with field "cohort" equal to "minor"
    Then the database has document "users/50000030" with field "dateOfBirth" equal to 1305158400000
    Then the database has document "users/50000030" with field "isAgeVerified" equal to false
    Then the database has document "ageVerificationSubmissions/{subId}" with field "status" equal to "REJECTED"
    Then the database has 1 entries in "auditLog" matching {action: "age_verification.reject_and_dob_down", targetId: 50000030, adminId: 90000001}

  @blocker
  Scenario: Officia sends Hayato a Japanese-locale age-down PM
    Given Hayato has been downgraded to cohort=minor by Greta
    Then within 5000ms the database has 1 entries in "conversations" matching {participantIds: [1, 50000030]}
    Then the database has 1 entries in "messages" with the system PM key "age_seg_age_down_admin_pm" addressed to 50000030
    Then the PM body is the Japanese translation of the age_down template
    Then the PM is from Officia (uniqueId=1, userType=SHYTALK_OFFICIAL)

  @blocker @android-physical
  Scenario: Hayato's session is invalidated; refreshed JWT shows cohort=minor
    Given Hayato has been downgraded to cohort=minor by Greta
    Then within 5000ms the Firebase Auth session for Hayato has revokeRefreshTokens timestamp updated
    When Hayato on Android performs any authenticated API call
    Then the response has status 401 or signals "auth/user-token-expired"
    When Hayato on Android force-refreshes via securetoken endpoint
    Then Hayato's Android JWT custom claim "cohort" equals "minor"

  @blocker @android-physical
  Scenario: Hayato's relaunched app shows minor-cohort UX with the Officia notice
    Given Hayato has been downgraded to cohort=minor and has the Officia age-down PM in his inbox
    When Hayato on Android relaunches the app and signs in
    Then within 5000ms Hayato's Android UI does not show the element with tag "main_messagesTab"
    Then Hayato's Android UI does not show the element with tag "wallet_buyCoinsButton"
    Then Hayato's Android UI shows the in-app banner about the cohort change in Japanese
    Then Hayato's Android UI shows the new PM from Officia with the official badge

  @blocker @android-physical @cross-cohort
  Scenario: Stale adult follows are hidden from both sides (defence-in-depth — followingIds preserved for reversal)
    Given Hayato has been downgraded to cohort=minor with followingIds still containing 50000010 + 50000060
    When Hayato on Android opens the "following" screen
    Then Hayato's Android UI does not show Alice (P-02, adult)
    Then Hayato's Android UI does not show Theo (P-10, adult)
    Then Hayato's Android UI renders the "age_seg_user_unavailable" placeholder in both slots
    Then the database has document "users/50000030" with field "followingIds" still containing [50000010, 50000060]
    When Theo on Android opens his followers list
    Then within 5000ms Theo's Android UI does not show Hayato
    Then the database has document "users/50000060" with field "followerIds" still containing 50000030

  @blocker
  Scenario: Hayato's coin balance is preserved across the downgrade (minor cohort still has economy)
    Given Hayato has been downgraded to cohort=minor with his pre-downgrade shyCoins=100
    Then the database has document "users/50000030" with field "shyCoins" equal to 100

  @android-physical
  Scenario: Hayato in a voice room when the downgrade hits → ejected immediately
    Given Hayato is in voice room "r1" (an adult-cohort room) with mic open
    When Greta on Web Admin executes the age-down flow
    Then within 5000ms Hayato's Android UI is no longer in the voice room
    Then within 5000ms Hayato's LiveKit track for "r1" is disconnected
    Then the database does not have field "participantIds" containing 50000030 on any room

  @blocker
  Scenario: Officia system PM is unblockable (minor must still receive system PMs)
    Given Hayato received the age-down system PM from Officia
    When Hayato on Android attempts to block Officia (uniqueId=1) via /api/users/block
    Then the response status is 400
    Then the response body contains "Cannot block ShyTalk Official account"
    Then the database does not have document "users/50000030" with field "blockedIds" containing 1

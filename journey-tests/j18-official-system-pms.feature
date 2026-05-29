# j18 — Officia (SHYTALK_OFFICIAL) sends system PMs — age-up welcome, age-down notice, suspension notice, lesson-policy update.
#
# Personas: P-19 Officia (server-side actor — no device), P-01 Adam (Android — recipient
#           in age-up scenario), P-06 Hayato (Android — recipient in age-down), P-02 Alice (Web),
#           P-13 Layla (Web ar — locale rendering)
#
# The SHYTALK_OFFICIAL account is exempt from cohort gating, exempt from block, and is the
# only account that can send to a user the user has not opted into. This journey verifies
# every templated system PM renders correctly across locales + with the official badge +
# is unblockable.

Feature: j18 — Officia's system PMs
  As ShyTalk's official server-side messenger
  I want to deliver templated system PMs across cohort boundaries and across locales
  So that critical user-facing communications (cohort changes, suspensions, terms updates) reach everyone

  Background:
    Given the local stack is healthy
    Given Officia [P-19] exists with uniqueId=1, userType=SHYTALK_OFFICIAL, isOfficial=true, isUnblockable=true
    Given Adam [P-01] is signed in on Android with cohort=adult and locale=en
    Given Hayato [P-06] is signed in on Android with cohort=minor (post-j04 state) and locale=ja
    Given Alice [P-02] is signed in on Web Chromium with locale=en
    Given Layla [P-13] is signed in on Web Chromium with locale=ar

  @blocker @android-physical
  Scenario: Age-up welcome PM is sent in recipient's locale + has official badge
    Given Adam was just age-verified by admin (cohort flipped from minor to adult)
    When the post-approval webhook fires sendSystemPm with key="age_seg_age_up_welcome_pm" recipient=Adam
    Then within 5000ms the database has 1 entries in "conversations" matching {participantIds: [1, {adamId}]}
    Then within 5000ms the database has 1 entries in "messages" matching {senderId: 1, recipientId: {adamId}, key: "age_seg_age_up_welcome_pm"}
    Then the message body is the English translation of the age-up template
    Then within 5000ms Adam's Android UI shows a new PM thread with sender "ShyTalk Official"
    Then Adam's Android UI shows the official badge on the sender avatar
    Then Adam's Android UI shows the welcome PM body in English

  @blocker @android-physical @locale-cjk
  Scenario: Age-down PM is sent in Japanese (recipient locale) regardless of admin locale
    Given Hayato (locale=ja) is being downgraded by Greta (locale=en) via age verification
    When the rejection webhook fires sendSystemPm with key="age_seg_age_down_admin_pm" recipient=Hayato
    Then within 5000ms the database has 1 entries in "messages" matching {senderId: 1, recipientId: 50000030, key: "age_seg_age_down_admin_pm"}
    Then the message body is the Japanese translation of the age-down template
    Then within 5000ms Hayato's Android UI shows the system PM with Japanese body
    Then Hayato's Android UI shows the official badge

  @blocker @android-physical
  Scenario: System PMs are unblockable
    Given Adam received a system PM from Officia
    When Adam on Android opens Officia's profile from the PM
    Then Adam's Android UI shows "Official" badge and a disabled block button
    When POST /api/users/block with targetUniqueId=1 as Adam
    Then the response status is 400
    Then the response body contains "Cannot block ShyTalk Official account"
    Then the database does not have document "users/{adamId}" with field "blockedIds" containing 1

  @blocker @cross-cohort
  Scenario: Officia can send to a minor user (cohort gate exemption for SHYTALK_OFFICIAL)
    Given Marcus [P-04] (minor) is signed in on Android
    When the policy-update broadcast fires sendSystemPm with key="policy_update_v4" recipient=Marcus
    Then within 5000ms the database has 1 entries in "messages" matching {senderId: 1, recipientId: 60000010, key: "policy_update_v4"}
    Then within 5000ms Marcus's Android UI shows the PM with the official badge
    Then no audit row records "blocked" with reason "cohort_mismatch" for this delivery (Officia is exempt)

  @browser-chromium @locale-rtl
  Scenario: System PM renders RTL for Arabic recipient
    When the suspension-notice flow fires sendSystemPm with key="moderation_suspension_notice" recipient=Layla
    Then within 5000ms the database has 1 entries in "messages" matching {senderId: 1, recipientId: 50000070, key: "moderation_suspension_notice"}
    Then within 5000ms Layla's Web UI shows the PM with body in Arabic
    Then Layla's Web UI shows the PM thread with document direction "rtl"
    Then Layla's Web UI shows the official badge with Arabic label

  @browser-chromium
  Scenario: PM template with unknown key falls back to the English value, with telemetry warning
    Given the recipient is Adam (locale=en)
    When the test harness fires sendSystemPm with key="totally_made_up_key" recipient=Adam
    Then within 5000ms Adam's Android UI shows the PM (does not silently fail to deliver)
    Then the PM body contains the raw key OR an English placeholder
    Then the system logs a warning "Unknown system PM key: totally_made_up_key"

  @android-physical @perf-budget:5000
  Scenario: System PM fan-out to 1000 users completes within 5s
    Given 1000 users are tagged for a broadcast
    When the broadcast fires sendSystemPm with key="policy_update_v4"
    Then within 5000ms 1000 messages with senderId=1 are written across recipients' conversations
    Then no FCM dispatch fails (all 1000 succeed or have retry-pending state)

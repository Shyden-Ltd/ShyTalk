# j11 — Harassment moderation cycle — offensive PM → report → warn → re-offend → suspend → appeal → lift.
#
# Personas: P-08 Raul (Android — harasser), P-09 Nora (iOS Sim — victim/reporter),
#           P-12 Greta (Web Admin — moderator), P-19 Officia (system PM sender)
#
# This is the most complex multi-step moderation loop. It exercises every state transition:
# initial harassment, report submission, admin warning, ack, repeat offense, suspension with
# cascade, session invalidation, suspension screen rendering, appeal, admin lift, restoration.

Feature: j11 — Full harassment moderation lifecycle
  As a moderator handling a repeat-offender harassment case
  I want the warn → suspend → appeal → lift cycle to work end-to-end across platforms
  So that platform safety is enforced consistently and reversibly

  Background:
    Given the local stack is healthy
    Given Raul [P-08] is signed in on Android with cohort=adult
    Given Nora [P-09] is signed in on iOS Sim with cohort=adult
    Given Greta [P-12] is on Web Admin at "/admin#reports"
    Given Raul has a pre-existing direct conversation with Nora
    Given Raul has shyCoins=0 and beans=0 (irrelevant — moderation must not touch economy)

  # The original 56-step full moderation lifecycle is split into 15 phase-focused
  # scenarios sharing the Background pre-conversation state. Each later scenario
  # establishes the prior phase's outcome via setup-style `Given`. Coverage is
  # preserved across all three acts: first-offense → warn → ack;
  # re-offense → suspend → cascade; appeal → review → lift → restoration.

  # ────────── Act 1: First offense → warn ──────────

  @blocker @android-physical @ios-sim
  Scenario: Raul sends "offensive content #1" — message persisted, Nora's thread shows it
    When Raul on Android sends "offensive content #1" to Nora
    Then within 3000ms the database has 1 entries in "messages" matching {senderId: 50000050, body: "offensive content #1"}
    Then within 3000ms Nora's iOS Sim UI shows the message in the conversation thread

  @blocker @ios-sim
  Scenario: Nora reports the offensive message with reason "Harassment"
    Given Raul has sent Nora "offensive content #1"
    When Nora on iOS Sim long-presses the offensive message and taps "Report"
    When Nora on iOS Sim selects reason "Harassment" and confirms
    Then within 3000ms the database has 1 entries in "reports" matching {reporterId: 50000051, reportedId: 50000050, reason: "Harassment"}
    Then within 3000ms Nora's iOS Sim UI shows "Report submitted" toast

  @blocker @browser-chromium
  Scenario: Greta sees Nora's report appear in the admin reports queue
    Given Nora has just submitted a Harassment report against Raul
    When Greta on Web Admin refreshes the reports tab
    Then within 3000ms Greta's Web Admin UI shows the new report in the queue
    Then Greta's Web Admin UI shows reporter Nora + reportedId Raul + reason "Harassment"

  @blocker @browser-chromium
  Scenario: Greta issues a first-strike warning to Raul on Nora's report
    Given Nora's Harassment report against Raul is visible in the admin queue
    When Greta on Web Admin opens the report and taps "Warn Raul"
    When Greta on Web Admin confirms with reason "First-strike harassment"
    Then within 3000ms the database has document "users/50000050" with field "hasActiveWarning" equal to true
    Then the database has 1 entries in "auditLog" matching {action: "warn", targetId: 50000050, reportId: any}

  @blocker @ios-sim
  Scenario: Officia sends Nora a "moderation_action_taken" notice confirming the warning
    Given Greta has issued a warning to Raul on Nora's report
    Then within 5000ms the database has 1 entries in "messages" matching {senderId: 1, recipientId: 50000051, key: "moderation_action_taken"}
    Then within 5000ms Nora's iOS Sim UI shows the system PM from Officia "Action taken on your report"

  @blocker @android-physical
  Scenario: Raul's relaunched app shows the warning screen with the warning reason
    Given Raul has been issued a first-strike warning
    When Raul on Android kills and relaunches the app
    Then within 5000ms Raul's Android UI shows the warning screen with reason "First-strike harassment"
    Then Raul's Android UI does not show "main_roomsTab"

  @blocker @android-physical
  Scenario: Raul acknowledges the warning — flag clears, rooms tab returns
    Given Raul is on the warning screen
    When Raul on Android taps "warning_acknowledgeButton"
    Then within 3000ms the database has document "users/50000050" with field "hasActiveWarning" equal to false
    Then within 3000ms Raul's Android UI shows the element with tag "main_roomsTab"

  # ────────── Act 2: Re-offense → suspend ──────────

  @blocker @android-physical @ios-sim
  Scenario: Raul sends "offensive content #2" — Nora reports a second time
    Given Raul has acknowledged his first-strike warning
    When Raul on Android sends "offensive content #2" to Nora
    Then within 3000ms Nora's iOS Sim UI shows the second offensive message
    When Nora on iOS Sim reports it for "Harassment"
    Then within 3000ms the database has 2 entries in "reports" with reportedId=50000050

  @blocker @browser-chromium
  Scenario: Greta escalates to a 3-day suspension on Raul's second report
    Given there are 2 Harassment reports against Raul
    Given Raul is currently in a voice room "r-test" with mic open
    When Greta on Web Admin opens the new report and taps "Suspend for 3 days"
    When Greta on Web Admin confirms with reason "Repeat harassment"

  @blocker
  Scenario: Raul's user doc records the 3-day suspension with reason + audit row
    Given Greta has issued a 3-day suspension to Raul
    Then within 5000ms the database has document "users/50000050" with field "suspendedUntil" approximately equal to now + 3 days
    Then the database has document "users/50000050" with field "suspensionReason" equal to "Repeat harassment"
    Then the database has 1 entries in "auditLog" matching {action: "suspend", targetId: 50000050, durationDays: 3}

  @blocker @android-physical
  Scenario: Suspension cascade — Raul evicted from room, session revoked, LiveKit disconnected
    Given Raul has just been suspended for 3 days while seated in "r-test"
    Then within 5000ms the database does not have field "participantIds" containing 50000050 on any room
    Then within 5000ms Raul's Firebase Auth refreshTokens are revoked
    Then within 5000ms Raul's LiveKit track for "r-test" is disconnected

  @blocker @android-physical
  Scenario: Raul's Android shows the suspension screen with reason, end date, and appeal button
    Given Raul has been suspended for 3 days for "Repeat harassment"
    Then within 5000ms Raul's Android UI shows the suspension screen
    Then Raul's Android UI shows reason "Repeat harassment"
    Then Raul's Android UI shows an end date 3 days from now
    Then Raul's Android UI shows the appeal button

  @blocker
  Scenario: Suspended Raul cannot create conversations or LiveKit tokens (403 on both)
    Given Raul is in a suspendedUntil state 3 days from now
    When POST /api/conversations with body as Raul
    Then the response status is 403
    When POST /api/livekit/token as Raul
    Then the response status is 403

  # ────────── Act 3: Appeal → lift → restoration ──────────

  @blocker @android-physical
  Scenario: Raul submits an appeal from the suspension screen
    Given Raul is on the suspension screen with the appeal button visible
    When Raul on Android types "I think this was a misunderstanding" into the appeal field
    When Raul on Android taps "suspension_submitAppealButton"
    Then within 3000ms the database has 1 entries in "suspensionAppeals" matching {userId: 50000050, text: "I think this was a misunderstanding"}
    Then Raul's Android UI shows "Appeal submitted" + appeal status "pending"

  @blocker @browser-chromium
  Scenario: Greta reviews and lifts Raul's suspension via the appeals tab
    Given Raul has submitted a suspension appeal
    When Greta on Web Admin opens the suspension-appeals tab
    Then Greta's Web Admin UI shows Raul's appeal with the text
    When Greta on Web Admin taps "Lift suspension" with reason "Appeal accepted — first repeat, leniency"
    Then within 5000ms the database has document "users/50000050" with field "suspendedUntil" equal to null
    Then the database has 1 entries in "auditLog" matching {action: "unsuspend", targetId: 50000050}

  @blocker @android-physical @ios-sim
  Scenario: Raul force-refreshes and regains access; Officia confirms restoration to Nora
    Given Greta has lifted Raul's suspension
    When Raul on Android force-refreshes the JWT
    Then within 5000ms Raul's Android UI shows the element with tag "main_roomsTab"
    Then Raul's Android UI no longer shows the suspension screen
    Then within 5000ms the database has 1 entries in "messages" matching {senderId: 1, recipientId: 50000051, key: "moderation_user_restored"}

  @android-physical
  Scenario: Raul attempts to send a message while suspended — 403 + clear UI
    Given Raul is suspended until 2 days from now
    When Raul on Android opens his conversation with Nora
    Then Raul's Android UI shows "You are suspended — appeal to continue" banner
    Then Raul's Android UI disables the message input
    When Raul on Android attempts POST /api/messages
    Then the response status is 403

  @ios-sim
  Scenario: Nora blocks Raul mid-cycle — Raul cannot find her in discovery
    Given Raul has been warned but not suspended
    When Nora on iOS Sim opens Raul's profile and taps "Block"
    Then within 3000ms the database has document "users/50000051" with field "blockedIds" containing 50000050
    When Raul on Android searches "Nora" in discovery
    Then Raul's Android UI shows "No results found"
    When Raul on Android attempts to open the existing conversation with Nora
    Then Raul's Android UI shows "User unavailable"

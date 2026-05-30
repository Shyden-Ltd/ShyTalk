# j10 — Mid-voice-room admin warning — mic muted + warning screen + acknowledge.
#
# Personas: P-10 Theo (Android — seated host with mic open), P-11 Ines (iOS Sim — joiner),
#           P-12 Greta (Web Admin — issues the warning)
#
# This journey covers the exact scenario the user called out: a seated participant has mic
# open in a voice room when an admin warns them. The mic must auto-mute, the warning screen
# must appear, the joiner viewing the room must see the seat change, and the participant
# must acknowledge before continuing. Critical OSA moderation propagation test.

Feature: j10 — Admin warning lands during an active voice room
  As an admin warning a user mid-room
  I want the warning to mute their mic, show the warning screen, and exit the room
  So that moderation propagates instantly across LiveKit + Firestore + UI

  Background:
    Given the local stack is healthy
    Given the LiveKit Docker container is running
    Given Theo [P-10] is signed in on Android and hosting voice room "r1" with mic open + seated
    Given Ines [P-11] is signed in on iOS Sim and joined to "r1" as a non-seated participant
    Given Greta [P-12] is on Web Admin at "/admin#users"

  # The original 38-step "Greta warns Theo mid-room — mic mutes, warning screen,
  # acknowledge to continue" scenario is split into 9 phase-focused scenarios
  # sharing the Background seated-host state. Each later scenario sets up the
  # prior phase's outcome via setup-style `Given`. Full mid-room moderation
  # cascade coverage preserved.
  @blocker @android-physical
  Scenario: Pre-state — Theo hosts "r1" with mic open and no active warning
    Then the database has document "rooms/r1" with field "state" equal to "OPEN"
    Then the database has document "rooms/r1" with field "seats[0]" containing {userId: 50000060, muted: false}
    Then Theo's Android UI shows the room screen with mic-on indicator
    Then Theo's Android LiveKit publish track for room "r1" is enabled
    Then the database has document "users/50000060" with field "hasActiveWarning" equal to false

  @blocker @browser-chromium
  Scenario: Greta issues a warning to Theo from the admin user-search panel
    Given Theo is mid-room with no active warning
    When Greta on Web Admin searches "50000060"
    When Greta on Web Admin taps "Issue warning" with reason "Inappropriate language in voice room"
    When Greta on Web Admin confirms the warning dialog

  @blocker
  Scenario: User doc records the warning state with reason + admin id + audit row
    Given Greta has just submitted a warning for Theo
    Then within 3000ms the database has document "users/50000060" with field "hasActiveWarning" equal to true
    Then the database has document "users/50000060" with field "warningReason" equal to "Inappropriate language in voice room"
    Then the database has 1 entries in "auditLog" matching {action: "warn", targetId: 50000060, adminId: 90000001}

  @blocker @android-physical
  Scenario: Theo's mic is auto-muted server-side and LiveKit publish is disabled
    Given Theo has hasActiveWarning=true while seated in room "r1"
    Then within 5000ms the database has document "rooms/r1" with field "seats[0].muted" equal to true
    Then within 5000ms Theo's LiveKit publish permission for room "r1" is disabled

  @blocker @android-physical
  Scenario: Theo's Android UI navigates to the warning screen with reason + duck + acknowledge
    Given Theo has hasActiveWarning=true, warningReason="Inappropriate language in voice room"
    Then within 5000ms Theo's Android UI navigates to the warning screen
    Then Theo's Android UI shows the warning reason "Inappropriate language in voice room"
    Then Theo's Android UI shows the police duck image
    Then Theo's Android UI does not show the voice room UI
    Then Theo's Android UI does not show the element with tag "main_roomsTab"
    Then Theo's Android UI shows the element with tag "warning_acknowledgeButton"

  @ios-sim
  Scenario: Ines's iOS Sim sees Theo's seat with mic-off and may receive the room-closed cascade
    Given Theo's mic has been server-muted by the warning while Ines is in "r1"
    Then within 5000ms Ines's iOS Sim UI shows Theo's seat with mic-off indicator
    Then within 6000ms either Ines's iOS Sim UI is still in the room with host muted
    Then OR within 6000ms Ines's iOS Sim UI shows a "Room closed by host warning" toast and navigates back to "/rooms"

  @blocker @android-physical
  Scenario: Theo cannot bypass the warning — back-press and relaunch both keep him on the warning screen
    Given Theo is on the warning screen with hasActiveWarning=true
    When Theo on Android attempts to navigate via the back button
    Then Theo's Android UI does not navigate away
    Then Theo's Android UI still shows the warning screen
    When Theo on Android attempts to kill and relaunch the app
    Then within 5000ms Theo's Android UI shows the warning screen again on next launch

  @blocker @android-physical
  Scenario: Theo acknowledges — warning cleared, ack timestamp recorded, back at rooms tab
    Given Theo is on the warning screen with hasActiveWarning=true
    When Theo on Android taps "warning_acknowledgeButton"
    Then within 3000ms the database has document "users/50000060" with field "hasActiveWarning" equal to false
    Then the database has document "users/50000060" with field "warningAcknowledgedAt" greater than 0
    Then within 3000ms Theo's Android UI shows the element with tag "main_roomsTab"
    Then Theo's Android UI does NOT navigate back into room "r1" automatically (he must rejoin)

  @android-physical
  Scenario: Theo rejoins room "r1" — seat is empty and his mic defaults to muted
    Given Theo has acknowledged the warning
    Given the room "r1" is still OPEN (was not auto-closed)
    When Theo on Android taps the room "r1" card
    Then within 5000ms the database has document "rooms/r1" with field "participantIds" containing 50000060
    Then within 3000ms Theo's Android UI shows the room screen
    Then Theo's Android UI shows his seat as available (he is NOT auto-seated as host on rejoin — must request seat)
    Then Theo's Android UI mic indicator shows "muted"

  @blocker @android-physical
  Scenario: Warning while listening (not seated) — banner instead of screen
    Given Theo is in voice room "r2" as a NON-seated listener
    When Greta on Web Admin issues a warning to Theo
    Then within 5000ms Theo's Android UI shows the warning banner overlay on top of the room
    Then within 5000ms Theo's Android UI is still in the room but unable to interact
    Then within 5000ms Theo's Android UI shows the acknowledge button in the banner
    When Theo on Android taps acknowledge
    Then within 3000ms Theo's Android UI continues normally in the room

  @blocker @ios-sim
  Scenario: Warning with seated minor in a minor-cohort room — same cascade
    Given Marcus [P-04] is on iOS Sim seated in a minor-cohort room with mic open
    When Greta on Web Admin issues a warning to Marcus
    Then within 5000ms Marcus's iOS Sim UI shows the warning screen
    Then within 5000ms the database has document "minor-room/{roomId}" with field "seats[*].userId == 60000010" entry muted=true
    Then within 5000ms Marcus's LiveKit publish for that room is disabled

# j09 — Theo hosts a voice room — create → join (multi-platform) → seat queue → kick → close.
#
# Personas: P-10 Theo (Android — host), P-02 Alice (Web Chromium — joiner), P-11 Ines (iOS Sim — joiner)
#
# Voice rooms are the highest-complexity feature: LiveKit token issuance, seat state in
# Firestore, audio publishing on the platform-specific bridge, real-time UI for all
# participants. This journey threads a full session with three platforms participating.

Feature: j09 — Theo hosts a public voice room
  As a host with two cross-platform joiners
  I want create → join → seat → kick → close to work end-to-end with audio
  So that the LiveKit ↔ Firestore ↔ UI loop is correct on every platform

  Background:
    Given the local stack is healthy
    Given the LiveKit Docker container is running on ws://localhost:7880
    Given Theo [P-10] is signed in on Android physical at the "rooms" tab
    Given Alice [P-02] is signed in on Web Chromium at the "rooms" tab
    Given Ines [P-11] is signed in on iOS Sim at the "rooms" tab

  # The original 47-step "Theo creates a room, both joiners arrive, seat queue
  # + kick works" scenario is split into 10 phase-focused scenarios sharing the
  # Background sign-in state. Each later scenario sets up the prior phase's
  # outcome via setup-style `Given`. Full voice-room lifecycle coverage preserved
  # (create → multi-platform join → seat queue → kick → close) with the @manual
  # audio check now its own scenario.
  @blocker @android-physical
  Scenario: Theo creates a public voice room with himself in the host seat
    When Theo on Android taps "main_createRoomFab"
    When Theo on Android types title "Theo's Test Room" and chooses public visibility
    When Theo on Android taps "createRoom_confirmButton"
    Then within 5000ms the database has 1 entries in "rooms" matching {hostId: 50000060, title: "Theo's Test Room", state: "OPEN", visibility: "public"}
    Then Theo on Android receives a LiveKit token in response from POST /api/livekit/token
    Then within 3000ms Theo's Android UI navigates to the room screen with host seat occupied
    Then Theo's Android UI shows the seat grid with 1 of 8 seats occupied (by himself)

  @blocker @android-physical @browser-chromium
  Scenario: Alice (Web) discovers and joins Theo's public room
    Given Theo's public room "Theo's Test Room" is OPEN
    When Alice on Web refreshes the rooms list
    Then within 3000ms Alice's Web UI shows "Theo's Test Room" in the public rooms list
    When Alice on Web taps the room card
    Then within 5000ms the database has document "rooms/{roomId}" with field "participantIds" containing 50000010
    Then Alice on Web receives a LiveKit token
    Then within 3000ms Alice's Web UI navigates to the room screen as a non-seated participant
    Then within 3000ms Theo's Android UI shows Alice in the participants list

  @blocker @android-physical @browser-chromium @ios-sim
  Scenario: Ines (iOS Sim) joins the room — prior participants see her appear
    Given Theo's room "Theo's Test Room" has Alice joined as a participant
    When Ines on iOS Sim taps the same room
    Then within 5000ms the database has document "rooms/{roomId}" with field "participantIds" containing 50000061
    Then within 3000ms Theo's Android UI shows Ines in the participants list
    Then within 3000ms Alice's Web UI also shows Ines in the participants list

  @blocker @android-physical @ios-sim
  Scenario: Ines requests a seat — Theo gets a seat-request notification
    Given Ines is a non-seated participant in Theo's room
    When Ines on iOS Sim taps "room_requestSeatButton"
    Then within 3000ms the database has 1 entries in "rooms/{roomId}/seatRequests" matching {userId: 50000061, status: "PENDING"}
    Then within 3000ms Theo's Android UI shows a seat-request notification with "Ines" + approve/deny

  @blocker @android-physical @browser-chromium @ios-sim
  Scenario: Theo approves Ines's seat — seat occupied + LiveKit publish enabled
    Given Ines has a PENDING seat request in Theo's room
    When Theo on Android taps approve on Ines's seat request
    Then within 3000ms the database has document "rooms/{roomId}" with field "seats[1].userId" equal to 50000061
    Then within 3000ms Ines's iOS Sim UI seat indicator transitions from "request pending" to "seated"
    Then within 3000ms Alice's Web UI shows Ines in seat 2 of the seat grid
    Then within 3000ms Ines's LiveKit track for room {roomId} has publish permission enabled

  @blocker @android-physical @ios-sim
  Scenario: Ines unmutes her mic — Firestore + both UIs reflect the open mic
    Given Ines is seated in Theo's room with publish permission
    When Ines on iOS Sim taps "room_micToggleButton"
    Then within 2000ms the database has document "rooms/{roomId}" with field "seats[1].muted" equal to false
    Then within 2000ms Ines's iOS Sim UI shows mic icon as "open"
    Then within 3000ms Theo's Android UI shows Ines's seat with mic-on indicator

  @manual @android-physical @ios-sim
  Scenario: Audio — Ines's voice is audible on Theo's Android device with a real mic
    Given Ines is seated and unmuted in Theo's room
    Then the tester hears Ines's audio on Theo's Android device (real microphone)

  @blocker @android-physical @ios-sim
  Scenario: Theo kicks Ines — participant removed, kickedIds entry, "you were kicked" UI
    Given Ines is seated and unmuted in Theo's room
    When Theo on Android long-presses Ines's seat
    When Theo on Android taps "Kick"
    Then within 3000ms the database has document "rooms/{roomId}" with field "participantIds" not containing 50000061
    Then within 3000ms the database has 1 entries in "rooms/{roomId}/kickedIds" matching {userId: 50000061}
    Then within 5000ms Ines's iOS Sim UI navigates back to the "rooms" tab
    Then within 5000ms Ines's LiveKit track for room {roomId} is disconnected
    Then Ines's iOS Sim UI shows "You were kicked from this room"

  @blocker @ios-sim
  Scenario: Ines cannot rejoin Theo's room — 403 + kicked banner remains
    Given Ines has been kicked from Theo's room
    When Ines on iOS Sim taps the same room again
    Then the response status is 403
    Then Ines's iOS Sim UI shows "You were kicked from this room"

  @blocker @android-physical @browser-chromium
  Scenario: Theo closes the room — state=CLOSED, Alice's UI shows the summary, tracks disconnect
    Given Theo's room "Theo's Test Room" is OPEN with Alice as a participant
    When Theo on Android taps the "room_endRoomButton"
    When Theo on Android confirms in the dialog
    Then within 5000ms the database has document "rooms/{roomId}" with field "state" equal to "CLOSED"
    Then within 5000ms Alice's Web UI navigates back to the "rooms" tab
    Then within 5000ms Alice's Web UI shows the room-closed summary panel
    Then Alice's LiveKit track for room {roomId} is disconnected

  @android-physical @browser-chromium @cross-cohort
  Scenario: Same-cohort gate on join — minor cannot join an adult host's room
    Given Theo created a public adult-cohort room
    When Marcus on Android taps the room card
    Then the response status from /api/livekit/token is 404
    Then Marcus's Android UI shows the "rooms" tab with no navigation to the room screen
    Then the database has document "rooms/{roomId}" with field "participantIds" not containing 60000010

  @android-physical
  Scenario: Host disconnects unexpectedly — room auto-closes after grace period
    Given Theo created a room and has 2 joiners
    When Theo's Android network drops for 30 seconds
    Then within 30000ms the database has document "rooms/{roomId}" with field "state" equal to "CLOSED"
    Then each joiner's UI navigates back to the rooms tab with "Host disconnected" toast

  # Fill-2 — PR #667 — LiveKit token issued to a room participant carries the
  # cohort claim. Defence-in-depth: even if the join-gate ever regresses on the
  # API side, the LiveKit server can refuse a token whose claim doesn't match
  # the room's cohort tag.
  @regression @cross-cohort osa17-pr7-livekit-token-cohort-claim
  Scenario: LiveKit access token contains cohort claim matching the room
    Given Theo on Android created an adult-cohort room "ra1"
    Given Marcus [P-04] is signed in on Android
    Given no prior segregationEvents exist between "60000010" and "ra1"
    When Alice on Web POSTs /api/livekit/token with roomName="ra1"
    Then the response status is 200
    Then the response body has field "token" of type "string"
    Then the decoded JWT payload has field "metadata.cohort" equal to "adult"
    Then the decoded JWT payload has field "video.room" equal to "ra1"
    When Marcus on Android POSTs /api/livekit/token with roomName="ra1"
    Then the response status is 404
    Then the response body does not include a token
    Then the database has 1 entries in "segregationEvents" matching {action: "blocked", sourceUniqueId: "60000010", targetUniqueId: "ra1"}

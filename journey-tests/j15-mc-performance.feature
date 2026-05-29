# j15 — Selma, MC_SINGER — singing performance with live gifts during the room.
#
# Personas: P-15 Selma (Android physical with real mic — host), P-02 Alice (Web — fan tipping),
#           P-10 Theo (Android — second fan), P-12 Greta (Web Admin — verifies earnings)
#
# Selma's userType is `MC_SINGER` which (per current code) unlocks her on the SHYTALK_OFFICIAL
# discovery rail, gives her a tier badge, and her performance rooms get gift animations.
# This journey exercises the full performer loop: open room → fans join → gifts flow during
# performance → beans accrue → room closes → earnings tally → leaderboard reflects.

Feature: j15 — Selma's singing room with live gifts
  As an MC_SINGER hosting a singing performance
  I want fans to tip me with gifts during the performance and see real-time animations
  So that the performer-tier monetization loop works end-to-end

  Background:
    Given the local stack is healthy
    Given Selma [P-15] is signed in on Android physical with userType=MC_SINGER, beans=10000
    Given Alice [P-02] is signed in on Web Chromium with shyCoins=5000
    Given Theo [P-10] is signed in on Android with shyCoins=1500
    Given Greta [P-12] is on Web Admin
    Given the gifts "rose" (10 coins / 5 beans), "crown" (500 coins / 250 beans), "diamond" (1000 coins / 500 beans) exist

  # The original "Selma opens a singing room, fans join + tip, room closes,
  # earnings tally" scenario was 43 steps. Split into 9 phase-focused scenarios
  # sharing the Background. Each later scenario sets up its preconditions via
  # setup-style `Given` steps so it can run in isolation. Full journey coverage
  # preserved; the @manual audio check is now its own scenario.
  @blocker @android-physical
  Scenario: Selma opens a "Singing" template room with the "MC Singer" badge on the host seat
    When Selma on Android opens the "rooms" tab
    When Selma on Android taps "main_createRoomFab"
    When Selma on Android picks template "Singing" and title "Selma's Saturday Sing-along"
    When Selma on Android taps "createRoom_confirmButton"
    Then within 5000ms the database has 1 entries in "rooms" matching {hostId: 50000080, title: "Selma's Saturday Sing-along", template: "Singing", state: "OPEN"}
    Then Selma's Android UI shows the room screen with host seat occupied + "MC Singer" badge

  @android-physical
  Scenario: Selma's open room surfaces on Theo's "Following" rail with the tier badge
    Given Selma's room "Selma's Saturday Sing-along" is OPEN
    When Theo on Android refreshes the "rooms" tab
    Then within 5000ms Theo's Android UI shows Selma's room in the "Following" rail
    Then Theo's Android UI shows the "MC Singer" tier badge on the room card

  @android-physical @browser-chromium
  Scenario: Alice (Web) and Theo (Android) join Selma's room — participants list updates
    Given Selma's room "Selma's Saturday Sing-along" is OPEN
    When Alice on Web taps Selma's room
    When Theo on Android taps Selma's room
    Then within 5000ms the database has document "rooms/{roomId}" with field "participantIds" containing [50000010, 50000060]
    Then within 3000ms Selma's Android UI shows the participants list with Alice + Theo

  @manual @android-physical @browser-chromium
  Scenario: Audio — Selma's voice is audible on fan devices during the performance
    Given Selma's mic is already open on the seated host slot
    Given Alice and Theo have joined Selma's room
    Then the tester hears Selma's voice on Alice's Web speakers AND Theo's Android speakers

  @android-physical @browser-chromium
  Scenario: Alice sends a rose mid-performance — coins debit, beans credit, animation on all 3 UIs
    Given Alice and Theo are participants in Selma's room
    When Alice on Web taps the gift icon in the room
    When Alice on Web selects "rose" and recipient "Selma"
    When Alice on Web confirms
    Then within 3000ms the database has document "users/50000010" with field "shyCoins" decreased by 10
    Then the database has document "users/50000080" with field "beans" increased by 5
    Then the database has 1 entries in "giftWalls/50000080/gifts" matching {giftId: "rose", senderId: 50000010, contextRoomId: "{roomId}"}
    Then within 3000ms Selma's Android UI shows the rose gift animation overlay with sender "Alice"
    Then within 3000ms Alice's Web UI shows the rose gift animation
    Then within 3000ms Theo's Android UI shows the rose gift animation

  @android-physical @browser-chromium
  Scenario: Theo's crown + Alice's diamond escalations — beans accrue, tier-appropriate animations play
    Given Alice has already tipped Selma a rose; all three participants are in the room
    When Theo on Android sends "crown" to Selma
    Then within 3000ms the database has document "users/50000080" with field "beans" increased by another 250
    Then within 3000ms all 3 participants' UIs show the crown animation (more elaborate than rose)
    When Alice on Web sends "diamond" to Selma
    Then within 3000ms the database has document "users/50000010" with field "shyCoins" equal to (5000 - 10 - 1000)
    Then the database has document "users/50000080" with field "beans" increased by 500
    Then within 3000ms Selma's Android UI shows the diamond animation with celebratory effect

  @android-physical
  Scenario: Real-time top-contributor banner in the room — Alice tops the list after her diamond
    Given Alice (1010 coins) tops Theo (500 coins) in this-room contributions
    Then within 3000ms Selma's Android UI shows "Top contributor: Alice" banner

  @android-physical
  Scenario: Selma closes the room — summary panel + global leaderboard reflect 755 beans
    Given Selma's room has received 755 beans (rose + crown + diamond) from this session
    When Selma on Android taps "room_endRoomButton"
    When Selma on Android confirms
    Then within 5000ms the database has document "rooms/{roomId}" with field "state" equal to "CLOSED"
    Then within 5000ms Selma's Android UI shows the room-closed summary panel
    Then Selma's Android UI shows total beans earned this session = (5 + 250 + 500) = 755
    Then Selma's Android UI shows the list of contributors with amounts
    When Selma on Android opens the "leaderboard" screen
    Then within 5000ms Selma's Android UI shows her rank in the MC_SINGER leaderboard
    Then the response from /api/economy/leaderboards?segment=mc-singer includes Selma

  @browser-chromium
  Scenario: Greta (admin) sees this room's gift volume in the per-room economy report
    Given Selma's session has been recorded with 755 beans earned
    When Greta on Web Admin opens the economy stats
    Then within 5000ms Greta's Web Admin UI shows the gift volume from this room in the per-room report

  @android-physical
  Scenario: Selma's room is auto-featured on the home tab for her tier
    Given Selma's room "Selma's Saturday Sing-along" is OPEN
    When Adam [P-01] (a non-follower) opens the "home" tab
    Then within 3000ms Adam's Android UI shows Selma's room in the "Featured MC_SINGER rooms" rail
    Then the rail card shows the "MC Singer" badge

  @android-physical @cross-cohort
  Scenario: Selma is adult — her singing room does NOT appear to minor users
    Given Marcus [P-04] (minor) opens the "home" tab
    When Marcus on Android refreshes the rooms list
    Then Marcus's Android UI does not show Selma's room
    Then the response from /api/rooms/featured has cohort="minor" in every row

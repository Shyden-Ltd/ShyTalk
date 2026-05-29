# j16 — Tariq, MC_EVENT_HOST (team leader) — schedules a multi-singer event with his roster.
#
# Personas: P-16 Tariq (Web for scheduling + Android for hosting), P-15 Selma (Android — roster MC),
#           P-02 Alice (Web — audience), P-10 Theo (Android — audience)
#
# An event host runs scheduled events with multiple MCs cycling through performances.
# This journey exercises: event scheduling, roster invite, audience join, seat rotation,
# event-level gift summary, payout split (if applicable), and event close.

Feature: j16 — Tariq's multi-singer event
  As an MC_EVENT_HOST running a roster of MCs in a scheduled event
  I want roster invite + seat rotation + event-level gift summary to work
  So that team-leader monetization is correctly attributed across multiple performers

  Background:
    Given the local stack is healthy
    Given Tariq [P-16] is signed in on Web Chromium with userType=MC_EVENT_HOST
    Given Tariq is also signed in on Android (same Firebase identity) for hosting
    Given Tariq's user doc has teamRoster=[50000080] (Selma is on his roster)
    Given Selma [P-15] is signed in on Android with userType=MC_SINGER
    Given Alice [P-02] is signed in on Web Chromium
    Given Theo [P-10] is signed in on Android

  # The original "Tariq schedules an event, Selma performs, audience tips, event
  # closes with summary" scenario was 40 steps. Split into 9 phase-focused
  # scenarios that share the Background. Each later scenario sets up the prior
  # phase's outcome via a setup-style Given so it runs in isolation. Full
  # journey coverage preserved.
  @browser-chromium @android-physical
  Scenario: Tariq schedules a Saturday Showcase, Selma is invited and accepts
    When Tariq on Web opens the "event-host" panel from his profile
    When Tariq on Web taps "schedule_newEventButton"
    When Tariq on Web fills in: title "Saturday Showcase", startsAt "now + 5 min", durationMin 60, roster [Selma]
    When Tariq on Web taps "scheduleEvent_confirmButton"
    Then within 5000ms the database has 1 entries in "events" matching {hostId: 50000081, title: "Saturday Showcase", roster: [50000080]}
    Then within 3000ms Selma's Android UI shows an in-app banner "You are scheduled in Tariq's event"
    Then within 3000ms the database has 1 entries in "users/50000080/eventInvites" matching {eventId: any, status: "PENDING"}
    When Selma on Android taps "Accept" on the event invite
    Then within 3000ms the database has document "users/50000080/eventInvites/{eventId}" with field "status" equal to "ACCEPTED"

  @android-physical
  Scenario: Tariq starts the event at startsAt and opens the event room with the roster panel
    Given Tariq has a scheduled event "Saturday Showcase" with Selma accepted on the roster
    Given the scheduled startsAt has been reached
    When Tariq on Android taps "Start event" on his event-host home
    Then within 5000ms the database has document "events/{eventId}" with field "state" equal to "LIVE"
    Then within 5000ms the database has 1 entries in "rooms" matching {hostId: 50000081, eventId: "{eventId}", state: "OPEN"}
    Then within 3000ms Tariq's Android UI shows the event room screen
    Then Tariq's Android UI shows the roster panel with Selma listed as "waiting"

  @android-physical @browser-chromium
  Scenario: Roster MC + audience fill the LIVE event room
    Given Tariq's "Saturday Showcase" event room is OPEN
    When Selma on Android taps the event-room link from the invite banner
    Then within 5000ms the database has document "rooms/{eventRoomId}" with field "rosterParticipants" containing 50000080
    When Alice on Web and Theo on Android both join the event room
    Then within 5000ms the database has document "rooms/{eventRoomId}" with field "participantIds" containing [50000010, 50000060]

  @android-physical @browser-chromium
  Scenario: Tariq promotes Selma from the roster to a performer seat
    Given Tariq's event room has Selma as a roster participant and Alice + Theo as audience
    When Tariq on Android taps "Promote Selma" in the roster panel
    Then within 3000ms the database has document "rooms/{eventRoomId}" with field "seats[1].userId" equal to 50000080
    Then within 3000ms Selma's Android UI mic indicator unlocks (publish permission)
    Then within 3000ms Alice's Web UI shows Selma's seat occupied

  @manual @android-physical @browser-chromium
  Scenario: Audio — Selma's performance is audible on the audience devices
    Given Selma is seated as a performer in Tariq's event room
    Then the tester hears Selma's voice on Alice's Web speakers

  @android-physical @browser-chromium
  Scenario: Audience tips Selma — beans split + event-level gift ledger gets two entries
    Given Selma is seated as a performer in Tariq's event room
    When Alice on Web sends "crown" (500 coins) to Selma
    When Theo on Android sends "rose" (10 coins) to Selma
    Then within 3000ms the database has document "users/50000080" with field "beans" increased by 255
    Then within 3000ms the database has 2 entries in "events/{eventId}/giftLedger" matching {senderId: any, recipientId: 50000080}

  @android-physical @browser-chromium
  Scenario: Tariq's event-host UI shows the real-time event-level gift summary
    Given Alice + Theo have tipped Selma 510 coins total in Tariq's event
    Then within 3000ms Tariq's Android UI shows event-level totals: 2 gifts, 510 coins, 255 beans, top contributor Alice
    Then Tariq's Web UI (paired session) also shows the same totals

  @android-physical
  Scenario: Tariq rotates the roster — demotes Selma, the performer seat is empty
    Given Selma is the seated performer in Tariq's event room
    When Tariq on Android taps "Demote Selma"
    Then within 3000ms the database has document "rooms/{eventRoomId}" with field "seats[1]" empty
    Then within 3000ms Selma's Android UI shows seat as not-seated

  @android-physical @browser-chromium
  Scenario: Tariq closes the event — all four UIs see the appropriate closing summary
    Given Tariq's event "Saturday Showcase" is LIVE with Alice + Theo as audience and Selma having performed
    When Tariq on Android taps "End event"
    Then within 5000ms the database has document "events/{eventId}" with field "state" equal to "CLOSED"
    Then within 5000ms the database has document "rooms/{eventRoomId}" with field "state" equal to "CLOSED"
    Then within 5000ms Tariq's Android UI shows the event summary panel: total gifts, total beans, per-MC breakdown
    Then within 5000ms Selma's Android UI shows her individual earnings for this event (255 beans)
    Then within 5000ms Alice's Web UI shows the event-closed summary screen
    Then within 5000ms Theo's Android UI shows the event-closed summary screen

  @browser-chromium @cross-cohort
  Scenario: Tariq (adult) cannot add a minor MC to his roster
    Given Marcus [P-04] is a minor with userType=MC_SINGER (hypothetical)
    When Tariq on Web attempts to add Marcus to his roster via /api/events/roster/add
    Then the response status is 404
    Then Tariq's Web UI shows "User not found"
    Then the database has 1 entries in "segregationEvents" matching {action: "blocked"}

  @android-physical
  Scenario: Selma declines the event invite — Tariq sees the decline
    Given Tariq scheduled an event including Selma
    When Selma on Android taps "Decline" on the event invite
    Then within 3000ms the database has document "users/50000080/eventInvites/{eventId}" with field "status" equal to "DECLINED"
    Then within 5000ms Tariq's Web UI shows Selma's status as "Declined" in the event roster panel

# j17 — Bao (TEACHER) runs a language-exchange class — Yuki (student) joins, learns, tips.
#
# Personas: P-17 Bao (Web Chromium primary — teaching dashboard, Android parity for hosting),
#           P-18 Yuki (iOS Sim — student), P-12 Greta (Web Admin — verifies teacher payout)
#
# This journey aligns with the ShyTalk mission ("teach languages and cultures worldwide").
# A TEACHER hosts a room labeled as a language lesson. Students discover via the language-
# learning rail, join, participate in voice, optionally tip with a "thank you" gift, then
# follow the teacher for future lessons.

Feature: j17 — Bao's Mandarin lesson + Yuki the student
  As a TEACHER hosting a Mandarin lesson on ShyTalk
  I want students to discover, join, learn, and tip me without friction
  So that the teaching loop matches the ShyTalk mission

  Background:
    Given the local stack is healthy
    Given Bao [P-17] is signed in on Web Chromium with userType=TEACHER and teachingLanguages=["zh", "en"]
    Given Bao is also paired on Android (same Firebase identity) for hosting
    Given Yuki [P-18] is signed in on iOS Sim with locale=ja and shyCoins=300
    Given Greta [P-12] is on Web Admin

  # The original "Bao opens a Mandarin lesson room, Yuki discovers + joins + tips"
  # scenario was 36 steps end-to-end. Split into 9 phase-scoped scenarios (≤6 steps
  # each) sharing the Background sign-in. Each later scenario establishes the prior
  # phase's outcome via a setup-style `Given` so it can run in isolation. The full
  # journey coverage is preserved; the @manual voice-audio check is its own
  # scenario for clarity.
  @browser-chromium
  Scenario: Bao schedules a Mandarin lesson via the teaching dashboard
    When Bao on Web opens the "teaching" panel from his profile
    When Bao on Web taps "schedule_newLessonButton"
    When Bao on Web fills in: language "zh", level "Beginner", title "Intro to Mandarin tones"
    When Bao on Web taps "scheduleLesson_confirmButton"
    Then within 5000ms the database has 1 entries in "lessons" matching {teacherId: 50000090, language: "zh", title: "Intro to Mandarin tones"}

  @android-physical
  Scenario: Bao starts the scheduled lesson on Android, opening a Classroom room
    Given Bao has scheduled a Mandarin lesson "Intro to Mandarin tones"
    When Bao on Android taps "Start lesson" on the lesson card
    Then within 5000ms the database has 1 entries in "rooms" matching {hostId: 50000090, lessonId: any, template: "Classroom", state: "OPEN"}
    Then Bao's Android UI shows the classroom room screen with "Teacher" badge on the host seat

  @ios-sim
  Scenario: Yuki discovers Bao's open lesson via the language-learning rail
    Given Bao has an OPEN Mandarin lesson room "Intro to Mandarin tones"
    When Yuki on iOS Sim opens the "home" tab
    Then within 5000ms Yuki's iOS Sim UI shows the "Learn Mandarin" rail
    Then Yuki's iOS Sim UI shows Bao's "Intro to Mandarin tones" room card
    Then the card shows the "Teacher" badge + language flag

  @ios-sim @android-physical
  Scenario: Yuki joins Bao's lesson and appears in both Bao's Android and Web participants list
    Given Bao has an OPEN Mandarin lesson room "Intro to Mandarin tones"
    When Yuki on iOS Sim taps Bao's room card
    Then within 5000ms the database has document "rooms/{roomId}" with field "participantIds" containing 50000091
    Then within 3000ms Bao's Android UI shows Yuki in the participants list
    Then within 3000ms Bao's Web UI (paired) also shows Yuki

  @ios-sim @android-physical
  Scenario: Yuki is granted a mic seat by Bao and is publishable
    Given Yuki is a participant in Bao's lesson room
    When Yuki on iOS Sim taps "room_requestSeatButton"
    When Bao on Android approves Yuki's seat request
    Then within 3000ms Yuki's iOS Sim UI is seated with mic publishable

  @manual @ios-sim @android-physical
  Scenario: Audio is bidirectional between Yuki and Bao on the lesson seat
    Given Yuki is seated with a mic in Bao's lesson room
    Then the tester hears Yuki on Bao's Android speakers AND Bao on Yuki's iOS Sim speakers

  @ios-sim
  Scenario: Yuki tips Bao with a rose gift (10 coins → 5 beans split for teacher)
    Given Yuki is a participant in Bao's lesson room
    When Yuki on iOS Sim taps the gift icon and selects "rose" with recipient "Bao"
    Then within 3000ms the database has document "users/50000091" with field "shyCoins" equal to 290
    Then within 3000ms the database has document "users/50000090" with field "beans" equal to 3005
    Then within 3000ms the database has 1 entries in "giftWalls/50000090/gifts" matching {giftId: "rose", senderId: 50000091}

  @ios-sim
  Scenario: Yuki follows Bao for future lessons (graph mirrors)
    Given Yuki is a participant in Bao's lesson room
    When Yuki on iOS Sim opens Bao's profile from the room
    When Yuki on iOS Sim taps "profile_followButton"
    Then within 3000ms the database has document "users/50000091" with field "followingIds" containing 50000090
    Then within 3000ms the database has document "users/50000090" with field "followerIds" containing 50000091

  @android-physical @ios-sim
  Scenario: Bao closes the lesson — both UIs show summary, completion timestamp on lesson doc
    Given Bao's lesson room is OPEN with Yuki as a participant
    When Bao on Android taps "End lesson"
    Then within 5000ms the database has document "rooms/{roomId}" with field "state" equal to "CLOSED"
    Then within 5000ms the database has document "lessons/{lessonId}" with field "completedAt" greater than 0
    Then within 5000ms Bao's Android UI shows the lesson summary: 1 student, 5 beans earned
    Then within 5000ms Yuki's iOS Sim UI shows the lesson-closed screen with a "Rate this lesson" prompt

  @ios-sim @android-physical
  Scenario: Yuki rates the closed lesson 5 stars and Bao's teaching dashboard updates
    Given Bao's lesson is CLOSED with Yuki having participated
    When Yuki on iOS Sim selects 5 stars and submits feedback "Bao explained tones clearly"
    Then within 3000ms the database has 1 entries in "lessons/{lessonId}/ratings" matching {studentId: 50000091, stars: 5}
    Then within 5000ms Bao's Android UI shows the new rating in his teaching dashboard

  @browser-chromium
  Scenario: Bao's teaching dashboard shows lifetime stats
    When Bao on Web opens "/profile/me?tab=teaching"
    Then within 3000ms Bao's Web UI shows: total lessons taught, total students, total beans earned, average rating, language coverage
    Then Bao's Web UI shows a chart of beans earned per week

  @ios-sim
  Scenario: Yuki's iOS Sim shows the language rail localized to her locale (ja)
    Given Yuki's locale is ja
    When Yuki on iOS Sim opens the "home" tab
    Then within 3000ms Yuki's iOS Sim UI shows the rail header in Japanese ("中国語を学ぶ" or locale-appropriate)
    Then the rail shows lessons tagged for language "zh"

  @browser-chromium @cross-cohort
  Scenario: Minor student joining an adult-cohort teacher's room — gated
    Given Marcus [P-04] (minor) opens the home tab on Android
    When Marcus on Android refreshes the language rail
    Then Marcus's Android UI does not show Bao's lesson room (Bao is in adult cohort)
    Then the response from /api/rooms/featured?cohort=minor does not include the lesson

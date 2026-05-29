# j07 — Adam → discovers Alice → follows → PMs → receives reply — full social loop.
#
# Personas: P-01 Adam (Android — primary, signed in + age-verified per j01), P-02 Alice (Web Chromium)
#
# Cross-platform messaging is the highest-volume real-time channel. This journey threads
# discovery → profile view → follow → conversation creation → message send → real-time
# arrival → push (manual) → reply round-trip → read receipt update.

Feature: j07 — Adam discovers + messages Alice
  As an age-verified adult on Android
  I want to find another adult, follow them, and exchange PMs with real-time UI updates
  So that the core social loop works across platforms in real time

  Background:
    Given the local stack is healthy
    Given the device locale is "en"
    Given Adam [P-01] is signed in on Android with cohort=adult and isAgeVerified=true (post-j01 state)
    Given Alice [P-02] is signed in on Web Chromium at "/discovery"
    Given neither user is following the other

  # The original 36-step "Adam discovers Alice, follows, sends PM, Alice replies
  # in real time" scenario is split into 8 phase-focused scenarios sharing the
  # Background sign-in state. Each later scenario sets up the prior phase's
  # outcome via setup-style `Given`. Full social-loop coverage preserved.
  @blocker @android-physical
  Scenario: Adam discovers Alice via search and lands on her profile
    When Adam on Android opens the "discovery" screen
    When Adam on Android types "Alice" into the search field
    Then within 3000ms Adam's Android UI shows Alice's user card
    When Adam on Android taps Alice's user card
    Then within 2000ms Adam's Android UI navigates to Alice's profile screen
    Then Adam's Android UI shows Alice's displayName "Alice (P-02 adult power)"
    Then Adam's Android UI shows Alice's stats (followers, following, beans)

  @blocker @android-physical @browser-chromium
  Scenario: Adam's profile visit is recorded — Alice's stalkers counter ticks up
    Given Adam has just navigated to Alice's profile
    Then within 5000ms the database has 1 entries in "profileVisits" matching {profileOwnerId: 50000010, visitorId: any}
    Then within 5000ms Alice's Web UI shows a +1 in the stalkers/profile-visits counter

  @blocker @android-physical @browser-chromium
  Scenario: Adam follows Alice — graph mirrors on both sides + Alice's Web UI ticks the counter
    Given Adam is on Alice's profile and not yet following her
    When Adam on Android taps "profile_followButton"
    Then within 3000ms the database has document "users/{adamId}" with field "followingIds" containing 50000010
    Then within 3000ms the database has document "users/50000010" with field "followerIds" containing {adamId}
    Then within 3000ms Adam's Android UI replaces follow button with "profile_unfollowButton"
    Then within 5000ms Alice's Web UI shows a +1 in the "Followers" count

  @blocker @android-physical
  Scenario: Adam creates a DIRECT conversation with Alice from the followed-users picker
    Given Adam is following Alice
    When Adam on Android opens the "pm" tab
    When Adam on Android taps "pm_newConversationButton"
    When Adam on Android selects "Alice" from the followed-users picker
    Then within 3000ms the database has 1 entries in "conversations" matching {participantIds: [<sorted>], type: "DIRECT"}
    Then Adam's Android UI navigates to the conversation thread screen with Alice

  @blocker @android-physical
  Scenario: Adam sends a first PM — message persisted + thread shows it with timestamp
    Given Adam has an open DIRECT conversation thread with Alice
    When Adam on Android types "hello, alice — first PM from a new adult" into "conversation_inputField"
    When Adam on Android taps "conversation_sendButton"
    Then within 3000ms the database has 1 entries in "messages" matching {senderId: {adamId}, conversationId: <id>, body: "hello, alice — first PM from a new adult"}
    Then within 2000ms Adam's Android UI shows the message in the thread with timestamp + sent indicator

  @blocker @browser-chromium
  Scenario: Alice's Web shows the new conversation unread and marks Adam's message read on open
    Given Adam has just sent Alice "hello, alice — first PM from a new adult"
    When Alice on Web opens the "pm" tab
    Then within 3000ms Alice's Web UI shows a new conversation with Adam highlighted as unread
    When Alice on Web opens the conversation with Adam
    Then within 2000ms Alice's Web UI shows "hello, alice — first PM from a new adult"
    Then within 5000ms the database has document "messages/<id>" with field "readBy" containing 50000010

  @manual @browser-chromium
  Scenario: Alice's Web receives an FCM push notification for Adam's message
    Given Adam has just sent Alice "hello, alice — first PM from a new adult"
    Then the tester sees an FCM push notification on Alice's Web with body containing "Adam"

  @blocker @android-physical @browser-chromium
  Scenario: Alice replies — Adam sees the reply + both sides see read receipts
    Given Alice has read Adam's first message in the open thread
    When Alice on Web types "hi adam, welcome to shytalk" into the conversation input
    When Alice on Web taps the send button
    Then within 3000ms the database has 1 entries in "messages" matching {senderId: 50000010, body: "hi adam, welcome to shytalk"}
    Then within 3000ms Adam's Android UI shows the reply in the thread
    Then within 5000ms the database has document "messages/<reply-id>" with field "readBy" containing {adamId}
    Then Adam's Android UI shows "read" indicator on his original message
    Then Alice's Web UI shows "read" indicator on her reply

  @android-physical @browser-chromium
  Scenario: Adam edits a PM within the edit window — Alice sees the update in real time
    Given Adam sent a message "tpyo here" to Alice
    When Adam on Android long-presses the message and taps "Edit"
    When Adam on Android changes the body to "typo here" and confirms
    Then within 3000ms the database has document "messages/<id>" with field "body" equal to "typo here"
    Then the database has document "messages/<id>" with field "editedAt" greater than 0
    Then within 3000ms Alice's Web UI shows the edited body "typo here" with an "edited" tag

  @android-physical
  Scenario: Adam deletes a PM after the edit window — message replaced with tombstone
    Given Adam sent a message "secret" to Alice 30 minutes ago (past edit window)
    When Adam on Android long-presses the message and taps "Delete"
    Then within 3000ms the database has document "messages/<id>" with field "deleted" equal to true
    Then within 3000ms Adam's Android UI shows "Deleted message" tombstone
    Then within 3000ms Alice's Web UI shows "Deleted message" tombstone

  @blocker @regression j07-bug-discover-missing-index
  # bug: cohort+lastSeenAt and cohort+displayName composite indexes
  # declared in firestore.indexes.json were never deployed to
  # shytalk-dev. As a result GET /api/users/discover and the
  # displayName branch of GET /api/users/search both 500 instead
  # of returning a cohort-filtered list. Regression guard — if
  # any future deploy drops these indexes, this scenario fails
  # before any user notices that discovery is broken.
  Scenario: Discovery and displayName search return 200 (composite indexes deployed)
    Given Alice [P-02] is signed in
    When Alice sends GET /api/users/discover?limit=5 with her ID token
    Then the response status is 200
    Then the response body has field "users" of type "array"
    When Alice sends GET /api/users/search?q=alice with her ID token
    Then the response status is 200
    Then the response body has field "users" of type "array"

  @android-physical @cross-cohort
  Scenario: Adam attempts to PM a minor user — 404 wall + audit row + no conversation created
    Given Marcus (P-04, minor) exists
    When Adam on Android attempts to start a conversation with Marcus via POST /api/conversations
    Then the response status is 404
    Then no conversation doc is created
    Then the database has 1 entries in "segregationEvents" matching {action: "blocked", targetUniqueId: 60000010}

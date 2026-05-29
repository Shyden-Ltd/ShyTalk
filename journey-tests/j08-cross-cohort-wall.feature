# j08 — Vexa, cross-cohort prober — every adult→minor interaction must hit the 404 wall.
#
# Personas: P-07 Vexa (Web Chromium + Android in parallel — same Firebase identity),
#           P-04 Marcus (Android — must NOT observe Vexa's attempts anywhere)
#
# This is the cohort-segregation stress test. Every adult→minor surface (search, follow,
# PM, gift, room invite, profile view via direct URL, leaderboard, FCM source) must be
# gated. The wall must be uniform across Web and Android — a bug where one platform's
# guard is missing is a critical OSA-compliance failure.

Feature: j08 — Vexa's cross-cohort probing
  As an adult attempting every cross-cohort interaction
  I want every adult→minor surface to return a 404 / empty result with an audit row
  So that OSA segregation holds across all platforms uniformly

  Background:
    Given the local stack is healthy
    Given Vexa [P-07] is signed in on Web Chromium AND on Android (same Firebase user)
    Given Marcus [P-04] is signed in on Android at the "discovery" screen
    Given Vexa has no prior interactions with Marcus

  # The original 31-step "Vexa probes every cross-cohort surface from Web"
  # scenario is split into 10 phase-focused scenarios — one per cross-cohort
  # surface (search, profile URL, follow, PM, gift, room invite, leaderboard,
  # stalkers, FCM, recipient device). Each scenario can run in isolation and
  # represents an independent OSA-compliance gate. Surfacing each surface as
  # its own scenario also lets the runner attribute a specific failure to a
  # specific gate.
  @blocker @browser-chromium @cross-cohort
  Scenario: Vexa's exact-name search for Marcus returns "No results" and empty API
    When Vexa on Web opens "/discovery"
    When Vexa on Web types "Marcus" into the search field
    Then within 3000ms Vexa's Web UI shows "No results found"
    Then the response from /api/users/search has 0 results

  @blocker @browser-chromium @cross-cohort
  Scenario: Vexa's direct profile-URL deep-link to Marcus returns 404 with "User not found"
    When Vexa on Web navigates to "/profile/60000010"
    Then the response status is 404
    Then Vexa's Web UI shows "User not found"

  @blocker @browser-chromium @cross-cohort
  Scenario: Vexa's follow attempt via API returns 404 + audit row
    When Vexa on Web POSTs /api/users/follow with targetUniqueId=60000010
    Then the response status is 404
    Then the database has 1 entries in "auditLog" matching {action: "blocked", sourceId: 50000040, targetId: 60000010, reason: "cohort_mismatch"}

  @blocker @browser-chromium @cross-cohort
  Scenario: Vexa's PM conversation-creation attempt returns 404 with no conversation doc
    When Vexa on Web POSTs /api/conversations with targetUniqueId=60000010
    Then the response status is 404
    Then no conversation doc is created

  @blocker @browser-chromium @cross-cohort
  Scenario: Vexa's gift-send attempt returns 404 — both sender and recipient balances unchanged
    When Vexa on Web POSTs /api/economy/send-gift with recipient=60000010 and giftId="rose"
    Then the response status is 404
    Then the database has document "users/50000040" with field "shyCoins" unchanged
    Then the database has document "users/60000010" with field "beans" unchanged

  @blocker @browser-chromium @cross-cohort
  Scenario: Vexa's voice-room invite attempt returns 404 (room exists but invite is cross-cohort)
    Given Vexa created a voice room "rv1"
    When Vexa on Web POSTs /api/rooms/rv1/invite with targetUniqueId=60000010
    Then the response status is 404

  @blocker @browser-chromium @cross-cohort
  Scenario: Vexa's leaderboard does not include Marcus — every row is cohort=adult
    When Vexa on Web opens "/leaderboard"
    Then within 3000ms Vexa's Web UI does not show Marcus
    Then the response from /api/economy/leaderboards has cohort="adult" in every row

  @blocker @browser-chromium @cross-cohort
  Scenario: Vexa's stalkers list does not show Marcus (even if Marcus visited her profile)
    When Vexa on Web opens "/profile/50000040#stalkers"
    Then Vexa's Web UI does not show Marcus (even if Marcus had visited Vexa's profile in raw Firestore)

  @blocker @cross-cohort
  Scenario: FCM dispatcher's cohort gate refuses Vexa→Marcus push and logs "skipped"
    When the FCM dispatcher attempts to send a notification from Vexa (50000040) to Marcus (60000010)
    Then no FCM payload is sent to Marcus's tokens
    Then the dispatcher audit log records "skipped" with reason "cohort_mismatch"

  @blocker @android-physical @cross-cohort
  Scenario: Marcus's device never sees a signal from any of Vexa's probing attempts
    Given Vexa has made all 9 cross-cohort probing attempts above
    Then Marcus's Android UI does not show any in-app banner from Vexa
    Then Marcus's Android UI does not show any new follower notification
    Then the database has document "users/60000010" with field "followerIds" not containing 50000040

  @blocker @android-physical @cross-cohort
  Scenario: Same probes from Vexa's Android — parity with Web (no platform-specific gap)
    Given Vexa is signed in on Android (same Firebase identity as Web)
    When Vexa on Android searches "Marcus" in discovery
    Then Vexa's Android UI shows "No results found"
    When Vexa on Android attempts profile deep-link "/profile/60000010"
    Then Vexa's Android UI shows "User not found"
    When Vexa on Android attempts to follow Marcus via the profile screen (via deep-link error path)
    Then the request returns status 404
    Then the database has 1 entries in "auditLog" matching {action: "blocked", sourceId: 50000040, targetId: 60000010, reason: "cohort_mismatch"}

  @blocker @cross-cohort
  Scenario: Reverse direction — Marcus (minor) probing Vexa (adult) — same wall
    When Marcus on Android searches "Vexa" in discovery
    Then Marcus's Android UI shows "No results found"
    When POST /api/users/follow with targetUniqueId=50000040 as Marcus
    Then the response status is 404
    Then the database has 1 entries in "auditLog" matching {action: "blocked", sourceId: 60000010, targetId: 50000040, reason: "cohort_mismatch"}

  @cross-cohort @perf-budget:200
  Scenario: Audit row write does not slow the 404 response path noticeably
    When 10 cross-cohort follow attempts hit /api/users/follow concurrently
    Then each response status is 404
    Then each response p95 latency is less than 200ms
    Then 10 audit rows are written

  # Fill-5 — PR #669 — explicit P2P coin transfer cross-cohort gate.
  # Gifts are covered by the main probe; the P2P coin endpoint is a separate
  # surface and needs its own assertion.
  @blocker @regression @cross-cohort osa17-pr9-p2p-coin
  Scenario: Cross-cohort P2P coin transfer is refused with no balance movement
    Given Vexa on Web has shyCoins=1000
    Given Marcus on Android has shyCoins=10
    When Vexa on Web POSTs /api/economy/transfer-coins with recipient=60000010 and amount=100
    Then the response status is 404
    Then the database has document "users/50000040" with field "shyCoins" equal to 1000
    Then the database has document "users/60000010" with field "shyCoins" equal to 10
    Then the database has 1 entries in "auditLog" matching {action: "blocked", sourceId: 50000040, targetId: 60000010, reason: "cohort_mismatch"}
    Then no entry is added to "users/50000040/transactions" since "{ts}"
    Then no entry is added to "users/60000010/transactions" since "{ts}"

  # Fill-4 — PR #668 — pre-OSA cross-cohort conversation freezes + shows banner
  # in the recipient's locale. Tests that the migration set frozen=true on
  # existing cross-cohort convos AND that both ends render the localized banner
  # using one of the 9 age_seg_* string keys.
  @blocker @regression @cross-cohort osa17-pr8-frozen-conversation-banner
  Scenario: Pre-OSA cross-cohort conversation is frozen and renders banner on both ends
    Given a conversation "c1" exists with participantIds=[50000040, 60000010] created before the OSA migration
    Given the conversation doc "conversations/c1" has field "frozenAtMigration" equal to true (set by migration)
    Given Vexa on Web locale=en, Marcus on Android locale=en
    When Vexa on Web opens "/conversations/c1"
    Then within 3000ms Vexa's Web UI shows the frozen-banner element with text from key "age_seg_frozen_conversation_banner"
    Then Vexa's Web UI does not show the message-input field
    Then Vexa's Web UI does not show the "Send" button
    When Vexa on Web attempts POST /api/conversations/c1/messages with body {"text": "hello"}
    Then the response status is 403
    Then no document is created in "conversations/c1/messages"
    Then within 3000ms Marcus's Android UI opens conversation "c1" shows the frozen-banner element with text from key "age_seg_frozen_conversation_banner"
    Then Marcus's Android UI does not show the message-input field

  @regression @cross-cohort osa17-pr8-frozen-banner-locale
  Scenario: Frozen banner renders in recipient locale (Japanese)
    Given the conversation "c2" between Hayato (post-flip minor, locale=ja) and Alice (adult, locale=en) is frozen
    When Hayato on Android opens "/conversations/c2"
    Then within 3000ms Hayato's Android UI shows the frozen-banner element with the Japanese age_seg_frozen_conversation_banner string
    When Alice on Web opens "/conversations/c2"
    Then within 3000ms Alice's Web UI shows the frozen-banner element with the English age_seg_frozen_conversation_banner string

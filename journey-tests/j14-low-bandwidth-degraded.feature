# j14 — Ines on low-bandwidth + flaky network — sign-in, voice room, PM, retry.
#
# Personas: P-11 Ines (Web Chromium with throttling + iOS Sim with Network Link Conditioner)
#
# Most of the world has flaky mobile networks. This journey throttles Ines's network and
# asserts every flow gracefully degrades: skeletons render, retries succeed, no white
# screens, no dropped messages, voice room reconnects.

Feature: j14 — Ines on Slow 3G + intermittent loss
  As a user on a flaky mobile connection
  I want the app to load, send messages, and rejoin voice rooms despite latency and drops
  So that 90% of the world's network conditions are usable

  Background:
    Given the local stack is healthy
    Given Ines [P-11] is on Web Chromium with Chrome DevTools network throttling set to "Slow 3G" (400kbps down, 400ms latency)
    Given Ines [P-11] is also paired on iOS Sim with Network Link Conditioner "3G" preset

  @browser-chromium
  Scenario: Sign-in on Slow 3G completes within 10s without timing out
    When Ines on Web navigates to "/login.html"
    Then within 10000ms Ines's Web UI shows the sign-in form
    When Ines on Web signs in with valid credentials
    Then within 10000ms Ines's Web UI navigates to "/"
    Then no XHR returns 408 (timeout)
    Then no JavaScript console errors are present

  @browser-chromium
  Scenario: Skeletons / loading indicators render during slow data load
    When Ines on Web opens "/discovery" on Slow 3G
    Then within 1000ms Ines's Web UI shows skeleton placeholders for user cards
    Then within 10000ms the skeletons are replaced with actual user data

  @browser-chromium
  Scenario: PM send while offline — queued + retried on reconnect
    Given Ines is signed in on Web Chromium
    Given Ines is in a conversation with Theo
    When Ines on Web sets the network to "Offline" via DevTools
    When Ines on Web types "queued message" and taps send
    Then within 2000ms Ines's Web UI shows the message in the thread with "sending..." indicator
    When Ines on Web restores the network to "Slow 3G"
    Then within 10000ms Ines's Web UI shows the message with "sent" indicator
    Then within 15000ms the database has 1 entries in "messages" matching {senderId: 50000061, body: "queued message"}
    Then Theo's Android UI shows the message in the conversation

  @ios-sim
  Scenario: Voice room reconnection after network drop
    Given Ines [P-11] is on iOS Sim joined to voice room "r1" with mic open
    When Ines's iOS Sim network drops for 10 seconds
    Then within 5000ms Ines's iOS Sim UI shows a "Reconnecting..." banner
    Then Ines's iOS Sim UI is still in the room (does not navigate away)
    When Ines's iOS Sim network restores
    Then within 10000ms Ines's iOS Sim UI shows the room normally (no banner)
    Then within 10000ms Ines's LiveKit track for room "r1" is republished

  @browser-chromium
  Scenario: Slow API response (>5s) shows a loading state, not a blank screen
    Given Ines is signed in on Web Chromium
    Given the Express API /api/users/me has a 6 second latency injected
    When Ines on Web opens "/profile/me"
    Then within 500ms Ines's Web UI shows a loading skeleton
    Then within 7000ms Ines's Web UI shows the profile content

  @browser-chromium
  Scenario: Failed XHR retries automatically up to 3 times
    Given Ines is signed in on Web Chromium
    Given the Express API /api/economy/balance fails twice with 503, succeeds on 3rd try
    When Ines on Web opens "/wallet"
    Then within 15000ms Ines's Web UI shows the balance correctly
    Then the network log shows 3 attempts to /api/economy/balance

  @ios-sim
  Scenario: 30% packet loss on iOS Sim — voice room audio is still intelligible (@manual)
    Given Ines is on iOS Sim joined to room "r1" seated with mic open
    Given Network Link Conditioner injects 30% packet loss
    @manual
    Then the tester hears Ines's audio with occasional dropouts but recognizable speech
    Then Ines's iOS Sim UI shows a "Poor connection" indicator
    Then within 15000ms Ines's LiveKit track is not disconnected (does not drop below the reconnect threshold)

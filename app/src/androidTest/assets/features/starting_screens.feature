Feature: Starting Screens
  As the app
  I want to show configurable starting screens on launch
  So that admins can block access or show announcements before the app loads

  # ── Blocking ──────────────────────────────────────────────

  Scenario: Blocking screen shows title and message
    Given a blocking starting screen is configured with title "Not Available" and message "This app is not available yet"
    Then I should see the element with tag "startingScreen_title"
    And I should see the element with tag "startingScreen_message"

  Scenario: Blocking screen has no dismiss button
    Given a blocking starting screen is configured with title "Blocked" and message "Access is restricted"
    Then I should not see the element with tag "startingScreen_dismissButton"

  # ── Dismissable ──────────────────────────────────────────

  Scenario: Dismissable screen shows dismiss button
    Given a dismissable starting screen is configured with title "Welcome" and message "Welcome to our app"
    Then I should see the element with tag "startingScreen_dismissButton"

  Scenario: Dismissable screen can be dismissed
    Given a dismissable starting screen is configured with title "Welcome" and message "Welcome to our app"
    When I tap the element with tag "startingScreen_dismissButton"
    And I wait 1000 milliseconds
    Then I should not see the element with tag "startingScreen_title"

  # ── Templates ────────────────────────────────────────────

  Scenario: Warning template renders correctly
    Given a starting screen with template "warning" is configured
    Then I should see the element with tag "startingScreen_title"

  Scenario: Announcement template renders correctly
    Given a starting screen with template "announcement" is configured
    Then I should see the element with tag "startingScreen_title"

  Scenario: Info template renders correctly
    Given a starting screen with template "info" is configured
    Then I should see the element with tag "startingScreen_title"

  Scenario: Promotional template renders correctly
    Given a starting screen with template "promotional" is configured
    Then I should see the element with tag "startingScreen_title"

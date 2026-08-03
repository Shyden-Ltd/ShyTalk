Feature: Roadmap page authentication
  As a ShyTalk user
  I want to login on the roadmap page with my existing ShyTalk account
  So that I can vote, suggest, and subscribe to updates

  Background:
    Given the roadmap page is loaded

  Scenario: Unauthenticated user sees login prompt in suggestions section
    When I scroll to the suggestions section
    Then I should see a login prompt
    And the login prompt should have a "Sign in with Google" button
    And the login prompt should have a "Sign in with Apple" button

  Scenario: A Google user with a ShyTalk account is signed in on the roadmap
    Given a ShyTalk account exists for my Google email
    When I sign in with Google
    Then I should see "Logged in as: TestUser"
    And I should see a sign out button
    And the login prompt should be hidden

  Scenario: A signed-in roadmap user can vote on suggestions
    Given I am logged in as "TestUser"
    When I scroll to the suggestions section
    Then I should be able to vote on suggestions

  Scenario: An Apple user with a ShyTalk account is signed in on the roadmap
    Given a ShyTalk account exists for my Apple ID
    When I sign in with Apple
    Then I should see "Logged in as: TestUser"
    And I should see a sign out button

  Scenario: A Google user with no ShyTalk account is told how to get one
    Given NO ShyTalk account exists for my Google email
    When I sign in with Google
    Then I should see a "No ShyTalk account found" message
    And the message should invite me to create an account in the app

  Scenario: The no-account message links to both app stores
    Given I logged in with Google but have no ShyTalk account
    Then I should see a link to download from the Play Store
    And I should see a link to download from the App Store

  Scenario: An Apple user with no ShyTalk account is told how to get one
    Given NO ShyTalk account exists for my Apple ID
    When I sign in with Apple
    Then I should see a "No ShyTalk account found" message
    And I should see download links for both stores

  Scenario: Logged-in user signs out
    Given I am logged in as "TestUser"
    When I tap the sign out button
    Then the login prompt should reappear
    And "Logged in as" should no longer be visible
    And vote/suggest buttons should be disabled

  Scenario: Logged-in user's display name is shown correctly
    Given I am logged in as "Alice 🌟"
    Then I should see "Logged in as: Alice 🌟"

  Scenario: Suggestions section is browsable without login (read-only)
    When I scroll to the suggestions section
    Then I should see the suggestion list
    And I should NOT see "Missing or invalid Authorization" error
    But vote arrows should show login prompt when tapped

  Scenario: Auth state persists across page refresh
    Given I am logged in as "TestUser"
    When I refresh the page
    Then I should still see "Logged in as: TestUser"

  Scenario: Download prompt after failed login allows dismissal
    Given I logged in with Google but have no ShyTalk account
    When I dismiss the download prompt
    Then I should be able to browse suggestions in read-only mode

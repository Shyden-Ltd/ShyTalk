Feature: Profile
  As a user
  I want to view my profile and other users' profiles
  So that I can manage my identity and social interactions

  Scenario: Profile tab shows current user profile
    Given I am on the main screen
    When I tap the "Profile" tab
    And I wait for the element with tag "profile_displayName"
    Then I should see the element with tag "profile_displayName"

  Scenario: Profile tab shows display name
    Given I am on the main screen
    When I tap the "Profile" tab
    Then I should see the text "TestUser"

  Scenario: Viewing another user's profile shows Follow button
    Given I am on the "user_profile/test-user-2" screen
    When I wait for the element with tag "profile_followButton"
    Then I should see the element with tag "profile_followButton"

  Scenario: Viewing another user's profile shows Message button
    Given I am on the "user_profile/test-user-2" screen
    When I wait for the element with tag "profile_messageButton"
    Then I should see the element with tag "profile_messageButton"

  Scenario: Following a user updates the button text
    Given I am on the "user_profile/test-user-2" screen
    When I wait for the element with tag "profile_followButton"
    And I tap the element with tag "profile_followButton"
    Then I should see the text "Unfollow"

  Scenario: Wallet button on profile navigates to wallet screen
    Given I am on the main screen
    When I tap the "Profile" tab
    And I wait for the element with tag "profile_walletButton"
    And I tap the element with tag "profile_walletButton"
    Then I should see the element with tag "wallet_balance"

  Scenario: Follow list screen shows followers and following tabs
    Given I am on the "follow_list/test-user-1/followers" screen
    When I wait for the element with tag "followList_followersTab"
    Then I should see the element with tag "followList_followersTab"
    And I should see the element with tag "followList_followingTab"

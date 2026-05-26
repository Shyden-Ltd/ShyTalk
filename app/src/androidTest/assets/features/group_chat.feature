Feature: Group Chat
  As a user
  I want to participate in group conversations
  So that I can communicate with multiple people at once

  Scenario: Shows message input
    Given I am authenticated as "test-user-1"
    And I am on the "group_chat" screen
    Then I should see the element with tag "privateChat_messageInput"

  Scenario: Shows send button
    Given I am authenticated as "test-user-1"
    And I am on the "group_chat" screen
    Then I should see the element with tag "conversation_sendButton"

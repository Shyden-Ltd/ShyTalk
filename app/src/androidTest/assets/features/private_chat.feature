Feature: Private Chat
  As a user
  I want to send private messages
  So that I can communicate one-on-one

  Background:
    Given I am on the main screen

  Scenario: Messages tab shows conversation list
    When I tap the "Messages" tab
    Then I should see the text "OtherUser"

  Scenario: Tapping a conversation opens chat with input
    When I tap the "Messages" tab
    And I tap the text "OtherUser"
    Then I should see the element with tag "privateChat_messageInput"
    And I should see the element with tag "privateChat_sendButton"

  Scenario: Type a message in chat
    When I tap the "Messages" tab
    And I tap the text "OtherUser"
    And I wait for the element with tag "privateChat_messageInput"
    And I type "Hello there!" into the field with tag "privateChat_messageInput"
    Then I should see the element with tag "privateChat_sendButton"

  Scenario: Back button returns to messages
    When I tap the "Messages" tab
    And I tap the text "OtherUser"
    And I tap the element with tag "privateChat_backButton"
    And I wait 1000 milliseconds
    Then I should see the element with tag "main_messagesTab"

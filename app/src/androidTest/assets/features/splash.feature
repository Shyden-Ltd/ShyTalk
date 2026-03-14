Feature: Fun Fact Splash Screen
  As a user launching the app
  I want to see a splash screen with a fun fact
  So that I'm entertained while the app loads

  Scenario: Splash screen shows app title
    Given I am authenticated as "test-user-1"
    And I am on the "splash" screen
    Then I should see the element with tag "splash_title"
    And I should see the text "ShyTalk"

  Scenario: Splash screen shows continue button
    Given I am authenticated as "test-user-1"
    And I am on the "splash" screen
    Then I should see the element with tag "splash_continueButton"

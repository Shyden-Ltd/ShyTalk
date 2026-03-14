Feature: System Screens
  As the app
  I want to show appropriate blocking screens
  So that users are informed about device/update/backend issues

  Scenario: Force update screen shows title and update button
    Given the force update screen is displayed
    Then I should see the element with tag "forceUpdate_title"
    And I should see the element with tag "forceUpdate_updateButton"

  Scenario: Degraded mode screen shows title and acknowledge button
    Given the degraded mode screen is displayed
    Then I should see the element with tag "degraded_title"
    And I should see the element with tag "degraded_acknowledgeButton"

  Scenario: Unsafe device screen shows warning
    Given the unsafe device screen is displayed
    Then I should see the element with tag "unsafeDevice_title"
    And I should see the element with tag "unsafeDevice_description"

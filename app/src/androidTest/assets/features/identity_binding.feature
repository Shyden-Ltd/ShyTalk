Feature: Identity binding
  As the ShyTalk system
  I want to bind device and network info to user accounts on every login
  So that the identity graph can enforce bans across devices

  Scenario: User logs in and device info is sent to API
    Given I am not authenticated
    When I authenticate as "test-user-1"
    Then device info should be sent to the API
    And the device info should include device model
    And the device info should include OS version
    And the device info should include app version

  Scenario: User logs in on new device and device added to identity graph
    Given I am authenticated as "test-user-1" on device "device-new"
    Then the identity graph for "test-user-1" should include "device-new"

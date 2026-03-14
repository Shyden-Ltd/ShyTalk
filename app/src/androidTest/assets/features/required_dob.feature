Feature: Required Date of Birth
  As a user without a date of birth on file
  I want to enter my date of birth
  So that I can continue using the app

  Scenario: Screen shows title and date picker
    Given I am authenticated as "test-user-1"
    And I am on the "required_dob" screen
    Then I should see the element with tag "requiredDob_title"
    And I should see the element with tag "requiredDob_dateButton"
    And I should see the element with tag "requiredDob_continueButton"

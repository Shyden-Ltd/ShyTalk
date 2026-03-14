Feature: Report Review
  As an admin
  I want to review pending reports
  So that I can take moderation actions

  Scenario: Report review screen shows empty state
    Given I am authenticated as "test-user-1"
    And I am on the "report_review" screen
    Then I should see the element with tag "reportReview_backButton"
    And I should see the element with tag "reportReview_emptyState"

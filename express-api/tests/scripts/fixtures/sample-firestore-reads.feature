# Fixture for the v2 Firestore-read matchers. Not a real journey —
# the syntactic surface is what the parser + new matchers must handle.

Feature: Fixture Firestore read matchers

  Background:
    Given the local stack is healthy

  @blocker
  Scenario: doc-field equality assertion passes when field matches
    Given Alice [P-02] is signed in
    Then the database has document "users/50000010" with field "cohort" equal to "adult"
    Then the database has document "users/50000010" with field "uniqueId" equal to 50000010

  @blocker
  Scenario: doc-field equality assertion fails when field drifts
    Given Alice [P-02] is signed in
    Then the database has document "users/50000010" with field "cohort" equal to "BOGUS_NEVER_USED_VALUE"

  @blocker
  Scenario: missing doc is a finding (not a silent pass)
    Given Alice [P-02] is signed in
    Then the database has document "users/99999999" with field "cohort" equal to "adult"

  @regression
  Scenario: array-field containing assertion passes when element is present
    Given Alice [P-02] is signed in
    Then the database has document "users/50000010" with field "followingIds" containing 50000060

  @regression
  Scenario: array-field containing assertion fails when element is absent
    Given Alice [P-02] is signed in
    Then the database has document "users/50000010" with field "followingIds" containing 60000010

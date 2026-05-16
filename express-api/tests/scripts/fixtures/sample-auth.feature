# Fixture for the manual-qa runner Jest suite. Not a real journey —
# the syntactic surface is what the parser needs to handle correctly.

Feature: Fixture auth journey

  Background:
    Given the local stack is healthy
    Given the device locale is "en"

  @blocker
  Scenario: Alice signs in and reads her own profile
    Given Alice [P-02] is signed in
    When Alice sends GET /api/users/50000010 with her ID token
    Then the response status is 200
    Then the response body has field "uniqueId" of type "number"
    Then the response body contains "Alice"

  @regression
  Scenario: Greta's admin claim uses the correct key
    Given Greta [P-12] is signed in
    Then Greta's Firebase Auth custom claims include "admin" equal to true
    Then Greta's Firebase Auth custom claims do not include "isAdmin"

  Scenario: Self-follow returns 400
    Given Alice [P-02] is signed in
    When Alice sends POST /api/users/50000010/follow with body {"targetUserId": 50000010}
    Then the response status is 400

  @manual
  Scenario: Manual-only step is recorded as skipped
    Given the tester opens Chrome
    Then the tester sees the home page render

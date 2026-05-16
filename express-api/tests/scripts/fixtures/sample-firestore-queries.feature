# Fixture for the v2 Firestore bulk-query matchers. Not a real journey —
# the syntactic surface is what the parser + matchers must handle.

Feature: Fixture Firestore bulk-query matchers

  Background:
    Given the local stack is healthy

  @blocker
  Scenario: count matching the expected positive value passes
    Given Alice [P-02] is signed in
    Then the database has 1 entries in "auditLog" matching {action: "blocked", sourceId: 50000010, targetId: 60000010, reason: "cohort_mismatch"}

  @blocker
  Scenario: count matching zero passes when collection has no matches
    Given Alice [P-02] is signed in
    Then the database has 0 entries in "auditLog" matching {action: "device.ban"}

  @blocker
  Scenario: count drift produces a finding
    Given Alice [P-02] is signed in
    Then the database has 5 entries in "auditLog" matching {action: "blocked"}

  @regression
  Scenario: empty predicate counts everything in the collection
    Given Alice [P-02] is signed in
    Then the database has 3 entries in "auditLog" matching {}

  @regression
  Scenario: predicate-with-string value matches only string-equal docs
    Given Alice [P-02] is signed in
    Then the database has 1 entries in "auditLog" matching {action: "age_verification.approve"}

  @regression
  Scenario: subcollection path works (slash-separated)
    Given Alice [P-02] is signed in
    Then the database has 2 entries in "users/50000010/gifts" matching {giftId: "rose"}

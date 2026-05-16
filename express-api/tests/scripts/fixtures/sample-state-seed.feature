# Fixture for v2 state-seed matchers. Personas have their Firestore user
# doc field set to a known baseline before the scenario's When step runs.

Feature: Fixture state-seed matchers

  Background:
    Given the local stack is healthy

  @blocker
  Scenario: persona has-field assignment writes the field
    Given Alice [P-02] has shyCoins=1000
    Then the database has document "users/50000010" with field "shyCoins" equal to 1000

  @blocker
  Scenario: persona has-field with platform suffix writes the field
    Given Alice [P-02] on Web has shyCoins=42
    Then the database has document "users/50000010" with field "shyCoins" equal to 42

  @regression
  Scenario: persona has-field with boolean literal
    Given Alice [P-02] has isAgeVerified=false
    Then the database has document "users/50000010" with field "isAgeVerified" equal to false

  @regression
  Scenario: persona has-field with quoted-string literal
    Given Alice [P-02] has cohort="adult"
    Then the database has document "users/50000010" with field "cohort" equal to "adult"

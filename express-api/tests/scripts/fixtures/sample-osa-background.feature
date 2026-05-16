# Fixture for the v2.E Background verbs the OSA journey scenarios use.
# These are the exact verb shapes that landed in cycle 1 as STEP_NOT_IMPLEMENTED.

Feature: Fixture OSA background verbs

  Background:
    Given the local stack is healthy

  @blocker
  Scenario: sign-in tolerates with-cohort qualifier
    Given Alice [P-02] is signed in on Android with cohort=adult (DOB=2007-01-01 in users doc)
    Then the database has document "users/50000010" with field "uniqueId" equal to 50000010

  @blocker
  Scenario: sign-in tolerates multi-platform "AND on" form
    Given Alice [P-02] is signed in on Web Chromium AND on Android (same Firebase user)
    Then the database has document "users/50000010" with field "uniqueId" equal to 50000010

  @blocker
  Scenario: migration-state precondition passes when ops doc exists
    Given the dev environment migration ran at least once (lastMigrationRunAt is set in "ops/segregation-migration")
    Then the database has document "ops/segregation-migration" with field "lastMigrationRunAt" equal to 1700000000000

  @regression
  Scenario: livekit-docker precondition is a no-op against dev/prod
    Given the LiveKit Docker container is running on ws://localhost:7880
    Then the database has document "users/50000010" with field "uniqueId" equal to 50000010

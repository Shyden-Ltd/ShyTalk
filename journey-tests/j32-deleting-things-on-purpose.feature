# j32 — the operations that remove other people's money and history, used deliberately
# so they are never used accidentally.
#
# Personas: P-12 Greta (Web Admin — runs the cleanups), P-02 Alice (Web — holds the coins,
#           beans and history being removed), P-10 Theo (Android — not an admin)
#
# Why this journey exists (SHY-0412): routes/admin-cleanup.js holds 26 endpoints that delete
# data wholesale — all-coins, all-beans, all-transactions, all-backpacks, all-giftwalls,
# all-reports, all-warnings, all-spin-history, all-supershy — and not one appeared in 675
# scenarios. all-coins removes every coin every member holds. The gate is by PATH PREFIX and
# the file's own comment explains how easily that goes wrong in either direction.
#
# The static half is now enforced by destructive-routes-are-guarded.test.js, which fails if a
# route is added outside a guard prefix and was mutation-proven the day it was written. This
# journey is the other half: what the endpoints actually DO.
#
# Every scenario that removes something also asserts a NEIGHBOUR SURVIVES. A cleanup is only
# correct if it is also bounded, and "the thing I deleted is gone" cannot tell the difference
# between a cleanup and a catastrophe.

Feature: j32 — a cleanup removes what it names and nothing else
  As the operator of a platform holding other people's money
  I want the operations that delete it to be bounded and provable
  So that a cleanup is never discovered to have reached further than intended

  Background:
    Given this is a disposable environment seeded for the run, not dev or production
    And Alice [P-02] holds coins, beans, transactions, a backpack and a gift wall

  @blocker
  Scenario: Removing every coin removes the coins
    Given Greta [P-12] has run the coin cleanup
    When Alice opens her wallet
    Then Alice's coins are gone

  @blocker
  Scenario: Removing every coin leaves the beans
    Given Greta has run the coin cleanup
    When Alice opens her wallet
    Then Alice's beans are untouched

  @blocker
  Scenario: Removing every bean leaves the coins
    Given Greta has run the bean cleanup
    When Alice opens her wallet
    Then Alice's coins are untouched

  @blocker
  Scenario: Removing transactions leaves balances
    Given Greta has run the transaction cleanup
    When Alice opens her wallet
    Then Alice's balances are untouched

  @blocker
  Scenario: Removing backpacks leaves gift walls
    Given Greta has run the backpack cleanup
    When Alice opens her gift wall
    Then Alice's gift wall is untouched

  @blocker
  Scenario: Removing gift walls leaves backpacks
    Given Greta has run the gift-wall cleanup
    When Alice opens her backpack
    Then Alice's backpack is untouched

  @blocker
  Scenario: Removing reports leaves warnings
    Given Greta has run the report cleanup
    When Greta opens the warnings
    Then the warnings are untouched

  @blocker
  Scenario: Removing warnings leaves reports
    Given Greta has run the warning cleanup
    When Greta opens the reports queue
    Then the reports are untouched

  @blocker
  Scenario: The app still works after a cleanup
    Given Greta has run the coin cleanup
    When Alice uses the app
    Then Alice can still browse, message and open rooms

  @blocker @security
  Scenario: Cleanups are not open to everyone
    Given Theo [P-10] is not an admin
    When Theo calls a cleanup endpoint
    Then Theo is refused

  @blocker @security
  Scenario: Every cleanup endpoint refuses a non-admin
    Given Theo is not an admin
    When Theo calls each cleanup endpoint in turn
    Then Theo is refused by every one of them

  @blocker @security
  Scenario: The storage audit is not open to everyone
    Given Theo is not an admin
    When Theo opens the storage audit
    Then Theo is refused

  @blocker @edge
  Scenario: Running a cleanup twice is harmless
    Given Greta has already run the coin cleanup
    When Greta runs it again
    Then nothing further is removed and nothing breaks

  @blocker @edge
  Scenario: Cleaning up nothing is harmless
    Given there is nothing left for the coin cleanup to remove
    When Greta runs it
    Then Greta is told there was nothing to remove

  @blocker @edge
  Scenario: More records than one batch
    Given there are more records than a single batch handles
    When Greta runs the cleanup
    Then every record is removed and none is skipped

  @blocker @edge
  Scenario: Somebody using the feature while it is cleaned
    Given Alice has her wallet open
    When Greta runs the coin cleanup
    Then Alice's app shows her new balance rather than breaking

  @observability
  Scenario: A cleanup is on the record
    Given Greta has run the coin cleanup
    When the audit log is examined
    Then it names what was removed, by whom and when

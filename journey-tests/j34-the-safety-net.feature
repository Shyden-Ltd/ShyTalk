# j34 — the backup that has to work on the worst day, the alarm that has to fire, and
# the date of birth an admin can change.
#
# Personas: P-12 Greta (Web Admin — restores, resolves, corrects),
#           P-02 Alice (Web — her data is what gets lost and restored),
#           P-06 Hayato (Android — the date of birth that moves him between cohorts),
#           P-10 Theo (Android — not an admin, and must stay that way)
#
# Why this journey exists (SHY-0414): the fourth audit pass found the SAFETY NET unwalked.
#
# An untested restore is not a backup, it is a hope. Nothing in 711 scenarios triggered a
# backup, listed one, restored from one, or recovered photos — and the day that matters is
# the day something has already gone wrong.
#
# Alerting is a meta-failure: if it is broken, every other failure becomes invisible, and a
# threshold configured so nothing can ever cross it looks exactly like a healthy system.
#
# modify-dob is a SECOND door to the safeguarding boundary. j04 covers reject_and_dob_down
# thoroughly — the atomic flip, the invalidated session, the eviction from a voice room — and
# this endpoint had none of it, while reaching the same cohort boundary.

Feature: j34 — the net holds
  As the operator relying on backups, alarms and cohort boundaries
  I want each of them exercised before it is needed
  So that "we have backups" and "we would be alerted" are facts, not beliefs

  Background:
    Given this is a disposable environment seeded for the run, not dev or production
    And Alice [P-02] has messages, purchases and photos worth losing

  @blocker
  Scenario: A backup is taken and listed
    When Greta [P-12] triggers a backup
    Then Greta sees it in the list of backups

  @blocker
  Scenario: A backup can be restored
    Given Alice's data has been lost and a backup was taken before that
    When Greta restores from that backup
    Then Alice's data is readable again

  @blocker
  Scenario: Photos can be recovered
    Given Alice's photos have been lost
    When Greta runs photo recovery
    Then Alice's photos are available again

  @blocker
  Scenario: Restoring from nothing is refused
    Given a date with no backup
    When Greta tries to restore from it
    Then Greta is refused

  @blocker @edge
  Scenario: A damaged backup is refused rather than half-restored
    Given a backup that is incomplete
    When Greta tries to restore from it
    Then Greta is refused and nothing is partly written

  @blocker @edge
  Scenario: Two restores do not interleave
    Given a restore is already running
    When Greta starts another
    Then the second waits rather than overlapping the first

  @blocker @security
  Scenario: Restoring is not open to everyone
    Given Theo [P-10] is not an admin
    When Theo tries to restore a backup
    Then Theo is refused

  @blocker @security
  Scenario: Backups cannot be read by guessing a date
    Given Theo is not an admin
    When Theo asks for a backup by its date
    Then Theo is refused

  @observability
  Scenario: A restore is on the record
    Given Greta has restored from a backup
    When the audit log is examined
    Then it names who restored what, and when

  @blocker
  Scenario: An alarm fires when its threshold is crossed
    Given an alert threshold that a real condition will cross
    When that condition occurs
    Then an alert is raised

  @blocker
  Scenario: An alarm is acknowledged and resolved
    Given an alert has been raised
    When Greta acknowledges and resolves it
    Then the alert shows as resolved with who resolved it

  # The misconfiguration that looks exactly like a healthy system.
  @blocker @edge
  Scenario: An alarm that can never fire is visible as such
    Given an alert threshold set so nothing can ever cross it
    When Greta reviews the alert configuration
    Then Greta can see that this alert cannot fire

  @blocker @edge
  Scenario: The same condition twice does not raise two alarms
    Given an alert has already been raised for a condition
    When that condition occurs again before it is resolved
    Then there is still one alert

  @blocker @security
  Scenario: Alerts are not open to everyone
    Given Theo is not an admin
    When Theo opens the alerts
    Then Theo is refused

  @blocker @security
  Scenario: Alert thresholds are not open to everyone
    Given Theo is not an admin
    When Theo tries to change an alert threshold
    Then Theo is refused

  @blocker @security @android-physical
  Scenario: Correcting a date of birth moves the person's cohort
    Given Hayato [P-06] is treated as an adult but is not one
    When Greta corrects his date of birth
    Then Hayato is treated as a minor

  @blocker @security @android-physical
  Scenario: A corrected date takes effect on his device
    Given Greta has corrected Hayato's date of birth
    When Hayato opens the app
    Then Hayato sees the app a minor sees

  @blocker @security @android-physical
  Scenario: A corrected date removes him from adult space
    Given Hayato is in an adult room
    When Greta corrects his date of birth to under eighteen
    Then Hayato is removed from that room

  @blocker @edge
  Scenario: Correcting a date to the same value changes nothing
    Given Hayato's date of birth is already correct
    When Greta sets it to the same date
    Then Hayato is unaffected

  @blocker @security
  Scenario: Changing somebody's date of birth is not open to everyone
    Given Theo is not an admin
    When Theo tries to change Hayato's date of birth
    Then Theo is refused

  @blocker
  Scenario: An admin can tell a member something
    Given Greta has sent Alice a notification
    When Alice opens the app
    Then Alice sees it

  @i18n
  Scenario: The member reads it in their own language
    Given Alice's app is in Indonesian and Greta's panel is in English
    When Greta sends Alice a notification
    Then Alice reads it in Indonesian

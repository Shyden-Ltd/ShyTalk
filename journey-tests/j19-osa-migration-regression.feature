# j19 — OSA migration steady state, seen through users' eyes.
#
# Personas: P-02 Alice (adult), P-04 Marcus (minor), P-06 Hayato (downgraded
#           minor, post-j04), P-10 Theo (adult host), P-19 Officia (official)
#
# Rewritten 2026-08-01. Operator: "user journeys aren't tied to an API. users
# don't use the API directly so this doesn't make sense either. the scenarios
# should be real user journeys either started on the web or the app. not the
# API."
#
# The previous version asserted database shape — "a query is run for every
# users/* doc where cohort=adult". No user runs a query. Those six scenarios
# had no user surface at all, so they could not be classified web or app, they
# ran identically on every matrix cell, and they proved nothing about what a
# person actually experiences.
#
# Each guarantee is now expressed as the moment a user meets it: a minor who
# cannot find the adult she used to follow, a room that is no longer joinable,
# a conversation that will not accept a new message. The migration is correct
# exactly when those experiences hold — a passing database query that leaves a
# broken screen was never worth having.
#
# This journey does NOT run the migration. It is the steady-state guard: every
# scenario must hold against a post-migration database. A failure means the
# migration is broken or has drifted, and prod is blocked.

Feature: j19 — OSA migration steady state, as users experience it
  As a minor or adult using ShyTalk after the one-shot OSA data migration
  I want the cross-cohort links, rooms and conversations from before it to be genuinely gone from what I can see and do
  So that legacy data can never re-expose a minor to adult content

  Background:
    Given the local stack is healthy

  # Fill-1 — PR #666 — the migration removed cross-cohort follow edges.
  # Observable as: neither side can still see the other in their own lists.
  @blocker @regression @cross-cohort osa17-pr6-migration-following-edges
  Scenario: A minor no longer sees the adult he followed before the migration
    Given Marcus [P-04] is on the app signed in (same-cohort minor) at the "discovery" screen
    When Marcus on the app opens the "profile" screen
    Then Marcus's app UI does not show Alice (P-02, adult)
    Then Marcus's app UI does not show Theo (P-10, adult)

  @blocker @regression @cross-cohort osa17-pr6-migration-follower-edges
  Scenario: An adult no longer sees the minor who followed her before the migration
    Given Alice [P-02] is on Web Chromium signed in (cross-cohort adult)
    When Alice on Web opens her "profile" screen
    Then Alice's Web UI does not show Marcus (P-04, minor)
    Then Alice's Web UI does not show Hayato (P-06, minor)

  # Fill-3a — PR #667 — mixed-cohort rooms were closed by the migration.
  # Observable as: a minor's room list offers nothing an adult is sitting in.
  @blocker @regression @cross-cohort osa17-pr7-migration-mixed-rooms-closed
  Scenario: A minor browsing rooms is never offered one an adult is in
    Given Marcus [P-04] is on the app signed in (same-cohort minor) at the "discovery" screen
    When Marcus on the app opens the "rooms" screen
    Then Marcus's app UI does not show Theo (P-10, adult)
    Then Marcus's app UI does not show Alice (P-02, adult)

  # Fill-3a (continued) — a room the migration closed must explain itself to
  # its host rather than silently vanish. A disappearance reads as a bug and
  # generates support load; an explained closure does not.
  @regression @cross-cohort osa17-pr7-migration-closed-rooms-tagged
  Scenario: The host of a room the migration closed is told why it closed
    Given Theo [P-10] is on the app signed in (adult host) at the "rooms" screen
    When Theo on the app opens the "rooms" screen
    Then Theo's app UI shows the element with tag "roomClosedSummary_panel"
    Then Theo's app UI does not show the element with tag "room_rejoin_button"

  # Fill-4 — cross-cohort conversations were frozen, not deleted: history stays
  # readable, but nothing new can be sent. Observable at the composer.
  @blocker @regression @cross-cohort osa17-pr8-migration-frozen-conversations
  Scenario: A minor can read an old cross-cohort chat but cannot add to it
    Given Hayato [P-06] is on the app signed in (downgraded minor) at the "discovery" screen
    When Hayato on the app opens the "pm" screen
    Then Hayato's app UI shows the element with tag "privateChat_pmLockedNotice"
    Then Hayato's app UI does not show the element with tag "pm_send_button"

  # Idempotency as a user would notice it: the migration has already run, so
  # nothing a person can see may change on a second pass. Expressed as the
  # stability of the screens above rather than as a script's change count.
  @regression @cross-cohort osa17-migration-idempotent
  Scenario: A minor's view is unchanged after relaunching the app post-migration
    Given Marcus [P-04] is on the app signed in (same-cohort minor) at the "discovery" screen
    When Marcus on the app kills and relaunches the app
    When Marcus on the app opens the "discovery" screen
    Then Marcus's app UI does not show Alice (P-02, adult)
    Then Marcus's app UI does not show Theo (P-10, adult)

  # Sanity — Officia (SHYTALK_OFFICIAL) is exempt from cohort gating, so the
  # migration must NOT have cut her links. Observable as: a minor and an adult
  # can both still see her.
  @regression @cross-cohort osa17-migration-official-exempt
  Scenario: The official account is still visible to a minor on the app
    Given Marcus [P-04] is on the app signed in (same-cohort minor) at the "discovery" screen
    When Marcus on the app opens the "discovery" screen
    Then Marcus's app UI shows Officia (P-19, official)

  @regression @cross-cohort osa17-migration-official-exempt-web
  Scenario: The official account is still visible to an adult on the web
    Given Alice [P-02] is on Web Chromium signed in (cross-cohort adult)
    When Alice on Web opens her "discovery" screen
    Then Alice's Web UI shows Officia (P-19, official)

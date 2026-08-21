# j37 — the remaining levers an admin can pull, including the ones that touch production
# and the ones that give something back.
#
# Personas: P-12 Greta (Web Admin), P-08 Raul (Android — a suspended device, then not),
#           P-02 Alice (Web — submits a tagged suggestion, has a gift wall),
#           P-10 Theo (Android — not an admin)
#
# Why this journey exists (seventh audit pass): after six passes the route-derived list was
# down to seventeen words, and resolving each to its actual endpoint separated the real from
# the artefacts of word-matching. Four mattered.
#
# /admin/identity-graph/:id/node/:nodeId/unsuspend is the FORGIVING DIRECTION again — the
# pattern SHY-0411 named after finding unblock and unban both at zero while blocking and
# banning were covered thoroughly. A suspended device node that cannot be unsuspended strands
# a real person's phone, and they cannot tell us, because their phone is the thing that is
# stranded.
#
# /admin/migrate-prod-data is the highest-stakes lever left in the product: it moves
# PRODUCTION data. j19 covers the OSA migration's OUTCOMES; nothing covers running one.

Feature: j37 — the last levers
  As an operator with powerful tools and other people's data
  I want the rarely-pulled levers to have been pulled deliberately once
  So that the first time is never in an emergency

  Background:
    Given this is a disposable environment seeded for the run, not dev or production

  @blocker @security @android-physical
  Scenario: A suspended device can be given back
    Given Raul's [P-08] device has been suspended in the identity graph
    When Greta [P-12] unsuspends that device
    Then Raul can use the app from it again

  @blocker @security
  Scenario: Unsuspending a device is not open to everyone
    Given Theo [P-10] is not an admin
    When Theo tries to unsuspend Raul's device
    Then Theo is refused

  @blocker @edge
  Scenario: Unsuspending a device that is not suspended is harmless
    Given Theo's device has never been suspended
    When Greta unsuspends it
    Then Theo is unaffected

  @observability
  Scenario: Giving a device back is recorded
    Given Greta has unsuspended Raul's device
    When the audit log is examined
    Then it names the device, who unsuspended it and when

  @blocker
  Scenario: A decision on a suggestion can be overturned
    Given a suggestion whose dispute was resolved
    When Greta overturns that decision
    Then the suggestion shows the new outcome

  @blocker @security
  Scenario: Overturning is not open to everyone
    Given Theo is not an admin
    When Theo tries to overturn a decision
    Then Theo is refused

  @blocker
  Scenario: Alice can tag what her suggestion is about
    Given Alice [P-02] is writing a suggestion
    When Alice picks a tag for it
    Then Alice's suggestion carries that tag

  @blocker @edge
  Scenario: The tags on offer are the ones we recognise
    Given Alice is writing a suggestion
    When Alice opens the list of tags
    Then Alice sees only tags we recognise

  @blocker
  Scenario: Alice can see who sent a gift on her wall
    Given Alice has received the same gift from several people
    When Alice opens that gift on her wall
    Then Alice sees who sent it

  # The highest-stakes lever left: it moves PRODUCTION data.
  @blocker @security
  Scenario: Migrating production data is not open to everyone
    Given Theo is not an admin
    When Theo tries to run the production data migration
    Then Theo is refused

  @blocker
  Scenario: A migration says what it changed
    Given Greta has run the data migration
    When Greta reads the result
    Then Greta is told what was changed and what was left alone

  @blocker @edge
  Scenario: Running the migration twice changes nothing the second time
    Given Greta has already run the data migration
    When Greta runs it again
    Then nothing further is changed

  @blocker
  Scenario: Clearing group chats leaves private ones
    Given Greta has run the group-chat cleanup
    When Alice opens her private conversations
    Then Alice's private conversations are untouched

  @blocker
  Scenario: Clearing device bindings leaves accounts
    Given Greta has run the device-binding cleanup
    When Alice signs in
    Then Alice reaches her account

  @blocker
  Scenario: Clearing destroyed users leaves live ones
    Given Greta has run the destroyed-user cleanup
    When Alice opens the app
    Then Alice's account is untouched

  @blocker
  Scenario: Clearing identity graphs leaves sign-in working
    Given Greta has cleared the identity graphs
    When Alice signs in on her usual device
    Then Alice reaches her account

  @blocker
  Scenario: The deletion sweep removes only what is due
    Given one account is due for deletion and another is not
    When the deletion sweep runs
    Then the due account is gone and the other remains

  @blocker
  Scenario: A trace can be followed
    Given something has failed and left a trace
    When Greta looks that trace up
    Then Greta can see what happened

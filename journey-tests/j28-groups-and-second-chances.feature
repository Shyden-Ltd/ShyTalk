# j28 — three people in one conversation, and the way back after a block.
#
# Personas: P-02 Alice (Web — creates the group), P-10 Theo (Android), P-15 Selma (iPhone),
#           P-04 Marcus (Android, minor — the cohort that must never join an adult group),
#           P-09 Nora (iPhone) and P-08 Raul (Android) — the block and the way back
#
# Why this journey exists (SHY-0408): group conversations were covered by twelve steps and
# every one was a render assertion — that the name field exists, that the create button
# exists. Nobody ever created a group, added a member, sent a message into one, or left.
# Direct conversations get all of that in j07: create, send, read receipts, edit, delete,
# offline queue. Groups are also where the cohort rules get hardest — a direct conversation
# has one boundary to check, a group has many, and somebody's cohort can flip while they are
# inside it. j04 proves a cohort flip ejects somebody from a voice room; nothing said what it
# does to a group.
#
# Blocking is walked properly by j11, j04 and j18. UNBLOCK had zero steps, so somebody who
# blocks by mistake has an unproven way back.

Feature: j28 — a conversation with more than two people in it
  As someone talking to several people at once
  I want the group to work for everybody in it
  So that a message I send is one they all receive

  Background:
    Given Alice [P-02], Theo [P-10] and Selma [P-15] can all message each other

  @blocker
  Scenario: Alice makes a group
    Given Alice on Web is starting a new conversation
    When Alice creates a group with Theo and Selma
    Then Theo and Selma both see the new conversation

  @blocker @android-physical
  Scenario: A message reaches everybody
    Given Alice, Theo and Selma are in a group
    When Alice sends a message to the group
    Then Theo and Selma both see that message

  @blocker @ios-device
  Scenario: Anybody in the group can reply
    Given Alice has sent a message to the group
    When Selma on iOS replies
    Then Alice and Theo both see Selma's reply

  @blocker @android-physical
  Scenario: Leaving a group
    Given Theo is in a group with Alice and Selma
    When Theo leaves the group
    Then Alice and Selma see that Theo has gone

  @blocker
  Scenario: The group carries on without them
    Given Theo has left the group
    When Alice sends another message
    Then Selma sees it and Theo does not

  @blocker
  Scenario: The creator removes somebody
    Given Alice created the group
    When Alice removes Selma from it
    Then Selma can no longer read the conversation

  @blocker
  Scenario: A group needs a name
    Given Alice on Web is creating a group
    When Alice tries to create it without a name
    Then Alice is told it needs one

  @blocker
  Scenario: A group needs somebody else in it
    Given Alice on Web is creating a group
    When Alice tries to create it with nobody else
    Then Alice is told to add somebody

  @blocker @edge
  Scenario: A group creation that fails leaves nothing behind
    Given creating conversations is failing
    When Alice tries to create a group
    Then Alice is told it failed and no half-made group exists

  @blocker @edge
  Scenario: Sending to a group you have left
    Given Theo has left the group
    When Theo tries to send a message to it
    Then Theo is refused

  @blocker @edge
  Scenario: The largest group allowed
    Given Alice has added as many people as a group allows
    When Alice tries to add one more
    Then Alice is told the group is full

  @blocker @edge
  Scenario: The last person leaves
    Given Alice is the only person left in the group
    When Alice leaves it
    Then the conversation is closed rather than left empty

  @blocker @edge
  Scenario: The creator leaves
    Given Alice created the group and Theo and Selma are still in it
    When Alice leaves
    Then Theo and Selma can still use the conversation

  @blocker @security
  Scenario: A minor and an adult cannot share a group
    Given Alice is an adult and Marcus [P-04] is under 18
    When Alice tries to add Marcus to her group
    Then Alice is refused

  @blocker @security @edge
  Scenario: Somebody whose cohort changes while in a group
    Given Selma is in an adult group and her cohort changes to minor
    When Selma opens the group
    Then Selma no longer has access to it

  @blocker @security
  Scenario: A group is private to its members
    Given Alice, Theo and Selma are in a group
    When Vexa [P-07] asks for that conversation directly
    Then Vexa is refused

  @blocker @security
  Scenario: Only the creator can remove people
    Given Theo is in Alice's group
    When Theo tries to remove Selma
    Then Theo is refused

  @i18n
  Scenario: A leaving notice reads in each person's own language
    Given Selma's app is in Indonesian and Theo's is in English
    When Theo leaves the group
    Then Selma reads the notice in Indonesian

  @edge
  Scenario: A group name in another script
    Given Alice has named the group in Thai
    When Theo opens his conversations
    Then Theo sees the Thai name rendered correctly

  @blocker @android-physical
  Scenario: Nora takes back a block
    Given Nora [P-09] has blocked Raul [P-08]
    When Nora unblocks him
    Then Nora and Raul can find each other again

  @blocker @android-physical
  Scenario: Messaging works again after an unblock
    Given Nora has unblocked Raul
    When Raul sends Nora a message
    Then Nora receives it

  @blocker @security
  Scenario: Unblocking restores contact and nothing more
    Given Nora has unblocked Raul
    When Raul tries to reach something he never had access to
    Then Raul is refused

  @observability
  Scenario: A block and an unblock are both recorded
    Given Nora has blocked and then unblocked Raul
    When the record is examined
    Then both actions are there with their times

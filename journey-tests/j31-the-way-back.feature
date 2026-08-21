# j31 — the forgiving direction: a dispute that is rejected, and a ban that is lifted.
#
# Personas: P-12 Greta and a second admin (Web Admin — two people, so "another admin sees it"
#           is a real assertion), P-08 Raul (Android — banned, then unbanned),
#           P-02 Alice (Web — the suggestion author caught up in a dispute),
#           P-10 Theo (Android — not an admin, and must stay that way)
#
# Why this journey exists (SHY-0411): the audit found a pattern worth naming. The PUNISHING
# direction is always walked and the FORGIVING direction often is not. Blocking is covered by
# j11, j04 and j18 — unblock had zero steps. Bans and suspensions are covered by moderation,
# j11 and j12 — unban had zero. Suggestions have a full dispute process with an uphold and a
# reject, and neither had a scenario.
#
# That asymmetry matters for a specific reason: somebody wrongly punished is exactly the
# person least able to tell us the way back is broken. They cannot reach us to say so.

Feature: j31 — a decision made about somebody can be undone
  As someone a decision went against
  I want the way back to work on the day I need it
  So that being wrong about me is recoverable

  Background:
    Given Greta [P-12] and a second admin can both reach the admin panel

  @blocker
  Scenario: A dispute reaches the queue
    Given Greta has disputed one of Alice's [P-02] suggestions
    When the second admin opens the dispute queue
    Then the dispute is there

  @blocker
  Scenario: Upholding a dispute
    Given Alice's suggestion has an open dispute
    When the second admin upholds it
    Then the suggestion shows that outcome

  @blocker
  Scenario: Rejecting a dispute
    Given Alice's suggestion has an open dispute
    When the second admin rejects it
    Then the suggestion shows that outcome

  @blocker @edge
  Scenario: A suggestion cannot be disputed twice
    Given Alice's suggestion already has an open dispute
    When Greta disputes it again
    Then Greta is told there is already one open

  @blocker @edge
  Scenario: A dispute cannot be resolved twice
    Given a dispute that has already been resolved
    When Greta tries to resolve it again
    Then Greta is refused

  @blocker
  Scenario: Alice can tell what happened to her suggestion
    Given Alice's disputed suggestion has been resolved
    When Alice opens her suggestion
    Then Alice can see the outcome

  @blocker
  Scenario: Commenting on a suggestion
    Given Alice has a suggestion others can see
    When Theo [P-10] comments on it
    Then Alice sees Theo's comment

  @blocker
  Scenario: Merging keeps both sets of votes
    Given two suggestions each with votes on them
    When Greta merges them
    Then the surviving suggestion carries both sets of votes

  @blocker @edge
  Scenario: A suggestion cannot be merged into itself
    Given a suggestion with votes on it
    When Greta tries to merge it with itself
    Then Greta is refused

  @blocker @edge
  Scenario: A comment survives a merge
    Given Theo commented on a suggestion that is then merged away
    When Alice opens the surviving suggestion
    Then Theo's comment is still readable

  @blocker @security
  Scenario: Disputing is not open to everyone
    Given Theo is not an admin
    When Theo tries to dispute a suggestion
    Then Theo is refused

  @blocker @security
  Scenario: Resolving a dispute is not open to everyone
    Given Theo is not an admin
    When Theo tries to uphold a dispute
    Then Theo is refused

  @blocker @security
  Scenario: Merging is not open to everyone
    Given Theo is not an admin
    When Theo tries to merge two suggestions
    Then Theo is refused

  @blocker @security
  Scenario: A comment cannot be posted as somebody else
    Given Theo can comment on suggestions
    When Theo tries to comment as Alice
    Then Theo is refused

  @blocker @android-physical
  Scenario: A lifted ban gives the app back
    Given Raul [P-08] has been banned and Greta has lifted it
    When Raul opens the app on Android
    Then Raul can use it again

  @blocker @android-physical
  Scenario: The ban lifts without a reinstall
    Given Raul has the app open on the banned screen
    When Greta lifts his ban
    Then Raul reaches the app without reinstalling it

  @blocker @edge
  Scenario: Lifting every ban lifts every one of them
    Given Raul is banned by device and by network at the same time
    When Greta lifts all of his bans
    Then Raul can use the app from that device and that network

  @blocker @edge
  Scenario: Unbanning somebody who is not banned is harmless
    Given Theo has never been banned
    When Greta lifts Theo's bans
    Then Theo is unaffected

  @blocker @security
  Scenario: Lifting a ban is not open to everyone
    Given Theo is not an admin
    When Theo tries to lift Raul's ban
    Then Theo is refused

  @observability
  Scenario: Every reversal is recorded
    Given Greta has lifted a ban and rejected a dispute
    When the record is examined
    Then both decisions are there with who made them and when

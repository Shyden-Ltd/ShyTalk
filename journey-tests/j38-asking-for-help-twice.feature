# j38 — what happens when somebody needs help a second time.
#
# Personas: P-02 Alice (Android + iPhone — already has a request open),
#           P-05 Lena (Android — has never contacted support),
#           P-12 Greta (Web Admin — the far end, who has to action what arrives)
#
# Why this journey exists (SHY-0396): the app REFUSED a second support request. The server
# answered 409 and the form disabled its Send button, telling the person "you already have
# a request open, we will reply to that one." So somebody with a payment problem open, who
# then had their account broken into, could not tell us — the new problem reached nobody.
#
# That was never what was asked for. A second request must be ALLOWED. What the person
# needs is a WARNING: here is what you already told us, adding to that one is faster, and
# raising a duplicate for the same problem puts you at the back of the queue. Then three
# choices — it's the same problem, it's a new problem, or go back.
#
# The distinction this journey defends is between a WARNING and a WALL. A warning that
# cannot be passed is a wall with better manners, and the test that cannot tell them apart
# is the test that let this ship.

Feature: j38 — asking for help when you have already asked once
  As somebody who already has a request open
  I want to be able to raise a different problem, and to be told when I am repeating myself
  So that a second problem still reaches somebody, and a duplicate does not slow me down

  Background:
    Given Alice already has one support request open

  Scenario: The second problem still gets through
    Given Alice has a different problem from the one she reported
    When she sends it
    Then it reaches support as its own request

  Scenario: She is shown what she already told us
    Given Alice starts a second request
    When she sends it
    Then she is shown a short summary of the request she already has open

  Scenario: She is warned that repeating herself is slower
    Given Alice starts a second request
    When she sends it
    Then she is told a duplicate of the same problem goes to the back of the queue

  Scenario: She is offered three ways forward
    Given Alice has been warned about her open request
    When she reads her choices
    Then she can say it is the same problem, or a new problem, or go back

  Scenario: Adding to the problem she already reported
    Given Alice has been warned about her open request
    When she says it is the problem she already reported
    Then her words are added to that request instead of starting another

  Scenario: Going back does not cost her what she wrote
    Given Alice has typed a long explanation and been warned
    When she chooses to go back
    Then everything she typed is still there

  Scenario: Somebody with nothing open is not warned at all
    Given Lena has never contacted support
    When she sends a request
    Then she sees no warning and her request is raised

  Scenario: An admin can tell the two requests apart
    Given Alice has raised a second request for a different problem
    When Greta opens the support queue
    Then she sees two separate requests, each with its own words

  Scenario: An admin sees the added words on the original request
    Given Alice has added to the request she already had open
    When Greta opens that request
    Then she sees both what Alice said first and what she added

  Scenario: Somebody else's request is never shown to her
    Given another person also has a request open
    When Alice is warned about her own
    Then she is shown only her own request

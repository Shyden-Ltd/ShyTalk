# j30 — the gifts sitting in Selma's backpack, and the notice an admin puts in front
# of everybody.
#
# Personas: P-15 Selma (Android — has been given gifts), P-10 Theo (iPhone — receives one),
#           P-07 Vexa (Web — reaches for somebody else's things),
#           P-12 Greta (Web Admin — publishes what members see first)
#
# Why this journey exists (SHY-0410): gifting is covered well in j01, j05, j15 and j17 — and
# every one of them BUYS a gift and sends it. Sending something already owned is a different
# path with different arithmetic, and neither reading a backpack nor sending from one
# appeared in 610 scenarios. Trials are a claim-then-activate pair, and an unwalked state
# between two steps is where somebody ends up having claimed something they cannot activate.
# Banners are read by every member's app through /banners/active, and nobody had ever
# published one and watched it appear — the 48 corpus hits for "banner" are all in-app cohort
# and frozen-conversation banners, a different feature entirely. Reorder had nothing, and an
# ordering endpoint with no test is an ordering that will quietly stop being one.

Feature: j30 — what I own is mine, and what you publish reaches me
  As someone who has been given gifts and is shown notices
  I want my things to be mine and your notices to arrive
  So that ownership and announcements both mean something

  Background:
    Given Selma [P-15] has gifts in her backpack that other people sent her

  @blocker @android-physical
  Scenario: Selma sees what she owns
    When Selma on Android opens her backpack
    Then Selma sees the gifts she has been given

  @blocker @android-physical
  Scenario: Selma passes one on
    Given Selma has a rose in her backpack
    When Selma sends it to Theo [P-10]
    Then Theo has the rose and Selma no longer does

  @blocker @ios-device
  Scenario: Theo sees it arrive
    Given Selma has sent Theo a gift from her backpack
    When Theo opens his backpack on iOS
    Then Theo sees the gift Selma sent

  @blocker @android-physical
  Scenario: You cannot send what you do not have
    Given Selma's backpack is empty
    When Selma tries to send a gift from it
    Then Selma is refused

  @blocker @edge @android-physical
  Scenario: Sending the same thing twice sends it once
    Given Selma has one rose in her backpack
    When Selma sends it twice in quick succession
    Then Theo receives one rose

  @blocker @edge @android-physical
  Scenario: An empty backpack says so
    Given Marcus [P-04] has never been given a gift
    When Marcus opens his backpack
    Then Marcus is told there is nothing there yet

  @blocker @edge @android-physical
  Scenario: A backpack longer than one screen
    Given Selma has more gifts than fit on one screen
    When Selma scrolls to the end of her backpack
    Then Selma reaches her last gift

  @blocker @security
  Scenario: Nobody can look in somebody else's backpack
    Given Selma has gifts in her backpack
    When Vexa [P-07] asks to see Selma's backpack
    Then Vexa is refused

  @blocker @security
  Scenario: Nobody can send out of somebody else's backpack
    Given Selma has a rose in her backpack
    When Vexa tries to send Selma's rose
    Then Vexa is refused

  @blocker @android-physical
  Scenario: Claiming a trial and using it
    Given Selma is offered a trial
    When Selma claims it and activates it
    Then Selma has what the trial grants

  @blocker @android-physical
  Scenario: A trial has to be claimed before it is activated
    Given Selma has not claimed a trial
    When Selma tries to activate one
    Then Selma is refused

  @blocker @edge @android-physical
  Scenario: A trial cannot be claimed twice
    Given Selma has already claimed her trial
    When Selma claims it again
    Then Selma is told she has already had it

  @blocker @edge @android-physical
  Scenario: An expired trial cannot be activated
    Given Selma's claimed trial has expired
    When Selma tries to activate it
    Then Selma is refused

  @blocker @security
  Scenario: A trial cannot be claimed for somebody else
    Given Selma has not claimed her trial
    When Vexa tries to claim Selma's trial
    Then Vexa is refused

  @blocker @android-physical
  Scenario: A published notice reaches members
    Given Greta [P-12] has published a banner
    When Selma opens the app
    Then Selma sees that banner

  @blocker @android-physical
  Scenario: The order Greta sets is the order Selma sees
    Given Greta has reordered the banners
    When Selma opens the app
    Then Selma sees them in that order

  @blocker @android-physical
  Scenario: Removing a banner removes it for members
    Given Greta has deleted a banner members were seeing
    When Selma opens the app
    Then Selma no longer sees it

  @blocker @edge @android-physical
  Scenario: No banners at all
    Given Greta has published no banners
    When Selma opens the app
    Then Selma sees no empty space where banners would be

  @blocker @security
  Scenario: Publishing a banner is not open to everyone
    Given Selma is not an admin
    When Selma tries to publish a banner
    Then Selma is refused

  @blocker @security
  Scenario: Reordering banners is not open to everyone
    Given Selma is not an admin
    When Selma tries to reorder the banners
    Then Selma is refused

  @blocker @security
  Scenario: Editing a banner is not open to everyone
    Given Selma is not an admin
    When Selma tries to edit a banner
    Then Selma is refused

  @blocker @security
  Scenario: Deleting a banner is not open to everyone
    Given Selma is not an admin
    When Selma tries to delete a banner
    Then Selma is refused

  @i18n @ios-device
  Scenario: A banner reads in the member's language
    Given Greta has published a banner and Theo's app is in Korean
    When Theo opens the app
    Then Theo reads the banner in Korean

  @observability
  Scenario: Passing a gift on is recorded
    Given Selma has sent Theo a gift from her backpack
    When the record is examined
    Then the transfer is there with both people and the time

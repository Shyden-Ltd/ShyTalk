# j27 — the record a moderator relies on, and the setting that decides which rules apply.
#
# Personas: P-08 Raul (Android — edits a message after being reported),
#           P-09 Nora (iPhone — the person who reported it),
#           P-12 Greta (Web Admin — the only person for whom edit history matters),
#           P-01 Adam (Android — sets a country and lives under its rules)
#
# Why this journey exists (SHY-0403): message edit history and the country picker were both
# at ZERO steps. Edit history is the sharpest of the two: its entire purpose is that somebody
# cannot say something abusive, be reported, and then edit it into something innocent. If it
# silently stopped recording, nothing in the suite would notice — the failure would first
# appear as a moderator unable to act on a real report, which is the worst possible place to
# discover it. j07 walks Adam EDITING a message and Alice seeing the update; nobody has ever
# opened the history from the moderator's side, which is the only side that matters.
#
# The country picker decides which jurisdiction's age rules apply, and jurisdiction follows
# the USER. Indonesia is stricter than the UK on exactly the mechanics ShyTalk contains, so a
# picker that writes the wrong value puts somebody under the wrong regime.

Feature: j27 — the record holds and the rules follow the person
  As a moderator deciding what to do about a report
  I want to read what was actually said, not what it was edited into
  So that somebody cannot escape a report by rewriting it

  Background:
    Given Raul [P-08] has sent Nora [P-09] a message that Nora has reported

  @blocker @android-physical
  Scenario: A moderator reads what the message said before
    Given Raul has edited the reported message into something harmless
    When Greta [P-12] opens the message's history
    Then Greta reads the wording Nora reported

  @blocker
  Scenario: Every version is kept, in order
    Given Raul has edited the same message three times
    When Greta opens the message's history
    Then Greta sees all three versions oldest first

  @blocker
  Scenario: An unedited message has an honest history
    Given Raul has not edited the reported message
    When Greta opens the message's history
    Then Greta sees only the original wording

  @blocker @security
  Scenario: The history is not readable by the other person in the chat
    Given Raul has edited the reported message
    When Nora tries to open the message's history
    Then Nora is refused

  @blocker @security
  Scenario: The history is not readable by its author
    Given Raul has edited his own message
    When Raul tries to open its history
    Then Raul is refused

  @blocker @edge
  Scenario: A cohort change does not lose the record
    Given Raul's cohort changed after Nora reported him
    When Greta opens the message's history
    Then Greta still reads the wording Nora reported

  @observability
  Scenario: An edit records who made it and when
    Given Raul has edited the reported message
    When Greta opens the message's history
    Then Greta sees when each version was written

  @blocker @android-physical
  Scenario: Adam chooses where he is
    Given Adam [P-01] is setting up his profile
    When Adam chooses his country
    Then Adam's account records that country

  @blocker @android-physical
  Scenario: The country decides which rules apply
    Given Adam has chosen a country with stricter age rules
    When Adam opens a feature those rules restrict
    Then Adam is held to the stricter rule

  @blocker @edge @android-physical
  Scenario: Backing out of the picker changes nothing
    Given Adam has already chosen a country
    When Adam opens the picker and backs out
    Then Adam's country is unchanged

  @blocker @edge @android-physical
  Scenario: A country late in the list can be reached
    Given Adam is choosing his country
    When Adam picks one from the end of the list
    Then Adam's account records that country

  @blocker @security
  Scenario: Nobody can set somebody else's country
    Given Adam has chosen his country
    When Raul tries to change Adam's country
    Then Raul is refused

  @i18n @android-physical
  Scenario: Country names read in the reader's language
    Given Adam's app is in Japanese
    When Adam opens the country picker
    Then Adam reads the country names in Japanese

  @blocker
  Scenario: The first screen an admin sets is the one people see
    Given Greta has published a blocking starting screen
    When Adam opens the app
    Then Adam sees that screen and cannot dismiss it

  @blocker @edge
  Scenario: A dismissable starting screen can be dismissed
    Given Greta has published a dismissable starting screen
    When Adam dismisses it
    Then Adam reaches the app

  @blocker @edge
  Scenario: An unreachable starting-screen setting does not blank the app
    Given the starting-screen setting cannot be read
    When Adam opens the app
    Then Adam reaches the app rather than a blank screen

  @blocker @security
  Scenario: Starting screens are not open to everyone
    Given Adam is not an admin
    When Adam opens the starting-screens settings
    Then Adam is refused

  @blocker @security
  Scenario: The age-segregation dashboard is not open to everyone
    Given Adam is not an admin
    When Adam opens the age-segregation dashboard
    Then Adam is refused

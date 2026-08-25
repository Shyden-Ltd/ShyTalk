# j39 — the files people hand us, and what we do with them.
#
# Personas: P-09 Nora (Android + iPhone — attaches evidence to a safety report),
#           P-02 Alice (iPhone — attaches a screenshot to a support request),
#           P-08 Raul (Android — the person who sends us something dangerous),
#           P-12 Greta (Web Admin — has to look at all of it)
#
# Why this journey exists (SHY-0420): attachments went in with SHY-0387 and the rules were
# never set. Three gaps, all of them ours rather than the customer's:
#
#   1. One flat 25 MB byte cap covers both images and video. A video wants bounding by
#      DURATION — a 30-second clip is the limit that means something to a person.
#   2. Nothing is scanned. Strangers upload files and staff open them. That is a malware
#      path into the company with no gate on it.
#   3. Admins can DOWNLOAD them. The attachment route mints a signed GET URL, so a
#      moderator can pull a stranger's file onto their own machine. Viewing is the job;
#      taking a copy is not.
#
# A minor cohort is present and safety reports carry images of real people, so this is a
# safeguarding matter, not a file-handling nicety.
#
# The scenario worth defending hardest is the one where a bad file arrives: the REPORT must
# still get through. Losing somebody's report because their attachment failed a scan would
# punish the person raising the alarm.

Feature: j39 — attaching evidence, safely
  As somebody showing us what happened
  I want to attach what I have, and to trust it is handled safely
  So that the thing I am describing can be seen without putting anyone at risk

  Background:
    Given Nora is reporting something she has evidence of

  Scenario: She can attach what she has
    Given Nora has a screenshot and a short clip
    When she attaches them to her report
    Then both are accepted

  Scenario: She is told the limits before she chooses
    Given Nora is about to attach a file
    When she looks at the attachment control
    Then it tells her how many files and how large or long they may be

  Scenario: Too many files is refused kindly
    Given Nora has already attached ten files
    When she tries to attach an eleventh
    Then she is told ten is the limit

  Scenario: A screenshot that is too large is refused
    Given Nora has a screenshot larger than the limit
    When she attaches it
    Then she is told it is too large, and which file it was

  Scenario: A video that is too long is refused
    Given Nora has a clip longer than thirty seconds
    When she attaches it
    Then she is told the clip is too long

  Scenario: A long, small video is still refused for its LENGTH
    Given Nora has a two-minute clip that is only a few megabytes
    When she attaches it
    Then she is told the clip is too long

  Scenario: A dangerous file never reaches a moderator
    Given Raul attaches an infected file to a report
    When Greta opens that report
    Then the file is not there

  Scenario: A bad attachment never costs somebody their report
    Given Raul's report carried an infected file
    When Greta opens the support queue
    Then his report is there, with everything he wrote

  Scenario: A file still being checked is not shown as broken
    Given Alice has just attached a screenshot
    When the check has not finished
    Then it shows as still being checked

  Scenario: When the checker is unavailable, nothing is shown
    Given the file checker cannot be reached
    When Greta opens a report with an attachment
    Then the file is withheld rather than shown unchecked

  Scenario: A moderator can see a file but cannot take it
    Given Greta is looking at an attachment
    When she tries to save it
    Then she cannot, and she can still see it

  Scenario: One person cannot reach another person's upload
    Given Raul knows the name of a file Nora uploaded
    When he refers to it in his own report
    Then it is refused

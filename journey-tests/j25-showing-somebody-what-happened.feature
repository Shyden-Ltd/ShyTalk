# j25 — every place a person can hand ShyTalk a file, and the person at the far end
# who has to see it.
#
# Personas: P-09 Nora (Android + iPhone — reports with evidence), P-08 Raul (Android — the
#           person being reported, and the one who must not reach anybody else's upload),
#           P-12 Greta (Web Admin — the far end for evidence and support attachments),
#           P-02 Alice (Web — the far end for a private-message image),
#           P-04 Marcus (Android, minor — support is never age-gated)
#
# Why this journey exists (SHY-0401, SHY-0400): a journey audit of 471 scenarios found that
# EXACTLY ONE upload flow is walked end to end — age verification, in j01 and j21, which
# picks from the gallery, submits, hits the "Image too large" refusal, and crosses the seam
# into "Greta's Web Admin UI shows the ID image". Every other file a person can send had
# nothing: the word "attach" appeared in zero steps. That is how SHY-0400 survived — the
# admin panel has a complete video-evidence path, isVideoUrl and a <video> element and a
# lightbox, and the client can never produce one, because both pickers are images-only and
# the content type is hardcoded. Dead code on a moderation surface with minors present.
#
# Every scenario here names the FAR END. A journey that stops at "the app accepted it"
# proves the picker works and nothing else.

Feature: j25 — a file reaches the person who needs to see it
  As someone who cannot describe in words what happened to me
  I want to show it instead
  So that the person deciding what to do about it can see what I saw

  Background:
    Given Nora [P-09] has a screenshot and a screen recording on her phone

  @blocker @android-physical
  Scenario: A moderator sees the screenshot Nora attached
    Given Nora on Android is reporting Raul [P-08]
    When Nora attaches her screenshot and sends the report
    Then Greta [P-12] can see that screenshot on Nora's report

  @blocker @android-physical
  Scenario: A moderator can play the video Nora attached
    Given Nora on Android is reporting Raul
    When Nora attaches her screen recording and sends the report
    Then Greta can play that recording on Nora's report

  @blocker @ios-device
  Scenario: The same from Nora's iPhone
    Given Nora on iOS is reporting Raul
    When Nora attaches her screen recording and sends the report
    Then Greta can play that recording on Nora's report

  @blocker @android-physical
  Scenario: An image sent in a private message arrives
    Given Nora on Android is in a private conversation with Alice [P-02]
    When Nora sends her screenshot to Alice
    Then Alice sees that image in the conversation

  @blocker @android-physical
  Scenario: A sticker arrives
    Given Nora on Android is in a private conversation with Alice
    When Nora sends a sticker
    Then Alice sees that sticker in the conversation

  @blocker @android-physical
  Scenario: A new profile photo is what other people see
    Given Nora on Android is editing her profile
    When Nora sets her screenshot as her profile photo
    Then Alice sees Nora's new photo on Nora's profile

  @blocker @android-physical
  Scenario: A support ticket carries what was attached
    Given Nora on Android is writing to support
    When Nora attaches her screenshot and sends the ticket
    Then Greta can see that screenshot on Nora's ticket

  @blocker @android-physical
  Scenario: Support is not age-gated
    Given Marcus [P-04] is under 18 and is writing to support
    When Marcus attaches a screenshot and sends the ticket
    Then Greta can see that screenshot on Marcus's ticket

  @blocker @android-physical
  Scenario: A file too large is refused before anything is sent
    Given Nora on Android is reporting Raul
    When Nora attaches a recording larger than the limit
    Then Nora is told it is too large and nothing has been uploaded

  @blocker @android-physical
  Scenario: A file of the wrong kind is refused at the picker
    Given Nora on Android is reporting Raul
    When Nora tries to attach a file that is neither an image nor a video
    Then Nora is told it cannot be attached

  @blocker @android-physical
  Scenario: An upload that fails keeps what she typed
    Given Nora on Android has written a report and uploading is failing
    When Nora attaches her screenshot
    Then Nora is told it could not be attached and her report is still there

  @blocker @android-physical
  Scenario: The report can still be sent without the attachment
    Given Nora's attachment failed to upload
    When Nora sends the report anyway
    Then Greta sees Nora's report without an attachment

  @blocker @edge @android-physical
  Scenario: Backing out of the picker changes nothing
    Given Nora on Android has written a report
    When Nora opens the picker and backs out of it
    Then Nora's report is exactly as she left it

  @blocker @edge @android-physical
  Scenario: Attaching, removing and attaching again
    Given Nora on Android has attached two screenshots
    When Nora removes the first and attaches a third
    Then Greta sees the second and third on Nora's report

  @blocker @edge @android-physical
  Scenario: The most that can be attached
    Given Nora on Android has attached as many files as are allowed
    When Nora tries to attach one more
    Then Nora is told she has reached the limit

  @blocker @security
  Scenario: Nobody can reach somebody else's upload
    Given Nora has attached a screenshot to her report
    When Raul asks for that file directly
    Then Raul is refused

  @blocker @security
  Scenario: A support attachment is not readable by other members
    Given Nora has attached a screenshot to her support ticket
    When Alice asks for that file directly
    Then Alice is refused

  @blocker @security
  Scenario: An upload slot issued to one person is not usable by another
    Given Nora has been given somewhere to upload her screenshot
    When Raul tries to upload to Nora's slot
    Then Raul is refused

  @edge @android-physical
  Scenario: Losing connection mid-upload
    Given Nora on Android is uploading a recording and the connection drops
    When Nora looks at her report
    Then Nora is told the attachment did not finish

  @i18n @android-physical
  Scenario: The refusal reads in Nora's language
    Given Nora's app is in Thai and she is reporting Raul
    When Nora attaches a recording larger than the limit
    Then Nora reads in Thai that it is too large

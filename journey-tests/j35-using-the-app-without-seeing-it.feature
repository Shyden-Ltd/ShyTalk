# j35 — the app used by somebody who cannot see it, cannot read small text, or holds
# the phone the other way round.
#
# Personas: P-02 Alice (Android + iPhone — uses a screen reader),
#           P-10 Theo (Android — largest system font),
#           P-09 Nora (iPhone — rotates mid-message, and whose session runs out)
#
# Why this journey exists (SHY-0415): the fifth audit pass changed axis from features to
# cross-cutting STATES, and found the app has no accessibility journey at all. The WEB is
# fine — seven Playwright spec files cover aria labels, screen-reader-only labels and their
# localisation, down to "TOTP code input has associated label". The APP had nothing: of 733
# scenarios the three matching "accessible" use the word in its other sense, as in "Legal
# screens are accessible from settings", which is a navigation assertion.
#
# There is direct evidence of the cost. While driving the support form on a device during
# this session, the control that opens Settings turned out to be an ICON BUTTON WITH NO
# CONTENT DESCRIPTION — invisible to a screen reader, and noticed only because somebody was
# reading the accessibility tree to write a test.
#
# These scenarios are DRIVEN THROUGH THE ACCESSIBILITY TREE, not by coordinate. That is the
# assertion: a control with no name cannot be reached that way, so the journey fails by being
# unable to continue rather than by a separate check somebody has to remember to write.

Feature: j35 — the app works for somebody who cannot see it
  As someone who uses a screen reader, or needs bigger text
  I want the app to have been used the way I use it
  So that it works for me, rather than merely never having been tested against me

  Background:
    Given Alice [P-02] uses the app with a screen reader turned on

  @blocker @a11y @android-physical
  Scenario: Signing in without seeing the screen
    When Alice signs in using the screen reader
    Then Alice reaches the main screen

  @blocker @a11y @android-physical
  Scenario: Sending a message without seeing the screen
    Given Alice is in a room
    When Alice sends a message using the screen reader
    Then Alice is told the message was sent

  @blocker @a11y @ios-device
  Scenario: The same on her iPhone
    Given Alice is in a room on iOS with the screen reader on
    When Alice sends a message using the screen reader
    Then Alice is told the message was sent

  @blocker @a11y @android-physical
  Scenario: Every control on the settings screen says what it is
    Given Alice has opened settings with the screen reader
    When Alice moves through every control
    Then each one announces a meaningful name

  # The specific defect found by accident during SHY-0385: an icon button with nothing.
  @blocker @a11y @android-physical
  Scenario: The control that opens settings has a name
    Given Alice is on her profile with the screen reader
    When Alice moves to the control that opens settings
    Then it announces what it does

  @blocker @a11y @android-physical
  Scenario: Reading order follows what is on screen
    Given Alice has opened a room with the screen reader
    When Alice moves forward through the screen
    Then the order she hears matches the order things appear

  @blocker @a11y @android-physical
  Scenario: An error is announced, not just shown
    Given Alice is sending a message that will fail
    When the send fails
    Then Alice hears why

  @blocker @a11y @android-physical
  Scenario: A refused form moves focus somewhere useful
    Given Alice has left a required field empty
    When Alice submits the form
    Then Alice is taken to the field that needs her

  @blocker @a11y @security @android-physical
  Scenario: A locked app announces nothing behind the lock
    Given Alice's app is locked and the screen reader is on
    When Alice moves through the screen
    Then nothing behind the lock is announced

  @blocker @a11y @i18n @ios-device
  Scenario: Announcements are in the reader's language
    Given Alice's app is in Arabic with the screen reader on
    When Alice moves through the main screen
    Then Alice hears Arabic

  @blocker @a11y @android-physical
  Scenario: The app at the largest text size
    Given Theo [P-10] has set his system font to its largest
    When Theo opens a room
    Then Theo can read the messages and reach the controls

  @blocker @a11y @edge @android-physical
  Scenario: Big text does not cut a sentence in half
    Given Theo has set his system font to its largest
    When Theo opens the age-restriction notice
    Then Theo can read the whole message

  @blocker @edge @ios-device
  Scenario: Turning the phone sideways keeps what was typed
    Given Nora [P-09] has typed part of a message
    When Nora rotates the device
    Then what Nora typed is still there

  @blocker @edge @android-physical
  Scenario: A room still works sideways
    Given Theo is in a room
    When Theo rotates the device
    Then Theo can still see the seats and reach the controls

  @blocker @edge @ios-device
  Scenario: A session that runs out mid-message
    Given Nora has typed part of a message and her session has expired
    When Nora sends it
    Then Nora is not silently dropped and her words are not lost

  @blocker @security @ios-device
  Scenario: An expired session cannot keep reading
    Given Nora's session has expired
    When Nora's app asks for her conversations
    Then it is refused until she signs in again

  @blocker @edge @android-physical
  Scenario: A session that refreshes quietly
    Given Theo's session is about to expire while he is reading a room
    When the session refreshes
    Then Theo is not interrupted

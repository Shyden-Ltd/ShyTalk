# j24 — Nora locks her app because other people pick up her phone, and manages the
# ways she can get back into her account.
#
# Personas: P-09 Nora (Android + iPhone — the person being protected),
#           P-08 Raul (Android — the person the lock exists to stop),
#           P-02 Alice (Web — sends the message whose notification must not open a locked app)
#
# Why this journey exists (SHY-0406): App Lock had five journey steps and every one was about
# the TOGGLE — that it renders, that it can be tapped, that a timeout label appears. Nothing
# ever left the app and came back, so the entire purpose of the feature was unproven; a
# regression that left the app unlocked on return would have passed all five. SHY-0196 is
# about to move App Lock onto the device OS credential, and there was no baseline to regress
# against. Linked accounts was four render scenarios and nobody ever completed an unlink,
# including the last-provider case that locks somebody out of their account forever.

Feature: j24 — Nora's phone stays hers
  As someone whose phone gets picked up by other people
  I want leaving and coming back to demand my credentials
  So that App Lock protects something rather than merely appearing in settings

  Background:
    Given Nora [P-09] has App Lock switched on with the shortest timeout

  @blocker @android-physical
  Scenario: Coming back demands credentials
    Given Nora on Android has left the app for longer than the timeout
    When Nora returns to the app
    Then Nora is asked for her credentials before she can see anything

  @blocker @android-physical
  Scenario: Providing them returns her to where she was
    Given Nora on Android is facing the lock
    When Nora provides her credentials
    Then Nora is back on the screen she left

  @blocker @security @android-physical
  Scenario: Failing the credential reveals nothing
    Given Nora on Android is facing the lock
    When Raul [P-08] fails the credential
    Then Raul still cannot see anything behind the lock

  @blocker @security @android-physical
  Scenario: Cancelling leaves it locked
    Given Nora on Android is facing the lock
    When Raul dismisses the credential prompt
    Then the app is still locked

  # Both sides of the boundary. A lock that never fires and one that always fires
  # each pass a one-sided test.
  @blocker @edge @android-physical
  Scenario: Returning before the timeout asks for nothing
    Given Nora on Android has left the app for less than the timeout
    When Nora returns to the app
    Then Nora is not asked for anything

  @blocker @android-physical
  Scenario: Switching App Lock off means no lock
    Given Nora on Android has switched App Lock off
    When Nora leaves the app and returns after the timeout
    Then Nora is not asked for anything

  @blocker @security @android-physical
  Scenario: Force-killing and relaunching still locks
    Given Nora on Android has force-killed the app
    When Nora relaunches it
    Then Nora is asked for her credentials

  @blocker @security @android-physical
  Scenario: A notification cannot open a locked app
    Given Nora on Android has a locked app and a new message from Alice [P-02]
    When Raul taps the notification
    Then Raul reaches the lock instead of the message

  @blocker @security @android-physical
  Scenario: A link cannot open a locked app
    Given Nora on Android has a locked app
    When Raul opens a link that points into the app
    Then Raul reaches the lock instead of that screen

  @blocker @security @android-physical
  Scenario: The recents preview shows nothing
    Given Nora on Android has locked the app
    When Raul opens the list of recent apps
    Then Raul cannot read Nora's content in the preview

  @blocker @security @android-physical
  Scenario: The lock cannot be pressed past
    Given Nora on Android is facing the lock
    When Raul presses back
    Then Raul is still facing the lock

  @blocker @ios-device
  Scenario: The same protection on her iPhone
    Given Nora on iOS has left the app for longer than the timeout
    When Nora returns to the app
    Then Nora is asked for her credentials before she can see anything

  @blocker @security @ios-device
  Scenario: The iPhone reveals nothing behind the lock either
    Given Nora on iOS is facing the lock
    When Raul dismisses the credential prompt
    Then Raul still cannot see anything behind the lock

  @blocker
  Scenario: Nora removes one way of signing in
    Given Nora has two ways of signing in linked to her account
    When Nora on Android unlinks one of them
    Then Nora is told it has been removed

  @blocker
  Scenario: The remaining way still works
    Given Nora has unlinked one of her two sign-in methods
    When Nora signs out and signs back in with the remaining one
    Then Nora reaches her account

  # The case that locks somebody out of their own account forever.
  @blocker @security
  Scenario: The last way in cannot be removed
    Given Nora has only one way of signing in
    When Nora tries to unlink it
    Then Nora is refused and told why

  @blocker @security
  Scenario: Nobody can remove somebody else's sign-in method
    Given Alice has two ways of signing in
    When Raul tries to unlink one of Alice's
    Then Raul is refused

  @observability
  Scenario: Removing a sign-in method is recorded
    Given Nora has two ways of signing in
    When Nora unlinks one of them
    Then the change is recorded with which one and when

  @i18n
  Scenario: The lock speaks Nora's language
    Given Nora's app is in Vietnamese and is locked
    When Nora returns to the app
    Then Nora reads the lock in Vietnamese

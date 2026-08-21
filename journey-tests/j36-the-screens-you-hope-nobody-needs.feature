# j36 — the terminal error screen, the gate in front of security settings, and the last
# legal document nobody had opened.
#
# Personas: P-02 Alice (Android — reaches the account-error screen and quotes its code),
#           P-09 Nora (Android + iPhone — protects her security settings with a PIN),
#           P-08 Raul (Android — the person the PIN gate exists to stop),
#           P-12 Greta (Web Admin — the far end for the error code)
#
# Why this journey exists (SHY-0415 follow-on, sixth audit pass): after routes and
# cross-cutting states were worked through, the sixth pass checked every app SCREEN and
# DIALOG by a distinctive phrase rather than by its class name — a name-based check had
# earlier reported "36 screens, none missing", which was a lying metric because words like
# "home" and "profile" match anything.
#
# Three surfaces came back unwalked out of forty-five.
#
# PinVerifyDialog is the one that matters: SecuritySettingsScreen:224 puts it in front of
# changing security settings, so it is a RE-AUTHENTICATION GATE. If it can be dismissed,
# somebody holding a borrowed phone turns App Lock off — which quietly undoes j24.
#
# AccountErrorScreen shows an error CODE. That code is what somebody quotes to support, so
# it joins up with the support work in SHY-0385 and SHY-0387: if the code is wrong or absent,
# the ticket is unactionable.

Feature: j36 — the last screens, including the gate in front of the locks
  As somebody whose account has broken, or whose phone is in someone else's hand
  I want these screens to hold
  So that the rarely-seen paths are as proven as the daily ones

  Background:
    Given Nora [P-09] has a PIN set and App Lock switched on

  @blocker @security @android-physical
  Scenario: Changing security settings asks for the PIN first
    Given Raul [P-08] has Nora's unlocked phone
    When Raul opens Nora's security settings
    Then Raul is asked for Nora's PIN

  @blocker @security @android-physical
  Scenario: The wrong PIN changes nothing
    Given Raul has been asked for Nora's PIN
    When Raul enters the wrong PIN
    Then Raul cannot change the security settings

  @blocker @security @android-physical
  Scenario: Dismissing the gate changes nothing
    Given Raul has been asked for Nora's PIN
    When Raul dismisses the prompt
    Then the security settings are unchanged

  @blocker @security @android-physical
  Scenario: App Lock cannot be switched off past the gate
    Given Raul has been asked for Nora's PIN
    When Raul tries to switch App Lock off without the PIN
    Then App Lock is still on

  @blocker @android-physical
  Scenario: The right PIN lets Nora through
    Given Nora has been asked for her PIN
    When Nora enters it
    Then Nora can change her security settings

  @blocker @security @android-physical
  Scenario: Repeated wrong PINs are slowed down
    Given Raul is at Nora's PIN prompt
    When Raul enters wrong PINs repeatedly
    Then Raul is made to wait

  @blocker @security @ios-device
  Scenario: The same gate on her iPhone
    Given Raul has Nora's unlocked iPhone
    When Raul opens Nora's security settings
    Then Raul is asked for Nora's PIN

  @blocker @android-physical
  Scenario: An account that has broken says so
    Given Alice's [P-02] account is in an error state
    When Alice opens the app
    Then Alice is told her account has a problem

  @blocker @android-physical
  Scenario: The screen gives Alice something to quote
    Given Alice is on the account-error screen
    When Alice looks for something to tell support
    Then Alice is shown an error code

  @blocker @android-physical
  Scenario: The code is one support can act on
    Given Alice has quoted her error code to support
    When Greta [P-12] looks it up
    Then Greta can tell what went wrong with Alice's account

  @blocker @android-physical
  Scenario: Alice can get out of it
    Given Alice is on the account-error screen
    When Alice signs out
    Then Alice reaches the sign-in screen

  @blocker @edge @android-physical
  Scenario: The error screen cannot be pressed past
    Given Alice is on the account-error screen
    When Alice presses back
    Then Alice is still on the account-error screen

  @i18n @android-physical
  Scenario: The error reads in Alice's language
    Given Alice's app is in Chinese and her account is in an error state
    When Alice opens the app
    Then Alice reads the problem in Chinese

  @blocker @android-physical
  Scenario: The terms can be read
    Given Alice is in settings
    When Alice opens the terms and conditions
    Then Alice can read them

  @blocker @edge @android-physical
  Scenario: The terms can be left
    Given Alice is reading the terms and conditions
    When Alice goes back
    Then Alice returns to settings

  @i18n @ios-device
  Scenario: The terms read in Alice's language
    Given Alice's app is in Japanese
    When Alice opens the terms and conditions
    Then Alice reads them in Japanese

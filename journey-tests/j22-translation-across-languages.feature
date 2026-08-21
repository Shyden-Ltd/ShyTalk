# j22 — Bao and Yuki hold a conversation in two languages, using the feature the
# product is named for.
#
# Personas: P-17 Bao (Android, Mandarin, teacher), P-18 Yuki (iPhone, Japanese, student),
#           P-02 Alice (Web, English — the third language in the room),
#           P-08 Raul (Android — sends the message that must never be rendered as markup)
#
# Why this journey exists (SHY-0404): a journey audit of 471 scenarios found that NOBODY
# ever translates a message. The 16 steps matching "translat" are all the app localising its
# OWN labels — "the German translation of Sign in". The feature itself, which is close to
# being the product, had nothing: not the daily quota, not the message cache, not the
# provider chain, not the 502 when every provider is down, and not the SHY-0073 rule that a
# translation is stored RAW and escaped by whoever renders it. That last one turns a
# stranger's message into an injection vector, in rooms where minors are present.

Feature: j22 — Bao and Yuki understand each other
  As someone learning a language on a platform built for it
  I want to read what the other person said in my own language
  So that the reason I installed ShyTalk works, and keeps working

  Background:
    Given Bao [P-17] is in a lesson room with Yuki [P-18] and Alice [P-02]
    And Bao writes in Mandarin, Yuki reads Japanese, and Alice reads English

  @blocker @android-physical
  Scenario: Yuki reads Bao's message in her own language
    Given Bao has sent a message in Mandarin
    When Yuki on iOS translates it
    Then Yuki sees the message in Japanese
    And Yuki can still see what Bao originally wrote

  @blocker @ios-device
  Scenario: The same message reaches Alice in a different language
    Given Bao has sent a message in Mandarin
    When Alice on Web translates it
    Then Alice sees the message in English
    And Alice's translation is not affected by Yuki's

  @blocker @android-physical
  Scenario: Translating a private message works the same way
    Given Bao has sent Yuki a private message in Mandarin
    When Yuki on iOS translates it
    Then Yuki sees the message in Japanese

  @blocker @android-physical
  Scenario: The detected language is the one that was written
    Given Bao has sent a message in Mandarin
    When Yuki on iOS translates it
    Then Yuki is told the message was written in Chinese

  # The cache is the difference between a feature that costs one provider call per
  # reader and one that costs a call per tap.
  @blocker @android-physical
  Scenario: Translating the same message twice does not spend a second translation
    Given Yuki has already translated Bao's message once
    When Yuki on iOS translates the same message again
    Then Yuki sees the translation immediately
    And Yuki's remaining translations for today are unchanged

  @blocker @android-physical
  Scenario: Running out of translations for the day says so
    Given Yuki has used every translation her account allows today
    When Yuki on iOS translates a new message
    Then Yuki is told she has no translations left today
    And Bao's original message is still readable

  @blocker @android-physical
  Scenario: Translation being unavailable never hides the message
    Given translation is unavailable
    When Yuki on iOS translates Bao's message
    Then Yuki is told it could not be translated
    And Bao's original message is still readable

  # SHY-0073: translations are STORED raw and escaped by the renderer. If a renderer
  # ever forgets, a stranger's message becomes markup in everybody else's app.
  @blocker @security @android-physical
  Scenario: A message written as markup is shown as characters
    Given Raul [P-08] has sent a message that looks like HTML markup
    When Yuki on iOS translates it
    Then Yuki sees the markup as ordinary characters
    And nothing in Yuki's app is rendered from Raul's message

  @blocker @security
  Scenario: Somebody outside the conversation cannot translate its messages
    Given Vexa [P-07] is not part of Bao and Yuki's private conversation
    When Vexa asks to translate a message from it
    Then Vexa is refused

  @blocker @security
  Scenario: A signed-out visitor cannot use the chat translator
    Given a visitor who is not signed in
    When the visitor asks to translate a chat message
    Then the visitor is refused

  @blocker @security
  Scenario: One person's translations cannot be spent by another
    Given Yuki has translations remaining today
    When Raul asks to translate a message as if he were Yuki
    Then Raul is refused
    And Yuki's remaining translations are unchanged

  @android-physical
  Scenario: A message already in the reader's language
    Given Alice has sent a message in English
    When Alice on Web translates it
    Then Alice still sees a readable message

  @android-physical
  Scenario: A message that is only emoji
    Given Bao has sent a message containing only emoji
    When Yuki on iOS translates it
    Then Yuki still sees the emoji

  @android-physical
  Scenario: A very long message translates whole
    Given Bao has sent a message at the longest length the app allows
    When Yuki on iOS translates it
    Then Yuki sees the whole message translated, not a truncated one

  @i18n @ios-device
  Scenario: A right-to-left reader sees the translation laid out correctly
    Given Layla [P-13] reads Arabic and is in the lesson room
    When Layla translates Bao's message
    Then Layla sees the translation in Arabic reading right to left

  @observability
  Scenario: A translation nobody could provide is recorded
    Given translation is unavailable
    When Yuki on iOS translates Bao's message
    Then the miss is recorded for us to see later

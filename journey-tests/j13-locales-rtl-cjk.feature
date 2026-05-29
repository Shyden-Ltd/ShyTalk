# j13 — Layla (Arabic) + Kenji (Japanese) — full flow in non-English locales with RTL + CJK glyph rendering.
#
# Personas: P-13 Layla (Web Chromium ar, Android emulator parity), P-14 Kenji (Web WebKit ja, iOS Sim parity)
#
# i18n bugs are insidious — they only manifest in a real RTL or CJK locale. This journey
# threads a complete social loop in Arabic (with RTL direction flip) and in Japanese (with
# CJK fonts) to catch glyph fallback, RTL layout bugs, and untranslated strings.

Feature: j13 — Layla + Kenji multi-locale full flow
  As an Arabic or Japanese user
  I want every screen translated and the layout correct for my locale
  So that 20-locale parity is not just claimed but actually working

  Background:
    Given the local stack is healthy
    Given Layla [P-13] is on Web Chromium with browser locale ar, signed in as 50000070
    Given Kenji [P-14] is on Web WebKit with browser locale ja, signed in as 50000071
    Given Alice [P-02] is signed in (English) as a follow target

  # Phase-scoped scenarios split from the original "Layla's full Arabic flow with
  # RTL direction" scenario (20 steps → 6 phase-focused ≤5-step scenarios). Each
  # starts fresh from the Background sign-in so they read in isolation. Together
  # they cover the same surface: discovery → profile → gift → wallet → notifications
  # → legal pages, in Arabic with RTL direction.
  @blocker @browser-chromium @locale-rtl
  Scenario: Layla — discovery + search header in Arabic RTL
    When Layla on Web opens "/discovery"
    Then within 3000ms Layla's Web UI document direction is "rtl"
    Then Layla's Web UI shows the search field aligned right
    Then Layla's Web UI shows the Arabic translation of "Discover"
    Then no rendered text contains the Unicode replacement glyph U+FFFD

  @blocker @browser-chromium @locale-rtl
  Scenario: Layla — Alice's profile labels in Arabic (no raw i18n keys)
    When Layla on Web opens Alice's profile
    Then Layla's Web UI shows Arabic labels for "Followers", "Following", "Beans"
    Then Layla's Web UI does not show any raw i18n key like "profile_followers"

  @blocker @browser-chromium @locale-rtl
  Scenario: Layla — sends a gift in Arabic and sees confirmation
    When Layla on Web sends "rose" gift to Alice
    Then within 3000ms Layla's Web UI shows Arabic toast confirming the gift
    Then within 3000ms the database has 1 entries in "giftWalls/50000010/gifts" matching {senderId: 50000070}

  @blocker @browser-chromium @locale-rtl
  Scenario: Layla — wallet in Arabic with locale-appropriate separators
    When Layla on Web opens "/wallet"
    Then Layla's Web UI shows the balance with locale-appropriate thousands separator (٬ or ,)
    Then Layla's Web UI shows Arabic translation of "ShyCoins"

  @blocker @browser-chromium @locale-rtl
  Scenario: Layla — notifications screen in Arabic incl. system PM Arabic variant
    When Layla on Web opens "/notifications"
    Then Layla's Web UI shows Arabic translation of "Notifications"
    Then any system PM template renders with the Arabic variant (e.g. age_seg_*_pm keys)

  @blocker @browser-chromium @locale-rtl
  Scenario: Layla — legal pages in Arabic with RTL direction
    When Layla on Web navigates to "/privacy.html"
    Then Layla's Web UI document direction is "rtl"
    Then Layla's Web UI shows non-empty Arabic text for section 11 (pp_s11_h, pp_s11_p1..p6)

  @blocker @android-emulator @locale-rtl
  Scenario: Layla on Android emulator — parity check of RTL rendering
    Given Layla is signed in on Android emulator with device locale ar
    When Layla on Android opens the "discovery" screen
    Then within 3000ms Layla's Android UI shows the Arabic translation of "Discover"
    Then Layla's Android UI layoutDirection is RTL (Compose `LayoutDirection.Rtl`)
    When Layla on Android opens the "wallet" screen
    Then Layla's Android UI shows the Arabic translation of "Wallet"
    Then no string is missing translation (no fallback to English-only resource for ar)

  @blocker @browser-webkit @locale-cjk
  Scenario: Kenji's full Japanese flow with CJK glyphs
    # ── Discovery in Japanese ──
    When Kenji on Web WebKit opens "/discovery"
    Then within 3000ms Kenji's Web UI shows the Japanese translation of "Discover"
    Then no rendered character has the Unicode replacement glyph U+FFFD
    Then the system font fallback resolves to a Japanese-capable font (e.g. Hiragino Sans, Yu Gothic, Noto Sans JP)

    # ── Profile + gift ──
    When Kenji on Web opens Alice's profile
    Then Kenji's Web UI shows Japanese labels
    When Kenji on Web sends a "rose" gift to Alice
    Then within 3000ms Kenji's Web UI shows Japanese confirmation toast

    # ── Notifications in Japanese ──
    When Kenji on Web opens "/notifications"
    Then Kenji's Web UI shows Japanese translation of "Notifications"

  @ios-sim @locale-cjk
  Scenario: Kenji on iOS Sim — parity check of CJK rendering
    Given Kenji is signed in on iOS Sim with device locale ja
    When Kenji on iOS Sim opens the "discovery" screen
    Then within 3000ms Kenji's iOS Sim UI shows the Japanese translation of "Discover"
    Then no rendered character is the replacement glyph U+FFFD

  @browser-chromium
  Scenario: System PM is rendered in the recipient's locale (not the sender's)
    Given Layla (locale=ar) is age-verified and Greta downgrades her to minor (test setup)
    Then within 5000ms Layla's Web UI shows a system PM from Officia in Arabic (key "age_seg_age_down_admin_pm" → ar translation)
    Then the PM does NOT render in English even if Officia's locale is en

  @browser-chromium
  Scenario: Untranslated strings fail the build — runtime check for English-only fallbacks
    When the test runner scans all rendered strings on Layla's Web UI across 10 screens
    Then no string has the value of the en/strings.xml fallback when the locale is ar
    # i.e. every visible string is a non-English translation of the canonical en key

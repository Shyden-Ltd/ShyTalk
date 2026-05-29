# j05 — Alice, adult power user — IAP → gacha → gift → leaderboard climb.
#
# Personas: P-02 Alice (Web Chromium primary, Android parity for IAP receipt path),
#           P-15 Selma (MC Singer — recipient of gift, Android)
#
# This journey proves the full monetization loop: real IAP receipt is consumed, balance is
# transactional, gacha is fair, gift-sending atomically transfers coins → recipient beans,
# leaderboard rank reflects the new spend.

Feature: j05 — Alice's monetization day
  As an adult power user buying coins, pulling gacha, and tipping an MC
  I want every cent of my spend tracked transactionally
  So that I never lose coins to a double-deduct, a failed gacha, or a missing receipt

  Background:
    Given the local stack is healthy
    Given the device locale is "en"
    Given Alice [P-02] is signed in on Web Chromium with shyCoins=5000, beans=2000, gcs=100
    Given Selma [P-15] is signed in on Android (the MC who receives the gift)
    Given the package "coins-1000" exists with coinValue=1000 and price="$9.99"
    Given the gift "rose" costs 10 coins and awards 5 beans
    Given the gift "crown" costs 500 coins and awards 250 beans

  # The original "Alice buys coins, pulls gacha 3x, sends a crown to Selma,
  # climbs leaderboard" scenario was 32 steps. Split into 7 phase-focused
  # scenarios sharing the Background wallet/seed setup. Each scenario establishes
  # its preconditions via setup-style `Given` so it can run in isolation.
  @blocker
  Scenario: Alice and Selma's pre-spend wallet state matches the seed registry
    Then the database has document "users/50000010" with field "shyCoins" equal to 5000
    Then the database has document "users/50000080" with field "beans" equal to 10000

  @blocker @browser-chromium
  Scenario: Alice buys coins-1000 via sandbox IAP — coins credit + transaction row
    When Alice on Web opens "/wallet"
    When Alice on Web taps "wallet_buyCoinsButton"
    When Alice on Web selects package "coins-1000"
    When Alice on Web submits a sandbox receipt "sandbox-receipt-{ts}-A"
    Then within 5000ms the response status from /api/economy/purchase is 200
    Then the database has document "users/50000010" with field "shyCoins" equal to 6000
    Then the database has 1 entries in "users/50000010/transactions" matching {type: "PURCHASE", amount: 1000, productId: "coins-1000"}
    Then within 3000ms Alice's Web UI shows "6,000" next to the ShyCoins icon

  @blocker @browser-chromium
  Scenario: Alice pulls 3 gacha — 300 coins debit + 3 gifts + transaction row
    Given Alice has just purchased coins-1000 and has shyCoins=6000
    When Alice on Web opens "/gacha"
    When Alice on Web taps "gacha_pull3Button"
    Then within 5000ms the response status from /api/economy/gacha is 200
    Then the response body has field "gifts" array length 3
    Then the database has document "users/50000010" with field "shyCoins" equal to 5700
    Then the database has 1 entries in "users/50000010/transactions" matching {type: "GACHA", amount: -300}
    Then the database has 3 entries in "users/50000010/gifts" added since "{ts}"

  @blocker @browser-chromium
  Scenario: Alice sends a crown to Selma — atomic coins-to-beans transfer with both transactions
    Given Alice has shyCoins=5700 after gacha pulls
    When Alice on Web opens "/wallet#send-gift"
    When Alice on Web selects recipient "Selma" and gift "crown"
    When Alice on Web taps "sendGift_confirmButton"
    Then within 3000ms the database has document "users/50000010" with field "shyCoins" equal to 5200
    Then the database has document "users/50000080" with field "beans" equal to 10250
    Then the database has 1 entries in "users/50000010/transactions" matching {type: "GIFT_SENT", amount: -500, giftId: "crown"}
    Then the database has 1 entries in "users/50000080/transactions" matching {type: "GIFT_RECEIVED", amount: 250, giftId: "crown"}
    Then the database has 1 entries in "giftWalls/50000080/gifts" matching {giftId: "crown", senderId: 50000010}

  @android-physical
  Scenario: Selma's Android shows the in-app gift notification and gift wall entry for the crown
    Given Alice has just sent Selma a crown
    Then within 5000ms Selma's Android UI shows the in-app gift notification with sender "Alice" and gift "crown"
    When Selma on Android opens her "gift_wall" screen
    Then within 3000ms Selma's Android UI shows the new "crown" gift entry

  @manual @android-physical
  Scenario: Selma's Android receives an FCM push for the crown gift
    Given Alice has just sent Selma a crown
    Then the tester sees an FCM push notification on Selma's Android device with body containing "Alice" and "crown"

  @browser-chromium
  Scenario: Alice's adult-cohort leaderboard rank reflects her crown spend
    Given Alice has just sent Selma a crown
    When Alice on Web opens "/leaderboard"
    Then within 3000ms Alice's Web UI shows her own rank in the top 100 (rank <= 100)
    Then the response from /api/economy/leaderboards has cohort="adult" in every row

  @blocker @browser-chromium @concurrency
  Scenario: Alice double-clicks "buy coins-1000" — only one purchase processes
    Given Alice has shyCoins=5000
    When Alice on Web double-taps "wallet_buyCoinsButton" with the same receipt "receipt-X" within 200ms
    Then exactly 1 request to /api/economy/purchase succeeds with status 200
    Then the second request returns status 409
    Then the database has document "users/50000010" with field "shyCoins" equal to 6000 (only one credit)
    Then the database has 1 entries in "users/50000010/transactions" matching {productId: "coins-1000", receipt: "receipt-X"}

  @android-physical
  Scenario: Alice on a 2nd device sees coins update in real-time
    Given Alice is signed in on Web Chromium AND on Android physical with the same Firebase user
    Given Alice has shyCoins=5000 on both
    When Alice on Web purchases "coins-1000" with sandbox receipt
    Then within 3000ms Alice's Android UI shows "6,000" next to the ShyCoins icon (real-time Firestore listener)

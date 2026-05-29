# j06 — Alice, IAP failure paths — receipt replay, network drop mid-purchase, refund.
#
# Personas: P-02 Alice (Android physical primary, Web parity)
#
# Money paths are where silent-failure bugs hurt most. This journey deliberately exercises
# every IAP failure mode and asserts: no double-credit, no orphaned spend, refund flow works,
# audit row exists for every state transition.

Feature: j06 — Alice IAP failure paths
  As a paying user with flaky purchase flows
  I want every failure mode to leave me with a correct balance and a clear next action
  So that I never lose money or end up with phantom coins

  Background:
    Given the local stack is healthy
    Given Alice [P-02] is signed in on Android physical with shyCoins=5000
    Given the package "coins-1000" exists with coinValue=1000

  @blocker @android-physical
  Scenario: Receipt replay attack — same receipt submitted twice → second call 409, no double credit
    Given Alice purchased "coins-1000" with receipt "receipt-R1" successfully (shyCoins now 6000)
    When Alice on Android POSTs /api/economy/purchase with productId="coins-1000" and receipt "receipt-R1" again
    Then the response status is 409
    Then the response body contains "duplicate" or "already_consumed"
    Then the database has document "users/50000010" with field "shyCoins" equal to 6000 (NOT 7000)
    Then the database has 1 entries in "users/50000010/transactions" matching {receipt: "receipt-R1"}

  @blocker @android-physical
  Scenario: Network drop AFTER server credits but BEFORE client confirmation → retry is idempotent
    Given Alice taps purchase and the server credits coins=6000 + writes transaction
    Given Alice's network drops before the 200 OK reaches the client
    When Alice on Android retries the same purchase (same receipt) once network restores
    Then the response status is 409 (idempotent re-credit prevented)
    Then the database has document "users/50000010" with field "shyCoins" equal to 6000 (single credit)
    Then Alice's Android UI shows "Purchase already completed" toast

  @blocker @android-physical
  Scenario: Invalid receipt (signature fail) → 400 + no credit + audit row
    When Alice on Android POSTs /api/economy/purchase with productId="coins-1000" and receipt "INVALID_BASE64_BLOB"
    Then the response status is 400
    Then the database has document "users/50000010" with field "shyCoins" equal to 5000 (unchanged)
    Then the database has 1 entries in "auditLog" matching {action: "purchase.rejected", reason: "invalid_receipt", uniqueId: 50000010}

  @android-physical
  Scenario: Missing productId → 400 with clear message
    When Alice on Android POSTs /api/economy/purchase with no productId
    Then the response status is 400
    Then the response body contains "productId"

  @android-physical
  Scenario: Mismatched productId / receipt pair → 400, no credit
    Given the receipt "receipt-R2" is signed for "coins-500" but Alice submits productId="coins-1000"
    When Alice on Android POSTs /api/economy/purchase
    Then the response status is 400
    Then the database has document "users/50000010" with field "shyCoins" equal to 5000

  @blocker @android-physical @browser-chromium
  Scenario: Admin refund — coins back out, audit row, transaction marker
    Given Alice purchased "coins-1000" with receipt "receipt-R3" (shyCoins now 6000)
    Given Greta [P-12] is on Web Admin at "/admin#economy"
    When Greta on Web Admin processes a refund for receipt "receipt-R3"
    Then within 5000ms the database has document "users/50000010" with field "shyCoins" equal to 5000
    Then the database has 1 entries in "users/50000010/transactions" matching {type: "REFUND", amount: -1000, refundedReceipt: "receipt-R3"}
    Then the database has 1 entries in "auditLog" matching {action: "economy.refund", targetId: 50000010, amount: 1000, adminId: 90000001}
    Then within 5000ms Alice's Android UI shows the new "5,000" balance via Firestore listener

  @android-physical
  Scenario: Gacha pull with insufficient balance — clear 402 + no deduction
    Given Alice has shyCoins=50
    When Alice on Android POSTs /api/economy/gacha with pullCount=1 (costs 100)
    Then the response status is 402
    Then the database has document "users/50000010" with field "shyCoins" equal to 50
    Then Alice's Android UI shows "Not enough coins" toast

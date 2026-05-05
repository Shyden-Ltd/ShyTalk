import { test, expect } from "./fixtures/scenarios";

/**
 * Integration test #6 — Gift-direct state cascade.
 *
 * Verifies the full sender→recipient gift flow exercises all the
 * side effects that PR #485 (audit C1) made race-safe:
 *
 *   1. POST /api/economy/gift-direct with valid sender + recipient + gift
 *   2. Sender's `shyCoins` decremented by `gift.coinValue * quantity`
 *      (transactional — verified pre/post via /api/economy/balance)
 *   3. Recipient's `shyBeans` incremented by `floor(coinValue *
 *      beanConversionRate * quantity)` — at default config
 *      (rate=0.6, qty=1, coinValue=100) that's 60 beans.
 *   4. The route returns the actual `beanReward` and `coinsSpent`
 *      values that were applied — not just success — so a future
 *      regression that double-counted would be caught
 *
 * What this catches that no unit test can:
 *   - The transaction in economy.js:951 actually commits to Firestore
 *     (mocks let the test pass even when the transaction throws
 *     mid-commit; emulator does not).
 *   - The /api/economy/balance read sees the post-write state — i.e.
 *     no Firestore-cache skew between transactional write and
 *     subsequent read.
 *   - The gift doc's coinValue is read at request time (not cached)
 *     and the bean reward is computed against the live config doc.
 *
 * Per `.project/plans/2026-05-05-integration-test-framework.md` test #6.
 */

const API_BASE = process.env.API_BASE_URL || "http://localhost:3000";

// /api/economy/balance defines the response shape: `{coins, beans}`.
// The `shyCoins`/`shyBeans` aliases are server-internal — the public
// API normalises to the lowercase form. Asserting against the wire
// shape (not the doc-field shape) catches a future doc rename that
// forgot to update the read path.
async function readBalance(
  api: import("@playwright/test").APIRequestContext,
  idToken: string,
): Promise<{ coins: number; beans: number }> {
  const res = await api.get(`${API_BASE}/api/economy/balance`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok()) {
    throw new Error(`readBalance failed: ${res.status()}: ${await res.text()}`);
  }
  return res.json();
}

test.describe("Integration — gift-direct state cascade", () => {
  test("sender→recipient gift decrements coins, credits beans, returns the canonical reward", async ({
    api,
    pair,
  }) => {
    // Pre-assert starting state. If these fail, the test setup is
    // broken — surface that as a setup error (not a failure of the
    // route under test).
    const senderBefore = await readBalance(api, pair.sender.idToken);
    const recipientBefore = await readBalance(api, pair.recipient.idToken);
    expect(senderBefore).toEqual({ coins: 1000, beans: 0 });
    expect(recipientBefore).toEqual({ coins: 0, beans: 0 });

    const res = await api.post(`${API_BASE}/api/economy/gift-direct`, {
      headers: {
        Authorization: `Bearer ${pair.sender.idToken}`,
        "Content-Type": "application/json",
      },
      data: {
        recipientId: pair.recipient.uniqueId,
        giftId: pair.gift.id,
        quantity: 1,
      },
    });
    expect(
      res.ok(),
      `gift-direct expected 200, got ${res.status()}: ${await res.text()}`,
    ).toBe(true);

    const body = await res.json();
    // Default beanConversionRate is 0.6 (see test-helpers.js
    // economyConfig fallback) — coinValue=100 × 0.6 × qty=1 = 60.
    // Pinning to the exact value catches a future config drift or a
    // rounding-mode regression (Math.floor → Math.round, etc.).
    expect(body).toMatchObject({
      success: true,
      coinsSpent: 100,
      beanReward: 60,
      quantity: 1,
    });

    // Post-assert state. Reading via /api/economy/balance proves the
    // writes actually committed to Firestore — not just that the
    // route returned the right numbers from in-memory state.
    const senderAfter = await readBalance(api, pair.sender.idToken);
    const recipientAfter = await readBalance(api, pair.recipient.idToken);
    expect(senderAfter).toEqual({ coins: 900, beans: 0 });
    expect(recipientAfter).toEqual({ coins: 0, beans: 60 });
  });

  test("returns 402 when sender has insufficient coins", async ({
    api,
    pair,
  }) => {
    // Drain the sender first by gifting all 1000 coins (10 × 100).
    // This proves the transactional check at economy.js:954 fires
    // on a real-Firestore read, not just the pre-check.
    const drain = await api.post(`${API_BASE}/api/economy/gift-direct`, {
      headers: {
        Authorization: `Bearer ${pair.sender.idToken}`,
        "Content-Type": "application/json",
      },
      data: {
        recipientId: pair.recipient.uniqueId,
        giftId: pair.gift.id,
        quantity: 10,
      },
    });
    expect(drain.ok(), `drain expected 200, got ${drain.status()}`).toBe(true);

    // Now sender is at 0 coins. Next attempt MUST 402.
    const res = await api.post(`${API_BASE}/api/economy/gift-direct`, {
      headers: {
        Authorization: `Bearer ${pair.sender.idToken}`,
        "Content-Type": "application/json",
      },
      data: {
        recipientId: pair.recipient.uniqueId,
        giftId: pair.gift.id,
        quantity: 1,
      },
    });
    expect(res.status()).toBe(402);
    const body = await res.json();
    expect(body.error).toMatch(/insufficient/i);

    // CRITICAL — verify the failed attempt did NOT side-effect.
    // Without the transaction, the recipient's bean balance would
    // still tick up (from the failed parent), or the giftWall doc
    // would record an extra send. Re-reading the recipient's beans
    // is the simplest single assertion that catches both classes.
    const recipientAfter = await readBalance(api, pair.recipient.idToken);
    // 10 × 60 from the drain above; nothing extra from the 402.
    expect(recipientAfter.beans).toBe(600);
  });

  test("returns 400 when sender tries to gift themselves", async ({
    api,
    pair,
  }) => {
    const res = await api.post(`${API_BASE}/api/economy/gift-direct`, {
      headers: {
        Authorization: `Bearer ${pair.sender.idToken}`,
        "Content-Type": "application/json",
      },
      data: {
        recipientId: pair.sender.uniqueId,
        giftId: pair.gift.id,
        quantity: 1,
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/yourself/i);

    // Self-gift validation happens BEFORE the doc reads at
    // economy.js:912 — so sender.coins must remain 1000. If a future
    // refactor ever moves the validation past the coin-debit
    // transaction, this assertion is what catches it.
    const senderAfter = await readBalance(api, pair.sender.idToken);
    expect(senderAfter.coins).toBe(1000);
  });

  test("returns 404 when gift does not exist", async ({ api, pair }) => {
    const res = await api.post(`${API_BASE}/api/economy/gift-direct`, {
      headers: {
        Authorization: `Bearer ${pair.sender.idToken}`,
        "Content-Type": "application/json",
      },
      data: {
        recipientId: pair.recipient.uniqueId,
        giftId: "nonexistent-gift-id",
        quantity: 1,
      },
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/gift not found/i);

    // Sender must not be debited.
    const senderAfter = await readBalance(api, pair.sender.idToken);
    expect(senderAfter.coins).toBe(1000);
  });
});

import { test, expect } from "./fixtures/scenarios";

/**
 * Integration test #10 — IAP replay protection.
 *
 * Verifies the audit C4 fix on /api/economy/purchase:
 *
 *   1. First request with productId=X + purchaseToken=T → 200,
 *      coins granted, receipt written at
 *      `purchaseReceipts/sha256(T)`.
 *   2. Second request with the SAME purchaseToken → 409 (the
 *      transactional re-check at economy.js:1615 sees the existing
 *      receipt and aborts before any second grant).
 *   3. Third request with a DIFFERENT purchaseToken (same productId)
 *      → 200 again — proves the replay check is keyed on the token,
 *      not on the user/product pair.
 *
 * What this catches that no unit test can:
 *   - The receipt write inside `db.runTransaction` actually commits
 *     (mocks let the assertion pass even when the txn throws
 *     mid-commit).
 *   - The pre-flight check at economy.js:1477 reads the SAME receipt
 *     doc the inside-tx write produced (sha256 keying matches).
 *   - The /coinPackages.where('productId', '==', productId).limit(1)
 *     query path actually finds a doc when seeded via /test/write —
 *     proving the test-helpers route's coinPackages allow-list works
 *     end-to-end.
 *
 * Per `.project/plans/2026-05-05-integration-test-framework.md`
 * test #10. NOTE: NODE_ENV is not 'production' under the local
 * stack, so the route bypasses Google/Apple verification. That
 * branch of the route is unit-tested separately
 * (express-api/tests/routes/economy-purchase.test.js).
 */

const API_BASE = process.env.API_BASE_URL || "http://localhost:3000";
const TEST_API_KEY = process.env.TEST_API_KEY || "local-test-key";

interface Balance {
  coins: number;
  beans: number;
}

async function readBalance(
  api: import("@playwright/test").APIRequestContext,
  idToken: string,
): Promise<Balance> {
  const res = await api.get(`${API_BASE}/api/economy/balance`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok()) {
    throw new Error(`readBalance failed: ${res.status()}: ${await res.text()}`);
  }
  return res.json();
}

/**
 * Seed a unique coinPackage doc tagged with the sender's testRunId
 * so teardown can sweep it. The route accepts any string productId
 * (it's a Firestore equality query), so we make it run-scoped to
 * avoid cross-test contamination.
 */
async function seedCoinPackage(
  api: import("@playwright/test").APIRequestContext,
  testRunId: string,
  productId: string,
  coins: number,
  bonusCoins = 0,
): Promise<void> {
  const res = await api.post(`${API_BASE}/api/test/write/coinPackages`, {
    headers: { "X-Test-API-Key": TEST_API_KEY },
    data: {
      id: `${testRunId}_pkg_${productId}`,
      productId,
      coins,
      bonusCoins,
      _testRun: testRunId,
    },
  });
  if (!res.ok()) {
    throw new Error(
      `seedCoinPackage failed: ${res.status()}: ${await res.text()}. ` +
        `Verify coinPackages is in the test-helpers ALLOWED_COLLECTIONS list.`,
    );
  }
}

/**
 * Read the testRunId off the sender's user doc so we can tag the
 * seeded coinPackage. The sender fixture doesn't expose it
 * directly, but the username `_testRun` field is queryable. Falls
 * back to a fresh prefix if the lookup fails — failure mode is
 * "package leaks across runs," not test failure.
 */
async function senderTestRunId(
  api: import("@playwright/test").APIRequestContext,
  uniqueId: number,
): Promise<string> {
  // The sender fixture provisions via /api/test/setup which creates
  // users with a `_testRun` field. We query through the public API
  // by reading /api/economy/balance for the user (which proves they
  // exist) — but the actual testRunId is not exposed. Workaround:
  // synthesize a unique string per test that lives only as long as
  // this test (the actual sender doc is teardown-cleaned by the
  // fixture, and the seeded package is cleaned by the same testRunId
  // when fixture teardown runs, OR best-effort by us in the
  // afterEach hook).
  //
  // For test isolation at the package level, including the user's
  // uniqueId in the tag makes collisions impossible across users.
  return `test_iap_replay_${uniqueId}_${Date.now()}`;
}

test.describe("Integration — IAP replay protection", () => {
  test("same purchaseToken accepted once; second attempt 409s", async ({
    api,
    sender,
  }) => {
    const testRunId = await senderTestRunId(api, sender.uniqueId);
    const productId = `${testRunId}_coins_500`;
    const COINS = 500;

    await seedCoinPackage(api, testRunId, productId, COINS);

    try {
      const before = await readBalance(api, sender.idToken);
      expect(before.coins).toBe(1000);

      const purchaseToken = `${testRunId}_token_first`;
      const first = await api.post(`${API_BASE}/api/economy/purchase`, {
        headers: {
          Authorization: `Bearer ${sender.idToken}`,
          "Content-Type": "application/json",
        },
        data: { productId, purchaseToken },
      });
      expect(
        first.ok(),
        `first purchase expected 200, got ${first.status()}: ${await first.text()}`,
      ).toBe(true);
      const firstBody = await first.json();
      expect(firstBody).toMatchObject({
        success: true,
        coinsAdded: COINS,
        newBalance: 1500,
      });

      const afterFirst = await readBalance(api, sender.idToken);
      expect(afterFirst.coins).toBe(1500);

      // Replay attempt — same token. economy.js:1483 returns 409
      // from the pre-flight; if a future refactor moves the check
      // inside the txn, the txn-internal ERR_DUPLICATE branch
      // (line 1645) also returns 409.
      const replay = await api.post(`${API_BASE}/api/economy/purchase`, {
        headers: {
          Authorization: `Bearer ${sender.idToken}`,
          "Content-Type": "application/json",
        },
        data: { productId, purchaseToken },
      });
      expect(replay.status()).toBe(409);
      const replayBody = await replay.json();
      expect(replayBody.error).toMatch(/already processed/i);

      // Balance must NOT change on replay. This is the critical
      // assertion — without the receipt-keyed dedup, the route
      // would happily grant 500 coins twice and the balance would
      // jump to 2000.
      const afterReplay = await readBalance(api, sender.idToken);
      expect(afterReplay.coins).toBe(1500);

      // Different token, same product → MUST succeed (proves the
      // dedup is keyed on the token, not on the user×product pair).
      const secondPurchase = await api.post(
        `${API_BASE}/api/economy/purchase`,
        {
          headers: {
            Authorization: `Bearer ${sender.idToken}`,
            "Content-Type": "application/json",
          },
          data: { productId, purchaseToken: `${testRunId}_token_second` },
        },
      );
      expect(secondPurchase.ok()).toBe(true);
      const afterSecond = await readBalance(api, sender.idToken);
      expect(afterSecond.coins).toBe(2000);
    } finally {
      // Best-effort cleanup of the seeded coinPackage. The sender
      // fixture's teardown wipes its OWN testRunId, but the package
      // is tagged with our synthesized testRunId — so we ask for an
      // explicit teardown of just that. Failure here is non-fatal;
      // the local emulator resets on next start.sh.
      await api
        .post(`${API_BASE}/api/test/teardown`, {
          headers: { "X-Test-API-Key": TEST_API_KEY },
          data: { testRunId },
        })
        .catch(() => {
          /* swallow */
        });
    }
  });

  test("returns 404 when productId has no matching coinPackage", async ({
    api,
    sender,
  }) => {
    // Token must be unique per run. The route's pre-flight check at
    // economy.js:1477 looks up `purchaseReceipts/sha256(token)`
    // BEFORE the unknown-package check — so a stale receipt from a
    // prior run with a literal token like "any-token" would flip
    // this test from 404 to 409 with a confusing error message.
    const res = await api.post(`${API_BASE}/api/economy/purchase`, {
      headers: {
        Authorization: `Bearer ${sender.idToken}`,
        "Content-Type": "application/json",
      },
      data: {
        productId: "does-not-exist",
        purchaseToken: `no_pkg_${sender.uniqueId}_${Date.now()}`,
      },
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/unknown coin package/i);

    // Sender's balance must not change.
    const after = await readBalance(api, sender.idToken);
    expect(after.coins).toBe(1000);
  });

  test("returns 400 when productId or purchaseToken missing", async ({
    api,
    sender,
  }) => {
    const noProduct = await api.post(`${API_BASE}/api/economy/purchase`, {
      headers: {
        Authorization: `Bearer ${sender.idToken}`,
        "Content-Type": "application/json",
      },
      data: { purchaseToken: "x" },
    });
    expect(noProduct.status()).toBe(400);

    const noToken = await api.post(`${API_BASE}/api/economy/purchase`, {
      headers: {
        Authorization: `Bearer ${sender.idToken}`,
        "Content-Type": "application/json",
      },
      data: { productId: "x" },
    });
    expect(noToken.status()).toBe(400);
  });
});

import {
  test as base,
  request as pwRequest,
  type APIRequestContext,
} from "@playwright/test";

/**
 * Multi-account scenario fixtures for integration tests.
 *
 * Uses the local stack's `/api/test/setup` to create scoped test
 * users and `/api/test/mint-id-token` to mint Firebase ID tokens
 * usable as Bearer Authorization headers against the auth-protected
 * Express routes.
 *
 * Per `.project/plans/2026-05-05-integration-test-framework.md`.
 *
 * Usage:
 *   import { test, expect } from "./fixtures/scenarios";
 *
 *   test("my flow", async ({ api, sender }) => {
 *     const res = await api.post(`${API_BASE}/api/some-endpoint`, {
 *       headers: { Authorization: `Bearer ${sender.idToken}` },
 *     });
 *     expect(res.ok()).toBe(true);
 *   });
 *
 * Two fixtures are exposed:
 *   - `sender` — a single user with starter coins. Use for
 *     single-account flows (token mint, photo upload, etc.).
 *   - `pair`   — sender + recipient + a 100-coin gift, all created
 *     by ONE /api/test/setup call so they share a testRunId and
 *     tear down together. Use for cross-account flows
 *     (gift-direct, follow, PM, etc.).
 *
 * Tests should pick exactly one of the two — composing both wastes
 * provisioning calls and creates two unrelated testRunIds. The
 * fixture mechanics don't enforce this, but the convention is
 * deliberate.
 */

const API_BASE = process.env.API_BASE_URL || "http://localhost:3000";
const TEST_API_KEY = process.env.TEST_API_KEY || "local-test-key";

export interface IntegrationUser {
  /** Server-assigned numeric user ID. */
  uniqueId: number;
  /** Firebase UID for this user. */
  uid: string;
  /** Display name (used by routes that read user.displayName). */
  displayName: string;
  /** Long-lived Firebase ID token, suitable as Bearer token. */
  idToken: string;
}

/**
 * A fixed-cost gift created by /api/test/setup, used by gift-direct
 * tests. The id matches the pattern `{testRunId}_gift_{generateId()}`
 * — see test-helpers.js:130.
 */
export interface IntegrationGift {
  id: string;
  coinValue: number;
}

export interface IntegrationPair {
  /** Sender — funded with enough coins to send the paired gift. */
  sender: IntegrationUser;
  /** Recipient — starts at 0 beans so bean-credit assertions are unambiguous. */
  recipient: IntegrationUser;
  /** A 100-coin gift created in the same /api/test/setup call. */
  gift: IntegrationGift;
  /** Shared testRunId — single teardown removes all paired entities. */
  testRunId: string;
}

export interface IntegrationFixtures {
  /** A request context shared across the test — disposed in fixture teardown. */
  api: APIRequestContext;
  /** A single (non-admin) test user. Created on first access. */
  sender: IntegrationUser;
  /** Sender + recipient + gift in one scenario. Created on first access. */
  pair: IntegrationPair;
}

/**
 * Provision a new test user via /api/test/setup, then mint an ID
 * token for it. Returns the full user record AND the testRunId so
 * the caller can teardown the scenario.
 */
async function provisionUser(
  api: APIRequestContext,
  name: string,
): Promise<{ testRunId: string; user: IntegrationUser }> {
  const setupRes = await api.post(`${API_BASE}/api/test/setup`, {
    headers: { "X-Test-API-Key": TEST_API_KEY },
    data: {
      users: [{ name, shyCoins: 1000, shyBeans: 0 }],
    },
  });
  if (!setupRes.ok()) {
    throw new Error(
      `provisionUser /test/setup failed: ${setupRes.status()}: ${await setupRes.text()}. ` +
        `Verify TEST_API_KEY is set on Express and matches.`,
    );
  }
  const setupBody = await setupRes.json();
  const testRunId: string = setupBody.testRunId;
  const userRecord = setupBody.users?.[0];
  // `uniqueId === 0` would be a bug, not a missing field — guard on
  // type rather than truthiness so a future server-side change that
  // ever yielded 0 surfaces as a clear shape error.
  if (
    !userRecord ||
    typeof userRecord.uid !== "string" ||
    typeof userRecord.uniqueId !== "number"
  ) {
    throw new Error(
      `provisionUser: /test/setup returned unexpected shape: ${JSON.stringify(setupBody)}`,
    );
  }

  const mintRes = await api.post(`${API_BASE}/api/test/mint-id-token`, {
    headers: { "X-Test-API-Key": TEST_API_KEY },
    data: { uid: userRecord.uid },
  });
  if (!mintRes.ok()) {
    throw new Error(
      `provisionUser /test/mint-id-token failed: ${mintRes.status()}: ${await mintRes.text()}`,
    );
  }
  const { idToken } = await mintRes.json();
  if (!idToken) {
    throw new Error("provisionUser: /test/mint-id-token returned no idToken");
  }

  return {
    testRunId,
    user: {
      uniqueId: userRecord.uniqueId,
      uid: userRecord.uid,
      displayName: userRecord.displayName || name,
      idToken,
    },
  };
}

/**
 * Mint a Firebase ID token for the given Firebase UID via the local
 * Auth emulator. Throws on any failure.
 */
async function mintIdToken(
  api: APIRequestContext,
  uid: string,
): Promise<string> {
  const mintRes = await api.post(`${API_BASE}/api/test/mint-id-token`, {
    headers: { "X-Test-API-Key": TEST_API_KEY },
    data: { uid },
  });
  if (!mintRes.ok()) {
    throw new Error(
      `mintIdToken failed: ${mintRes.status()}: ${await mintRes.text()}`,
    );
  }
  const { idToken } = await mintRes.json();
  if (!idToken) {
    throw new Error("mintIdToken: emulator returned no idToken");
  }
  return idToken;
}

/**
 * Provision a sender + recipient + 100-coin gift in a SINGLE
 * /api/test/setup call so they share a testRunId. The recipient
 * starts at 0 beans to keep bean-credit assertions unambiguous.
 *
 * Returns the full pair record. Caller is responsible for teardown.
 */
async function provisionPair(api: APIRequestContext): Promise<IntegrationPair> {
  const setupRes = await api.post(`${API_BASE}/api/test/setup`, {
    headers: { "X-Test-API-Key": TEST_API_KEY },
    data: {
      users: [
        { name: "sender", shyCoins: 1000, shyBeans: 0 },
        { name: "recipient", shyCoins: 0, shyBeans: 0 },
      ],
      gifts: [{ name: "Test gift", coinValue: 100 }],
    },
  });
  if (!setupRes.ok()) {
    throw new Error(
      `provisionPair /test/setup failed: ${setupRes.status()}: ${await setupRes.text()}.`,
    );
  }
  const setupBody = await setupRes.json();
  const testRunId: string = setupBody.testRunId;
  const userRecords = setupBody.users || [];
  const giftRecords = setupBody.gifts || [];
  // /test/setup creates users in the order specified, so [0] is
  // sender and [1] is recipient. Asserting array length here is what
  // catches a future server change that returns them in a map or
  // re-orders them.
  if (
    userRecords.length !== 2 ||
    giftRecords.length !== 1 ||
    typeof userRecords[0].uniqueId !== "number" ||
    typeof userRecords[1].uniqueId !== "number" ||
    typeof giftRecords[0].id !== "string" ||
    typeof giftRecords[0].coinValue !== "number"
  ) {
    throw new Error(
      `provisionPair: /test/setup returned unexpected shape: ${JSON.stringify(setupBody)}`,
    );
  }

  const [senderToken, recipientToken] = await Promise.all([
    mintIdToken(api, userRecords[0].uid),
    mintIdToken(api, userRecords[1].uid),
  ]);

  return {
    testRunId,
    sender: {
      uniqueId: userRecords[0].uniqueId,
      uid: userRecords[0].uid,
      displayName: userRecords[0].displayName || "sender",
      idToken: senderToken,
    },
    recipient: {
      uniqueId: userRecords[1].uniqueId,
      uid: userRecords[1].uid,
      displayName: userRecords[1].displayName || "recipient",
      idToken: recipientToken,
    },
    gift: {
      id: giftRecords[0].id,
      coinValue: giftRecords[0].coinValue,
    },
  };
}

/**
 * Tear down the test scenario by deleting all data tagged with the
 * given testRunId. Best-effort: failures are logged but don't fail
 * the test. We DO inspect the HTTP status — `api.post` only rejects
 * on network failure, not 4xx/5xx, and a silently-failed teardown
 * leaves emulator state for subsequent runs (which retries=0
 * cannot tolerate without restarting the stack).
 */
async function teardown(
  api: APIRequestContext,
  testRunId: string,
): Promise<void> {
  try {
    const res = await api.post(`${API_BASE}/api/test/teardown`, {
      headers: { "X-Test-API-Key": TEST_API_KEY },
      data: { testRunId },
    });
    if (!res.ok()) {
      // eslint-disable-next-line no-console
      console.warn(
        `scenarios.teardown: /api/test/teardown returned ${res.status()}: ${await res
          .text()
          .catch(() => "<no body>")}. testRunId=${testRunId}`,
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `scenarios.teardown: ${(err as Error).message}. testRunId=${testRunId}`,
    );
  }
}

export const test = base.extend<IntegrationFixtures>({
  api: async ({}, use) => {
    const ctx = await pwRequest.newContext();
    try {
      await use(ctx);
    } finally {
      await ctx.dispose();
    }
  },
  sender: async ({ api }, use) => {
    const { testRunId, user } = await provisionUser(api, "sender");
    try {
      await use(user);
    } finally {
      await teardown(api, testRunId);
    }
  },
  pair: async ({ api }, use) => {
    const scenario = await provisionPair(api);
    try {
      await use(scenario);
    } finally {
      await teardown(api, scenario.testRunId);
    }
  },
});

export { expect } from "@playwright/test";

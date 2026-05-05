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
 * Currently exposes a single `sender` fixture. A multi-account
 * `recipient` fixture (paired with sender via a shared testRunId)
 * will be added when the first cross-account test is written —
 * shipping it ahead of a real consumer would let an unverified
 * lifecycle leak into green CI.
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

export interface IntegrationFixtures {
  /** A request context shared across the test — disposed in fixture teardown. */
  api: APIRequestContext;
  /** A regular (non-admin) test user. Created on first access. */
  sender: IntegrationUser;
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
});

export { expect } from "@playwright/test";

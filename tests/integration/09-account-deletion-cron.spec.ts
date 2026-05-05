import { test, expect } from "./fixtures/scenarios";

/**
 * Integration test #8 — Account-deletion cron cascade.
 *
 * Verifies that the `accountDeletion()` cron at
 * express-api/src/cron/accountDeletion.js, when triggered after a
 * user's grace period expires, actually deletes the user's primary
 * doc (and its subcollections — verified indirectly via the
 * fixture teardown's cascade probe).
 *
 * What this catches that no unit test can:
 *   - The cron's Firestore query (`where('deletionExecuteAt', '>',
 *     0).where('deletionExecuteAt', '<=', timestamp)`) actually
 *     finds users tagged for deletion. A composite-index miss
 *     would silently skip them in production.
 *   - `hardDeleteAccount` runs to completion against a real user
 *     with subcollections.
 *   - The user doc IS actually removed (a regression that only
 *     soft-deletes by setting a flag would surface here).
 *
 * Per `.project/plans/2026-05-05-integration-test-framework.md`
 * test #8.
 */

const API_BASE = process.env.API_BASE_URL || "http://localhost:3000";
const TEST_API_KEY = process.env.TEST_API_KEY || "local-test-key";

test.describe("Integration — account-deletion cron cascade", () => {
  test("cron deletes a user whose grace period has expired", async ({
    api,
    sender,
  }) => {
    // Mark the sender for deletion with `deletionExecuteAt` in the
    // past so the cron's "<=now()" predicate matches on first run.
    // /api/test/write/users does a merge:true into the existing doc.
    const setDeletion = await api.post(`${API_BASE}/api/test/write/users`, {
      headers: { "X-Test-API-Key": TEST_API_KEY },
      data: {
        id: String(sender.uniqueId),
        deletionScheduledAt: Date.now() - 31 * 86400000,
        deletionExecuteAt: 1, // any positive past timestamp matches
        deletionReason: "user_request",
      },
    });
    expect(
      setDeletion.ok(),
      `mark-for-deletion: ${await setDeletion.text()}`,
    ).toBe(true);

    // Confirm the user exists pre-cron via /api/test/verify so the
    // post-cron 404 is meaningful (not "we never wrote the doc in
    // the first place").
    const pre = await api.get(
      `${API_BASE}/api/test/verify/users/${sender.uniqueId}`,
      { headers: { "X-Test-API-Key": TEST_API_KEY } },
    );
    expect(pre.status(), `pre-cron user must exist`).toBe(200);

    // Trigger the cron. The endpoint loops over all users matching
    // the deletion predicate; our test user is the only one in this
    // emulator with `deletionExecuteAt` set (other test runs are
    // teardown-isolated by `_testRun`).
    const trigger = await api.post(
      `${API_BASE}/api/test/run-cron/account-deletion`,
      {
        headers: {
          "X-Test-API-Key": TEST_API_KEY,
          "Content-Type": "application/json",
        },
        data: {},
      },
    );
    expect(
      trigger.ok(),
      `cron trigger: ${trigger.status()}: ${await trigger.text()}`,
    ).toBe(true);

    // Verify the user doc is GONE. /api/test/verify returns 404
    // when the doc doesn't exist. This is the integration-tier
    // proof that the cron's cascade actually committed.
    const post = await api.get(
      `${API_BASE}/api/test/verify/users/${sender.uniqueId}`,
      { headers: { "X-Test-API-Key": TEST_API_KEY } },
    );
    expect(
      post.status(),
      `post-cron user must be deleted, got status ${post.status()}`,
    ).toBe(404);
  });

  test("cron is a no-op for users without deletionExecuteAt", async ({
    api,
    sender,
  }) => {
    // Sender doc exists but has NO deletionExecuteAt field. The
    // cron's predicate `where('deletionExecuteAt', '>', 0)` must
    // skip this user — verified by checking the doc still exists
    // after a trigger.
    const trigger = await api.post(
      `${API_BASE}/api/test/run-cron/account-deletion`,
      {
        headers: {
          "X-Test-API-Key": TEST_API_KEY,
          "Content-Type": "application/json",
        },
        data: {},
      },
    );
    expect(trigger.ok()).toBe(true);

    const post = await api.get(
      `${API_BASE}/api/test/verify/users/${sender.uniqueId}`,
      { headers: { "X-Test-API-Key": TEST_API_KEY } },
    );
    expect(
      post.status(),
      "user without deletionExecuteAt must NOT be deleted by the cron",
    ).toBe(200);
  });

  test("cron rejects unknown cron name with 400", async ({ api }) => {
    const res = await api.post(
      `${API_BASE}/api/test/run-cron/totally-fake-cron`,
      {
        headers: {
          "X-Test-API-Key": TEST_API_KEY,
          "Content-Type": "application/json",
        },
        data: {},
      },
    );
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/not allowed/i);
  });
});

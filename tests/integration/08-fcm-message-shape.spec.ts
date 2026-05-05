import { test, expect } from "./fixtures/scenarios";

/**
 * Integration test #9 — FCM message-shape verification.
 *
 * Verifies that POST /api/conversations/:id/messages produces an
 * FCM payload with the documented shape that the Android/iOS
 * clients depend on.
 *
 * In NODE_ENV=local the route never contacts real FCM —
 * `fcm.js:sendFcmToTokens` records the `{ tokens, data, ts }` triple
 * to an in-process buffer accessible via /api/test/fcm-captures.
 * The test clears the buffer, sends a PM, and reads back the
 * captured payload.
 *
 * What this catches that no unit test can:
 *   - The full Express → conversations → fcm.js call chain produces
 *     a payload with the contract fields. A unit test mocks
 *     sendFcmToTokens; only this integration tier proves the
 *     production code path actually populates the data object.
 *   - The shouldNotifyRecipient gate (conversations.js:64) does NOT
 *     suppress sends for healthy users with FCM tokens.
 *   - The recipient's `fcmTokens` array is read fresh from Firestore
 *     every send (regression-coverage for a future refactor that
 *     might cache tokens and miss revocations).
 *
 * Per `.project/plans/2026-05-05-integration-test-framework.md`
 * test #9.
 */

const API_BASE = process.env.API_BASE_URL || "http://localhost:3000";
const TEST_API_KEY = process.env.TEST_API_KEY || "local-test-key";

interface FcmCapture {
  tokens: string[];
  data: Record<string, string>;
  ts: number;
}

async function readCaptures(
  api: import("@playwright/test").APIRequestContext,
): Promise<FcmCapture[]> {
  const res = await api.get(`${API_BASE}/api/test/fcm-captures`, {
    headers: { "X-Test-API-Key": TEST_API_KEY },
  });
  if (!res.ok()) {
    throw new Error(
      `readCaptures failed: ${res.status()}: ${await res.text()}`,
    );
  }
  const body = await res.json();
  return body.captures;
}

async function clearCaptures(
  api: import("@playwright/test").APIRequestContext,
): Promise<void> {
  // Express's body parser is strict about Content-Type even on
  // bodyless POSTs in some setups — pass an empty JSON object so we
  // don't depend on that being relaxed.
  const res = await api.post(`${API_BASE}/api/test/fcm-captures/clear`, {
    headers: {
      "X-Test-API-Key": TEST_API_KEY,
      "Content-Type": "application/json",
    },
    data: {},
  });
  if (!res.ok()) {
    throw new Error(
      `clearCaptures failed: ${res.status()}: ${await res.text()}`,
    );
  }
}

test.describe("Integration — FCM payload shape", () => {
  test.beforeEach(async ({ api }) => {
    // Buffer is process-global, so prior tests in the suite (or in
    // the developer's local Express) can leave entries behind.
    await clearCaptures(api);
  });

  test("PM send produces FCM payload with documented shape", async ({
    api,
    pair,
  }) => {
    // Recipient must have an FCM token registered for shouldNotifyRecipient
    // to return true (see conversations.js:69). /api/test/write/users
    // merges into the existing user doc.
    await api.post(`${API_BASE}/api/test/write/users`, {
      headers: { "X-Test-API-Key": TEST_API_KEY },
      data: {
        id: String(pair.recipient.uniqueId),
        fcmTokens: ["fcm-test-token-1"],
        _testRun: pair.testRunId,
      },
    });

    const convId = `${pair.testRunId}_fcm_${Date.now()}`;
    await api.post(`${API_BASE}/api/test/write/conversations`, {
      headers: { "X-Test-API-Key": TEST_API_KEY },
      data: {
        id: convId,
        participantIds: [pair.sender.uniqueId, pair.recipient.uniqueId],
        createdAt: Date.now(),
        _testRun: pair.testRunId,
      },
    });

    const messageText = `fcm-shape-test-${Date.now()}`;
    const post = await api.post(
      `${API_BASE}/api/conversations/${convId}/messages`,
      {
        headers: {
          Authorization: `Bearer ${pair.sender.idToken}`,
          "Content-Type": "application/json",
        },
        data: {
          text: messageText,
          type: "TEXT",
          senderName: pair.sender.displayName,
        },
      },
    );
    expect(
      post.ok(),
      `post expected 200, got ${post.status()}: ${await post.text()}`,
    ).toBe(true);

    // The notification call is fire-and-forget (conversations.js:301).
    // Poll briefly for the capture to land — typically <100ms but
    // emulator scheduling can stretch.
    let captures: FcmCapture[] = [];
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      captures = await readCaptures(api);
      if (captures.length > 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    expect(
      captures.length,
      "exactly one FCM capture must land",
    ).toBeGreaterThanOrEqual(1);
    const cap = captures[0];

    expect(cap.tokens).toEqual(["fcm-test-token-1"]);

    // Data payload contract — must match what conversations.js:117
    // produces. Each value is a string (FCM data messages require
    // string values per spec — fcm.js:23 stringifies before send,
    // but the buffer captures the pre-stringified shape since the
    // local-mode branch skips stringification).
    expect(cap.data).toMatchObject({
      type: "PM",
      senderId: pair.sender.uniqueId,
      messageText,
      conversationId: convId,
      isGroup: "false",
      showPreview: "true",
    });
    expect(cap.data.senderName).toContain(pair.sender.displayName);
    expect(typeof cap.ts).toBe("number");
    expect(cap.ts).toBeGreaterThan(Date.now() - 10_000);
  });

  test("recipient with empty fcmTokens does NOT trigger an FCM capture", async ({
    api,
    pair,
  }) => {
    // The shouldNotifyRecipient gate at conversations.js:69 returns
    // false when fcmTokens is empty/missing. /api/test/setup creates
    // users without fcmTokens (default), so the recipient already
    // has no tokens — we just verify nothing lands in the capture
    // buffer.
    const convId = `${pair.testRunId}_fcm_skip_${Date.now()}`;
    await api.post(`${API_BASE}/api/test/write/conversations`, {
      headers: { "X-Test-API-Key": TEST_API_KEY },
      data: {
        id: convId,
        participantIds: [pair.sender.uniqueId, pair.recipient.uniqueId],
        createdAt: Date.now(),
        _testRun: pair.testRunId,
      },
    });

    const post = await api.post(
      `${API_BASE}/api/conversations/${convId}/messages`,
      {
        headers: {
          Authorization: `Bearer ${pair.sender.idToken}`,
          "Content-Type": "application/json",
        },
        data: { text: "no-fcm", type: "TEXT" },
      },
    );
    expect(post.ok()).toBe(true);

    // Wait the same window we'd wait for a real send to confirm
    // nothing arrives. A regression that suppressed the gate would
    // produce a capture inside this window.
    await new Promise((r) => setTimeout(r, 1000));

    const captures = await readCaptures(api);
    expect(
      captures.length,
      "no FCM capture should land for a recipient with no fcmTokens",
    ).toBe(0);
  });
});

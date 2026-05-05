import { test, expect } from "./fixtures/scenarios";

/**
 * Integration test #5 — PM real-time delivery.
 *
 * Verifies that POST /api/conversations/:id/messages writes BOTH:
 *
 *   1. A message doc to Firestore at
 *      `conversations/{convId}/messages/{messageId}`
 *   2. An RTDB event at `conversations/{convId}/events/lastEvent`
 *      with `{ type: 'new_message', ts: <ms> }`
 *
 * The RTDB write is what drives the Android/iOS clients' real-time
 * "new message" UI updates. Without it, the receiver has to poll.
 *
 * What this catches that no unit test can:
 *   - The Firestore batch + RTDB write actually fan out across
 *     two separate emulators (jest mocks both — emulator does not).
 *   - The RTDB path the route uses (conversations.js:143) matches
 *     the path the clients listen on. A path-rename regression
 *     would break real-time delivery silently in unit tests.
 *   - The `participantIds` field on the conversation doc actually
 *     authorises the sender (regression coverage for the
 *     contract-fix in fix/test-setup-conversations-contract).
 *
 * Per `.project/plans/2026-05-05-integration-test-framework.md`
 * test #5. The route's FCM-push branch is a separate concern
 * (test #9, deferred — needs `_fcmCapture` route hook).
 */

const API_BASE = process.env.API_BASE_URL || "http://localhost:3000";
const TEST_API_KEY = process.env.TEST_API_KEY || "local-test-key";
// Local Firebase RTDB emulator. Namespace MUST match the one Express
// connects to (firebase.js:30 → demo-shytalk-default-rtdb).
const RTDB_BASE = process.env.RTDB_BASE_URL || "http://localhost:9000";
const RTDB_NS = process.env.RTDB_NS || "demo-shytalk-default-rtdb";

interface MessagePostBody {
  text?: string;
  type?: string;
  senderName?: string;
}

/**
 * Read a path from the RTDB emulator via the REST API. The
 * database.rules.json gates `events/lastEvent` reads on
 * `auth != null`, so we MUST pass an `auth` query parameter — the
 * emulator accepts any Firebase-emulator-issued ID token verbatim.
 * Returns the parsed JSON body, or null when the path does not exist.
 */
async function readRtdbPath(
  api: import("@playwright/test").APIRequestContext,
  path: string,
  idToken: string,
): Promise<unknown> {
  const url = `${RTDB_BASE}/${path}.json?ns=${RTDB_NS}&auth=${encodeURIComponent(idToken)}`;
  const res = await api.get(url);
  if (!res.ok()) {
    throw new Error(`RTDB read failed: ${res.status()}: ${await res.text()}`);
  }
  // Empty path returns the JSON literal `null`. We return that
  // verbatim so the caller can disambiguate "absent" from "set to {}".
  return res.json();
}

test.describe("Integration — PM real-time delivery", () => {
  test("sender→recipient PM writes Firestore message + RTDB event", async ({
    api,
    pair,
  }) => {
    // Phase 1 — seed the conversation between the pair. /api/test/write
    // writes via merge:true to the conversations collection (in the
    // ALLOWED_COLLECTIONS list at test-helpers.js:404), tagged with
    // _testRun so it cleans up alongside the pair fixture's teardown.
    const convId = `${pair.testRunId}_pm_${Date.now()}`;
    const seedRes = await api.post(`${API_BASE}/api/test/write/conversations`, {
      headers: { "X-Test-API-Key": TEST_API_KEY },
      data: {
        id: convId,
        participantIds: [pair.sender.uniqueId, pair.recipient.uniqueId],
        createdAt: Date.now(),
        _testRun: pair.testRunId,
      },
    });
    expect(seedRes.ok(), `seed conversation: ${await seedRes.text()}`).toBe(
      true,
    );

    // Capture pre-state of the RTDB lastEvent path so we can
    // distinguish "the route wrote it just now" from "it was already
    // there." Initial state should be null on a fresh conversation.
    const preEvent = await readRtdbPath(
      api,
      `conversations/${convId}/events/lastEvent`,
      pair.sender.idToken,
    );
    expect(preEvent, "RTDB lastEvent must be null pre-send").toBeNull();

    // Phase 2 — post a message as sender.
    const messageBody: MessagePostBody = {
      text: "hello from integration test",
      type: "TEXT",
      senderName: pair.sender.displayName,
    };
    const postRes = await api.post(
      `${API_BASE}/api/conversations/${convId}/messages`,
      {
        headers: {
          Authorization: `Bearer ${pair.sender.idToken}`,
          "Content-Type": "application/json",
        },
        data: messageBody,
      },
    );
    expect(
      postRes.ok(),
      `message post expected 200, got ${postRes.status()}: ${await postRes.text()}`,
    ).toBe(true);

    // Phase 3 — verify the RTDB event landed. The route does the
    // RTDB write fire-and-forget (conversations.js:317), so we
    // poll briefly. The route awaits the rtdb.set() inside its
    // helper (conversations.js:143), so once the route's overall
    // response returns, the Promise has resolved AT LEAST through
    // the .set() call — but we still poll defensively because the
    // RTDB emulator's own propagation isn't strictly synchronous
    // across REST clients.
    let event: unknown = null;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      event = await readRtdbPath(
        api,
        `conversations/${convId}/events/lastEvent`,
        pair.sender.idToken,
      );
      if (event !== null) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(event, "RTDB lastEvent did not appear within 5s").not.toBeNull();
    const evt = event as { type: string; ts: number };
    expect(evt.type).toBe("new_message");
    expect(typeof evt.ts).toBe("number");
    expect(evt.ts).toBeGreaterThan(Date.now() - 10_000);
    expect(evt.ts).toBeLessThanOrEqual(Date.now());

    // Phase 4 — verify the message landed in Firestore. We read
    // back via /api/conversations/:id/messages because that's the
    // public contract the clients use; if the route can't read its
    // own write, the message-listing path is broken and real users
    // would see a missing message.
    const listRes = await api.get(
      `${API_BASE}/api/conversations/${convId}/messages`,
      { headers: { Authorization: `Bearer ${pair.sender.idToken}` } },
    );
    expect(listRes.ok(), `list messages: ${await listRes.text()}`).toBe(true);
    const messages = await listRes.json();
    expect(Array.isArray(messages), "messages must be an array").toBe(true);
    const ours = (messages as Array<{ text: string; senderId: number }>).find(
      (m) => m.text === messageBody.text,
    );
    expect(
      ours,
      `our message must be in the list: ${JSON.stringify(messages)}`,
    ).toBeDefined();
    expect(ours!.senderId).toBe(pair.sender.uniqueId);
  });

  test("non-participant cannot post to a conversation (403)", async ({
    api,
    pair,
  }) => {
    // Seed a conversation between sender and a synthetic third uid
    // (NOT recipient). Then sender attempts to post — they're not
    // a participant, so the route must 403 at conversations.js:230.
    const otherUid = pair.sender.uniqueId + 999_999;
    const convId = `${pair.testRunId}_pm_authz_${Date.now()}`;
    await api.post(`${API_BASE}/api/test/write/conversations`, {
      headers: { "X-Test-API-Key": TEST_API_KEY },
      data: {
        id: convId,
        participantIds: [pair.recipient.uniqueId, otherUid],
        createdAt: Date.now(),
        _testRun: pair.testRunId,
      },
    });

    const res = await api.post(
      `${API_BASE}/api/conversations/${convId}/messages`,
      {
        headers: {
          Authorization: `Bearer ${pair.sender.idToken}`,
          "Content-Type": "application/json",
        },
        data: { text: "I am not allowed", type: "TEXT" },
      },
    );
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/not a participant/i);

    // The RTDB event MUST NOT be written for a rejected post —
    // otherwise an attacker could spam real-time pings without
    // membership.
    const event = await readRtdbPath(
      api,
      `conversations/${convId}/events/lastEvent`,
      pair.sender.idToken,
    );
    expect(event, "RTDB lastEvent must stay null on 403").toBeNull();
  });
});

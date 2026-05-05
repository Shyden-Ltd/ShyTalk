import { test, expect } from "./fixtures/scenarios";

/**
 * Integration test #2 — LiveKit token issuance for an authenticated user.
 *
 * Verifies the full Bearer-token → auth-middleware → uniqueId-resolution
 * → LiveKit JWT signing chain works end-to-end against the real local
 * stack. This is the FIRST authenticated integration test and exercises:
 *
 *   1. /api/test/setup creates a real user doc in the Firestore emulator
 *   2. /api/test/mint-id-token mints a custom token via Admin SDK and
 *      exchanges it via the Auth emulator REST API for an ID token
 *   3. authMiddleware.verifyIdToken accepts the ID token (real Firebase
 *      Auth emulator path)
 *   4. resolveUniqueId queries `users` for `firebaseUid == decoded.uid`
 *      and returns the real uniqueId
 *   5. /api/livekit/token signs a JWT with that uniqueId as `sub`
 *
 * What this catches that no unit test can:
 *   - Auth emulator returning ID tokens that the Admin SDK actually
 *     accepts (cross-process emulator wiring)
 *   - `resolveUniqueId` matching the user doc by `firebaseUid` field
 *   - LIVEKIT_API_KEY / LIVEKIT_API_SECRET env vars actually loaded
 *     into the running Express process (not just the .env file)
 *   - The JWT shape that the Android/iOS clients depend on
 *
 * Per `.project/plans/2026-05-05-integration-test-framework.md` test #2.
 * Per memory `feedback-quality-bar-universal.md` — covers golden path
 * AND failure paths that exist at this tier (401 missing-token, 400
 * missing-roomName both verify the auth + validation chain in one go).
 */

const API_BASE = process.env.API_BASE_URL || "http://localhost:3000";

/**
 * Decode the payload of a JWT (3-part dot-separated string) without
 * verifying the signature. Signature verification belongs to the
 * downstream LiveKit server; integration tier verifies the chain
 * produced a structurally valid token with the correct claims.
 */
function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    throw new Error(
      `Expected 3-part JWT, got ${parts.length} parts: ${jwt.slice(0, 80)}…`,
    );
  }
  const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4);
  const json = Buffer.from(padded, "base64").toString("utf-8");
  return JSON.parse(json);
}

test.describe("Integration — LiveKit token issuance", () => {
  test("POST /api/livekit/token returns a signed JWT for an authenticated user", async ({
    api,
    sender,
  }) => {
    const roomName = `int-test-room-${Date.now()}`;

    const res = await api.post(`${API_BASE}/api/livekit/token`, {
      headers: {
        Authorization: `Bearer ${sender.idToken}`,
        "Content-Type": "application/json",
      },
      data: { roomName },
    });

    expect(res.ok(), `${res.status()}: ${await res.text()}`).toBe(true);
    const body = await res.json();
    expect(typeof body.token, "response.token must be a string").toBe("string");

    // Validate the JWT shape and content. The integration-tier guarantee
    // is that the token was minted by THIS Express against THIS user —
    // so `sub` must equal the user's uniqueId (number-as-string per
    // livekit.js:20) and `video.room` must equal the requested room.
    const payload = decodeJwtPayload(body.token);
    expect(payload.sub, "JWT.sub must be the user's uniqueId").toBe(
      String(sender.uniqueId),
    );
    expect((payload as { video: { room: string } }).video.room).toBe(roomName);
    expect((payload as { video: { roomJoin: boolean } }).video.roomJoin).toBe(
      true,
    );
    expect(
      (payload as { video: { canPublish: boolean } }).video.canPublish,
    ).toBe(true);
    expect(
      (payload as { video: { canSubscribe: boolean } }).video.canSubscribe,
    ).toBe(true);
    // 24h TTL per livekit.js:39 — exp is unix-seconds, so within (now, now+25h)
    const nowSec = Math.floor(Date.now() / 1000);
    expect(payload.exp).toBeGreaterThan(nowSec);
    expect(payload.exp).toBeLessThan(nowSec + 25 * 3600);
  });

  test("POST /api/livekit/token returns 401 when Authorization header missing", async ({
    api,
  }) => {
    // Negative path is integration-tier-relevant because the auth
    // middleware lives BETWEEN the gateway (Caddy → Express) and the
    // route handler. Unit tests can mock authMiddleware away; only
    // integration proves the real middleware actually rejects the
    // unauthenticated request before /api/livekit/token sees it.
    const res = await api.post(`${API_BASE}/api/livekit/token`, {
      headers: { "Content-Type": "application/json" },
      data: { roomName: "no-auth" },
    });
    expect(res.status()).toBe(401);
  });

  test("POST /api/livekit/token returns 400 when roomName missing", async ({
    api,
    sender,
  }) => {
    const res = await api.post(`${API_BASE}/api/livekit/token`, {
      headers: {
        Authorization: `Bearer ${sender.idToken}`,
        "Content-Type": "application/json",
      },
      data: {},
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/roomName/i);
  });
});

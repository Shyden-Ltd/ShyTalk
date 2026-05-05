import { test, expect } from "@playwright/test";

/**
 * Integration test #1 — Express → Firestore round-trip.
 *
 * Verifies the local stack's Express API can read from the Firebase
 * Firestore emulator end-to-end. This is the foundational integration
 * test — all other integration specs assume this round-trip works.
 *
 * Path exercised: client → Caddy gateway (or direct :3000) → Express
 *   → Firebase Admin SDK → Firestore Emulator → response back to client.
 *
 * What this catches that no other test tier covers:
 *   1. Firebase Admin SDK auth (service-account vs emulator detection)
 *   2. Firestore emulator config (FIRESTORE_EMULATOR_HOST env var)
 *   3. Express → Firestore connectivity through the actual stack
 *      (not the mocked-Firestore Jest tests in `express-api/tests/`)
 *
 * Why /api/config/startingScreens: it's an explicitly auth-exempt
 * endpoint (see express-api/src/index.js — `req.path === '/config/startingScreens'`
 * in the unauthenticated allow-list) that performs a Firestore
 * `db.doc('config/startingScreens').get()` read. If Express can't
 * talk to Firestore, this returns 500. If the doc doesn't exist
 * the route returns `{}` — still a valid round-trip. We previously
 * tested /api/coin-packages, but that endpoint requires auth, which
 * makes it inappropriate for a foundation/no-fixture test.
 */

const API_BASE = process.env.API_BASE_URL || "http://localhost:3000";

test.describe("Integration — Express ↔ Firestore", () => {
  test("GET /api/health responds OK from a real Express instance", async ({
    request,
  }) => {
    const res = await request.get(`${API_BASE}/api/health`);
    expect(res.ok(), `${res.status()}: ${await res.text()}`).toBe(true);
    const body = await res.json();
    // health.js returns `{status: 'ok', timestamp, subsystems}` — see
    // express-api/src/routes/health.js. There is no `ok` field.
    expect(body.status).toBe("ok");
  });

  test("GET /api/config/startingScreens does a real Firestore round-trip", async ({
    request,
  }) => {
    // Public endpoint (allow-listed in src/index.js), so no fixture
    // setup needed. Express performs `db.doc('config/startingScreens').get()`
    // — a real Firestore round-trip. A 500 here means Express can't
    // talk to Firestore. An empty `{}` means the doc doesn't exist
    // but the round-trip succeeded, which is also valid for this tier.
    const res = await request.get(`${API_BASE}/api/config/startingScreens`);
    expect(res.ok(), `${res.status()}: ${await res.text()}`).toBe(true);
    const body = await res.json();
    // Body is an object (possibly empty if no config doc exists). We
    // assert shape rather than contents — content tests belong to the
    // route's unit tests, not the integration tier.
    expect(typeof body, `body must be object, got ${typeof body}`).toBe(
      "object",
    );
    expect(body, "body must not be null").not.toBeNull();
    expect(Array.isArray(body), "body must be plain object, not array").toBe(
      false,
    );
  });
});

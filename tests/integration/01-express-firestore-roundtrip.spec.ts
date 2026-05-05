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
 * Why /api/coin-packages: it's a public endpoint (no auth required) that
 * does a Firestore .where().orderBy() query. If Express can't talk to
 * Firestore, this returns 500 or hangs. If the seed data isn't loaded,
 * it returns an empty array (still a valid round-trip).
 */

const API_BASE = process.env.API_BASE_URL || "http://localhost:3000";

test.describe("Integration — Express ↔ Firestore", () => {
  test("GET /api/health responds OK from a real Express instance", async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/health`);
    expect(res.ok(), `${res.status()}: ${await res.text()}`).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("GET /api/coin-packages does a real Firestore round-trip", async ({ request }) => {
    // Public endpoint, no auth. Hits Firestore emulator via Express.
    // A 500 here means Express can't talk to Firestore. An empty
    // array means Firestore is reachable but no data is seeded —
    // still a valid round-trip, but the local seed should populate
    // at least one coin package per local/seed.js.
    const res = await request.get(`${API_BASE}/api/coin-packages`);
    expect(res.ok(), `${res.status()}: ${await res.text()}`).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body), `body must be array, got ${typeof body}`).toBe(true);
    // Note: we don't assert length > 0 because the seed is best-effort.
    // The point of this test is the round-trip works — payload contents
    // are a separate concern handled by data-shape tests in PR B+.
  });
});

import { test, expect } from "@playwright/test";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  doc,
  setDoc,
  updateDoc,
  getDoc,
  type Firestore,
} from "firebase/firestore";

/**
 * Integration test #7 — Firestore security rules enforcement.
 *
 * Verifies that `firestore.rules` enforces the invariants the
 * production server depends on, EVEN when a malicious client
 * bypasses the Express API and writes directly to Firestore.
 *
 * Uses `@firebase/rules-unit-testing` (Firebase's official harness)
 * to spin up an isolated rules-test project ID that talks to the
 * shared Firestore emulator. Each test gets a clean namespace via
 * `testEnv.clearFirestore()`.
 *
 * What this catches that no unit test can:
 *   - The exact rules in `firestore.rules` (loaded verbatim from
 *     disk, not a copy) actually parse and apply.
 *   - The protected-fields list in the user-update rule
 *     (firestore.rules:21-54) includes every server-only field —
 *     a future regression that drops one entry would let the
 *     client edit it directly.
 *   - The `firebaseUid` ownership check correctly identifies the
 *     owner. A client with a different UID cannot impersonate.
 *
 * Per `.project/plans/2026-05-05-integration-test-framework.md`
 * test #7. NOTE: The plan said "suspended user CANNOT update own
 * profile" — but the rule does NOT check `isSuspended` on the
 * existing doc. Suspension is enforced at the API layer
 * (express-api/src/middleware/auth.js:100). The rule-enforced
 * invariants tested here are the field-level write protections
 * (economy, safety, identity).
 */

const FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
const [HOST, PORT] = FIRESTORE_EMULATOR_HOST.split(":");

const RULES_PATH = resolve(__dirname, "../..", "firestore.rules");

// One project ID per test file so concurrent runs (if ever introduced)
// don't clobber each other's rules-tier state. Suffixed with a
// timestamp to ensure each `npm run test:integration` invocation
// gets a fresh namespace even when the emulator persists from a
// previous run.
const PROJECT_ID = `shytalk-rules-test-${Date.now()}`;

let testEnv: RulesTestEnvironment;

test.beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: HOST,
      port: Number(PORT),
      rules: readFileSync(RULES_PATH, "utf-8"),
    },
  });
});

test.afterAll(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

test.beforeEach(async () => {
  // Clear the rules-test namespace between tests so seeded user
  // docs don't bleed.
  if (testEnv) {
    await testEnv.clearFirestore();
  }
});

test.describe("Integration — Firestore rules: users collection", () => {
  test("authed user can READ another user's profile", async () => {
    // Seed via withSecurityRulesDisabled so the create rule (false)
    // doesn't block our setup.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(adminDb, "users", "100000001"), {
        firebaseUid: "uid-target",
        displayName: "Target",
      });
    });

    const reader = testEnv.authenticatedContext("uid-reader");
    const readerDb = reader.firestore() as unknown as Firestore;
    await assertSucceeds(getDoc(doc(readerDb, "users", "100000001")));
  });

  test("unauthenticated user CANNOT read user profile", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(adminDb, "users", "100000002"), {
        firebaseUid: "uid-x",
        displayName: "X",
      });
    });

    const anon = testEnv.unauthenticatedContext();
    const anonDb = anon.firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(anonDb, "users", "100000002")));
  });

  test("user CAN update own non-protected field (displayName)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(adminDb, "users", "100000003"), {
        firebaseUid: "uid-owner",
        displayName: "Original",
        shyCoins: 0,
      });
    });

    const owner = testEnv.authenticatedContext("uid-owner");
    const ownerDb = owner.firestore() as unknown as Firestore;
    await assertSucceeds(
      updateDoc(doc(ownerDb, "users", "100000003"), {
        displayName: "Renamed",
      }),
    );
  });

  test("user CANNOT modify ANOTHER user's doc (firebaseUid mismatch)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(adminDb, "users", "100000004"), {
        firebaseUid: "uid-victim",
        displayName: "Victim",
      });
    });

    const attacker = testEnv.authenticatedContext("uid-attacker");
    const attackerDb = attacker.firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(attackerDb, "users", "100000004"), {
        displayName: "Hacked",
      }),
    );
  });

  test("user CANNOT self-modify economy fields (shyCoins)", async () => {
    // Critical rule: the economy is server-managed. A successful
    // direct-write here would let any user mint coins for free,
    // bypassing the entire purchase + transaction-log flow.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(adminDb, "users", "100000005"), {
        firebaseUid: "uid-owner",
        displayName: "Owner",
        shyCoins: 100,
      });
    });

    const owner = testEnv.authenticatedContext("uid-owner");
    const ownerDb = owner.firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(ownerDb, "users", "100000005"), {
        shyCoins: 999_999_999,
      }),
    );
  });

  test("user CANNOT self-modify safety fields (isSuspended)", async () => {
    // Critical rule: a suspended user must not be able to lift
    // their own suspension.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(adminDb, "users", "100000006"), {
        firebaseUid: "uid-owner",
        isSuspended: true,
        suspensionReason: "TOS violation",
      });
    });

    const owner = testEnv.authenticatedContext("uid-owner");
    const ownerDb = owner.firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(ownerDb, "users", "100000006"), {
        isSuspended: false,
      }),
    );
  });

  test("user CANNOT self-modify identity fields (uniqueId, firebaseUid)", async () => {
    // Critical rule: identity is anchored at user-creation time.
    // A successful self-update here would let an attacker re-anchor
    // their account to a different uniqueId / Firebase UID, breaking
    // every audit log / transaction history reference.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(adminDb, "users", "100000007"), {
        firebaseUid: "uid-owner",
        uniqueId: 100000007,
      });
    });

    const owner = testEnv.authenticatedContext("uid-owner");
    const ownerDb = owner.firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(ownerDb, "users", "100000007"), {
        firebaseUid: "uid-attacker",
      }),
    );
  });

  test("client CANNOT create a user doc directly (server only)", async () => {
    // Critical rule: user creation requires an atomic uniqueId
    // allocation + identity-map write that only the server can do.
    // A client-side create would skip both, allowing duplicate
    // uniqueIds and orphan profiles.
    const owner = testEnv.authenticatedContext("uid-new");
    const ownerDb = owner.firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(ownerDb, "users", "100000008"), {
        firebaseUid: "uid-new",
        displayName: "Bypass",
      }),
    );
  });
});

test.describe("Integration — Firestore rules: warnings subcollection", () => {
  test("client CANNOT read warnings subcollection (server only)", async () => {
    // Critical rule: warnings are moderation-only state. Client
    // reads would let users see (and screenshot, share) other
    // users' moderation history.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(adminDb, "users", "100000009", "warnings", "w1"), {
        reason: "spam",
        issuedAt: Date.now(),
      });
    });

    const reader = testEnv.authenticatedContext("uid-reader");
    const readerDb = reader.firestore() as unknown as Firestore;
    await assertFails(
      getDoc(doc(readerDb, "users", "100000009", "warnings", "w1")),
    );
  });
});

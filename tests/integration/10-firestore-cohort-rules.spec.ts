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
  getDoc,
  type Firestore,
} from "firebase/firestore";

/**
 * Integration test #10 — Firestore rules: cross-cohort read gates
 * (UK OSA #17 — Age-based Segregation, PR 3 of 14).
 *
 * Verifies the cohort-segregation read gates added to `firestore.rules`
 * for `users` / `rooms` / `conversations` / `users/{uid}/stalkers` /
 * `giftRankings`, plus the new `segregationEvents` collection.
 *
 * Cohort algebra (mirror of `firestore.rules`):
 *   effective(x) = (x == null ? 'minor' : x)
 *   gateOpens   <=> effective(token.cohort) == effective(resource.cohort)
 *
 * The null-coalesce is the rollout-safety knob. While PR 1's per-user
 * cohort backfill is propagating and PR 2's claim-mint hasn't fired
 * yet for every active session, BOTH sides default to 'minor' and the
 * gate stays open. Once data + claims catch up the gate tightens
 * automatically — no rules-rev needed.
 *
 * What this catches that no unit test can: that the rule HELPER
 * function `cohortMatchesCaller()` actually compiles, that the
 * top-level helper resolves `resource.data` to the correct doc inside
 * each match block, and that the admin / own-doc / cross-cohort
 * combinations interact the way the spec says.
 *
 * Per `.project/plans/2026-05-13-age-segregation-plan.md` PR 3.
 */

const FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
const [HOST, PORT] = FIRESTORE_EMULATOR_HOST.split(":");

const RULES_PATH = resolve(__dirname, "../..", "firestore.rules");

const PROJECT_ID = `shytalk-cohort-rules-test-${Date.now()}`;

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
  if (testEnv) await testEnv.cleanup();
});

test.beforeEach(async () => {
  if (testEnv) await testEnv.clearFirestore();
});

// ───────────────────────────────────────────────────────────────
// users — cross-cohort read gate (Task 3.1)
// ───────────────────────────────────────────────────────────────

test.describe("Integration — cohort gate: users", () => {
  test("adult CANNOT read minor user doc", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users", "200000001"), {
        firebaseUid: "uid-adult",
        cohort: "adult",
      });
      await setDoc(doc(db, "users", "200000002"), {
        firebaseUid: "uid-minor",
        cohort: "minor",
      });
    });
    const adult = testEnv.authenticatedContext("uid-adult", {
      uniqueId: "200000001",
      cohort: "adult",
    });
    const adultDb = adult.firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(adultDb, "users", "200000002")));
  });

  test("minor CANNOT read adult user doc", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users", "200000003"), {
        firebaseUid: "uid-adult-2",
        cohort: "adult",
      });
      await setDoc(doc(db, "users", "200000004"), {
        firebaseUid: "uid-minor-2",
        cohort: "minor",
      });
    });
    const minor = testEnv.authenticatedContext("uid-minor-2", {
      uniqueId: "200000004",
      cohort: "minor",
    });
    const minorDb = minor.firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(minorDb, "users", "200000003")));
  });

  test("adult CAN read other adult user doc", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users", "200000005"), {
        firebaseUid: "uid-a1",
        cohort: "adult",
      });
      await setDoc(doc(db, "users", "200000006"), {
        firebaseUid: "uid-a2",
        cohort: "adult",
      });
    });
    const a1 = testEnv.authenticatedContext("uid-a1", {
      uniqueId: "200000005",
      cohort: "adult",
    });
    const a1Db = a1.firestore() as unknown as Firestore;
    await assertSucceeds(getDoc(doc(a1Db, "users", "200000006")));
  });

  test("minor CAN read other minor user doc", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users", "200000007"), {
        firebaseUid: "uid-m1",
        cohort: "minor",
      });
      await setDoc(doc(db, "users", "200000008"), {
        firebaseUid: "uid-m2",
        cohort: "minor",
      });
    });
    const m1 = testEnv.authenticatedContext("uid-m1", {
      uniqueId: "200000007",
      cohort: "minor",
    });
    const m1Db = m1.firestore() as unknown as Firestore;
    await assertSucceeds(getDoc(doc(m1Db, "users", "200000008")));
  });

  test("user CAN read OWN doc even when caller-claim and doc cohorts diverge", async () => {
    // Defence against an age-up race: a user's doc rolls from minor →
    // adult at midnight, but their device still holds the previous-day
    // token claim. Until force-refresh fires, claim='minor' and
    // doc='adult'. The own-doc carve-out lets the client read its own
    // user doc anyway (so the app can render the profile screen) and
    // the force-refresh path then closes the window.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users", "200000009"), {
        firebaseUid: "uid-self",
        cohort: "adult",
      });
    });
    const self = testEnv.authenticatedContext("uid-self", {
      // Numeric claim — Firestore rules `==` is type-strict so the
      // `callerUniqueId() == int(uniqueId)` own-doc check requires
      // a number on both sides. The Express signup / sign-in flow
      // sets the claim as a number (firebase-claims.js); these tests
      // mirror that production shape.
      uniqueId: 200000009,
      cohort: "minor", // stale claim
    });
    const selfDb = self.firestore() as unknown as Firestore;
    await assertSucceeds(getDoc(doc(selfDb, "users", "200000009")));
  });

  test("admin CAN read any user doc cross-cohort", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users", "200000010"), {
        firebaseUid: "uid-minor-target",
        cohort: "minor",
      });
    });
    const admin = testEnv.authenticatedContext("uid-admin", {
      uniqueId: "999999999",
      cohort: "adult",
      admin: true,
    });
    const adminDb = admin.firestore() as unknown as Firestore;
    await assertSucceeds(getDoc(doc(adminDb, "users", "200000010")));
  });

  test("null caller-claim + null resource-cohort → both default to minor → read succeeds", async () => {
    // Rollout-safety knob: PR 3 ships before every user is backfilled
    // / every claim is reissued. The null-coalesce on both sides means
    // legacy callers can still read legacy docs. As soon as a user's
    // claim flips to adult, they lose access to null-cohort docs —
    // which forces the server-side backfill ordering (data first,
    // then claims) the plan requires.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users", "200000011"), {
        firebaseUid: "uid-legacy",
        // no cohort field — pre-PR1 state
      });
    });
    const caller = testEnv.authenticatedContext("uid-caller-no-claim", {
      uniqueId: "200000012",
      // no cohort claim
    });
    const callerDb = caller.firestore() as unknown as Firestore;
    await assertSucceeds(getDoc(doc(callerDb, "users", "200000011")));
  });

  test("adult-claim caller CANNOT read null-cohort legacy doc (mismatch)", async () => {
    // Asymmetric fallback: caller adult vs resource null→minor →
    // mismatch → block. Forces server-side backfill to land BEFORE
    // claims are re-issued; otherwise active adult sessions go dark.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users", "200000013"), {
        firebaseUid: "uid-legacy-2",
      });
    });
    const adult = testEnv.authenticatedContext("uid-adult-3", {
      uniqueId: "200000014",
      cohort: "adult",
    });
    const adultDb = adult.firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(adultDb, "users", "200000013")));
  });
});

// ───────────────────────────────────────────────────────────────
// rooms — cross-cohort read gate (Task 3.2)
// ───────────────────────────────────────────────────────────────

test.describe("Integration — cohort gate: rooms", () => {
  test("adult CANNOT read minor room", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "rooms", "room-minor-1"), {
        ownerId: "200000020",
        participantIds: ["200000020"],
        cohort: "minor",
        state: "ACTIVE",
      });
    });
    const adult = testEnv.authenticatedContext("uid-adult-room", {
      uniqueId: "200000021",
      cohort: "adult",
    });
    const adultDb = adult.firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(adultDb, "rooms", "room-minor-1")));
  });

  test("minor CANNOT read adult room", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "rooms", "room-adult-1"), {
        ownerId: "200000022",
        participantIds: ["200000022"],
        cohort: "adult",
        state: "ACTIVE",
      });
    });
    const minor = testEnv.authenticatedContext("uid-minor-room", {
      uniqueId: "200000023",
      cohort: "minor",
    });
    const minorDb = minor.firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(minorDb, "rooms", "room-adult-1")));
  });

  test("same-cohort caller CAN read room", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "rooms", "room-adult-2"), {
        ownerId: "200000024",
        participantIds: ["200000024"],
        cohort: "adult",
        state: "ACTIVE",
      });
    });
    const adult = testEnv.authenticatedContext("uid-adult-room-2", {
      uniqueId: "200000025",
      cohort: "adult",
    });
    const adultDb = adult.firestore() as unknown as Firestore;
    await assertSucceeds(getDoc(doc(adultDb, "rooms", "room-adult-2")));
  });

  test("admin CAN read any room cross-cohort", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "rooms", "room-minor-2"), {
        ownerId: "200000026",
        participantIds: ["200000026"],
        cohort: "minor",
        state: "ACTIVE",
      });
    });
    const admin = testEnv.authenticatedContext("uid-admin-room", {
      uniqueId: "999999998",
      cohort: "adult",
      admin: true,
    });
    const adminDb = admin.firestore() as unknown as Firestore;
    await assertSucceeds(getDoc(doc(adminDb, "rooms", "room-minor-2")));
  });

  test("null cohort on both sides → read succeeds (rollout safety)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "rooms", "room-legacy"), {
        ownerId: "200000027",
        participantIds: ["200000027"],
        state: "ACTIVE",
      });
    });
    const caller = testEnv.authenticatedContext("uid-legacy-room", {
      uniqueId: "200000028",
    });
    const callerDb = caller.firestore() as unknown as Firestore;
    await assertSucceeds(getDoc(doc(callerDb, "rooms", "room-legacy")));
  });
});

// ───────────────────────────────────────────────────────────────
// conversations — crossCohortAtMigration gate (Task 3.3)
// ───────────────────────────────────────────────────────────────

test.describe("Integration — cohort gate: conversations", () => {
  test("participant CANNOT read conversation flagged crossCohortAtMigration", async () => {
    // Pre-segregation DMs between an adult and a minor get
    // `crossCohortAtMigration: true` set at migration. The
    // participants-membership check still passes, but the rules layer
    // now blocks the read so the parties can no longer see the
    // history. This is the "freeze legacy cross-cohort threads" gate.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "conversations", "dm_legacy_cross"), {
        participantIds: ["200000030", "200000031"],
        crossCohortAtMigration: true,
        createdAt: Date.now(),
      });
    });
    const alice = testEnv.authenticatedContext("uid-alice-cross", {
      uniqueId: "200000030",
      cohort: "adult",
    });
    const aliceDb = alice.firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(aliceDb, "conversations", "dm_legacy_cross")));
  });

  test("participant CAN read conversation without crossCohortAtMigration flag", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "conversations", "dm_same_cohort"), {
        participantIds: ["200000032", "200000033"],
        createdAt: Date.now(),
      });
    });
    const alice = testEnv.authenticatedContext("uid-alice-same", {
      uniqueId: "200000032",
      cohort: "adult",
    });
    const aliceDb = alice.firestore() as unknown as Firestore;
    await assertSucceeds(getDoc(doc(aliceDb, "conversations", "dm_same_cohort")));
  });

  test("participant CAN read conversation with explicit crossCohortAtMigration=false", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "conversations", "dm_explicit_false"), {
        participantIds: ["200000034", "200000035"],
        crossCohortAtMigration: false,
        createdAt: Date.now(),
      });
    });
    const alice = testEnv.authenticatedContext("uid-alice-false", {
      uniqueId: "200000034",
      cohort: "adult",
    });
    const aliceDb = alice.firestore() as unknown as Firestore;
    await assertSucceeds(
      getDoc(doc(aliceDb, "conversations", "dm_explicit_false")),
    );
  });

  test("non-participant STILL cannot read (cohort gate does not weaken existing privacy rule)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "conversations", "dm_priv"), {
        participantIds: ["200000036", "200000037"],
      });
    });
    const eve = testEnv.authenticatedContext("uid-eve-conv", {
      uniqueId: "200000038",
      cohort: "adult",
    });
    const eveDb = eve.firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(eveDb, "conversations", "dm_priv")));
  });
});

// ───────────────────────────────────────────────────────────────
// users/{uid}/stalkers — cohort gate on profile-visitor records (Task 3.4)
// ───────────────────────────────────────────────────────────────

test.describe("Integration — cohort gate: stalkers subcollection", () => {
  test("owner CANNOT read cross-cohort stalker entry", async () => {
    // Pre-segregation: an adult profile got visited by a minor; the
    // entry exists. Post-segregation, the adult-owner must not see
    // the minor-visitor's record (defence-in-depth — discovery /
    // profile-view gates above should already prevent this, but the
    // rules layer guarantees correctness even if a higher gate slips).
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(
        doc(db, "users", "200000040", "stalkers", "200000041"),
        { visitorUniqueId: "200000041", cohort: "minor", visitedAt: Date.now() },
      );
    });
    const owner = testEnv.authenticatedContext("uid-owner-stalk", {
      uniqueId: "200000040",
      cohort: "adult",
    });
    const ownerDb = owner.firestore() as unknown as Firestore;
    await assertFails(
      getDoc(doc(ownerDb, "users", "200000040", "stalkers", "200000041")),
    );
  });

  test("owner CAN read same-cohort stalker entry", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(
        doc(db, "users", "200000042", "stalkers", "200000043"),
        { visitorUniqueId: "200000043", cohort: "adult", visitedAt: Date.now() },
      );
    });
    const owner = testEnv.authenticatedContext("uid-owner-stalk-2", {
      uniqueId: 200000042, // numeric — own-doc `int()` comparison
      cohort: "adult",
    });
    const ownerDb = owner.firestore() as unknown as Firestore;
    await assertSucceeds(
      getDoc(doc(ownerDb, "users", "200000042", "stalkers", "200000043")),
    );
  });

  test("non-owner CANNOT read stalker entry even if cohort matches", async () => {
    // Cohort gate must LAYER ON TOP of the existing owner-only gate.
    // A same-cohort stranger must still be blocked.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(
        doc(db, "users", "200000044", "stalkers", "200000045"),
        { visitorUniqueId: "200000045", cohort: "adult", visitedAt: Date.now() },
      );
    });
    const stranger = testEnv.authenticatedContext("uid-stranger", {
      uniqueId: "200000046",
      cohort: "adult",
    });
    const strangerDb = stranger.firestore() as unknown as Firestore;
    await assertFails(
      getDoc(doc(strangerDb, "users", "200000044", "stalkers", "200000045")),
    );
  });
});

// ───────────────────────────────────────────────────────────────
// giftRankings — cohort gate on per-cohort ranking docs (Task 3.4)
// ───────────────────────────────────────────────────────────────

test.describe("Integration — cohort gate: giftRankings", () => {
  test("adult CANNOT read minor giftRankings doc", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "giftRankings", "gift-rose-minor"), {
        cohort: "minor",
        topSenders: [],
      });
    });
    const adult = testEnv.authenticatedContext("uid-adult-rank", {
      uniqueId: "200000050",
      cohort: "adult",
    });
    const adultDb = adult.firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(adultDb, "giftRankings", "gift-rose-minor")));
  });

  test("minor CAN read minor giftRankings doc", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "giftRankings", "gift-rose-minor-2"), {
        cohort: "minor",
        topSenders: [],
      });
    });
    const minor = testEnv.authenticatedContext("uid-minor-rank", {
      uniqueId: "200000051",
      cohort: "minor",
    });
    const minorDb = minor.firestore() as unknown as Firestore;
    await assertSucceeds(
      getDoc(doc(minorDb, "giftRankings", "gift-rose-minor-2")),
    );
  });

  test("admin CAN read any giftRankings doc cross-cohort", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "giftRankings", "gift-rose-minor-3"), {
        cohort: "minor",
        topSenders: [],
      });
    });
    const admin = testEnv.authenticatedContext("uid-admin-rank", {
      uniqueId: "999999997",
      cohort: "adult",
      admin: true,
    });
    const adminDb = admin.firestore() as unknown as Firestore;
    await assertSucceeds(
      getDoc(doc(adminDb, "giftRankings", "gift-rose-minor-3")),
    );
  });
});

// ───────────────────────────────────────────────────────────────
// segregationEvents — admin-read / server-write (Task 3.5)
// ───────────────────────────────────────────────────────────────

test.describe("Integration — segregationEvents collection rules", () => {
  test("admin CAN read segregationEvents", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "segregationEvents", "evt-1"), {
        action: "block",
        actorCohort: "adult",
        targetCohort: "minor",
        route: "users.follow",
        createdAt: Date.now(),
      });
    });
    const admin = testEnv.authenticatedContext("uid-admin-seg", {
      uniqueId: "999999996",
      admin: true,
    });
    const adminDb = admin.firestore() as unknown as Firestore;
    await assertSucceeds(getDoc(doc(adminDb, "segregationEvents", "evt-1")));
  });

  test("non-admin authed user CANNOT read segregationEvents", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "segregationEvents", "evt-2"), {
        action: "block",
      });
    });
    const user = testEnv.authenticatedContext("uid-user-seg", {
      uniqueId: "200000060",
      cohort: "adult",
    });
    const userDb = user.firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(userDb, "segregationEvents", "evt-2")));
  });

  test("unauthenticated CANNOT read segregationEvents", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "segregationEvents", "evt-3"), { action: "block" });
    });
    const anon = testEnv.unauthenticatedContext();
    const anonDb = anon.firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(anonDb, "segregationEvents", "evt-3")));
  });

  test("authed user CANNOT write to segregationEvents (server-only)", async () => {
    const user = testEnv.authenticatedContext("uid-user-write-seg", {
      uniqueId: "200000061",
      cohort: "adult",
    });
    const userDb = user.firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(userDb, "segregationEvents", "evt-write"), {
        action: "block",
      }),
    );
  });

  test("admin CANNOT write to segregationEvents (server-only — admin reads only)", async () => {
    // Even with admin: true, writes must go through the Express
    // segregation middleware (so the audit-log payload is canonical
    // and the actor/route/cohort fields are server-controlled).
    const admin = testEnv.authenticatedContext("uid-admin-write-seg", {
      uniqueId: "999999995",
      admin: true,
    });
    const adminDb = admin.firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(adminDb, "segregationEvents", "evt-admin-write"), {
        action: "block",
      }),
    );
  });
});

// ───────────────────────────────────────────────────────────────
// Subcollection cohort gates — defence-in-depth against bypass-by-path
// ───────────────────────────────────────────────────────────────

test.describe("Integration — cohort gate: rooms/{id}/messages (subcollection bypass)", () => {
  test("cross-cohort caller CANNOT read messages of a same-cohort-blocked room", async () => {
    // A subcollection rule does NOT inherit from the parent — the
    // gate must be re-evaluated explicitly. Without this, a minor
    // who knows an adult roomId (e.g. from a leaked notification or
    // URL) can read the full chat history by `rooms/X/messages/*`
    // even though `rooms/X` itself is blocked. The subcollection
    // rule uses `get(parent)` to read the parent room's cohort.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "rooms", "room-adult-msgs"), {
        ownerId: "200000070",
        participantIds: ["200000070"],
        cohort: "adult",
      });
      await setDoc(
        doc(db, "rooms", "room-adult-msgs", "messages", "msg-1"),
        { senderId: "200000070", text: "adult-only chat", createdAt: Date.now() },
      );
    });
    const minor = testEnv.authenticatedContext("uid-minor-msg", {
      uniqueId: "200000071",
      cohort: "minor",
    });
    const minorDb = minor.firestore() as unknown as Firestore;
    await assertFails(
      getDoc(doc(minorDb, "rooms", "room-adult-msgs", "messages", "msg-1")),
    );
  });

  test("same-cohort caller CAN read messages of a same-cohort room", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "rooms", "room-adult-msgs-2"), {
        ownerId: "200000072",
        participantIds: ["200000072"],
        cohort: "adult",
      });
      await setDoc(
        doc(db, "rooms", "room-adult-msgs-2", "messages", "msg-1"),
        { senderId: "200000072", text: "hi", createdAt: Date.now() },
      );
    });
    const adult = testEnv.authenticatedContext("uid-adult-msg", {
      uniqueId: "200000073",
      cohort: "adult",
    });
    const adultDb = adult.firestore() as unknown as Firestore;
    await assertSucceeds(
      getDoc(doc(adultDb, "rooms", "room-adult-msgs-2", "messages", "msg-1")),
    );
  });

  test("admin CAN read messages of any cohort room", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "rooms", "room-minor-msgs"), {
        ownerId: "200000074",
        participantIds: ["200000074"],
        cohort: "minor",
      });
      await setDoc(
        doc(db, "rooms", "room-minor-msgs", "messages", "msg-1"),
        { senderId: "200000074", text: "hi", createdAt: Date.now() },
      );
    });
    const admin = testEnv.authenticatedContext("uid-admin-msg", {
      uniqueId: "999999994",
      cohort: "adult",
      admin: true,
    });
    const adminDb = admin.firestore() as unknown as Firestore;
    await assertSucceeds(
      getDoc(doc(adminDb, "rooms", "room-minor-msgs", "messages", "msg-1")),
    );
  });
});

test.describe("Integration — cohort gate: rooms/{id}/seatRequests (subcollection bypass)", () => {
  test("cross-cohort caller CANNOT read seatRequests of a same-cohort-blocked room", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "rooms", "room-adult-seat"), {
        ownerId: "200000080",
        participantIds: ["200000080"],
        cohort: "adult",
      });
      await setDoc(
        doc(db, "rooms", "room-adult-seat", "seatRequests", "req-1"),
        { userId: "200000080", createdAt: Date.now() },
      );
    });
    const minor = testEnv.authenticatedContext("uid-minor-seat", {
      uniqueId: "200000081",
      cohort: "minor",
    });
    const minorDb = minor.firestore() as unknown as Firestore;
    await assertFails(
      getDoc(doc(minorDb, "rooms", "room-adult-seat", "seatRequests", "req-1")),
    );
  });

  test("same-cohort caller CAN read seatRequests of a same-cohort room", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "rooms", "room-adult-seat-2"), {
        ownerId: "200000082",
        participantIds: ["200000082"],
        cohort: "adult",
      });
      await setDoc(
        doc(db, "rooms", "room-adult-seat-2", "seatRequests", "req-1"),
        { userId: "200000082", createdAt: Date.now() },
      );
    });
    const adult = testEnv.authenticatedContext("uid-adult-seat", {
      uniqueId: "200000083",
      cohort: "adult",
    });
    const adultDb = adult.firestore() as unknown as Firestore;
    await assertSucceeds(
      getDoc(doc(adultDb, "rooms", "room-adult-seat-2", "seatRequests", "req-1")),
    );
  });
});

test.describe("Integration — cohort gate: users/{uid}/giftWall (subcollection bypass)", () => {
  test("cross-cohort caller CANNOT read another user's giftWall", async () => {
    // giftWall holds publicly-displayable received-gift records on a
    // profile (sender uniqueId, gift type, timestamp). Without the
    // subcollection gate, a minor reading `users/<adult>/giftWall/*`
    // by direct path bypasses the parent user-doc cohort gate.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users", "200000090"), {
        firebaseUid: "uid-adult-gift",
        cohort: "adult",
      });
      await setDoc(
        doc(db, "users", "200000090", "giftWall", "gift-1"),
        { senderUniqueId: "200000091", giftId: "rose", at: Date.now() },
      );
    });
    const minor = testEnv.authenticatedContext("uid-minor-gw", {
      uniqueId: "200000092",
      cohort: "minor",
    });
    const minorDb = minor.firestore() as unknown as Firestore;
    await assertFails(
      getDoc(doc(minorDb, "users", "200000090", "giftWall", "gift-1")),
    );
  });

  test("same-cohort caller CAN read another user's giftWall", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users", "200000093"), {
        firebaseUid: "uid-adult-gift-2",
        cohort: "adult",
      });
      await setDoc(
        doc(db, "users", "200000093", "giftWall", "gift-1"),
        { senderUniqueId: "200000094", giftId: "rose", at: Date.now() },
      );
    });
    const adult = testEnv.authenticatedContext("uid-adult-gw", {
      uniqueId: "200000095",
      cohort: "adult",
    });
    const adultDb = adult.firestore() as unknown as Firestore;
    await assertSucceeds(
      getDoc(doc(adultDb, "users", "200000093", "giftWall", "gift-1")),
    );
  });

  test("owner CAN read OWN giftWall regardless of stale claim (age-up race)", async () => {
    // Mirrors the parent-doc own-doc carve-out: at midnight the user's
    // cohort flips before the client force-refreshes; the own-doc
    // carve-out lets the app keep rendering the profile (including
    // giftWall) while the claim catches up.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users", "200000096"), {
        firebaseUid: "uid-self-gw",
        cohort: "adult",
      });
      await setDoc(
        doc(db, "users", "200000096", "giftWall", "gift-1"),
        { senderUniqueId: "200000097", giftId: "rose", at: Date.now() },
      );
    });
    const self = testEnv.authenticatedContext("uid-self-gw", {
      uniqueId: 200000096, // numeric — own-doc int() comparison
      cohort: "minor", // stale claim
    });
    const selfDb = self.firestore() as unknown as Firestore;
    await assertSucceeds(
      getDoc(doc(selfDb, "users", "200000096", "giftWall", "gift-1")),
    );
  });
});

test.describe("Integration — cohort gate: conversations subcollections + crossCohortAtMigration propagation", () => {
  test("participant CANNOT read messages of conversation flagged crossCohortAtMigration", async () => {
    // Before this gate, blocking the parent `conversations` doc was
    // useless because the participant could still curl
    // `conversations/X/messages/*` and reconstruct the full thread.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "conversations", "dm_cross_msgs"), {
        participantIds: ["200000100", "200000101"],
        crossCohortAtMigration: true,
      });
      await setDoc(
        doc(db, "conversations", "dm_cross_msgs", "messages", "m1"),
        { senderId: "200000100", text: "history", createdAt: Date.now() },
      );
    });
    const alice = testEnv.authenticatedContext("uid-alice-cm", {
      uniqueId: "200000100",
      cohort: "adult",
    });
    const aliceDb = alice.firestore() as unknown as Firestore;
    await assertFails(
      getDoc(
        doc(aliceDb, "conversations", "dm_cross_msgs", "messages", "m1"),
      ),
    );
  });

  test("participant CAN read messages of non-flagged conversation", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "conversations", "dm_ok_msgs"), {
        participantIds: ["200000102", "200000103"],
      });
      await setDoc(
        doc(db, "conversations", "dm_ok_msgs", "messages", "m1"),
        { senderId: "200000102", text: "hi", createdAt: Date.now() },
      );
    });
    const alice = testEnv.authenticatedContext("uid-alice-ok", {
      uniqueId: "200000102",
      cohort: "adult",
    });
    const aliceDb = alice.firestore() as unknown as Firestore;
    await assertSucceeds(
      getDoc(doc(aliceDb, "conversations", "dm_ok_msgs", "messages", "m1")),
    );
  });

  test("participant CANNOT read userSettings of flagged conversation", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "conversations", "dm_cross_us"), {
        participantIds: ["200000104", "200000105"],
        crossCohortAtMigration: true,
      });
      await setDoc(
        doc(db, "conversations", "dm_cross_us", "userSettings", "200000104"),
        { notificationsEnabled: true },
      );
    });
    const alice = testEnv.authenticatedContext("uid-alice-us", {
      uniqueId: "200000104",
      cohort: "adult",
    });
    const aliceDb = alice.firestore() as unknown as Firestore;
    await assertFails(
      getDoc(
        doc(aliceDb, "conversations", "dm_cross_us", "userSettings", "200000104"),
      ),
    );
  });

  test("participant CANNOT read mutes of flagged conversation", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "conversations", "dm_cross_mutes"), {
        participantIds: ["200000106", "200000107"],
        crossCohortAtMigration: true,
      });
      await setDoc(
        doc(db, "conversations", "dm_cross_mutes", "mutes", "200000106"),
        { mutedAt: Date.now() },
      );
    });
    const alice = testEnv.authenticatedContext("uid-alice-mutes", {
      uniqueId: "200000106",
      cohort: "adult",
    });
    const aliceDb = alice.firestore() as unknown as Firestore;
    await assertFails(
      getDoc(
        doc(aliceDb, "conversations", "dm_cross_mutes", "mutes", "200000106"),
      ),
    );
  });

  test("participant CANNOT read mod_log of flagged conversation", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "conversations", "dm_cross_modlog"), {
        participantIds: ["200000108", "200000109"],
        crossCohortAtMigration: true,
      });
      await setDoc(
        doc(db, "conversations", "dm_cross_modlog", "mod_log", "log-1"),
        { action: "kick", at: Date.now() },
      );
    });
    const alice = testEnv.authenticatedContext("uid-alice-modlog", {
      uniqueId: "200000108",
      cohort: "adult",
    });
    const aliceDb = alice.firestore() as unknown as Firestore;
    await assertFails(
      getDoc(
        doc(aliceDb, "conversations", "dm_cross_modlog", "mod_log", "log-1"),
      ),
    );
  });

  test("participant CANNOT read message edits of flagged conversation", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "conversations", "dm_cross_edits"), {
        participantIds: ["200000110", "200000111"],
        crossCohortAtMigration: true,
      });
      await setDoc(
        doc(
          db,
          "conversations",
          "dm_cross_edits",
          "messages",
          "m1",
          "edits",
          "e1",
        ),
        { editedAt: Date.now(), text: "old" },
      );
    });
    const alice = testEnv.authenticatedContext("uid-alice-edits", {
      uniqueId: "200000110",
      cohort: "adult",
    });
    const aliceDb = alice.firestore() as unknown as Firestore;
    await assertFails(
      getDoc(
        doc(
          aliceDb,
          "conversations",
          "dm_cross_edits",
          "messages",
          "m1",
          "edits",
          "e1",
        ),
      ),
    );
  });
});

// ───────────────────────────────────────────────────────────────
// Negative-space coverage: unauthed denies + null-cohort edge cases
// ───────────────────────────────────────────────────────────────

test.describe("Integration — cohort gates: unauthenticated deny", () => {
  test("unauthenticated CANNOT read users", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users", "200000120"), {
        firebaseUid: "uid",
        cohort: "adult",
      });
    });
    const anon = testEnv.unauthenticatedContext();
    const anonDb = anon.firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(anonDb, "users", "200000120")));
  });

  test("unauthenticated CANNOT read rooms", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "rooms", "room-anon"), {
        ownerId: "200000121",
        cohort: "adult",
      });
    });
    const anon = testEnv.unauthenticatedContext();
    const anonDb = anon.firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(anonDb, "rooms", "room-anon")));
  });

  test("unauthenticated CANNOT read giftRankings", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "giftRankings", "gr-anon"), { cohort: "adult" });
    });
    const anon = testEnv.unauthenticatedContext();
    const anonDb = anon.firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(anonDb, "giftRankings", "gr-anon")));
  });
});

test.describe("Integration — cohort gates: null-cohort doc edge cases", () => {
  test("adult owner CANNOT read pre-PR1 null-cohort stalker entry (legacy data)", async () => {
    // Pre-PR1 stalker entries have no `cohort` field. `cohortMatchesCaller()`
    // null-coalesces both sides: caller='adult', doc=null→'minor' →
    // mismatch → block. This is intentional: legacy cross-cohort
    // visit records are invisible post-PR3 even to the profile owner,
    // until a PR-4 backfill rewrites them.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(
        doc(db, "users", "200000130", "stalkers", "200000131"),
        { visitorUniqueId: "200000131", visitedAt: Date.now() }, // no cohort
      );
    });
    const owner = testEnv.authenticatedContext("uid-owner-legacy", {
      uniqueId: 200000130, // numeric for own-doc check
      cohort: "adult",
    });
    const ownerDb = owner.firestore() as unknown as Firestore;
    await assertFails(
      getDoc(doc(ownerDb, "users", "200000130", "stalkers", "200000131")),
    );
  });

  test("adult-claim caller CANNOT read null-cohort giftRankings doc", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "giftRankings", "gr-legacy"), { topSenders: [] });
    });
    const adult = testEnv.authenticatedContext("uid-adult-legacy-gr", {
      uniqueId: "200000132",
      cohort: "adult",
    });
    const adultDb = adult.firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(adultDb, "giftRankings", "gr-legacy")));
  });

  test("null-cohort caller CAN read null-cohort giftRankings doc (rollout safety)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "giftRankings", "gr-legacy-2"), { topSenders: [] });
    });
    const caller = testEnv.authenticatedContext("uid-legacy-gr", {
      uniqueId: "200000133",
    });
    const callerDb = caller.firestore() as unknown as Firestore;
    await assertSucceeds(getDoc(doc(callerDb, "giftRankings", "gr-legacy-2")));
  });
});

// ═══════════════════════════════════════════════════════════════════
// UK OSA #17 PR 7 — Room create-time cohort gate + immutability
// ═══════════════════════════════════════════════════════════════════
//
// PR 3 (above) pins the cross-cohort READ gate; PR 7 pins the
// CREATE-time gate (cohort must match the caller's JWT claim) and
// the IMMUTABILITY of `cohort` post-create.
//
// Why both — defence in depth. PR 7's KMP client stamps the field
// at create-time, but a malicious client could trivially omit or
// forge the value. The rules-layer bind to `request.auth.token`
// means the JWT (server-signed via custom claim mint, PR 2) is the
// only source of truth. Without immutability on update, even a
// correctly-stamped create can be undone by a flip-update later.

import { updateDoc } from "firebase/firestore";

test.describe("Integration — cohort gate: rooms create-time bind", () => {
  test("adult caller CAN create a room with cohort=adult", async () => {
    const adult = testEnv.authenticatedContext("uid-adult-create", {
      uniqueId: "200000200",
      cohort: "adult",
    });
    const db = adult.firestore() as unknown as Firestore;
    await assertSucceeds(
      setDoc(doc(db, "rooms", "room-create-1"), {
        ownerId: "200000200",
        cohort: "adult",
        participantIds: ["200000200"],
        state: "ACTIVE",
      }),
    );
  });

  test("minor caller CAN create a room with cohort=minor", async () => {
    const minor = testEnv.authenticatedContext("uid-minor-create", {
      uniqueId: "200000201",
      cohort: "minor",
    });
    const db = minor.firestore() as unknown as Firestore;
    await assertSucceeds(
      setDoc(doc(db, "rooms", "room-create-2"), {
        ownerId: "200000201",
        cohort: "minor",
        participantIds: ["200000201"],
        state: "ACTIVE",
      }),
    );
  });

  test("adult caller CANNOT create a room tagged cohort=minor (forging defence)", async () => {
    const adult = testEnv.authenticatedContext("uid-adult-create-2", {
      uniqueId: "200000202",
      cohort: "adult",
    });
    const db = adult.firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(db, "rooms", "room-create-3"), {
        ownerId: "200000202",
        cohort: "minor", // claim says adult — mismatch must reject
        participantIds: ["200000202"],
        state: "ACTIVE",
      }),
    );
  });

  test("minor caller CANNOT create a room tagged cohort=adult (forging defence)", async () => {
    const minor = testEnv.authenticatedContext("uid-minor-create-2", {
      uniqueId: "200000203",
      cohort: "minor",
    });
    const db = minor.firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(db, "rooms", "room-create-4"), {
        ownerId: "200000203",
        cohort: "adult", // claim says minor — mismatch must reject
        participantIds: ["200000203"],
        state: "ACTIVE",
      }),
    );
  });

  test("missing cohort field on create is rejected", async () => {
    const adult = testEnv.authenticatedContext("uid-adult-create-3", {
      uniqueId: "200000204",
      cohort: "adult",
    });
    const db = adult.firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(db, "rooms", "room-create-5"), {
        ownerId: "200000204",
        // no cohort
        participantIds: ["200000204"],
        state: "ACTIVE",
      }),
    );
  });

  test("invalid cohort value (string not in allow-list) is rejected", async () => {
    const adult = testEnv.authenticatedContext("uid-adult-create-4", {
      uniqueId: "200000205",
      cohort: "adult",
    });
    const db = adult.firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(db, "rooms", "room-create-6"), {
        ownerId: "200000205",
        cohort: "super-adult", // not 'adult' or 'minor'
        participantIds: ["200000205"],
        state: "ACTIVE",
      }),
    );
  });

  test("ownerId must equal callerUniqueId (no proxy rooms)", async () => {
    const adult = testEnv.authenticatedContext("uid-adult-create-5", {
      uniqueId: "200000206",
      cohort: "adult",
    });
    const db = adult.firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(db, "rooms", "room-create-7"), {
        ownerId: "999999999", // someone else
        cohort: "adult",
        participantIds: ["200000206"],
        state: "ACTIVE",
      }),
    );
  });

  test("null-cohort caller defaults to minor — can create cohort=minor room", async () => {
    const legacy = testEnv.authenticatedContext("uid-no-cohort-claim", {
      uniqueId: "200000207",
      // no cohort claim — rules default to 'minor'
    });
    const db = legacy.firestore() as unknown as Firestore;
    await assertSucceeds(
      setDoc(doc(db, "rooms", "room-create-8"), {
        ownerId: "200000207",
        cohort: "minor",
        participantIds: ["200000207"],
        state: "ACTIVE",
      }),
    );
  });

  test("null-cohort caller CANNOT create cohort=adult room (default minor binds tight)", async () => {
    const legacy = testEnv.authenticatedContext("uid-no-cohort-claim-2", {
      uniqueId: "200000208",
    });
    const db = legacy.firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(db, "rooms", "room-create-9"), {
        ownerId: "200000208",
        cohort: "adult",
        participantIds: ["200000208"],
        state: "ACTIVE",
      }),
    );
  });
});

test.describe("Integration — cohort gate: rooms cohort immutability", () => {
  test("owner CANNOT flip cohort on existing room", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "rooms", "room-flip-1"), {
        ownerId: "200000210",
        cohort: "minor",
        participantIds: ["200000210"],
        state: "ACTIVE",
      });
    });
    const owner = testEnv.authenticatedContext("uid-flip-owner", {
      uniqueId: "200000210",
      cohort: "minor",
    });
    const db = owner.firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(db, "rooms", "room-flip-1"), { cohort: "adult" }),
    );
  });

  test("participant CANNOT flip cohort on a room they joined", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "rooms", "room-flip-2"), {
        ownerId: "200000211",
        cohort: "adult",
        participantIds: ["200000211", "200000212"],
        state: "ACTIVE",
      });
    });
    const participant = testEnv.authenticatedContext("uid-flip-participant", {
      uniqueId: "200000212",
      cohort: "adult",
    });
    const db = participant.firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(db, "rooms", "room-flip-2"), { cohort: "minor" }),
    );
  });

  test("owner CAN update unrelated fields without touching cohort", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "rooms", "room-flip-3"), {
        ownerId: "200000213",
        cohort: "adult",
        participantIds: ["200000213"],
        state: "ACTIVE",
        name: "Old Name",
      });
    });
    const owner = testEnv.authenticatedContext("uid-flip-owner-2", {
      uniqueId: "200000213",
      cohort: "adult",
    });
    const db = owner.firestore() as unknown as Firestore;
    await assertSucceeds(
      updateDoc(doc(db, "rooms", "room-flip-3"), { name: "New Name" }),
    );
  });

  test("joining user CAN add self to participantIds without touching cohort", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "rooms", "room-flip-4"), {
        ownerId: "200000214",
        cohort: "adult",
        participantIds: ["200000214"],
        firstJoinTimestamps: {},
        state: "ACTIVE",
      });
    });
    const joiner = testEnv.authenticatedContext("uid-joiner", {
      uniqueId: "200000215",
      cohort: "adult",
    });
    const db = joiner.firestore() as unknown as Firestore;
    await assertSucceeds(
      updateDoc(doc(db, "rooms", "room-flip-4"), {
        participantIds: ["200000214", "200000215"],
      }),
    );
  });

  test("joining user CANNOT smuggle a cohort flip alongside the participant add", async () => {
    // Without the cohort-immutable check, a join-update could carry
    // a cohort flip "free" because the affectedKeys allow-list
    // (participantIds + firstJoinTimestamps) only enforces what the
    // caller CAN write, not what they CAN'T write. Adding cohort to
    // affectedKeys would break that allow-list. This test pins the
    // composite defence.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "rooms", "room-flip-5"), {
        ownerId: "200000216",
        cohort: "minor",
        participantIds: ["200000216"],
        firstJoinTimestamps: {},
        state: "ACTIVE",
      });
    });
    const malicious = testEnv.authenticatedContext("uid-flip-smuggle", {
      uniqueId: "200000217",
      cohort: "adult",
    });
    const db = malicious.firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(db, "rooms", "room-flip-5"), {
        participantIds: ["200000216", "200000217"],
        cohort: "adult",
      }),
    );
  });
});

test.describe("Integration — rooms join gate (cross-cohort + third-party-id-smuggling)", () => {
  test("cross-cohort caller CANNOT add self to participantIds via update", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "rooms", "room-join-1"), {
        ownerId: "200000300",
        cohort: "adult",
        participantIds: ["200000300"],
        firstJoinTimestamps: {},
        state: "ACTIVE",
      });
    });
    const minor = testEnv.authenticatedContext("uid-join-minor", {
      uniqueId: "200000301",
      cohort: "minor",
    });
    const db = minor.firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(db, "rooms", "room-join-1"), {
        participantIds: ["200000300", "200000301"],
      }),
    );
  });

  test("same-cohort caller CAN add self to participantIds via update", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "rooms", "room-join-2"), {
        ownerId: "200000302",
        cohort: "adult",
        participantIds: ["200000302"],
        firstJoinTimestamps: {},
        state: "ACTIVE",
      });
    });
    const adult = testEnv.authenticatedContext("uid-join-adult", {
      uniqueId: "200000303",
      cohort: "adult",
    });
    const db = adult.firestore() as unknown as Firestore;
    await assertSucceeds(
      updateDoc(doc(db, "rooms", "room-join-2"), {
        participantIds: ["200000302", "200000303"],
      }),
    );
  });

  test("SECURITY: joining caller CANNOT smuggle a third-party uniqueId into participantIds", async () => {
    // Without the +1 element / removeAll-self shape check, an
    // attacker could write `participantIds: [...existing, self,
    // victim]` and drag a third-party uniqueId into the room.
    // Downstream queries would then expose that victim's id to
    // other participants via the room doc.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "rooms", "room-join-3"), {
        ownerId: "200000304",
        cohort: "adult",
        participantIds: ["200000304"],
        firstJoinTimestamps: {},
        state: "ACTIVE",
      });
    });
    const attacker = testEnv.authenticatedContext("uid-join-attacker", {
      uniqueId: "200000305",
      cohort: "adult",
    });
    const db = attacker.firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(db, "rooms", "room-join-3"), {
        // attacker + victim (victim uniqueId 200000306 — not the caller)
        participantIds: ["200000304", "200000305", "200000306"],
      }),
    );
  });

  test("SECURITY: joining caller CANNOT add a different uniqueId in place of self", async () => {
    // Same-shape attack: caller is uniqueId 305 but writes only the
    // owner + a non-self uniqueId into participantIds. The "caller
    // in new participantIds" condition would fail, but a buggy rule
    // (e.g., one that compares the added set to "any string") would
    // pass. This is the inverse of the smuggling test above.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "rooms", "room-join-4"), {
        ownerId: "200000307",
        cohort: "adult",
        participantIds: ["200000307"],
        firstJoinTimestamps: {},
        state: "ACTIVE",
      });
    });
    const attacker = testEnv.authenticatedContext("uid-join-attacker-2", {
      uniqueId: "200000308",
      cohort: "adult",
    });
    const db = attacker.firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(db, "rooms", "room-join-4"), {
        participantIds: ["200000307", "200000309"], // someone else, not caller
      }),
    );
  });
});

// ───────────────────────────────────────────────────────────────
// UK OSA #17 PR 8 — Conversation create-time gate + group freeze
// ───────────────────────────────────────────────────────────────
//
// PR 3 (above) pins the cross-cohort READ gate via the
// `crossCohortAtMigration` flag. PR 8 closes the create + add holes:
//
//   • Caller MUST be in `participantIds` on create (no proxy creation
//     — an attacker could otherwise spawn DMs between two victims).
//   • 1:1 create requires the OTHER participant's CURRENT cohort
//     (read at create time via a single `get()`) matches the caller's
//     JWT claim. Cross-cohort DM creation is blocked client-side
//     without an Express broker endpoint.
//   • Group create requires the stamped `cohort` field matches the
//     caller's claim. Per-member validation is deferred to the add
//     path (one `get()` per add is tractable; N-get on create is not
//     within the 10-get-per-eval limit for large groups).
//   • Participant ADD on update (group growth) checks each new id's
//     cohort, AND is blocked entirely when `frozenAtMigration: true`.
//   • Member REMOVAL (shrinkage) and non-participantIds updates
//     (lastMessage, groupName) remain allowed even on frozen groups —
//     freeze is "no growth," not "no edits."

test.describe("Integration — cohort gate: conversations create-time bind", () => {
  test("adult caller CAN create 1:1 with another adult", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users", "200000400"), { cohort: "adult" });
      await setDoc(doc(db, "users", "200000401"), { cohort: "adult" });
    });
    const caller = testEnv.authenticatedContext("uid-create-1to1-ok", {
      uniqueId: "200000400",
      cohort: "adult",
    });
    const db = caller.firestore() as unknown as Firestore;
    await assertSucceeds(
      setDoc(doc(db, "conversations", "dm_400_401"), {
        participantIds: ["200000400", "200000401"],
        isGroup: false,
        createdAt: Date.now(),
      }),
    );
  });

  test("adult caller CANNOT create 1:1 with a minor (cross-cohort blocked)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users", "200000402"), { cohort: "adult" });
      await setDoc(doc(db, "users", "200000403"), { cohort: "minor" });
    });
    const caller = testEnv.authenticatedContext("uid-create-1to1-bad", {
      uniqueId: "200000402",
      cohort: "adult",
    });
    const db = caller.firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(db, "conversations", "dm_402_403"), {
        participantIds: ["200000402", "200000403"],
        isGroup: false,
        createdAt: Date.now(),
      }),
    );
  });

  test("caller NOT in participantIds CANNOT create (no proxy creation)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users", "200000404"), { cohort: "adult" });
      await setDoc(doc(db, "users", "200000405"), { cohort: "adult" });
    });
    const eve = testEnv.authenticatedContext("uid-create-proxy-eve", {
      uniqueId: "200000499",
      cohort: "adult",
    });
    const db = eve.firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(db, "conversations", "dm_404_405"), {
        // Eve isn't a participant — must be rejected.
        participantIds: ["200000404", "200000405"],
        isGroup: false,
      }),
    );
  });

  test("group create with cohort field matching caller's claim is allowed", async () => {
    const caller = testEnv.authenticatedContext("uid-group-create-ok", {
      uniqueId: "200000406",
      cohort: "adult",
    });
    const db = caller.firestore() as unknown as Firestore;
    await assertSucceeds(
      setDoc(doc(db, "conversations", "group-ok-1"), {
        participantIds: ["200000406"],
        isGroup: true,
        groupName: "My group",
        cohort: "adult",
      }),
    );
  });

  test("group create with cohort field mismatching caller's claim is rejected (forging defence)", async () => {
    const caller = testEnv.authenticatedContext("uid-group-create-bad", {
      uniqueId: "200000407",
      cohort: "minor",
    });
    const db = caller.firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(db, "conversations", "group-bad-1"), {
        participantIds: ["200000407"],
        isGroup: true,
        groupName: "Forged",
        cohort: "adult", // claim says minor — must reject
      }),
    );
  });

  test("group create missing cohort field is rejected", async () => {
    const caller = testEnv.authenticatedContext("uid-group-create-nocohort", {
      uniqueId: "200000408",
      cohort: "adult",
    });
    const db = caller.firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(db, "conversations", "group-nocohort-1"), {
        participantIds: ["200000408"],
        isGroup: true,
        groupName: "Missing tag",
        // no cohort
      }),
    );
  });
});

test.describe("Integration — conversation participant ADD gate + frozenAtMigration freeze", () => {
  test("group admin CAN add a same-cohort participant (single-add)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users", "200000410"), { cohort: "adult" });
      await setDoc(doc(db, "users", "200000411"), { cohort: "adult" });
      await setDoc(doc(db, "conversations", "group-add-ok"), {
        participantIds: ["200000410"],
        isGroup: true,
        groupName: "G",
        cohort: "adult",
      });
    });
    const caller = testEnv.authenticatedContext("uid-add-ok", {
      uniqueId: "200000410",
      cohort: "adult",
    });
    const db = caller.firestore() as unknown as Firestore;
    await assertSucceeds(
      updateDoc(doc(db, "conversations", "group-add-ok"), {
        participantIds: ["200000410", "200000411"],
      }),
    );
  });

  test("group admin CANNOT add a cross-cohort participant", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users", "200000412"), { cohort: "adult" });
      await setDoc(doc(db, "users", "200000413"), { cohort: "minor" });
      await setDoc(doc(db, "conversations", "group-add-bad"), {
        participantIds: ["200000412"],
        isGroup: true,
        cohort: "adult",
      });
    });
    const caller = testEnv.authenticatedContext("uid-add-bad", {
      uniqueId: "200000412",
      cohort: "adult",
    });
    const db = caller.firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(db, "conversations", "group-add-bad"), {
        participantIds: ["200000412", "200000413"],
      }),
    );
  });

  test("group admin CANNOT add ANY participant when frozenAtMigration is true", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users", "200000414"), { cohort: "adult" });
      await setDoc(doc(db, "users", "200000415"), { cohort: "adult" });
      await setDoc(doc(db, "conversations", "group-frozen-1"), {
        participantIds: ["200000414"],
        isGroup: true,
        cohort: "adult",
        frozenAtMigration: true,
      });
    });
    const caller = testEnv.authenticatedContext("uid-frozen-add", {
      uniqueId: "200000414",
      cohort: "adult",
    });
    const db = caller.firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(db, "conversations", "group-frozen-1"), {
        participantIds: ["200000414", "200000415"],
      }),
    );
  });

  test("group admin CAN remove a participant from a frozenAtMigration group (shrinkage allowed)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "conversations", "group-frozen-shrink"), {
        participantIds: ["200000416", "200000417"],
        isGroup: true,
        cohort: "adult",
        frozenAtMigration: true,
      });
    });
    const caller = testEnv.authenticatedContext("uid-frozen-shrink", {
      uniqueId: "200000416",
      cohort: "adult",
    });
    const db = caller.firestore() as unknown as Firestore;
    await assertSucceeds(
      updateDoc(doc(db, "conversations", "group-frozen-shrink"), {
        participantIds: ["200000416"],
      }),
    );
  });

  test("group admin CAN update non-participant fields on a frozen group (lastMessage, etc.)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "conversations", "group-frozen-lastmsg"), {
        participantIds: ["200000418", "200000419"],
        isGroup: true,
        cohort: "adult",
        frozenAtMigration: true,
      });
    });
    const caller = testEnv.authenticatedContext("uid-frozen-lastmsg", {
      uniqueId: "200000418",
      cohort: "adult",
    });
    const db = caller.firestore() as unknown as Firestore;
    await assertSucceeds(
      updateDoc(doc(db, "conversations", "group-frozen-lastmsg"), {
        lastMessage: {
          text: "still chatting",
          senderId: "200000418",
          createdAt: Date.now(),
        },
        lastMessageAt: Date.now(),
      }),
    );
  });

  test("group admin CANNOT bulk-add multiple participants in one update (one-at-a-time invariant)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users", "200000420"), { cohort: "adult" });
      await setDoc(doc(db, "users", "200000421"), { cohort: "adult" });
      await setDoc(doc(db, "users", "200000422"), { cohort: "adult" });
      await setDoc(doc(db, "conversations", "group-bulk-add"), {
        participantIds: ["200000420"],
        isGroup: true,
        cohort: "adult",
      });
    });
    const caller = testEnv.authenticatedContext("uid-bulk-add", {
      uniqueId: "200000420",
      cohort: "adult",
    });
    const db = caller.firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(db, "conversations", "group-bulk-add"), {
        participantIds: ["200000420", "200000421", "200000422"],
      }),
    );
  });
});

test.describe("Integration — messages.create gate (1:1 cross-cohort migration freeze)", () => {
  test("participant CANNOT create message on a 1:1 flagged crossCohortAtMigration", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "conversations", "dm_msg_blocked"), {
        participantIds: ["200000430", "200000431"],
        crossCohortAtMigration: true,
      });
    });
    const caller = testEnv.authenticatedContext("uid-msg-blocked", {
      uniqueId: "200000430",
      cohort: "adult",
    });
    const db = caller.firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(db, "conversations", "dm_msg_blocked", "messages", "m1"), {
        senderId: "200000430",
        text: "should not land",
        createdAt: Date.now(),
      }),
    );
  });

  test("participant CAN create message on a non-flagged 1:1", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "conversations", "dm_msg_ok"), {
        participantIds: ["200000432", "200000433"],
      });
    });
    const caller = testEnv.authenticatedContext("uid-msg-ok", {
      uniqueId: "200000432",
      cohort: "adult",
    });
    const db = caller.firestore() as unknown as Firestore;
    await assertSucceeds(
      setDoc(doc(db, "conversations", "dm_msg_ok", "messages", "m1"), {
        senderId: "200000432",
        text: "hi",
        createdAt: Date.now(),
      }),
    );
  });

  test("participant CAN create message on a frozen GROUP (frozen ≠ message-block for groups)", async () => {
    // Per design § Migration (line 137): existing members keep
    // read+write access to frozen groups. The freeze is participant-
    // list only.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "conversations", "group-frozen-msg"), {
        participantIds: ["200000434", "200000435"],
        isGroup: true,
        cohort: "adult",
        frozenAtMigration: true,
      });
    });
    const caller = testEnv.authenticatedContext("uid-frozen-msg", {
      uniqueId: "200000434",
      cohort: "adult",
    });
    const db = caller.firestore() as unknown as Firestore;
    await assertSucceeds(
      setDoc(doc(db, "conversations", "group-frozen-msg", "messages", "m1"), {
        senderId: "200000434",
        text: "still here",
        createdAt: Date.now(),
      }),
    );
  });
});

// ───────────────────────────────────────────────────────────────
// UK OSA #17 PR 8 — Migration-flag immutability + server-only fields
// + create-time defences against pre-emptive flag stamping
// ───────────────────────────────────────────────────────────────
//
// These tests defend the server-only contract on `crossCohortAtMigration`,
// `frozenAtMigration`, and `frozenAtMigrationAt`. The migration script
// (run via Admin SDK) is the only legitimate writer. Without the
// rules-side immutability + create-stamp block, a participant can:
//   (1) clear `crossCohortAtMigration` to un-hide a migrated 1:1,
//   (2) set `crossCohortAtMigration` to grief a counterpart by
//       hiding a thread they share,
//   (3) clear `frozenAtMigration` on a group to un-freeze it, then
//       bulk-add cross-cohort members (two-step attack),
//   (4) pre-emptively stamp the flags on a NEW conversation at a
//       deterministic dm_<a>_<b> ID, denying the legitimate pair
//       from ever opening that thread (subsequent same-id create
//       collides; the existing flagged doc denies all reads).

test.describe("Integration — conversation migration-flag immutability", () => {
  test("participant CANNOT clear crossCohortAtMigration on a flagged 1:1 (un-hide attack)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "conversations", "dm_flag_clear"), {
        participantIds: ["200000440", "200000441"],
        crossCohortAtMigration: true,
        frozenAtMigration: true,
      });
    });
    // Note: participant can't READ the flagged conv (PR 3 rule) but
    // can still SUBMIT an update — rules evaluate against the
    // server-side resource. Test that the update is rejected even
    // though caller is in participantIds.
    const caller = testEnv.authenticatedContext("uid-flag-clear", {
      uniqueId: "200000440",
      cohort: "adult",
    });
    const db = caller.firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(db, "conversations", "dm_flag_clear"), {
        crossCohortAtMigration: false,
      }),
    );
  });

  test("participant CANNOT set crossCohortAtMigration on a non-flagged thread (grief attack)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "conversations", "dm_flag_set"), {
        participantIds: ["200000442", "200000443"],
      });
    });
    const caller = testEnv.authenticatedContext("uid-flag-set", {
      uniqueId: "200000442",
      cohort: "adult",
    });
    const db = caller.firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(db, "conversations", "dm_flag_set"), {
        crossCohortAtMigration: true,
      }),
    );
  });

  test("participant CANNOT clear frozenAtMigration on a frozen group (two-step bulk-add precursor)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "conversations", "group-frozen-unfreeze"), {
        participantIds: ["200000444", "200000445"],
        isGroup: true,
        cohort: "adult",
        frozenAtMigration: true,
      });
    });
    const caller = testEnv.authenticatedContext("uid-unfreeze", {
      uniqueId: "200000444",
      cohort: "adult",
    });
    const db = caller.firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(db, "conversations", "group-frozen-unfreeze"), {
        frozenAtMigration: false,
      }),
    );
  });

  test("participant CANNOT set frozenAtMigration=true on an unfrozen group (self-freeze attack)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "conversations", "group-self-freeze"), {
        participantIds: ["200000446", "200000447"],
        isGroup: true,
        cohort: "adult",
      });
    });
    const caller = testEnv.authenticatedContext("uid-self-freeze", {
      uniqueId: "200000446",
      cohort: "adult",
    });
    const db = caller.firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(db, "conversations", "group-self-freeze"), {
        frozenAtMigration: true,
      }),
    );
  });

  test("participant CANNOT mutate frozenAtMigrationAt timestamp", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "conversations", "group-ts-tamper"), {
        participantIds: ["200000448", "200000449"],
        isGroup: true,
        cohort: "adult",
        frozenAtMigration: true,
        frozenAtMigrationAt: 1000000000,
      });
    });
    const caller = testEnv.authenticatedContext("uid-ts-tamper", {
      uniqueId: "200000448",
      cohort: "adult",
    });
    const db = caller.firestore() as unknown as Firestore;
    await assertFails(
      updateDoc(doc(db, "conversations", "group-ts-tamper"), {
        frozenAtMigrationAt: 2000000000,
      }),
    );
  });
});

test.describe("Integration — conversation create cannot stamp migration flags", () => {
  test("caller CANNOT stamp crossCohortAtMigration=true on a NEW 1:1 (pre-empt grief)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users", "200000450"), { cohort: "adult" });
      await setDoc(doc(db, "users", "200000451"), { cohort: "adult" });
    });
    const caller = testEnv.authenticatedContext("uid-stamp-cross", {
      uniqueId: "200000450",
      cohort: "adult",
    });
    const db = caller.firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(db, "conversations", "dm_450_451"), {
        participantIds: ["200000450", "200000451"],
        isGroup: false,
        crossCohortAtMigration: true,
      }),
    );
  });

  test("caller CANNOT stamp frozenAtMigration=true on a NEW group (pre-empt self-freeze)", async () => {
    const caller = testEnv.authenticatedContext("uid-stamp-frozen", {
      uniqueId: "200000452",
      cohort: "adult",
    });
    const db = caller.firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(db, "conversations", "group-stamp-frozen"), {
        participantIds: ["200000452"],
        isGroup: true,
        cohort: "adult",
        frozenAtMigration: true,
      }),
    );
  });
});

test.describe("Integration — conversation create structural defences", () => {
  test("group create with >1 participants is rejected (bulk-seed defence)", async () => {
    // Per design — group must be created with caller alone, then
    // members added one-at-a-time via update where the per-add
    // cohort gate fires. Bulk-seed at create would slip cross-cohort
    // members past the per-add validation.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users", "200000460"), { cohort: "adult" });
      await setDoc(doc(db, "users", "200000461"), { cohort: "adult" });
    });
    const caller = testEnv.authenticatedContext("uid-bulk-seed", {
      uniqueId: "200000460",
      cohort: "adult",
    });
    const db = caller.firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(db, "conversations", "group-bulk-seed"), {
        participantIds: ["200000460", "200000461"],
        isGroup: true,
        cohort: "adult",
      }),
    );
  });

  test("group create with non-enum cohort value is rejected", async () => {
    const caller = testEnv.authenticatedContext("uid-bad-cohort", {
      uniqueId: "200000462",
      cohort: "verified-adult", // claim is non-enum (future drift)
    });
    const db = caller.firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(db, "conversations", "group-bad-cohort"), {
        participantIds: ["200000462"],
        isGroup: true,
        cohort: "verified-adult",
      }),
    );
  });

  test("1:1 create with duplicate caller-id participantIds is rejected", async () => {
    // Defensive — if both participantIds were the caller, the rules'
    // removeAll(caller) would return [] and the .data.cohort read
    // would error. The explicit distinct-participants check makes
    // the rule semantics clear.
    const caller = testEnv.authenticatedContext("uid-dup-self", {
      uniqueId: "200000463",
      cohort: "adult",
    });
    const db = caller.firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(db, "conversations", "dm_dup_self"), {
        participantIds: ["200000463", "200000463"],
        isGroup: false,
      }),
    );
  });

  test("1:1 create with missing OTHER user doc is rejected (fail-closed)", async () => {
    // The cohort-check `get()` resolves to null when the other doc
    // doesn't exist — rules evaluator returns false (deny). Pins the
    // fail-closed default; a future refactor that changes the
    // null-handling semantics would break this test.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "users", "200000464"), { cohort: "adult" });
      // user 200000465 deliberately not seeded
    });
    const caller = testEnv.authenticatedContext("uid-missing-other", {
      uniqueId: "200000464",
      cohort: "adult",
    });
    const db = caller.firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(db, "conversations", "dm_464_465"), {
        participantIds: ["200000464", "200000465"],
        isGroup: false,
      }),
    );
  });
});

test.describe("Integration — flagged conversation subcollection write propagation", () => {
  test("participant CANNOT write userSettings on a flagged 1:1 (write-side flag propagation)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "conversations", "dm_us_write_blocked"), {
        participantIds: ["200000470", "200000471"],
        crossCohortAtMigration: true,
      });
    });
    const caller = testEnv.authenticatedContext("uid-us-write", {
      uniqueId: "200000470",
      cohort: "adult",
    });
    const db = caller.firestore() as unknown as Firestore;
    await assertFails(
      setDoc(
        doc(db, "conversations", "dm_us_write_blocked", "userSettings", "200000470"),
        { unreadCount: 0, isHidden: true },
      ),
    );
  });

  test("participant CAN write userSettings on a non-flagged conversation", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "conversations", "dm_us_write_ok"), {
        participantIds: ["200000472", "200000473"],
      });
    });
    const caller = testEnv.authenticatedContext("uid-us-write-ok", {
      uniqueId: "200000472",
      cohort: "adult",
    });
    const db = caller.firestore() as unknown as Firestore;
    await assertSucceeds(
      setDoc(
        doc(db, "conversations", "dm_us_write_ok", "userSettings", "200000472"),
        { unreadCount: 0, isHidden: false },
      ),
    );
  });

  test("admin/mod CANNOT write mutes on a flagged conversation", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, "conversations", "group_mutes_blocked"), {
        participantIds: ["200000474", "200000475"],
        groupAdminIds: ["200000474"],
        groupModIds: [],
        crossCohortAtMigration: true,
      });
    });
    const admin = testEnv.authenticatedContext("uid-mutes-admin", {
      uniqueId: "200000474",
      cohort: "adult",
    });
    const db = admin.firestore() as unknown as Firestore;
    await assertFails(
      setDoc(
        doc(db, "conversations", "group_mutes_blocked", "mutes", "200000475"),
        { mutedAt: Date.now(), mutedBy: "200000474" },
      ),
    );
  });
});

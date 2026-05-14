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

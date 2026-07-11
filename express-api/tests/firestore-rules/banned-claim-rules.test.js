/**
 * REAL Firestore security-rules tests for the SHY-0150 ban gate: a `banned`
 * custom claim on the caller's token denies create/update/delete on every
 * user-writable collection, at the rules layer, independent of the API.
 *
 * Exercised against the live Firestore emulator via `@firebase/rules-unit-testing`
 * (v5) — the SHY-0113/0129 real-engine pattern (see room-rules.test.js). The
 * `banned` claim is placed directly on the test token, which is byte-for-byte
 * what the engine sees at `request.auth.token.banned`; HOW that claim gets onto
 * a real user's token (mint on ban, recompute on unban, revocation, lazy
 * middleware sync) is proven separately in
 * `tests/routes/banned-claim-lifecycle.test.js` against the real Auth emulator.
 * Together the two suites cover the full chain.
 *
 * Contract pinned here (SHY-0150 AC):
 *   1. A token carrying `banned: true` is DENIED create/update/delete on every
 *      gated user-write collection+verb (the OPS table below enumerates them).
 *   2. The same operations with a clean token succeed exactly as today.
 *   3. Reads that are permitted today stay permitted for a banned caller —
 *      the gate restricts WRITES only (ban screen still needs profile/config).
 *   4. `banned` OUTRANKS `admin` on user-write collections (a banned admin's
 *      user-surface writes are denied; admin READS are unchanged). Admin
 *      console mutations ride the Admin SDK via Express, which bypasses rules.
 *   5. A post-unban token (`banned: false`) writes normally, and the helper's
 *      `== true` comparison means ONLY boolean true blocks — the claim is
 *      server-minted (always boolean), so any other shape fails toward the
 *      API-layer gate (SHY-0149) rather than bricking writes on garbage.
 *   6. Performance AC: the gate reads the TOKEN only — no extra `get()` — so
 *      denial works even when NO user doc exists (proven by the users-doc-free
 *      seeding here; the static pin suite asserts the no-get() source shape).
 *
 * RED before the `isBanned()` gate lands in firestore.rules: every "banned →
 * denied" case below FAILS (the write succeeds) until the gate exists.
 *
 * Requires the Firestore emulator (`FIRESTORE_EMULATOR_HOST`, default
 * localhost:8080). Start with `bash local/start.sh` (or
 * `npx firebase emulators:start --project=demo-shytalk --only firestore,auth`).
 */

const { readFileSync } = require('fs');
const { join } = require('path');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');
const { firestoreHostPort, assertEmulatorReachable } = require('../helpers/firebase-emulator');

const RULES_PATH = join(__dirname, '..', '..', '..', 'firestore.rules');

// Distinct demo-* projectId — keeps this suite's data out of the seeded
// `demo-shytalk` namespace and away from the other rules suites' projects.
const PROJECT_ID = `demo-shytalk-banned-rules-${process.env.JEST_WORKER_ID || '1'}`;

// ── Personas (claims ride the test token exactly like the minted JWT) ───────
// Express mints `uniqueId` + `cohort` (+ `admin`) today; SHY-0150 adds
// `banned`. All personas share one cohort — cohort gating is orthogonal to the
// ban gate and already pinned by the cohort suites.
const CLEAN = { uid: 'fbuid-clean-1', uniqueId: 61001, cohort: 'adult' };
// A second clean user who owns rooms/conversations the actors participate in.
const PEER = { uid: 'fbuid-peer-1', uniqueId: 61002, cohort: 'adult' };
const BANNED = { uid: 'fbuid-banned-1', uniqueId: 61010, cohort: 'adult', banned: true };
// Post-unban refreshed token: the recompute mints `banned: false` (merge, not
// delete), so this exact shape is what a restored user's next token carries.
const UNBANNED = { uid: 'fbuid-unbanned-1', uniqueId: 61011, cohort: 'adult', banned: false };
// Non-boolean garbage can only exist if something other than our server minted
// it (the server always writes a boolean). Pins the `== true` semantics.
const GARBAGE = { uid: 'fbuid-garbage-1', uniqueId: 61012, cohort: 'adult', banned: 'yes' };
const ADMIN = { uid: 'fbuid-admin-1', uniqueId: 61098, cohort: 'adult', admin: true };
const BANNED_ADMIN = {
  uid: 'fbuid-badmin-1',
  uniqueId: 61099,
  cohort: 'adult',
  admin: true,
  banned: true,
};

let testEnv;
// One Firestore handle per caller, reused across tests (fresh contexts leak
// grpc keepalive timers — see room-rules.test.js).
const handles = new Map();

function dbFor(persona) {
  const { uid, ...claims } = persona;
  if (!handles.has(uid)) {
    handles.set(uid, testEnv.authenticatedContext(uid, claims).firestore());
  }
  return handles.get(uid);
}

/** Seed any document bypassing rules (preconditions for the ops below). */
async function seedDoc(path, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(path).set(data);
  });
}

const sid = (persona) => String(persona.uniqueId);

beforeAll(async () => {
  await assertEmulatorReachable();
  const { host, port } = firestoreHostPort();
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host, port, rules: readFileSync(RULES_PATH, 'utf8') },
  });
});

afterAll(async () => {
  handles.clear();
  if (testEnv) {
    await testEnv.cleanup();
  }
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

// ═══════════════════════════════════════════════════════════════════════════
// The gated user-write surface. ONE row per collection+verb the ban gate must
// cover; each row generates a banned-denied AND a clean-allowed test, so the
// deny is provably the CLAIM's doing, not a broken precondition. `seed`
// establishes a state in which the ACTOR's op is allowed by today's rules;
// doc ids embed the actor's uniqueId so rows are persona-independent.
// ═══════════════════════════════════════════════════════════════════════════

const OPS = [
  {
    label: 'users update (own non-economy field)',
    seed: (a) =>
      seedDoc(`users/${a.uniqueId}`, {
        firebaseUid: a.uid,
        uniqueId: a.uniqueId,
        cohort: a.cohort,
        description: 'old',
      }),
    op: (db, a) => db.doc(`users/${a.uniqueId}`).update({ description: 'new' }),
  },
  {
    label: 'users/stalkers create (visitor logs own visit)',
    seed: () =>
      seedDoc(`users/${PEER.uniqueId}`, {
        firebaseUid: PEER.uid,
        uniqueId: PEER.uniqueId,
        cohort: PEER.cohort,
      }),
    op: (db, a) =>
      db
        .doc(`users/${PEER.uniqueId}/stalkers/${sid(a)}`)
        .set({ visitorId: sid(a), cohort: a.cohort, visitedAt: 1 }),
  },
  {
    label: 'rooms create',
    seed: () => Promise.resolve(),
    op: (db, a) =>
      db.doc(`rooms/r-create-${a.uniqueId}`).set({
        cohort: a.cohort,
        ownerId: sid(a),
        ownerFirebaseUid: a.uid,
        name: 'Room',
        state: 'OPEN',
        participantIds: [sid(a)],
      }),
  },
  {
    label: 'rooms delete (owner)',
    seed: (a) =>
      seedDoc(`rooms/r-del-${a.uniqueId}`, {
        cohort: a.cohort,
        ownerId: sid(a),
        ownerFirebaseUid: a.uid,
        state: 'OPEN',
        participantIds: [sid(a)],
      }),
    op: (db, a) => db.doc(`rooms/r-del-${a.uniqueId}`).delete(),
  },
  {
    label: 'rooms/messages create (participant)',
    seed: (a) =>
      seedDoc(`rooms/r-msg-${a.uniqueId}`, {
        cohort: a.cohort,
        ownerId: sid(PEER),
        ownerFirebaseUid: PEER.uid,
        state: 'OPEN',
        participantIds: [sid(PEER), sid(a)],
      }),
    op: (db, a) =>
      db
        .doc(`rooms/r-msg-${a.uniqueId}/messages/m-${a.uniqueId}`)
        .set({ senderId: sid(a), text: 'hi', createdAt: 1 }),
  },
  {
    label: 'rooms/messages update (sender)',
    seed: async (a) => {
      await seedDoc(`rooms/r-mu-${a.uniqueId}`, {
        cohort: a.cohort,
        ownerId: sid(PEER),
        ownerFirebaseUid: PEER.uid,
        state: 'OPEN',
        participantIds: [sid(PEER), sid(a)],
      });
      await seedDoc(`rooms/r-mu-${a.uniqueId}/messages/m1`, {
        senderId: sid(a),
        text: 'hi',
      });
    },
    op: (db, a) => db.doc(`rooms/r-mu-${a.uniqueId}/messages/m1`).update({ text: 'edited' }),
  },
  {
    label: 'rooms/messages delete (sender)',
    seed: async (a) => {
      await seedDoc(`rooms/r-md-${a.uniqueId}`, {
        cohort: a.cohort,
        ownerId: sid(PEER),
        ownerFirebaseUid: PEER.uid,
        state: 'OPEN',
        participantIds: [sid(PEER), sid(a)],
      });
      await seedDoc(`rooms/r-md-${a.uniqueId}/messages/m1`, {
        senderId: sid(a),
        text: 'hi',
      });
    },
    op: (db, a) => db.doc(`rooms/r-md-${a.uniqueId}/messages/m1`).delete(),
  },
  {
    label: 'rooms/seatRequests create (self-bound)',
    seed: (a) =>
      seedDoc(`rooms/r-sr-${a.uniqueId}`, {
        cohort: a.cohort,
        ownerId: sid(PEER),
        ownerFirebaseUid: PEER.uid,
        state: 'OPEN',
        participantIds: [sid(PEER), sid(a)],
      }),
    op: (db, a) =>
      db
        .doc(`rooms/r-sr-${a.uniqueId}/seatRequests/sr-${a.uniqueId}`)
        .set({ userId: sid(a), seatIndex: 1 }),
  },
  {
    label: 'rooms/seatRequests update (requester cancels own)',
    seed: async (a) => {
      await seedDoc(`rooms/r-su-${a.uniqueId}`, {
        cohort: a.cohort,
        ownerId: sid(PEER),
        ownerFirebaseUid: PEER.uid,
        state: 'OPEN',
        participantIds: [sid(PEER), sid(a)],
      });
      await seedDoc(`rooms/r-su-${a.uniqueId}/seatRequests/sr1`, {
        userId: sid(a),
        seatIndex: 1,
        status: 'pending',
      });
    },
    op: (db, a) =>
      db.doc(`rooms/r-su-${a.uniqueId}/seatRequests/sr1`).update({ status: 'cancelled' }),
  },
  {
    label: 'conversations create (single-member group)',
    seed: () => Promise.resolve(),
    op: (db, a) =>
      db.doc(`conversations/c-create-${a.uniqueId}`).set({
        participantIds: [sid(a)],
        isGroup: true,
        cohort: a.cohort,
        groupName: 'g',
      }),
  },
  {
    label: 'conversations update (participant, non-membership field)',
    seed: (a) =>
      seedDoc(`conversations/c-upd-${a.uniqueId}`, {
        participantIds: [sid(a), sid(PEER)],
        isGroup: false,
      }),
    op: (db, a) => db.doc(`conversations/c-upd-${a.uniqueId}`).update({ lastMessage: 'x' }),
  },
  {
    label: 'conversations/messages create (participant)',
    seed: (a) =>
      seedDoc(`conversations/c-msg-${a.uniqueId}`, {
        participantIds: [sid(a), sid(PEER)],
        isGroup: false,
      }),
    op: (db, a) =>
      db
        .doc(`conversations/c-msg-${a.uniqueId}/messages/m-${a.uniqueId}`)
        .set({ senderId: sid(a), text: 'hi', createdAt: 1 }),
  },
  {
    label: 'conversations/messages update (sender)',
    seed: async (a) => {
      await seedDoc(`conversations/c-mu-${a.uniqueId}`, {
        participantIds: [sid(a), sid(PEER)],
        groupAdminIds: [],
        groupModIds: [],
      });
      await seedDoc(`conversations/c-mu-${a.uniqueId}/messages/m1`, {
        senderId: sid(a),
        text: 'hi',
      });
    },
    op: (db, a) => db.doc(`conversations/c-mu-${a.uniqueId}/messages/m1`).update({ text: 'e' }),
  },
  {
    label: 'conversations/messages delete (sender)',
    seed: async (a) => {
      await seedDoc(`conversations/c-md-${a.uniqueId}`, {
        participantIds: [sid(a), sid(PEER)],
        groupAdminIds: [],
        groupModIds: [],
      });
      await seedDoc(`conversations/c-md-${a.uniqueId}/messages/m1`, {
        senderId: sid(a),
        text: 'hi',
      });
    },
    op: (db, a) => db.doc(`conversations/c-md-${a.uniqueId}/messages/m1`).delete(),
  },
  {
    label: 'conversations/messages/edits create (participant)',
    seed: async (a) => {
      await seedDoc(`conversations/c-ed-${a.uniqueId}`, {
        participantIds: [sid(a), sid(PEER)],
      });
      await seedDoc(`conversations/c-ed-${a.uniqueId}/messages/m1`, {
        senderId: sid(a),
        text: 'hi',
      });
    },
    op: (db, a) =>
      db
        .doc(`conversations/c-ed-${a.uniqueId}/messages/m1/edits/e-${a.uniqueId}`)
        .set({ previousText: 'hi', editedAt: 1 }),
  },
  {
    label: 'conversations/userSettings write (own settings)',
    seed: (a) =>
      seedDoc(`conversations/c-us-${a.uniqueId}`, {
        participantIds: [sid(a), sid(PEER)],
        groupAdminIds: [],
      }),
    op: (db, a) =>
      db.doc(`conversations/c-us-${a.uniqueId}/userSettings/${sid(a)}`).set({ muted: true }),
  },
  {
    label: 'conversations/settings write (legacy own settings)',
    seed: (a) =>
      seedDoc(`conversations/c-ls-${a.uniqueId}`, {
        participantIds: [sid(a), sid(PEER)],
      }),
    op: (db, a) =>
      db.doc(`conversations/c-ls-${a.uniqueId}/settings/${sid(a)}`).set({ muted: true }),
  },
  {
    label: 'conversations/mutes write (own mute doc)',
    seed: (a) =>
      seedDoc(`conversations/c-mt-${a.uniqueId}`, {
        participantIds: [sid(a), sid(PEER)],
        groupAdminIds: [],
        groupModIds: [],
      }),
    op: (db, a) =>
      db.doc(`conversations/c-mt-${a.uniqueId}/mutes/${sid(a)}`).set({ mutedUntil: 1 }),
  },
  {
    label: 'conversations/mod_log create (group admin)',
    seed: (a) =>
      seedDoc(`conversations/c-ml-${a.uniqueId}`, {
        participantIds: [sid(a), sid(PEER)],
        groupAdminIds: [sid(a)],
        groupModIds: [],
      }),
    op: (db, a) =>
      db
        .doc(`conversations/c-ml-${a.uniqueId}/mod_log/l-${a.uniqueId}`)
        .set({ action: 'mute', actorId: sid(a), at: 1 }),
  },
  {
    label: 'suggestions create',
    seed: () => Promise.resolve(),
    op: (db, a) =>
      db
        .doc(`suggestions/s-create-${a.uniqueId}`)
        .set({ submitterUid: sid(a), status: 'pending', title: 't' }),
  },
  {
    label: 'suggestions update (submitter, pending)',
    seed: (a) =>
      seedDoc(`suggestions/s-upd-${a.uniqueId}`, {
        submitterUid: sid(a),
        status: 'pending',
        title: 't',
      }),
    op: (db, a) => db.doc(`suggestions/s-upd-${a.uniqueId}`).update({ title: 't2' }),
  },
  {
    label: 'suggestions delete (submitter, pending)',
    seed: (a) =>
      seedDoc(`suggestions/s-del-${a.uniqueId}`, {
        submitterUid: sid(a),
        status: 'pending',
        title: 't',
      }),
    op: (db, a) => db.doc(`suggestions/s-del-${a.uniqueId}`).delete(),
  },
  {
    label: 'suggestions/votes create (own vote)',
    seed: (a) =>
      seedDoc(`suggestions/s-vc-${a.uniqueId}`, {
        submitterUid: sid(PEER),
        status: 'accepted',
        title: 't',
      }),
    op: (db, a) =>
      db
        .doc(`suggestions/s-vc-${a.uniqueId}/votes/v-${a.uniqueId}`)
        .set({ voterId: sid(a), value: 1 }),
  },
  {
    label: 'suggestions/votes update (own vote)',
    seed: async (a) => {
      await seedDoc(`suggestions/s-vu-${a.uniqueId}`, {
        submitterUid: sid(PEER),
        status: 'accepted',
        title: 't',
      });
      await seedDoc(`suggestions/s-vu-${a.uniqueId}/votes/v1`, { voterId: sid(a), value: 1 });
    },
    op: (db, a) => db.doc(`suggestions/s-vu-${a.uniqueId}/votes/v1`).update({ value: -1 }),
  },
  {
    label: 'suggestions/votes delete (own vote)',
    seed: async (a) => {
      await seedDoc(`suggestions/s-vd-${a.uniqueId}`, {
        submitterUid: sid(PEER),
        status: 'accepted',
        title: 't',
      });
      await seedDoc(`suggestions/s-vd-${a.uniqueId}/votes/v1`, { voterId: sid(a), value: 1 });
    },
    op: (db, a) => db.doc(`suggestions/s-vd-${a.uniqueId}/votes/v1`).delete(),
  },
  {
    label: 'suggestions/comments create',
    seed: (a) =>
      seedDoc(`suggestions/s-cc-${a.uniqueId}`, {
        submitterUid: sid(PEER),
        status: 'accepted',
        title: 't',
      }),
    op: (db, a) =>
      db
        .doc(`suggestions/s-cc-${a.uniqueId}/comments/c-${a.uniqueId}`)
        .set({ authorId: sid(a), text: 'c', createdAt: 1 }),
  },
  {
    label: 'suggestionDisputes create (self-bound)',
    seed: () => Promise.resolve(),
    op: (db, a) =>
      db
        .doc(`suggestionDisputes/d-${a.uniqueId}`)
        .set({ submitterUid: sid(a), reason: 'r', createdAt: 1 }),
  },
  {
    label: 'suspensionAppeals create (self-bound)',
    seed: () => Promise.resolve(),
    op: (db, a) =>
      db
        .doc(`suspensionAppeals/a-${a.uniqueId}`)
        .set({ uniqueId: sid(a), message: 'appeal', createdAt: 1 }),
  },
  {
    label: 'subscriptions write (own doc)',
    seed: () => Promise.resolve(),
    op: (db, a) => db.doc(`subscriptions/${sid(a)}`).set({ fcmToken: 'tok' }),
  },
  {
    label: 'notifications update (owner marks read)',
    seed: (a) => seedDoc(`notifications/n-${a.uniqueId}`, { uid: sid(a), read: false, text: 'n' }),
    op: (db, a) => db.doc(`notifications/n-${a.uniqueId}`).update({ read: true }),
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// 1 + 2 — the gate itself, per collection+verb (RED until isBanned() lands)
// ═══════════════════════════════════════════════════════════════════════════

describe('banned token → DENIED on every gated user-write op (real rules engine)', () => {
  test.each(OPS.map((o) => [o.label, o]))('DENY banned: %s', async (_label, entry) => {
    await entry.seed(BANNED);
    await assertFails(entry.op(dbFor(BANNED), BANNED));
  });
});

describe('clean token → the SAME ops succeed (denial above is the claim, not a precondition)', () => {
  test.each(OPS.map((o) => [o.label, o]))('ALLOW clean: %s', async (_label, entry) => {
    await entry.seed(CLEAN);
    await assertSucceeds(entry.op(dbFor(CLEAN), CLEAN));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 — reads permitted today remain permitted for a banned caller
// ═══════════════════════════════════════════════════════════════════════════

describe('banned token → reads UNCHANGED (gate is write-only)', () => {
  test('banned user still reads their OWN users doc (ban screen needs the profile)', async () => {
    await seedDoc(`users/${BANNED.uniqueId}`, {
      firebaseUid: BANNED.uid,
      uniqueId: BANNED.uniqueId,
      cohort: BANNED.cohort,
    });
    await assertSucceeds(dbFor(BANNED).doc(`users/${BANNED.uniqueId}`).get());
  });

  test('banned user still reads a same-cohort profile', async () => {
    await seedDoc(`users/${PEER.uniqueId}`, {
      firebaseUid: PEER.uid,
      uniqueId: PEER.uniqueId,
      cohort: PEER.cohort,
    });
    await assertSucceeds(dbFor(BANNED).doc(`users/${PEER.uniqueId}`).get());
  });

  test('banned owner still reads own stalkers entries', async () => {
    await seedDoc(`users/${BANNED.uniqueId}/stalkers/${sid(PEER)}`, {
      visitorId: sid(PEER),
      cohort: BANNED.cohort,
    });
    await assertSucceeds(
      dbFor(BANNED)
        .doc(`users/${BANNED.uniqueId}/stalkers/${sid(PEER)}`)
        .get(),
    );
  });

  test('banned user still reads a same-cohort room', async () => {
    await seedDoc('rooms/r-read', { cohort: BANNED.cohort, ownerId: sid(PEER), state: 'OPEN' });
    await assertSucceeds(dbFor(BANNED).doc('rooms/r-read').get());
  });

  test('banned user still reads same-cohort room messages', async () => {
    await seedDoc('rooms/r-read2', { cohort: BANNED.cohort, ownerId: sid(PEER), state: 'OPEN' });
    await seedDoc('rooms/r-read2/messages/m1', { senderId: sid(PEER), text: 'hi' });
    await assertSucceeds(dbFor(BANNED).doc('rooms/r-read2/messages/m1').get());
  });

  test('banned user still reads same-cohort seatRequests', async () => {
    await seedDoc('rooms/r-read3', { cohort: BANNED.cohort, ownerId: sid(PEER), state: 'OPEN' });
    await seedDoc('rooms/r-read3/seatRequests/sr1', { userId: sid(PEER), seatIndex: 1 });
    await assertSucceeds(dbFor(BANNED).doc('rooms/r-read3/seatRequests/sr1').get());
  });

  test('banned participant still GETs their conversation doc', async () => {
    await seedDoc('conversations/c-read', { participantIds: [sid(BANNED), sid(PEER)] });
    await assertSucceeds(dbFor(BANNED).doc('conversations/c-read').get());
  });

  test('banned participant still reads conversation messages', async () => {
    await seedDoc('conversations/c-read2', { participantIds: [sid(BANNED), sid(PEER)] });
    await seedDoc('conversations/c-read2/messages/m1', { senderId: sid(PEER), text: 'hi' });
    await assertSucceeds(dbFor(BANNED).doc('conversations/c-read2/messages/m1').get());
  });

  test('banned participant still reads own conversation userSettings', async () => {
    await seedDoc('conversations/c-read3', { participantIds: [sid(BANNED), sid(PEER)] });
    await seedDoc(`conversations/c-read3/userSettings/${sid(BANNED)}`, { muted: false });
    await assertSucceeds(
      dbFor(BANNED)
        .doc(`conversations/c-read3/userSettings/${sid(BANNED)}`)
        .get(),
    );
  });

  test('banned participant still reads own LEGACY conversation settings (read half of the split rule)', async () => {
    await seedDoc('conversations/c-read4', { participantIds: [sid(BANNED), sid(PEER)] });
    await seedDoc(`conversations/c-read4/settings/${sid(BANNED)}`, { muted: false });
    await assertSucceeds(
      dbFor(BANNED)
        .doc(`conversations/c-read4/settings/${sid(BANNED)}`)
        .get(),
    );
  });

  test('banned participant still reads conversation mutes', async () => {
    await seedDoc('conversations/c-read5', { participantIds: [sid(BANNED), sid(PEER)] });
    await seedDoc(`conversations/c-read5/mutes/${sid(BANNED)}`, { mutedUntil: 1 });
    await assertSucceeds(
      dbFor(BANNED)
        .doc(`conversations/c-read5/mutes/${sid(BANNED)}`)
        .get(),
    );
  });

  test('banned user still reads a non-pending suggestion', async () => {
    await seedDoc('suggestions/s-read', { submitterUid: sid(PEER), status: 'accepted' });
    await assertSucceeds(dbFor(BANNED).doc('suggestions/s-read').get());
  });

  test('banned user still reads suggestion votes and comments', async () => {
    await seedDoc('suggestions/s-read2', { submitterUid: sid(PEER), status: 'accepted' });
    await seedDoc('suggestions/s-read2/votes/v1', { voterId: sid(PEER), value: 1 });
    await seedDoc('suggestions/s-read2/comments/c1', { authorId: sid(PEER), text: 'c' });
    await assertSucceeds(dbFor(BANNED).doc('suggestions/s-read2/votes/v1').get());
    await assertSucceeds(dbFor(BANNED).doc('suggestions/s-read2/comments/c1').get());
  });

  test('banned user still reads suggestionDisputes', async () => {
    await seedDoc('suggestionDisputes/d-read', { submitterUid: sid(PEER), reason: 'r' });
    await assertSucceeds(dbFor(BANNED).doc('suggestionDisputes/d-read').get());
  });

  test('banned user still reads their OWN suspension appeal', async () => {
    await seedDoc('suspensionAppeals/a-read', { uniqueId: sid(BANNED), message: 'm' });
    await assertSucceeds(dbFor(BANNED).doc('suspensionAppeals/a-read').get());
  });

  test('banned user still reads their OWN subscription doc (read half of the split rule)', async () => {
    await seedDoc(`subscriptions/${sid(BANNED)}`, { fcmToken: 'tok' });
    await assertSucceeds(
      dbFor(BANNED)
        .doc(`subscriptions/${sid(BANNED)}`)
        .get(),
    );
  });

  test('banned user still reads their OWN notifications', async () => {
    await seedDoc('notifications/n-read', { uid: sid(BANNED), read: false });
    await assertSucceeds(dbFor(BANNED).doc('notifications/n-read').get());
  });

  test('banned user still reads app config (ban screen boots through config)', async () => {
    await seedDoc('config/app', { minVersion: '1.0.0' });
    await assertSucceeds(dbFor(BANNED).doc('config/app').get());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 — banned OUTRANKS admin on user-write collections; admin reads unchanged
// ═══════════════════════════════════════════════════════════════════════════

describe('banned outranks admin (user-write surface)', () => {
  test('DENY: a banned admin cannot use the admin branch of suggestions update', async () => {
    await seedDoc('suggestions/s-adm', { submitterUid: sid(PEER), status: 'reviewed', title: 't' });
    await assertFails(dbFor(BANNED_ADMIN).doc('suggestions/s-adm').update({ status: 'accepted' }));
  });

  test('control: the SAME admin-branch update succeeds for a clean admin', async () => {
    await seedDoc('suggestions/s-adm2', {
      submitterUid: sid(PEER),
      status: 'reviewed',
      title: 't',
    });
    await assertSucceeds(dbFor(ADMIN).doc('suggestions/s-adm2').update({ status: 'accepted' }));
  });

  test('DENY: a banned admin cannot create a room (user-write, not moderation)', async () => {
    await assertFails(
      dbFor(BANNED_ADMIN)
        .doc('rooms/r-badm')
        .set({
          cohort: BANNED_ADMIN.cohort,
          ownerId: sid(BANNED_ADMIN),
          ownerFirebaseUid: BANNED_ADMIN.uid,
          state: 'OPEN',
          participantIds: [sid(BANNED_ADMIN)],
        }),
    );
  });

  // Reviewer R1-#3: the three ADMIN-writable collections must obey the same
  // invariant — a banned admin's client-side moderation writes are denied
  // (the admin console mutates via Express + Admin SDK, which bypasses rules,
  // so legitimate moderation is unaffected). Reads stay unchanged.
  test('DENY: a banned admin cannot write blockedTopics; clean admin can', async () => {
    await assertFails(dbFor(BANNED_ADMIN).doc('blockedTopics/t-badm').set({ topic: 'x' }));
    await assertSucceeds(dbFor(ADMIN).doc('blockedTopics/t-adm').set({ topic: 'x' }));
  });

  test('blockedTopics public read is unchanged for a banned caller', async () => {
    await seedDoc('blockedTopics/t-read', { topic: 'x' });
    await assertSucceeds(dbFor(BANNED).doc('blockedTopics/t-read').get());
  });

  test('DENY: a banned admin cannot resolve a suggestionDispute; clean admin can', async () => {
    await seedDoc('suggestionDisputes/d-badm', { submitterUid: sid(PEER), reason: 'r' });
    await assertFails(
      dbFor(BANNED_ADMIN).doc('suggestionDisputes/d-badm').update({ status: 'resolved' }),
    );
    await seedDoc('suggestionDisputes/d-adm', { submitterUid: sid(PEER), reason: 'r' });
    await assertSucceeds(
      dbFor(ADMIN).doc('suggestionDisputes/d-adm').update({ status: 'resolved' }),
    );
  });

  test('DENY: a banned admin cannot write identityGraphs; clean admin can; banned-admin READ unchanged', async () => {
    await assertFails(dbFor(BANNED_ADMIN).doc('identityGraphs/g-badm').set({ nodes: [] }));
    await assertSucceeds(dbFor(ADMIN).doc('identityGraphs/g-adm').set({ nodes: [] }));
    await seedDoc('identityGraphs/g-read', { nodes: [] });
    await assertSucceeds(dbFor(BANNED_ADMIN).doc('identityGraphs/g-read').get());
  });

  test('banned admin READS are unchanged (cross-cohort admin read bypass intact)', async () => {
    await seedDoc('rooms/r-badm-read', { cohort: 'minor', ownerId: sid(PEER), state: 'OPEN' });
    await assertSucceeds(dbFor(BANNED_ADMIN).doc('rooms/r-badm-read').get());
  });

  test('banned admin still reads admin-only surfaces (deviceBans list for the console)', async () => {
    await seedDoc('deviceBans/d1', { deviceId: 'd1', reason: 'r' });
    await assertSucceeds(dbFor(BANNED_ADMIN).doc('deviceBans/d1').get());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 — claim-shape semantics: boolean true blocks; false / non-boolean do not
// ═══════════════════════════════════════════════════════════════════════════

describe('claim-shape semantics (`banned == true` — server-minted boolean)', () => {
  test('post-unban token (banned: false) writes normally', async () => {
    await assertSucceeds(
      dbFor(UNBANNED)
        .doc(`rooms/r-unb-${UNBANNED.uniqueId}`)
        .set({
          cohort: UNBANNED.cohort,
          ownerId: sid(UNBANNED),
          ownerFirebaseUid: UNBANNED.uid,
          state: 'OPEN',
          participantIds: [sid(UNBANNED)],
        }),
    );
  });

  test('non-boolean claim value does NOT trip the gate (only the server-minted boolean true blocks)', async () => {
    // The server only ever mints booleans; a non-boolean here would mean a
    // foreign minting path. `== true` (no coercion in rules) keeps such a
    // token on the API-layer gate (SHY-0149) instead of guessing at intent.
    await assertSucceeds(
      dbFor(GARBAGE)
        .doc(`rooms/r-garb-${GARBAGE.uniqueId}`)
        .set({
          cohort: GARBAGE.cohort,
          ownerId: sid(GARBAGE),
          ownerFirebaseUid: GARBAGE.uid,
          state: 'OPEN',
          participantIds: [sid(GARBAGE)],
        }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 — server-only collections stay locked for banned AND clean alike
// (the gate must not accidentally OPEN anything while threading `!isBanned()`)
// ═══════════════════════════════════════════════════════════════════════════

describe('server-only collections stay fully locked (no accidental widening)', () => {
  test.each([
    ['deviceBans write', (db) => db.doc('deviceBans/d-x').set({ reason: 'r' })],
    ['networkBans write', (db) => db.doc('networkBans/n-x').set({ value: '1.2.3.4' })],
    ['identityMap write', (db) => db.doc('identityMap/i-x').set({ uid: 'u' })],
    ['users create (API-only)', (db) => db.doc('users/99999').set({ uniqueId: 99999 })],
    ['notifications create (server-only)', (db) => db.doc('notifications/n-x').set({ uid: 'u' })],
  ])('%s → denied for clean AND banned', async (_label, op) => {
    await assertFails(op(dbFor(CLEAN)));
    await assertFails(op(dbFor(BANNED)));
  });
});

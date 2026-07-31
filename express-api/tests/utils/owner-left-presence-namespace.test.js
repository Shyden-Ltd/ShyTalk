/**
 * owner-left-presence-namespace.test.js — SHY-0261
 *
 * "Open a room and it closes itself almost immediately."
 *
 * The owner client arms `ownerLeft/{roomId}` on room ENTRY, and that arm
 * writes the signal value immediately (RtdbPresenceService.armOwnerLeftSignal
 * does `setValue` before `onDisconnect().setValue`). So every room entry
 * delivers an owner-left signal to the server. The ONLY thing that stops the
 * server acting on it is the presence re-check: owner present => NOOP.
 *
 * That re-check reads `rooms/{roomId}/presence/{ownerId}` where `ownerId` is
 * the Firestore **uniqueId** (e.g. "10000005"), but the RTDB rule on that path
 * is `auth.uid == $userId` — the Firebase **Auth uid** namespace. The node the
 * server looks for can therefore never exist, the owner reads as absent, and a
 * freshly-opened room (owner alone, no seated non-owner) takes the
 * CLOSE_IMMEDIATE branch. The room destroys itself seconds after it opens.
 *
 * Why the existing suite never caught it: `owner-left-orchestrator.test.js`
 * INJECTS `presenceChecker`, so the test decides what "present" means. A double
 * accepts any argument, and the defect is in the argument — the lookup KEY.
 * This file therefore uses the REAL production wiring end to end: the real
 * `buildPresenceChecker(rtdb)` against the real RTDB emulator, the real
 * `handleOwnerLeftSignal`, and real Firestore room documents.
 *
 * The contract pinned here: presence is keyed by the identity RTDB can
 * authenticate (the Firebase Auth uid) — see `room-presence-rules.test.js`,
 * which proves at the rules layer that no other key is writable — and every
 * server-side presence lookup must resolve into that same namespace.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const { readFileSync } = require('fs');
const { join } = require('path');
const admin = require('firebase-admin');
const { initializeTestEnvironment, assertSucceeds } = require('@firebase/rules-unit-testing');

const { db } = require('../../src/utils/firebase');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { buildPresenceChecker } = require('../../src/utils/event-listeners');
const { handleOwnerLeftSignal } = require('../../src/utils/owner-left-orchestrator');
const { OWNER_LEFT_ACTION } = require('../../src/utils/owner-left-handler');

// The emulator is shared mutable state across parallel Jest workers AND across
// successive runs, so every path this file touches carries a per-file,
// per-worker AND per-RUN prefix.
//
// The run nonce is not ceremony: while this suite was being written, a stray
// presence node survived cleanup and was inherited by the NEXT run, where it
// silently inverted a "room must close" assertion into a pass-shaped failure.
// Stable ids let one run's debris become another run's verdict. Unique ids make
// that impossible rather than unlikely.
const PREFIX = `shy261-w${process.env.JEST_WORKER_ID || '0'}-${Date.now().toString(36)}`;

// The two identity namespaces that this bug conflated. Deliberately shaped so
// they can never be confused for one another when a failure message prints
// them: a numeric-string uniqueId (as the real system mints) and an opaque
// Firebase Auth uid.
const OWNER_UNIQUE_ID = '10000005';
const OWNER_FIREBASE_UID = 'ownerFuidAbc123XYZ';
const SEATED_NON_OWNER_UNIQUE_ID = '10000006';

// The RTDB namespace shared by the enforced client below and the server-side
// reader, so a rules-enforced write is genuinely visible to the code under
// test. (`@firebase/rules-unit-testing` writes to the namespace named after
// its projectId; the app's own Admin SDK pins `<project>-default-rtdb`, a
// different store entirely.)
const SHARED_RTDB_URL = 'http://127.0.0.1:9000?ns=demo-shytalk';

let adminApp;
let rtdb;
let presenceChecker;

let roomSeq = 0;
const createdRoomIds = [];

function nextRoomId() {
  roomSeq += 1;
  const id = `${PREFIX}-room-${roomSeq}`;
  createdRoomIds.push(id);
  return id;
}

function emptySeats() {
  const seats = {};
  for (let i = 0; i < 8; i++) seats[String(i)] = { userId: null, state: 'EMPTY', isMuted: false };
  return seats;
}

/**
 * A room in exactly the shape it has the instant the owner opens it: ACTIVE,
 * owner seated on seat 0, nobody else present. This is the state in which
 * CLOSE_IMMEDIATE fires, which is why "open a room" is the trigger.
 */
function freshlyOpenedRoom(overrides = {}) {
  const seats = emptySeats();
  seats['0'] = { userId: OWNER_UNIQUE_ID, state: 'OCCUPIED', isMuted: false };
  return {
    state: 'ACTIVE',
    ownerId: OWNER_UNIQUE_ID,
    ownerFirebaseUid: OWNER_FIREBASE_UID,
    ownerLeftAt: null,
    participantIds: [OWNER_UNIQUE_ID],
    seats,
    ...overrides,
  };
}

async function seedRoom(roomId, data) {
  await db.doc(`rooms/${roomId}`).set(data);
}

async function readRoom(roomId) {
  const snap = await db.doc(`rooms/${roomId}`).get();
  return snap.exists ? snap.data() : null;
}

/**
 * Write presence exactly as a real client does: as an AUTHENTICATED user, with
 * the RTDB security rules ENFORCED.
 *
 * This deliberately does not use the Admin SDK, which bypasses rules. The bug
 * being guarded against lived precisely in the gap between "the key the client
 * writes" and "the key the rules accept" — an admin write would sail past the
 * rule and the test would keep passing while every real client was rejected.
 * Routing through an enforced context means a regression in EITHER the rule or
 * the server's lookup fails this test.
 *
 * `SHARED_RTDB_URL` binds the server-side reader to the namespace this enforced
 * client writes to (measured, not assumed: rules-unit-testing writes to the
 * namespace named after its projectId, while the app's own Admin SDK pins
 * `<project>-default-rtdb` — two different stores on the same emulator).
 */
async function markPresentAsClientWould(roomId, firebaseUid, uniqueId) {
  const ctx = rulesEnv.authenticatedContext(firebaseUid);
  await assertSucceeds(ctx.database().ref(`rooms/${roomId}/presence/${firebaseUid}`).set(uniqueId));
}

let rulesEnv;

beforeAll(async () => {
  await assertEmulatorReachable();
  process.env.FIREBASE_DATABASE_EMULATOR_HOST =
    process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
  rulesEnv = await initializeTestEnvironment({
    projectId: 'demo-shytalk',
    database: {
      host: '127.0.0.1',
      port: 9000,
      rules: readFileSync(join(__dirname, '..', '..', '..', 'database.rules.json'), 'utf8'),
    },
  });
  adminApp = admin.initializeApp(
    { projectId: 'demo-shytalk', databaseURL: SHARED_RTDB_URL },
    `shy261-${process.env.JEST_WORKER_ID || '0'}-${Date.now()}`,
  );
  rtdb = adminApp.database();
  // The REAL production presence checker, pointed at the store the enforced
  // client writes to. Nothing about its logic is substituted.
  presenceChecker = buildPresenceChecker(rtdb);
});

afterEach(async () => {
  await Promise.all(
    createdRoomIds.map(async (roomId) => {
      await db.doc(`rooms/${roomId}`).delete();
      await rtdb.ref(`rooms/${roomId}`).remove();
    }),
  );
  createdRoomIds.length = 0;
});

afterAll(async () => {
  process.env.NODE_ENV = PRIOR_NODE_ENV;
  if (rulesEnv) await rulesEnv.cleanup();
  // This suite owns `adminApp` outright (the shared one from src/utils/firebase
  // is untouched), so tearing it down here cannot strand another suite.
  if (adminApp) await adminApp.delete();
});

describe('a room must not close itself while its owner is in it', () => {
  test('owner opens a room and is present — the arming signal must NOT close it', async () => {
    // The P0 regression. Everything here is the real system: a real room doc,
    // a real presence node at the only key the rules permit, the real checker.
    const roomId = nextRoomId();
    await seedRoom(roomId, freshlyOpenedRoom());
    await markPresentAsClientWould(roomId, OWNER_FIREBASE_UID, OWNER_UNIQUE_ID);

    const result = await handleOwnerLeftSignal({
      db,
      presenceChecker,
      roomId,
      writerUid: OWNER_FIREBASE_UID,
      nowMs: Date.now(),
    });

    expect(result.action).toBe(OWNER_LEFT_ACTION.NOOP);

    const after = await readRoom(roomId);
    expect(after.state).toBe('ACTIVE');
    expect(after.closedAt).toBeUndefined();
    // The owner keeps their seat — a "close" empties every seat, so this
    // assertion fails loudly if the close payload was applied at all.
    expect(after.seats['0'].userId).toBe(OWNER_UNIQUE_ID);
  });

  test('the presence lookup resolves the owner into the Firebase-uid namespace', async () => {
    // Anchors the ROOT CAUSE rather than the symptom. Presence exists only
    // under the Firebase uid; a lookup performed in the uniqueId namespace
    // finds nothing. If a future refactor reintroduces `presenceChecker(
    // roomId, room.ownerId)`, this fails even if the close logic changes shape.
    const roomId = nextRoomId();
    await seedRoom(roomId, freshlyOpenedRoom());
    await markPresentAsClientWould(roomId, OWNER_FIREBASE_UID, OWNER_UNIQUE_ID);

    await expect(presenceChecker(roomId, OWNER_FIREBASE_UID)).resolves.toBe(true);
    // The namespace the buggy code used. Proving it is false here is what
    // makes the previous assertion meaningful rather than incidental.
    await expect(presenceChecker(roomId, OWNER_UNIQUE_ID)).resolves.toBe(false);
  });

  test('a room with a seated non-owner also survives while the owner is present', async () => {
    const roomId = nextRoomId();
    const seats = emptySeats();
    seats['0'] = { userId: OWNER_UNIQUE_ID, state: 'OCCUPIED', isMuted: false };
    seats['1'] = { userId: SEATED_NON_OWNER_UNIQUE_ID, state: 'OCCUPIED', isMuted: false };
    await seedRoom(
      roomId,
      freshlyOpenedRoom({
        seats,
        participantIds: [OWNER_UNIQUE_ID, SEATED_NON_OWNER_UNIQUE_ID],
      }),
    );
    await markPresentAsClientWould(roomId, OWNER_FIREBASE_UID, OWNER_UNIQUE_ID);

    const result = await handleOwnerLeftSignal({
      db,
      presenceChecker,
      roomId,
      writerUid: OWNER_FIREBASE_UID,
      nowMs: Date.now(),
    });

    expect(result.action).toBe(OWNER_LEFT_ACTION.NOOP);
    expect((await readRoom(roomId)).state).toBe('ACTIVE');
  });
});

describe('a genuinely departed owner still closes the room (behaviour preserved)', () => {
  test('owner absent and alone — room closes immediately', async () => {
    // No presence node written at all: the owner really is gone. This is the
    // branch the bug was firing spuriously; it must keep working, otherwise
    // the fix would strand empty rooms open forever.
    const roomId = nextRoomId();
    await seedRoom(roomId, freshlyOpenedRoom());

    const result = await handleOwnerLeftSignal({
      db,
      presenceChecker,
      roomId,
      writerUid: OWNER_FIREBASE_UID,
      nowMs: Date.now(),
    });

    expect(result.action).toBe(OWNER_LEFT_ACTION.CLOSE_IMMEDIATE);
    const after = await readRoom(roomId);
    expect(after.state).toBe('CLOSED');
    expect(after.seats['0'].userId).toBeNull();
  });

  test('owner absent with a seated non-owner — room goes OWNER_AWAY, not CLOSED', async () => {
    const roomId = nextRoomId();
    const seats = emptySeats();
    seats['0'] = { userId: OWNER_UNIQUE_ID, state: 'OCCUPIED', isMuted: false };
    seats['1'] = { userId: SEATED_NON_OWNER_UNIQUE_ID, state: 'OCCUPIED', isMuted: false };
    await seedRoom(
      roomId,
      freshlyOpenedRoom({
        seats,
        participantIds: [OWNER_UNIQUE_ID, SEATED_NON_OWNER_UNIQUE_ID],
      }),
    );

    const result = await handleOwnerLeftSignal({
      db,
      presenceChecker,
      roomId,
      writerUid: OWNER_FIREBASE_UID,
      nowMs: Date.now(),
    });

    expect(result.action).toBe(OWNER_LEFT_ACTION.OWNER_AWAY);
    const after = await readRoom(roomId);
    expect(after.state).toBe('OWNER_AWAY');
    expect(after.ownerLeftAt).toEqual(expect.any(Number));
  });

  test('a non-owner cannot forge a signal that closes someone else’s room', async () => {
    const roomId = nextRoomId();
    await seedRoom(roomId, freshlyOpenedRoom());

    const result = await handleOwnerLeftSignal({
      db,
      presenceChecker,
      roomId,
      writerUid: 'attackerFuid999',
      nowMs: Date.now(),
    });

    expect(result.action).toBe(OWNER_LEFT_ACTION.NOOP);
    expect(result.reason).toBe('writer-not-owner');
    expect((await readRoom(roomId)).state).toBe('ACTIVE');
  });
});

describe('uncertainty about the owner must never destroy a room', () => {
  test('a room whose owner identity cannot be resolved is left alone', async () => {
    // A legacy room predating `ownerFirebaseUid`, whose owner has no users
    // document to resolve through. Closing a live room on a failed lookup
    // would be the same class of bug as the one being fixed: an absence of
    // information treated as evidence of absence. Destructive actions fail
    // closed.
    const roomId = nextRoomId();
    const room = freshlyOpenedRoom();
    delete room.ownerFirebaseUid;
    await seedRoom(roomId, room);
    await markPresentAsClientWould(roomId, OWNER_FIREBASE_UID, OWNER_UNIQUE_ID);

    const result = await handleOwnerLeftSignal({
      db,
      presenceChecker,
      roomId,
      // No writerUid: a restart-scan replaying an orphaned signal has no
      // attesting writer, so the attestation branch cannot save us here.
      nowMs: Date.now(),
    });

    expect(result.action).toBe(OWNER_LEFT_ACTION.NOOP);
    expect((await readRoom(roomId)).state).toBe('ACTIVE');
  });
});

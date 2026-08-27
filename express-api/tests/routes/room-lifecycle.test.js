/**
 * Closing a room, and the owner coming back — against REAL Firestore.
 *
 * Extracted from `room-mutations.test.js` (SHY-0485), the fifth slice after
 * seats, moderation, membership and settings. `owner-away` stays behind: it
 * reads RTDB presence, which the SHY-0113 umbrella sequences against SHY-0103.
 *
 * ─── A faked BATCH, not just a faked transaction ────────────────────────────
 *
 * Closing does two things: it empties the room inside a transaction, and then
 * clears `currentRoomId` on every participant's user document in a batch. The
 * second half used to be asserted as "the batch's set function was called three
 * times".
 *
 * Three calls to a spy. Whether any user document actually changed was never
 * asked — and that write is what RELEASES somebody from a room they can no
 * longer see.
 *
 * ─── The best-effort branch ─────────────────────────────────────────────────
 *
 * The batch is deliberately best-effort: a failure must not undo an
 * already-committed close, because clients also self-clear on observing it. The
 * old suite proved that by making a stubbed commit reject. Here the stronger
 * question is asked — the room is CLOSED *and* the user documents are untouched
 * — which is exactly the state that branch produces.
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');

const { db, rtdb } = require('../../src/utils/firebase');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const router = require('../../src/routes/room-mutations');

// Per-file room and user ids: no seeded persona, no other suite (SHY-0464).
const ROOM = 'shy0485-lifecycle';
const OWNER = 64800001;
const HOST = 64800002;
const ATTENDEE = 64800003;
const OUTSIDER = 64800004;
const ACTORS = [OWNER, HOST, ATTENDEE, OUTSIDER];

// Mirrors OWNER_LEAVE_TIMEOUT_MS in src/utils/room-auth.js. Read relative to
// `now` with a wide margin rather than pinned to a clock, so the expiry test
// cannot become time-flaky.
const OWNER_LEAVE_TIMEOUT_MS = 300000;

const roomRef = () => db.doc(`rooms/${ROOM}`);
const eventRef = () => rtdb.ref(`rooms/${ROOM}/events/lastEvent`);
const room = async () => {
  const s = await roomRef().get();
  return s.exists ? s.data() : null;
};
const currentRoomIdOf = async (uid) => {
  const s = await db.doc(`users/${uid}`).get();
  return s.exists ? (s.data().currentRoomId ?? null) : null;
};

function createApp(uniqueId = OWNER, cohort = 'adult') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'fb-uid', uniqueId: String(uniqueId), token: { cohort } };
    next();
  });
  app.use('/api', router);
  return app;
}

function mkRoom(overrides = {}) {
  return {
    ownerId: String(OWNER),
    cohort: 'adult',
    state: 'ACTIVE',
    name: 'Room',
    participantIds: [String(OWNER), String(HOST), String(ATTENDEE)],
    hostIds: [String(HOST)],
    requireApproval: false,
    pendingInvites: {},
    seats: { 0: { userId: String(OWNER), state: 'OCCUPIED', isMuted: false } },
    ...overrides,
  };
}

async function seed(overrides = {}) {
  const data = mkRoom(overrides);
  await roomRef().set(data);
  // Everybody starts "in" the room, so a clear is observable as a change.
  await Promise.all(
    ACTORS.map((id) =>
      db.doc(`users/${id}`).set({ uniqueId: id, cohort: 'adult', currentRoomId: ROOM }),
    ),
  );
  await eventRef()
    .remove()
    .catch(() => {});
  return data;
}

beforeAll(assertEmulatorReachable);

beforeEach(() => roomRef().delete());

afterAll(async () => {
  await roomRef().delete();
  await Promise.all(ACTORS.map((id) => db.doc(`users/${id}`).delete()));
  await rtdb
    .ref(`rooms/${ROOM}`)
    .remove()
    .catch(() => {});
  if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = PRIOR_NODE_ENV;
});

// ═══════════════════════════════════════════════════════════════════
// owner-returned
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/rooms/:roomId/owner-returned', () => {
  const returned = (uid = OWNER, cohort = 'adult') =>
    request(createApp(uid, cohort)).post(`/api/rooms/${ROOM}/owner-returned`).send({});

  test('404 when the room does not exist', async () => {
    expect((await returned()).status).toBe(404);
  });

  test('404 (hidden) on cohort mismatch', async () => {
    const before = await seed({ cohort: 'adult' });
    expect((await returned(OWNER, 'minor')).status).toBe(404);
    expect(await room()).toEqual(before);
  });

  test('403 when a non-owner tries to mark the owner returned', async () => {
    const before = await seed({ state: 'OWNER_AWAY', ownerLeftAt: Date.now() });
    expect((await returned(HOST)).status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('409 when the room is CLOSED', async () => {
    const before = await seed({ state: 'CLOSED' });
    expect((await returned()).status).toBe(409);
    expect(await room()).toEqual(before);
  });

  test('200 the owner returns — the away state is really cleared', async () => {
    await seed({ state: 'OWNER_AWAY', ownerLeftAt: 123 });

    expect((await returned()).status).toBe(200);

    const after = await room();
    expect(after.state).toBe('ACTIVE');
    expect(after.ownerLeftAt).toBeNull();
    expect((await eventRef().once('value')).val()).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════
// close
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/rooms/:roomId/close', () => {
  const close = (uid = OWNER, cohort = 'adult') =>
    request(createApp(uid, cohort)).post(`/api/rooms/${ROOM}/close`).send({});

  test('404 when the room does not exist', async () => {
    expect((await close()).status).toBe(404);
  });

  test('404 (hidden) on cohort mismatch', async () => {
    const before = await seed({ cohort: 'adult' });
    expect((await close(OWNER, 'minor')).status).toBe(404);
    expect(await room()).toEqual(before);
  });

  test('200 the owner closes — the room is emptied and everybody is RELEASED', async () => {
    await seed();

    expect((await close()).status).toBe(200);

    const after = await room();
    expect(after.state).toBe('CLOSED');
    expect(after.ownerLeftAt).toBeNull();
    expect(after.participantIds).toEqual([]);
    expect(typeof after.closedAt).toBe('number');
    // Every seat, not just the occupied one.
    expect(Object.keys(after.seats)).toHaveLength(8);
    expect(after.seats['0']).toEqual({ userId: null, state: 'EMPTY', isMuted: false });

    // The half the spy could not see: each participant's user document really
    // changed. This is what releases somebody from a room they can no longer
    // see.
    expect(await currentRoomIdOf(OWNER)).toBeNull();
    expect(await currentRoomIdOf(HOST)).toBeNull();
    expect(await currentRoomIdOf(ATTENDEE)).toBeNull();
    // And somebody who was never a participant is untouched.
    expect(await currentRoomIdOf(OUTSIDER)).toBe(ROOM);

    expect((await eventRef().once('value')).val()).toBeTruthy();
  });

  test('200 idempotent when already CLOSED — no write, and nobody is re-cleared', async () => {
    await seed({ state: 'CLOSED' });
    // Somebody still carries a stale pointer; an idempotent close must not
    // decide to tidy it, because that is a write on a dead room.
    await db.doc(`users/${ATTENDEE}`).set({ uniqueId: ATTENDEE, currentRoomId: ROOM });
    const before = await room();

    expect((await close()).status).toBe(200);

    expect(await room()).toEqual(before);
    expect(await currentRoomIdOf(ATTENDEE)).toBe(ROOM);
  });

  test('403 a non-owner cannot close an ACTIVE room', async () => {
    const before = await seed({ state: 'ACTIVE' });
    expect((await close(HOST)).status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('200 a non-owner closes an OWNER_AWAY room when no other non-owner is seated', async () => {
    await seed({
      state: 'OWNER_AWAY',
      ownerLeftAt: Date.now(),
      seats: {
        0: { userId: String(OWNER), state: 'OCCUPIED', isMuted: false },
        3: { userId: String(HOST), state: 'OCCUPIED', isMuted: false }, // the caller, alone
      },
    });

    expect((await close(HOST)).status).toBe(200);
    expect((await room()).state).toBe('CLOSED');
  });

  test('403 a non-owner cannot close OWNER_AWAY while another non-owner is seated', async () => {
    const before = await seed({
      state: 'OWNER_AWAY',
      ownerLeftAt: Date.now(),
      seats: {
        0: { userId: String(OWNER), state: 'OCCUPIED', isMuted: false },
        3: { userId: String(HOST), state: 'OCCUPIED', isMuted: false }, // caller
        4: { userId: String(ATTENDEE), state: 'OCCUPIED', isMuted: false }, // still there
      },
    });

    expect((await close(HOST)).status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('200 a non-owner closes an EXPIRED OWNER_AWAY room even with others seated', async () => {
    // Past the away window, the room is abandoned and anybody in it may close
    // it. Set relative to the real timeout with a wide margin.
    await seed({
      state: 'OWNER_AWAY',
      ownerLeftAt: Date.now() - OWNER_LEAVE_TIMEOUT_MS - 60_000,
      seats: {
        0: { userId: String(OWNER), state: 'OCCUPIED', isMuted: false },
        3: { userId: String(HOST), state: 'OCCUPIED', isMuted: false },
        4: { userId: String(ATTENDEE), state: 'OCCUPIED', isMuted: false },
      },
    });

    expect((await close(HOST)).status).toBe(200);
    expect((await room()).state).toBe('CLOSED');
  });

  test('403 a non-owner who is not a participant cannot close', async () => {
    const before = await seed({
      state: 'OWNER_AWAY',
      ownerLeftAt: Date.now(),
      participantIds: [String(OWNER), String(ATTENDEE)],
    });
    expect((await close(HOST)).status).toBe(403);
    expect(await room()).toEqual(before);
  });
});

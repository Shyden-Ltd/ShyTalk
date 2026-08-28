/**
 * The presence-gated routes — owner-away and disconnect-user — against REAL
 * Firestore and REAL RTDB presence.
 *
 * The last two express groups of the SHY-0113 umbrella (SHY-0492).
 *
 * ─── The gate was asserted against a hand-written boolean ───────────────────
 *
 * Both routes decide who may act on somebody else, and both turn on one
 * question — is that person still present? The route asks RTDB:
 *
 *     const snap = await rtdb.ref(`rooms/${roomId}/presence/${userId}`).get();
 *     return snap.exists();
 *
 * The old tests answered it with a stub returning `{ exists: () => true }`. So
 * every presence decision was proven against a boolean the test itself wrote,
 * on routes whose entire purpose is to act on somebody's ABSENCE. Presence is a
 * real node in a real database and the local stack runs RTDB on 9000; nothing
 * required it to be faked.
 *
 * ─── One assertion is stronger for being behavioural ────────────────────────
 *
 * "the owner path skips presence verification" used to be `expect(mockRtdbGet)
 * .not.toHaveBeenCalled()`. Against real RTDB there is no read to observe — so
 * it is proven by OUTCOME instead: the owner succeeds even while their own
 * presence node EXISTS. If the owner path ever started consulting presence, that
 * test fails.
 *
 * ─── What is not here ───────────────────────────────────────────────────────
 *
 * The three induced failures — the presence read throwing, the user-doc clear
 * failing, the transaction throwing — are in `room-presence-errors.unit.test.js`.
 * The fail-safe one matters most: `isUserPresent` returns TRUE on error, so a
 * database blip can never be mistaken for somebody having left.
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');

const { db, rtdb } = require('../../src/utils/firebase');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const router = require('../../src/routes/room-mutations');

// Per-file room and user ids: no seeded persona, no other suite (SHY-0464).
const ROOM = 'shy0492-presence';
const OWNER = 65000001;
const HOST = 65000002;
const ATTENDEE = 65000003;
const ACTORS = [OWNER, HOST, ATTENDEE];

const roomRef = () => db.doc(`rooms/${ROOM}`);
const eventRef = () => rtdb.ref(`rooms/${ROOM}/events/lastEvent`);
const presenceRef = (uid) => rtdb.ref(`rooms/${ROOM}/presence/${uid}`);

const room = async () => {
  const s = await roomRef().get();
  return s.exists ? s.data() : null;
};
const currentRoomIdOf = async (uid) => {
  const s = await db.doc(`users/${uid}`).get();
  return s.exists ? (s.data().currentRoomId ?? null) : null;
};
const publishedEvent = async () => (await eventRef().once('value')).val();

/** Presence is a real node: being there means the node exists. */
const markPresent = (uid) => presenceRef(uid).set(true);
const markAbsent = (uid) => presenceRef(uid).remove();

function createApp(uniqueId = HOST, cohort = 'adult') {
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
  await Promise.all(
    ACTORS.map((id) => db.doc(`users/${id}`).set({ uniqueId: id, currentRoomId: ROOM })),
  );
  // Clear only THIS room's RTDB subtree — never the whole node (SHY-0479).
  await rtdb
    .ref(`rooms/${ROOM}`)
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
// owner-away
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/rooms/:roomId/owner-away', () => {
  const away = (uid = OWNER, cohort = 'adult') =>
    request(createApp(uid, cohort)).post(`/api/rooms/${ROOM}/owner-away`).send({});

  test('404 when the room does not exist (pre-read)', async () => {
    expect((await away()).status).toBe(404);
  });

  test('404 (hidden) on cohort mismatch (pre-read)', async () => {
    const before = await seed({ cohort: 'adult' });
    expect((await away(OWNER, 'minor')).status).toBe(404);
    expect(await room()).toEqual(before);
  });

  test('200 the owner marks themselves away — even while their presence node EXISTS', async () => {
    // The owner path does not consult presence. Proven by OUTCOME rather than
    // by a spy: the owner is demonstrably PRESENT and still succeeds, so a
    // future refactor that started checking presence here would fail this.
    await seed({ state: 'ACTIVE' });
    await markPresent(OWNER);

    expect((await away()).status).toBe(200);

    const after = await room();
    expect(after.state).toBe('OWNER_AWAY');
    expect(typeof after.ownerLeftAt).toBe('number');
  });

  test('200 idempotent when already OWNER_AWAY — no write, and NOTHING BROADCAST', async () => {
    await seed({ state: 'OWNER_AWAY', ownerLeftAt: 123 });
    const before = await room();
    await eventRef()
      .remove()
      .catch(() => {});

    expect((await away()).status).toBe(200);

    expect(await room()).toEqual(before);
    expect(await publishedEvent()).toBeNull();
  });

  test('409 when the room is CLOSED', async () => {
    const before = await seed({ state: 'CLOSED' });
    expect((await away()).status).toBe(409);
    expect(await room()).toEqual(before);
  });

  test('403 a non-owner when the owner IS present', async () => {
    const before = await seed({ state: 'ACTIVE' });
    await markPresent(OWNER); // really there

    expect((await away(HOST)).status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('200 a non-owner participant when the owner is ABSENT', async () => {
    await seed({ state: 'ACTIVE' });
    await markAbsent(OWNER); // the node genuinely does not exist

    expect((await away(HOST)).status).toBe(200);

    const after = await room();
    expect(after.state).toBe('OWNER_AWAY');
    expect(typeof after.ownerLeftAt).toBe('number');
  });

  test('403 a non-owner on an ALREADY-OWNER_AWAY room — authorisation precedes idempotency', async () => {
    // The room is already in the state being asked for, so a naive handler
    // could answer 200 "nothing to do" and leak that the owner is away to
    // somebody with no standing to ask.
    const before = await seed({
      state: 'OWNER_AWAY',
      ownerLeftAt: 123,
      participantIds: [String(OWNER), String(ATTENDEE)], // caller is NOT one
    });
    await markAbsent(OWNER);

    expect((await away(HOST)).status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test("presence is read at the OWNER's node, not just any node", async () => {
    // Behavioural replacement for `expect(rtdb.ref).toHaveBeenCalledWith(
    // 'rooms/x/presence/1')`. Somebody else is loudly present while the owner
    // is absent: if the route consulted the wrong node it would refuse.
    await seed({ state: 'ACTIVE' });
    await markPresent(ATTENDEE);
    await markAbsent(OWNER);

    expect((await away(HOST)).status).toBe(200);
    expect((await room()).state).toBe('OWNER_AWAY');
  });

  test('403 a non-owner who is NOT a participant, even with the owner absent', async () => {
    const before = await seed({
      state: 'ACTIVE',
      participantIds: [String(OWNER), String(ATTENDEE)],
    });
    await markAbsent(OWNER);

    expect((await away(HOST)).status).toBe(403);
    expect(await room()).toEqual(before);
  });
});

// ═══════════════════════════════════════════════════════════════════
// disconnect-user
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/rooms/:roomId/disconnect-user', () => {
  const disconnect = (target, uid = HOST, cohort = 'adult') =>
    request(createApp(uid, cohort))
      .post(`/api/rooms/${ROOM}/disconnect-user`)
      .send(target === undefined ? {} : { userId: String(target) });

  test('400 when userId is missing', async () => {
    await seed();
    expect((await disconnect(undefined)).status).toBe(400);
  });

  test('404 when the room does not exist (pre-read)', async () => {
    expect((await disconnect(ATTENDEE)).status).toBe(404);
  });

  test('404 (hidden) on cohort mismatch (pre-read)', async () => {
    const before = await seed({ cohort: 'adult' });
    expect((await disconnect(ATTENDEE, HOST, 'minor')).status).toBe(404);
    expect(await room()).toEqual(before);
  });

  test('403 when the target is the owner — removal is not how an owner leaves', async () => {
    const before = await seed();
    await markAbsent(OWNER); // absent, and STILL not removable this way

    expect((await disconnect(OWNER)).status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('403 when the target is still PRESENT', async () => {
    const before = await seed({
      seats: { 3: { userId: String(ATTENDEE), state: 'OCCUPIED', isMuted: false } },
    });
    await markPresent(ATTENDEE);

    expect((await disconnect(ATTENDEE)).status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('403 when the caller is not a participant', async () => {
    const before = await seed({ participantIds: [String(OWNER), String(ATTENDEE)] });
    await markAbsent(ATTENDEE);

    expect((await disconnect(ATTENDEE)).status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('403 when the target is already removed (a concurrent leave won the race)', async () => {
    // A /leave or another presence monitor may have removed them between the
    // client deciding to evict and this request landing. Without the
    // membership gate this would write a clean room and fire a broadcast for
    // nothing.
    const before = await seed({ participantIds: [String(OWNER), String(HOST)] });
    await markAbsent(ATTENDEE);

    expect((await disconnect(ATTENDEE)).status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('200 removes an ABSENT non-owner — seat cleared and currentRoomId cleared', async () => {
    await seed({
      seats: { 3: { userId: String(ATTENDEE), state: 'OCCUPIED', isMuted: false } },
    });
    await markAbsent(ATTENDEE);

    expect((await disconnect(ATTENDEE)).status).toBe(200);

    const after = await room();
    expect(after.participantIds).not.toContain(String(ATTENDEE));
    expect(after.seats['3']).toEqual({ userId: null, state: 'EMPTY', isMuted: false });

    // The clear must land on the EVICTED user's document. The old suite pinned
    // this with `expect(db.doc).toHaveBeenCalledWith('users/99')`, because its
    // stub returned the same object for every path and could not otherwise
    // tell them apart. Real documents make the question direct.
    expect(await currentRoomIdOf(ATTENDEE)).toBeNull();
    expect(await currentRoomIdOf(HOST)).toBe(ROOM);
  });

  test('409 when the room is CLOSED — short-circuited before anything happens', async () => {
    const before = await seed({
      state: 'CLOSED',
      seats: { 3: { userId: String(ATTENDEE), state: 'OCCUPIED', isMuted: false } },
    });
    await markAbsent(ATTENDEE);

    expect((await disconnect(ATTENDEE)).status).toBe(409);

    // The three "not called" assertions became three statements about state:
    // the room is untouched, and the post-transaction user-doc clear never
    // fired — which is what a refactor moving that clear ahead of the
    // transaction would break.
    expect(await room()).toEqual(before);
    expect(await currentRoomIdOf(ATTENDEE)).toBe(ROOM);
  });
});

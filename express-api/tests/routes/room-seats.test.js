/**
 * The seat lifecycle — claim, accept-invite, leave, remove, move — against REAL
 * Firestore transactions.
 *
 * Extracted from `room-mutations.test.js` (SHY-0481), the SHY-0113 umbrella's
 * largest remaining express file: 181 doubles, 170 tests, 19 route groups. A
 * file cannot be half-migrated — its `jest.mock` is global — so a group moves
 * out and becomes real, and the remainder stays honest about still having
 * doubles.
 *
 * ─── What the fake transaction could not express ────────────────────────────
 *
 * The old harness replaced `runTransaction` with a stub that simply invoked its
 * callback, handing it a canned snapshot and a recorder in place of a real
 * transaction handle. (Written out rather than quoted: the no-new-stubs ratchet
 * matches its patterns as TEXT, so quoting the thing this file removed would
 * count as still having it.)
 *
 * It called the callback once, with a fixed snapshot, and recorded an update
 * that was never applied. Nothing was atomic and nothing re-read. So routes
 * whose entire purpose is to resolve a **race for a seat** were tested by a
 * harness with no concurrency in it: `409 SEAT_TAKEN` was asserted against a
 * stub that had been told the seat was taken.
 *
 * Here the transaction is real, every assertion reads the room document back,
 * and there is a test two callers actually race — which the old harness had no
 * way to write.
 *
 * ─── What is NOT here ───────────────────────────────────────────────────────
 *
 * The three "500 when the transaction throws" cases live in
 * `room-seats-errors.unit.test.js`. Real Firestore does not throw on demand, and
 * "the route survives a failing datastore" is a question about this route's
 * error handling.
 *
 * These routes read the ROOM and nothing else — participant, host and seat ids
 * are strings inside the room document, and the caller's cohort comes from the
 * token — so no user documents are needed.
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');

const { db, rtdb } = require('../../src/utils/firebase');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const router = require('../../src/routes/room-mutations');

// Per-file room id: no other suite touches it (SHY-0464).
const ROOM = 'shy0481-seats';
const roomRef = () => db.doc(`rooms/${ROOM}`);
const room = async () => {
  const s = await roomRef().get();
  return s.exists ? s.data() : null;
};
const seats = async () => (await room()).seats;

function createApp(uniqueId = 10, cohort = 'adult') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'fb-uid', uniqueId, token: { cohort } };
    next();
  });
  app.use('/api', router);
  return app;
}

/** Default room: owner=1 (seat 0), host=10, attendee=99; seats 3 & 4 empty. */
function mkRoom(overrides = {}) {
  return {
    ownerId: '1',
    cohort: 'adult',
    state: 'ACTIVE',
    participantIds: ['1', '10', '99'],
    hostIds: ['10'],
    requireApproval: false,
    pendingInvites: {},
    seats: {
      0: { userId: '1', state: 'OCCUPIED', isMuted: false },
      3: { userId: null, state: 'EMPTY', isMuted: false },
      4: { userId: null, state: 'EMPTY', isMuted: false },
    },
    ...overrides,
  };
}

/** Seed the room for real and hand back what was written, for comparison. */
async function seed(overrides = {}) {
  const data = mkRoom(overrides);
  await roomRef().set(data);
  return data;
}

beforeAll(assertEmulatorReachable);

beforeEach(() => roomRef().delete());

afterAll(async () => {
  await roomRef().delete();
  await rtdb
    .ref(`rooms/${ROOM}`)
    .remove()
    .catch(() => {});
  if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = PRIOR_NODE_ENV;
});

// ═══════════════════════════════════════════════════════════════════
// claim
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/rooms/:roomId/seats/:seatIndex/claim', () => {
  test.each([
    ['out of range (>= MAX_SEATS)', '8'],
    ['negative', '-1'],
    ['non-numeric', 'abc'],
  ])('400 on a seat index that is %s — the room is untouched', async (_label, index) => {
    const before = await seed();
    const res = await request(createApp()).post(`/api/rooms/${ROOM}/seats/${index}/claim`).send({});
    expect(res.status).toBe(400);
    expect(await room()).toEqual(before);
  });

  test('404 when the room does not exist', async () => {
    const res = await request(createApp()).post(`/api/rooms/${ROOM}/seats/3/claim`).send({});
    expect(res.status).toBe(404);
  });

  test('404 (hidden) when the caller cohort differs from the room cohort', async () => {
    const before = await seed({ cohort: 'adult' });
    const res = await request(createApp(10, 'minor'))
      .post(`/api/rooms/${ROOM}/seats/3/claim`)
      .send({});
    expect(res.status).toBe(404);
    expect(await room()).toEqual(before);
  });

  test('409 when the room is CLOSED', async () => {
    await seed({ state: 'CLOSED' });
    const res = await request(createApp()).post(`/api/rooms/${ROOM}/seats/3/claim`).send({});
    expect(res.status).toBe(409);
  });

  test('409 SEAT_TAKEN when the seat is already occupied (race guard)', async () => {
    const before = await seed({
      seats: { 3: { userId: '77', state: 'OCCUPIED', isMuted: false } },
    });
    const res = await request(createApp(10)).post(`/api/rooms/${ROOM}/seats/3/claim`).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SEAT_TAKEN');
    // The occupant is untouched — asserted on the document, not on a spy.
    expect(await room()).toEqual(before);
  });

  test('403 when an attendee tries to take a seat directly (must use the request flow)', async () => {
    const before = await seed();
    const res = await request(createApp(99)).post(`/api/rooms/${ROOM}/seats/3/claim`).send({});
    expect(res.status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('403 when a non-owner tries to take seat 0 (owner-only)', async () => {
    await seed({ seats: { 0: { userId: null, state: 'EMPTY', isMuted: false } } });
    const res = await request(createApp(10)).post(`/api/rooms/${ROOM}/seats/0/claim`).send({});
    expect(res.status).toBe(403);
    expect((await seats())['0'].userId).toBeNull();
  });

  test('409 ALREADY_SEATED when the caller already occupies another seat', async () => {
    const before = await seed({
      seats: {
        3: { userId: null, state: 'EMPTY', isMuted: false },
        4: { userId: '10', state: 'OCCUPIED', isMuted: false },
      },
    });
    const res = await request(createApp(10)).post(`/api/rooms/${ROOM}/seats/3/claim`).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_SEATED');
    expect(await room()).toEqual(before);
  });

  test('200 seats a host in an empty seat (transactional write + broadcast)', async () => {
    await seed();
    await rtdb
      .ref(`rooms/${ROOM}/events/lastEvent`)
      .remove()
      .catch(() => {});

    const res = await request(createApp(10)).post(`/api/rooms/${ROOM}/seats/3/claim`).send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    const after = await room();
    expect(after.seats['3']).toEqual({ userId: '10', state: 'OCCUPIED', isMuted: false });
    // arrayUnion resolved for real, and does not duplicate an existing member.
    expect(after.participantIds.filter((id) => id === '10')).toHaveLength(1);
    expect(after.allTimeSeatUserIds).toContain('10');

    const evt = await rtdb.ref(`rooms/${ROOM}/events/lastEvent`).once('value');
    expect(evt.val()).toBeTruthy();
  });

  test('200 lets the owner take seat 0', async () => {
    await seed({ seats: { 0: { userId: null, state: 'EMPTY', isMuted: false } } });
    const res = await request(createApp(1)).post(`/api/rooms/${ROOM}/seats/0/claim`).send({});
    expect(res.status).toBe(200);
    expect((await seats())['0']).toMatchObject({ userId: '1', state: 'OCCUPIED' });
  });

  test('two callers racing for one seat — exactly one wins', async () => {
    // The case the fake transaction could not express. Both requests are in
    // flight against the SAME real seat; Firestore's transaction is what makes
    // one of them lose.
    await seed({
      hostIds: ['10', '20'],
      participantIds: ['1', '10', '20'],
      seats: { 3: { userId: null, state: 'EMPTY', isMuted: false } },
    });

    const [a, b] = await Promise.all([
      request(createApp(10)).post(`/api/rooms/${ROOM}/seats/3/claim`).send({}),
      request(createApp(20)).post(`/api/rooms/${ROOM}/seats/3/claim`).send({}),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    // And the seat holds exactly one of them — whichever won.
    const seat = (await seats())['3'];
    expect(seat.state).toBe('OCCUPIED');
    expect(['10', '20']).toContain(seat.userId);
  });
});

// ═══════════════════════════════════════════════════════════════════
// accept-invite
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/rooms/:roomId/seats/:seatIndex/accept-invite', () => {
  test('404 when the room does not exist', async () => {
    const res = await request(createApp(20))
      .post(`/api/rooms/${ROOM}/seats/3/accept-invite`)
      .send({});
    expect(res.status).toBe(404);
  });

  test('404 (hidden) on cohort mismatch', async () => {
    // A cross-cohort caller never observes whether the invite exists.
    const before = await seed({ cohort: 'adult', pendingInvites: { 20: '1' } });
    const res = await request(createApp(20, 'minor'))
      .post(`/api/rooms/${ROOM}/seats/3/accept-invite`)
      .send({});
    expect(res.status).toBe(404);
    expect(await room()).toEqual(before);
  });

  test('409 when the room is CLOSED — the gate fires before invite/seat checks', async () => {
    // Ordered first on purpose, so an attacker post-CLOSE cannot probe whether
    // their invite or target seat still exists.
    const before = await seed({
      state: 'CLOSED',
      pendingInvites: { 20: '1' },
      seats: { 3: { userId: null, state: 'EMPTY', isMuted: false } },
    });
    const res = await request(createApp(20))
      .post(`/api/rooms/${ROOM}/seats/3/accept-invite`)
      .send({});
    expect(res.status).toBe(409);
    expect(await room()).toEqual(before);
  });

  test('403 when the caller has no pending invite', async () => {
    const before = await seed({ pendingInvites: {} });
    const res = await request(createApp(20))
      .post(`/api/rooms/${ROOM}/seats/3/accept-invite`)
      .send({});
    expect(res.status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('403 when accepting into seat 0 (owner-only)', async () => {
    await seed({
      pendingInvites: { 20: '1' },
      seats: { 0: { userId: null, state: 'EMPTY', isMuted: false } },
    });
    const res = await request(createApp(20))
      .post(`/api/rooms/${ROOM}/seats/0/accept-invite`)
      .send({});
    expect(res.status).toBe(403);
    expect((await seats())['0'].userId).toBeNull();
  });

  test('409 SEAT_TAKEN when the invited seat is occupied', async () => {
    await seed({
      pendingInvites: { 20: '1' },
      seats: { 3: { userId: '77', state: 'OCCUPIED', isMuted: false } },
    });
    const res = await request(createApp(20))
      .post(`/api/rooms/${ROOM}/seats/3/accept-invite`)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SEAT_TAKEN');
    expect((await seats())['3'].userId).toBe('77');
  });

  test('409 ALREADY_SEATED when the caller already occupies another seat', async () => {
    // Mirrors /claim's per-user uniqueness guard: nobody occupies two seats.
    const before = await seed({
      pendingInvites: { 20: '1' },
      seats: {
        3: { userId: null, state: 'EMPTY', isMuted: false },
        5: { userId: '20', state: 'OCCUPIED', isMuted: false },
      },
    });
    const res = await request(createApp(20))
      .post(`/api/rooms/${ROOM}/seats/3/accept-invite`)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_SEATED');
    expect(await room()).toEqual(before);
  });

  test('200 seats the invited user, consumes the invite, adds participant', async () => {
    await seed({
      pendingInvites: { 20: '1' },
      participantIds: ['1', '10'],
      seats: { 3: { userId: null, state: 'EMPTY', isMuted: false } },
    });

    const res = await request(createApp(20))
      .post(`/api/rooms/${ROOM}/seats/3/accept-invite`)
      .send({});

    expect(res.status).toBe(200);
    const after = await room();
    expect(after.seats['3']).toMatchObject({ userId: '20', state: 'OCCUPIED' });
    // The invite is really gone — a FieldValue.delete() that was applied.
    expect(after.pendingInvites).toEqual({});
    expect(after.participantIds).toContain('20');
  });
});

// ═══════════════════════════════════════════════════════════════════
// leave
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/rooms/:roomId/seats/:seatIndex/leave', () => {
  test("200 clears the caller's own seat", async () => {
    await seed({ seats: { 3: { userId: '10', state: 'OCCUPIED', isMuted: false } } });
    const res = await request(createApp(10)).post(`/api/rooms/${ROOM}/seats/3/leave`).send({});
    expect(res.status).toBe(200);
    expect((await seats())['3']).toMatchObject({ userId: null, state: 'EMPTY' });
  });

  test('403 when the caller does not occupy that seat', async () => {
    const before = await seed({
      seats: { 3: { userId: '77', state: 'OCCUPIED', isMuted: false } },
    });
    const res = await request(createApp(10)).post(`/api/rooms/${ROOM}/seats/3/leave`).send({});
    expect(res.status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('200 CLOSED-room cleanup: the caller can still vacate their own seat', async () => {
    // CLEANUP-ON-CLOSED, and deliberate: self-targeted vacate endpoints stay
    // available on CLOSED rooms so a client recovering from a crash can drop a
    // stale occupancy. State-EXTENDING writes (/join, /name, /claim) 409
    // instead. Rejecting CLOSED here would break crash recovery where the room
    // closed between the client's last read and its retry.
    await seed({
      state: 'CLOSED',
      seats: { 3: { userId: '10', state: 'OCCUPIED', isMuted: false } },
    });
    const res = await request(createApp(10)).post(`/api/rooms/${ROOM}/seats/3/leave`).send({});
    expect(res.status).toBe(200);
    expect((await seats())['3']).toMatchObject({ userId: null, state: 'EMPTY' });
  });
});

// ═══════════════════════════════════════════════════════════════════
// remove
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/rooms/:roomId/seats/:seatIndex/remove', () => {
  test('403 when an attendee tries to remove an occupant', async () => {
    const before = await seed({
      seats: { 4: { userId: '88', state: 'OCCUPIED', isMuted: false } },
    });
    const res = await request(createApp(99)).post(`/api/rooms/${ROOM}/seats/4/remove`).send({});
    expect(res.status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('403 when removing the occupant of seat 0 (the owner seat is protected)', async () => {
    const before = await seed();
    const res = await request(createApp(1)).post(`/api/rooms/${ROOM}/seats/0/remove`).send({});
    expect(res.status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('200 a host removes an attendee from a seat (no ban)', async () => {
    await seed({ seats: { 4: { userId: '88', state: 'OCCUPIED', isMuted: false } } });
    const res = await request(createApp(10)).post(`/api/rooms/${ROOM}/seats/4/remove`).send({});
    expect(res.status).toBe(200);
    expect((await seats())['4']).toMatchObject({ userId: null, state: 'EMPTY' });
  });
});

// ═══════════════════════════════════════════════════════════════════
// move
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/rooms/:roomId/seats/:seatIndex/move', () => {
  test.each([
    ['the source seat index is out of range', '8', { toIndex: 3 }],
    ['toIndex is missing', '3', {}],
    ['toIndex is out of range', '3', { toIndex: 99 }],
    ['source and target are the same seat', '3', { toIndex: 3 }],
  ])('400 when %s', async (_label, from, body) => {
    const before = await seed();
    const res = await request(createApp(1))
      .post(`/api/rooms/${ROOM}/seats/${from}/move`)
      .send(body);
    expect(res.status).toBe(400);
    expect(await room()).toEqual(before);
  });

  test('404 when the room does not exist', async () => {
    const res = await request(createApp(1))
      .post(`/api/rooms/${ROOM}/seats/3/move`)
      .send({ toIndex: 4 });
    expect(res.status).toBe(404);
  });

  test('404 (hidden) on cohort mismatch', async () => {
    await seed({ cohort: 'adult' });
    const res = await request(createApp(1, 'minor'))
      .post(`/api/rooms/${ROOM}/seats/3/move`)
      .send({ toIndex: 4 });
    expect(res.status).toBe(404);
  });

  test('409 when the room is CLOSED', async () => {
    await seed({ state: 'CLOSED' });
    const res = await request(createApp(1))
      .post(`/api/rooms/${ROOM}/seats/3/move`)
      .send({ toIndex: 4 });
    expect(res.status).toBe(409);
  });

  test('403 when an attendee tries to move a seat', async () => {
    const before = await seed({
      seats: { 3: { userId: '99', state: 'OCCUPIED', isMuted: false } },
    });
    const res = await request(createApp(99))
      .post(`/api/rooms/${ROOM}/seats/3/move`)
      .send({ toIndex: 4 });
    expect(res.status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('403 when the source seat is the owner seat (0)', async () => {
    await seed();
    const res = await request(createApp(1))
      .post(`/api/rooms/${ROOM}/seats/0/move`)
      .send({ toIndex: 3 });
    expect(res.status).toBe(403);
  });

  test('403 when the target seat is the owner seat (0)', async () => {
    await seed({ seats: { 3: { userId: '10', state: 'OCCUPIED', isMuted: false } } });
    const res = await request(createApp(1))
      .post(`/api/rooms/${ROOM}/seats/3/move`)
      .send({ toIndex: 0 });
    expect(res.status).toBe(403);
  });

  test('403 when the source seat is empty', async () => {
    await seed(); // seat 4 is empty
    const res = await request(createApp(1))
      .post(`/api/rooms/${ROOM}/seats/4/move`)
      .send({ toIndex: 3 });
    expect(res.status).toBe(403);
  });

  test('403 when a host tries to move another host', async () => {
    const before = await seed({
      hostIds: ['10', '20'],
      seats: {
        3: { userId: '20', state: 'OCCUPIED', isMuted: false }, // another host
        4: { userId: null, state: 'EMPTY', isMuted: false },
      },
    });
    const res = await request(createApp(10))
      .post(`/api/rooms/${ROOM}/seats/3/move`)
      .send({ toIndex: 4 });
    expect(res.status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('200 the owner moves an occupant into an empty seat (mute state travels)', async () => {
    await seed({
      seats: {
        3: { userId: '99', state: 'OCCUPIED', isMuted: true },
        4: { userId: null, state: 'EMPTY', isMuted: false },
      },
    });

    const res = await request(createApp(1))
      .post(`/api/rooms/${ROOM}/seats/3/move`)
      .send({ toIndex: 4 });

    expect(res.status).toBe(200);
    // BOTH ends in one document state — the old seat vacated and the new one
    // filled, which a per-call spy could only check separately.
    expect(await seats()).toMatchObject({
      3: { userId: null, state: 'EMPTY', isMuted: false },
      4: { userId: '99', state: 'OCCUPIED', isMuted: true },
    });
  });

  test('200 swaps two occupied non-owner seats', async () => {
    await seed({
      participantIds: ['1', '10', '99', '77'],
      seats: {
        3: { userId: '99', state: 'OCCUPIED', isMuted: false },
        4: { userId: '77', state: 'OCCUPIED', isMuted: true },
      },
    });

    const res = await request(createApp(10))
      .post(`/api/rooms/${ROOM}/seats/3/move`)
      .send({ toIndex: 4 });

    expect(res.status).toBe(200);
    expect(await seats()).toMatchObject({
      3: { userId: '77', state: 'OCCUPIED', isMuted: true },
      4: { userId: '99', state: 'OCCUPIED', isMuted: false },
    });
  });
});

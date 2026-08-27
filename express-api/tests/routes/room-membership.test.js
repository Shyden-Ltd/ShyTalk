/**
 * Room membership — join, leave, decline-invite, first-join — against REAL
 * Firestore transactions.
 *
 * Extracted from `room-mutations.test.js` (SHY-0483), the third slice after
 * SHY-0481 (seats) and SHY-0482 (moderation).
 *
 * ─── What the fake transaction could not say ────────────────────────────────
 *
 * The old harness replaced `runTransaction` with a stub that invoked its
 * callback once, handing it a canned snapshot and a recorder. Every membership
 * change was therefore asserted as a MARKER OBJECT — `{ __arrayUnion: ['50'] }`,
 * `{ __arrayRemove: ['99'] }` — standing in for a `FieldValue` that nothing ever
 * resolved.
 *
 * ─── The no-op branches are the interesting part ────────────────────────────
 *
 * Four of these routes deliberately do nothing in certain states, and the reason
 * is operational: a client retrying `/leave` after a disconnect must not wake
 * every connected client with a spurious RTDB nudge. That is a claim about a
 * PUBLISHED EVENT, and the old suite tested it by checking a spy went uncalled.
 *
 * Here each no-op is asserted twice over — the document is unchanged AND no
 * event was published — and paired with a positive case on the same route, so
 * "nothing happened" is only accepted where something happens otherwise.
 *
 * `/first-join` is set-once: a marker object cannot express "the value that was
 * already there is still there". A real document can.
 *
 * These routes read the ROOM and nothing else, so no user documents are needed.
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');

const { db, rtdb } = require('../../src/utils/firebase');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const router = require('../../src/routes/room-mutations');

// Per-file room id: no other suite touches it (SHY-0464).
const ROOM = 'shy0483-membership';
const roomRef = () => db.doc(`rooms/${ROOM}`);
const eventRef = () => rtdb.ref(`rooms/${ROOM}/events/lastEvent`);

const room = async () => {
  const s = await roomRef().get();
  return s.exists ? s.data() : null;
};
const publishedEvent = async () => (await eventRef().once('value')).val();

function createApp(uniqueId = 50, cohort = 'adult') {
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

async function seed(overrides = {}) {
  const data = mkRoom(overrides);
  await roomRef().set(data);
  // Clear the event AFTER seeding so "was anything published" means "by this
  // request", not "by a previous test".
  await eventRef()
    .remove()
    .catch(() => {});
  return data;
}

beforeAll(assertEmulatorReachable);

beforeEach(async () => {
  await roomRef().delete();
  await eventRef()
    .remove()
    .catch(() => {});
});

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
// join
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/rooms/:roomId/join', () => {
  const join = (uid = 50, cohort = 'adult') =>
    request(createApp(uid, cohort)).post(`/api/rooms/${ROOM}/join`).send({});

  test('404 when the room does not exist', async () => {
    expect((await join()).status).toBe(404);
  });

  test('404 (hidden) on cohort mismatch', async () => {
    const before = await seed({ cohort: 'adult' });
    expect((await join(50, 'minor')).status).toBe(404);
    expect(await room()).toEqual(before);
  });

  test('409 when the room is CLOSED', async () => {
    const before = await seed({ state: 'CLOSED' });
    expect((await join()).status).toBe(409);
    expect(await room()).toEqual(before);
  });

  test('403 BANNED when the caller is on the ban list', async () => {
    const before = await seed({ bannedUserIds: ['50'] });
    const res = await join();
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('BANNED');
    expect(await room()).toEqual(before);
    // And they are still not a participant, which is the point of the ban.
    expect((await room()).participantIds).not.toContain('50');
  });

  test('200 joins an ACTIVE room — adds to participants and broadcasts', async () => {
    await seed();
    expect((await join()).status).toBe(200);

    const after = await room();
    expect(after.participantIds).toContain('50');
    // arrayUnion resolved for real, and the existing members survive intact.
    expect(after.participantIds).toEqual(expect.arrayContaining(['1', '10', '99', '50']));
    expect(await publishedEvent()).toBeTruthy();
  });

  test('200 joining twice adds the caller once', async () => {
    // The old marker object could not show this: arrayUnion's whole purpose is
    // that a repeat is not a duplicate.
    await seed();
    await join();
    await join();
    expect((await room()).participantIds.filter((id) => id === '50')).toHaveLength(1);
  });

  test('200 joins an OWNER_AWAY room (still joinable)', async () => {
    await seed({ state: 'OWNER_AWAY', ownerLeftAt: Date.now() });
    expect((await join()).status).toBe(200);
    expect((await room()).participantIds).toContain('50');
  });
});

// ═══════════════════════════════════════════════════════════════════
// leave
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/rooms/:roomId/leave', () => {
  const leave = (uid, cohort = 'adult') =>
    request(createApp(uid, cohort)).post(`/api/rooms/${ROOM}/leave`).send({});

  test('404 when the room does not exist', async () => {
    expect((await leave(99)).status).toBe(404);
  });

  test('404 (hidden) on cohort mismatch', async () => {
    const before = await seed({ cohort: 'adult' });
    expect((await leave(99, 'minor')).status).toBe(404);
    expect(await room()).toEqual(before);
  });

  test('200 removes the caller from participants and clears their seat', async () => {
    await seed({ seats: { 3: { userId: '10', state: 'OCCUPIED', isMuted: false } } });

    expect((await leave(10)).status).toBe(200);

    const after = await room();
    expect(after.participantIds).not.toContain('10');
    expect(after.seats['3']).toEqual({ userId: null, state: 'EMPTY', isMuted: false });
    expect(await publishedEvent()).toBeTruthy();
  });

  test('200 removes an unseated caller from participants, disturbing no seat', async () => {
    const before = await seed(); // 99 is a participant but not seated
    expect((await leave(99)).status).toBe(200);

    const after = await room();
    expect(after.participantIds).not.toContain('99');
    expect(after.seats).toEqual(before.seats);
  });

  test('200 idempotent no-op: nothing written and NOTHING BROADCAST', async () => {
    // Common on a client retrying /leave after a disconnect. The arrayRemove
    // would be a no-op anyway; the branch exists to suppress the RTDB nudge
    // that "would wake every connected client" — a claim about a published
    // event, so it is asserted as one.
    const before = await seed({ participantIds: ['1', '10'] }); // 99 absent

    expect((await leave(99)).status).toBe(200);

    expect(await room()).toEqual(before);
    expect(await publishedEvent()).toBeNull();
  });

  test('200 CLOSED-room cleanup: the caller can still leave after close', async () => {
    // CLEANUP-ON-CLOSED: leaving is self-targeted cleanup. The universal rule
    // post-CLOSE is "drop your own state, never extend the room's" — the same
    // allowance that lets an occupant vacate a seat or decline an invite.
    await seed({
      state: 'CLOSED',
      seats: { 3: { userId: '10', state: 'OCCUPIED', isMuted: false } },
    });

    expect((await leave(10)).status).toBe(200);

    const after = await room();
    expect(after.participantIds).not.toContain('10');
    expect(after.seats['3']).toMatchObject({ userId: null, state: 'EMPTY' });
  });
});

// ═══════════════════════════════════════════════════════════════════
// decline-invite
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/rooms/:roomId/decline-invite', () => {
  const decline = (uid = 50, cohort = 'adult') =>
    request(createApp(uid, cohort)).post(`/api/rooms/${ROOM}/decline-invite`).send({});

  test('404 when the room does not exist', async () => {
    expect((await decline()).status).toBe(404);
  });

  test('404 (hidden) on cohort mismatch', async () => {
    const before = await seed({ cohort: 'adult' });
    expect((await decline(50, 'minor')).status).toBe(404);
    expect(await room()).toEqual(before);
  });

  test("200 deletes the caller's own pending invite", async () => {
    await seed({ pendingInvites: { 50: '10', 77: '10' } });

    expect((await decline()).status).toBe(200);

    // Theirs is gone and somebody else's is untouched — which a single
    // recorded `{ __delete: true }` could not distinguish.
    expect((await room()).pendingInvites).toEqual({ 77: '10' });
    expect(await publishedEvent()).toBeTruthy();
  });

  test('200 idempotent no-op when the caller has no pending invite — no write', async () => {
    const before = await seed({ pendingInvites: { 77: '10' } });
    expect((await decline()).status).toBe(200);
    expect(await room()).toEqual(before);
  });

  test('200 CLOSED-room cleanup: the caller can still decline after close', async () => {
    // /close does NOT clear pendingInvites server-side, so somebody invited
    // before the room closed can still cleanly decline afterwards.
    await seed({ state: 'CLOSED', pendingInvites: { 50: '10' } });
    expect((await decline()).status).toBe(200);
    expect((await room()).pendingInvites).toEqual({});
  });
});

// ═══════════════════════════════════════════════════════════════════
// first-join
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/rooms/:roomId/first-join', () => {
  const firstJoin = (uid = 99, cohort = 'adult') =>
    request(createApp(uid, cohort)).post(`/api/rooms/${ROOM}/first-join`).send({});

  test('404 when the room does not exist', async () => {
    expect((await firstJoin()).status).toBe(404);
  });

  test('404 (hidden) on cohort mismatch', async () => {
    const before = await seed({ cohort: 'adult' });
    expect((await firstJoin(99, 'minor')).status).toBe(404);
    expect(await room()).toEqual(before);
  });

  test('409 when the room is CLOSED — nothing written to firstJoinTimestamps', async () => {
    // CLOSED rooms accept zero state-extending writes. Before this gate
    // existed, a post-CLOSE call persisted a participation timestamp on a dead
    // room.
    const before = await seed({ state: 'CLOSED' });
    expect((await firstJoin()).status).toBe(409);
    expect(await room()).toEqual(before);
  });

  test('200 records a numeric first-join timestamp when absent', async () => {
    await seed();
    expect((await firstJoin()).status).toBe(200);
    expect(typeof (await room()).firstJoinTimestamps['99']).toBe('number');
  });

  test('200 set-once: a second call leaves the ORIGINAL value in place', async () => {
    // The point of set-once, and something a marker object cannot express:
    // not merely "no write happened" but "the value already there survived".
    await seed({ firstJoinTimestamps: { 99: 12345 } });

    expect((await firstJoin()).status).toBe(200);

    expect((await room()).firstJoinTimestamps['99']).toBe(12345);
  });
});

/**
 * Room moderation — kick, mute, and host promotion — against REAL Firestore
 * transactions.
 *
 * Extracted from `room-mutations.test.js` (SHY-0482), the second slice after
 * SHY-0481 took the seat lifecycle.
 *
 * ─── What the fake transaction could not say ────────────────────────────────
 *
 * The old harness replaced `runTransaction` with a stub that invoked its
 * callback once, handing it a canned snapshot and a recorder in place of a
 * transaction handle. The recorded update was never applied, so a ban was
 * asserted as a MARKER OBJECT standing in for a `FieldValue` that nothing ever
 * resolved. Whether the person ends up in `bannedUserIds` was never asked.
 *
 * That matters most on exactly these routes: they decide whether somebody can
 * be silenced or removed.
 *
 * ─── Gate ordering is the subject of several tests ──────────────────────────
 *
 * The handlers order their checks deliberately, so that a caller cannot learn
 * about a room by comparing error codes:
 *
 *   * kick and host-add put the CLOSED gate AFTER the role check, so an
 *     unprivileged caller sees 403 whatever the room's state.
 *   * mute puts it BEFORE the seat-empty probe, so nobody can ask "is seat N
 *     still occupied in that dead room?".
 *
 * Each of those tests uses an input that would otherwise SUCCEED, so moving the
 * gate fails the assertion rather than quietly passing.
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
const ROOM = 'shy0482-moderation';
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
// kick
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/rooms/:roomId/kick', () => {
  test('400 when userId is missing', async () => {
    await seed();
    const res = await request(createApp(1)).post(`/api/rooms/${ROOM}/kick`).send({});
    expect(res.status).toBe(400);
  });

  test('403 when an attendee tries to kick', async () => {
    const before = await seed();
    const res = await request(createApp(99)).post(`/api/rooms/${ROOM}/kick`).send({ userId: '88' });
    expect(res.status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('403 when a host tries to kick the owner', async () => {
    const before = await seed();
    const res = await request(createApp(10)).post(`/api/rooms/${ROOM}/kick`).send({ userId: '1' });
    expect(res.status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('403 when a host tries to kick another host', async () => {
    const before = await seed({ hostIds: ['10', '55'] });
    const res = await request(createApp(10)).post(`/api/rooms/${ROOM}/kick`).send({ userId: '55' });
    expect(res.status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('200 the owner bans and removes the target, and clears their seat', async () => {
    await seed({ seats: { 4: { userId: '99', state: 'OCCUPIED', isMuted: false } } });

    const res = await request(createApp(1))
      .post(`/api/rooms/${ROOM}/kick`)
      .send({ userId: '99', reason: 'spam', kickerName: 'Alice' });

    expect(res.status).toBe(200);
    const after = await room();
    // The ban is DATA now, not a marker object handed to a spy.
    expect(after.bannedUserIds).toContain('99');
    expect(after.participantIds).not.toContain('99');
    expect(after.kickInfo['99']).toEqual({ kickerName: 'Alice', reason: 'spam' });
    expect(after.seats['4']).toMatchObject({ userId: null, state: 'EMPTY' });
  });

  test('200 a host kicks an attendee who is not seated (no seat is disturbed)', async () => {
    await seed({ participantIds: ['1', '10', '99'] });
    const before = await seats();

    const res = await request(createApp(10)).post(`/api/rooms/${ROOM}/kick`).send({ userId: '99' });

    expect(res.status).toBe(200);
    const after = await room();
    expect(after.bannedUserIds).toContain('99');
    // Every seat is exactly as it was — the previous test could only check
    // that no key STARTING with "seats." had been recorded.
    expect(after.seats).toEqual(before);
  });

  test('409 when the room is CLOSED — the gate fires AFTER the role check', async () => {
    // Ordering, deliberately: an unprivileged caller must see 403 whatever the
    // room's state, so they cannot probe it by switching accounts. This uses
    // the OWNER to clear the role gate and isolate the CLOSED branch. A kick is
    // a state-EXTENDING write — the ban persists — so a dead room refuses it.
    const before = await seed({ state: 'CLOSED' });
    const res = await request(createApp(1)).post(`/api/rooms/${ROOM}/kick`).send({ userId: '99' });
    expect(res.status).toBe(409);
    expect(await room()).toEqual(before);
  });
});

// ═══════════════════════════════════════════════════════════════════
// mute
// ═══════════════════════════════════════════════════════════════════

describe('PATCH /api/rooms/:roomId/seats/:seatIndex/mute', () => {
  const mute = (uid, seat, isMuted) =>
    request(createApp(uid)).patch(`/api/rooms/${ROOM}/seats/${seat}/mute`).send({ isMuted });

  test('400 when isMuted is missing', async () => {
    await seed();
    const res = await request(createApp(1)).patch(`/api/rooms/${ROOM}/seats/4/mute`).send({});
    expect(res.status).toBe(400);
  });

  test('409 when the seat is empty', async () => {
    await seed();
    expect((await mute(1, 4, true)).status).toBe(409);
  });

  test('403 when an attendee tries to force-mute', async () => {
    const before = await seed({
      seats: { 4: { userId: '88', state: 'OCCUPIED', isMuted: false } },
    });
    expect((await mute(99, 4, true)).status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('403 when a host tries to mute another host', async () => {
    const before = await seed({
      hostIds: ['10', '55'],
      seats: { 4: { userId: '55', state: 'OCCUPIED', isMuted: false } },
    });
    expect((await mute(10, 4, true)).status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('200 the owner force-mutes an attendee', async () => {
    await seed({ seats: { 4: { userId: '88', state: 'OCCUPIED', isMuted: false } } });
    expect((await mute(1, 4, true)).status).toBe(200);
    expect((await seats())['4'].isMuted).toBe(true);
  });

  // ── Self-mute (SHY-0272) ──────────────────────────────────────────
  //
  // Reported from a real device: "the mic is stuck open and cannot be
  // muted/unmuted". Muting your OWN microphone was routed through the
  // FORCE-mute moderator gate, which answers a different question — "may this
  // moderator silence that person?" — and returns false for every caller acting
  // on their own seat:
  //
  //   owner  → refused outright when the occupant is the owner ("never the
  //            owner"), so an owner could never mute themselves
  //   host   → a host may only mute non-hosts, and they are a host
  //   member → neither OWNER nor HOST, so the final `return false`
  //
  // Nobody could mute themselves, in any room, in any role. The unmute branch
  // already asked the right question (are you the occupant?); the mute branch
  // never did. Nothing covered self-mute, which is why it shipped.

  test.each([
    ['an attendee', 99, 4, { 4: { userId: '99', state: 'OCCUPIED', isMuted: false } }],
    ['the owner', 1, 0, { 0: { userId: '1', state: 'OCCUPIED', isMuted: false } }],
    ['a host', 10, 4, { 4: { userId: '10', state: 'OCCUPIED', isMuted: false } }],
  ])('200 %s mutes their OWN seat', async (_label, uid, seat, seatMap) => {
    await seed({ seats: seatMap });
    expect((await mute(uid, seat, true)).status).toBe(200);
    expect((await seats())[String(seat)].isMuted).toBe(true);
  });

  test('a member still cannot force-mute SOMEONE ELSE', async () => {
    const before = await seed({
      seats: { 4: { userId: '88', state: 'OCCUPIED', isMuted: false } },
    });
    expect((await mute(99, 4, true)).status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('an attendee still cannot force-mute the OWNER', async () => {
    const before = await seed({ seats: { 0: { userId: '1', state: 'OCCUPIED', isMuted: false } } });
    expect((await mute(99, 0, true)).status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('self-mute is refused in a CLOSED room', async () => {
    await seed({
      state: 'CLOSED',
      seats: { 4: { userId: '88', state: 'OCCUPIED', isMuted: false } },
    });
    expect((await mute(88, 4, true)).status).toBe(409);
  });

  test('403 when a non-occupant tries to unmute someone', async () => {
    const before = await seed({ seats: { 4: { userId: '88', state: 'OCCUPIED', isMuted: true } } });
    expect((await mute(99, 4, false)).status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('200 the occupant unmutes themselves', async () => {
    await seed({ seats: { 4: { userId: '88', state: 'OCCUPIED', isMuted: true } } });
    expect((await mute(88, 4, false)).status).toBe(200);
    expect((await seats())['4'].isMuted).toBe(false);
  });

  test('409 when the room is CLOSED — the gate fires BEFORE the seat-empty probe', async () => {
    // Ordering again. The CLOSED gate sits at the top, before the seat-empty
    // 409, so nobody can ask "is seat N still occupied in that dead room?" by
    // comparing errors between an empty and an occupied seat. The seat here is
    // OCCUPIED — the write would otherwise succeed — so the assertion fails if
    // the gate ever moves below the probe.
    const before = await seed({
      state: 'CLOSED',
      seats: { 4: { userId: '99', state: 'OCCUPIED', isMuted: false } },
    });
    expect((await mute(1, 4, true)).status).toBe(409);
    expect(await room()).toEqual(before);
  });
});

// ═══════════════════════════════════════════════════════════════════
// hosts
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/rooms/:roomId/hosts (add) + DELETE .../hosts/:userId (remove)', () => {
  test('400 when userId is missing on add', async () => {
    await seed();
    const res = await request(createApp(1)).post(`/api/rooms/${ROOM}/hosts`).send({});
    expect(res.status).toBe(400);
  });

  test('403 when a non-owner tries to add a host', async () => {
    const before = await seed();
    const res = await request(createApp(10))
      .post(`/api/rooms/${ROOM}/hosts`)
      .send({ userId: '99' });
    expect(res.status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('400 when trying to add the owner as a host', async () => {
    const before = await seed();
    const res = await request(createApp(1)).post(`/api/rooms/${ROOM}/hosts`).send({ userId: '1' });
    expect(res.status).toBe(400);
    expect(await room()).toEqual(before);
  });

  test('200 the owner promotes a participant to host', async () => {
    await seed();
    const res = await request(createApp(1)).post(`/api/rooms/${ROOM}/hosts`).send({ userId: '99' });
    expect(res.status).toBe(200);
    const after = await room();
    expect(after.hostIds).toContain('99');
    // arrayUnion resolved for real — the existing host is still there, once.
    expect(after.hostIds.filter((id) => id === '10')).toHaveLength(1);
  });

  test('409 when the room is CLOSED on add — the gate fires AFTER the owner-role check', async () => {
    const before = await seed({ state: 'CLOSED' });
    const res = await request(createApp(1)).post(`/api/rooms/${ROOM}/hosts`).send({ userId: '99' });
    expect(res.status).toBe(409);
    expect(await room()).toEqual(before);
  });

  test('403 when a non-owner tries to remove a host', async () => {
    const before = await seed({ hostIds: ['10', '55'] });
    const res = await request(createApp(10)).delete(`/api/rooms/${ROOM}/hosts/55`).send({});
    expect(res.status).toBe(403);
    expect(await room()).toEqual(before);
  });

  test('200 the owner demotes a host', async () => {
    await seed();
    const res = await request(createApp(1)).delete(`/api/rooms/${ROOM}/hosts/10`).send({});
    expect(res.status).toBe(200);
    expect((await room()).hostIds).not.toContain('10');
  });

  test('200 CLOSED-room cleanup: the owner can still demote a host after close', async () => {
    // Demotion REMOVES a power rather than extending state, so it stays
    // available on a closed room — the same cleanup invariant that lets an
    // occupant vacate their own seat after close.
    await seed({ state: 'CLOSED' });
    const res = await request(createApp(1)).delete(`/api/rooms/${ROOM}/hosts/10`).send({});
    expect(res.status).toBe(200);
    expect((await room()).hostIds).not.toContain('10');
  });
});

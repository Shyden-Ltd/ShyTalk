/**
 * The rooms write routes, against REAL Firestore and RTDB.
 *
 *   POST /api/rooms/:roomId/invites/send
 *   POST /api/rooms/:roomId/seat-requests
 *
 * ─── What changed, and why it mattered (SHY-0480) ───────────────────────────
 *
 * This file used to replace Firestore, RTDB and messaging wholesale — 94
 * doubles. The count understates it: `db.doc()` ignored its path and returned
 * the SAME stub for every document, so no assertion here could tell the room
 * from the invitee from the inviter. "The room was updated" meant "some
 * document's update function was called".
 *
 * Now the documents are real and every write assertion reads Firestore back, so
 * a route that did nothing fails.
 *
 * ─── The split ──────────────────────────────────────────────────────────────
 *
 * The FCM behaviours — push payloads, invalid-token cleanup, the "Someone" and
 * "a room" display-name fallbacks, and what happens when a send fails — moved to
 * `rooms-fcm.unit.test.js`. There is no local FCM emulator, so they are genuine
 * units, and `*.unit.test.js` is the location the no-new-stubs ratchet
 * (EPIC-0003) reserves for exactly that. The two induced failures (a document
 * fetch throwing, an RTDB write failing) went with them: real Firestore will not
 * produce those on demand.
 *
 * That is what lets THIS file reach zero doubles instead of sitting in the
 * baseline forever for the sake of a dozen tests that were never route tests.
 */

// Set BEFORE requiring src/utils/firebase: outside 'local' it demands
// FIREBASE_DATABASE_URL and calls process.exit(1) at module load.
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');

const { db, rtdb } = require('../../src/utils/firebase');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const roomsRouter = require('../../src/routes/rooms');

// Per-file id range: no seeded persona, no other suite (SHY-0464).
const CALLER = 64600001;
const INVITEE = 64600002;
const OWNER = 64600003;
const OTHER = 64600004;
const ACTORS = [CALLER, INVITEE, OWNER, OTHER];

const ROOM = 'shy0480-room';
const MAX_USER_NAME_LENGTH = 50;

const roomDoc = () => db.doc(`rooms/${ROOM}`);
const seatRequestsCol = () => db.collection(`rooms/${ROOM}/seatRequests`);

const pendingInvites = async () => {
  const snap = await roomDoc().get();
  return snap.exists ? snap.data().pendingInvites || {} : null;
};

const seatRequests = async () => (await seatRequestsCol().get()).docs.map((d) => d.data());

async function clearSeatRequests() {
  const snap = await seatRequestsCol().get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

function createApp(uniqueId = String(CALLER)) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: `rt-uid-${uniqueId}`, uniqueId, token: { cohort: 'adult' } };
    next();
  });
  // Mounted at /api — same as production index.js.
  app.use('/api', roomsRouter);
  return app;
}

beforeAll(assertEmulatorReachable);

beforeEach(async () => {
  await clearSeatRequests();
  await Promise.all([
    roomDoc().set({ name: 'Test Room', ownerId: String(OWNER), pendingInvites: {} }),
    // Same cohort throughout: the cross-cohort gate is SHY-0479's subject, and
    // a mismatch here would refuse every request for the wrong reason.
    ...ACTORS.map((id) => db.doc(`users/${id}`).set({ uniqueId: id, cohort: 'adult' })),
  ]);
});

afterAll(async () => {
  await clearSeatRequests();
  await Promise.all([roomDoc().delete(), ...ACTORS.map((id) => db.doc(`users/${id}`).delete())]);
  await rtdb
    .ref(`rooms/${ROOM}`)
    .remove()
    .catch(() => {});
  if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = PRIOR_NODE_ENV;
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/rooms/:roomId/invites/send
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/rooms/:roomId/invites/send', () => {
  test('route is reachable (no double /api prefix)', async () => {
    const res = await request(createApp())
      .post(`/api/rooms/${ROOM}/invites/send`)
      .send({ userId: String(INVITEE), invitedBy: String(CALLER) });

    // A 404 here would mean the route did not match at all.
    expect(res.status).not.toBe(404);
    expect(res.status).toBe(200);
  });

  test('returns 400 when userId is missing', async () => {
    await request(createApp())
      .post(`/api/rooms/${ROOM}/invites/send`)
      .send({ invitedBy: String(CALLER) })
      .expect(400);
    expect(await pendingInvites()).toEqual({});
  });

  test('returns 400 when invitedBy is missing', async () => {
    await request(createApp())
      .post(`/api/rooms/${ROOM}/invites/send`)
      .send({ userId: String(INVITEE) })
      .expect(400);
    expect(await pendingInvites()).toEqual({});
  });

  test('returns 404 when room does not exist', async () => {
    await roomDoc().delete();
    await request(createApp())
      .post(`/api/rooms/${ROOM}/invites/send`)
      .send({ userId: String(INVITEE), invitedBy: String(CALLER) })
      .expect(404);
  });

  test('returns 403 when invitedBy is spoofed (does not match auth)', async () => {
    const res = await request(createApp(String(CALLER)))
      .post(`/api/rooms/${ROOM}/invites/send`)
      .send({ userId: String(INVITEE), invitedBy: String(OTHER) });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/another user/i);
    // Refused BEFORE any write.
    expect(await pendingInvites()).toEqual({});
  });

  test('merges into existing pendingInvites on room doc', async () => {
    await roomDoc().set({
      name: 'Room',
      ownerId: String(OWNER),
      pendingInvites: { [String(OTHER)]: { invitedBy: String(OWNER), invitedAt: 1000 } },
    });

    await request(createApp())
      .post(`/api/rooms/${ROOM}/invites/send`)
      .send({ userId: String(INVITEE), invitedBy: String(CALLER) })
      .expect(200);

    // Both invites present in the REAL document — a merge, not a replace.
    const invites = await pendingInvites();
    expect(Object.keys(invites).sort()).toEqual([String(OTHER), String(INVITEE)].sort());
    expect(invites[String(OTHER)].invitedBy).toBe(String(OWNER));
    expect(invites[String(INVITEE)].invitedBy).toBe(String(CALLER));
  });

  test('missing invitee returns 404 (existence-hiding) — no invite write', async () => {
    await db.doc(`users/${INVITEE}`).delete();

    const res = await request(createApp())
      .post(`/api/rooms/${ROOM}/invites/send`)
      .send({ userId: String(INVITEE), invitedBy: String(CALLER) });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    expect(await pendingInvites()).toEqual({});
  });

  test('the room event is broadcast on the happy path', async () => {
    // The RTDB write is how clients learn the room changed. It was previously
    // asserted only as "a stub was called"; here it is read back.
    await rtdb
      .ref(`rooms/${ROOM}/events/lastEvent`)
      .remove()
      .catch(() => {});

    await request(createApp())
      .post(`/api/rooms/${ROOM}/invites/send`)
      .send({ userId: String(INVITEE), invitedBy: String(CALLER) })
      .expect(200);

    const snap = await rtdb.ref(`rooms/${ROOM}/events/lastEvent`).once('value');
    expect(snap.val()).toMatchObject({ type: 'room_updated' });
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/rooms/:roomId/seat-requests
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/rooms/:roomId/seat-requests', () => {
  test('route is reachable (no double /api prefix)', async () => {
    const res = await request(createApp())
      .post(`/api/rooms/${ROOM}/seat-requests`)
      .send({ userName: 'Alice', seatIndex: 1 });

    expect(res.status).not.toBe(404);
    expect(res.status).toBe(200);
  });

  // Every rejected form of seatIndex, asserted against the real route AND
  // against Firestore: a 400 that still wrote a request would be worse than
  // no validation at all.
  test.each([
    ['missing', {}],
    ['a string', { seatIndex: '3' }],
    ['negative', { seatIndex: -1 }],
    ['above the maximum (20)', { seatIndex: 21 }],
    ['a float', { seatIndex: 1.5 }],
    ['null', { seatIndex: null }],
  ])('returns 400 when seatIndex is %s', async (_label, body) => {
    await request(createApp())
      .post(`/api/rooms/${ROOM}/seat-requests`)
      .send({ userName: 'Alice', ...body })
      .expect(400);
    expect(await seatRequests()).toHaveLength(0);
  });

  test.each([0, 20])('accepts seatIndex %i (boundary)', async (seatIndex) => {
    const res = await request(createApp())
      .post(`/api/rooms/${ROOM}/seat-requests`)
      .send({ userName: 'Alice', seatIndex });

    expect(res.status).toBe(200);
    // The boundary value survived into storage, not merely past validation.
    expect(await seatRequests()).toEqual([expect.objectContaining({ seatIndex })]);
  });

  test('truncates userName exceeding max length', async () => {
    const longName = 'A'.repeat(100);
    await request(createApp())
      .post(`/api/rooms/${ROOM}/seat-requests`)
      .send({ userName: longName, seatIndex: 2 })
      .expect(200);

    // Truncation is only real if Firestore holds the short one.
    const [stored] = await seatRequests();
    expect(stored.userName).toHaveLength(MAX_USER_NAME_LENGTH);
    expect(stored.userName).toBe('A'.repeat(MAX_USER_NAME_LENGTH));
  });

  test('updates existing pending request instead of creating new one', async () => {
    const first = await request(createApp())
      .post(`/api/rooms/${ROOM}/seat-requests`)
      .send({ userName: 'Alice', seatIndex: 3 })
      .expect(200);

    const second = await request(createApp())
      .post(`/api/rooms/${ROOM}/seat-requests`)
      .send({ userName: 'Alice', seatIndex: 7 })
      .expect(200);

    // Same request, moved — not a second one. Asserted by counting real
    // documents, which the previous stub could not do.
    expect(second.body.requestId).toBe(first.body.requestId);
    const stored = await seatRequests();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ seatIndex: 7, status: 'PENDING' });
  });

  test('a new request is stored with the full contract', async () => {
    const res = await request(createApp())
      .post(`/api/rooms/${ROOM}/seat-requests`)
      .send({ userName: 'Alice', seatIndex: 4 })
      .expect(200);

    const created = await db.doc(`rooms/${ROOM}/seatRequests/${res.body.requestId}`).get();
    expect(created.exists).toBe(true);
    expect(created.data()).toMatchObject({
      requestId: res.body.requestId,
      userId: String(CALLER),
      userName: 'Alice',
      seatIndex: 4,
      status: 'PENDING',
      resolvedBy: null,
      resolvedAt: null,
    });
  });

  test('rooms without ownerId are refused (404) — cohort cannot be resolved', async () => {
    await roomDoc().set({ name: 'Anonymous Room' });

    const res = await request(createApp())
      .post(`/api/rooms/${ROOM}/seat-requests`)
      .send({ seatIndex: 3 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Room not found' });
    expect(await seatRequests()).toHaveLength(0);
  });

  test('missing owner doc returns 404 (existence-hiding)', async () => {
    await db.doc(`users/${OWNER}`).delete();

    const res = await request(createApp())
      .post(`/api/rooms/${ROOM}/seat-requests`)
      .send({ seatIndex: 3 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    expect(await seatRequests()).toHaveLength(0);
  });

  test('missing room doc returns 404 up front (no seat-request created)', async () => {
    await roomDoc().delete();

    await request(createApp())
      .post(`/api/rooms/${ROOM}/seat-requests`)
      .send({ seatIndex: 3 })
      .expect(404);
    expect(await seatRequests()).toHaveLength(0);
  });
});

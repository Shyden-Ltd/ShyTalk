/**
 * SHY-0492 — the presence routes when a dependency fails.
 *
 * Split out of `room-presence.test.js`, which is real end to end. Real RTDB
 * does not refuse a read on demand and real Firestore does not throw, so the
 * failures are injected with targeted, restored `jest.spyOn` calls — which
 * match the no-new-stubs ratchet's `mockImplementation` pattern, hence the
 * `*.unit.test.js` location policy reserves for exactly this.
 *
 * ─── The fail-safe is the one that matters ──────────────────────────────────
 *
 *     } catch (err) {
 *       log.error('room-mutations', 'Presence read failed', ...);
 *       return true;   // ← treat them as PRESENT
 *     }
 *
 * `isUserPresent` returns TRUE on error, so a database blip can never be
 * mistaken for somebody having left. A mocked read could never test that
 * honestly: the mock decided both the question and the answer.
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');

const { db, rtdb } = require('../../src/utils/firebase');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const log = require('../../src/utils/log');
const router = require('../../src/routes/room-mutations');

const ROOM = 'shy0492-presence-errors';
const OWNER = 65100001;
const HOST = 65100002;
const ATTENDEE = 65100003;
const ACTORS = [OWNER, HOST, ATTENDEE];

const roomRef = () => db.doc(`rooms/${ROOM}`);
const room = async () => {
  const s = await roomRef().get();
  return s.exists ? s.data() : null;
};

function createApp(uniqueId = HOST) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'fb-uid', uniqueId: String(uniqueId), token: { cohort: 'adult' } };
    next();
  });
  app.use('/api', router);
  return app;
}

async function seed(overrides = {}) {
  await roomRef().set({
    ownerId: String(OWNER),
    cohort: 'adult',
    state: 'ACTIVE',
    participantIds: [String(OWNER), String(HOST), String(ATTENDEE)],
    hostIds: [String(HOST)],
    pendingInvites: {},
    seats: {
      0: { userId: String(OWNER), state: 'OCCUPIED', isMuted: false },
      3: { userId: String(ATTENDEE), state: 'OCCUPIED', isMuted: false },
    },
    ...overrides,
  });
  await Promise.all(
    ACTORS.map((id) => db.doc(`users/${id}`).set({ uniqueId: id, currentRoomId: ROOM })),
  );
  // The person really IS gone — so a refusal below can only come from the
  // failure being injected, never from them still being here.
  await rtdb
    .ref(`rooms/${ROOM}/presence/${ATTENDEE}`)
    .remove()
    .catch(() => {});
}

/** Make the presence read fail, and nothing else. */
function breakPresenceRead() {
  const realRef = rtdb.ref.bind(rtdb);
  jest.spyOn(rtdb, 'ref').mockImplementation((path) => {
    const ref = realRef(path);
    if (String(path).includes('/presence/')) {
      ref.get = () => Promise.reject(new Error('rtdb down'));
    }
    return ref;
  });
}

beforeAll(assertEmulatorReachable);

afterEach(() => {
  jest.restoreAllMocks();
});

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

describe('the presence read fails — FAIL SAFE, never fail open', () => {
  test('disconnect-user refuses, treating an unreadable presence as PRESENT', async () => {
    await seed();
    const before = await room();
    const errors = jest.spyOn(log, 'error').mockImplementation(() => {});
    breakPresenceRead();

    const res = await request(createApp(HOST))
      .post(`/api/rooms/${ROOM}/disconnect-user`)
      .send({ userId: String(ATTENDEE) });

    // The target is genuinely absent. Only the injected failure stands between
    // them and eviction — and it must.
    expect(res.status).toBe(403);
    expect(await room()).toEqual(before);
    expect(errors).toHaveBeenCalledWith(
      'room-mutations',
      'Presence read failed',
      expect.objectContaining({ error: 'rtdb down' }),
    );
  });

  test('owner-away refuses a non-owner when the owner presence is unreadable', async () => {
    await seed();
    const before = await room();
    jest.spyOn(log, 'error').mockImplementation(() => {});
    breakPresenceRead();

    const res = await request(createApp(HOST)).post(`/api/rooms/${ROOM}/owner-away`).send({});

    expect(res.status).toBe(403);
    expect(await room()).toEqual(before);
  });
});

describe('the write path fails', () => {
  test('the eviction stands when the currentRoomId clear fails (best-effort)', async () => {
    await seed();
    const errors = jest.spyOn(log, 'error').mockImplementation(() => {});
    // Fail only the foreign user-document write, leaving the transaction alone.
    const realDoc = db.doc.bind(db);
    jest.spyOn(db, 'doc').mockImplementation((p) => {
      const ref = realDoc(p);
      if (String(p) === `users/${ATTENDEE}`) {
        ref.set = () => Promise.reject(new Error('user doc write failed'));
      }
      return ref;
    });

    const res = await request(createApp(HOST))
      .post(`/api/rooms/${ROOM}/disconnect-user`)
      .send({ userId: String(ATTENDEE) });

    // The room mutation already committed; the kicked user self-clears on
    // observing it. A foreign write must not undo an eviction.
    expect(res.status).toBe(200);
    expect((await room()).participantIds).not.toContain(String(ATTENDEE));
    expect(errors).toHaveBeenCalled();
  });

  test('owner-away answers 500 when the transaction throws', async () => {
    await seed();
    jest.spyOn(log, 'error').mockImplementation(() => {});
    jest
      .spyOn(db, 'runTransaction')
      .mockImplementation(() => Promise.reject(new Error('Firestore down')));

    const res = await request(createApp(OWNER)).post(`/api/rooms/${ROOM}/owner-away`).send({});

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('Firestore down');
  });

  test('disconnect-user answers 500 when the transaction throws', async () => {
    await seed();
    jest.spyOn(log, 'error').mockImplementation(() => {});
    jest
      .spyOn(db, 'runTransaction')
      .mockImplementation(() => Promise.reject(new Error('Firestore down')));

    const res = await request(createApp(HOST))
      .post(`/api/rooms/${ROOM}/disconnect-user`)
      .send({ userId: String(ATTENDEE) });

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('Firestore down');
  });
});

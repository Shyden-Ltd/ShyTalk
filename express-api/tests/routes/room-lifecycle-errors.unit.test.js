/**
 * SHY-0485 — the lifecycle routes when a dependency fails.
 *
 * Split out of `room-lifecycle.test.js`, which is real end to end. Real
 * Firestore neither throws nor fails a batch on demand, and the targeted
 * `jest.spyOn` matches the no-new-stubs ratchet's `mockImplementation` pattern
 * — so these live in the `*.unit.test.js` location policy reserves for a
 * genuinely isolated collaborator.
 *
 * The batch case is the interesting one. Clearing every participant's
 * `currentRoomId` after a close is deliberately BEST-EFFORT: a failure must not
 * undo an already-committed close, because clients also self-clear on observing
 * it. Firestore stays real here, so the assertion is not merely "still 200" —
 * it is that the room really is CLOSED while the user documents really are
 * untouched, which is exactly the state that branch produces.
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');

const { db } = require('../../src/utils/firebase');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const log = require('../../src/utils/log');
const router = require('../../src/routes/room-mutations');

const ROOM = 'shy0485-lifecycle-errors';
const OWNER = 64900001;
const ATTENDEE = 64900002;
const ACTORS = [OWNER, ATTENDEE];

function createApp(uniqueId = OWNER) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'fb-uid', uniqueId: String(uniqueId), token: { cohort: 'adult' } };
    next();
  });
  app.use('/api', router);
  return app;
}

beforeAll(assertEmulatorReachable);

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await db.doc(`rooms/${ROOM}`).delete();
  await Promise.all(ACTORS.map((id) => db.doc(`users/${id}`).delete()));
  if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('the lifecycle routes when the transaction throws', () => {
  test.each([['close'], ['owner-returned']])(
    '%s answers 500 and logs, without leaking why',
    async (route) => {
      jest.spyOn(log, 'error').mockImplementation(() => {});
      jest
        .spyOn(db, 'runTransaction')
        .mockImplementation(() => Promise.reject(new Error('Firestore down')));

      const res = await request(createApp()).post(`/api/rooms/${ROOM}/${route}`).send({});

      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain('Firestore down');
      expect(log.error).toHaveBeenCalled();
    },
  );
});

describe('the participant release is BEST-EFFORT', () => {
  test('a failing batch leaves the room CLOSED and the user documents untouched', async () => {
    // Firestore stays real; only the batch is made to fail. So this asserts the
    // STATE that branch produces, not merely that the response was 200.
    await db.doc(`rooms/${ROOM}`).set({
      ownerId: String(OWNER),
      cohort: 'adult',
      state: 'ACTIVE',
      participantIds: [String(OWNER), String(ATTENDEE)],
      hostIds: [],
      pendingInvites: {},
      seats: { 0: { userId: String(OWNER), state: 'OCCUPIED', isMuted: false } },
    });
    await Promise.all(
      ACTORS.map((id) => db.doc(`users/${id}`).set({ uniqueId: id, currentRoomId: ROOM })),
    );

    jest.spyOn(log, 'error').mockImplementation(() => {});

    // Fail ONLY the participant-clear batch.
    //
    // Replacing `db.batch` wholesale breaks the transaction, because the
    // Firestore SDK builds a `WriteBatch` through it — the first attempt died
    // with `this._writeBatch._reset is not a function` and the route answered
    // 500 for the wrong reason entirely.
    //
    // So a REAL batch is returned, and its commit is refused only once it has
    // been given a `users/` write. The transaction's own batch never touches
    // that collection, so it commits normally.
    const realBatch = db.batch.bind(db);
    jest.spyOn(db, 'batch').mockImplementation(() => {
      const batch = realBatch();
      const set = batch.set.bind(batch);
      const commit = batch.commit.bind(batch);
      let clearedAParticipant = false;
      batch.set = (ref, data, options) => {
        if (String(ref?.path || '').startsWith('users/')) clearedAParticipant = true;
        return set(ref, data, options);
      };
      batch.commit = () =>
        clearedAParticipant ? Promise.reject(new Error('batch down')) : commit();
      return batch;
    });

    const res = await request(createApp()).post(`/api/rooms/${ROOM}/close`).send({});

    // The close itself committed and must stand.
    expect(res.status).toBe(200);
    expect((await db.doc(`rooms/${ROOM}`).get()).data().state).toBe('CLOSED');

    // And nobody was released — which is precisely why clients self-clear on
    // observing a close.
    for (const id of ACTORS) {
      expect((await db.doc(`users/${id}`).get()).data().currentRoomId).toBe(ROOM);
    }
    expect(log.error).toHaveBeenCalled();
  });
});

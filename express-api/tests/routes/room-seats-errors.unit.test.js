/**
 * SHY-0481 — what the seat routes do when the datastore fails.
 *
 * Split out of `room-seats.test.js`, which is real end to end. Real Firestore
 * does not throw on demand, and "the route survives a failing transaction" is a
 * question about THIS ROUTE'S error handling rather than a statement about
 * Firestore — so the failure is injected with a targeted, restored
 * `jest.spyOn`, not by replacing the module.
 *
 * `*.unit.test.js` is the location the no-new-stubs ratchet (EPIC-0003)
 * reserves for exactly this. The spy matches its `mockImplementation` pattern,
 * which is why these three do not live in the real file.
 *
 * What is protected: the route must answer 500 and log, rather than hang or
 * leak the datastore's message to the caller. "Firestore down" names our
 * infrastructure to whoever asked.
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');

const { db } = require('../../src/utils/firebase');
const log = require('../../src/utils/log');
const router = require('../../src/routes/room-mutations');

const ROOM = 'shy0481-seat-errors';

function createApp(uniqueId = 10) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'fb-uid', uniqueId, token: { cohort: 'adult' } };
    next();
  });
  app.use('/api', router);
  return app;
}

/** Make every transaction reject, as a datastore outage would. */
function breakTransactions(message = 'Firestore down') {
  jest.spyOn(log, 'error').mockImplementation(() => {});
  jest.spyOn(db, 'runTransaction').mockImplementation(() => Promise.reject(new Error(message)));
}

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('the seat routes when the transaction throws', () => {
  test.each([
    ['claim', (app) => request(app).post(`/api/rooms/${ROOM}/seats/3/claim`).send({})],
    [
      'accept-invite',
      (app) => request(app).post(`/api/rooms/${ROOM}/seats/3/accept-invite`).send({}),
    ],
    ['move', (app) => request(app).post(`/api/rooms/${ROOM}/seats/3/move`).send({ toIndex: 4 })],
  ])('%s answers 500 and logs, without leaking why', async (_label, call) => {
    breakTransactions();

    const res = await call(createApp());

    expect(res.status).toBe(500);
    // The caller is told nothing about the datastore.
    expect(JSON.stringify(res.body)).not.toContain('Firestore down');
    expect(log.error).toHaveBeenCalled();
  });

  test('the failure is logged with the underlying reason, for the operator', () => {
    // The message the caller must NOT see is exactly the one the log MUST keep.
    breakTransactions('a very specific datastore reason');
    return request(createApp())
      .post(`/api/rooms/${ROOM}/seats/3/claim`)
      .send({})
      .expect(500)
      .then(() => {
        const logged = JSON.stringify(log.error.mock.calls);
        expect(logged).toContain('a very specific datastore reason');
      });
  });
});

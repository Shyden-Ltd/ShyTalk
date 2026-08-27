/**
 * SHY-0483 — what the membership routes do when the datastore fails.
 *
 * Split out of `room-membership.test.js`, which is real end to end. Real
 * Firestore does not throw on demand, and "the route survives a failing
 * transaction" is a question about THIS ROUTE'S error handling — so the failure
 * is injected with a targeted, restored `jest.spyOn` rather than by replacing
 * the module. `*.unit.test.js` is the location the no-new-stubs ratchet
 * (EPIC-0003) reserves for that; the spy matches its `mockImplementation`
 * pattern, which is why these do not live in the real file.
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');

const { db } = require('../../src/utils/firebase');
const log = require('../../src/utils/log');
const router = require('../../src/routes/room-mutations');

const ROOM = 'shy0483-membership-errors';

function createApp(uniqueId = 50) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'fb-uid', uniqueId, token: { cohort: 'adult' } };
    next();
  });
  app.use('/api', router);
  return app;
}

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

describe('the membership routes when the transaction throws', () => {
  test.each([['join'], ['leave'], ['decline-invite'], ['first-join']])(
    '%s answers 500 and logs, without leaking why',
    async (route) => {
      breakTransactions();

      const res = await request(createApp()).post(`/api/rooms/${ROOM}/${route}`).send({});

      expect(res.status).toBe(500);
      // The caller is told nothing about our infrastructure.
      expect(JSON.stringify(res.body)).not.toContain('Firestore down');
      expect(log.error).toHaveBeenCalled();
    },
  );
});

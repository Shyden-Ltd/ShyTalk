/**
 * SHY-0484 — what the settings routes do when the datastore fails.
 *
 * Split out of `room-settings.test.js`, which is real end to end. Real
 * Firestore does not throw on demand, and the targeted `jest.spyOn` matches the
 * no-new-stubs ratchet's `mockImplementation` pattern — so these live in the
 * `*.unit.test.js` location that policy reserves for a genuinely isolated
 * collaborator.
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');

const { db } = require('../../src/utils/firebase');
const log = require('../../src/utils/log');
const router = require('../../src/routes/room-mutations');

const ROOM = 'shy0484-settings-errors';

function createApp(uniqueId = 1) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'fb-uid', uniqueId, token: { cohort: 'adult' } };
    next();
  });
  app.use('/api', router);
  return app;
}

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('the settings routes when the transaction throws', () => {
  test.each([
    ['name', { name: 'Hi' }],
    ['require-approval', { requireApproval: true }],
  ])('%s answers 500 and logs, without leaking why', async (route, body) => {
    jest.spyOn(log, 'error').mockImplementation(() => {});
    jest
      .spyOn(db, 'runTransaction')
      .mockImplementation(() => Promise.reject(new Error('Firestore down')));

    const res = await request(createApp()).patch(`/api/rooms/${ROOM}/${route}`).send(body);

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('Firestore down');
    expect(log.error).toHaveBeenCalled();
  });
});

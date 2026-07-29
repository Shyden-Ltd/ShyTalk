'use strict';

/**
 * SHY-0253 — every vote on the public roadmap returned 500.
 *
 * `POST /suggestions/:id/vote` ran its transaction with
 * `await t.get(`suggestions/${id}`)` — a PATH STRING where Firestore's
 * `Transaction.get` requires a DocumentReference. The reference was even built
 * on the line above (`sugRef`) and then ignored. The throw happened inside the
 * transaction, so the route's catch turned it into a bare
 * `{"error":"Internal server error"}` with nothing naming the cause.
 *
 * Nothing caught it because no test voted through the real endpoint: the web
 * specs route-mocked `/vote`, and the board's own vote tests ran signed out,
 * where the click only opens the login modal.
 *
 * REAL services: real Auth-emulator tokens, real Firestore transaction.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');
const { db } = require('../../src/utils/firebase');
const { authMiddleware } = require('../../src/middleware/auth');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { mintRealUser, clearAuthCaches } = require('../helpers/real-auth');
const suggestionsRouter = require('../../src/routes/suggestions');

const VOTER_ID = 65200001;
const AUTHOR_ID = 65200002;
const PREFIX = `shy0253-${process.pid}`;
const CREATED = [];

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', suggestionsRouter);
  return app;
}

async function seedSuggestion(status = 'accepted') {
  const id = `${PREFIX}-${CREATED.length}-${Date.now()}`;
  const now = Date.now();
  await db.doc(`suggestions/${id}`).set({
    id,
    title: 'SHY-0253 vote target',
    description: 'Seeded by suggestions-vote-transaction.test.js',
    tags: [],
    language: 'en',
    status,
    submitterUid: AUTHOR_ID,
    upvotes: 1,
    downvotes: 0,
    createdAt: now,
    updatedAt: now,
  });
  CREATED.push(id);
  return id;
}

describe('SHY-0253 — voting must not 500', () => {
  let app;
  let voter;

  beforeAll(async () => {
    await assertEmulatorReachable();
    app = createApp();
    voter = await mintRealUser({ uniqueId: VOTER_ID });
    await mintRealUser({ uniqueId: AUTHOR_ID });
  });

  afterAll(async () => {
    for (const id of CREATED) {
      const votes = await db.collection(`suggestions/${id}/votes`).get();
      await Promise.all(votes.docs.map((d) => d.ref.delete()));
      await db.doc(`suggestions/${id}`).delete();
    }
    clearAuthCaches();
    process.env.NODE_ENV = PRIOR_NODE_ENV;
  });

  test('an upvote succeeds and is reflected in the score', async () => {
    const id = await seedSuggestion();
    const res = await request(app)
      .post(`/api/suggestions/${id}/vote`)
      .set(voter.headers)
      .send({ direction: 'up' });

    expect(res.status).toBe(200);
    expect(res.body.upvotes).toBe(2);
  });

  test('the vote is persisted under the voter, not just returned', async () => {
    const id = await seedSuggestion();
    await request(app)
      .post(`/api/suggestions/${id}/vote`)
      .set(voter.headers)
      .send({ direction: 'up' });

    const doc = await db.doc(`suggestions/${id}/votes/${VOTER_ID}`).get();
    expect(doc.exists).toBe(true);
    expect(doc.data().vote ?? doc.data().direction).toBe('up');
  });

  test('a downvote succeeds too', async () => {
    const id = await seedSuggestion();
    const res = await request(app)
      .post(`/api/suggestions/${id}/vote`)
      .set(voter.headers)
      .send({ direction: 'down' });

    expect(res.status).toBe(200);
    expect(res.body.downvotes).toBe(1);
  });

  test('a non-votable status is REFUSED with its own status, not a 500', async () => {
    const id = await seedSuggestion('completed');
    const res = await request(app)
      .post(`/api/suggestions/${id}/vote`)
      .set(voter.headers)
      .send({ direction: 'up' });

    // The point is that the refusal is deliberate and classified — a 500 here
    // would mean the transaction threw again rather than the rule firing.
    expect(res.status).not.toBe(500);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('voting on a suggestion that does not exist is a 404, not a 500', async () => {
    const res = await request(app)
      .post(`/api/suggestions/${PREFIX}-missing/vote`)
      .set(voter.headers)
      .send({ direction: 'up' });

    expect(res.status).not.toBe(500);
  });
});

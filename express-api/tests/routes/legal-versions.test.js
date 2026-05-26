/**
 * Locks the /api/legal/versions response shape.
 *
 * The endpoint serves the sign-up screen + admin tooling — both consume
 * the numeric versions to decide whether a user needs a re-acceptance
 * flow. Bumping a version in src/routes/legal-versions.js triggers
 * re-acceptance for every user whose stored acceptance is < the new
 * value. That's a serious user-visible side effect, so the response
 * shape + version values are locked here.
 *
 * To bump a version: update LEGAL_VERSIONS in the route file AND the
 * expectation here. The dual-update is intentional friction — it forces
 * the bumper to think about which users get re-acceptance prompts.
 */

const express = require('express');
const request = require('supertest');

const legalVersionsRouter = require('../../src/routes/legal-versions');
const { LEGAL_VERSIONS } = require('../../src/routes/legal-versions');

function createApp() {
  const app = express();
  app.use('/api', legalVersionsRouter);
  return app;
}

describe('GET /api/legal/versions', () => {
  test('returns the three legal-document versions', async () => {
    const res = await request(createApp()).get('/api/legal/versions').expect(200);
    expect(res.body).toEqual({
      privacy: 4,
      terms: 1,
      community: 1,
    });
  });

  test('exported LEGAL_VERSIONS object is frozen (defends against caller mutation)', () => {
    expect(Object.isFrozen(LEGAL_VERSIONS)).toBe(true);
  });

  test('exported LEGAL_VERSIONS matches the response body', async () => {
    const res = await request(createApp()).get('/api/legal/versions').expect(200);
    expect(res.body).toEqual(LEGAL_VERSIONS);
  });

  test('every version is a positive integer (re-acceptance gate depends on numeric comparison)', () => {
    for (const [key, value] of Object.entries(LEGAL_VERSIONS)) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
      // Document the contract — keys can't drift to e.g. `privacyPolicy`.
      expect(['privacy', 'terms', 'community']).toContain(key);
    }
  });
});

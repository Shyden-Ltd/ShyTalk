/**
 * The `/api` auth gate, COMPOSED — skip predicate wired to the real
 * `authMiddleware`, in front of real routes.
 *
 * SHY-0143 R5/C-1. Every existing test either mounts a router bare
 * (`app.use('/api', router)`, with a comment saying it "mirrors the index.js
 * skip") or calls `skipsAuth` directly. So the two-line composition in
 * `index.js` — the thing that actually decides whether a request is
 * authenticated — had zero executing coverage.
 *
 * That is not hypothetical. A `req = { ...req, path }` inside the predicate
 * dropped `req.headers` (a prototype accessor, not an own key) and threw
 * `TypeError` inside the middleware, 500-ing every `POST /api/translate`,
 * anonymous and authenticated alike. The source pin
 * (`translate-public.test.js`: `expect(src).toMatch(/skipsAuth\(req\)/)`) was
 * green throughout — `index.js` DID call it; the defect was in the callee.
 *
 * These tests assert STATUS CODES through the composed stack, so the same
 * class of regression reddens here rather than in production.
 *
 * NODE_ENV='local' is set BEFORE requiring firebase so the Admin SDK targets
 * the emulator. PER-FILE opt-in only.
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');
const { authMiddleware } = require('../../src/middleware/auth');
const { skipsAuth } = require('../../src/middleware/auth-skip');

/**
 * The composition copied from `src/index.js`. Kept to two lines so a drift
 * between this and the real one is visible at a glance; the pin in
 * `translate-public.test.js` asserts index.js still calls `skipsAuth(req)`.
 */
function createApp(routers) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api', (req, res, next) => {
    if (skipsAuth(req)) return next();
    return authMiddleware(req, res, next);
  });
  routers.forEach((r) => app.use('/api', r));
  // A terminal handler so a request that passes the gate has somewhere to
  // land even when no route matches — otherwise a 404 and a 401 would be
  // indistinguishable from "the gate let it through".
  app.use('/api', (req, res) => res.status(299).json({ reached: true }));
  return app;
}

const app = () => createApp([require('../../src/routes/ban-status')]);

afterAll(() => {
  // `process.env` coerces, so assigning an undefined PRIOR_NODE_ENV sets the
  // literal string 'undefined'. Jest's default NODE_ENV='test' masks it here,
  // but the sibling suites get this right and so should this one.
  if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('public paths reach the route with no Authorization header', () => {
  test('POST /api/translate does not 500 — the regression this file exists for', async () => {
    const res = await request(app()).post('/api/translate').send({ q: 'hi' });

    // 500 is the failure being guarded. Anything else means the gate ran and
    // handed off; the route's own contract is tested elsewhere.
    // Exact: the gate let it through to the terminal handler.
    expect(res.status).toBe(299);
  });

  test('GET /api/ban-status answers 200 with no token at all', async () => {
    // The whole premise of SHY-0143's C1 fix: a banned user with no session
    // must still learn they are banned.
    const res = await request(app()).get('/api/ban-status').query({ deviceId: 'compo-test-1' });

    expect(res.status).toBe(200);
    expect(res.body.banStatus).toBeDefined();
  });

  test('GET /api/health is reachable unauthenticated', async () => {
    const res = await request(app()).get('/api/health');
    expect(res.status).toBe(299);
  });
});

describe('protected paths are still gated', () => {
  test('POST /api/device-info with no token is rejected', async () => {
    // The sibling of ban-status, and the reason ban-status had to be a new
    // route rather than an exemption on this one.
    const res = await request(app()).post('/api/device-info').send({ deviceId: 'x' });
    expect(res.status).toBe(401);
  });

  test('an ordinary route with no token is rejected', async () => {
    const res = await request(app()).get('/api/users/10000005');
    expect(res.status).toBe(401);
  });

  test('POST /api/translate WITH a bearer token goes through authMiddleware', async () => {
    // The other half of the anonymous-translate rule: presenting a token opts
    // into the authenticated contract, so a bad token must be rejected rather
    // than silently treated as the public flow.
    const res = await request(app())
      .post('/api/translate')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ text: 'hi', targetLang: 'de' });

    expect(res.status).toBe(401);
  });

  test('POST /api/ban-status is NOT exempt — the skip is GET-only', async () => {
    const res = await request(app()).post('/api/ban-status').send({ deviceId: 'x' });
    expect(res.status).toBe(401);
  });
});

describe('the gate itself never throws', () => {
  test.each([
    // EXACT statuses, not merely "not 500". Asserting only the absence of a
    // 500 passes identically whether the gate denies everything (all 401) or
    // allows everything (299) — it could not tell a correct gate from a
    // broken one, while its own comment claimed to make a gate-level
    // assertion. 299 is the terminal handler: the gate let it through.
    ['GET', '/api/ban-status', 400], // reaches the route, which demands deviceId
    ['GET', '/api/ban-status/', 400], // trailing slash: same route, same answer
    ['POST', '/api/translate', 299], // public, unmounted here
    ['GET', '/api/health', 299],
    ['GET', '/api/suggestions', 299],
    ['GET', '/api/suggestions/mine', 401], // the carve-out stays authenticated
    ['GET', '/api/auth/whatever', 299],
    ['GET', '/api/', 401],
  ])('%s %s answers %i through the real gate', async (method, path, expected) => {
    // A TypeError anywhere in the predicate surfaces as a 500 on EVERY route
    // it examines, not just the one whose rule threw.
    const res = await request(app())[method.toLowerCase()](path).send({});
    expect(res.status).toBe(expected);
  });
});

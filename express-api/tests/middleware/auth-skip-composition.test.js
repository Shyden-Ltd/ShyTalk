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

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const { authMiddleware } = require('../../src/middleware/auth');
const { skipsAuth, requiresAppCheck } = require('../../src/middleware/auth-skip');
const {
  appCheckMiddleware,
  APP_CHECK_HEADER,
  __setVerifierForTests,
  __resetCountersForTests,
  appCheckCounters,
} = require('../../src/middleware/app-check');
const { db } = require('../../src/utils/firebase');
const { clearBanCache } = require('../../src/utils/bans');
const { clearPrefixed } = require('../helpers/firebase-emulator');

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
    if (skipsAuth(req)) {
      if (requiresAppCheck(req)) return appCheckMiddleware(req, res, next);
      return next();
    }
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

/**
 * SHY-0300 — attestation on the unauthenticated ban gate, COMPOSED.
 *
 * The proof that `checkBans` is never consulted uses a REAL ban seeded in the
 * REAL emulator rather than a spy. If the refusal happened anywhere after the
 * ban engine, the response would carry that ban; a 401 with no `banStatus` is
 * therefore direct evidence of ordering, and it costs no test double in a
 * non-unit location.
 */
describe('SHY-0300 — App Check on GET /api/ban-status', () => {
  const ID_PREFIX = 'ac-compo-';
  const DEVICE = `${ID_PREFIX}banned-device`;

  const good = () => __setVerifierForTests(async () => ({ appId: '1:1:android:real' }));
  const bad = () =>
    __setVerifierForTests(async () => {
      const e = new Error('Decoding App Check token failed');
      e.code = 'app-check/invalid-argument';
      throw e;
    });

  beforeAll(async () => {
    // A REAL device ban, so "the engine was never consulted" is observable
    // rather than asserted about an internal call.
    await db.collection('deviceBans').doc(DEVICE).set({
      deviceId: DEVICE,
      reason: 'seeded for the ordering proof',
      expiresAt: null,
      createdAt: new Date().toISOString(),
    });
  });

  afterAll(async () => {
    await clearPrefixed(db, 'deviceBans', ID_PREFIX);
  });

  beforeEach(() => {
    clearBanCache();
    __resetCountersForTests();
    good();
  });

  afterEach(() => {
    delete process.env.APP_CHECK_MODE;
  });

  describe('enforce', () => {
    beforeEach(() => {
      process.env.APP_CHECK_MODE = 'enforce';
    });

    test('no App Check header is 401 app-check-required, and the ban engine never runs', async () => {
      const res = await request(app()).get('/api/ban-status').query({ deviceId: DEVICE });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('app-check-required');
      // The device IS banned. Had the request reached `checkBans`, this would
      // be a 200 carrying that ban.
      expect(res.body.banStatus).toBeUndefined();
    });

    test('a VALID token is served the real ban, proving the gate is not simply closed', async () => {
      // Without this row, a middleware that refused everything would satisfy
      // the test above perfectly.
      const res = await request(app())
        .get('/api/ban-status')
        .set(APP_CHECK_HEADER, 'a-good-token')
        .query({ deviceId: DEVICE });

      expect(res.status).toBe(200);
      expect(res.body.banStatus.isBanned).toBe(true);
    });

    test('an INVALID token is refused with the same code', async () => {
      bad();
      const res = await request(app())
        .get('/api/ban-status')
        .set(APP_CHECK_HEADER, 'garbage')
        .query({ deviceId: DEVICE });

      expect({ status: res.status, code: res.body.code }).toEqual({
        status: 401,
        code: 'app-check-required',
      });
    });

    test('a trailing slash cannot side-step attestation', async () => {
      // Express matches `/api/ban-status/` to the same route, so if the two
      // predicates normalised differently a slash would reach the route with
      // no attestation at all.
      const res = await request(app()).get('/api/ban-status/').query({ deviceId: DEVICE });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('app-check-required');
    });

    test('the OTHER public paths are untouched — this story attested ONE route', async () => {
      // `/apple-notifications/v2` is the sharp one: Apple calls it and can
      // never send an App Check token, so widening the predicate would break
      // purchases. These must keep passing with no attestation.
      const health = await request(app()).get('/api/health');
      const translate = await request(app()).post('/api/translate').send({ q: 'hi' });
      const apple = await request(app()).post('/api/apple-notifications/v2').send({});

      expect([health.status, translate.status, apple.status]).toEqual([299, 299, 299]);
    });

    test('refusals are counted', async () => {
      await request(app()).get('/api/ban-status').query({ deviceId: DEVICE });
      expect(appCheckCounters()).toMatchObject({ missing: 1, refused: 1 });
    });
  });

  describe('monitor — the rollout step, and it must change nothing', () => {
    beforeEach(() => {
      process.env.APP_CHECK_MODE = 'monitor';
    });

    test('no App Check header is still served the real ban', async () => {
      const res = await request(app()).get('/api/ban-status').query({ deviceId: DEVICE });

      expect(res.status).toBe(200);
      expect(res.body.banStatus.isBanned).toBe(true);
    });

    test('the outcome is recorded even though nobody is refused', async () => {
      await request(app()).get('/api/ban-status').query({ deviceId: DEVICE });
      expect(appCheckCounters()).toMatchObject({ missing: 1, refused: 0 });
    });
  });
});

/**
 * The ORDERING requirement, on its own, because it is the one property that
 * cannot be seen from a status code: an unattested flood must be refused
 * BEFORE it can spend a legitimate ip's rate-limit allowance. Get the mount
 * order wrong and attestation still "works" — every test above still passes —
 * while the abuse it exists to stop simply moves one layer out.
 *
 * `generalLimiter` cannot be the instrument here: it `skip`s whenever
 * `NODE_ENV !== 'production'`, so in any test it runs no logic and sets no
 * headers. An assertion that its headers are ABSENT therefore passes on every
 * response ever produced, including one where the ordering is backwards — a
 * measurement that cannot fail ([[feedback-mutation-passed-means-investigate]]).
 * An earlier draft of this block asserted exactly that.
 *
 * So the runtime proof uses a probe mounted in the limiter's POSITION and
 * counts arrivals, which is env-independent; and a structural assertion pins
 * the real order in index.js, which the probe cannot see.
 */
describe('SHY-0300 — a refusal must not reach the rate limiter', () => {
  let reachedLimiterPosition;

  /** The gate followed by whatever index.js mounts next, in that order. */
  function limitedApp() {
    reachedLimiterPosition = 0;
    const a = express();
    a.set('trust proxy', 1);
    a.use(express.json());
    a.use('/api', (req, res, next) => {
      if (skipsAuth(req)) {
        if (requiresAppCheck(req)) return appCheckMiddleware(req, res, next);
        return next();
      }
      return authMiddleware(req, res, next);
    });
    // Stands where `generalLimiter` stands. Not a stand-in for it — it is an
    // observation point in the test's own app, and what it observes is
    // arrival, which is precisely the ordering claim.
    a.use('/api', (req, res, next) => {
      reachedLimiterPosition += 1;
      next();
    });
    a.use('/api', (req, res) => res.status(299).json({ reached: true }));
    return a;
  }

  beforeEach(() => {
    __resetCountersForTests();
    __setVerifierForTests(async () => ({ appId: '1:1:android:real' }));
  });

  afterEach(() => {
    delete process.env.APP_CHECK_MODE;
  });

  test('an attested request DOES reach it — the control', async () => {
    // Without this row, a gate that refused everything would satisfy the next
    // test perfectly while attesting nothing.
    process.env.APP_CHECK_MODE = 'enforce';
    const res = await request(limitedApp())
      .get('/api/ban-status')
      .set(APP_CHECK_HEADER, 'good')
      .query({ deviceId: 'ord-1' });

    expect(res.status).toBe(299);
    expect(reachedLimiterPosition).toBe(1);
  });

  test('twenty-five refusals reach it zero times', async () => {
    process.env.APP_CHECK_MODE = 'enforce';
    const app = limitedApp();

    for (let i = 0; i < 25; i++) {
      // Sequential by design: the claim is that 25 refusals IN A ROW cost the
      // bucket nothing, which parallel requests would not demonstrate.
      const res = await request(app).get('/api/ban-status').query({ deviceId: 'ord-2' });
      expect(res.status).toBe(401);
    }

    expect(reachedLimiterPosition).toBe(0);
    expect(appCheckCounters().refused).toBe(25);
  });

  test('in MONITOR mode an unattested request reaches it, as it must', async () => {
    // Monitor refuses nobody, so the limiter is still the control that bounds
    // an unattested caller. Confirming this is what makes monitor mode a safe
    // rollout step rather than a hole.
    process.env.APP_CHECK_MODE = 'monitor';
    const res = await request(limitedApp()).get('/api/ban-status').query({ deviceId: 'ord-3' });

    expect(res.status).toBe(299);
    expect(reachedLimiterPosition).toBe(1);
  });

  test('index.js registers the gate BEFORE generalLimiter', () => {
    // The probe above proves the order of the harness. This proves the order
    // of the thing that ships: no test imports index.js, so its mount order
    // is otherwise unverified — the same blind spot that let a broken skip
    // predicate 500 every POST /api/translate while its source pin stayed
    // green.
    const src = fs.readFileSync(path.join(__dirname, '../../src/index.js'), 'utf8');
    const gate = src.indexOf('requiresAppCheck(req)');
    const limiter = src.indexOf('return generalLimiter(req, res, next);');
    expect(gate).toBeGreaterThan(-1);
    expect(limiter).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(limiter);
  });
});

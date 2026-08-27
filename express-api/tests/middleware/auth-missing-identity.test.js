/**
 * A caller the server cannot identify is not an account (SHY-0426).
 *
 * `resolveUniqueId(uid)` answers **null** when no `users` document matches the
 * Firebase uid, and the middleware passed that straight through as though it
 * were an account number. Because `null === null`, every unidentified caller
 * was the same "account" as every other one:
 *
 *   where('userId', '==', uniqueId)   matches every unidentified caller's rows
 *   doc.userId !== uniqueId           false — the write is allowed
 *   support-tickets/${uniqueId}/      one shared folder, support-tickets/null/
 *   checkSuspension(null)             false — not suspended
 *   computeUserBanStanding(null)      false — not banned
 *
 * The last two are the sharpest: an account the server cannot identify is also
 * one it will never see as banned or suspended.
 *
 * **211 uses of `req.auth.uniqueId` across 30 route files, and exactly one
 * checked it was present.** Guarding thirty files is thirty chances to miss
 * one, and thirty more for every route added after, so the refusal happens
 * ONCE, here, and the routes that legitimately run before an identity exists
 * are named — a short list somebody can review.
 *
 * REAL tokens against the Auth emulator, no mocks: `mintTokenWithoutUserDoc`
 * produces precisely the shape under test — a credential that verifies for an
 * account with no `users` document — so there is nothing here worth faking.
 *
 * NODE_ENV='local' is set BEFORE requiring src/utils/firebase so the Admin SDK
 * targets the emulator. PER-FILE opt-in only — never prepend it to `npm test`.
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { mintRealUser, mintTokenWithoutUserDoc, clearAuthCaches } = require('../helpers/real-auth');
const {
  authMiddleware,
  allowsMissingIdentity,
  hasResolvedIdentity,
  PRE_IDENTITY_ROUTES,
} = require('../../src/middleware/auth');

const ID_PREFIX = 'ami-';

/** A probe app wired the way production is: the middleware, then routes. */
function probeApp() {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  router.use(authMiddleware);
  const ok = (req, res) => res.json({ ok: true, uniqueId: req.auth.uniqueId });
  router.post('/users', ok);
  router.post('/users/sign-in', ok);
  router.get('/users/:uniqueId', ok);
  router.get('/support-tickets/mine/open', ok);
  router.post('/support-tickets', ok);
  app.use('/api', router);
  return app;
}

beforeAll(async () => {
  await assertEmulatorReachable();
});

beforeEach(() => {
  clearAuthCaches();
});

afterAll(() => {
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('a request whose account cannot be identified', () => {
  test('is refused on a user-scoped route, with a distinct code', async () => {
    const caller = await mintTokenWithoutUserDoc({});
    const res = await request(probeApp())
      .get('/api/support-tickets/mine/open')
      .set(caller.headers)
      .expect(403);
    expect(res.body).toEqual({
      error: expect.stringMatching(/could not be identified/i),
      code: 'no_identity',
    });
  });

  test('is refused on a WRITE, not merely on a read', async () => {
    const caller = await mintTokenWithoutUserDoc({});
    await request(probeApp())
      .post('/api/support-tickets')
      .set(caller.headers)
      .send({ message: 'hello', category: 'other' })
      .expect(403);
  });

  test('never reaches the handler, so no route can mistake null for an id', async () => {
    const caller = await mintTokenWithoutUserDoc({});
    const res = await request(probeApp())
      .get('/api/users/50000010')
      .set(caller.headers)
      .expect(403);
    expect(res.body.uniqueId).toBeUndefined();
  });

  test('two unidentified callers are not the same account', async () => {
    // The heart of it. Both used to arrive as `uniqueId: null`, and
    // `null === null` made every ownership test between them pass.
    const a = await mintTokenWithoutUserDoc({});
    const b = await mintTokenWithoutUserDoc({});
    expect(a.uid).not.toBe(b.uid);
    for (const caller of [a, b]) {
      await request(probeApp())
        .get('/api/support-tickets/mine/open')
        .set(caller.headers)
        .expect(403);
    }
  });
});

describe('the routes that legitimately have no identity yet', () => {
  test('creating an account still works — there is no identity, by definition', async () => {
    const caller = await mintTokenWithoutUserDoc({});
    const res = await request(probeApp())
      .post('/api/users')
      .set(caller.headers)
      .send({ provider: 'google', identifier: 'new@gmail.com' })
      .expect(200);
    expect(res.body.uniqueId).toBeNull();
  });

  test('signing in still works, because it may be what creates the document', async () => {
    const caller = await mintTokenWithoutUserDoc({});
    await request(probeApp()).post('/api/users/sign-in').set(caller.headers).send({}).expect(200);
  });
});

describe('an identified caller is unaffected', () => {
  test('reaches a user-scoped route exactly as before', async () => {
    const caller = await mintRealUser({ uniqueId: `${ID_PREFIX}90001` });
    const res = await request(probeApp())
      .get('/api/support-tickets/mine/open')
      .set(caller.headers)
      .expect(200);
    expect(res.body.uniqueId).toBe(`${ID_PREFIX}90001`);
  });
});

describe('the allowlist is a ratchet', () => {
  test('it holds exactly these routes, and nothing has been added quietly', () => {
    // The security of this fix IS the shortness of this list. Adding a route
    // must be a deliberate act somebody argued for, not a line that appeared
    // in a diff while making something else work.
    //
    // `standingExempt` is pinned here for the same reason (SHY-0461). It says
    // whether the route REPORTS a standing or ACTS, and the standing gates
    // read it: flipping `POST /users` to true would let a banned handset open
    // a fresh account, which is ban evasion. That flip must trip this ratchet,
    // not pass as a one-word diff.
    expect(PRE_IDENTITY_ROUTES).toEqual([
      { method: 'POST', path: '/users', standingExempt: false },
      { method: 'POST', path: '/users/sign-in', standingExempt: true },
      { method: 'POST', path: '/devices/lock-check', standingExempt: true },
      { method: 'POST', path: '/device-info', standingExempt: true },
      { method: 'GET', path: '/device-info', standingExempt: true },
    ]);
  });

  test('no allowlisted route is a bare prefix of a user-scoped one', () => {
    // `/users` is exempt and `/users/50000010` must not be. Exact matching is
    // what makes that true, and this fails if it ever becomes prefix matching.
    PRE_IDENTITY_ROUTES.forEach(({ method, path }) => {
      expect(allowsMissingIdentity({ method, path: `${path}/50000010` })).toBe(false);
      expect(allowsMissingIdentity({ method, path: `${path}-other` })).toBe(false);
    });
  });

  test('the allowance is per METHOD, not per path', () => {
    expect(allowsMissingIdentity({ method: 'GET', path: '/users' })).toBe(false);
    expect(allowsMissingIdentity({ method: 'DELETE', path: '/users' })).toBe(false);
  });

  test('an unrecognised shape fails closed', () => {
    expect(allowsMissingIdentity({})).toBe(false);
    expect(allowsMissingIdentity(null)).toBe(false);
  });
});

describe('hasResolvedIdentity', () => {
  test('absence is the only thing refused', () => {
    // PRESENCE, not type. The defect is that null collapses every
    // unidentified caller into one account. Insisting on an integer would ALSO
    // change an unrelated contract — this codebase is inconsistent about
    // whether a uniqueId is a number or a string — and would lock out real
    // callers for a reason nobody asked about.
    [null, undefined, '', '   '].forEach((v) => {
      expect({ v, ok: hasResolvedIdentity(v) }).toEqual({ v, ok: false });
    });
  });

  test('both shapes the codebase actually uses are accepted', () => {
    expect(hasResolvedIdentity(50000010)).toBe(true);
    expect(hasResolvedIdentity('50000010')).toBe(true);
  });

  test('a number that is not a number is refused', () => {
    expect(hasResolvedIdentity(NaN)).toBe(false);
    expect(hasResolvedIdentity(Infinity)).toBe(false);
  });
});

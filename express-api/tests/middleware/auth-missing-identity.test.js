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
 * checked it was present.** Guarding thirty files individually is thirty
 * chances to miss one and thirty more for every route added after, so the
 * refusal happens ONCE, here, and the routes that legitimately run before an
 * identity exists are named — a short list somebody can review.
 *
 * Observed on 2026-08-22 against a LOCAL stack whose `users` documents had been
 * wiped by a full Jest run: two personas with a null uniqueId could read each
 * other's support tickets, including a safety report's summary. A real
 * reproduction of the code path, and NOT a production breach — re-seeding
 * restored correct isolation immediately.
 */

const express = require('express');
const request = require('supertest');

const mockVerifyIdToken = jest.fn();
const mockDocGet = jest.fn();
const mockCollectionQuery = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  auth: { verifyIdToken: (...args) => mockVerifyIdToken(...args) },
  db: {
    doc: jest.fn((path) => ({ _path: path, get: () => mockDocGet(path) })),
    collection: jest.fn((collectionPath) => ({
      where: jest.fn((field, op, value) => ({
        limit: jest.fn(() => ({ get: () => mockCollectionQuery(collectionPath, field, value) })),
      })),
    })),
  },
}));
jest.mock('../../src/utils/log', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../src/utils/bans', () => ({
  checkUserBans: async () => ({ isBanned: false, banType: null, reason: null, expiresAt: null }),
  clearBanCache: () => {},
}));

const {
  authMiddleware,
  clearUniqueIdCache,
  allowsMissingIdentity,
  hasResolvedIdentity,
  PRE_IDENTITY_ROUTES,
} = require('../../src/middleware/auth');

beforeEach(() => {
  jest.clearAllMocks();
  if (clearUniqueIdCache) clearUniqueIdCache();
});

function createApp() {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  router.use(authMiddleware);
  const ok = (req, res) => res.json({ success: true, auth: req.auth });
  router.post('/users', ok);
  router.post('/users/sign-in', ok);
  router.get('/users/:uniqueId', ok);
  router.get('/support-tickets/mine/open', ok);
  router.post('/support-tickets', ok);
  app.use('/api', router);
  return app;
}

/** A token that verifies, for an account with no `users` document. */
function unidentifiedCaller() {
  mockVerifyIdToken.mockResolvedValue({ uid: 'uid-with-no-document' });
  mockCollectionQuery.mockResolvedValue({ empty: true, docs: [] });
}

describe('a request whose account cannot be identified', () => {
  test('is refused on a user-scoped route, with a distinct code', async () => {
    unidentifiedCaller();
    const res = await request(createApp())
      .get('/api/support-tickets/mine/open')
      .set('Authorization', 'Bearer valid-token')
      .expect(403);
    expect(res.body).toEqual({
      error: expect.stringMatching(/could not be identified/i),
      code: 'no_identity',
    });
  });

  test('is refused on a WRITE, not merely on a read', async () => {
    unidentifiedCaller();
    await request(createApp())
      .post('/api/support-tickets')
      .set('Authorization', 'Bearer valid-token')
      .send({ message: 'hello', category: 'other' })
      .expect(403);
  });

  test('never reaches the handler, so no route can mistake null for an id', async () => {
    unidentifiedCaller();
    const res = await request(createApp())
      .get('/api/users/50000010')
      .set('Authorization', 'Bearer valid-token')
      .expect(403);
    expect(res.body.auth).toBeUndefined();
  });
});

describe('the routes that legitimately have no identity yet', () => {
  test('creating an account still works — there is no identity, by definition', async () => {
    unidentifiedCaller();
    const res = await request(createApp())
      .post('/api/users')
      .set('Authorization', 'Bearer valid-token')
      .send({ provider: 'google', identifier: 'new@gmail.com' })
      .expect(200);
    expect(res.body.auth.uniqueId).toBeNull();
  });

  test('signing in still works, because it may be what creates the document', async () => {
    unidentifiedCaller();
    await request(createApp())
      .post('/api/users/sign-in')
      .set('Authorization', 'Bearer valid-token')
      .send({})
      .expect(200);
  });
});

describe('an identified caller is unaffected', () => {
  test('reaches every route exactly as before', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'firebase-uid-1' });
    mockCollectionQuery.mockResolvedValue({
      empty: false,
      docs: [
        { id: '50000010', data: () => ({ uniqueId: 50000010, firebaseUid: 'firebase-uid-1' }) },
      ],
    });
    // The middleware also reads the user document for the suspension check.
    mockDocGet.mockImplementation((path) =>
      path === 'users/50000010'
        ? Promise.resolve({ exists: true, data: () => ({ isSuspended: false }) })
        : Promise.resolve({ exists: false }),
    );
    const res = await request(createApp())
      .get('/api/support-tickets/mine/open')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);
    expect(res.body.auth.uniqueId).toBe(50000010);
  });
});

describe('allowsMissingIdentity', () => {
  const req = (method, path) => ({ method, path });

  test('the allowance is per METHOD, not per path', () => {
    // GET /users is a listing. Only the POST that CREATES an account has any
    // reason to run without one.
    expect(allowsMissingIdentity(req('POST', '/users'))).toBe(true);
    expect(allowsMissingIdentity(req('GET', '/users'))).toBe(false);
    expect(allowsMissingIdentity(req('DELETE', '/users'))).toBe(false);
  });

  test('a path that merely starts with an allowed one is not allowed', () => {
    expect(allowsMissingIdentity(req('POST', '/users/50000010/appeal'))).toBe(false);
    expect(allowsMissingIdentity(req('POST', '/users-something-else'))).toBe(false);
  });

  test('an unrecognised shape fails closed', () => {
    expect(allowsMissingIdentity({})).toBe(false);
    expect(allowsMissingIdentity(null)).toBe(false);
  });
});

describe('the allowlist is a ratchet', () => {
  test('it holds exactly these routes, and nothing has been added quietly', () => {
    // The security of this fix IS the shortness of this list. Adding a route
    // must be a deliberate act somebody argued for, not a line that appeared
    // in a diff while making something else work.
    expect(PRE_IDENTITY_ROUTES).toEqual([
      { method: 'POST', path: '/users' },
      { method: 'POST', path: '/users/sign-in' },
      { method: 'POST', path: '/devices/lock-check' },
      { method: 'POST', path: '/device-info' },
      { method: 'GET', path: '/device-info' },
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
});

describe('hasResolvedIdentity', () => {
  test('absence is the only thing refused', () => {
    // PRESENCE, not type. The defect is that null collapses every
    // unidentified caller into one account because null === null. Insisting on
    // an integer would ALSO change an unrelated contract — this codebase is
    // inconsistent about whether a uniqueId is a number or a string — and
    // would lock out real callers for a reason nobody asked about.
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

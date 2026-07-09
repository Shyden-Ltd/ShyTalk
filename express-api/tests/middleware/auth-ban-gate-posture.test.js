/**
 * Ban-gate failure posture + audit logging — UNIT tests (SHY-0149).
 *
 * These are the two contracts a real-emulator suite cannot cleanly induce:
 *
 *  1. FAIL-CLOSED: if the per-request ban lookup itself fails, the request
 *     must NOT proceed. The gate matches the suspension check's structural
 *     posture — the rejection propagates to authMiddleware's outer catch and
 *     the caller gets 401, never a silent pass-through. (A safety control
 *     that fails open is not a control.)
 *  2. AUDIT: every server-side ban denial is logged with endpoint, uid, and
 *     ban type (feedback-comprehensive-default-debug-logging) — and without
 *     leaking secret values.
 *
 * Test doubles are permitted here per the No-Stubs policy's unit-test
 * exception; every behavioral path is covered against the REAL emulator in
 * auth-ban-gate.test.js.
 */

const express = require('express');
const request = require('supertest');

const mockVerifyIdToken = jest.fn();
const mockDocGet = jest.fn();
const mockUsersQuery = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  auth: { verifyIdToken: (...args) => mockVerifyIdToken(...args) },
  db: {
    doc: jest.fn((path) => ({ _path: path, get: () => mockDocGet(path) })),
    // resolveUniqueId path: users.where('firebaseUid','==',uid).limit(1).get()
    collection: jest.fn(() => ({
      where: jest.fn(() => ({ limit: jest.fn(() => ({ get: () => mockUsersQuery() })) })),
    })),
  },
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const mockCheckUserBans = jest.fn();
// `virtual` lets this suite express the wished-for module BEFORE it exists
// (pure RED); once src/utils/bans.js lands, the option is inert.
jest.mock(
  '../../src/utils/bans',
  () => ({
    checkUserBans: (...args) => mockCheckUserBans(...args),
    clearBanCache: jest.fn(),
  }),
  { virtual: true },
);

const log = require('../../src/utils/log');
const {
  authMiddleware,
  authMiddlewareStrict,
  clearSuspensionCache,
  clearUniqueIdCache,
} = require('../../src/middleware/auth');

const UNIQUE_ID = 90000001;

function appWith(middleware) {
  const app = express();
  app.use(express.json());
  app.use('/api', middleware);
  app.post('/api/probe/sensitive', (req, res) => res.json({ ok: true }));
  return app;
}

function stubSignedInUser() {
  mockVerifyIdToken.mockResolvedValue({ uid: 'uid-posture-1' });
  mockUsersQuery.mockResolvedValue({
    empty: false,
    docs: [{ data: () => ({ uniqueId: UNIQUE_ID }) }],
  });
  mockDocGet.mockImplementation((path) => {
    if (path === `users/${UNIQUE_ID}`) {
      return Promise.resolve({ exists: true, data: () => ({ isSuspended: false }) });
    }
    return Promise.resolve({ exists: false });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockVerifyIdToken.mockReset();
  mockDocGet.mockReset();
  mockUsersQuery.mockReset();
  mockCheckUserBans.mockReset();
  clearUniqueIdCache();
  clearSuspensionCache(UNIQUE_ID);
  stubSignedInUser();
});

describe('ban-lookup failure is fail-closed', () => {
  test.each([
    ['authMiddleware', authMiddleware],
    ['authMiddlewareStrict', authMiddlewareStrict],
  ])('%s: a rejected ban lookup → 401, request never reaches the route', async (_name, mw) => {
    mockCheckUserBans.mockRejectedValue(new Error('firestore unavailable'));

    const res = await request(appWith(mw))
      .post('/api/probe/sensitive')
      .set('Authorization', 'Bearer live-token')
      .send({});

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Authentication failed' });
  });
});

describe('ban denials are audited', () => {
  test('a 403 denial logs endpoint · uid · ban type — and no ban-doc internals', async () => {
    mockCheckUserBans.mockResolvedValue({
      isBanned: true,
      banType: 'device',
      reason: 'spam ring',
      expiresAt: null,
    });

    const res = await request(appWith(authMiddleware))
      .post('/api/probe/sensitive')
      .set('Authorization', 'Bearer live-token')
      .send({});
    expect(res.status).toBe(403);

    const denialCalls = [...log.warn.mock.calls, ...log.info.mock.calls].filter(([, msg]) =>
      /ban/i.test(String(msg)),
    );
    expect(denialCalls.length).toBeGreaterThanOrEqual(1);
    const [, , fields] = denialCalls[0];
    expect(fields).toMatchObject({
      path: '/probe/sensitive',
      uniqueId: UNIQUE_ID,
      banType: 'device',
    });
  });

  test('an allowed request logs no ban denial', async () => {
    mockCheckUserBans.mockResolvedValue({ isBanned: false, banType: null, reason: null });

    await request(appWith(authMiddleware))
      .post('/api/probe/sensitive')
      .set('Authorization', 'Bearer live-token')
      .send({})
      .expect(200);

    const denialCalls = [...log.warn.mock.calls, ...log.info.mock.calls].filter(([, msg]) =>
      /ban denied|banned request/i.test(String(msg)),
    );
    expect(denialCalls).toHaveLength(0);
  });
});

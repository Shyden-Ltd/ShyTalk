/**
 * SHY-0097 — POST /api/users/:uniqueId/acknowledge-warning (UNIT test)
 *
 * Unit-level coverage of the acknowledge endpoint's logic + owner guard,
 * using the established mocked-firebase pattern (operator rule, 2026-06-14:
 * "the only thing that can use mocks is the unit tests; everything else
 * should be real, no stubs or fakes"). Mirrors users-same-cohort.test.js.
 *
 * The REAL end-to-end proof for this endpoint is the j11 device journey
 * (real device → real Express → real Firestore emulator), which asserts the
 * `hasActiveWarning` flag actually flips on real hardware. This unit test
 * pins the route's branch logic so a regression is caught fast in the
 * emulator-less backend jest job (test-backend.yml).
 *
 * Auth is injected (req.auth) — the missing-header → 401 path lives in
 * authMiddleware, so it's the middleware's concern, not this endpoint's.
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase + helper mocks (mirror users-same-cohort.test.js) ──────

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: (...args) => mockDocGet(path, ...args),
      update: (...args) => mockDocUpdate(path, ...args),
    })),
  },
  auth: {
    setCustomUserClaims: jest.fn().mockResolvedValue(),
    getUser: jest.fn().mockResolvedValue({ customClaims: {} }),
  },
  FieldValue: {
    increment: jest.fn((n) => `increment(${n})`),
    arrayUnion: jest.fn((...args) => `arrayUnion(${args})`),
    arrayRemove: jest.fn((...args) => `arrayRemove(${args})`),
  },
}));

const FIXED_NOW = 1709913600000;
jest.mock('../../src/utils/helpers', () => ({
  generateId: () => 'gen-id',
  now: () => FIXED_NOW,
}));

jest.mock('../../src/utils/firestore-helpers', () => ({
  getDoc: jest.fn(),
}));

jest.mock('../../src/middleware/auth', () => ({
  clearSuspensionCache: jest.fn(),
  clearUniqueIdCache: jest.fn(),
  updateUniqueIdCache: jest.fn(),
  isLiveAdmin: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/utils/block-check', () => ({
  viewerIsBlocked: jest.fn().mockReturnValue(false),
}));

jest.mock('../../src/utils/email', () => ({ sendEmail: jest.fn() }));
jest.mock('../../src/utils/email-templates', () => ({ buildDeletionScheduledEmail: jest.fn() }));
jest.mock('../../src/utils/fcm', () => ({ sendFcmToTokens: jest.fn() }));

const { getDoc } = require('../../src/utils/firestore-helpers');
const usersRouter = require('../../src/routes/users');

beforeEach(() => {
  jest.clearAllMocks();
  mockDocGet.mockReset();
  mockDocUpdate.mockReset();
  mockDocUpdate.mockResolvedValue();
});

/**
 * Boots a test Express app whose injected middleware sets
 * `req.auth = { uid, uniqueId, token }` — the same shape authMiddleware
 * produces. (The route guards ownership via req.auth.uniqueId.)
 */
function createApp({ uid = 'firebase-uid-A', uniqueId = 99000001 } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid, uniqueId, token: {} };
    next();
  });
  app.use('/api', usersRouter);
  return app;
}

/** Make `getDoc('users/<uniqueId>')` resolve to `data` (else null). */
function mockUserDoc(uniqueId, data) {
  getDoc.mockImplementation((path) =>
    path === `users/${uniqueId}` ? Promise.resolve(data) : Promise.resolve(null),
  );
}

describe('POST /api/users/:uniqueId/acknowledge-warning (unit)', () => {
  test('happy path: clears active warning, sets acknowledged, preserves warningCount', async () => {
    const id = 99000001;
    mockUserDoc(id, {
      uniqueId: id,
      hasActiveWarning: true,
      warningReason: 'Harassment in room',
      hasNewWarning: true,
      warningCount: 2,
    });

    const res = await request(createApp({ uniqueId: id })).post(
      `/api/users/${id}/acknowledge-warning`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    expect(mockDocUpdate).toHaveBeenCalledTimes(1);
    const [path, payload] = mockDocUpdate.mock.calls[0];
    expect(path).toBe(`users/${id}`);
    expect(payload).toMatchObject({
      hasActiveWarning: false,
      // The "new warning" badge is cleared on acknowledge (issuance sets it true).
      hasNewWarning: false,
      warningReason: null,
      warningAcknowledged: true,
      warningAcknowledgedAt: FIXED_NOW,
    });
    // Strike-escalation history MUST survive: warningCount is never written.
    expect(payload).not.toHaveProperty('warningCount');
  });

  test('honours the snake_case has_active_warning fallback', async () => {
    const id = 99000005;
    mockUserDoc(id, { uniqueId: id, has_active_warning: true, warningCount: 1 });

    const res = await request(createApp({ uniqueId: id })).post(
      `/api/users/${id}/acknowledge-warning`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockDocUpdate).toHaveBeenCalledTimes(1);
  });

  test('idempotent: no active warning → 200 alreadyClear, no write', async () => {
    const id = 99000002;
    mockUserDoc(id, { uniqueId: id, hasActiveWarning: false, warningCount: 1 });

    const res = await request(createApp({ uniqueId: id })).post(
      `/api/users/${id}/acknowledge-warning`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, alreadyClear: true });
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('403: cannot acknowledge another user’s warning (owner guard)', async () => {
    // Authed as 99000001, targeting 99000003.
    const res = await request(createApp({ uniqueId: 99000001 })).post(
      '/api/users/99000003/acknowledge-warning',
    );

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Cannot modify another user' });
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('400: non-integer uniqueId param', async () => {
    const res = await request(createApp({ uniqueId: 99000001 })).post(
      '/api/users/not-a-number/acknowledge-warning',
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'uniqueId must be a positive integer' });
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('404: user not found', async () => {
    const id = 99000004;
    getDoc.mockResolvedValue(null);

    const res = await request(createApp({ uniqueId: id })).post(
      `/api/users/${id}/acknowledge-warning`,
    );

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'User not found' });
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('500: surfaces a Firestore failure as Internal server error', async () => {
    const id = 99000001;
    mockUserDoc(id, { uniqueId: id, hasActiveWarning: true, warningCount: 1 });
    mockDocUpdate.mockRejectedValueOnce(new Error('emulator down'));

    const res = await request(createApp({ uniqueId: id })).post(
      `/api/users/${id}/acknowledge-warning`,
    );

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});

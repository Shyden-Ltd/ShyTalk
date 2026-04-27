/* eslint-disable no-unused-vars */
const express = require('express');
const request = require('supertest');

// ─── Firebase mock ────────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();
const mockBatchCommit = jest.fn().mockResolvedValue();
// mockCollectionGet is a mutable reference — the factory closure captures the
// outer variable by reference, and tests reassign it to control collection responses.
// Named with the "mock" prefix so Jest's scope guard allows it inside jest.mock().
let mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: (...args) => mockDocGet(path, ...args),
      update: (...args) => mockDocUpdate(path, ...args),
      set: (...args) => mockDocSet(path, ...args),
      delete: (...args) => mockDocDelete(path, ...args),
    })),
    collection: jest.fn(() => {
      const chain = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        startAfter: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        get: () => mockCollectionGet(),
      };
      return chain;
    }),
    batch: jest.fn(() => ({
      update: jest.fn(),
      set: jest.fn(),
      commit: mockBatchCommit,
    })),
  },
  auth: {
    getUser: jest.fn().mockResolvedValue({
      uid: 'firebase-uid',
      email: 'user@example.com',
      providerData: [],
    }),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'warn-id'),
  now: jest.fn(() => 1709913600000),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/utils/gcs', () => ({
  computeDisplayScore: jest.fn((score) => score),
}));

jest.mock('../../src/utils/system-pm', () => ({
  sendSystemPm: jest.fn().mockResolvedValue(),
}));

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn(() => false), // allow by default
  clearSuspensionCache: jest.fn(),
}));

// firestore-helpers goes through our mockDocGet
jest.mock('../../src/utils/firestore-helpers', () => ({
  getDoc: jest.fn(),
  queryDocs: jest.fn().mockResolvedValue([]),
}));

const { getDoc } = require('../../src/utils/firestore-helpers');
const { requireAdmin } = require('../../src/middleware/auth');

// ─── App setup ───────────────────────────────────────────────────

const adminUsersRouter = require('../../src/routes/admin-users');

function createAdminApp({ uid = 'admin-uid', uniqueId = 'admin-1', isAdmin = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid, uniqueId, token: { admin: isAdmin } };
    next();
  });
  app.use('/api', adminUsersRouter);
  return app;
}

function blockAdmin() {
  requireAdmin.mockImplementation((_req, res) => {
    res.status(403).json({ error: 'Forbidden' });
    return true;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // mockReset drains queues + clears implementations (clearAllMocks does not)
  mockDocGet.mockReset();
  mockDocSet.mockReset();
  mockDocUpdate.mockReset();
  mockDocDelete.mockReset();
  mockBatchCommit.mockReset();
  getDoc.mockReset();
  requireAdmin.mockReset();

  mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });
  mockBatchCommit.mockResolvedValue();
  mockDocSet.mockResolvedValue();
  mockDocUpdate.mockResolvedValue();
  // Default: getDoc returns null (doc not found) unless overridden per test
  getDoc.mockResolvedValue(null);
  requireAdmin.mockReturnValue(false); // allow by default
});

// ─── GET /api/user/:uniqueId ─────────────────────────────────────

// ─── POST /api/user/:uniqueId/warn ───────────────────────────────

// ─── GET /api/user/:uniqueId/warnings ────────────────────────────

// ─── POST /api/user/:id/warnings/:warnId/revoke ──────────────────

// ─── POST /api/user/:uniqueId/reset-gcs ──────────────────────────

// ─── GET /api/user/:uniqueId/stalkers ────────────────────────────

// ─── GET /api/user/:uniqueId — normalizeUser suspended user branches ──

describe('GET /api/user/:uniqueId — normalizeUser for suspended users', () => {
  it('restores pre-suspension display name, profile photo, and cover photo for admin view', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: '10000001',
      data: () => ({
        uniqueId: 10000001,
        displayName: 'Suspended Account',
        profilePhotoUrl: null,
        coverPhotoUrl: null,
        isSuspended: true,
        preSuspensionDisplayName: 'RealName',
        preSuspensionProfilePhotoUrl: 'https://r2.example.com/profiles/10000001/photo.jpg',
        preSuspensionCoverPhotoUrl: 'https://r2.example.com/covers/10000001/cover.jpg',
        gcsScore: 0,
        gcsLastDeductionAt: null,
        email: 'suspended@example.com',
        firebaseUid: 'uid-suspended',
      }),
    });

    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000001');
    expect(res.status).toBe(200);
    // Admin sees real name, not "Suspended Account"
    expect(res.body.displayName).toBe('RealName');
    expect(res.body.profilePhotoUrl).toBe('https://r2.example.com/profiles/10000001/photo.jpg');
    expect(res.body.coverPhotoUrl).toBe('https://r2.example.com/covers/10000001/cover.jpg');
    expect(res.body._preSuspension).toEqual({
      displayName: 'RealName',
      profilePhotoUrl: 'https://r2.example.com/profiles/10000001/photo.jpg',
      coverPhotoUrl: 'https://r2.example.com/covers/10000001/cover.jpg',
    });
  });

  it('handles suspended user with only partial pre-suspension data', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: '10000002',
      data: () => ({
        uniqueId: 10000002,
        displayName: 'Suspended Account',
        profilePhotoUrl: null,
        coverPhotoUrl: null,
        isSuspended: true,
        preSuspensionDisplayName: 'PartialUser',
        // no preSuspensionProfilePhotoUrl or preSuspensionCoverPhotoUrl
        gcsScore: 50,
        gcsLastDeductionAt: null,
        email: 'partial@example.com',
        firebaseUid: 'uid-partial',
      }),
    });

    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000002');
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('PartialUser');
    expect(res.body._preSuspension).toEqual({
      displayName: 'PartialUser',
      profilePhotoUrl: null,
      coverPhotoUrl: null,
    });
  });
});

// ─── GET /api/user/:uniqueId — backfillAuthInfo branch ──

// ─── GET /api/user/:uniqueId — 500 error branch ──

// ─── GET /api/user/:uid/auth-debug ──────────────────────────────────

// ─── PATCH /api/user/:uniqueId — additional branches ────────────────

// ─── POST /api/user/:uniqueId/notify-changes ────────────────────────

// ─── POST /api/user/:uniqueId/warn — additional branches ────────────

// ─── GET /api/user/:uniqueId/warnings — startAfter branch ──────────

// ─── POST /api/user/:uniqueId/warnings/:id/revoke — error branches ─

// ─── POST /api/user/:uniqueId/reset-gcs — error branch ─────────────

// ─── GET /api/user/:uniqueId/stalkers — error branch ────────────────

// ─── GET /api/conversations/:id/messages ────────────────────────────

// ─── GET /api/search/uniqueId/:id ───────────────────────────────────

// ─── POST /api/resolve/uids-to-uniqueIds ────────────────────────────

// ─── POST /api/resolve/uniqueIds-to-uids ────────────────────────────

// ─── POST /api/report-locks/:uniqueId/lock ──────────────────────────

// ─── DELETE /api/report-locks/:uniqueId ─────────────────────────────

// ─── GET /api/user/:uniqueId/auth-status ────────────────────────────

// ─── POST /api/user/:uniqueId/reset-pin-lockout ────────────────────

// ─── DELETE /api/user/:uniqueId/biometric-keys/:deviceId ────────────

// ─── GET /api/metrics/otp ───────────────────────────────────────────

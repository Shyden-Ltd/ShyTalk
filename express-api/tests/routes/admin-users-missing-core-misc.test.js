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

describe('GET /api/user/:uniqueId', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000001');
    expect(res.status).toBe(403);
  });

  it('returns 404 when user does not exist', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: false });
    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000001');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 200 with enriched user profile for admin', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: '10000001',
      data: () => ({
        uniqueId: 10000001,
        displayName: 'Alice',
        gcsScore: 90,
        gcsLastDeductionAt: null,
        email: 'alice@example.com',
        firebaseUid: 'uid-alice',
      }),
    });

    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000001');
    expect(res.status).toBe(200);
    expect(res.body.uniqueId).toBe(10000001);
    expect(res.body.displayName).toBe('Alice');
    expect(res.body.gcsDisplayScore).toBeDefined();
  });

  it('uses trusted snap.id (not payload id) when user doc data contains an attacker-controlled id field', async () => {
    // Adversarial: the doc's REAL id is '10000001', but data() injects an `id`
    // field that an attacker would have written to the user doc. With the
    // unsafe spread order `{ id: snap.id, ...snap.data() }` the payload id
    // overrides the trusted doc id; with the safe order
    // `{ ...snap.data(), id: snap.id }` the trusted doc.id wins.
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      id: '10000001',
      data: () => ({
        id: '99999999-rogue-id',
        uniqueId: 10000001,
        displayName: 'Alice',
        gcsScore: 90,
        email: 'alice@example.com',
        firebaseUid: 'uid-alice',
      }),
    });

    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000001');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('10000001');
  });
});

// ─── POST /api/user/:uniqueId/warn ───────────────────────────────

// ─── GET /api/user/:uniqueId/warnings ────────────────────────────

// ─── POST /api/user/:id/warnings/:warnId/revoke ──────────────────

// ─── POST /api/user/:uniqueId/reset-gcs ──────────────────────────

// ─── GET /api/user/:uniqueId/stalkers ────────────────────────────

// ─── GET /api/user/:uniqueId — normalizeUser suspended user branches ──

// ─── GET /api/user/:uniqueId — backfillAuthInfo branch ──

// ─── GET /api/user/:uniqueId — 500 error branch ──

describe('GET /api/user/:uniqueId — error handling', () => {
  it('returns 500 when Firestore throws', async () => {
    mockDocGet.mockRejectedValueOnce(new Error('Firestore connection failed'));

    const app = createAdminApp();
    const res = await request(app).get('/api/user/10000001');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/i);
  });
});

// ─── GET /api/user/:uid/auth-debug ──────────────────────────────────

// ─── PATCH /api/user/:uniqueId — additional branches ────────────────

describe('PATCH /api/user/:uniqueId — additional branches', () => {
  it('returns 400 when string field exceeds max length', async () => {
    const app = createAdminApp();
    const res = await request(app)
      .patch('/api/user/10000001')
      .send({ displayName: 'A'.repeat(21) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/displayName.*20/);
  });

  it('returns 400 when array field is not an array', async () => {
    const app = createAdminApp();
    const res = await request(app)
      .patch('/api/user/10000001')
      .send({ blockedUserIds: 'not-an-array' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/blockedUserIds.*array/i);
  });

  it('accepts snake_case field names and converts to camelCase', async () => {
    const app = createAdminApp();
    const res = await request(app).patch('/api/user/10000001').send({ display_name: 'SnakeName' });
    expect(res.status).toBe(200);
    expect(res.body.updatedFields).toContain('displayName');
  });

  it('returns 500 when db.doc().update throws', async () => {
    mockDocUpdate.mockRejectedValueOnce(new Error('Firestore write failed'));

    const app = createAdminApp();
    const res = await request(app).patch('/api/user/10000001').send({ displayName: 'Valid' });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/i);
  });

  it('skips PMs when ?silent=true', async () => {
    const { sendSystemPm } = require('../../src/utils/system-pm');

    const app = createAdminApp();
    const res = await request(app)
      .patch('/api/user/10000001?silent=true')
      .send({ displayName: 'SilentUpdate' });
    expect(res.status).toBe(200);
    expect(sendSystemPm).not.toHaveBeenCalled();
  });
});

// ─── POST /api/user/:uniqueId/notify-changes ────────────────────────

// ─── POST /api/user/:uniqueId/warn — additional branches ────────────

// ─── GET /api/user/:uniqueId/warnings — startAfter branch ──────────

// ─── POST /api/user/:uniqueId/warnings/:id/revoke — error branches ─

// ─── POST /api/user/:uniqueId/reset-gcs — error branch ─────────────

// ─── GET /api/user/:uniqueId/stalkers — error branch ────────────────

// ─── GET /api/conversations/:id/messages ────────────────────────────

describe('GET /api/conversations/:id/messages', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createAdminApp();
    const res = await request(app).get('/api/conversations/conv-1/messages');
    expect(res.status).toBe(403);
  });

  it('returns 200 with messages in chronological order', async () => {
    mockCollectionGet = jest.fn().mockResolvedValue({
      docs: [
        { id: 'msg-2', data: () => ({ text: 'Second', createdAt: 200 }) },
        { id: 'msg-1', data: () => ({ text: 'First', createdAt: 100 }) },
      ],
    });

    const app = createAdminApp();
    const res = await request(app).get('/api/conversations/conv-1/messages');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // Reversed from desc order -> chronological
    expect(res.body[0].text).toBe('First');
    expect(res.body[1].text).toBe('Second');
  });

  it('returns 500 on Firestore error', async () => {
    mockCollectionGet = jest.fn().mockRejectedValue(new Error('Messages query failed'));

    const app = createAdminApp();
    const res = await request(app).get('/api/conversations/conv-1/messages');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/i);
  });
});

// ─── GET /api/search/uniqueId/:id ───────────────────────────────────

describe('GET /api/search/uniqueId/:id', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createAdminApp();
    const res = await request(app).get('/api/search/uniqueId/10000001');
    expect(res.status).toBe(403);
  });

  it('returns user when found by uniqueId', async () => {
    mockCollectionGet = jest.fn().mockResolvedValue({
      empty: false,
      docs: [
        {
          id: '10000001',
          data: () => ({
            uniqueId: 10000001,
            displayName: 'SearchUser',
            gcsScore: 100,
            gcsLastDeductionAt: null,
            email: 'search@example.com',
            firebaseUid: 'uid-search',
          }),
        },
      ],
    });

    const app = createAdminApp();
    const res = await request(app).get('/api/search/uniqueId/10000001');
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('SearchUser');
  });

  it('falls back to tempUniqueId when uniqueId search is empty', async () => {
    // First call: uniqueId search returns empty
    // Second call: tempUniqueId search returns a result
    mockCollectionGet = jest
      .fn()
      .mockResolvedValueOnce({ empty: true, docs: [] })
      .mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            id: '10000099',
            data: () => ({
              uniqueId: null,
              tempUniqueId: 10000099,
              displayName: 'TempUser',
              gcsScore: 100,
              gcsLastDeductionAt: null,
              email: 'temp@example.com',
              firebaseUid: 'uid-temp',
            }),
          },
        ],
      });

    const app = createAdminApp();
    const res = await request(app).get('/api/search/uniqueId/10000099');
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('TempUser');
  });

  it('returns 404 when neither uniqueId nor tempUniqueId match', async () => {
    mockCollectionGet = jest
      .fn()
      .mockResolvedValueOnce({ empty: true, docs: [] })
      .mockResolvedValueOnce({ empty: true, docs: [] });

    const app = createAdminApp();
    const res = await request(app).get('/api/search/uniqueId/99999999');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 500 on error', async () => {
    mockCollectionGet = jest.fn().mockRejectedValue(new Error('Search failed'));

    const app = createAdminApp();
    const res = await request(app).get('/api/search/uniqueId/10000001');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/i);
  });
});

// ─── POST /api/resolve/uids-to-uniqueIds ────────────────────────────

describe('POST /api/resolve/uids-to-uniqueIds', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/resolve/uids-to-uniqueIds')
      .send({ uids: ['uid-1'] });
    expect(res.status).toBe(403);
  });

  it('returns empty object when uids array is empty', async () => {
    const app = createAdminApp();
    const res = await request(app).post('/api/resolve/uids-to-uniqueIds').send({ uids: [] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it('resolves UIDs to uniqueIds and display names', async () => {
    mockDocGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ uniqueId: 10000001, displayName: 'Alice' }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ uniqueId: 10000002, displayName: 'Bob' }),
      });

    const app = createAdminApp();
    const res = await request(app)
      .post('/api/resolve/uids-to-uniqueIds')
      .send({ uids: ['uid-alice', 'uid-bob'] });
    expect(res.status).toBe(200);
    expect(res.body.mapping['uid-alice']).toEqual({
      uniqueId: 10000001,
      displayName: 'Alice',
    });
    expect(res.body.mapping['uid-bob']).toEqual({
      uniqueId: 10000002,
      displayName: 'Bob',
    });
  });

  it('skips non-existent UIDs', async () => {
    mockDocGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ uniqueId: 10000001, displayName: 'Alice' }),
      })
      .mockResolvedValueOnce({ exists: false });

    const app = createAdminApp();
    const res = await request(app)
      .post('/api/resolve/uids-to-uniqueIds')
      .send({ uids: ['uid-alice', 'uid-ghost'] });
    expect(res.status).toBe(200);
    expect(res.body.mapping['uid-alice']).toBeDefined();
    expect(res.body.mapping['uid-ghost']).toBeUndefined();
  });

  it('returns 500 on error', async () => {
    mockDocGet.mockRejectedValueOnce(new Error('Firestore read failed'));

    const app = createAdminApp();
    const res = await request(app)
      .post('/api/resolve/uids-to-uniqueIds')
      .send({ uids: ['uid-1'] });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/i);
  });
});

// ─── POST /api/resolve/uniqueIds-to-uids ────────────────────────────

describe('POST /api/resolve/uniqueIds-to-uids', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/resolve/uniqueIds-to-uids')
      .send({ uniqueIds: [10000001] });
    expect(res.status).toBe(403);
  });

  it('returns empty object when uniqueIds array is empty', async () => {
    const app = createAdminApp();
    const res = await request(app).post('/api/resolve/uniqueIds-to-uids').send({ uniqueIds: [] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it('resolves uniqueIds to UIDs', async () => {
    mockCollectionGet = jest
      .fn()
      .mockResolvedValueOnce({
        empty: false,
        docs: [{ id: '10000001', data: () => ({ uid: 'uid-alice' }) }],
      })
      .mockResolvedValueOnce({
        empty: false,
        docs: [{ id: '10000002', data: () => ({ uid: 'uid-bob' }) }],
      });

    const app = createAdminApp();
    const res = await request(app)
      .post('/api/resolve/uniqueIds-to-uids')
      .send({ uniqueIds: [10000001, 10000002] });
    expect(res.status).toBe(200);
    expect(res.body.mapping[10000001]).toBe('uid-alice');
    expect(res.body.mapping[10000002]).toBe('uid-bob');
  });

  it('uses doc.id as fallback when uid field is missing', async () => {
    mockCollectionGet = jest.fn().mockResolvedValueOnce({
      empty: false,
      docs: [{ id: 'doc-id-fallback', data: () => ({}) }],
    });

    const app = createAdminApp();
    const res = await request(app)
      .post('/api/resolve/uniqueIds-to-uids')
      .send({ uniqueIds: [10000001] });
    expect(res.status).toBe(200);
    expect(res.body.mapping[10000001]).toBe('doc-id-fallback');
  });

  it('skips unresolvable uniqueIds', async () => {
    mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });

    const app = createAdminApp();
    const res = await request(app)
      .post('/api/resolve/uniqueIds-to-uids')
      .send({ uniqueIds: [99999999] });
    expect(res.status).toBe(200);
    expect(res.body.mapping[99999999]).toBeUndefined();
  });

  it('returns 500 on error', async () => {
    mockCollectionGet = jest.fn().mockRejectedValue(new Error('Query failed'));

    const app = createAdminApp();
    const res = await request(app)
      .post('/api/resolve/uniqueIds-to-uids')
      .send({ uniqueIds: [10000001] });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/i);
  });
});

// ─── POST /api/report-locks/:uniqueId/lock ──────────────────────────

describe('POST /api/report-locks/:uniqueId/lock', () => {
  it('returns 403 for non-admin', async () => {
    blockAdmin();
    const app = createAdminApp();
    const res = await request(app).post('/api/report-locks/10000001/lock');
    expect(res.status).toBe(403);
  });

  it('creates a report lock with admin display name', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ displayName: 'AdminUser' }),
    });

    const app = createAdminApp();
    const res = await request(app).post('/api/report-locks/10000001/lock');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.displayName).toBe('AdminUser');
    expect(mockDocSet).toHaveBeenCalledWith(
      'reportLocks/10000001',
      expect.objectContaining({
        reportId: '10000001',
        lockedBy: 'admin-uid',
        displayName: 'AdminUser',
      }),
    );
  });

  it('handles missing admin doc gracefully', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: false, data: () => null });

    const app = createAdminApp();
    const res = await request(app).post('/api/report-locks/10000001/lock');
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBeNull();
  });

  it('returns 500 on error', async () => {
    mockDocGet.mockRejectedValueOnce(new Error('Firestore read failed'));

    const app = createAdminApp();
    const res = await request(app).post('/api/report-locks/10000001/lock');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/i);
  });
});

// ─── DELETE /api/report-locks/:uniqueId ─────────────────────────────

// ─── GET /api/user/:uniqueId/auth-status ────────────────────────────

// ─── POST /api/user/:uniqueId/reset-pin-lockout ────────────────────

// ─── DELETE /api/user/:uniqueId/biometric-keys/:deviceId ────────────

// ─── GET /api/metrics/otp ───────────────────────────────────────────

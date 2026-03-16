const express = require('express');
const request = require('supertest');

// ─── Firebase mock (path-aware) ─────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockBatchSet = jest.fn();
const mockBatchUpdate = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();
const mockTransactionGet = jest.fn();
const mockTransactionSet = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: (...args) => mockDocGet(path, ...args),
      set: (...args) => mockDocSet(path, ...args),
      update: (...args) => mockDocUpdate(path, ...args),
    })),
    batch: jest.fn(() => ({
      set: mockBatchSet,
      update: mockBatchUpdate,
      commit: mockBatchCommit,
    })),
    runTransaction: jest.fn(async (fn) => {
      return fn({
        get: (ref) => mockTransactionGet(ref._path),
        set: (ref, ...args) => mockTransactionSet(ref._path, ...args),
      });
    }),
  },
  auth: {
    setCustomUserClaims: jest.fn().mockResolvedValue(),
  },
  FieldValue: {
    increment: jest.fn((n) => `increment(${n})`),
    arrayUnion: jest.fn((...args) => `arrayUnion(${args})`),
    arrayRemove: jest.fn((...args) => `arrayRemove(${args})`),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: () => 'gen-id',
  now: () => 1709913600000,
}));

jest.mock('../../src/utils/firestore-helpers', () => ({
  getDoc: jest.fn(),
}));

jest.mock('../../src/middleware/auth', () => ({
  clearSuspensionCache: jest.fn(),
  clearUniqueIdCache: jest.fn(),
  updateUniqueIdCache: jest.fn(),
}));

const { getDoc } = require('../../src/utils/firestore-helpers');

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── App setup ───────────────────────────────────────────────────

const usersRouter = require('../../src/routes/users');

/**
 * Creates a test app with injected auth.
 * @param {string} uid - Firebase UID
 * @param {number|null} uniqueId - Resolved uniqueId
 */
function createApp(uid = 'firebase-uid-A', uniqueId = 10000001) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid, uniqueId, token: {} };
    next();
  });
  app.use('/api', usersRouter);
  return app;
}

// ─── POST /api/users (identity-based creation) ──────────────────

describe('POST /api/users', () => {
  test('creates new user with identity system', async () => {
    mockTransactionGet.mockResolvedValue({ exists: false });

    const app = createApp('new-user-uid', null);
    const res = await request(app)
      .post('/api/users')
      .send({ provider: 'google', identifier: 'alice@gmail.com', displayName: 'Alice' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.created).toBe(true);
    expect(res.body.uniqueId).toBeGreaterThanOrEqual(10000000);
  });

  test('rejects missing provider', async () => {
    const app = createApp('new-user-uid', null);
    await request(app).post('/api/users').send({ identifier: 'alice@gmail.com' }).expect(400);
  });

  test('rejects missing identifier', async () => {
    const app = createApp('new-user-uid', null);
    await request(app).post('/api/users').send({ provider: 'google' }).expect(400);
  });
});

// ─── PATCH /api/users/:uniqueId ─────────────────────────────────

describe('PATCH /api/users/:uniqueId', () => {
  test('accepts description and nationality (not bio/country)', async () => {
    const app = createApp('firebase-uid-A', 10000001);

    await request(app)
      .patch('/api/users/10000001')
      .send({ description: 'Hello!', nationality: 'US' })
      .expect(200);

    const updateCall = mockDocUpdate.mock.calls[0];
    const path = updateCall[0];
    const updates = updateCall[1];
    expect(path).toBe('users/10000001');
    expect(updates.description).toBe('Hello!');
    expect(updates.nationality).toBe('US');
  });

  test('rejects bio and country fields (old names stripped, returns 400 with no valid fields)', async () => {
    const app = createApp('firebase-uid-A', 10000001);
    await request(app)
      .patch('/api/users/10000001')
      .send({ bio: 'Hello!', country: 'US' })
      .expect(400);
  });

  test('rejects updating another user', async () => {
    const app = createApp('firebase-uid-A', 10000001);
    await request(app).patch('/api/users/10000099').send({ displayName: 'Hacked' }).expect(403);
  });
});

// ─── POST /api/users/:uniqueId/record-visit (stalkers) ─────────

describe('POST /api/users/:uniqueId/record-visit', () => {
  test('skips self-visits', async () => {
    const app = createApp('firebase-uid-A', 10000001);
    const res = await request(app)
      .post('/api/users/10000001/record-visit')
      .send({ visitorId: '10000001' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mockDocUpdate.mock.calls.length).toBe(0);
  });

  test('creates new stalker doc with lastVisitedAt field', async () => {
    getDoc.mockResolvedValue(null); // new visitor
    const app = createApp('firebase-uid-visitor', 10000002);

    await request(app)
      .post('/api/users/10000099/record-visit')
      .send({ visitorId: '10000002' })
      .expect(200);

    expect(mockBatchSet).toHaveBeenCalled();
    const setCall = mockBatchSet.mock.calls[0];
    const stalkerData = setCall[1];
    expect(stalkerData.visitorId).toBe('10000002');
    expect(stalkerData.lastVisitedAt).toBe(1709913600000);
    expect(stalkerData.firstVisitedAt).toBe(1709913600000);
    expect(stalkerData.visitCount).toBe(1);
    expect(stalkerData.visitedAt).toBeUndefined();
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  test('updates existing stalker with lastVisitedAt', async () => {
    getDoc.mockResolvedValue({ visitorId: '10000002', visitCount: 3 });
    const app = createApp('firebase-uid-visitor', 10000002);

    await request(app)
      .post('/api/users/10000099/record-visit')
      .send({ visitorId: '10000002' })
      .expect(200);

    expect(mockBatchUpdate).toHaveBeenCalled();
    const updateCall = mockBatchUpdate.mock.calls[0];
    const updates = updateCall[1];
    expect(updates.lastVisitedAt).toBe(1709913600000);
    expect(updates.visitCount).toBe(4);
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  test('rejects missing visitorId', async () => {
    const app = createApp('firebase-uid-visitor', 10000002);
    await request(app).post('/api/users/10000099/record-visit').send({}).expect(400);
  });

  test('rejects impersonation (visitorId must match auth uniqueId)', async () => {
    const app = createApp('firebase-uid-A', 10000001);
    await request(app)
      .post('/api/users/10000099/record-visit')
      .send({ visitorId: '10000999' })
      .expect(403);
  });
});

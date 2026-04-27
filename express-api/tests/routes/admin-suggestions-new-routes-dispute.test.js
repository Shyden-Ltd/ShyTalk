/* eslint-disable no-unused-vars */
/**
 * Tests for new admin suggestion routes.
 *
 * Covers:
 *   PATCH  /admin/suggestions/:id              — edit title/description/tags
 *   POST   /admin/suggestions/:id/dispute      — file a dispute (admin)
 *   POST   /admin/suggestions/:id/dispute/uphold — resolve dispute
 *   GET    /admin/suggestions/:id              — get single suggestion
 *   POST   /admin/suggestions/:id/approve      — transition to accepted
 *   POST   /admin/suggestions/:id/reject       — transition to rejected (truncate reason)
 *   POST   /admin/suggestions/:id/overturn     — reverse a decision
 *   POST   /admin/suggestions/:id/status       — POST alias for PUT
 *   POST   /admin/suggestions/:id/add-votes    — bump vote count
 *   GET    /admin/suggestions/:id/history      — audit log timeline
 *   GET    /admin/notifications                — list notifications with filters
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock ──────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();

const mockCollectionAdd = jest.fn().mockResolvedValue({ id: 'new-id' });
const mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [], size: 0 });

const mockWhere = jest.fn();
const mockOrderBy = jest.fn();
const mockLimit = jest.fn();

const mockQueryChain = {
  where: (...args) => {
    mockWhere(...args);
    return mockQueryChain;
  },
  orderBy: (...args) => {
    mockOrderBy(...args);
    return mockQueryChain;
  },
  limit: (...args) => {
    mockLimit(...args);
    return mockQueryChain;
  },
  get: () => mockCollectionGet(),
};

const mockRunTransaction = jest.fn(async (fn) => {
  const t = { get: mockDocGet, set: mockDocSet, update: mockDocUpdate, delete: mockDocDelete };
  return fn(t);
});

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: () => mockDocGet(path),
      set: (...args) => mockDocSet(path, ...args),
      update: (...args) => mockDocUpdate(path, ...args),
      delete: () => mockDocDelete(path),
    })),
    collection: jest.fn((name) => ({
      _name: name,
      add: (...args) => mockCollectionAdd(name, ...args),
      doc: jest.fn((id) => ({
        _path: `${name}/${id}`,
        get: () => mockDocGet(`${name}/${id}`),
        set: (...args) => mockDocSet(`${name}/${id}`, ...args),
        update: (...args) => mockDocUpdate(`${name}/${id}`, ...args),
        delete: () => mockDocDelete(`${name}/${id}`),
      })),
      where: (...args) => {
        mockWhere(...args);
        return mockQueryChain;
      },
      orderBy: (...args) => {
        mockOrderBy(...args);
        return mockQueryChain;
      },
      get: () => mockCollectionGet(),
    })),
    runTransaction: mockRunTransaction,
  },
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
    arrayUnion: jest.fn((...args) => ({ _type: 'arrayUnion', values: args })),
    arrayRemove: jest.fn((...args) => ({ _type: 'arrayRemove', values: args })),
    increment: jest.fn((n) => ({ _type: 'increment', value: n })),
    delete: jest.fn(() => ({ _type: 'delete' })),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'mock-id-123'),
  now: jest.fn(() => 1709913600000),
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/utils/system-pm', () => ({
  sendSystemPm: jest.fn().mockResolvedValue(),
}));

jest.mock('../../src/utils/fcm', () => ({
  sendFcmToTokens: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/utils/roadmap-notify', () => ({
  notifyRoadmapSubscribers: jest.fn().mockResolvedValue(),
}));

// ─── App setup ──────────────────────────────────────────────────

const suggestionsRouter = require('../../src/routes/suggestions');

function createAdminApp({ uniqueId = 'admin-1' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: `firebase-uid-${uniqueId}`, uniqueId, token: { admin: true } };
    next();
  });
  app.use('/api', suggestionsRouter);
  return app;
}

function createNonAdminApp({ uniqueId = 1001 } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: `firebase-uid-${uniqueId}`, uniqueId, token: { admin: false } };
    next();
  });
  app.use('/api', suggestionsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDocGet.mockReset();
  mockCollectionGet.mockReset();
  mockRunTransaction.mockReset();
  mockRunTransaction.mockImplementation(async (fn) => {
    const t = { get: mockDocGet, set: mockDocSet, update: mockDocUpdate, delete: mockDocDelete };
    return fn(t);
  });
  mockDocGet.mockResolvedValue({ exists: false });
  mockCollectionGet.mockResolvedValue({ empty: true, docs: [], size: 0 });
});

// ─── Helpers ────────────────────────────────────────────────────

function makeSuggestionSnap(id, overrides = {}) {
  return {
    id,
    exists: true,
    data: () => ({
      title: 'Test suggestion',
      description: 'A test description that is valid',
      tags: ['quality-of-life'],
      language: 'en',
      status: 'pending',
      rejectReason: null,
      linkedRoadmapFeature: null,
      mergedIntoSuggestionId: null,
      disputePending: false,
      submitterUid: 1001,
      submitterContactOptIn: false,
      upvotes: 5,
      downvotes: 1,
      createdAt: 1709913600000,
      updatedAt: 1709913600000,
      reviewedAt: null,
      reviewedBy: null,
      completedAt: null,
      editHistory: [],
      subscribers: [1001],
      votingLocked: false,
      commentsLocked: false,
      ...overrides,
    }),
  };
}

function setupDocMock(pathMap) {
  mockDocGet.mockImplementation((path) => {
    for (const [pattern, snap] of Object.entries(pathMap)) {
      if (typeof path === 'string' && path.includes(pattern)) {
        return Promise.resolve(snap);
      }
    }
    return Promise.resolve({ exists: false });
  });
}

// ═══════════════════════════════════════════════════════════════
// PATCH /admin/suggestions/:id — edit fields
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// POST /admin/suggestions/:id/dispute — file dispute
// ═══════════════════════════════════════════════════════════════

describe('POST /admin/suggestions/:id/dispute', () => {
  test('admin can file a dispute with reason (200)', async () => {
    setupDocMock({ 'suggestions/sug-1': makeSuggestionSnap('sug-1') });
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/suggestions/sug-1/dispute')
      .send({ reason: 'This was incorrectly merged' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockDocUpdate).toHaveBeenCalled();
  });

  test('admin can file a dispute without reason (200)', async () => {
    setupDocMock({ 'suggestions/sug-1': makeSuggestionSnap('sug-1') });
    const app = createAdminApp();
    const res = await request(app).post('/api/admin/suggestions/sug-1/dispute').send({});

    expect(res.status).toBe(200);
  });

  test('non-admin receives 403', async () => {
    const app = createNonAdminApp();
    const res = await request(app)
      .post('/api/admin/suggestions/sug-1/dispute')
      .send({ reason: 'Test' });

    expect(res.status).toBe(403);
  });

  test('returns 404 when suggestion not found', async () => {
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/suggestions/nonexistent/dispute')
      .send({ reason: 'Test' });

    expect(res.status).toBe(404);
  });

  test('returns 409 when dispute already resolved', async () => {
    setupDocMock({
      'suggestions/sug-1': makeSuggestionSnap('sug-1', { disputeStatus: 'resolved' }),
    });
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/suggestions/sug-1/dispute')
      .send({ reason: 'Test' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already resolved/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /admin/suggestions/:id/dispute/uphold — resolve dispute
// ═══════════════════════════════════════════════════════════════

describe('POST /admin/suggestions/:id/dispute/uphold', () => {
  test('admin can uphold a dispute (200)', async () => {
    setupDocMock({ 'suggestions/sug-1': makeSuggestionSnap('sug-1') });
    const app = createAdminApp();
    const res = await request(app).post('/api/admin/suggestions/sug-1/dispute/uphold').send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      'suggestions/sug-1',
      expect.objectContaining({
        disputeStatus: 'resolved',
        disputeResolution: 'upheld',
      }),
    );
  });

  test('non-admin receives 403', async () => {
    const app = createNonAdminApp();
    const res = await request(app).post('/api/admin/suggestions/sug-1/dispute/uphold').send({});

    expect(res.status).toBe(403);
  });

  test('returns 404 when suggestion not found', async () => {
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/suggestions/nonexistent/dispute/uphold')
      .send({});

    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /admin/suggestions/:id — get single suggestion
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// POST /admin/suggestions/:id/approve — approve pending
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// POST /admin/suggestions/:id/reject — reject pending
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// POST /admin/suggestions/:id/overturn — reverse a decision
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// POST /admin/suggestions/:id/status — POST alias for PUT
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// POST /admin/suggestions/:id/add-votes — bump vote count
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// GET /admin/suggestions/:id/history — audit log timeline
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// GET /admin/notifications — list notifications with filters
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// 500 error paths for new suggestion routes
// ═══════════════════════════════════════════════════════════════

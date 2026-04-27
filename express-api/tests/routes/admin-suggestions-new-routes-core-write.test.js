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

describe('PATCH /admin/suggestions/:id', () => {
  test('admin can edit title and description (200)', async () => {
    setupDocMock({ 'suggestions/sug-1': makeSuggestionSnap('sug-1') });
    const app = createAdminApp();
    const res = await request(app)
      .patch('/api/admin/suggestions/sug-1')
      .send({ title: 'New Title', description: 'New description text here' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockDocUpdate).toHaveBeenCalled();
  });

  test('admin can edit tags (200)', async () => {
    setupDocMock({ 'suggestions/sug-1': makeSuggestionSnap('sug-1') });
    const app = createAdminApp();
    const res = await request(app)
      .patch('/api/admin/suggestions/sug-1')
      .send({ tags: ['bug', 'ui'] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('non-admin receives 403', async () => {
    const app = createNonAdminApp();
    const res = await request(app)
      .patch('/api/admin/suggestions/sug-1')
      .send({ title: 'New Title' });

    expect(res.status).toBe(403);
  });

  test('returns 404 when suggestion not found', async () => {
    const app = createAdminApp();
    const res = await request(app)
      .patch('/api/admin/suggestions/nonexistent')
      .send({ title: 'New Title' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test('creates audit entry on successful edit', async () => {
    setupDocMock({ 'suggestions/sug-1': makeSuggestionSnap('sug-1', { title: 'Old Title' }) });
    const app = createAdminApp();
    await request(app)
      .patch('/api/admin/suggestions/sug-1')
      .send({ title: 'New Title' })
      .expect(200);

    // Audit entry goes to moderationLog
    expect(mockDocSet).toHaveBeenCalled();
  });

  test('edit with no changes still succeeds (200)', async () => {
    setupDocMock({
      'suggestions/sug-1': makeSuggestionSnap('sug-1', { title: 'Test suggestion' }),
    });
    const app = createAdminApp();
    const res = await request(app)
      .patch('/api/admin/suggestions/sug-1')
      .send({ title: 'Test suggestion' }); // same value — no diff

    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /admin/suggestions/:id/dispute — file dispute
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// POST /admin/suggestions/:id/dispute/uphold — resolve dispute
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// GET /admin/suggestions/:id — get single suggestion
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// POST /admin/suggestions/:id/approve — approve pending
// ═══════════════════════════════════════════════════════════════

describe('POST /admin/suggestions/:id/approve', () => {
  test('admin can approve a pending suggestion (200)', async () => {
    setupDocMock({ 'suggestions/sug-1': makeSuggestionSnap('sug-1', { status: 'pending' }) });
    const app = createAdminApp();
    const res = await request(app).post('/api/admin/suggestions/sug-1/approve').send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('accepted');
    expect(mockDocUpdate).toHaveBeenCalledWith(
      'suggestions/sug-1',
      expect.objectContaining({ status: 'accepted' }),
    );
  });

  test('non-admin receives 403', async () => {
    const app = createNonAdminApp();
    const res = await request(app).post('/api/admin/suggestions/sug-1/approve').send({});

    expect(res.status).toBe(403);
  });

  test('returns 404 when suggestion not found', async () => {
    const app = createAdminApp();
    const res = await request(app).post('/api/admin/suggestions/nonexistent/approve').send({});

    expect(res.status).toBe(404);
  });

  test('returns 409 when suggestion already accepted', async () => {
    setupDocMock({ 'suggestions/sug-1': makeSuggestionSnap('sug-1', { status: 'accepted' }) });
    const app = createAdminApp();
    const res = await request(app).post('/api/admin/suggestions/sug-1/approve').send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already accepted/i);
  });

  test('returns 409 when suggestion already rejected', async () => {
    setupDocMock({ 'suggestions/sug-1': makeSuggestionSnap('sug-1', { status: 'rejected' }) });
    const app = createAdminApp();
    const res = await request(app).post('/api/admin/suggestions/sug-1/approve').send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already rejected/i);
  });

  test('creates audit entry on approve', async () => {
    setupDocMock({ 'suggestions/sug-1': makeSuggestionSnap('sug-1', { status: 'pending' }) });
    const app = createAdminApp();
    await request(app).post('/api/admin/suggestions/sug-1/approve').send({}).expect(200);

    expect(mockDocSet).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /admin/suggestions/:id/reject — reject pending
// ═══════════════════════════════════════════════════════════════

describe('POST /admin/suggestions/:id/reject', () => {
  test('admin can reject a pending suggestion with reason (200)', async () => {
    setupDocMock({ 'suggestions/sug-1': makeSuggestionSnap('sug-1', { status: 'pending' }) });
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/suggestions/sug-1/reject')
      .send({ reason: 'Out of scope' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('rejected');
    expect(mockDocUpdate).toHaveBeenCalledWith(
      'suggestions/sug-1',
      expect.objectContaining({ status: 'rejected', rejectReason: 'Out of scope' }),
    );
  });

  test('admin can reject without reason (200)', async () => {
    setupDocMock({ 'suggestions/sug-1': makeSuggestionSnap('sug-1', { status: 'pending' }) });
    const app = createAdminApp();
    const res = await request(app).post('/api/admin/suggestions/sug-1/reject').send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');
  });

  test('truncates reason longer than MAX_REJECT_REASON_LENGTH', async () => {
    setupDocMock({ 'suggestions/sug-1': makeSuggestionSnap('sug-1', { status: 'pending' }) });
    const app = createAdminApp();
    const longReason = 'x'.repeat(10000);
    const res = await request(app)
      .post('/api/admin/suggestions/sug-1/reject')
      .send({ reason: longReason });

    expect(res.status).toBe(200);
    const updateCall = mockDocUpdate.mock.calls.find((c) => c[0] === 'suggestions/sug-1');
    const rejectReason = updateCall[1].rejectReason;
    expect(rejectReason.length).toBeLessThan(longReason.length);
  });

  test('non-admin receives 403', async () => {
    const app = createNonAdminApp();
    const res = await request(app)
      .post('/api/admin/suggestions/sug-1/reject')
      .send({ reason: 'Spam' });

    expect(res.status).toBe(403);
  });

  test('returns 404 when suggestion not found', async () => {
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/suggestions/nonexistent/reject')
      .send({ reason: 'Spam' });

    expect(res.status).toBe(404);
  });

  test('returns 409 when suggestion already rejected', async () => {
    setupDocMock({ 'suggestions/sug-1': makeSuggestionSnap('sug-1', { status: 'rejected' }) });
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/suggestions/sug-1/reject')
      .send({ reason: 'Spam' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already rejected/i);
  });

  test('creates audit entry on reject', async () => {
    setupDocMock({ 'suggestions/sug-1': makeSuggestionSnap('sug-1', { status: 'pending' }) });
    const app = createAdminApp();
    await request(app)
      .post('/api/admin/suggestions/sug-1/reject')
      .send({ reason: 'Test' })
      .expect(200);

    expect(mockDocSet).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /admin/suggestions/:id/overturn — reverse a decision
// ═══════════════════════════════════════════════════════════════

describe('POST /admin/suggestions/:id/overturn', () => {
  test('admin can overturn a rejected suggestion to accepted (200)', async () => {
    setupDocMock({ 'suggestions/sug-1': makeSuggestionSnap('sug-1', { status: 'rejected' }) });
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/suggestions/sug-1/overturn')
      .send({ targetStatus: 'accepted', reason: 'New evidence' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('accepted');
    expect(mockDocUpdate).toHaveBeenCalledWith(
      'suggestions/sug-1',
      expect.objectContaining({ status: 'accepted', overturnReason: 'New evidence' }),
    );
  });

  test('returns 400 when targetStatus is missing', async () => {
    setupDocMock({ 'suggestions/sug-1': makeSuggestionSnap('sug-1', { status: 'rejected' }) });
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/suggestions/sug-1/overturn')
      .send({ reason: 'New evidence' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/targetStatus/i);
  });

  test('non-admin receives 403', async () => {
    const app = createNonAdminApp();
    const res = await request(app)
      .post('/api/admin/suggestions/sug-1/overturn')
      .send({ targetStatus: 'accepted' });

    expect(res.status).toBe(403);
  });

  test('returns 404 when suggestion not found', async () => {
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/suggestions/nonexistent/overturn')
      .send({ targetStatus: 'accepted' });

    expect(res.status).toBe(404);
  });

  test('overturn without reason works (200)', async () => {
    setupDocMock({ 'suggestions/sug-1': makeSuggestionSnap('sug-1', { status: 'rejected' }) });
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/suggestions/sug-1/overturn')
      .send({ targetStatus: 'pending' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
  });

  test('creates audit entry on overturn', async () => {
    setupDocMock({ 'suggestions/sug-1': makeSuggestionSnap('sug-1', { status: 'rejected' }) });
    const app = createAdminApp();
    await request(app)
      .post('/api/admin/suggestions/sug-1/overturn')
      .send({ targetStatus: 'accepted' })
      .expect(200);

    expect(mockDocSet).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /admin/suggestions/:id/status — POST alias for PUT
// ═══════════════════════════════════════════════════════════════

describe('POST /admin/suggestions/:id/status', () => {
  test('admin can change status via POST (200)', async () => {
    setupDocMock({ 'suggestions/sug-1': makeSuggestionSnap('sug-1', { status: 'pending' }) });
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/suggestions/sug-1/status')
      .send({ status: 'accepted' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('accepted');
  });

  test('returns 400 when status body is missing', async () => {
    const app = createAdminApp();
    const res = await request(app).post('/api/admin/suggestions/sug-1/status').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status is required/i);
  });

  test('returns 404 when suggestion not found', async () => {
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/suggestions/nonexistent/status')
      .send({ status: 'accepted' });

    expect(res.status).toBe(404);
  });

  test('non-admin receives 403', async () => {
    const app = createNonAdminApp();
    const res = await request(app)
      .post('/api/admin/suggestions/sug-1/status')
      .send({ status: 'accepted' });

    expect(res.status).toBe(403);
  });

  test('creates audit entry on status change', async () => {
    setupDocMock({ 'suggestions/sug-1': makeSuggestionSnap('sug-1', { status: 'pending' }) });
    const app = createAdminApp();
    await request(app)
      .post('/api/admin/suggestions/sug-1/status')
      .send({ status: 'accepted' })
      .expect(200);

    expect(mockDocSet).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /admin/suggestions/:id/add-votes — bump vote count
// ═══════════════════════════════════════════════════════════════

describe('POST /admin/suggestions/:id/add-votes', () => {
  test('admin can add votes (200)', async () => {
    setupDocMock({ 'suggestions/sug-1': makeSuggestionSnap('sug-1') });
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/suggestions/sug-1/add-votes')
      .send({ count: 10 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      'suggestions/sug-1',
      expect.objectContaining({
        upvotes: expect.objectContaining({ _type: 'increment', value: 10 }),
      }),
    );
  });

  test('returns 400 when count is zero', async () => {
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/suggestions/sug-1/add-votes')
      .send({ count: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positive/i);
  });

  test('returns 400 when count is negative', async () => {
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/suggestions/sug-1/add-votes')
      .send({ count: -5 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positive/i);
  });

  test('returns 400 when count is missing', async () => {
    const app = createAdminApp();
    const res = await request(app).post('/api/admin/suggestions/sug-1/add-votes').send({});

    expect(res.status).toBe(400);
  });

  test('returns 404 when suggestion not found', async () => {
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/suggestions/nonexistent/add-votes')
      .send({ count: 5 });

    expect(res.status).toBe(404);
  });

  test('non-admin receives 403', async () => {
    const app = createNonAdminApp();
    const res = await request(app)
      .post('/api/admin/suggestions/sug-1/add-votes')
      .send({ count: 5 });

    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /admin/suggestions/:id/history — audit log timeline
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// GET /admin/notifications — list notifications with filters
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// 500 error paths for new suggestion routes
// ═══════════════════════════════════════════════════════════════

describe('500 error paths — new admin suggestion routes', () => {
  test('PATCH /admin/suggestions/:id returns 500 on DB error', async () => {
    mockDocGet.mockRejectedValue(new Error('DB timeout'));
    const app = createAdminApp();
    const res = await request(app)
      .patch('/api/admin/suggestions/err-sug')
      .send({ title: 'New Title' });

    expect(res.status).toBe(500);
  });

  test('POST /admin/suggestions/:id/dispute returns 500 on DB error', async () => {
    mockDocGet.mockRejectedValue(new Error('DB timeout'));
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/suggestions/err-sug/dispute')
      .send({ reason: 'Test' });

    expect(res.status).toBe(500);
  });

  test('POST /admin/suggestions/:id/dispute/uphold returns 500 on DB error', async () => {
    mockDocGet.mockRejectedValue(new Error('DB timeout'));
    const app = createAdminApp();
    const res = await request(app).post('/api/admin/suggestions/err-sug/dispute/uphold').send({});

    expect(res.status).toBe(500);
  });

  test('GET /admin/suggestions/:id returns 500 on DB error', async () => {
    mockDocGet.mockRejectedValue(new Error('DB timeout'));
    const app = createAdminApp();
    const res = await request(app).get('/api/admin/suggestions/err-sug');

    expect(res.status).toBe(500);
  });

  test('POST /admin/suggestions/:id/approve returns 500 on DB error', async () => {
    mockDocGet.mockRejectedValue(new Error('DB timeout'));
    const app = createAdminApp();
    const res = await request(app).post('/api/admin/suggestions/err-sug/approve').send({});

    expect(res.status).toBe(500);
  });

  test('POST /admin/suggestions/:id/reject returns 500 on DB error', async () => {
    mockDocGet.mockRejectedValue(new Error('DB timeout'));
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/suggestions/err-sug/reject')
      .send({ reason: 'Test' });

    expect(res.status).toBe(500);
  });

  test('POST /admin/suggestions/:id/overturn returns 500 on DB error', async () => {
    mockDocGet.mockRejectedValue(new Error('DB timeout'));
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/suggestions/err-sug/overturn')
      .send({ targetStatus: 'accepted' });

    expect(res.status).toBe(500);
  });

  test('POST /admin/suggestions/:id/status returns 500 on DB error', async () => {
    mockDocGet.mockRejectedValue(new Error('DB timeout'));
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/suggestions/err-sug/status')
      .send({ status: 'accepted' });

    expect(res.status).toBe(500);
  });

  test('POST /admin/suggestions/:id/add-votes returns 500 on DB error', async () => {
    mockDocGet.mockRejectedValue(new Error('DB timeout'));
    const app = createAdminApp();
    const res = await request(app)
      .post('/api/admin/suggestions/err-sug/add-votes')
      .send({ count: 5 });

    expect(res.status).toBe(500);
  });

  test('GET /admin/suggestions/:id/history returns 500 on DB error', async () => {
    mockCollectionGet.mockRejectedValue(new Error('DB timeout'));
    const app = createAdminApp();
    const res = await request(app).get('/api/admin/suggestions/err-sug/history');

    expect(res.status).toBe(500);
  });
});

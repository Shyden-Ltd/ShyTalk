/**
 * UK OSA #17 PR 4 — `requireSameCohort` route-wiring tests for
 * `routes/conversations.js`.
 *
 *   GET  /api/conversations/:id/messages
 *   POST /api/conversations/:id/messages
 *
 * The gate fires on the OTHER participant in 1:1 conversations.
 * Group conversations are deferred to PR 8 (frozen-at-migration
 * + dedicated freeze flag) — group convs pass through this gate
 * untouched.
 */

const express = require('express');
const request = require('supertest');

// ─── Path-aware Firebase mock ───────────────────────────────────

const docResponses = new Map();
const setDoc = (path, data) => docResponses.set(path, data);
const clearDocs = () => docResponses.clear();

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockBatchSet = jest.fn();
const mockBatchUpdate = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();
const mockMessagesGet = jest.fn();
const mockSegregationAdd = jest.fn().mockResolvedValue({ id: 'evt_1' });

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: () => mockDocGet(path),
      set: (...args) => mockDocSet(path, ...args),
    })),
    collection: jest.fn((name) => {
      if (name === 'segregationEvents') return { add: mockSegregationAdd };
      // For /conversations/.../messages — orderBy().limit().get()
      return {
        orderBy: jest.fn(() => ({
          limit: jest.fn(() => ({ get: mockMessagesGet })),
        })),
      };
    }),
    batch: jest.fn(() => ({
      set: mockBatchSet,
      update: mockBatchUpdate,
      commit: mockBatchCommit,
    })),
    getAll: jest.fn().mockResolvedValue([]),
  },
  rtdb: {
    ref: jest.fn(() => ({ set: jest.fn().mockResolvedValue() })),
  },
  FieldValue: {
    increment: jest.fn((n) => `increment(${n})`),
    arrayRemove: jest.fn((...args) => `arrayRemove(${args})`),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: () => 'msg-123',
  now: () => 1709913600000,
}));

jest.mock('../../src/utils/fcm', () => ({
  sendFcmToTokens: jest.fn().mockResolvedValue([]),
  cleanupInvalidTokens: jest.fn().mockResolvedValue(),
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const mockIsLiveAdmin = jest.fn();
jest.mock('../../src/middleware/auth', () => ({
  isLiveAdmin: (...args) => mockIsLiveAdmin(...args),
}));

const { _resetAuditDedup } = require('../../src/middleware/sameCohort');

beforeEach(() => {
  jest.clearAllMocks();
  mockDocGet.mockReset();
  mockSegregationAdd.mockReset();
  mockSegregationAdd.mockResolvedValue({ id: 'evt_1' });
  mockMessagesGet.mockReset();
  mockMessagesGet.mockResolvedValue({ docs: [] });
  mockIsLiveAdmin.mockReset();
  mockIsLiveAdmin.mockResolvedValue(true);
  _resetAuditDedup();
  clearDocs();

  mockDocGet.mockImplementation((path) => {
    if (docResponses.has(path)) {
      const data = docResponses.get(path);
      return Promise.resolve({ exists: data !== undefined && data !== null, data: () => data });
    }
    return Promise.resolve({ exists: false, data: () => null });
  });
});

// ─── App setup ───────────────────────────────────────────────────

const conversationsRouter = require('../../src/routes/conversations');

function createApp({
  uid = 'firebase-uid',
  uniqueId = 'user-A',
  cohort = 'adult',
  admin = false,
} = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = {
      uid,
      uniqueId,
      token: { cohort, ...(admin ? { admin: true } : {}) },
    };
    next();
  });
  app.use('/api', conversationsRouter);
  return app;
}

// ═══════════════════════════════════════════════════════════════════
// GET /api/conversations/:id/messages
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/conversations/:id/messages — cross-cohort gate', () => {
  test('1:1 adult ↔ minor → 404 + audit', async () => {
    setDoc('conversations/conv-1', { participantIds: ['user-A', 'user-B'] });
    setDoc('users/user-B', { cohort: 'minor' });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).get('/api/conversations/conv-1/messages');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    await new Promise((r) => setImmediate(r));
    expect(mockSegregationAdd).toHaveBeenCalledTimes(1);
    expect(mockSegregationAdd.mock.calls[0][0]).toMatchObject({
      sourceUniqueId: 'user-A',
      sourceCohort: 'adult',
      targetUniqueId: 'user-B',
      targetCohort: 'minor',
    });
  });

  test('1:1 same-cohort returns messages', async () => {
    setDoc('conversations/conv-1', { participantIds: ['user-A', 'user-B'] });
    setDoc('users/user-B', { cohort: 'adult' });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).get('/api/conversations/conv-1/messages');

    expect(res.status).toBe(200);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('group conversation skips the gate (deferred to PR 8 freeze)', async () => {
    setDoc('conversations/conv-1', {
      participantIds: ['user-A', 'user-B', 'user-C'],
      isGroup: true,
      groupName: 'Hangout',
    });
    // No user-B/user-C cohort lookup needed — gate doesn't run.

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).get('/api/conversations/conv-1/messages');

    expect(res.status).toBe(200);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('admin cross-cohort access allowed', async () => {
    setDoc('conversations/conv-1', { participantIds: ['admin-user', 'user-B'] });
    setDoc('users/user-B', { cohort: 'minor' });

    const app = createApp({ uniqueId: 'admin-user', cohort: 'adult', admin: true });
    const res = await request(app).get('/api/conversations/conv-1/messages');

    expect(res.status).toBe(200);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('missing other participant in 1:1 returns 404 (existence-hiding)', async () => {
    setDoc('conversations/conv-1', { participantIds: ['user-A', 'user-B'] });
    // No user-B doc.
    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).get('/api/conversations/conv-1/messages');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/conversations/:id/messages
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/conversations/:id/messages — cross-cohort gate', () => {
  test('1:1 adult sending to minor → 404 + audit, no message persisted', async () => {
    setDoc('conversations/conv-1', { participantIds: ['user-A', 'user-B'] });
    setDoc('users/user-B', { cohort: 'minor' });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'hi', type: 'TEXT', senderName: 'Adult' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    await new Promise((r) => setImmediate(r));
    expect(mockSegregationAdd).toHaveBeenCalledTimes(1);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  test('1:1 same-cohort send proceeds', async () => {
    setDoc('conversations/conv-1', { participantIds: ['user-A', 'user-B'] });
    setDoc('users/user-B', { cohort: 'adult' });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'hello', type: 'TEXT', senderName: 'Adult' });

    expect(res.status).toBe(200);
    expect(mockBatchCommit).toHaveBeenCalled();
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('group conversation send skips gate', async () => {
    setDoc('conversations/conv-1', {
      participantIds: ['user-A', 'user-B', 'user-C'],
      isGroup: true,
    });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'group', type: 'TEXT', senderName: 'Adult' });

    expect(res.status).toBe(200);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('admin cross-cohort send allowed', async () => {
    setDoc('conversations/conv-1', { participantIds: ['admin-user', 'user-B'] });
    setDoc('users/user-B', { cohort: 'minor' });

    const app = createApp({ uniqueId: 'admin-user', cohort: 'adult', admin: true });
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'mod note', type: 'TEXT', senderName: 'Admin' });

    expect(res.status).toBe(200);
    expect(mockBatchCommit).toHaveBeenCalled();
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('POST missing other participant returns 404 (existence-hiding)', async () => {
    setDoc('conversations/conv-1', { participantIds: ['user-A', 'user-B'] });
    // No user-B doc.
    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'hi', type: 'TEXT', senderName: 'Adult' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });
});

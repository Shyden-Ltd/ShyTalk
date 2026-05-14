/**
 * UK OSA #17 PR 8 — Conversation cohort-flag gate tests.
 *
 * PR 4 already pinned the runtime cohort gate on 1:1 conversations
 * (`tests/routes/conversations-same-cohort.test.js`). This file
 * covers the migration-flag gate added in PR 8:
 *
 *   • `crossCohortAtMigration: true` on a 1:1 → GET / POST messages
 *     return 404 (existence-hiding) regardless of the current cohort
 *     state of either participant. The flag is the load-bearing
 *     rules-side hide (firestore.rules locks every subcollection
 *     when set, per PR 3) — Express mirrors the 404 as defence in
 *     depth so admin-SDK or future direct paths get the same gate.
 *
 *   • `frozenAtMigration: true` on a GROUP → GET / POST messages
 *     STILL work. Design line 137: "Existing members keep read+write
 *     access to the frozen thread." The freeze is participant-list
 *     only (rules-side gate on growth, no Express change). This file
 *     pins the positive contract — POST messages must NOT 404 just
 *     because the group is frozen.
 *
 * Crucially, NO audit row is written on the flag-blocked path: the
 * migration script already wrote a `conversation_1to1_hidden` row
 * per migrated thread, so a per-request audit here would be noisy
 * duplication. The PR 4 audit-dedup logic still fires for the
 * runtime cohort gate (target user's cohort mismatches caller's) —
 * the two gates are independent.
 */

const express = require('express');
const request = require('supertest');

// ─── Path-aware Firebase mock (shared with conversations-same-cohort) ──

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

// ══════════════════════════════════════════════════════════════════
// GET /api/conversations/:id/messages — crossCohortAtMigration flag
// ══════════════════════════════════════════════════════════════════

describe('GET /api/conversations/:id/messages — crossCohortAtMigration flag', () => {
  test('1:1 with flag set → 404 (existence-hiding) even when cohorts match', async () => {
    // Both users are adult — runtime cohort gate passes — but the
    // migration flag is the authoritative hide. This is the defence-
    // in-depth assertion: the flag wins regardless of current state.
    setDoc('conversations/conv-1', {
      participantIds: ['user-A', 'user-B'],
      crossCohortAtMigration: true,
    });
    setDoc('users/user-B', { cohort: 'adult' });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).get('/api/conversations/conv-1/messages');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  test('1:1 flag-blocked path does NOT write a segregationEvents row (migration already wrote one)', async () => {
    setDoc('conversations/conv-1', {
      participantIds: ['user-A', 'user-B'],
      crossCohortAtMigration: true,
    });
    setDoc('users/user-B', { cohort: 'adult' });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    await request(app).get('/api/conversations/conv-1/messages');

    await new Promise((r) => setImmediate(r));
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('1:1 with flag absent → falls through to runtime cohort gate', async () => {
    // Sanity: the flag check must not break the existing PR 4 gate
    // when the flag is missing. Cross-cohort runtime → 404 + audit.
    setDoc('conversations/conv-1', { participantIds: ['user-A', 'user-B'] });
    setDoc('users/user-B', { cohort: 'minor' });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).get('/api/conversations/conv-1/messages');

    expect(res.status).toBe(404);
    await new Promise((r) => setImmediate(r));
    expect(mockSegregationAdd).toHaveBeenCalledTimes(1);
  });

  test('1:1 with flag explicitly false → behaves like unflagged', async () => {
    setDoc('conversations/conv-1', {
      participantIds: ['user-A', 'user-B'],
      crossCohortAtMigration: false,
    });
    setDoc('users/user-B', { cohort: 'adult' });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).get('/api/conversations/conv-1/messages');

    expect(res.status).toBe(200);
  });

  test('admin bypass — admin can still read flagged 1:1 for moderation', async () => {
    // Mirrors the PR 4 admin bypass on the runtime cohort gate. The
    // migration flag is operationally identical (a hide signal), and
    // admins need visibility for forensics / appeals.
    setDoc('conversations/conv-1', {
      participantIds: ['admin-user', 'user-B'],
      crossCohortAtMigration: true,
    });
    setDoc('users/user-B', { cohort: 'adult' });

    const app = createApp({ uniqueId: 'admin-user', cohort: 'adult', admin: true });
    const res = await request(app).get('/api/conversations/conv-1/messages');

    expect(res.status).toBe(200);
  });

  test('admin bypass writes a `admin_flag_bypass` segregationEvents audit row (UK OSA forensic accountability)', async () => {
    // The migration captured each thread once; this row captures the
    // moderator's access for GDPR Article 30 / UK OSA audit-trail.
    // Without it, privileged access to age-segregated data leaves
    // no trail.
    setDoc('conversations/conv-audit', {
      participantIds: ['admin-user', 'user-B'],
      crossCohortAtMigration: true,
    });
    setDoc('users/user-B', { cohort: 'adult' });

    const app = createApp({ uniqueId: 'admin-user', cohort: 'adult', admin: true });
    await request(app).get('/api/conversations/conv-audit/messages');
    await new Promise((r) => setImmediate(r));

    expect(mockSegregationAdd).toHaveBeenCalledTimes(1);
    expect(mockSegregationAdd.mock.calls[0][0]).toMatchObject({
      sourceUniqueId: 'admin-user',
      sourceCohort: 'adult',
      targetUniqueId: 'conv-audit',
      targetConversationId: 'conv-audit',
      targetCohort: 'mixed',
      action: 'admin_flag_bypass',
    });
    expect(typeof mockSegregationAdd.mock.calls[0][0].timestamp).toBe('number');
  });

  test('admin bypass audit failure does NOT block the 200 response (side-channel defence)', async () => {
    setDoc('conversations/conv-audit-fail', {
      participantIds: ['admin-user', 'user-B'],
      crossCohortAtMigration: true,
    });
    setDoc('users/user-B', { cohort: 'adult' });
    mockSegregationAdd.mockRejectedValueOnce(new Error('quota exhausted'));

    const app = createApp({ uniqueId: 'admin-user', cohort: 'adult', admin: true });
    const res = await request(app).get('/api/conversations/conv-audit-fail/messages');

    expect(res.status).toBe(200);
  });

  test('non-participant on flagged 1:1 → 403 (participant check fires first, no info leak)', async () => {
    // The participant check at the top of the handler runs before the
    // gate. A non-participant gets 403 (the standard "not your conv"
    // response), not 404 — but they don't get the cohort-leak signal
    // either, since the 403 doesn't expose the flag's presence.
    setDoc('conversations/conv-1', {
      participantIds: ['user-X', 'user-Y'],
      crossCohortAtMigration: true,
    });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).get('/api/conversations/conv-1/messages');

    expect(res.status).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════
// POST /api/conversations/:id/messages — crossCohortAtMigration flag
// ══════════════════════════════════════════════════════════════════

describe('POST /api/conversations/:id/messages — crossCohortAtMigration flag', () => {
  test('1:1 with flag set → 404 + no message persisted', async () => {
    setDoc('conversations/conv-1', {
      participantIds: ['user-A', 'user-B'],
      crossCohortAtMigration: true,
    });
    setDoc('users/user-B', { cohort: 'adult' });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'hi', type: 'TEXT', senderName: 'Adult' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  test('1:1 flag-blocked POST does NOT write a segregationEvents row', async () => {
    setDoc('conversations/conv-1', {
      participantIds: ['user-A', 'user-B'],
      crossCohortAtMigration: true,
    });
    setDoc('users/user-B', { cohort: 'adult' });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'hi', type: 'TEXT', senderName: 'Adult' });

    await new Promise((r) => setImmediate(r));
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('1:1 admin POST on flagged conv → 200 (admin moderation bypass)', async () => {
    setDoc('conversations/conv-1', {
      participantIds: ['admin-user', 'user-B'],
      crossCohortAtMigration: true,
    });
    setDoc('users/user-B', { cohort: 'adult' });

    const app = createApp({ uniqueId: 'admin-user', cohort: 'adult', admin: true });
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'mod note', type: 'TEXT', senderName: 'Admin' });

    expect(res.status).toBe(200);
    expect(mockBatchCommit).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════
// Group `frozenAtMigration` — positive pin: existing members keep
// read+write per design doc line 137. The freeze is participant-list
// only (rules-side gate on growth), NOT a message gate.
// ══════════════════════════════════════════════════════════════════

describe('Group frozenAtMigration — read+write preserved for existing members', () => {
  test('GET messages on frozen group → 200 (members keep read access)', async () => {
    setDoc('conversations/conv-1', {
      participantIds: ['user-A', 'user-B', 'user-C'],
      isGroup: true,
      groupName: 'Frozen Hangout',
      frozenAtMigration: true,
    });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).get('/api/conversations/conv-1/messages');

    expect(res.status).toBe(200);
  });

  test('POST messages on frozen group → 200 (members keep write access)', async () => {
    setDoc('conversations/conv-1', {
      participantIds: ['user-A', 'user-B', 'user-C'],
      isGroup: true,
      groupName: 'Frozen Hangout',
      frozenAtMigration: true,
    });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'still here', type: 'TEXT', senderName: 'Adult' });

    expect(res.status).toBe(200);
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  test('frozen group never writes a segregationEvents row on message ops (group freeze ≠ cohort block)', async () => {
    setDoc('conversations/conv-1', {
      participantIds: ['user-A', 'user-B'],
      isGroup: true,
      frozenAtMigration: true,
    });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    await request(app).get('/api/conversations/conv-1/messages');
    await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'ok', type: 'TEXT', senderName: 'A' });

    await new Promise((r) => setImmediate(r));
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════
// Edge — group also flagged crossCohortAtMigration (shouldn't happen
// per design but defend anyway: the 1:1 hide flag wins even on
// isGroup=true). Future-proofing assertion: if some operator
// accidentally sets the flag on a group, the gate fires.
// ══════════════════════════════════════════════════════════════════

describe('Defense-in-depth — crossCohortAtMigration wins regardless of isGroup', () => {
  test('group with crossCohortAtMigration set (corrupted state) → 404 on GET', async () => {
    setDoc('conversations/conv-1', {
      participantIds: ['user-A', 'user-B', 'user-C'],
      isGroup: true,
      groupName: 'Mistakenly Flagged',
      crossCohortAtMigration: true,
    });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).get('/api/conversations/conv-1/messages');

    expect(res.status).toBe(404);
  });
});

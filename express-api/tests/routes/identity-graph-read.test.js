/* eslint-disable no-unused-vars */
/**
 * Tests for identity graph and unified cascading ban system.
 *
 * Covers spec sections:
 *   11.8   — Identity Graph & Suspensions
 *   11.61  — Identity Graph Query Performance
 *   11.104 — Identity Graph Edge Cases (Extended)
 *
 * Routes under test:
 *   POST   /api/admin/bans/graph           → create ban graph
 *   GET    /api/admin/bans/graph/:id       → view identity graph
 *   PUT    /api/admin/bans/graph/:id       → update ban graph
 *   DELETE /api/admin/bans/graph/:id       → unban entire graph
 *   GET    /api/admin/bans/check           → check if banned (middleware)
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock ──────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();
const mockCollectionAdd = jest.fn().mockResolvedValue({ id: 'graph-id-1' });
const mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [], size: 0 });

const mockQueryChain = {
  where: jest.fn(() => mockQueryChain),
  orderBy: jest.fn(() => mockQueryChain),
  limit: jest.fn(() => mockQueryChain),
  get: () => mockCollectionGet(),
};

const mockRunTransaction = jest.fn(async (fn) => {
  const t = {
    get: (ref) => mockDocGet(ref._path || ref),
    set: mockDocSet,
    update: mockDocUpdate,
    delete: mockDocDelete,
  };
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
      where: jest.fn(() => mockQueryChain),
      orderBy: jest.fn(() => mockQueryChain),
      get: () => mockCollectionGet(),
    })),
    runTransaction: mockRunTransaction,
  },
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
    arrayUnion: jest.fn((...args) => ({ _type: 'arrayUnion', values: args })),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'mock-graph-id'),
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

// ─── App setup ──────────────────────────────────────────────────

let identityGraphRouter;

function createApp({ uniqueId = 'admin1', isAdmin = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: `firebase-uid-${uniqueId}`, uniqueId, token: { admin: isAdmin } };
    next();
  });
  app.use('/api', identityGraphRouter);
  return app;
}

function createNonAdminApp({ uniqueId = 1001 } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: `firebase-uid-${uniqueId}`, uniqueId, token: { admin: false } };
    next();
  });
  app.use('/api', identityGraphRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  mockDocGet.mockResolvedValue({ exists: false });
  mockCollectionGet.mockResolvedValue({ empty: true, docs: [], size: 0 });
  identityGraphRouter = require('../../src/routes/identity-graph');
});

// ─── Helpers ────────────────────────────────────────────────────

function makeGraphDoc(id, overrides = {}) {
  return {
    id,
    exists: true,
    data: () => ({
      graphId: id,
      identifiers: [
        {
          type: 'uid',
          value: '1001',
          metadata: {},
          addedAt: 1709913600000,
          source: 'login',
          suspension: null,
        },
        {
          type: 'ip',
          value: '1.2.3.4',
          metadata: { isp: 'TestISP', country: 'GB', asn: 'AS12345' },
          addedAt: 1709913600000,
          source: 'login',
          suspension: null,
        },
        {
          type: 'fingerprint',
          value: 'fp-abc123',
          metadata: {},
          addedAt: 1709913600000,
          source: 'login',
          suspension: null,
        },
      ],
      multiAccountDetected: false,
      linkedAccountUids: ['1001'],
      ...overrides,
    }),
  };
}

function makeSuspendedIdentifier(type, value, duration = '7d') {
  const expiresAt = duration === 'permanent' ? null : 1709913600000 + 7 * 24 * 60 * 60 * 1000;
  return {
    type,
    value,
    metadata: {},
    addedAt: 1709913600000,
    source: 'login',
    suspension: {
      isActive: true,
      level: 'full',
      duration,
      reason: 'Spam',
      suspendedBy: 'admin1',
      suspendedAt: 1709913600000,
      expiresAt,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// 11.8 — Identity Graph & Suspensions
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// 11.61 — Identity Graph Query Performance
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// 11.104 — Identity Graph Edge Cases (Extended)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// Additional coverage — uncovered lines and branches
// ═══════════════════════════════════════════════════════════════

describe('GET /api/admin/bans/check — validation and edge cases', () => {
  test('returns 400 when no query parameters provided', async () => {
    const app = createApp();
    const res = await request(app).get('/api/admin/bans/check').expect(400);
    expect(res.body.error).toMatch(/At least one identifier required/);
  });

  test('returns isBanned=false for expired suspension', async () => {
    const expiredIdentifier = {
      type: 'ip',
      value: '1.2.3.4',
      metadata: {},
      addedAt: 1000,
      source: 'login',
      suspension: {
        isActive: true,
        level: 'full',
        duration: '7d',
        reason: 'Spam',
        suspendedAt: 1000,
        expiresAt: 1000, // long expired
      },
    };
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [makeGraphDoc('graph-1', { identifiers: [expiredIdentifier] })],
    });
    const app = createApp();
    const res = await request(app).get('/api/admin/bans/check?ip=1.2.3.4').expect(200);
    expect(res.body.isBanned).toBe(false);
  });

  test('returns isBanned=true for permanent suspension (expiresAt=null)', async () => {
    const permanentIdentifier = {
      type: 'uid',
      value: '1001',
      metadata: {},
      addedAt: 1000,
      source: 'login',
      suspension: {
        isActive: true,
        level: 'full',
        duration: 'permanent',
        reason: 'Permanent ban',
        suspendedAt: 1000,
        expiresAt: null,
      },
    };
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [makeGraphDoc('graph-1', { identifiers: [permanentIdentifier] })],
    });
    const app = createApp();
    const res = await request(app).get('/api/admin/bans/check?uid=1001').expect(200);
    expect(res.body.isBanned).toBe(true);
    expect(res.body.level).toBe('full');
    expect(res.body.expiresAt).toBeNull();
  });

  test('matches fingerprint identifier correctly', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        makeGraphDoc('graph-1', {
          identifiers: [makeSuspendedIdentifier('fingerprint', 'fp-match')],
        }),
      ],
    });
    const app = createApp();
    const res = await request(app).get('/api/admin/bans/check?fingerprint=fp-match').expect(200);
    expect(res.body.isBanned).toBe(true);
  });

  test('normalises IPv4-mapped IPv6 in ban check query', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        makeGraphDoc('graph-1', {
          identifiers: [makeSuspendedIdentifier('ip', '5.6.7.8')],
        }),
      ],
    });
    const app = createApp();
    const res = await request(app).get('/api/admin/bans/check?ip=::ffff:5.6.7.8').expect(200);
    expect(res.body.isBanned).toBe(true);
  });

  test('does not match inactive suspension (suspension=null)', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        makeGraphDoc('graph-1', {
          identifiers: [
            {
              type: 'ip',
              value: '1.2.3.4',
              metadata: {},
              addedAt: 1000,
              source: 'login',
              suspension: null,
            },
          ],
        }),
      ],
    });
    const app = createApp();
    const res = await request(app).get('/api/admin/bans/check?ip=1.2.3.4').expect(200);
    expect(res.body.isBanned).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Security: Query param type coercion (CodeQL type confusion fix)
// ═══════════════════════════════════════════════════════════════

describe('GET /api/admin/bans/check — array query param coercion', () => {
  test('handles duplicate ip params (array) by using first value', async () => {
    // Express parses ?ip=1.2.3.4&ip=5.6.7.8 as ip: ['1.2.3.4', '5.6.7.8']
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        makeGraphDoc('graph-1', {
          identifiers: [makeSuspendedIdentifier('ip', '1.2.3.4')],
        }),
      ],
    });
    const app = createApp();
    const res = await request(app).get('/api/admin/bans/check?ip=1.2.3.4&ip=5.6.7.8').expect(200);
    // Should use the first value and find the ban
    expect(res.body.isBanned).toBe(true);
  });

  test('handles duplicate fingerprint params (array) by using first value', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        makeGraphDoc('graph-1', {
          identifiers: [makeSuspendedIdentifier('fingerprint', 'fp-first')],
        }),
      ],
    });
    const app = createApp();
    const res = await request(app)
      .get('/api/admin/bans/check?fingerprint=fp-first&fingerprint=fp-second')
      .expect(200);
    expect(res.body.isBanned).toBe(true);
  });

  test('handles duplicate uid params (array) by using first value', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        makeGraphDoc('graph-1', {
          identifiers: [makeSuspendedIdentifier('uid', '1001')],
        }),
      ],
    });
    const app = createApp();
    const res = await request(app).get('/api/admin/bans/check?uid=1001&uid=2002').expect(200);
    expect(res.body.isBanned).toBe(true);
  });

  test('returns 400 when all params are empty after coercion', async () => {
    const app = createApp();
    // No params at all
    const res = await request(app).get('/api/admin/bans/check').expect(400);
    expect(res.body.error).toMatch(/At least one identifier required/);
  });

  test('handles single string ip param normally (no coercion needed)', async () => {
    mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [] });
    const app = createApp();
    const res = await request(app).get('/api/admin/bans/check?ip=9.9.9.9').expect(200);
    expect(res.body.isBanned).toBe(false);
  });
});

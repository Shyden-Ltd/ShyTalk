/**
 * UK OSA #17 PR 10 — leaderboard / stalker / gift-wall same-cohort
 * filters.
 *
 * Two distinct gate shapes are exercised here:
 *
 *   1. Outer-list 404 gate (mirrors PR 4-9 pattern). Endpoints that
 *      expose a target user's own list — gift-wall and its per-gift
 *      senders view — return the byte-identical existence-hiding 404
 *      when the caller is cross-cohort to the target.
 *
 *   2. Inner-list filter (new pattern). Endpoints whose response body
 *      is an array of user-keyed entries — gift-rankings (global
 *      per-gift leaderboard) and the senders array nested inside a
 *      same-cohort gift-wall view — filter cross-cohort entries out
 *      in-memory. Entries are tagged with their owner's cohort at
 *      write time (updateGiftRankings / updateGiftWall); legacy
 *      entries that pre-date PR 10 fall back to a single per-entry
 *      users/<id> lookup at read time so the migration is zero-
 *      downtime.
 *
 * Stalker reads are intentionally not covered here: there is no user-
 * facing GET endpoint for the stalkers subcollection (admin only via
 * admin-users.js, and the iOS/Android clients read the subcollection
 * directly through firestore.rules which are gated in PR 3 / PR 12).
 */

const express = require('express');
const request = require('supertest');

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();
const mockSegregationAdd = jest.fn().mockResolvedValue({ id: 'evt_1' });
const mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });

const docResponses = new Map();
function setDoc(path, data) {
  docResponses.set(path, data);
}
function clearDocs() {
  docResponses.clear();
}

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: () => mockDocGet(path),
      update: (...args) => mockDocUpdate(path, ...args),
      set: (...args) => mockDocSet(path, ...args),
    })),
    collection: jest.fn((name) => {
      if (name === 'segregationEvents') {
        return { add: mockSegregationAdd };
      }
      // Default chainable that supports the patterns used by routes
      // exercised here: .get(), .count().get(), .orderBy().limit().get().
      // The aggregate count returns 0 so addBroadcast's prune path
      // short-circuits without needing batch-delete plumbing.
      const emptyAggregate = { get: () => Promise.resolve({ data: () => ({ count: 0 }) }) };
      const emptyQuery = {
        limit: () => ({ get: () => Promise.resolve({ empty: true, docs: [] }) }),
        get: () => Promise.resolve({ empty: true, docs: [] }),
      };
      return {
        get: () => mockCollectionGet(name),
        count: () => emptyAggregate,
        orderBy: () => emptyQuery,
      };
    }),
    batch: jest.fn(() => ({
      set: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      commit: jest.fn().mockResolvedValue(),
    })),
    // Inline transaction: t.get/update/delete delegate to the same
    // doc-path mocks the rest of the suite uses, so write-time tests
    // that POST /economy/gift can reach updateGiftWall + updateGiftRankings.
    runTransaction: jest.fn(async (cb) => {
      const tx = {
        get: (ref) => mockDocGet(ref?._path),
        update: (ref, ...args) => mockDocUpdate(ref?._path, ...args),
        set: (ref, ...args) => mockDocSet(ref?._path, ...args),
        delete: jest.fn(),
      };
      return cb(tx);
    }),
  },
  FieldValue: {
    increment: jest.fn((n) => `increment(${n})`),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: () => 'id-123',
  now: () => 1709913600000,
  todayStr: () => '2026-05-15',
  yesterdayStr: () => '2026-05-14',
}));

const mockIsLiveAdmin = jest.fn();
jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn(() => false),
  isLiveAdmin: (...args) => mockIsLiveAdmin(...args),
}));

jest.mock('../../src/utils/playStore', () => ({
  verifyProductPurchase: jest.fn(),
  verifySubscription: jest.fn(),
}));

jest.mock('../../src/utils/appleStore', () => ({
  verifyApplePurchase: jest.fn(),
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { _resetAuditDedup } = require('../../src/middleware/sameCohort');
const economyRouter = require('../../src/routes/economy');
const configRouter = require('../../src/routes/config');

beforeEach(() => {
  jest.clearAllMocks();
  mockDocGet.mockReset();
  mockDocUpdate.mockReset();
  mockDocSet.mockReset();
  mockSegregationAdd.mockReset();
  mockCollectionGet.mockReset();
  mockIsLiveAdmin.mockReset();
  _resetAuditDedup();
  clearDocs();
  economyRouter._resetConfigCache?.();

  mockDocUpdate.mockResolvedValue();
  mockDocSet.mockResolvedValue();
  mockSegregationAdd.mockResolvedValue({ id: 'evt_1' });
  mockIsLiveAdmin.mockResolvedValue(true);
  mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });

  mockDocGet.mockImplementation((path) => {
    if (docResponses.has(path)) {
      const data = docResponses.get(path);
      return Promise.resolve({
        exists: data !== undefined && data !== null,
        id: path.split('/').pop(),
        data: () => data,
      });
    }
    return Promise.resolve({
      exists: false,
      id: path.split('/').pop(),
      data: () => null,
    });
  });
});

function createEconomyApp({ uniqueId = 'user-A', cohort = 'adult', admin = false } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = {
      uid: 'firebase-uid-' + uniqueId,
      uniqueId,
      token: { cohort, ...(admin ? { admin: true } : {}) },
    };
    next();
  });
  app.use('/api', economyRouter);
  return app;
}

function createConfigApp({ uniqueId = 'user-A', cohort = 'adult', admin = false } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = {
      uid: 'firebase-uid-' + uniqueId,
      uniqueId,
      token: { cohort, ...(admin ? { admin: true } : {}) },
    };
    next();
  });
  app.use('/api', configRouter);
  return app;
}

function stageGiftWallCollection(uniqueId, docs) {
  mockCollectionGet.mockImplementation((path) => {
    if (path === `users/${uniqueId}/giftWall`) {
      return Promise.resolve({
        empty: docs.length === 0,
        docs: docs.map((d) => ({ id: d.id, data: () => d })),
      });
    }
    return Promise.resolve({ empty: true, docs: [] });
  });
}

describe('GET /api/users/:uniqueId/gift-wall - outer cohort gate', () => {
  test('cross-cohort target -> 404 + audit, no list returned', async () => {
    setDoc('users/user-A', { cohort: 'adult' });
    setDoc('users/user-B', { cohort: 'minor' });

    const app = createEconomyApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).get('/api/users/user-B/gift-wall');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });

    await new Promise((r) => setImmediate(r));
    expect(mockSegregationAdd).toHaveBeenCalledTimes(1);
    expect(mockSegregationAdd.mock.calls[0][0]).toMatchObject({
      sourceUniqueId: 'user-A',
      sourceCohort: 'adult',
      targetUniqueId: 'user-B',
      targetCohort: 'minor',
      action: 'blocked',
    });
    expect(mockCollectionGet).not.toHaveBeenCalled();
  });

  test('same-cohort target -> 200 + full list, no audit', async () => {
    setDoc('users/user-A', { cohort: 'adult' });
    setDoc('users/user-B', { cohort: 'adult' });
    stageGiftWallCollection('user-B', [
      { id: 'gift-1', receivedCount: 5, senders: [] },
      { id: 'gift-2', receivedCount: 3, senders: [] },
    ]);

    const app = createEconomyApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).get('/api/users/user-B/gift-wall');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ id: 'gift-1', receivedCount: 5 });
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('self-view always allowed (no cohort lookup)', async () => {
    setDoc('users/user-A', { cohort: 'adult' });
    stageGiftWallCollection('user-A', [{ id: 'gift-1', receivedCount: 1, senders: [] }]);

    const app = createEconomyApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).get('/api/users/user-A/gift-wall');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test('admin caller -> bypass, 200 even cross-cohort', async () => {
    setDoc('users/user-A', { cohort: 'adult' });
    setDoc('users/user-B', { cohort: 'minor' });
    stageGiftWallCollection('user-B', [{ id: 'gift-1', receivedCount: 10, senders: [] }]);
    mockIsLiveAdmin.mockResolvedValue(true);

    const app = createEconomyApp({ uniqueId: 'admin-1', cohort: 'adult', admin: true });
    const res = await request(app).get('/api/users/user-B/gift-wall');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('stale-admin token (live no longer admin) -> 404 blocked', async () => {
    setDoc('users/user-A', { cohort: 'adult' });
    setDoc('users/user-B', { cohort: 'minor' });
    mockIsLiveAdmin.mockResolvedValue(false);

    const app = createEconomyApp({ uniqueId: 'ex-admin', cohort: 'adult', admin: true });
    const res = await request(app).get('/api/users/user-B/gift-wall');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  test('missing target -> 404 (byte-identical existence-hiding)', async () => {
    setDoc('users/user-A', { cohort: 'adult' });

    const app = createEconomyApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).get('/api/users/user-Z/gift-wall');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  test('blocked viewer -> 403 (block check still runs after cohort pass)', async () => {
    setDoc('users/user-A', { cohort: 'adult' });
    setDoc('users/user-B', { cohort: 'adult', blockedUserIds: ['user-A'] });

    const app = createEconomyApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).get('/api/users/user-B/gift-wall');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Cannot view content of users who have blocked you' });
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });
});

describe('GET /api/users/:uniqueId/gift-wall/:giftId/senders - outer gate + inner filter', () => {
  test('cross-cohort target -> 404 + audit', async () => {
    setDoc('users/user-A', { cohort: 'adult' });
    setDoc('users/user-B', { cohort: 'minor' });

    const app = createEconomyApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).get('/api/users/user-B/gift-wall/gift-1/senders');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    await new Promise((r) => setImmediate(r));
    expect(mockSegregationAdd).toHaveBeenCalledTimes(1);
  });

  test('same-cohort target -> filter inner senders by cohort', async () => {
    setDoc('users/user-A', { cohort: 'adult' });
    setDoc('users/user-B', { cohort: 'adult' });
    setDoc('users/user-B/giftWall/gift-1', {
      giftId: 'gift-1',
      receivedCount: 30,
      senders: [
        { senderId: 's1', sendCount: 20, cohort: 'adult' },
        { senderId: 's2', sendCount: 5, cohort: 'minor' },
        { senderId: 's3', sendCount: 5, cohort: 'adult' },
      ],
    });

    const app = createEconomyApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).get('/api/users/user-B/gift-wall/gift-1/senders');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((s) => s.senderId)).toEqual(['s1', 's3']);
    expect(res.body[0]).toMatchObject({ senderId: 's1', sendCount: 20 });
  });

  test('all senders cross-cohort -> 200 + empty array (gift visible, no senders)', async () => {
    setDoc('users/user-A', { cohort: 'adult' });
    setDoc('users/user-B', { cohort: 'adult' });
    setDoc('users/user-B/giftWall/gift-1', {
      senders: [
        { senderId: 's1', sendCount: 20, cohort: 'minor' },
        { senderId: 's2', sendCount: 5, cohort: 'minor' },
      ],
    });

    const app = createEconomyApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).get('/api/users/user-B/gift-wall/gift-1/senders');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('legacy sender without cohort field -> live-lookup fallback', async () => {
    setDoc('users/user-A', { cohort: 'adult' });
    setDoc('users/user-B', { cohort: 'adult' });
    setDoc('users/s-legacy-adult', { cohort: 'adult' });
    setDoc('users/s-legacy-minor', { cohort: 'minor' });
    setDoc('users/user-B/giftWall/gift-1', {
      senders: [
        { senderId: 's-legacy-adult', sendCount: 10 },
        { senderId: 's-legacy-minor', sendCount: 8 },
      ],
    });

    const app = createEconomyApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).get('/api/users/user-B/gift-wall/gift-1/senders');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].senderId).toBe('s-legacy-adult');
  });

  test('legacy sender lookup of missing user -> drop the entry (no leak)', async () => {
    setDoc('users/user-A', { cohort: 'adult' });
    setDoc('users/user-B', { cohort: 'adult' });
    setDoc('users/user-B/giftWall/gift-1', {
      senders: [{ senderId: 's-deleted', sendCount: 99 }],
    });

    const app = createEconomyApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).get('/api/users/user-B/gift-wall/gift-1/senders');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('admin caller -> bypass outer gate AND skip inner filter (sees all senders)', async () => {
    setDoc('users/user-A', { cohort: 'adult' });
    setDoc('users/user-B', { cohort: 'minor' });
    setDoc('users/user-B/giftWall/gift-1', {
      senders: [
        { senderId: 's1', sendCount: 20, cohort: 'adult' },
        { senderId: 's2', sendCount: 10, cohort: 'minor' },
      ],
    });
    mockIsLiveAdmin.mockResolvedValue(true);

    const app = createEconomyApp({ uniqueId: 'admin-1', cohort: 'adult', admin: true });
    const res = await request(app).get('/api/users/user-B/gift-wall/gift-1/senders');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((s) => s.senderId)).toEqual(['s1', 's2']);
  });

  test('missing gift doc -> 200 + empty array (cohort-passing target)', async () => {
    setDoc('users/user-A', { cohort: 'adult' });
    setDoc('users/user-B', { cohort: 'adult' });

    const app = createEconomyApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).get('/api/users/user-B/gift-wall/gift-1/senders');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('senders sorted by sendCount desc after filter', async () => {
    setDoc('users/user-A', { cohort: 'adult' });
    setDoc('users/user-B', { cohort: 'adult' });
    setDoc('users/user-B/giftWall/gift-1', {
      senders: [
        { senderId: 's-low', sendCount: 1, cohort: 'adult' },
        { senderId: 's-mid', sendCount: 5, cohort: 'minor' },
        { senderId: 's-high', sendCount: 20, cohort: 'adult' },
      ],
    });

    const app = createEconomyApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).get('/api/users/user-B/gift-wall/gift-1/senders');

    expect(res.body.map((s) => s.senderId)).toEqual(['s-high', 's-low']);
  });
});

describe('GET /api/gift-rankings/:giftId - inner cohort filter', () => {
  test('caller-cohort filter applied; totalSent preserved as global stat', async () => {
    setDoc('giftRankings/gift-1', {
      rankings: [
        { userId: 'u1', count: 100, cohort: 'adult', displayName: 'A1', rank: 1 },
        { userId: 'u2', count: 80, cohort: 'minor', displayName: 'M1', rank: 2 },
        { userId: 'u3', count: 60, cohort: 'adult', displayName: 'A2', rank: 3 },
      ],
      totalSent: 240,
      lastUpdated: 1709913600000,
    });

    const app = createConfigApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).get('/api/gift-rankings/gift-1');

    expect(res.status).toBe(200);
    expect(res.body.rankings).toHaveLength(2);
    expect(res.body.rankings.map((r) => r.userId)).toEqual(['u1', 'u3']);
    expect(res.body.totalSent).toBe(240);
    expect(res.body.lastUpdated).toBe(1709913600000);
  });

  test('minor caller sees only minor entries', async () => {
    setDoc('giftRankings/gift-1', {
      rankings: [
        { userId: 'u1', count: 100, cohort: 'adult' },
        { userId: 'u2', count: 80, cohort: 'minor' },
        { userId: 'u3', count: 60, cohort: 'adult' },
        { userId: 'u4', count: 40, cohort: 'minor' },
      ],
      totalSent: 280,
    });

    const app = createConfigApp({ uniqueId: 'user-M', cohort: 'minor' });
    const res = await request(app).get('/api/gift-rankings/gift-1');

    expect(res.body.rankings.map((r) => r.userId)).toEqual(['u2', 'u4']);
  });

  test('admin caller -> full unfiltered list', async () => {
    setDoc('giftRankings/gift-1', {
      rankings: [
        { userId: 'u1', count: 100, cohort: 'adult' },
        { userId: 'u2', count: 80, cohort: 'minor' },
      ],
      totalSent: 180,
    });
    mockIsLiveAdmin.mockResolvedValue(true);

    const app = createConfigApp({ uniqueId: 'admin-1', cohort: 'adult', admin: true });
    const res = await request(app).get('/api/gift-rankings/gift-1');

    expect(res.body.rankings).toHaveLength(2);
  });

  test('legacy entries without cohort -> live-lookup fallback', async () => {
    setDoc('users/u-legacy-adult', { cohort: 'adult' });
    setDoc('users/u-legacy-minor', { cohort: 'minor' });
    setDoc('giftRankings/gift-1', {
      rankings: [
        { userId: 'u-legacy-adult', count: 50 },
        { userId: 'u-legacy-minor', count: 30 },
      ],
      totalSent: 80,
    });

    const app = createConfigApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).get('/api/gift-rankings/gift-1');

    expect(res.body.rankings).toHaveLength(1);
    expect(res.body.rankings[0].userId).toBe('u-legacy-adult');
  });

  test('legacy entry pointing to deleted user -> dropped (no existence leak)', async () => {
    setDoc('giftRankings/gift-1', {
      rankings: [{ userId: 'u-deleted', count: 99 }],
      totalSent: 99,
    });

    const app = createConfigApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).get('/api/gift-rankings/gift-1');

    expect(res.body.rankings).toEqual([]);
    expect(res.body.totalSent).toBe(99);
  });

  test('missing rankings doc -> 200 + empty rankings + zero totals', async () => {
    const app = createConfigApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).get('/api/gift-rankings/gift-1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      rankings: [],
      totalSent: 0,
      lastUpdated: null,
    });
  });

  test('all entries filtered -> 200 + empty rankings + preserved totalSent', async () => {
    setDoc('giftRankings/gift-1', {
      rankings: [
        { userId: 'u1', count: 100, cohort: 'minor' },
        { userId: 'u2', count: 50, cohort: 'minor' },
      ],
      totalSent: 150,
    });

    const app = createConfigApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app).get('/api/gift-rankings/gift-1');

    expect(res.body.rankings).toEqual([]);
    expect(res.body.totalSent).toBe(150);
  });

  test('caller with no cohort claim -> no entries returned (fail-closed)', async () => {
    setDoc('giftRankings/gift-1', {
      rankings: [{ userId: 'u1', count: 100, cohort: 'adult' }],
      totalSent: 100,
    });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = {
        uid: 'firebase-uid-x',
        uniqueId: 'user-X',
        token: {},
      };
      next();
    });
    app.use('/api', configRouter);

    const res = await request(app).get('/api/gift-rankings/gift-1');
    expect(res.body.rankings).toEqual([]);
  });
});

describe('Write-time cohort snapshot - PR 10 forward-compat', () => {
  test('updateGiftRankings stamps recipient cohort on first send', async () => {
    setDoc('config/economy', {
      beanConversionRate: 0.6,
      beanRedeemBonusThreshold: 2000,
      beanRedeemBonusMultiplier: 1.1,
      pullCosts: { 1: 10, 10: 100, 100: 1000 },
      broadcastSendThreshold: 0,
      broadcastWinThreshold: 5000,
      dailyBase: 50,
    });
    setDoc('users/user-A', { cohort: 'adult', shyCoins: 1000 });
    setDoc('users/user-B', { cohort: 'adult', shyBeans: 0, displayName: 'B' });
    setDoc('gifts/gift-1', { coinValue: 10, name: 'Rose' });
    setDoc('users/user-A/backpack/gift-1', { quantity: 5 });

    const app = createEconomyApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/economy/gift')
      .send({ recipientId: 'user-B', giftId: 'gift-1', quantity: 1 });

    expect(res.status).toBe(200);

    const rankingsSetCall = mockDocSet.mock.calls.find((c) => c[0] === 'giftRankings/gift-1');
    expect(rankingsSetCall).toBeDefined();
    const payload = rankingsSetCall[1];
    expect(payload.rankings).toHaveLength(1);
    expect(payload.rankings[0]).toMatchObject({
      userId: 'user-B',
      count: 1,
      cohort: 'adult',
    });
  });

  test('updateGiftWall stamps sender cohort on first send', async () => {
    setDoc('config/economy', {
      beanConversionRate: 0.6,
      beanRedeemBonusThreshold: 2000,
      beanRedeemBonusMultiplier: 1.1,
      pullCosts: { 1: 10, 10: 100, 100: 1000 },
      broadcastSendThreshold: 0,
      broadcastWinThreshold: 5000,
      dailyBase: 50,
    });
    setDoc('users/user-A', { cohort: 'adult', shyCoins: 1000 });
    setDoc('users/user-B', { cohort: 'adult', shyBeans: 0, displayName: 'B' });
    setDoc('gifts/gift-1', { coinValue: 10, name: 'Rose' });
    setDoc('users/user-A/backpack/gift-1', { quantity: 5 });

    const app = createEconomyApp({ uniqueId: 'user-A', cohort: 'adult' });
    await request(app)
      .post('/api/economy/gift')
      .send({ recipientId: 'user-B', giftId: 'gift-1', quantity: 1 });

    const wallSetCall = mockDocSet.mock.calls.find((c) => c[0] === 'users/user-B/giftWall/gift-1');
    expect(wallSetCall).toBeDefined();
    const payload = wallSetCall[1];
    expect(payload.senders).toHaveLength(1);
    expect(payload.senders[0]).toMatchObject({
      senderId: 'user-A',
      sendCount: 1,
      cohort: 'adult',
    });
  });
});

describe('Audit dedup for gift-wall outer gate', () => {
  test('repeat (source, target, surface) within window -> single audit doc', async () => {
    setDoc('users/user-A', { cohort: 'adult' });
    setDoc('users/user-B', { cohort: 'minor' });

    const app = createEconomyApp({ uniqueId: 'user-A', cohort: 'adult' });
    await request(app).get('/api/users/user-B/gift-wall');
    await request(app).get('/api/users/user-B/gift-wall');
    await request(app).get('/api/users/user-B/gift-wall');

    await new Promise((r) => setImmediate(r));
    expect(mockSegregationAdd).toHaveBeenCalledTimes(1);
  });

  test('different target -> fresh audit', async () => {
    setDoc('users/user-A', { cohort: 'adult' });
    setDoc('users/user-B', { cohort: 'minor' });
    setDoc('users/user-C', { cohort: 'minor' });

    const app = createEconomyApp({ uniqueId: 'user-A', cohort: 'adult' });
    await request(app).get('/api/users/user-B/gift-wall');
    await request(app).get('/api/users/user-C/gift-wall');

    await new Promise((r) => setImmediate(r));
    expect(mockSegregationAdd).toHaveBeenCalledTimes(2);
  });
});

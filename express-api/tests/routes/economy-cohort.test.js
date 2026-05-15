/**
 * UK OSA #17 PR 9 — `requireSameCohort` route-wiring tests for
 * `routes/economy.js`.
 *
 *   POST /api/economy/gift          → backpack gift to single recipient
 *   POST /api/economy/gift-direct   → coin gift to single recipient
 *   POST /api/economy/gift-batch    → batch send (whole-batch refusal on first
 *                                     cross-cohort recipient — mirrors the
 *                                     existing block-check refusal pattern,
 *                                     but with 404 instead of 403 for
 *                                     existence-hiding)
 *   POST /api/economy/backpack-send → whole-backpack transfer
 *
 * Each route asserts:
 *   • cross-cohort recipient → 404 `{ error: 'Not found' }` + audit doc +
 *     NO side-effects (no doc mutations, no transactions, no batches)
 *   • same-cohort recipient → 200 success + NO audit doc
 *   • missing recipient → byte-identical 404 `{ error: 'Not found' }`
 *     (existence-hiding; subsumed by the middleware)
 *   • admin actor with live admin claim → bypass, 200 even cross-cohort
 *   • stale-admin token (live no longer admin) → blocked
 *   • self-send → 400 (existing behaviour; cohort gate is a no-op for self)
 *
 * Plus surface-specific invariants:
 *   • batch with mixed cohorts → whole batch refused, audit fires only for
 *     the offending recipient
 *   • audit dedup window — same (source, target, surface) triple twice in
 *     5 min writes only once (DoS defence on Spark-tier Firestore quota)
 */

const express = require('express');
const request = require('supertest');

// ─── Path-aware Firebase mocks ───────────────────────────────────

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();
const mockBatchSet = jest.fn();
const mockBatchUpdate = jest.fn();
const mockBatchDelete = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();
const mockRunTransaction = jest.fn();
const mockSegregationAdd = jest.fn().mockResolvedValue({ id: 'evt_1' });
const mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });

// Per-test doc staging — set up specific docs by path. Anything not
// staged returns `exists: false`, matching Firestore behaviour.
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
      delete: () => mockDocDelete(path),
    })),
    collection: jest.fn((name) => {
      if (name === 'segregationEvents') {
        return { add: mockSegregationAdd };
      }
      return {
        get: mockCollectionGet,
        count: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({ data: () => ({ count: 0 }) }),
        })),
        where: jest.fn(() => ({
          limit: jest.fn(() => ({ get: mockCollectionGet })),
          orderBy: jest.fn(() => ({
            limit: jest.fn(() => ({ get: mockCollectionGet })),
          })),
        })),
        orderBy: jest.fn(() => ({
          limit: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({ docs: [] }),
          })),
          get: jest.fn().mockResolvedValue({ docs: [] }),
        })),
      };
    }),
    batch: jest.fn(() => ({
      set: mockBatchSet,
      update: mockBatchUpdate,
      delete: mockBatchDelete,
      commit: mockBatchCommit,
    })),
    runTransaction: (...args) => mockRunTransaction(...args),
  },
  FieldValue: {
    increment: jest.fn((n) => `increment(${n})`),
    arrayUnion: jest.fn((...args) => `arrayUnion(${args})`),
    arrayRemove: jest.fn((...args) => `arrayRemove(${args})`),
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

beforeEach(() => {
  jest.clearAllMocks();
  // mockReset drains queued mockResolvedValueOnce / mockImplementation —
  // clearAllMocks does not. Without this, stale impls bleed into next test.
  mockDocGet.mockReset();
  mockDocUpdate.mockReset();
  mockDocSet.mockReset();
  mockDocDelete.mockReset();
  mockBatchSet.mockReset();
  mockBatchUpdate.mockReset();
  mockBatchDelete.mockReset();
  mockBatchCommit.mockReset();
  mockRunTransaction.mockReset();
  mockSegregationAdd.mockReset();
  mockIsLiveAdmin.mockReset();
  _resetAuditDedup();
  clearDocs();
  economyRouter._resetConfigCache?.();

  // Defaults restored after reset.
  mockBatchCommit.mockResolvedValue();
  mockDocSet.mockResolvedValue();
  mockDocUpdate.mockResolvedValue();
  mockDocDelete.mockResolvedValue();
  mockSegregationAdd.mockResolvedValue({ id: 'evt_1' });
  mockIsLiveAdmin.mockResolvedValue(true);

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

  // Transaction reads honor the same staged docs as direct gets, so the
  // atomic-debit branches in /economy/gift, /gift-direct, /gift-batch all
  // see the seeded coin / backpack quantities.
  mockRunTransaction.mockImplementation(async (cb) => {
    const tx = {
      get: jest.fn((ref) => {
        const path = ref?._path;
        if (path && docResponses.has(path)) {
          const data = docResponses.get(path);
          return Promise.resolve({
            exists: data !== undefined && data !== null,
            data: () => data,
          });
        }
        return Promise.resolve({ exists: false, data: () => null });
      }),
      update: jest.fn(),
      delete: jest.fn(),
      set: jest.fn(),
    };
    return cb(tx);
  });
});

function createApp({ uniqueId = 'user-A', cohort = 'adult', admin = false } = {}) {
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

function seedEconomyConfig() {
  setDoc('config/economy', {
    beanConversionRate: 0.6,
    beanRedeemBonusThreshold: 2000,
    beanRedeemBonusMultiplier: 1.1,
    pullCosts: { 1: 10, 10: 100, 100: 1000 },
    broadcastSendThreshold: 0,
    broadcastWinThreshold: 5000,
    dailyBase: 50,
  });
}

// ═══════════════════════════════════════════════════════════════════
// POST /api/economy/gift  (backpack-source single recipient)
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/economy/gift — cross-cohort gate', () => {
  test('adult sending to minor → 404 + audit, no side-effects', async () => {
    seedEconomyConfig();
    setDoc('users/user-A', { cohort: 'adult', shyCoins: 1000 });
    setDoc('users/user-B', { cohort: 'minor', shyBeans: 0 });
    setDoc('gifts/gift-1', { coinValue: 10, name: 'Rose' });
    setDoc('users/user-A/backpack/gift-1', { quantity: 5 });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/economy/gift')
      .send({ recipientId: 'user-B', giftId: 'gift-1', quantity: 1 });

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

    // No side-effects: no doc mutations, no transactions, no batches.
    expect(mockDocUpdate).not.toHaveBeenCalled();
    expect(mockDocSet).not.toHaveBeenCalled();
    expect(mockDocDelete).not.toHaveBeenCalled();
    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  test('same-cohort proceeds, no audit', async () => {
    seedEconomyConfig();
    setDoc('users/user-A', { cohort: 'adult', shyCoins: 1000 });
    setDoc('users/user-B', { cohort: 'adult', shyBeans: 0 });
    setDoc('gifts/gift-1', { coinValue: 10, name: 'Rose' });
    setDoc('users/user-A/backpack/gift-1', { quantity: 5 });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/economy/gift')
      .send({ recipientId: 'user-B', giftId: 'gift-1', quantity: 1 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('missing recipient → 404 Not found (byte-identical to cross-cohort)', async () => {
    seedEconomyConfig();
    setDoc('users/user-A', { cohort: 'adult', shyCoins: 1000 });
    setDoc('gifts/gift-1', { coinValue: 10, name: 'Rose' });
    setDoc('users/user-A/backpack/gift-1', { quantity: 5 });
    // No setDoc for users/user-B → exists: false.

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/economy/gift')
      .send({ recipientId: 'user-B', giftId: 'gift-1', quantity: 1 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('admin (live) cross-cohort → 200 bypass, no audit', async () => {
    seedEconomyConfig();
    setDoc('users/admin-X', { cohort: 'adult', shyCoins: 1000 });
    setDoc('users/user-M', { cohort: 'minor', shyBeans: 0 });
    setDoc('gifts/gift-1', { coinValue: 10, name: 'Rose' });
    setDoc('users/admin-X/backpack/gift-1', { quantity: 5 });
    mockIsLiveAdmin.mockResolvedValue(true);

    const app = createApp({ uniqueId: 'admin-X', cohort: 'adult', admin: true });
    const res = await request(app)
      .post('/api/economy/gift')
      .send({ recipientId: 'user-M', giftId: 'gift-1', quantity: 1 });

    expect(res.status).toBe(200);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('stale-admin token (live revoked) → blocked', async () => {
    seedEconomyConfig();
    setDoc('users/stale-X', { cohort: 'adult', shyCoins: 1000 });
    setDoc('users/user-M', { cohort: 'minor' });
    setDoc('gifts/gift-1', { coinValue: 10, name: 'Rose' });
    setDoc('users/stale-X/backpack/gift-1', { quantity: 5 });
    mockIsLiveAdmin.mockResolvedValue(false);

    const app = createApp({ uniqueId: 'stale-X', cohort: 'adult', admin: true });
    const res = await request(app)
      .post('/api/economy/gift')
      .send({ recipientId: 'user-M', giftId: 'gift-1', quantity: 1 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  test('self-send returns 400 (cohort gate is a no-op for self)', async () => {
    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/economy/gift')
      .send({ recipientId: 'user-A', giftId: 'gift-1', quantity: 1 });

    expect(res.status).toBe(400);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/economy/gift-direct  (coin-source single recipient)
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/economy/gift-direct — cross-cohort gate', () => {
  test('adult sending to minor → 404 + audit, no side-effects', async () => {
    seedEconomyConfig();
    setDoc('users/user-A', { cohort: 'adult', shyCoins: 1000 });
    setDoc('users/user-B', { cohort: 'minor', shyBeans: 0 });
    setDoc('gifts/gift-1', { coinValue: 10, name: 'Rose' });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/economy/gift-direct')
      .send({ recipientId: 'user-B', giftId: 'gift-1', quantity: 1 });

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

    // Atomic coin-debit transaction must NOT have run.
    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(mockDocUpdate).not.toHaveBeenCalled();
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  test('same-cohort proceeds, no audit', async () => {
    seedEconomyConfig();
    setDoc('users/user-A', { cohort: 'adult', shyCoins: 1000 });
    setDoc('users/user-B', { cohort: 'adult', shyBeans: 0 });
    setDoc('gifts/gift-1', { coinValue: 10, name: 'Rose' });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/economy/gift-direct')
      .send({ recipientId: 'user-B', giftId: 'gift-1', quantity: 1 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('missing recipient → 404 Not found (existence-hiding)', async () => {
    seedEconomyConfig();
    setDoc('users/user-A', { cohort: 'adult', shyCoins: 1000 });
    setDoc('gifts/gift-1', { coinValue: 10, name: 'Rose' });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/economy/gift-direct')
      .send({ recipientId: 'user-B', giftId: 'gift-1', quantity: 1 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('admin (live) cross-cohort → 200 bypass', async () => {
    seedEconomyConfig();
    setDoc('users/admin-X', { cohort: 'adult', shyCoins: 1000 });
    setDoc('users/user-M', { cohort: 'minor', shyBeans: 0 });
    setDoc('gifts/gift-1', { coinValue: 10, name: 'Rose' });
    mockIsLiveAdmin.mockResolvedValue(true);

    const app = createApp({ uniqueId: 'admin-X', cohort: 'adult', admin: true });
    const res = await request(app)
      .post('/api/economy/gift-direct')
      .send({ recipientId: 'user-M', giftId: 'gift-1', quantity: 1 });

    expect(res.status).toBe(200);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('stale-admin token → blocked', async () => {
    seedEconomyConfig();
    setDoc('users/stale-X', { cohort: 'adult', shyCoins: 1000 });
    setDoc('users/user-M', { cohort: 'minor' });
    setDoc('gifts/gift-1', { coinValue: 10, name: 'Rose' });
    mockIsLiveAdmin.mockResolvedValue(false);

    const app = createApp({ uniqueId: 'stale-X', cohort: 'adult', admin: true });
    const res = await request(app)
      .post('/api/economy/gift-direct')
      .send({ recipientId: 'user-M', giftId: 'gift-1', quantity: 1 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  test('self-send returns 400', async () => {
    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/economy/gift-direct')
      .send({ recipientId: 'user-A', giftId: 'gift-1', quantity: 1 });

    expect(res.status).toBe(400);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/economy/gift-batch  (multi-recipient — whole-batch refusal)
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/economy/gift-batch — cross-cohort gate', () => {
  test('all cross-cohort → 404 + audit, no side-effects', async () => {
    seedEconomyConfig();
    setDoc('users/user-A', { cohort: 'adult', shyCoins: 10000 });
    setDoc('users/M1', { cohort: 'minor', shyBeans: 0 });
    setDoc('users/M2', { cohort: 'minor', shyBeans: 0 });
    setDoc('gifts/gift-1', { coinValue: 10, name: 'Rose' });
    setDoc('users/user-A/backpack/gift-1', { quantity: 100 });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/economy/gift-batch')
      .send({
        recipientIds: ['M1', 'M2'],
        giftId: 'gift-1',
        quantity: 1,
        fromBackpack: true,
      });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });

    await new Promise((r) => setImmediate(r));
    // Whole-batch refusal — only first cross-cohort recipient is audited
    // (gate short-circuits, mirroring the existing block-check loop).
    expect(mockSegregationAdd).toHaveBeenCalledTimes(1);
    expect(mockSegregationAdd.mock.calls[0][0]).toMatchObject({
      sourceUniqueId: 'user-A',
      targetUniqueId: 'M1',
      action: 'blocked',
    });
    expect(mockBatchCommit).not.toHaveBeenCalled();
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  test('mixed batch (same + cross) → whole batch refused with 404', async () => {
    seedEconomyConfig();
    setDoc('users/user-A', { cohort: 'adult', shyCoins: 10000 });
    setDoc('users/B-adult', { cohort: 'adult', shyBeans: 0 });
    setDoc('users/C-minor', { cohort: 'minor', shyBeans: 0 });
    setDoc('gifts/gift-1', { coinValue: 10, name: 'Rose' });
    setDoc('users/user-A/backpack/gift-1', { quantity: 100 });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/economy/gift-batch')
      .send({
        recipientIds: ['B-adult', 'C-minor'],
        giftId: 'gift-1',
        quantity: 1,
        fromBackpack: true,
      });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });

    await new Promise((r) => setImmediate(r));
    // Exactly one audit doc — for the cross-cohort recipient only.
    expect(mockSegregationAdd).toHaveBeenCalledTimes(1);
    expect(mockSegregationAdd.mock.calls[0][0].targetUniqueId).toBe('C-minor');
    // CRITICAL: same-cohort recipient B-adult MUST NOT have been credited.
    expect(mockBatchCommit).not.toHaveBeenCalled();
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  test('all same-cohort proceeds, no audit', async () => {
    seedEconomyConfig();
    setDoc('users/user-A', { cohort: 'adult', shyCoins: 10000 });
    setDoc('users/B1', { cohort: 'adult', shyBeans: 0 });
    setDoc('users/B2', { cohort: 'adult', shyBeans: 0 });
    setDoc('gifts/gift-1', { coinValue: 10, name: 'Rose' });
    setDoc('users/user-A/backpack/gift-1', { quantity: 100 });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/economy/gift-batch')
      .send({
        recipientIds: ['B1', 'B2'],
        giftId: 'gift-1',
        quantity: 1,
        fromBackpack: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('admin (live) cross-cohort batch → 200 bypass', async () => {
    seedEconomyConfig();
    setDoc('users/admin-X', { cohort: 'adult', shyCoins: 10000 });
    setDoc('users/M1', { cohort: 'minor', shyBeans: 0 });
    setDoc('gifts/gift-1', { coinValue: 10, name: 'Rose' });
    setDoc('users/admin-X/backpack/gift-1', { quantity: 100 });
    mockIsLiveAdmin.mockResolvedValue(true);

    const app = createApp({ uniqueId: 'admin-X', cohort: 'adult', admin: true });
    const res = await request(app)
      .post('/api/economy/gift-batch')
      .send({
        recipientIds: ['M1'],
        giftId: 'gift-1',
        quantity: 1,
        fromBackpack: true,
      });

    expect(res.status).toBe(200);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('self in recipientIds returns 400 (existing behavior preserved)', async () => {
    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/economy/gift-batch')
      .send({
        recipientIds: ['user-A'],
        giftId: 'gift-1',
        quantity: 1,
      });

    expect(res.status).toBe(400);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('all-missing recipients → 404 Not found (existence-hiding pre-check)', async () => {
    // PR 9 — C2 fix: the `validRecipients.length === 0` short-circuit
    // must return the same byte-identical body as the cohort gate so an
    // attacker can't distinguish "all recipients absent" from "at least
    // one cross-cohort recipient".
    seedEconomyConfig();
    setDoc('users/user-A', { cohort: 'adult', shyCoins: 10000 });
    setDoc('gifts/gift-1', { coinValue: 10, name: 'Rose' });
    setDoc('users/user-A/backpack/gift-1', { quantity: 100 });
    // No setDoc for any recipient → all exists: false.

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/economy/gift-batch')
      .send({
        recipientIds: ['ghost-1', 'ghost-2'],
        giftId: 'gift-1',
        quantity: 1,
        fromBackpack: true,
      });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    // Pre-check fires before the gate loop — no audit doc written.
    expect(mockSegregationAdd).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  test('one missing + one same-cohort → 404 (existence-hiding, no carrier-attack)', async () => {
    // PR 9 — security-review MEDIUM: do NOT skip missing recipients in
    // the gate loop. Otherwise an attacker pairs a known same-cohort
    // "carrier" with any target to probe existence+cohort: 200 ↔
    // missing-or-same-cohort, 404 ↔ cross-cohort. We collapse the
    // missing path into the gate's 404 to close the side-channel,
    // even at the UX cost of refusing a batch with a typo in it.
    seedEconomyConfig();
    setDoc('users/user-A', { cohort: 'adult', shyCoins: 10000 });
    setDoc('users/B-adult', { cohort: 'adult', shyBeans: 0 });
    setDoc('gifts/gift-1', { coinValue: 10, name: 'Rose' });
    setDoc('users/user-A/backpack/gift-1', { quantity: 100 });
    // No setDoc for ghost-1 → exists: false (the attack vector).

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/economy/gift-batch')
      .send({
        recipientIds: ['ghost-1', 'B-adult'],
        giftId: 'gift-1',
        quantity: 1,
        fromBackpack: true,
      });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    // No side-effects: B-adult must NOT have been credited even though
    // they are a same-cohort recipient.
    expect(mockBatchCommit).not.toHaveBeenCalled();
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  test('one missing + one cross-cohort → 404, missing slot short-circuits first', async () => {
    // Mirror existence-hiding: the missing slot at index 0 fires the
    // gate first (audit doc for ghost-1), batch refused before reaching
    // C-minor. The audit-dedup window ensures the same target wouldn't
    // double-audit on retry.
    seedEconomyConfig();
    setDoc('users/user-A', { cohort: 'adult', shyCoins: 10000 });
    setDoc('users/C-minor', { cohort: 'minor', shyBeans: 0 });
    setDoc('gifts/gift-1', { coinValue: 10, name: 'Rose' });
    setDoc('users/user-A/backpack/gift-1', { quantity: 100 });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/economy/gift-batch')
      .send({
        recipientIds: ['ghost-1', 'C-minor'],
        giftId: 'gift-1',
        quantity: 1,
        fromBackpack: true,
      });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    // Note: missing recipient hits the middleware's `if (!targetDoc)`
    // branch which emits 404 but does NOT write audit (no caller/target
    // cohort comparison happens). So zero audit docs.
    await new Promise((r) => setImmediate(r));
    expect(mockSegregationAdd).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  test('stale-admin token batch → whole batch refused with 404', async () => {
    // PR 9 — gate-site coverage parity: the batch route's gate runs
    // inside a loop (structurally distinct from single-target call
    // sites). Pin live-admin re-verification at the loop site.
    seedEconomyConfig();
    setDoc('users/stale-X', { cohort: 'adult', shyCoins: 10000 });
    setDoc('users/user-M', { cohort: 'minor' });
    setDoc('gifts/gift-1', { coinValue: 10, name: 'Rose' });
    setDoc('users/stale-X/backpack/gift-1', { quantity: 100 });
    mockIsLiveAdmin.mockResolvedValue(false);

    const app = createApp({ uniqueId: 'stale-X', cohort: 'adult', admin: true });
    const res = await request(app)
      .post('/api/economy/gift-batch')
      .send({
        recipientIds: ['user-M'],
        giftId: 'gift-1',
        quantity: 1,
        fromBackpack: true,
      });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    await new Promise((r) => setImmediate(r));
    expect(mockSegregationAdd).toHaveBeenCalledTimes(1);
    expect(mockSegregationAdd.mock.calls[0][0]).toMatchObject({
      sourceUniqueId: 'stale-X',
      targetUniqueId: 'user-M',
      action: 'blocked',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/economy/backpack-send  (whole-backpack transfer)
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/economy/backpack-send — cross-cohort gate', () => {
  test('adult sending whole backpack to minor → 404 + audit, no side-effects', async () => {
    seedEconomyConfig();
    setDoc('users/user-A', { cohort: 'adult' });
    setDoc('users/user-B', { cohort: 'minor', shyBeans: 0 });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/economy/backpack-send')
      .send({ recipientId: 'user-B' });

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

    expect(mockBatchCommit).not.toHaveBeenCalled();
    expect(mockDocUpdate).not.toHaveBeenCalled();
    expect(mockDocDelete).not.toHaveBeenCalled();
  });

  test('same-cohort proceeds, no audit', async () => {
    seedEconomyConfig();
    setDoc('users/user-A', { cohort: 'adult' });
    setDoc('users/user-B', { cohort: 'adult', shyBeans: 0 });
    // Empty backpack returns 400 'Backpack is empty' — to reach 200 we need
    // at least one sendable item. The collection mock returns empty docs
    // by default; for this test we override the backpack collection get.
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: 'gift-1',
          data: () => ({ giftId: 'gift-1', quantity: 2, coinValue: 10 }),
        },
      ],
    });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/economy/backpack-send')
      .send({ recipientId: 'user-B' });

    expect(res.status).toBe(200);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('missing recipient → 404 Not found (existence-hiding)', async () => {
    seedEconomyConfig();
    setDoc('users/user-A', { cohort: 'adult' });
    // No setDoc for users/user-B → exists: false.

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/economy/backpack-send')
      .send({ recipientId: 'user-B' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('admin (live) cross-cohort → 200 bypass', async () => {
    seedEconomyConfig();
    setDoc('users/admin-X', { cohort: 'adult' });
    setDoc('users/user-M', { cohort: 'minor', shyBeans: 0 });
    mockIsLiveAdmin.mockResolvedValue(true);
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: 'gift-1',
          data: () => ({ giftId: 'gift-1', quantity: 1, coinValue: 5 }),
        },
      ],
    });

    const app = createApp({ uniqueId: 'admin-X', cohort: 'adult', admin: true });
    const res = await request(app)
      .post('/api/economy/backpack-send')
      .send({ recipientId: 'user-M' });

    expect(res.status).toBe(200);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('stale-admin token → blocked', async () => {
    seedEconomyConfig();
    setDoc('users/stale-X', { cohort: 'adult' });
    setDoc('users/user-M', { cohort: 'minor' });
    mockIsLiveAdmin.mockResolvedValue(false);

    const app = createApp({ uniqueId: 'stale-X', cohort: 'adult', admin: true });
    const res = await request(app)
      .post('/api/economy/backpack-send')
      .send({ recipientId: 'user-M' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  test('self-send returns 400', async () => {
    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    const res = await request(app)
      .post('/api/economy/backpack-send')
      .send({ recipientId: 'user-A' });

    expect(res.status).toBe(400);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Cross-route invariants
// ═══════════════════════════════════════════════════════════════════

describe('audit dedup window — quota DoS defence', () => {
  test('same (source, target, surface) tuple twice in 5min writes once', async () => {
    seedEconomyConfig();
    setDoc('users/user-A', { cohort: 'adult', shyCoins: 1000 });
    setDoc('users/user-B', { cohort: 'minor' });
    setDoc('gifts/gift-1', { coinValue: 10, name: 'Rose' });
    setDoc('users/user-A/backpack/gift-1', { quantity: 100 });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    await request(app)
      .post('/api/economy/gift')
      .send({ recipientId: 'user-B', giftId: 'gift-1', quantity: 1 });
    await request(app)
      .post('/api/economy/gift')
      .send({ recipientId: 'user-B', giftId: 'gift-1', quantity: 1 });
    await new Promise((r) => setImmediate(r));

    // Two cross-cohort 404s but only ONE audit doc — dedup defends the
    // Spark-tier write quota against retry spam.
    expect(mockSegregationAdd).toHaveBeenCalledTimes(1);
  });

  test('different surfaces still dedup independently', async () => {
    seedEconomyConfig();
    setDoc('users/user-A', { cohort: 'adult', shyCoins: 1000 });
    setDoc('users/user-B', { cohort: 'minor', shyBeans: 0 });
    setDoc('gifts/gift-1', { coinValue: 10, name: 'Rose' });
    setDoc('users/user-A/backpack/gift-1', { quantity: 100 });

    const app = createApp({ uniqueId: 'user-A', cohort: 'adult' });
    await request(app)
      .post('/api/economy/gift')
      .send({ recipientId: 'user-B', giftId: 'gift-1', quantity: 1 });
    await request(app)
      .post('/api/economy/gift-direct')
      .send({ recipientId: 'user-B', giftId: 'gift-1', quantity: 1 });
    await new Promise((r) => setImmediate(r));

    // Two distinct surfaces → two audit docs (dedup is per-surface).
    expect(mockSegregationAdd).toHaveBeenCalledTimes(2);
  });
});

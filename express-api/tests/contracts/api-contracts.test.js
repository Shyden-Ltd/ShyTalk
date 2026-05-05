/**
 * API Contract tests — verify response JSON shapes match what the Kotlin client expects.
 * These tests catch silent breaking changes when routes are modified.
 *
 * Tests assert that specific fields EXIST and have the correct TYPE.
 * They do NOT assert specific values, which allows fixture data to vary freely.
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock ────────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();
const mockRunTransaction = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: (...args) => mockDocGet(path, ...args),
      update: (...args) => mockDocUpdate(path, ...args),
      set: (...args) => mockDocSet(path, ...args),
    })),
    collection: jest.fn(() => {
      const chain = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      };
      return chain;
    }),
    batch: jest.fn(() => ({
      set: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      commit: jest.fn().mockResolvedValue(),
    })),
    runTransaction: mockRunTransaction,
    getAll: jest.fn().mockResolvedValue([]),
  },
  auth: {
    setCustomUserClaims: jest.fn().mockResolvedValue(),
  },
  FieldValue: {
    increment: jest.fn((n) => `increment(${n})`),
    arrayUnion: jest.fn((...args) => `arrayUnion(${args})`),
    arrayRemove: jest.fn((...args) => `arrayRemove(${args})`),
  },
  rtdb: {
    ref: jest.fn(() => ({ set: jest.fn().mockResolvedValue() })),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'contract-test-id'),
  now: jest.fn(() => 1709913600000),
  todayStr: jest.fn(() => '2024-03-08'),
  yesterdayStr: jest.fn(() => '2024-03-07'),
  getExtension: jest.fn(() => 'jpg'),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/utils/firestore-helpers', () => ({
  getDoc: jest.fn(),
  queryDocs: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn(() => false),
  clearSuspensionCache: jest.fn(),
  updateUniqueIdCache: jest.fn(),
}));

jest.mock('../../src/utils/fcm', () => ({
  sendFcmToTokens: jest.fn().mockResolvedValue([]),
  cleanupInvalidTokens: jest.fn().mockResolvedValue(),
}));

jest.mock('../../src/utils/playStore', () => ({
  verifyProductPurchase: jest.fn().mockResolvedValue({ valid: true, orderId: 'order-1' }),
  verifySubscription: jest.fn().mockResolvedValue({ valid: true }),
}));

const { getDoc } = require('../../src/utils/firestore-helpers');

// ─── Routers ─────────────────────────────────────────────────────

const usersRouter = require('../../src/routes/users');
const economyRouter = require('../../src/routes/economy');
const roomsRouter = require('../../src/routes/rooms');
const conversationsRouter = require('../../src/routes/conversations');

// ─── App factory ─────────────────────────────────────────────────

function createApp(uniqueId = 10000001) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'firebase-uid', uniqueId, token: { admin: false } };
    next();
  });
  app.use('/api', usersRouter);
  app.use('/api', economyRouter);
  app.use('/api', roomsRouter);
  app.use('/api', conversationsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Drain mockResolvedValueOnce queues + clear implementations.
  mockDocGet.mockReset();
  mockDocUpdate.mockReset();
  mockDocSet.mockReset();
  mockDocUpdate.mockResolvedValue();
  mockDocSet.mockResolvedValue();
  // Default tx mock — invokes the callback with a tx whose get/update
  // route through the existing mockDocGet/mockDocUpdate/mockDocSet,
  // so existing tests that mock those work unchanged with the new
  // tx-based daily-reward / purchase / etc. routes (PR #485-#489).
  mockRunTransaction.mockReset();
  mockRunTransaction.mockImplementation(async (cb) => {
    const tx = {
      get: (ref) => mockDocGet(ref?._path),
      update: (ref, data) => mockDocUpdate(ref?._path, data),
      set: (ref, data) => mockDocSet(ref?._path, data),
      delete: jest.fn(),
    };
    return cb(tx);
  });
  // Reset the economy config cache between tests
  try {
    economyRouter._resetConfigCache();
  } catch (_e) {
    /* ignore */
  }
});

// ─── GET /api/users/:uniqueId — user profile contract ─────────────

describe('GET /api/users/:uniqueId response contract', () => {
  const userFixture = {
    uniqueId: 10000001,
    firebaseUid: 'firebase-uid',
    displayName: 'Test User',
    email: 'test@example.com',
    profilePhotoUrl: 'https://images.shytalk.shyden.co.uk/photo.jpg',
    coverPhotoUrl: null,
    dateOfBirth: '1990-01-01',
    shyCoins: 500,
    shyBeans: 100,
    userType: 'MEMBER',
    blockedUserIds: [],
    followingIds: [],
    followerIds: [],
    providers: [
      { type: 'google', identifier: 'google-sub-123', active: true, linkedAt: 1709913600000 },
    ],
    fcmTokens: [],
    pinHash: '$2b$10$fakehash',
    aliases: {},
    language: 'en',
    stalkerCount: 0,
    newStalkerCount: 0,
    createdAt: 1709913600000,
    lastSeenAt: 1709913600000,
    // Admin-only fields that should be stripped
    gcsScore: 85,
    gcsLastDeductionAt: 1700000000000,
    gcsDisplayScore: 90,
    warningCount: 1,
    warningIssuedAt: 1700000000000,
    hasNewWarning: false,
  };

  beforeEach(() => {
    getDoc.mockResolvedValue(userFixture);
  });

  it('returns 200 with the user document', async () => {
    const app = createApp();
    const res = await request(app).get('/api/users/10000001');
    expect(res.status).toBe(200);
  });

  it('response contains uniqueId as a number', async () => {
    const app = createApp();
    const res = await request(app).get('/api/users/10000001');
    expect(typeof res.body.uniqueId).toBe('number');
  });

  it('response contains displayName as a string', async () => {
    const app = createApp();
    const res = await request(app).get('/api/users/10000001');
    expect(typeof res.body.displayName).toBe('string');
  });

  it('response strips sensitive PII fields', async () => {
    const app = createApp();
    const res = await request(app).get('/api/users/10000001');
    expect('dateOfBirth' in res.body).toBe(false);
    expect('pinHash' in res.body).toBe(false);
    expect('fcmTokens' in res.body).toBe(false);
    expect('firebaseUid' in res.body).toBe(false);
    expect('email' in res.body).toBe(false);
  });

  it('response strips identifier from providers', async () => {
    const app = createApp();
    const res = await request(app).get('/api/users/10000001');
    expect(Array.isArray(res.body.providers)).toBe(true);
    for (const provider of res.body.providers) {
      expect('identifier' in provider).toBe(false);
      expect('type' in provider).toBe(true);
    }
  });

  it('response contains shyCoins as a number', async () => {
    const app = createApp();
    const res = await request(app).get('/api/users/10000001');
    expect(typeof res.body.shyCoins).toBe('number');
  });

  it('response contains shyBeans as a number', async () => {
    const app = createApp();
    const res = await request(app).get('/api/users/10000001');
    expect(typeof res.body.shyBeans).toBe('number');
  });

  it('response contains profilePhotoUrl', async () => {
    const app = createApp();
    const res = await request(app).get('/api/users/10000001');
    expect('profilePhotoUrl' in res.body).toBe(true);
  });

  it('response contains userType as a string', async () => {
    const app = createApp();
    const res = await request(app).get('/api/users/10000001');
    expect(typeof res.body.userType).toBe('string');
  });

  it('response contains blockedUserIds as an array', async () => {
    const app = createApp();
    const res = await request(app).get('/api/users/10000001');
    expect(Array.isArray(res.body.blockedUserIds)).toBe(true);
  });

  it('response contains followingIds as an array', async () => {
    const app = createApp();
    const res = await request(app).get('/api/users/10000001');
    expect(Array.isArray(res.body.followingIds)).toBe(true);
  });

  it('response contains followerIds as an array', async () => {
    const app = createApp();
    const res = await request(app).get('/api/users/10000001');
    expect(Array.isArray(res.body.followerIds)).toBe(true);
  });

  it('response contains createdAt as a number', async () => {
    const app = createApp();
    const res = await request(app).get('/api/users/10000001');
    expect(typeof res.body.createdAt).toBe('number');
  });

  it('response contains language as a string', async () => {
    const app = createApp();
    const res = await request(app).get('/api/users/10000001');
    expect(typeof res.body.language).toBe('string');
  });

  it('strips admin-only gcsScore field from response', async () => {
    const app = createApp();
    const res = await request(app).get('/api/users/10000001');
    expect('gcsScore' in res.body).toBe(false);
  });

  it('strips admin-only gcsLastDeductionAt field from response', async () => {
    const app = createApp();
    const res = await request(app).get('/api/users/10000001');
    expect('gcsLastDeductionAt' in res.body).toBe(false);
  });

  it('strips admin-only gcsDisplayScore field from response', async () => {
    const app = createApp();
    const res = await request(app).get('/api/users/10000001');
    expect('gcsDisplayScore' in res.body).toBe(false);
  });

  it('strips admin-only warningCount field from response', async () => {
    const app = createApp();
    const res = await request(app).get('/api/users/10000001');
    expect('warningCount' in res.body).toBe(false);
  });

  it('returns 404 when user does not exist', async () => {
    getDoc.mockResolvedValueOnce(null);
    const app = createApp();
    const res = await request(app).get('/api/users/99999999');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});

// ─── GET /api/economy/balance — balance contract ──────────────────

describe('GET /api/economy/balance response contract', () => {
  it('returns 200 with coins and beans', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ shyCoins: 750, shyBeans: 200 }),
    });

    const app = createApp();
    const res = await request(app).get('/api/economy/balance');
    expect(res.status).toBe(200);
  });

  it('response contains coins as a number', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ shyCoins: 750, shyBeans: 200 }),
    });

    const app = createApp();
    const res = await request(app).get('/api/economy/balance');
    expect(typeof res.body.coins).toBe('number');
  });

  it('response contains beans as a number', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ shyCoins: 750, shyBeans: 200 }),
    });

    const app = createApp();
    const res = await request(app).get('/api/economy/balance');
    expect(typeof res.body.beans).toBe('number');
  });

  it('response does NOT contain shyCoins key (uses coins alias)', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ shyCoins: 750, shyBeans: 200 }),
    });

    const app = createApp();
    const res = await request(app).get('/api/economy/balance');
    // The API normalises to 'coins'/'beans', not 'shyCoins'/'shyBeans'
    expect('shyCoins' in res.body).toBe(false);
    expect('shyBeans' in res.body).toBe(false);
  });

  it('defaults to 0 coins when shyCoins is missing', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({}),
    });

    const app = createApp();
    const res = await request(app).get('/api/economy/balance');
    expect(res.status).toBe(200);
    expect(res.body.coins).toBe(0);
    expect(res.body.beans).toBe(0);
  });

  it('returns 404 when user does not exist', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: false, data: () => null });

    const app = createApp();
    const res = await request(app).get('/api/economy/balance');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});

// ─── POST /api/economy/daily-reward — daily reward contract ───────

describe('POST /api/economy/daily-reward response contract', () => {
  function setupUserAndConfig() {
    // First call: config/economy doc
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        dailyBase: 50,
        milestoneRewards: { 7: 100, 14: 200 },
        beanConversionRate: 0.6,
        beanRedeemBonusThreshold: 2000,
        beanRedeemBonusMultiplier: 1.1,
        pullCosts: { 1: 10, 10: 100, 100: 1000 },
        broadcastSendThreshold: 0,
        broadcastWinThreshold: 5000,
        dropRateExponent: 1.5,
        pitySoftStart: 80,
        pityHardLimit: 120,
        pitySoftMaxShift: 0.15,
        pityHighValueThreshold: 5000,
      }),
    });
    // Second call: users/{uniqueId}
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        shyCoins: 100,
        shyBeans: 0,
        isSuperShy: false,
        loginStreak: 0,
        lastLoginDate: '2024-03-06', // two days ago, streak resets
        lastLoginRewardDate: '2024-03-07', // yesterday — not yet claimed today
      }),
    });
    // Transaction doc write
    mockDocSet.mockResolvedValue();
    mockDocUpdate.mockResolvedValue();
  }

  it('returns 200 when reward is successfully claimed', async () => {
    setupUserAndConfig();
    const app = createApp();
    const res = await request(app).post('/api/economy/daily-reward').send({});
    expect(res.status).toBe(200);
  });

  it('response contains coinsAwarded as a number', async () => {
    setupUserAndConfig();
    const app = createApp();
    const res = await request(app).post('/api/economy/daily-reward').send({});
    expect(typeof res.body.coinsAwarded).toBe('number');
  });

  it('response contains newBalance as a number', async () => {
    setupUserAndConfig();
    const app = createApp();
    const res = await request(app).post('/api/economy/daily-reward').send({});
    expect(typeof res.body.newBalance).toBe('number');
  });

  it('response contains newStreak as a number', async () => {
    setupUserAndConfig();
    const app = createApp();
    const res = await request(app).post('/api/economy/daily-reward').send({});
    expect(typeof res.body.newStreak).toBe('number');
  });

  it('response contains isMilestone as a boolean', async () => {
    setupUserAndConfig();
    const app = createApp();
    const res = await request(app).post('/api/economy/daily-reward').send({});
    expect(typeof res.body.isMilestone).toBe('boolean');
  });

  it('returns 409 when reward is already claimed today', async () => {
    // Config doc
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ dailyBase: 50, milestoneRewards: {} }),
    });
    // User doc — lastLoginRewardDate = today
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        shyCoins: 100,
        loginStreak: 5,
        lastLoginRewardDate: '2024-03-08', // matches todayStr() mock
      }),
    });

    const app = createApp();
    const res = await request(app).post('/api/economy/daily-reward').send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
  });
});

// ─── POST /api/rooms/:roomId/seat-requests — room contract ────────

describe('POST /api/rooms/:roomId/seat-requests response contract', () => {
  const { db } = require('../../src/utils/firebase');

  it('returns requestId as a string on success', async () => {
    // No existing pending request
    const mockChain = {
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ empty: true }),
    };
    db.collection.mockReturnValueOnce(mockChain);

    // Room doc (for FCM - fire-and-forget)
    mockDocGet.mockResolvedValue({ exists: false, data: () => null });

    const app = createApp(10000001);
    const res = await request(app)
      .post('/api/rooms/room-abc/seat-requests')
      .send({ seatIndex: 0, userName: 'TestUser' });

    expect(res.status).toBe(200);
    expect(typeof res.body.requestId).toBe('string');
    expect(res.body.requestId.length).toBeGreaterThan(0);
  });

  it('returns requestId when an existing pending request is updated', async () => {
    const existingReqId = 'existing-req-id';
    const mockChain = {
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({
        empty: false,
        docs: [{ id: existingReqId }],
      }),
    };
    db.collection.mockReturnValueOnce(mockChain);
    mockDocUpdate.mockResolvedValue();

    // RTDB broadcast mock
    const { rtdb } = require('../../src/utils/firebase');
    rtdb.ref.mockReturnValue({ set: jest.fn().mockResolvedValue() });

    const app = createApp(10000001);
    const res = await request(app)
      .post('/api/rooms/room-abc/seat-requests')
      .send({ seatIndex: 1, userName: 'TestUser' });

    expect(res.status).toBe(200);
    expect(res.body.requestId).toBe(existingReqId);
  });

  it('returns 400 when seatIndex is missing', async () => {
    const app = createApp(10000001);
    const res = await request(app)
      .post('/api/rooms/room-abc/seat-requests')
      .send({ userName: 'TestUser' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 when seatIndex is out of range', async () => {
    const app = createApp(10000001);
    const res = await request(app)
      .post('/api/rooms/room-abc/seat-requests')
      .send({ seatIndex: 21, userName: 'TestUser' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});

// ─── POST /api/conversations/:id/messages — conversation contract ─

describe('POST /api/conversations/:id/messages response contract', () => {
  const conversationFixture = {
    participantIds: [10000001, 10000002],
    isGroup: false,
    groupName: null,
  };

  function setupConversation() {
    const { db } = require('../../src/utils/firebase');
    mockDocGet.mockImplementation((path) => {
      if (
        path.startsWith('conversations/conv-1') &&
        !path.includes('/messages/') &&
        !path.includes('/userSettings/')
      ) {
        return Promise.resolve({
          exists: true,
          data: () => conversationFixture,
        });
      }
      return Promise.resolve({ exists: false, data: () => null });
    });
    db.batch.mockReturnValue({
      set: jest.fn(),
      commit: jest.fn().mockResolvedValue(),
    });
  }

  it('returns 200 and message object on success', async () => {
    setupConversation();
    const app = createApp(10000001);
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ type: 'TEXT', text: 'Hello', senderName: 'TestUser' });

    expect(res.status).toBe(200);
  });

  it('response contains id as a string', async () => {
    setupConversation();
    const app = createApp(10000001);
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ type: 'TEXT', text: 'Hello', senderName: 'TestUser' });

    expect(typeof res.body.id).toBe('string');
  });

  it('response contains messageId as a string', async () => {
    setupConversation();
    const app = createApp(10000001);
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ type: 'TEXT', text: 'Hello', senderName: 'TestUser' });

    expect(typeof res.body.messageId).toBe('string');
  });

  it('response contains senderId', async () => {
    setupConversation();
    const app = createApp(10000001);
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ type: 'TEXT', text: 'Hello', senderName: 'TestUser' });

    expect('senderId' in res.body).toBe(true);
  });

  it('response contains text as a string', async () => {
    setupConversation();
    const app = createApp(10000001);
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ type: 'TEXT', text: 'Hello', senderName: 'TestUser' });

    expect(typeof res.body.text).toBe('string');
  });

  it('response contains type as a string', async () => {
    setupConversation();
    const app = createApp(10000001);
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ type: 'TEXT', text: 'Hello', senderName: 'TestUser' });

    expect(typeof res.body.type).toBe('string');
  });

  it('response contains createdAt as a number', async () => {
    setupConversation();
    const app = createApp(10000001);
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ type: 'TEXT', text: 'Hello', senderName: 'TestUser' });

    expect(typeof res.body.createdAt).toBe('number');
  });

  it('response contains imageUrls as an array', async () => {
    setupConversation();
    const app = createApp(10000001);
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ type: 'TEXT', text: 'Hello', senderName: 'TestUser' });

    expect(Array.isArray(res.body.imageUrls)).toBe(true);
  });

  it('response contains isRecalled as a boolean', async () => {
    setupConversation();
    const app = createApp(10000001);
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ type: 'TEXT', text: 'Hello', senderName: 'TestUser' });

    expect(typeof res.body.isRecalled).toBe('boolean');
  });

  it('response contains reactions as an object', async () => {
    setupConversation();
    const app = createApp(10000001);
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ type: 'TEXT', text: 'Hello', senderName: 'TestUser' });

    expect(typeof res.body.reactions).toBe('object');
    expect(Array.isArray(res.body.reactions)).toBe(false);
  });

  it('returns 400 for invalid message type', async () => {
    setupConversation();
    const app = createApp(10000001);
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ type: 'INVALID_TYPE', text: 'Hello', senderName: 'TestUser' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 403 when caller is not a participant', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ participantIds: [99999999, 10000002] }), // caller 10000001 not included
    });

    const app = createApp(10000001);
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ type: 'TEXT', text: 'Hello', senderName: 'TestUser' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBeDefined();
  });
});

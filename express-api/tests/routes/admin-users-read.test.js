/* eslint-disable no-unused-vars */
const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({
      get: mockDocGet,
      update: mockDocUpdate,
      set: mockDocSet,
    })),
    collection: jest.fn(() => {
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      };
      return chain;
    }),
    batch: jest.fn(() => ({
      update: jest.fn(),
      commit: jest.fn().mockResolvedValue(),
    })),
  },
  auth: {
    getUser: jest.fn().mockResolvedValue({
      uid: 'user-1',
      email: null,
      providerData: [],
    }),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'test-id'),
  now: jest.fn(() => 1700000000000),
}));

jest.mock('../../src/utils/gcs', () => ({
  computeDisplayScore: jest.fn((score) => score),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/utils/system-pm', () => ({
  sendSystemPm: jest.fn().mockResolvedValue(),
}));

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn(() => false), // Allow all requests
  clearSuspensionCache: jest.fn(),
}));

// ─── App setup ──────────────────────────────────────────────────

const adminUsersRouter = require('../../src/routes/admin-users');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'admin-1', uniqueId: 'admin-1', token: { admin: true } };
    next();
  });
  app.use('/api', adminUsersRouter);
  return app;
}

// ─── Utility ────────────────────────────────────────────────────

/** Flush micro-task queue so fire-and-forget promises settle. */
const flushPromises = () => new Promise((r) => setTimeout(r, 50));

// ─── Tests ──────────────────────────────────────────────────────

describe('GET /api/search/uniqueId/:id', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('should find user by tempUniqueId when uniqueId not found', async () => {
    const { db } = require('../../src/utils/firebase');

    // First collection call (uniqueId search) - empty
    // Second collection call (tempUniqueId fallback) - found
    let callCount = 0;
    db.collection.mockImplementation(() => {
      callCount++;
      const getResult =
        callCount === 1
          ? { empty: true, docs: [] }
          : {
              empty: false,
              docs: [
                {
                  id: 'user-abc',
                  data: () => ({
                    uniqueId: 99999999,
                    tempUniqueId: 12345678,
                    gcsScore: 100,
                  }),
                },
              ],
            };
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: jest.fn().mockResolvedValue(getResult),
      };
      return chain;
    });

    const res = await request(app).get('/api/search/uniqueId/12345678').expect(200);

    expect(res.body.id).toBe('user-abc');
    expect(res.body.uniqueId).toBe(99999999);
    expect(res.body.tempUniqueId).toBe(12345678);
  });
});

// ─── autoApplyBans (via suspend route) ──────────────────────────

// ─── liftAutoAppliedBans (via unsuspend route) ──────────────────

// --- Suspend --- validation branches ----------------------------------------

// --- Unsuspend --- validation branches --------------------------------------

// --- PATCH /api/user/:uid --- validation branches ---------------------------

// --- POST /api/user/:uniqueId/notify-changes --------------------------------

// --- Suspend --- evictSuspendedUser -----------------------------------------

// --- Suspend --- suspension-match duration for timed bans -------------------

// --- GET /api/conversations/:id/messages ------------------------------------

describe('GET /api/conversations/:id/messages', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('should return messages in chronological order', async () => {
    const { db } = require('../../src/utils/firebase');

    const mockMsgGet = jest.fn().mockResolvedValue({
      docs: [
        { id: 'msg-2', data: () => ({ text: 'Second', createdAt: 2000 }) },
        { id: 'msg-1', data: () => ({ text: 'First', createdAt: 1000 }) },
      ],
    });

    db.collection.mockImplementation(() => ({
      orderBy: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          get: mockMsgGet,
        }),
      }),
    }));

    const res = await request(app).get('/api/conversations/conv-1/messages');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].id).toBe('msg-1');
    expect(res.body[1].id).toBe('msg-2');
  });

  it('should respect the limit query parameter', async () => {
    const { db } = require('../../src/utils/firebase');

    const mockLimit = jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue({ docs: [] }),
    });
    db.collection.mockImplementation(() => ({
      orderBy: jest.fn().mockReturnValue({
        limit: mockLimit,
      }),
    }));

    await request(app).get('/api/conversations/conv-1/messages?limit=10');

    expect(mockLimit).toHaveBeenCalledWith(10);
  });

  it('should cap the limit at 200', async () => {
    const { db } = require('../../src/utils/firebase');

    const mockLimit = jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue({ docs: [] }),
    });
    db.collection.mockImplementation(() => ({
      orderBy: jest.fn().mockReturnValue({
        limit: mockLimit,
      }),
    }));

    await request(app).get('/api/conversations/conv-1/messages?limit=999');

    expect(mockLimit).toHaveBeenCalledWith(200);
  });
});

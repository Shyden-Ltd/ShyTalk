/**
 * Systematic 500 error handling tests.
 *
 * Verifies that each major route file returns a 500 response (with an error
 * field in the body) when the underlying data store or external service throws
 * an unexpected error.  One representative endpoint is tested per route file.
 *
 * Routes covered:
 *  1. economy       — POST /api/economy/daily-reward  (Firestore doc.get throws)
 *  2. reports       — POST /api/reports               (Firestore doc.set throws)
 *  3. banners       — GET  /api/banners/active        (queryDocs throws)
 *  4. fun-facts     — GET  /api/fun-facts             (queryDocs throws)
 *  5. rooms         — POST /api/rooms/:id/seat-requests (collection.get throws)
 *  6. conversations — POST /api/conversations/:id/messages (doc.get throws)
 *  7. storage       — DELETE /api/storage/delete      (r2.deleteObject throws)
 *  8. translate     — POST /api/translate             (db.doc.get throws)
 *  9. notifications — POST /api/notifications/token   (db.doc.update throws)
 */

'use strict';

const express = require('express');
const request = require('supertest');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Economy — POST /api/economy/daily-reward
// ─────────────────────────────────────────────────────────────────────────────

describe('economy: POST /api/economy/daily-reward returns 500 on Firestore error', () => {
  // Isolate this describe block with its own module registry so the mocks
  // don't bleed into other test suites.
  let app;
  let mockDocGet;
  let economyRouter;

  beforeAll(() => {
    jest.resetModules();

    mockDocGet = jest.fn();

    jest.mock('../../src/utils/firebase', () => ({
      db: {
        doc: jest.fn(() => ({
          get: mockDocGet,
          update: jest.fn().mockResolvedValue(),
          set: jest.fn().mockResolvedValue(),
        })),
        collection: jest.fn(() => ({
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
        })),
        batch: jest.fn(() => ({
          set: jest.fn(),
          update: jest.fn(),
          commit: jest.fn().mockResolvedValue(),
        })),
      },
      FieldValue: {
        increment: jest.fn((n) => `increment(${n})`),
        arrayUnion: jest.fn((...a) => `arrayUnion(${a})`),
        arrayRemove: jest.fn((...a) => `arrayRemove(${a})`),
      },
    }));

    jest.mock('../../src/middleware/auth', () => ({
      requireAdmin: jest.fn(() => false),
    }));

    jest.mock('../../src/utils/helpers', () => ({
      generateId: () => 'id-123',
      now: () => 1700000000000,
      todayStr: () => '2026-03-13',
      yesterdayStr: () => '2026-03-12',
    }));

    jest.mock('../../src/utils/playStore', () => ({
      verifyProductPurchase: jest.fn(),
      verifySubscription: jest.fn(),
    }));

    jest.mock('../../src/utils/log', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));

    economyRouter = require('../../src/routes/economy');

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { uid: 'firebase-uid', uniqueId: 'user-test', token: { admin: false } };
      next();
    });
    app.use('/api', economyRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    if (economyRouter._resetConfigCache) economyRouter._resetConfigCache();
  });

  test('returns 500 when Firestore doc.get throws', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore unavailable'));

    const res = await request(app).post('/api/economy/daily-reward');

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Reports — POST /api/reports
// ─────────────────────────────────────────────────────────────────────────────

describe('reports: POST /api/reports returns 500 on Firestore error', () => {
  let app;
  let mockDocGet;
  let mockDocSet;

  beforeAll(() => {
    jest.resetModules();

    mockDocGet = jest.fn();
    mockDocSet = jest.fn();

    jest.mock('../../src/utils/firebase', () => ({
      db: {
        doc: jest.fn(() => ({
          get: mockDocGet,
          set: mockDocSet,
          update: jest.fn().mockResolvedValue(),
          delete: jest.fn().mockResolvedValue(),
        })),
        collection: jest.fn(() => {
          const chain = {
            where: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue({ docs: [] }),
          };
          return chain;
        }),
        batch: jest.fn(() => ({
          set: jest.fn(),
          commit: jest.fn().mockResolvedValue(),
        })),
      },
      rtdb: {
        ref: jest.fn(() => ({
          set: jest.fn().mockResolvedValue(),
          remove: jest.fn().mockResolvedValue(),
        })),
      },
      FieldValue: {
        arrayUnion: jest.fn(),
        arrayRemove: jest.fn(),
      },
    }));

    jest.mock('../../src/utils/helpers', () => ({
      generateId: () => 'report-id-123',
      now: () => 1700000000000,
    }));

    jest.mock('../../src/utils/log', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));

    jest.mock('../../src/middleware/auth', () => ({
      requireAdmin: jest.fn(() => false),
      clearSuspensionCache: jest.fn(),
    }));

    jest.mock('../../src/utils/system-pm', () => ({
      sendSystemPm: jest.fn().mockResolvedValue(),
    }));

    jest.mock('../../src/utils/gcs', () => ({
      computeDisplayScore: jest.fn((score) => score),
    }));

    jest.mock('../../src/utils/fcm', () => ({
      sendFcmToTokens: jest.fn().mockResolvedValue([]),
    }));

    jest.mock('../../src/utils/firestore-helpers', () => ({
      getDoc: jest.fn(),
      queryDocs: jest.fn().mockResolvedValue([]),
    }));

    // reports.js imports admin-users for createWarning
    jest.mock('../../src/routes/admin-users', () => ({
      createWarning: jest.fn().mockResolvedValue(),
    }));

    const reportsRouter = require('../../src/routes/reports');

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { uid: 'firebase-uid', uniqueId: 'reporter-user', token: { admin: false } };
      next();
    });
    app.use('/api', reportsRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // By default, getDoc (used for reporter fetch) throws to simulate Firestore failure
    const { getDoc } = require('../../src/utils/firestore-helpers');
    getDoc.mockRejectedValue(new Error('Firestore unavailable'));
  });

  test('returns 500 when Firestore throws during reporter fetch', async () => {
    const res = await request(app)
      .post('/api/reports')
      .send({ reportedUserId: 'other-user', reason: 'spam' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Banners — GET /api/banners/active
// ─────────────────────────────────────────────────────────────────────────────

describe('banners: GET /api/banners/active returns 500 on Firestore error', () => {
  let app;

  beforeAll(() => {
    jest.resetModules();

    jest.mock('../../src/utils/firebase', () => ({
      db: {
        doc: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({ exists: false }),
          set: jest.fn().mockResolvedValue(),
          update: jest.fn().mockResolvedValue(),
          delete: jest.fn().mockResolvedValue(),
        })),
        collection: jest.fn(() => {
          const chain = {
            where: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue({ docs: [] }),
          };
          return chain;
        }),
        batch: jest.fn(() => ({
          set: jest.fn(),
          commit: jest.fn().mockResolvedValue(),
        })),
      },
    }));

    jest.mock('../../src/utils/helpers', () => ({
      generateId: () => 'banner-id',
      now: () => 1700000000000,
    }));

    jest.mock('../../src/utils/log', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));

    jest.mock('../../src/middleware/auth', () => ({
      requireAdmin: jest.fn(() => false),
    }));

    jest.mock('../../src/utils/r2', () => ({
      putObject: jest.fn().mockResolvedValue('https://images.shytalk.shyden.co.uk/test.jpg'),
      deleteObject: jest.fn().mockResolvedValue(),
    }));

    jest.mock('../../src/utils/firestore-helpers', () => ({
      getDoc: jest.fn().mockResolvedValue(null),
      queryDocs: jest.fn().mockRejectedValue(new Error('Firestore unavailable')),
    }));

    const bannersRouter = require('../../src/routes/banners');

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { uid: 'firebase-uid', uniqueId: 'user-abc' };
      next();
    });
    app.use('/api', bannersRouter);
  });

  test('returns 500 when queryDocs throws', async () => {
    const res = await request(app).get('/api/banners/active');

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Fun-facts — GET /api/fun-facts
// ─────────────────────────────────────────────────────────────────────────────

describe('fun-facts: GET /api/fun-facts returns 500 on Firestore error', () => {
  let app;

  beforeAll(() => {
    jest.resetModules();

    jest.mock('../../src/utils/firebase', () => ({
      db: {
        doc: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({ exists: false }),
          set: jest.fn().mockResolvedValue(),
          update: jest.fn().mockResolvedValue(),
          delete: jest.fn().mockResolvedValue(),
        })),
        collection: jest.fn(() => ({
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({ docs: [] }),
        })),
      },
    }));

    jest.mock('../../src/utils/helpers', () => ({
      generateId: () => 'fact-id',
      now: () => 1700000000000,
    }));

    jest.mock('../../src/utils/log', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));

    jest.mock('../../src/middleware/auth', () => ({
      requireAdmin: jest.fn(() => false),
    }));

    jest.mock('../../src/utils/firestore-helpers', () => ({
      queryDocs: jest.fn().mockRejectedValue(new Error('Firestore unavailable')),
    }));

    const funFactsRouter = require('../../src/routes/fun-facts');

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { uid: 'firebase-uid', uniqueId: 'user-abc' };
      next();
    });
    app.use('/api', funFactsRouter);
  });

  test('returns 500 when queryDocs throws', async () => {
    const res = await request(app).get('/api/fun-facts');

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Rooms — POST /api/rooms/:roomId/seat-requests
// ─────────────────────────────────────────────────────────────────────────────

describe('rooms: POST /api/rooms/:roomId/seat-requests returns 500 on Firestore error', () => {
  let app;
  let mockCollectionGet;

  beforeAll(() => {
    jest.resetModules();

    mockCollectionGet = jest.fn().mockRejectedValue(new Error('Firestore unavailable'));

    jest.mock('../../src/utils/firebase', () => ({
      db: {
        doc: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
          update: jest.fn().mockResolvedValue(),
          set: jest.fn().mockResolvedValue(),
        })),
        collection: jest.fn(() => ({
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: mockCollectionGet,
        })),
      },
      rtdb: {
        ref: jest.fn(() => ({
          set: jest.fn().mockResolvedValue(),
        })),
      },
    }));

    jest.mock('../../src/utils/helpers', () => ({
      generateId: () => 'req-id-123',
      now: () => 1700000000000,
    }));

    jest.mock('../../src/utils/log', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));

    jest.mock('../../src/utils/fcm', () => ({
      sendFcmToTokens: jest.fn().mockResolvedValue([]),
      cleanupInvalidTokens: jest.fn().mockResolvedValue(),
    }));

    const roomsRouter = require('../../src/routes/rooms');

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { uid: 'firebase-uid', uniqueId: 'user-abc' };
      next();
    });
    app.use('/api', roomsRouter);
  });

  test('returns 500 when Firestore collection.get throws', async () => {
    const res = await request(app)
      .post('/api/rooms/room-123/seat-requests')
      .send({ seatIndex: 0, userName: 'TestUser' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Conversations — POST /api/conversations/:id/messages
// ─────────────────────────────────────────────────────────────────────────────

describe('conversations: POST /api/conversations/:id/messages returns 500 on Firestore error', () => {
  let app;
  let mockDocGet;

  beforeAll(() => {
    jest.resetModules();

    mockDocGet = jest.fn().mockRejectedValue(new Error('Firestore unavailable'));

    jest.mock('../../src/utils/firebase', () => ({
      db: {
        doc: jest.fn(() => ({
          get: mockDocGet,
          update: jest.fn().mockResolvedValue(),
          set: jest.fn().mockResolvedValue(),
        })),
        collection: jest.fn(() => ({
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({ docs: [] }),
        })),
        batch: jest.fn(() => ({
          set: jest.fn(),
          update: jest.fn(),
          commit: jest.fn().mockResolvedValue(),
        })),
        getAll: jest.fn().mockResolvedValue([]),
      },
      rtdb: {
        ref: jest.fn(() => ({
          set: jest.fn().mockResolvedValue(),
        })),
      },
      FieldValue: {
        increment: jest.fn((n) => `increment(${n})`),
        arrayRemove: jest.fn((...a) => `arrayRemove(${a})`),
      },
    }));

    jest.mock('../../src/utils/helpers', () => ({
      generateId: () => 'msg-id-123',
      now: () => 1700000000000,
    }));

    jest.mock('../../src/utils/log', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));

    jest.mock('../../src/utils/fcm', () => ({
      sendFcmToTokens: jest.fn().mockResolvedValue([]),
      cleanupInvalidTokens: jest.fn().mockResolvedValue(),
    }));

    const conversationsRouter = require('../../src/routes/conversations');

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { uid: 'firebase-uid', uniqueId: 'user-abc' };
      next();
    });
    app.use('/api', conversationsRouter);
  });

  test('returns 500 when Firestore doc.get throws on conversation fetch', async () => {
    const res = await request(app)
      .post('/api/conversations/conv-123/messages')
      .send({ text: 'Hello', type: 'TEXT', senderName: 'Alice' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Storage — DELETE /api/storage/delete
// ─────────────────────────────────────────────────────────────────────────────

describe('storage: DELETE /api/storage/delete returns 500 when r2.deleteObject throws', () => {
  let app;
  let mockDeleteObject;

  beforeAll(() => {
    jest.resetModules();

    mockDeleteObject = jest.fn().mockRejectedValue(new Error('R2 unavailable'));

    jest.mock('../../src/utils/r2', () => ({
      putObject: jest.fn().mockResolvedValue('https://images.shytalk.shyden.co.uk/test.jpg'),
      deleteObject: mockDeleteObject,
    }));

    jest.mock('../../src/utils/helpers', () => ({
      getExtension: jest.fn((mime) => {
        const map = { 'image/jpeg': 'jpg', 'image/png': 'png' };
        return map[mime] || 'bin';
      }),
    }));

    jest.mock('../../src/utils/log', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));

    const storageRouter = require('../../src/routes/storage');

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { uid: 'firebase-uid', uniqueId: 'user-abc' };
      next();
    });
    app.use('/api', storageRouter);
  });

  test('returns 500 when r2.deleteObject throws', async () => {
    // Key format must pass the ownership check: "{path}/{uniqueId}/{filename}"
    const key = 'profiles/user-abc/1700000000-photo.jpg';
    const res = await request(app).delete('/api/storage/delete').query({ key });

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Economy/gacha — POST /api/economy/gacha
// ─────────────────────────────────────────────────────────────────────────────

describe('economy: POST /api/economy/gacha returns 500 when economy config load fails', () => {
  let app;
  let mockDocGet;
  let economyRouter;

  beforeAll(() => {
    jest.resetModules();

    mockDocGet = jest.fn();

    jest.mock('../../src/utils/firebase', () => ({
      db: {
        doc: jest.fn(() => ({
          get: mockDocGet,
          update: jest.fn().mockResolvedValue(),
          set: jest.fn().mockResolvedValue(),
        })),
        collection: jest.fn(() => ({
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
        })),
        batch: jest.fn(() => ({
          set: jest.fn(),
          update: jest.fn(),
          commit: jest.fn().mockResolvedValue(),
        })),
      },
      FieldValue: {
        increment: jest.fn((n) => `increment(${n})`),
        arrayUnion: jest.fn((...a) => `arrayUnion(${a})`),
        arrayRemove: jest.fn((...a) => `arrayRemove(${a})`),
      },
    }));

    jest.mock('../../src/middleware/auth', () => ({
      requireAdmin: jest.fn(() => false),
    }));

    jest.mock('../../src/utils/helpers', () => ({
      generateId: () => 'tx-id-456',
      now: () => 1700000000000,
      todayStr: () => '2026-03-13',
      yesterdayStr: () => '2026-03-12',
    }));

    jest.mock('../../src/utils/playStore', () => ({
      verifyProductPurchase: jest.fn(),
      verifySubscription: jest.fn(),
    }));

    jest.mock('../../src/utils/log', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));

    economyRouter = require('../../src/routes/economy');

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { uid: 'firebase-uid', uniqueId: 'user-test', token: { admin: false } };
      next();
    });
    app.use('/api', economyRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    if (economyRouter._resetConfigCache) economyRouter._resetConfigCache();
  });

  test('returns 500 when economy config doc.get throws', async () => {
    // The first db.doc().get() call is loadEconomyConfig() → config/economy
    mockDocGet.mockRejectedValue(new Error('Firestore unavailable'));

    const res = await request(app).post('/api/economy/gacha').send({ pullCount: 1 });

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Translate — POST /api/translate
// ─────────────────────────────────────────────────────────────────────────────

describe('translate: POST /api/translate returns 500 on Firestore error', () => {
  let app;
  let mockDocGet;

  beforeAll(() => {
    jest.resetModules();

    mockDocGet = jest.fn().mockRejectedValue(new Error('Firestore unavailable'));

    jest.mock('../../src/utils/firebase', () => ({
      db: {
        doc: jest.fn(() => ({
          get: mockDocGet,
          update: jest.fn().mockResolvedValue(),
        })),
      },
      FieldValue: {
        increment: jest.fn((n) => `increment(${n})`),
      },
    }));

    jest.mock('../../src/utils/log', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));

    const translateRouter = require('../../src/routes/translate');

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { uid: 'firebase-uid', uniqueId: 'user-abc' };
      next();
    });
    app.use('/api', translateRouter);
  });

  test('returns 500 when Firestore doc.get throws during quota check', async () => {
    // The translate route first checks cache (optional messagePath), then reads
    // the user doc for quota check — that get() will throw.
    const res = await request(app).post('/api/translate').send({ text: 'Hello', targetLang: 'es' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Notifications — POST /api/notifications/token
// ─────────────────────────────────────────────────────────────────────────────

describe('notifications: POST /api/notifications/token returns 500 on Firestore error', () => {
  let app;
  let mockDocUpdate;

  beforeAll(() => {
    jest.resetModules();

    mockDocUpdate = jest.fn().mockRejectedValue(new Error('Firestore unavailable'));

    jest.mock('../../src/utils/firebase', () => ({
      db: {
        doc: jest.fn(() => ({
          update: mockDocUpdate,
        })),
      },
      FieldValue: {
        arrayUnion: jest.fn((v) => `arrayUnion(${v})`),
        arrayRemove: jest.fn((v) => `arrayRemove(${v})`),
      },
    }));

    jest.mock('../../src/utils/log', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));

    const notificationsRouter = require('../../src/routes/notifications');

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { uid: 'firebase-uid', uniqueId: 'user-abc' };
      next();
    });
    app.use('/api', notificationsRouter);
  });

  test('returns 500 when Firestore doc.update throws', async () => {
    const res = await request(app)
      .post('/api/notifications/token')
      .send({ token: 'fcm-token-abc123' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

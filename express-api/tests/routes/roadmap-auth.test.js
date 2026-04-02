/* eslint-disable no-unused-vars, no-undef */
/**
 * Tests for roadmap page authentication flow.
 *
 * The roadmap page allows login via Google/Apple (Firebase Auth).
 * After Firebase auth, the API checks if a ShyTalk account exists
 * for the Firebase UID. If not, the login is denied with a prompt
 * to download the app and create an account.
 *
 * Routes under test:
 *   GET /api/roadmap/me  → returns user profile if ShyTalk account exists
 *                         → returns 404 with download links if no account
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock ──────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: () => mockDocGet(path),
    })),
    collection: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      get: () => mockCollectionGet(),
    })),
  },
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// ─── App setup ──────────────────────────────────────────────────

const roadmapAuthRouter = require('../../src/routes/roadmap-auth');

function createApp({ uid = 'firebase-uid-1', uniqueId = 1001 } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid, uniqueId, token: {} };
    next();
  });
  app.use('/api', roadmapAuthRouter);
  return app;
}

function createUnauthApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', roadmapAuthRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDocGet.mockReset();
  mockCollectionGet.mockReset();
  mockDocGet.mockResolvedValue({ exists: false });
  mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });
});

// ─── Helpers ────────────────────────────────────────────────────

function makeUserDoc(uniqueId, overrides = {}) {
  return {
    exists: true,
    data: () => ({
      uniqueId,
      displayName: 'TestUser',
      avatarUrl: 'https://example.com/avatar.png',
      profilePhotoUrl: 'https://example.com/photo.png',
      ...overrides,
    }),
  };
}

// ═══════════════════════════════════════════════════════════════
// GET /api/roadmap/me — Check if ShyTalk account exists
// ═══════════════════════════════════════════════════════════════

describe('GET /api/roadmap/me', () => {
  test('returns user profile when ShyTalk account exists', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('users/')) {
        return Promise.resolve(makeUserDoc(1001));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    const res = await request(app).get('/api/roadmap/me').expect(200);
    expect(res.body).toHaveProperty('displayName');
    expect(res.body).toHaveProperty('uniqueId');
    expect(res.body.displayName).toBe('TestUser');
  });

  test('returns 404 with download links when no ShyTalk account', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });
    const app = createApp();
    const res = await request(app).get('/api/roadmap/me').expect(404);
    expect(res.body.error).toMatch(/no shytalk account/i);
    expect(res.body).toHaveProperty('downloadLinks');
    expect(res.body.downloadLinks).toHaveProperty('android');
    expect(res.body.downloadLinks).toHaveProperty('ios');
  });

  test('returns 401 without authentication', async () => {
    const app = createUnauthApp();
    await request(app).get('/api/roadmap/me').expect(401);
  });

  test('returns correct display name from user profile', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('users/')) {
        return Promise.resolve(makeUserDoc(1001, { displayName: 'Alice' }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    const res = await request(app).get('/api/roadmap/me').expect(200);
    expect(res.body.displayName).toBe('Alice');
  });

  test('returns avatar URL from user profile', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('users/')) {
        return Promise.resolve(makeUserDoc(1001, { avatarUrl: 'https://cdn.example.com/me.png' }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    const res = await request(app).get('/api/roadmap/me').expect(200);
    expect(res.body.avatarUrl).toBe('https://cdn.example.com/me.png');
  });

  test('does not expose sensitive fields (pinHash, fcmTokens, firebaseUid)', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('users/')) {
        return Promise.resolve(
          makeUserDoc(1001, {
            pinHash: 'secret-hash',
            fcmTokens: ['token1', 'token2'],
            firebaseUid: 'firebase-uid-1',
          }),
        );
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    const res = await request(app).get('/api/roadmap/me').expect(200);
    expect(res.body).not.toHaveProperty('pinHash');
    expect(res.body).not.toHaveProperty('fcmTokens');
    expect(res.body).not.toHaveProperty('firebaseUid');
  });

  test('lookup by Firebase UID via identityMap when uniqueId not in auth', async () => {
    // When auth middleware resolves Firebase UID but not uniqueId,
    // the route should look up the identityMap to find the ShyTalk account
    mockCollectionGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'google:user@gmail.com',
          data: () => ({ uniqueId: 2002, firebaseUid: 'firebase-uid-2' }),
        },
      ],
    });
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('users/2002')) {
        return Promise.resolve(makeUserDoc(2002, { displayName: 'Bob' }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp({ uid: 'firebase-uid-2', uniqueId: null });
    const res = await request(app).get('/api/roadmap/me').expect(200);
    expect(res.body.displayName).toBe('Bob');
  });

  test('download links contain correct Play Store URL', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });
    const app = createApp();
    const res = await request(app).get('/api/roadmap/me').expect(404);
    expect(res.body.downloadLinks.android).toMatch(/play\.google\.com/);
  });

  test('download links contain correct App Store URL', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });
    const app = createApp();
    const res = await request(app).get('/api/roadmap/me').expect(404);
    expect(res.body.downloadLinks.ios).toMatch(/apps\.apple\.com/);
  });

  test('error message invites user to create account in the app', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });
    const app = createApp();
    const res = await request(app).get('/api/roadmap/me').expect(404);
    expect(res.body.error).toMatch(/download|create.*account|app/i);
  });

  test('does not expose isSuspended or suspensionReason', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('users/')) {
        return Promise.resolve(makeUserDoc(1001, { isSuspended: true, suspensionReason: 'Bad' }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    const res = await request(app).get('/api/roadmap/me').expect(200);
    expect(res.body).not.toHaveProperty('suspensionReason');
  });

  test('does not expose economy fields', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('users/')) {
        return Promise.resolve(makeUserDoc(1001, { shyCoins: 5000, shyBeans: 100 }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    const res = await request(app).get('/api/roadmap/me').expect(200);
    expect(res.body).not.toHaveProperty('shyCoins');
    expect(res.body).not.toHaveProperty('shyBeans');
  });

  test('returns only safe fields: uniqueId, displayName, avatarUrl, profilePhotoUrl', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('users/')) {
        return Promise.resolve(
          makeUserDoc(1001, {
            email: 'secret@email.com',
            nationality: 'UK',
          }),
        );
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    const res = await request(app).get('/api/roadmap/me').expect(200);
    const allowedKeys = ['uniqueId', 'displayName', 'avatarUrl', 'profilePhotoUrl'];
    for (const key of Object.keys(res.body)) {
      expect(allowedKeys).toContain(key);
    }
  });

  test('404 when identityMap entry exists but user doc deleted', async () => {
    mockCollectionGet.mockResolvedValue({
      empty: false,
      docs: [{ id: 'google:x', data: () => ({ uniqueId: 9999 }) }],
    });
    mockDocGet.mockResolvedValue({ exists: false });
    const app = createApp({ uid: 'uid-deleted', uniqueId: null });
    const res = await request(app).get('/api/roadmap/me').expect(404);
    expect(res.body).toHaveProperty('downloadLinks');
  });

  test('handles Firestore error gracefully (500)', async () => {
    mockDocGet.mockRejectedValue(new Error('DEADLINE_EXCEEDED'));
    const app = createApp();
    await request(app).get('/api/roadmap/me').expect(500);
  });

  test('Play Store URL contains correct package ID', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });
    const app = createApp();
    const res = await request(app).get('/api/roadmap/me').expect(404);
    expect(res.body.downloadLinks.android).toContain('com.shyden.shytalk');
  });

  test('user with empty displayName returns empty string', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('users/')) {
        return Promise.resolve(makeUserDoc(1001, { displayName: '' }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    const res = await request(app).get('/api/roadmap/me').expect(200);
    expect(res.body.displayName).toBe('');
  });

  test('user with null avatarUrl returns null', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('users/')) {
        return Promise.resolve(makeUserDoc(1001, { avatarUrl: null }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    const res = await request(app).get('/api/roadmap/me').expect(200);
    expect(res.body.avatarUrl).toBeNull();
  });
});

describe('POST /api/roadmap/signout', () => {
  test('returns 200 on sign out', async () => {
    const app = createApp();
    await request(app).post('/api/roadmap/signout').expect(200);
  });

  test('returns 401 without authentication', async () => {
    const app = createUnauthApp();
    await request(app).post('/api/roadmap/signout').expect(401);
  });
});

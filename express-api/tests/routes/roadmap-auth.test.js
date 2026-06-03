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
    expect(res.body).not.toHaveProperty('isSuspended');
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

  // ─── New tests: data handling ──────────────────────────────────

  test('user with unicode/emoji display name returned correctly', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('users/')) {
        return Promise.resolve(makeUserDoc(1001, { displayName: '🦊 Fóx Ünïcödé 你好' }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    const res = await request(app).get('/api/roadmap/me').expect(200);
    expect(res.body.displayName).toBe('🦊 Fóx Ünïcödé 你好');
  });

  test('user with very long display name (100+ chars) returned', async () => {
    const longName = 'A'.repeat(150);
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('users/')) {
        return Promise.resolve(makeUserDoc(1001, { displayName: longName }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    const res = await request(app).get('/api/roadmap/me').expect(200);
    // Either truncated or returned in full — must not error
    expect(res.body.displayName).toBeDefined();
    expect(typeof res.body.displayName).toBe('string');
  });

  // Pin the request-shape invariant: the direct-uniqueId path makes one
  // users-doc read and skips the identityMap query. A regression that always
  // ran the fallback would double the Firestore RPC count per authed request.
  test('direct-uniqueId path makes exactly one users-doc read and skips identityMap', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('users/')) {
        return Promise.resolve(makeUserDoc(1001));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app).get('/api/roadmap/me').expect(200);
    expect(mockDocGet).toHaveBeenCalledTimes(1);
    expect(mockCollectionGet).not.toHaveBeenCalled();
  });

  test('multiple rapid requests return same data (idempotent)', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('users/')) {
        return Promise.resolve(makeUserDoc(1001, { displayName: 'Stable' }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    const [res1, res2, res3] = await Promise.all([
      request(app).get('/api/roadmap/me'),
      request(app).get('/api/roadmap/me'),
      request(app).get('/api/roadmap/me'),
    ]);
    expect(res1.body).toEqual(res2.body);
    expect(res2.body).toEqual(res3.body);
  });

  // ─── New tests: isolation ──────────────────────────────────────

  test('different users get different profiles (isolation)', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('users/1001')) {
        return Promise.resolve(makeUserDoc(1001, { displayName: 'UserA' }));
      }
      if (path && path.includes('users/2002')) {
        return Promise.resolve(makeUserDoc(2002, { displayName: 'UserB' }));
      }
      return Promise.resolve({ exists: false });
    });
    const appA = createApp({ uid: 'uid-a', uniqueId: 1001 });
    const appB = createApp({ uid: 'uid-b', uniqueId: 2002 });
    const resA = await request(appA).get('/api/roadmap/me').expect(200);
    const resB = await request(appB).get('/api/roadmap/me').expect(200);
    expect(resA.body.displayName).toBe('UserA');
    expect(resB.body.displayName).toBe('UserB');
    expect(resA.body.uniqueId).not.toBe(resB.body.uniqueId);
  });

  // ─── New tests: identityMap edge cases ─────────────────────────

  test('identityMap with multiple entries returns the correct user', async () => {
    mockCollectionGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'google:first@gmail.com',
          data: () => ({ uniqueId: 3001, firebaseUid: 'firebase-uid-multi' }),
        },
        {
          id: 'apple:second@icloud.com',
          data: () => ({ uniqueId: 3002, firebaseUid: 'firebase-uid-multi' }),
        },
      ],
    });
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('users/3001')) {
        return Promise.resolve(makeUserDoc(3001, { displayName: 'FirstEntry' }));
      }
      if (path && path.includes('users/3002')) {
        return Promise.resolve(makeUserDoc(3002, { displayName: 'SecondEntry' }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp({ uid: 'firebase-uid-multi', uniqueId: null });
    const res = await request(app).get('/api/roadmap/me').expect(200);
    // The route loops idSnap.docs in iteration order and `break`s on the
    // first existing user doc — pin the determinism (first entry: 3001).
    // A regression that picked a different entry would otherwise pass.
    expect(res.body.uniqueId).toBe(3001);
    expect(res.body.displayName).toBe('FirstEntry');
  });

  test('identityMap with unlinked entry (unlinked: true) skipped', async () => {
    mockCollectionGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'google:unlinked@gmail.com',
          data: () => ({ uniqueId: 4001, firebaseUid: 'uid-unlinked', unlinked: true }),
        },
        {
          id: 'apple:linked@icloud.com',
          data: () => ({ uniqueId: 4002, firebaseUid: 'uid-unlinked' }),
        },
      ],
    });
    // Both user docs EXIST with distinguishable displayNames so the
    // assertion truly pins "unlinked entry skipped". A regression that
    // failed to skip would resolve to 4001 first and return UnlinkedUser
    // instead of LinkedUser.
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('users/4001')) {
        return Promise.resolve(makeUserDoc(4001, { displayName: 'UnlinkedUser' }));
      }
      if (path && path.includes('users/4002')) {
        return Promise.resolve(makeUserDoc(4002, { displayName: 'LinkedUser' }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp({ uid: 'uid-unlinked', uniqueId: null });
    const res = await request(app).get('/api/roadmap/me').expect(200);
    expect(res.body.uniqueId).toBe(4002);
    expect(res.body.displayName).toBe('LinkedUser');
    // Closes the "fetch all, pick last" regression: a route that fetched
    // users/4001 anyway would pass the toBe(4002) above but fail here.
    expect(mockDocGet).not.toHaveBeenCalledWith('users/4001');
    expect(mockDocGet).toHaveBeenCalledWith('users/4002');
  });

  // ─── New tests: type safety ────────────────────────────────────

  test('user profile includes correct uniqueId type (number)', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('users/')) {
        return Promise.resolve(makeUserDoc(1001));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    const res = await request(app).get('/api/roadmap/me').expect(200);
    expect(typeof res.body.uniqueId).toBe('number');
  });

  // ─── New tests: security ───────────────────────────────────────

  test('404 response does not leak internal implementation details', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });
    const app = createApp();
    const res = await request(app).get('/api/roadmap/me').expect(404);
    const body = JSON.stringify(res.body);
    // Should not contain stack traces, file paths, or Firestore internals
    expect(body).not.toMatch(/at\s+\w+\s+\(/); // stack trace pattern
    expect(body).not.toMatch(/node_modules/);
    expect(body).not.toMatch(/firestore/i);
    expect(body).not.toMatch(/\.js:/);
  });

  test('download links are HTTPS (not HTTP)', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });
    const app = createApp();
    const res = await request(app).get('/api/roadmap/me').expect(404);
    expect(res.body.downloadLinks.android).toMatch(/^https:\/\//);
    expect(res.body.downloadLinks.ios).toMatch(/^https:\/\//);
  });

  test('500 error does not leak stack trace or internal details', async () => {
    mockDocGet.mockRejectedValue(new Error('Connection refused to 10.0.0.1:8080'));
    const app = createApp();
    const res = await request(app).get('/api/roadmap/me').expect(500);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/10\.0\.0\.1/);
    expect(body).not.toMatch(/Connection refused/);
    expect(body).not.toMatch(/at\s+\w+\s+\(/);
  });

  // ─── New tests: HTTP method safety ─────────────────────────────

  test('GET /api/roadmap/me with POST method returns 404 or 405', async () => {
    const app = createApp();
    const res = await request(app).post('/api/roadmap/me');
    expect([404, 405]).toContain(res.status);
  });

  test('OPTIONS /api/roadmap/me does not return 500', async () => {
    const app = createApp();
    const res = await request(app).options('/api/roadmap/me');
    expect(res.status).not.toBe(500);
  });

  // ─── New tests: response headers ───────────────────────────────

  test('response headers include application/json content type', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('users/')) {
        return Promise.resolve(makeUserDoc(1001));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    const res = await request(app).get('/api/roadmap/me').expect(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  test('404 response headers include application/json content type', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });
    const app = createApp();
    const res = await request(app).get('/api/roadmap/me').expect(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/roadmap/me — spread-order safety (identity invariant)
// ═══════════════════════════════════════════════════════════════
//
// Pins the spread-order contract `{ ...userDoc.data(), uniqueId: <trusted> }`
// on both auth paths. A rogue `uniqueId` field in the user doc payload (from
// schema drift, admin-tool write, or rule drift) must not override the
// trusted authenticated value — that is the strongest identity-spoofing
// shape on an authenticated endpoint.

describe('GET /api/roadmap/me — spread-order safety (identity invariant)', () => {
  test('direct uniqueId path: payload uniqueId cannot override authenticated uniqueId', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('users/1001')) {
        // Adversarial: user doc payload tries to claim a different identity.
        return Promise.resolve({
          exists: true,
          data: () => ({
            uniqueId: 9999,
            displayName: 'AuthenticatedUser',
            avatarUrl: 'https://example.com/a.png',
            profilePhotoUrl: 'https://example.com/p.png',
          }),
        });
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp({ uid: 'firebase-uid-1', uniqueId: 1001 });
    const res = await request(app).get('/api/roadmap/me').expect(200);
    expect(res.body.uniqueId).toBe(1001);
    expect(res.body.displayName).toBe('AuthenticatedUser');
  });

  test('identityMap fallback path: payload uniqueId cannot override identityMap-resolved uniqueId', async () => {
    mockCollectionGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'google:linked@gmail.com',
          data: () => ({ uniqueId: 2002, firebaseUid: 'firebase-uid-fallback' }),
        },
      ],
    });
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('users/2002')) {
        // Adversarial: user doc payload tries to claim a different identity.
        return Promise.resolve({
          exists: true,
          data: () => ({
            uniqueId: 9999,
            displayName: 'FallbackUser',
            avatarUrl: 'https://example.com/a.png',
            profilePhotoUrl: 'https://example.com/p.png',
          }),
        });
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp({ uid: 'firebase-uid-fallback', uniqueId: null });
    const res = await request(app).get('/api/roadmap/me').expect(200);
    expect(res.body.uniqueId).toBe(2002);
    expect(res.body.displayName).toBe('FallbackUser');
  });

  // Type-shape parity between the two auth paths: the direct path coerces
  // `req.auth.uniqueId` to Number via `Number(...)`; the fallback must do
  // the same so legacy identityMap docs that store the FK as a string don't
  // produce a string `uniqueId` in the response. Without the coercion, a
  // single API contract leaks two different runtime types for the same
  // field, depending on which auth path resolved the request.
  test('identityMap fallback path: string uniqueId in identityMap is coerced to number in response', async () => {
    mockCollectionGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'google:legacy@gmail.com',
          data: () => ({ uniqueId: '5005', firebaseUid: 'firebase-uid-legacy' }),
        },
      ],
    });
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('users/5005')) {
        return Promise.resolve(makeUserDoc(5005, { displayName: 'LegacyString' }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp({ uid: 'firebase-uid-legacy', uniqueId: null });
    const res = await request(app).get('/api/roadmap/me').expect(200);
    expect(typeof res.body.uniqueId).toBe('number');
    expect(res.body.uniqueId).toBe(5005);
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/roadmap/me — Auth edge cases
// ═══════════════════════════════════════════════════════════════

describe('GET /api/roadmap/me — Auth edge cases', () => {
  test('expired Firebase token returns 401', async () => {
    // Simulate expired token: auth middleware not setting req.auth
    const app = createUnauthApp();
    await request(app).get('/api/roadmap/me').expect(401);
  });

  test('revoked Firebase token returns 401', async () => {
    // Simulate revoked token: auth middleware not setting req.auth
    const app = createUnauthApp();
    await request(app).get('/api/roadmap/me').expect(401);
  });

  test('malformed Authorization header returns 401', async () => {
    // No auth middleware sets req.auth → 401
    const app = createUnauthApp();
    const res = await request(app)
      .get('/api/roadmap/me')
      .set('Authorization', 'NotBearer sometoken');
    expect(res.status).toBe(401);
  });

  test('Bearer token with no space returns 401', async () => {
    const app = createUnauthApp();
    const res = await request(app).get('/api/roadmap/me').set('Authorization', 'Bearernoseparator');
    expect(res.status).toBe(401);
  });

  test('empty Bearer token returns 401', async () => {
    const app = createUnauthApp();
    const res = await request(app).get('/api/roadmap/me').set('Authorization', 'Bearer ');
    expect(res.status).toBe(401);
  });

  test('auth with uid but no uniqueId falls through identityMap and returns 404 when empty', async () => {
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });
    mockDocGet.mockResolvedValue({ exists: false });
    const app = createApp({ uid: 'uid-no-unique', uniqueId: null });
    const res = await request(app).get('/api/roadmap/me');
    // requireAuth passes (uid is truthy), direct path skipped (uniqueId null
    // is falsy), identityMap fallback finds nothing → deterministic 404. Pin
    // exact status, not a disjunctive [200, 404] that would also accept
    // a successful resolution that shouldn't happen against this mock.
    expect(res.status).toBe(404);
  });

  // requireAuth's `!req.auth.uniqueId` treats 0 like null/undefined — with a
  // truthy uid, the guard does NOT fire and the route falls through to the
  // identityMap path. Pin that contract so a future "tighten the guard"
  // refactor (e.g. switching to `== null`) doesn't change the response shape.
  test('uniqueId of 0 with truthy uid falls through to identityMap (returns 404 when empty)', async () => {
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });
    mockDocGet.mockResolvedValue({ exists: false });
    const app = createApp({ uid: 'uid-zero', uniqueId: 0 });
    const res = await request(app).get('/api/roadmap/me');
    expect(res.status).toBe(404);
  });

  test('auth with empty string uid returns 401 (requireAuth rejects falsy uid)', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });
    const app = createApp({ uid: '', uniqueId: null });
    const res = await request(app).get('/api/roadmap/me');
    // Empty string is falsy, so requireAuth's `!req.auth.uid && !req.auth.uniqueId`
    // guard fires deterministically — pin 401, not a disjunctive [401, 404].
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/roadmap/signout
// ═══════════════════════════════════════════════════════════════

describe('POST /api/roadmap/signout', () => {
  test('returns 200 on sign out', async () => {
    const app = createApp();
    await request(app).post('/api/roadmap/signout').expect(200);
  });

  test('returns 401 without authentication', async () => {
    const app = createUnauthApp();
    await request(app).post('/api/roadmap/signout').expect(401);
  });

  test('signout endpoint is idempotent (multiple calls succeed)', async () => {
    const app = createApp();
    await request(app).post('/api/roadmap/signout').expect(200);
    await request(app).post('/api/roadmap/signout').expect(200);
    await request(app).post('/api/roadmap/signout').expect(200);
  });

  test('signout with GET method returns 404 or 405', async () => {
    const app = createApp();
    const res = await request(app).get('/api/roadmap/signout');
    expect([404, 405]).toContain(res.status);
  });
});

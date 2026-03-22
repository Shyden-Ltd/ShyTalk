/**
 * Identity System Tests — Multi-Provider Auth
 *
 * Tests for:
 * - POST /api/users        (uniqueId-based creation + identity map)
 * - POST /api/users/sign-in (identity resolution + firebaseUid update)
 * - POST /api/users/:uniqueId/link-provider   (link additional provider)
 * - DELETE /api/users/:uniqueId/link-provider  (soft-remove / unlink)
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mocks (path-aware) ────────────────────────────────

const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocGet = jest.fn().mockResolvedValue({ exists: false });

const mockTransactionGet = jest.fn();
const mockTransactionSet = jest.fn();
const mockTransactionUpdate = jest.fn();

const mockCollectionQuery = jest.fn().mockResolvedValue({ empty: true, docs: [] });

const mockSetCustomUserClaims = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: (...args) => mockDocGet(path, ...args),
      set: (...args) => mockDocSet(path, ...args),
      update: (...args) => mockDocUpdate(path, ...args),
    })),
    collection: jest.fn((collectionPath) => ({
      where: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: () => mockCollectionQuery(collectionPath),
        })),
        get: () => mockCollectionQuery(collectionPath),
      })),
    })),
    runTransaction: jest.fn(async (fn) => {
      return fn({
        get: (ref) => mockTransactionGet(ref._path),
        set: (ref, ...args) => mockTransactionSet(ref._path, ...args),
        update: (ref, ...args) => mockTransactionUpdate(ref._path, ...args),
      });
    }),
    batch: jest.fn(() => ({
      set: jest.fn(),
      update: jest.fn(),
      commit: jest.fn().mockResolvedValue(),
    })),
  },
  auth: {
    setCustomUserClaims: (...args) => mockSetCustomUserClaims(...args),
  },
  FieldValue: {
    increment: jest.fn((n) => `increment(${n})`),
    arrayUnion: jest.fn((...args) => `arrayUnion(${args})`),
    arrayRemove: jest.fn((...args) => `arrayRemove(${args})`),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: () => 'gen-id',
  now: () => 1709913600000,
}));

jest.mock('../../src/utils/firestore-helpers', () => ({
  getDoc: jest.fn(),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/middleware/auth', () => ({
  clearSuspensionCache: jest.fn(),
  clearUniqueIdCache: jest.fn(),
  updateUniqueIdCache: jest.fn(),
}));

const { getDoc } = require('../../src/utils/firestore-helpers');

beforeEach(() => {
  jest.clearAllMocks();
  mockDocGet.mockResolvedValue({ exists: false });
  mockTransactionGet.mockResolvedValue({ exists: false });
  mockCollectionQuery.mockResolvedValue({ empty: true, docs: [] });
});

// ─── App setup ───────────────────────────────────────────────────

const usersRouter = require('../../src/routes/users');

/**
 * Creates a test app with injected auth context.
 * @param {string} uid - Firebase UID
 * @param {number|null} uniqueId - Resolved uniqueId (null for new/unknown users)
 */
function createApp(uid = 'firebase-uid-1', uniqueId = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid, uniqueId, token: {} };
    next();
  });
  app.use('/api', usersRouter);
  return app;
}

// ═══════════════════════════════════════════════════════════════════
// POST /api/users — New user creation with identity map
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/users (identity-based creation)', () => {
  test('creates new user with uniqueId >= 10000000 and identity map entry', async () => {
    // Counter doesn't exist yet → starts at 10000000
    mockTransactionGet.mockImplementation((path) => {
      if (path === 'counters/uniqueId') {
        return Promise.resolve({ exists: false });
      }
      // identityMap check inside transaction → not found
      if (path.startsWith('identityMap/')) {
        return Promise.resolve({ exists: false });
      }
      return Promise.resolve({ exists: false });
    });

    const app = createApp('firebase-uid-1', null);
    const res = await request(app)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'alice@gmail.com',
        displayName: 'Alice',
        email: 'alice@gmail.com',
        language: 'en',
        dateOfBirth: '2000-01-01',
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.created).toBe(true);
    expect(res.body.uniqueId).toBe(10000000);

    // Verify counter was set
    expect(mockTransactionSet).toHaveBeenCalledWith(
      'counters/uniqueId',
      { value: 10000000 },
      { merge: true },
    );

    // Verify user doc was created at users/10000000
    expect(mockTransactionSet).toHaveBeenCalledWith(
      'users/10000000',
      expect.objectContaining({
        uniqueId: 10000000,
        firebaseUid: 'firebase-uid-1',
        displayName: 'Alice',
        email: 'alice@gmail.com',
        providers: [
          expect.objectContaining({
            type: 'google',
            identifier: 'alice@gmail.com',
            active: true,
          }),
        ],
        userType: 'MEMBER',
      }),
    );

    // Verify identity map entry was created
    expect(mockTransactionSet).toHaveBeenCalledWith(
      'identityMap/google:alice@gmail.com',
      expect.objectContaining({
        uniqueId: 10000000,
        provider: 'google',
        identifier: 'alice@gmail.com',
        unlinked: false,
        unlinkedAt: null,
      }),
    );

    // Verify Firebase custom claims were set for Firestore security rules
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('firebase-uid-1', { uniqueId: 10000000 });
  });

  test('increments existing counter correctly', async () => {
    mockTransactionGet.mockImplementation((path) => {
      if (path === 'counters/uniqueId') {
        return Promise.resolve({
          exists: true,
          data: () => ({ value: 10000042 }),
        });
      }
      return Promise.resolve({ exists: false });
    });

    const app = createApp('firebase-uid-2', null);
    const res = await request(app)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'bob@gmail.com',
        displayName: 'Bob',
        dateOfBirth: '2000-01-01',
      })
      .expect(200);

    expect(res.body.uniqueId).toBe(10000043);

    expect(mockTransactionSet).toHaveBeenCalledWith(
      'counters/uniqueId',
      { value: 10000043 },
      { merge: true },
    );
  });

  test('rejects when provider is missing', async () => {
    const app = createApp();
    await request(app).post('/api/users').send({ identifier: 'alice@gmail.com' }).expect(400);
  });

  test('rejects when identifier is missing', async () => {
    const app = createApp();
    await request(app).post('/api/users').send({ provider: 'google' }).expect(400);
  });

  test('rejects invalid provider type', async () => {
    const app = createApp();
    await request(app)
      .post('/api/users')
      .send({ provider: 'facebook', identifier: 'user@fb.com' })
      .expect(400);
  });

  test('rejects when identity already claimed by another user (409)', async () => {
    mockTransactionGet.mockImplementation((path) => {
      if (path === 'counters/uniqueId') {
        return Promise.resolve({ exists: true, data: () => ({ value: 10000000 }) });
      }
      if (path === 'identityMap/google:taken@gmail.com') {
        return Promise.resolve({
          exists: true,
          data: () => ({ uniqueId: 10000099, unlinked: false }),
        });
      }
      return Promise.resolve({ exists: false });
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'taken@gmail.com',
        displayName: 'Impersonator',
        dateOfBirth: '2000-01-01',
      })
      .expect(409);

    expect(res.body.error).toMatch(/already/i);
  });

  test('rejects when identity is deactivated / soft-removed (409)', async () => {
    mockTransactionGet.mockImplementation((path) => {
      if (path === 'counters/uniqueId') {
        return Promise.resolve({ exists: true, data: () => ({ value: 10000000 }) });
      }
      if (path === 'identityMap/google:deactivated@gmail.com') {
        return Promise.resolve({
          exists: true,
          data: () => ({ uniqueId: 10000099, unlinked: true }),
        });
      }
      return Promise.resolve({ exists: false });
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/users')
      .send({ provider: 'google', identifier: 'deactivated@gmail.com', dateOfBirth: '2000-01-01' })
      .expect(409);

    expect(res.body.error).toMatch(/deactivated/i);
  });

  test('stores firebaseUid from authenticated user on user doc', async () => {
    mockTransactionGet.mockResolvedValue({ exists: false });

    const app = createApp('my-firebase-uid-xyz', null);
    await request(app)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'new@gmail.com',
        displayName: 'New',
        dateOfBirth: '2000-01-01',
      })
      .expect(200);

    expect(mockTransactionSet).toHaveBeenCalledWith(
      expect.stringMatching(/^users\/\d+$/),
      expect.objectContaining({ firebaseUid: 'my-firebase-uid-xyz' }),
    );
  });

  test('creates providers array with linkedAt timestamp', async () => {
    mockTransactionGet.mockResolvedValue({ exists: false });

    const app = createApp();
    await request(app)
      .post('/api/users')
      .send({ provider: 'apple', identifier: '001234.abcdef', dateOfBirth: '2000-01-01' })
      .expect(200);

    expect(mockTransactionSet).toHaveBeenCalledWith(
      expect.stringMatching(/^users\/\d+$/),
      expect.objectContaining({
        providers: [
          expect.objectContaining({
            type: 'apple',
            identifier: '001234.abcdef',
            active: true,
            linkedAt: 1709913600000,
          }),
        ],
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/users/sign-in — Identity resolution + firebaseUid update
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/users/sign-in', () => {
  test('returns found=true with uniqueId for existing linked identity', async () => {
    getDoc.mockImplementation((path) => {
      if (path === 'identityMap/google:existing@gmail.com') {
        return Promise.resolve({
          id: 'google:existing@gmail.com',
          uniqueId: 10000005,
          provider: 'google',
          identifier: 'existing@gmail.com',
          unlinked: false,
        });
      }
      return Promise.resolve(null);
    });

    const app = createApp('firebase-uid-new-project', null);
    const res = await request(app)
      .post('/api/users/sign-in')
      .send({ provider: 'google', identifier: 'existing@gmail.com' })
      .expect(200);

    expect(res.body.found).toBe(true);
    expect(res.body.uniqueId).toBe(10000005);
  });

  test('updates firebaseUid on user doc to current auth uid', async () => {
    getDoc.mockImplementation((path) => {
      if (path === 'identityMap/google:user@gmail.com') {
        return Promise.resolve({
          uniqueId: 10000005,
          unlinked: false,
        });
      }
      return Promise.resolve(null);
    });

    const app = createApp('new-firebase-uid', null);
    await request(app)
      .post('/api/users/sign-in')
      .send({ provider: 'google', identifier: 'user@gmail.com' })
      .expect(200);

    // Should update the user doc's firebaseUid
    expect(mockDocUpdate).toHaveBeenCalledWith(
      'users/10000005',
      expect.objectContaining({
        firebaseUid: 'new-firebase-uid',
        lastSeenAt: 1709913600000,
      }),
    );

    // Should set Firebase custom claims for Firestore security rules
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('new-firebase-uid', {
      uniqueId: 10000005,
    });
  });

  test('returns found=false for unknown identity', async () => {
    getDoc.mockResolvedValue(null);

    const app = createApp();
    const res = await request(app)
      .post('/api/users/sign-in')
      .send({ provider: 'google', identifier: 'unknown@gmail.com' })
      .expect(200);

    expect(res.body.found).toBe(false);
    expect(res.body.uniqueId).toBeUndefined();
  });

  test('returns deactivated flag for unlinked identity', async () => {
    getDoc.mockImplementation((path) => {
      if (path === 'identityMap/email:old@work.com') {
        return Promise.resolve({
          uniqueId: 10000010,
          unlinked: true,
        });
      }
      return Promise.resolve(null);
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/users/sign-in')
      .send({ provider: 'email', identifier: 'old@work.com' })
      .expect(200);

    expect(res.body.found).toBe(false);
    expect(res.body.deactivated).toBe(true);
  });

  test('rejects when provider is missing', async () => {
    const app = createApp();
    await request(app)
      .post('/api/users/sign-in')
      .send({ identifier: 'user@gmail.com' })
      .expect(400);
  });

  test('rejects when identifier is missing', async () => {
    const app = createApp();
    await request(app).post('/api/users/sign-in').send({ provider: 'google' }).expect(400);
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/users/:uniqueId/link-provider — Link additional provider
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/users/:uniqueId/link-provider', () => {
  test('creates identity map entry and adds to providers array', async () => {
    // Identity map doesn't exist → can link
    getDoc.mockImplementation((path) => {
      if (path === 'identityMap/email:new@work.com') {
        return Promise.resolve(null);
      }
      if (path === 'users/10000005') {
        return Promise.resolve({
          id: '10000005',
          uniqueId: 10000005,
          firebaseUid: 'firebase-uid-1',
          providers: [
            { type: 'google', identifier: 'user@gmail.com', active: true, linkedAt: 1000 },
          ],
        });
      }
      return Promise.resolve(null);
    });

    const app = createApp('firebase-uid-1', 10000005);
    const res = await request(app)
      .post('/api/users/10000005/link-provider')
      .send({ provider: 'email', identifier: 'new@work.com' })
      .expect(200);

    expect(res.body.success).toBe(true);

    // Should create identity map entry
    expect(mockDocSet).toHaveBeenCalledWith(
      'identityMap/email:new@work.com',
      expect.objectContaining({
        uniqueId: 10000005,
        provider: 'email',
        identifier: 'new@work.com',
        unlinked: false,
      }),
    );

    // Should update user doc's providers array
    expect(mockDocUpdate).toHaveBeenCalledWith(
      'users/10000005',
      expect.objectContaining({
        providers: expect.arrayContaining([
          expect.objectContaining({
            type: 'email',
            identifier: 'new@work.com',
            active: true,
          }),
        ]),
      }),
    );
  });

  test('rejects when identity already claimed by another user', async () => {
    getDoc.mockImplementation((path) => {
      if (path === 'identityMap/google:other@gmail.com') {
        return Promise.resolve({
          uniqueId: 99999999, // different user
          unlinked: false,
        });
      }
      if (path === 'users/10000005') {
        return Promise.resolve({
          uniqueId: 10000005,
          firebaseUid: 'firebase-uid-1',
          providers: [{ type: 'google', identifier: 'me@gmail.com', active: true }],
        });
      }
      return Promise.resolve(null);
    });

    const app = createApp('firebase-uid-1', 10000005);
    const res = await request(app)
      .post('/api/users/10000005/link-provider')
      .send({ provider: 'google', identifier: 'other@gmail.com' })
      .expect(409);

    expect(res.body.error).toMatch(/already/i);
  });

  test('allows re-linking own deactivated identity', async () => {
    getDoc.mockImplementation((path) => {
      if (path === 'identityMap/email:old@work.com') {
        return Promise.resolve({
          uniqueId: 10000005, // same user
          unlinked: true, // was deactivated
        });
      }
      if (path === 'users/10000005') {
        return Promise.resolve({
          uniqueId: 10000005,
          firebaseUid: 'firebase-uid-1',
          providers: [
            { type: 'google', identifier: 'me@gmail.com', active: true },
            { type: 'email', identifier: 'old@work.com', active: false },
          ],
        });
      }
      return Promise.resolve(null);
    });

    const app = createApp('firebase-uid-1', 10000005);
    const res = await request(app)
      .post('/api/users/10000005/link-provider')
      .send({ provider: 'email', identifier: 'old@work.com' })
      .expect(200);

    expect(res.body.success).toBe(true);

    // Should re-activate identity map entry
    expect(mockDocUpdate).toHaveBeenCalledWith(
      'identityMap/email:old@work.com',
      expect.objectContaining({
        unlinked: false,
        unlinkedAt: null,
      }),
    );
  });

  test('rejects when max 5 identifiers reached for provider type', async () => {
    getDoc.mockImplementation((path) => {
      if (path === 'identityMap/email:sixth@work.com') {
        return Promise.resolve(null); // not claimed
      }
      if (path === 'users/10000005') {
        return Promise.resolve({
          uniqueId: 10000005,
          firebaseUid: 'firebase-uid-1',
          providers: [
            { type: 'google', identifier: 'me@gmail.com', active: true },
            { type: 'email', identifier: 'e1@work.com', active: true },
            { type: 'email', identifier: 'e2@work.com', active: true },
            { type: 'email', identifier: 'e3@work.com', active: true },
            { type: 'email', identifier: 'e4@work.com', active: true },
            { type: 'email', identifier: 'e5@work.com', active: true },
          ],
        });
      }
      return Promise.resolve(null);
    });

    const app = createApp('firebase-uid-1', 10000005);
    const res = await request(app)
      .post('/api/users/10000005/link-provider')
      .send({ provider: 'email', identifier: 'sixth@work.com' })
      .expect(409);

    expect(res.body.error).toMatch(/unable to link|contact support/i);
  });

  test('rejects when caller uniqueId does not match :uniqueId', async () => {
    const app = createApp('firebase-uid-1', 10000005); // authenticated as 10000005
    await request(app)
      .post('/api/users/10000099/link-provider') // trying to link on different user
      .send({ provider: 'email', identifier: 'steal@work.com' })
      .expect(403);
  });

  test('rejects when provider is missing', async () => {
    const app = createApp('firebase-uid-1', 10000005);
    await request(app)
      .post('/api/users/10000005/link-provider')
      .send({ identifier: 'user@work.com' })
      .expect(400);
  });

  test('rejects when identifier is missing', async () => {
    const app = createApp('firebase-uid-1', 10000005);
    await request(app)
      .post('/api/users/10000005/link-provider')
      .send({ provider: 'email' })
      .expect(400);
  });
});

// ═══════════════════════════════════════════════════════════════════
// DELETE /api/users/:uniqueId/link-provider — Soft-remove provider
// ═══════════════════════════════════════════════════════════════════

describe('DELETE /api/users/:uniqueId/link-provider', () => {
  test('soft-removes identity and sets active=false in providers', async () => {
    getDoc.mockImplementation((path) => {
      if (path === 'identityMap/email:remove@work.com') {
        return Promise.resolve({
          uniqueId: 10000005,
          unlinked: false,
        });
      }
      if (path === 'users/10000005') {
        return Promise.resolve({
          uniqueId: 10000005,
          firebaseUid: 'firebase-uid-1',
          providers: [
            { type: 'google', identifier: 'me@gmail.com', active: true },
            { type: 'email', identifier: 'remove@work.com', active: true },
          ],
        });
      }
      return Promise.resolve(null);
    });

    const app = createApp('firebase-uid-1', 10000005);
    const res = await request(app)
      .delete('/api/users/10000005/link-provider')
      .send({ provider: 'email', identifier: 'remove@work.com' })
      .expect(200);

    expect(res.body.success).toBe(true);

    // Identity map should be soft-removed
    expect(mockDocUpdate).toHaveBeenCalledWith(
      'identityMap/email:remove@work.com',
      expect.objectContaining({
        unlinked: true,
        unlinkedAt: 1709913600000,
      }),
    );

    // User doc providers array should have active=false for this entry
    expect(mockDocUpdate).toHaveBeenCalledWith(
      'users/10000005',
      expect.objectContaining({
        providers: expect.arrayContaining([
          expect.objectContaining({
            type: 'email',
            identifier: 'remove@work.com',
            active: false,
          }),
        ]),
      }),
    );
  });

  test('rejects when only 1 active provider remains', async () => {
    getDoc.mockImplementation((path) => {
      if (path === 'users/10000005') {
        return Promise.resolve({
          uniqueId: 10000005,
          firebaseUid: 'firebase-uid-1',
          providers: [
            { type: 'google', identifier: 'only@gmail.com', active: true },
            // One deactivated provider — doesn't count
            { type: 'email', identifier: 'old@work.com', active: false },
          ],
        });
      }
      if (path === 'identityMap/google:only@gmail.com') {
        return Promise.resolve({
          uniqueId: 10000005,
          unlinked: false,
        });
      }
      return Promise.resolve(null);
    });

    const app = createApp('firebase-uid-1', 10000005);
    const res = await request(app)
      .delete('/api/users/10000005/link-provider')
      .send({ provider: 'google', identifier: 'only@gmail.com' })
      .expect(400);

    expect(res.body.error).toMatch(/at least.*provider|cannot unlink.*only/i);
  });

  test('rejects when identity not found in identity map', async () => {
    getDoc.mockImplementation((path) => {
      if (path === 'users/10000005') {
        return Promise.resolve({
          uniqueId: 10000005,
          firebaseUid: 'firebase-uid-1',
          providers: [
            { type: 'google', identifier: 'me@gmail.com', active: true },
            { type: 'email', identifier: 'real@work.com', active: true },
          ],
        });
      }
      // identityMap entry not found
      return Promise.resolve(null);
    });

    const app = createApp('firebase-uid-1', 10000005);
    await request(app)
      .delete('/api/users/10000005/link-provider')
      .send({ provider: 'email', identifier: 'nonexistent@work.com' })
      .expect(404);
  });

  test('rejects when identity belongs to different user', async () => {
    getDoc.mockImplementation((path) => {
      if (path === 'identityMap/email:other@work.com') {
        return Promise.resolve({
          uniqueId: 99999999, // different user
          unlinked: false,
        });
      }
      if (path === 'users/10000005') {
        return Promise.resolve({
          uniqueId: 10000005,
          firebaseUid: 'firebase-uid-1',
          providers: [
            { type: 'google', identifier: 'me@gmail.com', active: true },
            { type: 'email', identifier: 'mine@work.com', active: true },
          ],
        });
      }
      return Promise.resolve(null);
    });

    const app = createApp('firebase-uid-1', 10000005);
    await request(app)
      .delete('/api/users/10000005/link-provider')
      .send({ provider: 'email', identifier: 'other@work.com' })
      .expect(403);
  });

  test('rejects when caller uniqueId does not match :uniqueId', async () => {
    const app = createApp('firebase-uid-1', 10000005);
    await request(app)
      .delete('/api/users/10000099/link-provider')
      .send({ provider: 'email', identifier: 'steal@work.com' })
      .expect(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Route parameter migration: :uid → :uniqueId
// ═══════════════════════════════════════════════════════════════════

describe('Route parameter migration (:uid → :uniqueId)', () => {
  test('GET /api/users/:uniqueId returns user by uniqueId', async () => {
    getDoc.mockImplementation((path) => {
      if (path === 'users/10000005') {
        return Promise.resolve({
          id: '10000005',
          uniqueId: 10000005,
          displayName: 'Alice',
          firebaseUid: 'firebase-uid-1',
        });
      }
      return Promise.resolve(null);
    });

    const app = createApp('firebase-uid-1', 10000005);
    const res = await request(app).get('/api/users/10000005').expect(200);

    expect(res.body.displayName).toBe('Alice');
  });

  test('PATCH /api/users/:uniqueId requires matching uniqueId', async () => {
    const app = createApp('firebase-uid-1', 10000005);

    // Should succeed — caller is user 10000005
    await request(app).patch('/api/users/10000005').send({ displayName: 'New Name' }).expect(200);

    // Should fail — caller is not user 10000099
    await request(app).patch('/api/users/10000099').send({ displayName: 'Hacked' }).expect(403);
  });

  test('POST /api/users/:uniqueId/follow uses uniqueId for ownership check', async () => {
    const app = createApp('firebase-uid-1', 10000005);

    await request(app)
      .post('/api/users/10000005/follow')
      .send({ targetUserId: '10000099' })
      .expect(200);
  });

  test('POST /api/users/:uniqueId/follow rejects non-owner', async () => {
    const app = createApp('firebase-uid-1', 10000005);

    await request(app)
      .post('/api/users/10000099/follow')
      .send({ targetUserId: '10000005' })
      .expect(403);
  });
});

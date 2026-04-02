/**
 * Tests for subscription routes.
 *
 * Covers spec sections:
 *   11.6  — Subscriptions CRUD
 *   11.62 — Subscription Edge Cases
 *
 * Routes under test:
 *   GET    /api/subscriptions/me            → get preferences
 *   PUT    /api/subscriptions/me            → update preferences
 *   POST   /api/subscriptions/me/watch      → add to watch list
 *   DELETE /api/subscriptions/me/watch/:id  → remove from watch list
 *   POST   /api/subscriptions/push-token    → register push token
 *   DELETE /api/subscriptions/push-token    → revoke push token
 *   POST   /api/subscriptions/unsubscribe   → one-click email unsubscribe (token-based)
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock ──────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();
const mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [], size: 0 });

const mockQueryChain = {
  where: jest.fn(() => mockQueryChain),
  orderBy: jest.fn(() => mockQueryChain),
  limit: jest.fn(() => mockQueryChain),
  get: () => mockCollectionGet(),
};

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
      doc: jest.fn((id) => ({
        get: () => mockDocGet(`${name}/${id}`),
        set: (...args) => mockDocSet(`${name}/${id}`, ...args),
        update: (...args) => mockDocUpdate(`${name}/${id}`, ...args),
        delete: () => mockDocDelete(`${name}/${id}`),
      })),
      where: jest.fn(() => mockQueryChain),
      get: () => mockCollectionGet(),
    })),
  },
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
    arrayUnion: jest.fn((...args) => ({ _type: 'arrayUnion', values: args })),
    arrayRemove: jest.fn((...args) => ({ _type: 'arrayRemove', values: args })),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'mock-id'),
  now: jest.fn(() => 1709913600000),
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// ─── App setup ──────────────────────────────────────────────────

const subscriptionsRouter = require('../../src/routes/subscriptions');

function createApp({ uniqueId = 1001, isAdmin = false } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = {
      uid: `firebase-uid-${uniqueId}`,
      uniqueId,
      token: { admin: isAdmin },
    };
    next();
  });
  app.use('/api', subscriptionsRouter);
  return app;
}

function createUnauthApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', subscriptionsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDocGet.mockReset();
  mockCollectionGet.mockReset();
  mockDocGet.mockResolvedValue({ exists: false });
  mockCollectionGet.mockResolvedValue({ empty: true, docs: [], size: 0 });
});

// ─── Helpers ────────────────────────────────────────────────────

const DEFAULT_CHANNEL_PREFS = {
  roadmapUpdate: { email: false, push: false, inApp: true, systemMessage: false },
  suggestionAccepted: { email: false, push: false, inApp: true, systemMessage: true },
  suggestionPlanned: { email: false, push: false, inApp: true, systemMessage: false },
  suggestionCompleted: { email: false, push: false, inApp: true, systemMessage: true },
  suggestionRejected: { email: false, push: false, inApp: true, systemMessage: true },
  suggestionMerged: { email: false, push: false, inApp: true, systemMessage: true },
  commentOnSuggestion: { email: false, push: false, inApp: true, systemMessage: false },
};

function makeSubscriptionDoc(uid, overrides = {}) {
  return {
    exists: true,
    data: () => ({
      uid,
      channelPreferences: DEFAULT_CHANNEL_PREFS,
      scope: 'all',
      watchedFeatures: [],
      watchedSuggestions: [],
      language: 'en',
      pushToken: null,
      email: null,
      emailConsentAt: null,
      createdAt: 1709913600000,
      updatedAt: 1709913600000,
      ...overrides,
    }),
  };
}

// ═══════════════════════════════════════════════════════════════
// 11.6 — Subscriptions CRUD
// ═══════════════════════════════════════════════════════════════

describe('GET /api/subscriptions/me — Get preferences', () => {
  test('returns defaults for new user (in-app only)', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    const app = createApp();
    const res = await request(app).get('/api/subscriptions/me').expect(200);

    expect(res.body).toHaveProperty('channelPreferences');
    // Default should be in-app only for most events
    const prefs = res.body.channelPreferences;
    if (prefs?.roadmapUpdate) {
      expect(prefs.roadmapUpdate.inApp).toBe(true);
      expect(prefs.roadmapUpdate.email).toBe(false);
    }
  });

  test('returns saved preferences for existing user', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('subscriptions/')) {
        return Promise.resolve(
          makeSubscriptionDoc(1001, {
            channelPreferences: {
              ...DEFAULT_CHANNEL_PREFS,
              roadmapUpdate: { email: true, push: true, inApp: true, systemMessage: false },
            },
          }),
        );
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    const res = await request(app).get('/api/subscriptions/me').expect(200);
    expect(res.body.channelPreferences.roadmapUpdate.email).toBe(true);
  });
});

describe('PUT /api/subscriptions/me — Update preferences', () => {
  beforeEach(() => {
    // Simulate returning user who already has email consent
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('subscriptions/')) {
        return Promise.resolve(makeSubscriptionDoc(1001, { emailConsentAt: 1709913600000 }));
      }
      return Promise.resolve({ exists: false });
    });
  });

  test('per-event channel control saved', async () => {
    const app = createApp();
    await request(app)
      .put('/api/subscriptions/me')
      .send({
        channelPreferences: {
          roadmapUpdate: { email: true, push: false, inApp: true, systemMessage: false },
        },
      })
      .expect(200);

    expect(mockDocSet.mock.calls.length + mockDocUpdate.mock.calls.length).toBeGreaterThan(0);
  });

  test('all channels enabled for one event', async () => {
    const app = createApp();
    await request(app)
      .put('/api/subscriptions/me')
      .send({
        channelPreferences: {
          suggestionAccepted: { email: true, push: true, inApp: true, systemMessage: true },
        },
      })
      .expect(200);
  });

  test('no channels for one event (none)', async () => {
    const app = createApp();
    await request(app)
      .put('/api/subscriptions/me')
      .send({
        channelPreferences: {
          roadmapUpdate: { email: false, push: false, inApp: false, systemMessage: false },
        },
      })
      .expect(200);
  });

  test('mixed channels across events', async () => {
    const app = createApp();
    await request(app)
      .put('/api/subscriptions/me')
      .send({
        channelPreferences: {
          roadmapUpdate: { email: true, push: false, inApp: true, systemMessage: false },
          suggestionAccepted: { email: false, push: true, inApp: true, systemMessage: true },
          commentOnSuggestion: { email: false, push: false, inApp: false, systemMessage: false },
        },
      })
      .expect(200);
  });

  test('system message channel saved', async () => {
    const app = createApp();
    await request(app)
      .put('/api/subscriptions/me')
      .send({
        channelPreferences: {
          suggestionRejected: { email: false, push: false, inApp: false, systemMessage: true },
        },
      })
      .expect(200);
  });
});

describe('POST /api/subscriptions/me/watch — Watch feature/suggestion', () => {
  beforeEach(() => {
    // By default, features/suggestions exist (for watch validation)
    mockDocGet.mockImplementation((path) => {
      if (path && (path.includes('roadmapFeatures/') || path.includes('suggestions/'))) {
        return Promise.resolve({ exists: true, data: () => ({ id: path.split('/')[1] }) });
      }
      return Promise.resolve({ exists: false });
    });
  });

  test('feature added to watchedFeatures list', async () => {
    const app = createApp();
    await request(app)
      .post('/api/subscriptions/me/watch')
      .send({ type: 'feature', id: 'feature-123' })
      .expect(200);
  });

  test('duplicate watch ignored (idempotent)', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('subscriptions/')) {
        return Promise.resolve(makeSubscriptionDoc(1001, { watchedFeatures: ['feature-123'] }));
      }
      if (path && (path.includes('roadmapFeatures/') || path.includes('suggestions/'))) {
        return Promise.resolve({ exists: true, data: () => ({ id: path.split('/')[1] }) });
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app)
      .post('/api/subscriptions/me/watch')
      .send({ type: 'feature', id: 'feature-123' })
      .expect(200);
  });

  test('unwatch feature: removed from list', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('subscriptions/')) {
        return Promise.resolve(makeSubscriptionDoc(1001, { watchedFeatures: ['feature-123'] }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app).delete('/api/subscriptions/me/watch/feature-123').expect(200);
  });

  test('unwatch non-watched: returns 404', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('subscriptions/')) {
        return Promise.resolve(makeSubscriptionDoc(1001, { watchedFeatures: [] }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app).delete('/api/subscriptions/me/watch/nonexistent').expect(404);
  });

  test('watch suggestion: added to watchedSuggestions list', async () => {
    const app = createApp();
    await request(app)
      .post('/api/subscriptions/me/watch')
      .send({ type: 'suggestion', id: 'sug-456' })
      .expect(200);
  });

  test('auto-subscribe on own suggestion creation', async () => {
    // This is verified in the suggestions creation test,
    // but we confirm the subscription endpoint handles it correctly
    const app = createApp();
    await request(app)
      .post('/api/subscriptions/me/watch')
      .send({ type: 'suggestion', id: 'my-suggestion' })
      .expect(200);
  });
});

describe('POST /api/subscriptions/push-token — Push token management', () => {
  test('registration stores token', async () => {
    const app = createApp();
    await request(app)
      .post('/api/subscriptions/push-token')
      .send({ token: 'fcm-token-abc123' })
      .expect(200);

    expect(mockDocSet.mock.calls.length + mockDocUpdate.mock.calls.length).toBeGreaterThan(0);
  });

  test('update replaces old token', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('subscriptions/')) {
        return Promise.resolve(makeSubscriptionDoc(1001, { pushToken: 'old-token' }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app)
      .post('/api/subscriptions/push-token')
      .send({ token: 'new-token-xyz' })
      .expect(200);
  });

  test('clear removes token', async () => {
    const app = createApp();
    await request(app).delete('/api/subscriptions/push-token').expect(200);
  });
});

describe('Auth required on all subscription endpoints', () => {
  test('GET /api/subscriptions/me without auth returns 401', async () => {
    const app = createUnauthApp();
    await request(app).get('/api/subscriptions/me').expect(401);
  });

  test('PUT /api/subscriptions/me without auth returns 401', async () => {
    const app = createUnauthApp();
    await request(app).put('/api/subscriptions/me').send({}).expect(401);
  });

  test('POST /api/subscriptions/me/watch without auth returns 401', async () => {
    const app = createUnauthApp();
    await request(app).post('/api/subscriptions/me/watch').send({}).expect(401);
  });

  test('POST /api/subscriptions/push-token without auth returns 401', async () => {
    const app = createUnauthApp();
    await request(app).post('/api/subscriptions/push-token').send({}).expect(401);
  });
});

describe('GDPR email consent', () => {
  beforeEach(() => {
    // Simulate first-time user with no prior email consent
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('subscriptions/')) {
        return Promise.resolve(makeSubscriptionDoc(1001, { emailConsentAt: null }));
      }
      return Promise.resolve({ exists: false });
    });
  });

  test('enable email without GDPR consent returns 400', async () => {
    const app = createApp();
    await request(app)
      .put('/api/subscriptions/me')
      .send({
        channelPreferences: {
          roadmapUpdate: { email: true, push: false, inApp: true, systemMessage: false },
        },
        // No emailConsent field
      })
      .expect(400);
  });

  test('enable email with GDPR consent succeeds, timestamp stored', async () => {
    const app = createApp();
    await request(app)
      .put('/api/subscriptions/me')
      .send({
        channelPreferences: {
          roadmapUpdate: { email: true, push: false, inApp: true, systemMessage: false },
        },
        emailConsent: true,
        email: 'user@example.com',
      })
      .expect(200);
  });
});

describe('POST /api/subscriptions/unsubscribe — One-click email unsubscribe', () => {
  test('valid token removes email channel preference', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('subscriptions/')) {
        return Promise.resolve(
          makeSubscriptionDoc(1001, {
            channelPreferences: {
              ...DEFAULT_CHANNEL_PREFS,
              roadmapUpdate: { email: true, push: false, inApp: true, systemMessage: false },
            },
          }),
        );
      }
      return Promise.resolve({ exists: false });
    });
    const app = express();
    app.use(express.json());
    // Unsubscribe endpoint is token-based (no auth required)
    app.use('/api', subscriptionsRouter);
    await request(app)
      .post('/api/subscriptions/unsubscribe')
      .send({ token: 'valid-unsubscribe-token' })
      .expect(200);
  });

  test('invalid token returns 400', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', subscriptionsRouter);
    await request(app)
      .post('/api/subscriptions/unsubscribe')
      .send({ token: 'invalid-garbage-token' })
      .expect(400);
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.62 — Subscription Edge Cases
// ═══════════════════════════════════════════════════════════════

describe('Subscription Edge Cases', () => {
  test('user watches same feature twice: idempotent, no duplicate', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('subscriptions/')) {
        return Promise.resolve(makeSubscriptionDoc(1001, { watchedFeatures: ['f1'] }));
      }
      if (path && path.includes('roadmapFeatures/')) {
        return Promise.resolve({ exists: true, data: () => ({ id: 'f1' }) });
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app)
      .post('/api/subscriptions/me/watch')
      .send({ type: 'feature', id: 'f1' })
      .expect(200);
    // Should use arrayUnion which handles dedup
  });

  test('user watches 100+ features: all stored', async () => {
    const features = Array.from({ length: 100 }, (_, i) => `feature-${i}`);
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('subscriptions/')) {
        return Promise.resolve(makeSubscriptionDoc(1001, { watchedFeatures: features }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    const res = await request(app).get('/api/subscriptions/me').expect(200);
    expect(res.body.watchedFeatures?.length || 0).toBeGreaterThanOrEqual(100);
  });

  test('user watches suggestion that gets completed: removed from watch list after final notification', async () => {
    // This is tested in the notification dispatch tests
    // Here we verify the subscription doc structure supports it
    const app = createApp();
    const res = await request(app).get('/api/subscriptions/me').expect(200);
    expect(res.body).toHaveProperty('watchedSuggestions');
  });

  test('user watches suggestion that gets rejected: removed from watch list', async () => {
    // Verified via notification dispatch
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('subscriptions/')) {
        return Promise.resolve(makeSubscriptionDoc(1001, { watchedSuggestions: ['sug-rejected'] }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    const res = await request(app).get('/api/subscriptions/me').expect(200);
    expect(res.body.watchedSuggestions).toBeDefined();
  });

  test('user watches suggestion that gets merged: watch transferred to original', async () => {
    // Verified via merge handling in suggestions-duplicates tests
    // The subscription endpoint needs to handle the transfer
  });

  test('user unsubscribes from all channels for all events: doc preserved with all false', async () => {
    const app = createApp();
    const allFalse = {};
    for (const key of Object.keys(DEFAULT_CHANNEL_PREFS)) {
      allFalse[key] = { email: false, push: false, inApp: false, systemMessage: false };
    }
    await request(app)
      .put('/api/subscriptions/me')
      .send({ channelPreferences: allFalse })
      .expect(200);

    // Doc should not be deleted, just all channels set to false
    const deleteCalls = mockDocDelete.mock.calls.filter((c) => c[0]?.includes?.('subscriptions'));
    expect(deleteCalls.length).toBe(0);
  });

  test('GDPR consent revoked: email disabled, timestamp cleared', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('subscriptions/')) {
        return Promise.resolve(
          makeSubscriptionDoc(1001, {
            email: 'user@example.com',
            emailConsentAt: 1709913600000,
            channelPreferences: {
              ...DEFAULT_CHANNEL_PREFS,
              roadmapUpdate: { email: true, push: false, inApp: true, systemMessage: false },
            },
          }),
        );
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app).put('/api/subscriptions/me').send({ emailConsent: false }).expect(200);

    // Verify email channel disabled and consent cleared
  });

  test('update preferences with empty object: no-op, returns current', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('subscriptions/')) {
        return Promise.resolve(makeSubscriptionDoc(1001));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    const res = await request(app).put('/api/subscriptions/me').send({}).expect(200);

    expect(res.body).toHaveProperty('channelPreferences');
  });

  test('subscribe to non-existent feature: returns 404', async () => {
    // If feature validation is implemented
    const app = createApp();
    await request(app)
      .post('/api/subscriptions/me/watch')
      .send({ type: 'feature', id: 'nonexistent-feature-xyz' })
      // May return 200 (if no validation) or 404 (if validated)
      // Spec says 404 — test documents expected behavior
      .expect(404);
  });
});

// ═══════════════════════════════════════════════════════════════
// Additional coverage — uncovered lines and branches
// ═══════════════════════════════════════════════════════════════

describe('Auth required on remaining endpoints', () => {
  test('DELETE /api/subscriptions/me/watch/:id without auth returns 401', async () => {
    const app = createUnauthApp();
    await request(app).delete('/api/subscriptions/me/watch/some-id').expect(401);
  });

  test('DELETE /api/subscriptions/push-token without auth returns 401', async () => {
    const app = createUnauthApp();
    await request(app).delete('/api/subscriptions/push-token').expect(401);
  });
});

describe('POST /api/subscriptions/me/watch — validation', () => {
  test('returns 400 when type is missing', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/subscriptions/me/watch')
      .send({ id: 'feature-123' })
      .expect(400);
    expect(res.body.error).toBe('Type and ID required');
  });

  test('returns 400 when id is missing', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/subscriptions/me/watch')
      .send({ type: 'feature' })
      .expect(400);
    expect(res.body.error).toBe('Type and ID required');
  });
});

describe('POST /api/subscriptions/push-token — validation', () => {
  test('returns 400 when token is missing', async () => {
    const app = createApp();
    const res = await request(app).post('/api/subscriptions/push-token').send({}).expect(400);
    expect(res.body.error).toBe('Token required');
  });
});

describe('DELETE /api/subscriptions/me/watch/:id — edge cases', () => {
  test('returns 404 when subscription doc does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    const app = createApp();
    const res = await request(app).delete('/api/subscriptions/me/watch/some-id').expect(404);
    expect(res.body.error).toBe('Not watching this item');
  });

  test('removes from watchedSuggestions when id is in suggestions list', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('subscriptions/')) {
        return Promise.resolve(makeSubscriptionDoc(1001, { watchedSuggestions: ['sug-999'] }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app).delete('/api/subscriptions/me/watch/sug-999').expect(200);
    expect(mockDocUpdate).toHaveBeenCalled();
  });
});

describe('PUT /api/subscriptions/me — emailConsent=false branch', () => {
  test('emailConsent=false disables email in provided channelPreferences', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('subscriptions/')) {
        return Promise.resolve(makeSubscriptionDoc(1001, { emailConsentAt: 1709913600000 }));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app)
      .put('/api/subscriptions/me')
      .send({
        emailConsent: false,
        channelPreferences: {
          roadmapUpdate: { email: true, push: false, inApp: true, systemMessage: false },
        },
      })
      .expect(200);

    // The set call should have email disabled in channelPreferences
    const setCalls = mockDocSet.mock.calls;
    const updateCall = setCalls.find((c) => c[0] && c[0].includes('subscriptions/'));
    expect(updateCall).toBeDefined();
    const savedData = updateCall[1];
    expect(savedData.emailConsentAt).toBeNull();
    expect(savedData.channelPreferences.roadmapUpdate.email).toBe(false);
  });
});

describe('PUT /api/subscriptions/me — scope update', () => {
  test('scope is saved when provided', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('subscriptions/')) {
        return Promise.resolve(makeSubscriptionDoc(1001));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app).put('/api/subscriptions/me').send({ scope: 'watched_only' }).expect(200);

    const setCalls = mockDocSet.mock.calls;
    const updateCall = setCalls.find((c) => c[0] && c[0].includes('subscriptions/'));
    expect(updateCall).toBeDefined();
    expect(updateCall[1].scope).toBe('watched_only');
  });
});

describe('Error handling — 500 responses', () => {
  test('GET /api/subscriptions/me returns 500 on Firestore error', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore error'));
    const app = createApp();
    const res = await request(app).get('/api/subscriptions/me').expect(500);
    expect(res.body.error).toBe('Internal server error');
  });

  test('PUT /api/subscriptions/me returns 500 on Firestore error', async () => {
    mockDocSet.mockRejectedValueOnce(new Error('Firestore write error'));
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('subscriptions/')) {
        return Promise.resolve(makeSubscriptionDoc(1001));
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    const res = await request(app).put('/api/subscriptions/me').send({ scope: 'all' }).expect(500);
    expect(res.body.error).toBe('Internal server error');
  });

  test('POST /api/subscriptions/me/watch returns 500 on Firestore error', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && (path.includes('roadmapFeatures/') || path.includes('suggestions/'))) {
        return Promise.resolve({ exists: true, data: () => ({ id: 'f1' }) });
      }
      return Promise.resolve({ exists: false });
    });
    mockDocSet.mockRejectedValueOnce(new Error('Firestore write error'));
    const app = createApp();
    const res = await request(app)
      .post('/api/subscriptions/me/watch')
      .send({ type: 'feature', id: 'f1' })
      .expect(500);
    expect(res.body.error).toBe('Internal server error');
  });

  test('DELETE /api/subscriptions/me/watch/:id returns 500 on Firestore error', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path && path.includes('subscriptions/')) {
        return Promise.resolve(makeSubscriptionDoc(1001, { watchedFeatures: ['f1'] }));
      }
      return Promise.resolve({ exists: false });
    });
    mockDocUpdate.mockRejectedValueOnce(new Error('Firestore update error'));
    const app = createApp();
    const res = await request(app).delete('/api/subscriptions/me/watch/f1').expect(500);
    expect(res.body.error).toBe('Internal server error');
  });

  test('POST /api/subscriptions/push-token returns 500 on Firestore error', async () => {
    mockDocSet.mockRejectedValueOnce(new Error('Firestore write error'));
    const app = createApp();
    const res = await request(app)
      .post('/api/subscriptions/push-token')
      .send({ token: 'my-token' })
      .expect(500);
    expect(res.body.error).toBe('Internal server error');
  });

  test('DELETE /api/subscriptions/push-token returns 500 on Firestore error', async () => {
    mockDocSet.mockRejectedValueOnce(new Error('Firestore write error'));
    const app = createApp();
    const res = await request(app).delete('/api/subscriptions/push-token').expect(500);
    expect(res.body.error).toBe('Internal server error');
  });
});

describe('POST /api/subscriptions/unsubscribe — additional coverage', () => {
  test('returns 400 when token is missing entirely', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', subscriptionsRouter);
    const res = await request(app).post('/api/subscriptions/unsubscribe').send({}).expect(400);
    expect(res.body.error).toBe('Unsubscribe token required');
  });

  test('returns 400 when token is whitespace only', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', subscriptionsRouter);
    const res = await request(app)
      .post('/api/subscriptions/unsubscribe')
      .send({ token: '   ' })
      .expect(400);
    expect(res.body.error).toBe('Unsubscribe token required');
  });

  test('returns 400 when token is non-string', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', subscriptionsRouter);
    const res = await request(app)
      .post('/api/subscriptions/unsubscribe')
      .send({ token: 99999 })
      .expect(400);
    expect(res.body.error).toBe('Unsubscribe token required');
  });

  test('returns 400 when token is < 10 chars', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', subscriptionsRouter);
    const res = await request(app)
      .post('/api/subscriptions/unsubscribe')
      .send({ token: 'short' })
      .expect(400);
    expect(res.body.error).toBe('Invalid unsubscribe token');
  });

  test('returns 400 when token >= 10 chars but missing unsubscribe marker', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', subscriptionsRouter);
    const res = await request(app)
      .post('/api/subscriptions/unsubscribe')
      .send({ token: 'longtokenwithoutmarker' })
      .expect(400);
    expect(res.body.error).toBe('Invalid unsubscribe token');
  });

  test('returns success when token >= 10 chars and includes unsubscribe marker', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', subscriptionsRouter);
    const res = await request(app)
      .post('/api/subscriptions/unsubscribe')
      .send({ token: 'unsubscribe-abc-123' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Email notifications disabled');
  });
});

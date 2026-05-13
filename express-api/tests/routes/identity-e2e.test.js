/**
 * Identity System E2E Integration Tests
 *
 * Multi-step flows that chain API calls together to verify
 * the full identity lifecycle:
 *
 * 1. Create user → sign-in → same uniqueId returned
 * 2. Create user → link provider → sign-in with new provider → same account
 * 3. Create user → link → unlink → sign-in with unlinked → deactivated
 * 4. Create user → link → unlink → re-link → sign-in → works
 * 5. Cross-project sign-in (different Firebase UID, same identity → same uniqueId)
 * 6. Device ban propagation (suspended user on new device → new device banned)
 * 7. Admin unbind (remove device binding → device unbound)
 */

const express = require('express');
const request = require('supertest');

// ─── Shared state (simulates Firestore) ──────────────────────────

/** In-memory data store to simulate multi-step flows */
const store = {
  docs: {},
  counter: 0,
};

function resetStore() {
  store.docs = {};
  store.counter = 0;
}

// ─── Firebase mocks (path-aware, stateful) ───────────────────────

const mockDocSet = jest.fn((path, data, opts) => {
  if (opts?.merge) {
    store.docs[path] = { ...(store.docs[path] || {}), ...data };
  } else {
    store.docs[path] = data;
  }
  return Promise.resolve();
});

const mockDocUpdate = jest.fn((path, data) => {
  store.docs[path] = { ...(store.docs[path] || {}), ...data };
  return Promise.resolve();
});

const mockDocGet = jest.fn((path) => {
  const data = store.docs[path];
  return Promise.resolve({
    exists: !!data,
    data: () => data || {},
  });
});

const mockDocDelete = jest.fn((path) => {
  delete store.docs[path];
  return Promise.resolve();
});

const mockTransactionGet = jest.fn((path) => {
  const data = store.docs[path];
  return Promise.resolve({
    exists: !!data,
    data: () => data || {},
  });
});

const mockTransactionSet = jest.fn((path, data, opts) => {
  if (opts?.merge) {
    store.docs[path] = { ...(store.docs[path] || {}), ...data };
  } else {
    store.docs[path] = data;
  }
});

const mockTransactionUpdate = jest.fn((path, data) => {
  store.docs[path] = { ...(store.docs[path] || {}), ...data };
});

const mockCollectionQuery = jest.fn((collectionPath) => {
  const prefix = `${collectionPath}/`;
  const docs = Object.entries(store.docs)
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, data]) => ({
      id: key.replace(prefix, ''),
      data: () => data,
    }));
  return Promise.resolve({
    empty: docs.length === 0,
    docs,
  });
});

const mockSetCustomUserClaims = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: () => mockDocGet(path),
      set: (...args) => mockDocSet(path, ...args),
      update: (...args) => mockDocUpdate(path, ...args),
      delete: () => mockDocDelete(path),
    })),
    collection: jest.fn((collectionPath) => ({
      where: jest.fn((field, op, value) => ({
        limit: jest.fn(() => ({
          get: () => {
            // For user queries by firebaseUid, search the store
            const prefix = `${collectionPath}/`;
            const matches = Object.entries(store.docs)
              .filter(([key, data]) => key.startsWith(prefix) && data[field] === value)
              .map(([key, data]) => ({
                id: key.replace(prefix, ''),
                data: () => data,
              }));
            return Promise.resolve({
              empty: matches.length === 0,
              docs: matches,
            });
          },
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
  getDoc: jest.fn((path) => {
    const data = store.docs[path];
    if (!data) return Promise.resolve(null);
    return Promise.resolve({ id: path.split('/').pop(), ...data });
  }),
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

// ─── App setup ───────────────────────────────────────────────────

const usersRouter = require('../../src/routes/users');

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

beforeEach(() => {
  jest.clearAllMocks();
  resetStore();
});

// ═══════════════════════════════════════════════════════════════════
// Flow 1: Create user → same-provider sign-in → same uniqueId
// ═══════════════════════════════════════════════════════════════════

describe('Flow: Create → Same-provider sign-in', () => {
  test('sign-in with same provider returns same uniqueId', async () => {
    // Step 1: Create user
    const createApp1 = createApp('firebase-uid-alice', null);
    const createRes = await request(createApp1)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'alice@gmail.com',
        displayName: 'Alice',
        dateOfBirth: '2000-01-01',
      })
      .expect(200);

    const uniqueId = createRes.body.uniqueId;
    expect(uniqueId).toBeGreaterThanOrEqual(10000000);

    // Step 2: Sign in with same provider — should find same uniqueId
    const signInApp = createApp('firebase-uid-alice', null);
    const signInRes = await request(signInApp)
      .post('/api/users/sign-in')
      .send({ provider: 'google', identifier: 'alice@gmail.com' })
      .expect(200);

    expect(signInRes.body.found).toBe(true);
    expect(signInRes.body.uniqueId).toBe(uniqueId);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Flow 2: Create → Link provider → Sign-in with new provider
// ═══════════════════════════════════════════════════════════════════

describe('Flow: Create → Link → Sign-in with linked provider', () => {
  test('sign-in with newly linked provider returns same account', async () => {
    // Step 1: Create user with Google
    const createApp1 = createApp('firebase-uid-bob', null);
    const createRes = await request(createApp1)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'bob@gmail.com',
        displayName: 'Bob',
        dateOfBirth: '2000-01-01',
      })
      .expect(200);

    const uniqueId = createRes.body.uniqueId;

    // Step 2: Link email provider
    const linkApp = createApp('firebase-uid-bob', uniqueId);
    await request(linkApp)
      .post(`/api/users/${uniqueId}/link-provider`)
      .send({ provider: 'email', identifier: 'bob@work.com' })
      .expect(200);

    // Step 3: Sign in with the linked email — should find same uniqueId
    const signInApp = createApp('firebase-uid-bob-new-project', null);
    const signInRes = await request(signInApp)
      .post('/api/users/sign-in')
      .send({ provider: 'email', identifier: 'bob@work.com' })
      .expect(200);

    expect(signInRes.body.found).toBe(true);
    expect(signInRes.body.uniqueId).toBe(uniqueId);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Flow 3: Create → Link → Unlink → Sign-in with unlinked → Deactivated
// ═══════════════════════════════════════════════════════════════════

describe('Flow: Create → Link → Unlink → Sign-in with unlinked', () => {
  test('sign-in with unlinked provider returns deactivated', async () => {
    // Step 1: Create user with Google
    const app1 = createApp('firebase-uid-carol', null);
    const createRes = await request(app1)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'carol@gmail.com',
        displayName: 'Carol',
        dateOfBirth: '2000-01-01',
      })
      .expect(200);

    const uniqueId = createRes.body.uniqueId;

    // Step 2: Link email
    const linkApp = createApp('firebase-uid-carol', uniqueId);
    await request(linkApp)
      .post(`/api/users/${uniqueId}/link-provider`)
      .send({ provider: 'email', identifier: 'carol@work.com' })
      .expect(200);

    // Step 3: Unlink email
    const unlinkApp = createApp('firebase-uid-carol', uniqueId);
    await request(unlinkApp)
      .delete(`/api/users/${uniqueId}/link-provider`)
      .send({ provider: 'email', identifier: 'carol@work.com' })
      .expect(200);

    // Step 4: Sign in with the unlinked email — should return deactivated
    const signInApp = createApp('firebase-uid-carol', null);
    const signInRes = await request(signInApp)
      .post('/api/users/sign-in')
      .send({ provider: 'email', identifier: 'carol@work.com' })
      .expect(200);

    expect(signInRes.body.found).toBe(false);
    expect(signInRes.body.deactivated).toBe(true);
  });

  test('unlinked identity cannot be claimed by another user', async () => {
    // Step 1: Create user 1 with Google
    const app1 = createApp('firebase-uid-dave', null);
    const createRes1 = await request(app1)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'dave@gmail.com',
        displayName: 'Dave',
        dateOfBirth: '2000-01-01',
      })
      .expect(200);

    const uniqueId1 = createRes1.body.uniqueId;

    // Step 2: Link email to user 1
    const linkApp = createApp('firebase-uid-dave', uniqueId1);
    await request(linkApp)
      .post(`/api/users/${uniqueId1}/link-provider`)
      .send({ provider: 'email', identifier: 'shared@work.com' })
      .expect(200);

    // Step 3: Unlink email from user 1
    const unlinkApp = createApp('firebase-uid-dave', uniqueId1);
    await request(unlinkApp)
      .delete(`/api/users/${uniqueId1}/link-provider`)
      .send({ provider: 'email', identifier: 'shared@work.com' })
      .expect(200);

    // Step 4: User 2 tries to create account with that email → 409
    const app2 = createApp('firebase-uid-eve', null);
    const createRes2 = await request(app2)
      .post('/api/users')
      .send({
        provider: 'email',
        identifier: 'shared@work.com',
        displayName: 'Eve',
        dateOfBirth: '2000-01-01',
      })
      .expect(409);

    expect(createRes2.body.error).toMatch(/deactivated/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Flow 4: Create → Link → Unlink → Re-link → Sign-in → Works
// ═══════════════════════════════════════════════════════════════════

describe('Flow: Create → Link → Unlink → Re-link → Sign-in', () => {
  test('re-linked provider allows sign-in again', async () => {
    // Step 1: Create user
    const app1 = createApp('firebase-uid-frank', null);
    const createRes = await request(app1)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'frank@gmail.com',
        displayName: 'Frank',
        dateOfBirth: '2000-01-01',
      })
      .expect(200);

    const uniqueId = createRes.body.uniqueId;

    // Step 2: Link email
    const linkApp = createApp('firebase-uid-frank', uniqueId);
    await request(linkApp)
      .post(`/api/users/${uniqueId}/link-provider`)
      .send({ provider: 'email', identifier: 'frank@work.com' })
      .expect(200);

    // Step 3: Unlink email
    const unlinkApp = createApp('firebase-uid-frank', uniqueId);
    await request(unlinkApp)
      .delete(`/api/users/${uniqueId}/link-provider`)
      .send({ provider: 'email', identifier: 'frank@work.com' })
      .expect(200);

    // Step 4: Re-link email (same user)
    const relinkApp = createApp('firebase-uid-frank', uniqueId);
    await request(relinkApp)
      .post(`/api/users/${uniqueId}/link-provider`)
      .send({ provider: 'email', identifier: 'frank@work.com' })
      .expect(200);

    // Step 5: Sign in with re-linked email — should work
    const signInApp = createApp('firebase-uid-frank-new', null);
    const signInRes = await request(signInApp)
      .post('/api/users/sign-in')
      .send({ provider: 'email', identifier: 'frank@work.com' })
      .expect(200);

    expect(signInRes.body.found).toBe(true);
    expect(signInRes.body.uniqueId).toBe(uniqueId);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Flow 5: Cross-project sign-in (different Firebase UID, same identity)
// ═══════════════════════════════════════════════════════════════════

describe('Flow: Cross-project sign-in', () => {
  test('same identity with different Firebase UID resolves to same uniqueId and updates firebaseUid', async () => {
    // Step 1: Create user from project A
    const appA = createApp('firebase-uid-project-A', null);
    const createRes = await request(appA)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'grace@gmail.com',
        displayName: 'Grace',
        dateOfBirth: '2000-01-01',
      })
      .expect(200);

    const uniqueId = createRes.body.uniqueId;

    // Verify user doc has project A's firebase UID
    expect(store.docs[`users/${uniqueId}`].firebaseUid).toBe('firebase-uid-project-A');

    // Step 2: Sign in from project B (different Firebase UID, same Google account)
    const appB = createApp('firebase-uid-project-B', null);
    const signInRes = await request(appB)
      .post('/api/users/sign-in')
      .send({ provider: 'google', identifier: 'grace@gmail.com' })
      .expect(200);

    expect(signInRes.body.found).toBe(true);
    expect(signInRes.body.uniqueId).toBe(uniqueId);

    // Verify firebaseUid was updated to project B's UID
    expect(store.docs[`users/${uniqueId}`].firebaseUid).toBe('firebase-uid-project-B');

    // Verify custom claims were set for project B's UID. PR 2 adds
    // `cohort` to every sign-in mint to keep the OSA #17 segregation
    // claim consistent with the user doc's cohort field.
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      'firebase-uid-project-B',
      expect.objectContaining({ uniqueId, cohort: expect.stringMatching(/^(adult|minor)$/) }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Flow 6: Provider linking limit (5 max per type)
// ═══════════════════════════════════════════════════════════════════

describe('Flow: Provider linking limit', () => {
  test('cannot link 6th email — limit reached', async () => {
    // Step 1: Create user with Google
    const app1 = createApp('firebase-uid-henry', null);
    const createRes = await request(app1)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'henry@gmail.com',
        displayName: 'Henry',
        dateOfBirth: '2000-01-01',
      })
      .expect(200);

    const uniqueId = createRes.body.uniqueId;

    // Step 2: Link 5 emails
    for (let i = 1; i <= 5; i++) {
      const linkApp = createApp('firebase-uid-henry', uniqueId);
      await request(linkApp)
        .post(`/api/users/${uniqueId}/link-provider`)
        .send({ provider: 'email', identifier: `henry${i}@work.com` })
        .expect(200);
    }

    // Step 3: Try to link 6th email — should fail
    const linkApp6 = createApp('firebase-uid-henry', uniqueId);
    const res = await request(linkApp6)
      .post(`/api/users/${uniqueId}/link-provider`)
      .send({ provider: 'email', identifier: 'henry6@work.com' })
      .expect(409);

    expect(res.body.error).toMatch(/unable to link|contact support/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Flow 7: Multiple users — identities are isolated
// ═══════════════════════════════════════════════════════════════════

describe('Flow: Multiple users — identity isolation', () => {
  test('two users with separate identities get different uniqueIds', async () => {
    // Create user 1
    const app1 = createApp('firebase-uid-user1', null);
    const res1 = await request(app1)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'user1@gmail.com',
        displayName: 'User One',
        dateOfBirth: '2000-01-01',
      })
      .expect(200);

    // Create user 2
    const app2 = createApp('firebase-uid-user2', null);
    const res2 = await request(app2)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'user2@gmail.com',
        displayName: 'User Two',
        dateOfBirth: '2000-01-01',
      })
      .expect(200);

    expect(res1.body.uniqueId).not.toBe(res2.body.uniqueId);
    expect(res2.body.uniqueId).toBe(res1.body.uniqueId + 1);
  });

  test('user cannot link identity that belongs to another user', async () => {
    // Create user 1
    const app1 = createApp('firebase-uid-user1', null);
    const _res1 = await request(app1)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'owner@gmail.com',
        displayName: 'Owner',
        dateOfBirth: '2000-01-01',
      })
      .expect(200);

    // Create user 2
    const app2 = createApp('firebase-uid-user2', null);
    const res2 = await request(app2)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'other@gmail.com',
        displayName: 'Other',
        dateOfBirth: '2000-01-01',
      })
      .expect(200);

    // User 2 tries to link user 1's email → 409
    const linkApp = createApp('firebase-uid-user2', res2.body.uniqueId);
    const linkRes = await request(linkApp)
      .post(`/api/users/${res2.body.uniqueId}/link-provider`)
      .send({ provider: 'google', identifier: 'owner@gmail.com' })
      .expect(409);

    expect(linkRes.body.error).toMatch(/already/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Flow 8: Unlink — must keep at least one active provider
// ═══════════════════════════════════════════════════════════════════

describe('Flow: Unlink guard — at least one active provider', () => {
  test('cannot unlink only active provider', async () => {
    // Create user with Google only
    const app1 = createApp('firebase-uid-iris', null);
    const createRes = await request(app1)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'iris@gmail.com',
        displayName: 'Iris',
        dateOfBirth: '2000-01-01',
      })
      .expect(200);

    const uniqueId = createRes.body.uniqueId;

    // Try to unlink the only provider → should fail
    const unlinkApp = createApp('firebase-uid-iris', uniqueId);
    const unlinkRes = await request(unlinkApp)
      .delete(`/api/users/${uniqueId}/link-provider`)
      .send({ provider: 'google', identifier: 'iris@gmail.com' })
      .expect(400);

    expect(unlinkRes.body.error).toMatch(/at least.*provider|cannot unlink/i);
  });
});

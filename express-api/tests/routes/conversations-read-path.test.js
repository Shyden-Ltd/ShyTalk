/**
 * SHY-0458 — the conversation READ path, server-side.
 *
 * The client used to read conversations straight from Firestore. That broke
 * private messaging outright: `firestore.rules:355` dereferences
 * `resource.data.participantIds`, so reading a conversation that does not exist
 * YET is a rules evaluation error rather than a miss —
 *
 *   GET /conversations/50000010_50000020 -> 403
 *     "evaluation error at L355:21 for 'get' @ L355, Null value error."
 *
 * — and `getOrCreateConversation` opens with exactly that read, so no
 * conversation could ever be created. These endpoints move the decision to the
 * server, where a missing document is a 404 and creation is a deliberate,
 * authorised act.
 *
 * The gates asserted here are the ones that matter for a minors-facing product:
 * you may only see conversations you are in, cross-cohort pairs cannot be
 * created, and threads frozen at migration stay hidden (UK OSA #17).
 */

const express = require('express');
const request = require('supertest');

// ─── Firestore mock ──────────────────────────────────────────────
// Modelled on tests/routes/conversations.test.js, extended with the
// where/orderBy/limit chain the list endpoint needs.

const state = {
  conversations: [], // {id, data}
  users: {}, // uniqueId -> data
  written: [], // {path, data}
};

const docSnap = (id, data) => ({
  id,
  exists: data !== undefined,
  data: () => data,
  ref: { id },
});

const makeQuery = () => {
  const filters = [];
  const q = {
    where: (field, op, value) => {
      filters.push({ field, op, value });
      return q;
    },
    orderBy: () => q,
    limit: (n) => {
      q._limit = n;
      return q;
    },
    get: async () => {
      let rows = state.conversations;
      for (const f of filters) {
        if (f.op === 'array-contains') {
          rows = rows.filter((r) =>
            (r.data.participantIds || []).map(String).includes(String(f.value)),
          );
        } else if (f.op === '==') {
          rows = rows.filter((r) => (r.data[f.field] ?? false) === f.value);
        }
      }
      if (q._limit) rows = rows.slice(0, q._limit);
      return {
        empty: rows.length === 0,
        size: rows.length,
        docs: rows.map((r) => docSnap(r.id, r.data)),
      };
    },
  };
  return q;
};

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      get: async () => {
        const [coll, id] = path.split('/');
        if (coll === 'conversations') {
          const hit = state.conversations.find((c) => c.id === id);
          return docSnap(id, hit ? hit.data : undefined);
        }
        if (coll === 'users') return docSnap(id, state.users[id]);
        return docSnap(id, undefined);
      },
      set: async (data) => {
        state.written.push({ path, data });
        const [, id] = path.split('/');
        state.conversations.push({ id, data });
      },
      update: async () => {},
    })),
    collection: jest.fn(() => makeQuery()),
  },
  rtdb: { ref: jest.fn(() => ({ set: jest.fn().mockResolvedValue() })) },
  FieldValue: { serverTimestamp: () => 'ts' },
}));

jest.mock('../../src/middleware/sameCohort', () => ({
  requireSameCohort: () => (req, res, next) => next(),
}));
jest.mock('../../src/middleware/auth', () => ({ isLiveAdmin: async () => false }));

const buildApp = (uniqueId = 50000010) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uniqueId, cohort: 'adult' };
    next();
  });
  app.use('/api', require('../../src/routes/conversations'));
  return app;
};

const reset = () => {
  state.conversations = [];
  state.users = {
    50000010: { uniqueId: 50000010, cohort: 'adult', displayName: 'Alice' },
    50000020: { uniqueId: 50000020, cohort: 'adult', displayName: 'Lena' },
    60000010: { uniqueId: 60000010, cohort: 'minor', displayName: 'Marcus' },
  };
  state.written = [];
};

beforeEach(reset);

describe('GET /api/conversations', () => {
  test('returns only conversations the caller is in', async () => {
    state.conversations = [
      { id: 'a', data: { participantIds: ['50000010', '50000020'], lastMessageAt: 2 } },
      { id: 'b', data: { participantIds: ['50000020', '60000010'], lastMessageAt: 3 } },
    ];
    const res = await request(buildApp()).get('/api/conversations');
    expect(res.status).toBe(200);
    const ids = res.body.map((c) => c.id);
    expect(ids).toContain('a');
    expect(ids).not.toContain('b');
  });

  test('excludes threads frozen at migration (UK OSA #17)', async () => {
    state.conversations = [
      { id: 'ok', data: { participantIds: ['50000010', '50000020'], lastMessageAt: 1 } },
      {
        id: 'frozen',
        data: {
          participantIds: ['50000010', '60000010'],
          crossCohortAtMigration: true,
          lastMessageAt: 9,
        },
      },
    ];
    const res = await request(buildApp()).get('/api/conversations');
    expect(res.status).toBe(200);
    expect(res.body.map((c) => c.id)).not.toContain('frozen');
  });

  test('an empty list is 200 with [], not an error', async () => {
    // The defect this story fixes made "no conversations yet" indistinguishable
    // from "denied". They must never look the same again.
    const res = await request(buildApp()).get('/api/conversations');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('POST /api/conversations — get or create', () => {
  test('creates the conversation when none exists', async () => {
    const res = await request(buildApp())
      .post('/api/conversations')
      .send({ otherUserId: 50000020 });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeTruthy();
    expect(res.body.participantIds.map(String).sort()).toEqual(['50000010', '50000020']);
    expect(state.written.length).toBe(1);
  });

  test('a conversation that does not exist yet is created, never a rules error', async () => {
    // The exact case that returned "Null value error" from firestore.rules.
    const res = await request(buildApp())
      .post('/api/conversations')
      .send({ otherUserId: 50000020 });
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
  });

  test('returns the existing conversation instead of creating a second', async () => {
    state.conversations = [
      { id: '50000010_50000020', data: { participantIds: ['50000010', '50000020'] } },
    ];
    const res = await request(buildApp())
      .post('/api/conversations')
      .send({ otherUserId: 50000020 });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('50000010_50000020');
    expect(state.written.length).toBe(0);
  });

  test('refuses a conversation with yourself', async () => {
    const res = await request(buildApp())
      .post('/api/conversations')
      .send({ otherUserId: 50000010 });
    expect(res.status).toBe(400);
  });

  test('refuses a cross-cohort pair', async () => {
    // The safeguarding gate. An adult must not be able to open a thread with a
    // minor by asking the API politely.
    //
    // The body is asserted too: a bare status check passes when the ROUTE does
    // not exist, because Express answers its own 404 — which is how this test
    // passed before a single line of the endpoint was written.
    const res = await request(buildApp())
      .post('/api/conversations')
      .send({ otherUserId: 60000010 });
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
    expect(state.written.length).toBe(0);
  });

  test('requires otherUserId', async () => {
    const res = await request(buildApp()).post('/api/conversations').send({});
    expect(res.status).toBe(400);
  });

  test('an unknown user is 404, not a created conversation', async () => {
    // Body asserted for the same reason as above — Express's own 404 for a
    // missing route has no body, so this cannot pass before the route exists.
    const res = await request(buildApp())
      .post('/api/conversations')
      .send({ otherUserId: 99999999 });
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
    expect(state.written.length).toBe(0);
  });
});

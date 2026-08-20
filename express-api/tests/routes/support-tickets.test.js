/**
 * Tests for support tickets — SHY-0380.
 *
 *   POST   /api/support-tickets       → raise one (authenticated user)
 *   GET    /api/support-tickets       → list (admin only)
 *   PATCH  /api/support-tickets/:id   → resolve + internal note (admin only)
 *
 * Shaped on the existing appeals queue (`routes/reports.js:1363`), which is the
 * closest thing ShyTalk already has: free text from a person, queued, actioned
 * by an admin. A third differently-shaped user→admin queue would be wrong.
 *
 * Two guards here matter more than the rest:
 *   - the admin checks, because the queue contains other people's words;
 *   - the audit entry, because `PUT /config/:key` currently writes none and that
 *     gap must not be reproduced in a new queue.
 *
 * See `.project/stories/SHY-0380-contact-support-button-does-nothing.md`.
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock ──────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockCollectionAdd = jest.fn().mockResolvedValue({ id: 'audit-id' });
const mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: (...args) => mockDocGet(path, ...args),
      set: (...args) => mockDocSet(path, ...args),
      update: (...args) => mockDocUpdate(path, ...args),
    })),
    collection: jest.fn((name) => {
      const chain = {
        _name: name,
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: (...args) => mockCollectionGet(name, ...args),
        add: (...args) => mockCollectionAdd(name, ...args),
      };
      return chain;
    }),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: () => 'ticket-id',
  now: () => 1709913600000,
}));

const mockGetDoc = jest.fn();
const mockQueryDocs = jest.fn().mockResolvedValue([]);
jest.mock('../../src/utils/firestore-helpers', () => ({
  getDoc: (...args) => mockGetDoc(...args),
  queryDocs: (...args) => mockQueryDocs(...args),
}));

const mockIsLiveAdmin = jest.fn().mockResolvedValue(true);
jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: async (req, res) => {
    if (!req.auth?.token?.admin) {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    }
    if (!(await mockIsLiveAdmin(req.auth.uid))) {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    }
    return false;
  },
  isLiveAdmin: (...args) => mockIsLiveAdmin(...args),
}));

jest.mock('../../src/middleware/rateLimit', () => ({
  writeLimiter: (_req, _res, next) => next(),
  generalLimiter: (_req, _res, next) => next(),
  sensitiveLimiter: (_req, _res, next) => next(),
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockQueryDocs.mockResolvedValue([]);
  mockIsLiveAdmin.mockResolvedValue(true);
  mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });
});

// ─── App setup ──────────────────────────────────────────────────

function createApp({ uid = 'firebase-uid-A', uniqueId = 10000001, admin = false } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid, uniqueId, token: admin ? { admin: true } : {} };
    next();
  });
  app.use('/api', require('../../src/routes/support-tickets'));
  return app;
}

/** The document written by the most recent successful POST. */
function writtenTicket() {
  expect(mockDocSet).toHaveBeenCalled();
  return mockDocSet.mock.calls[0][1];
}

// ─── Raising a ticket ───────────────────────────────────────────

describe('POST /api/support-tickets', () => {
  test('stores the ticket and returns its id', async () => {
    const res = await request(createApp())
      .post('/api/support-tickets')
      .send({ message: 'My date of birth is wrong on my account.' });

    expect(res.status).toBe(200);
    expect(res.body.ticketId).toBe('ticket-id');
    expect(mockDocSet).toHaveBeenCalledWith(
      'supportTickets/ticket-id',
      expect.objectContaining({
        message: 'My date of birth is wrong on my account.',
        status: 'open',
      }),
      expect.anything(),
    );
  });

  test('binds the ticket to the authenticated account', async () => {
    await request(createApp({ uniqueId: 10000042 }))
      .post('/api/support-tickets')
      .send({ message: 'Help please' });

    expect(writtenTicket().userId).toBe(10000042);
  });

  test('a caller cannot raise a ticket as somebody else', async () => {
    // The body is untrusted. Identity comes from req.auth, never from the payload.
    await request(createApp({ uniqueId: 10000042 }))
      .post('/api/support-tickets')
      .send({ message: 'Help please', userId: 99999999 });

    expect(writtenTicket().userId).toBe(10000042);
  });

  test('refuses an empty message', async () => {
    const res = await request(createApp()).post('/api/support-tickets').send({ message: '' });
    expect(res.status).toBe(400);
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  test('refuses a whitespace-only message', async () => {
    const res = await request(createApp())
      .post('/api/support-tickets')
      .send({ message: '   \n\t  ' });
    expect(res.status).toBe(400);
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  test('refuses a missing message', async () => {
    const res = await request(createApp()).post('/api/support-tickets').send({});
    expect(res.status).toBe(400);
  });

  test('refuses a non-string message', async () => {
    const res = await request(createApp())
      .post('/api/support-tickets')
      .send({ message: { nested: 'object' } });
    expect(res.status).toBe(400);
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  test('bounds the message length explicitly rather than truncating', async () => {
    const res = await request(createApp())
      .post('/api/support-tickets')
      .send({ message: 'x'.repeat(2001) });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/2000/);
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  test('accepts a message at exactly the limit', async () => {
    const res = await request(createApp())
      .post('/api/support-tickets')
      .send({ message: 'x'.repeat(2000) });
    expect(res.status).toBe(200);
  });

  test('refuses a category outside the known set', async () => {
    const res = await request(createApp())
      .post('/api/support-tickets')
      .send({ message: 'Help', category: 'not-a-category' });
    expect(res.status).toBe(400);
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  test('accepts a known category and stores it', async () => {
    const res = await request(createApp())
      .post('/api/support-tickets')
      .send({ message: 'Help', category: 'age' });
    expect(res.status).toBe(200);
    expect(writtenTicket().category).toBe('age');
  });

  test('refuses a second ticket while one is still open', async () => {
    mockQueryDocs.mockResolvedValue([{ id: 'existing', status: 'open' }]);

    const res = await request(createApp())
      .post('/api/support-tickets')
      .send({ message: 'Another one' });

    expect(res.status).toBe(409);
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  test('stores the originating context so an admin need not ask', async () => {
    await request(createApp())
      .post('/api/support-tickets')
      .send({ message: 'Help', context: { feature: 'gacha', reason: 'sub_eighteen' } });

    expect(writtenTicket().context).toEqual({ feature: 'gacha', reason: 'sub_eighteen' });
  });

  test('never stores credentials smuggled through context', async () => {
    await request(createApp())
      .post('/api/support-tickets')
      .send({
        message: 'Help',
        context: { feature: 'gacha', token: 'super-secret', authorization: 'Bearer x' },
      });

    const stored = JSON.stringify(writtenTicket());
    expect(stored).not.toContain('super-secret');
    expect(stored).not.toContain('Bearer x');
  });
});

// ─── Listing (admin) ────────────────────────────────────────────

describe('GET /api/support-tickets', () => {
  test('refuses a non-admin', async () => {
    const res = await request(createApp()).get('/api/support-tickets');
    expect(res.status).toBe(403);
  });

  test('refuses an admin whose claim is no longer live', async () => {
    // A demoted admin must not keep working off a not-yet-expired token.
    mockIsLiveAdmin.mockResolvedValue(false);
    const res = await request(createApp({ admin: true })).get('/api/support-tickets');
    expect(res.status).toBe(403);
  });

  test('returns tickets to an admin', async () => {
    mockQueryDocs.mockResolvedValue([
      { id: 't1', userId: 1, message: 'first', status: 'open' },
      { id: 't2', userId: 2, message: 'second', status: 'open' },
    ]);

    const res = await request(createApp({ admin: true })).get('/api/support-tickets');
    expect(res.status).toBe(200);
    expect(res.body.tickets).toHaveLength(2);
  });
});

// ─── Actioning (admin) ──────────────────────────────────────────

describe('PATCH /api/support-tickets/:id', () => {
  const openTicket = { id: 't1', userId: 10000001, message: 'help', status: 'open' };

  test('refuses a non-admin', async () => {
    const res = await request(createApp())
      .patch('/api/support-tickets/t1')
      .send({ status: 'resolved' });
    expect(res.status).toBe(403);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('resolves the ticket and records who did it', async () => {
    mockGetDoc.mockResolvedValue(openTicket);

    const res = await request(createApp({ admin: true, uid: 'admin-uid' }))
      .patch('/api/support-tickets/t1')
      .send({ status: 'resolved' });

    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      'supportTickets/t1',
      expect.objectContaining({ status: 'resolved', resolvedBy: 'admin-uid' }),
    );
  });

  test('stores an internal admin note when given', async () => {
    mockGetDoc.mockResolvedValue(openTicket);

    await request(createApp({ admin: true }))
      .patch('/api/support-tickets/t1')
      .send({ status: 'resolved', adminNote: 'DOB confirmed correct' });

    expect(mockDocUpdate.mock.calls[0][1].adminNote).toBe('DOB confirmed correct');
  });

  test('writes an audit entry — the gap PUT /config/:key still has', async () => {
    mockGetDoc.mockResolvedValue(openTicket);

    await request(createApp({ admin: true, uid: 'admin-uid', uniqueId: 500 }))
      .patch('/api/support-tickets/t1')
      .send({ status: 'resolved' });

    expect(mockCollectionAdd).toHaveBeenCalledWith(
      'auditLog',
      expect.objectContaining({
        action: 'support_ticket_resolve',
        targetType: 'support_ticket',
        targetId: 't1',
      }),
    );
  });

  test('refuses an unknown status', async () => {
    mockGetDoc.mockResolvedValue(openTicket);
    const res = await request(createApp({ admin: true }))
      .patch('/api/support-tickets/t1')
      .send({ status: 'banana' });
    expect(res.status).toBe(400);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('404s on a ticket that does not exist', async () => {
    mockGetDoc.mockResolvedValue(null);
    const res = await request(createApp({ admin: true }))
      .patch('/api/support-tickets/nope')
      .send({ status: 'resolved' });
    expect(res.status).toBe(404);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('does not audit-log a refused action', async () => {
    mockGetDoc.mockResolvedValue(null);
    await request(createApp({ admin: true }))
      .patch('/api/support-tickets/nope')
      .send({ status: 'resolved' });
    expect(mockCollectionAdd).not.toHaveBeenCalled();
  });
});

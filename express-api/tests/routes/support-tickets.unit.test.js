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
 * Named `.unit.test.js` deliberately. This isolates the router with mocked
 * collaborators, and the repository's no-stubs ratchet allows doubles ONLY in
 * unit-test locations — so the name has to tell the truth about what this is.
 * Real-service proof belongs in `tests/integration/`, not here.
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
  // SHY-0396: adding to an existing ticket appends with FieldValue.arrayUnion.
  // Without this the real module's export is absent and the route throws a 500,
  // which looks like a route bug and is not one.
  FieldValue: { arrayUnion: (...items) => ({ __arrayUnion: items }) },
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

const mockGetSignedPutUrl = jest.fn();
const mockGetSignedGetUrl = jest.fn();
jest.mock('../../src/utils/r2', () => ({
  getSignedPutUrl: (...args) => mockGetSignedPutUrl(...args),
  getSignedGetUrl: (...args) => mockGetSignedGetUrl(...args),
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
  mockGetSignedPutUrl.mockResolvedValue('https://r2.example/signed-put');
  mockGetSignedGetUrl.mockImplementation(async (key) => `https://r2.example/get/${key}`);
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
      .send({ message: 'x'.repeat(1001) });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/1000/);
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  test('accepts a message at exactly the limit', async () => {
    const res = await request(createApp())
      .post('/api/support-tickets')
      .send({ message: 'x'.repeat(1000) });
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

  // SHY-0396. This used to assert a 409 and that nothing was written -- it
  // pinned the defect. A second request is ALLOWED: somebody with an open
  // ticket may have a genuinely different problem, and refusing them means
  // their new problem never reaches anyone. The warning belongs in the client,
  // which shows what is already open and offers to add to it instead.
  test('raises a SECOND ticket while one is still open — never refuses it', async () => {
    mockQueryDocs.mockResolvedValue([{ id: 'existing', status: 'open' }]);

    const res = await request(createApp())
      .post('/api/support-tickets')
      .send({ message: 'A different problem entirely' });

    expect(res.status).toBe(200);
    expect(res.body.ticketId).toBeTruthy();
    expect(writtenTicket().message).toBe('A different problem entirely');
  });

  test('no request is ever answered with 409', async () => {
    // The refusal is gone, not merely bypassed on one path. If a 409 comes back
    // from anywhere here, somebody has reinstated the block.
    mockQueryDocs.mockResolvedValue([
      { id: 'a', status: 'open' },
      { id: 'b', status: 'open' },
    ]);

    const res = await request(createApp())
      .post('/api/support-tickets')
      .send({ message: 'Third one' });

    expect(res.status).not.toBe(409);
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

// ─── SHY-0387: categories and attachments ───────────────────────

describe('POST /api/support-tickets — measuring the warning — SHY-0396', () => {
  // The story's observability clause: "a ticket raised despite the warning is
  // distinguishable in the data, so the warning's effect can actually be judged
  // rather than assumed". Without this, removing the 409 is a change nobody can
  // evaluate afterwards.
  test('records how many requests were already open', async () => {
    mockQueryDocs.mockResolvedValue([
      { id: 't1', userId: 10000001, status: 'open', message: 'first' },
      { id: 't2', userId: 10000001, status: 'open', message: 'second' },
    ]);

    await request(createApp()).post('/api/support-tickets').send({ message: 'A third thing' });

    expect(writtenTicket().openTicketsAtCreation).toBe(2);
  });

  test('a first-ever request records zero, not an absent field', async () => {
    mockQueryDocs.mockResolvedValue([]);

    await request(createApp()).post('/api/support-tickets').send({ message: 'First time' });

    // Zero rather than undefined: "raised with none open" and "raised before we
    // started counting" are different facts and must not look identical.
    expect(writtenTicket().openTicketsAtCreation).toBe(0);
  });

  /**
   * The count is measurement, and measurement must never cost somebody their
   * ticket. This is the same rule the client follows for its own lookup.
   */
  test('a failed count still raises the ticket', async () => {
    mockQueryDocs.mockRejectedValue(new Error('firestore unavailable'));

    const res = await request(createApp()).post('/api/support-tickets').send({ message: 'Help' });

    expect(res.status).toBe(200);
    expect(res.body.ticketId).toBe('ticket-id');
    expect(writtenTicket().openTicketsAtCreation).toBeNull();
  });

  test('the count is taken from the CALLER, never from the body', async () => {
    mockQueryDocs.mockResolvedValue([{ id: 't1', userId: 10000001, status: 'open', message: 'a' }]);

    await request(createApp())
      .post('/api/support-tickets')
      .send({ message: 'Help', openTicketsAtCreation: 99 });

    expect(writtenTicket().openTicketsAtCreation).toBe(1);
  });
});

describe('POST /api/support-tickets — the sixth approved category', () => {
  test('accepts "bug", the wire value for "Something is broken"', async () => {
    const res = await request(createApp())
      .post('/api/support-tickets')
      .send({ message: 'The wheel spins forever.', category: 'bug' });

    expect(res.status).toBe(200);
    expect(writtenTicket().category).toBe('bug');
  });
});

describe('POST /api/support-tickets/upload-url', () => {
  test('issues a signed PUT URL and a key under the caller own prefix', async () => {
    const res = await request(createApp({ uniqueId: 10000001 }))
      .post('/api/support-tickets/upload-url')
      .send({ contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.uploadUrl).toBe('https://r2.example/signed-put');
    expect(res.body.r2Key).toMatch(/^support-tickets\/10000001\/[^/]+\.png$/);
  });

  test('accepts video, because the operator asked for screenshots AND videos', async () => {
    const res = await request(createApp())
      .post('/api/support-tickets/upload-url')
      .send({ contentType: 'video/mp4' });

    expect(res.status).toBe(200);
  });

  test('refuses a content type outside the allowed set', async () => {
    const res = await request(createApp())
      .post('/api/support-tickets/upload-url')
      .send({ contentType: 'application/x-msdownload' });

    expect(res.status).toBe(400);
    expect(mockGetSignedPutUrl).not.toHaveBeenCalled();
  });

  test('refuses a missing content type rather than guessing one', async () => {
    const res = await request(createApp()).post('/api/support-tickets/upload-url').send({});

    expect(res.status).toBe(400);
    expect(mockGetSignedPutUrl).not.toHaveBeenCalled();
  });
});

describe('POST /api/support-tickets — attachments', () => {
  const own = (name) => `support-tickets/10000001/${name}`;

  test('stores attachments the caller uploaded', async () => {
    const res = await request(createApp({ uniqueId: 10000001 }))
      .post('/api/support-tickets')
      .send({ message: 'Here is what I see.', attachments: [own('a.png'), own('b.mp4')] });

    expect(res.status).toBe(200);
    expect(writtenTicket().attachments).toEqual([own('a.png'), own('b.mp4')]);
  });

  test('a ticket with no attachments stores an empty list, not undefined', async () => {
    await request(createApp()).post('/api/support-tickets').send({ message: 'No picture.' });

    expect(writtenTicket().attachments).toEqual([]);
  });

  // The three defences age-verification already applies to an R2 key. A key
  // arrives from the client, so each one is a way into somebody else's folder.
  test('refuses a key belonging to another account', async () => {
    const res = await request(createApp({ uniqueId: 10000001 }))
      .post('/api/support-tickets')
      .send({ message: 'Sneaky.', attachments: ['support-tickets/10000002/theirs.png'] });

    expect(res.status).toBe(400);
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  test('refuses a key containing a path-traversal sequence', async () => {
    const res = await request(createApp({ uniqueId: 10000001 }))
      .post('/api/support-tickets')
      .send({ message: 'Sneaky.', attachments: [own('../10000002/theirs.png')] });

    expect(res.status).toBe(400);
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  test('refuses a key that extends the prefix into another folder', async () => {
    const res = await request(createApp({ uniqueId: 10000001 }))
      .post('/api/support-tickets')
      .send({ message: 'Sneaky.', attachments: [own('nested/deeper.png')] });

    expect(res.status).toBe(400);
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  test('refuses a non-string attachment', async () => {
    const res = await request(createApp())
      .post('/api/support-tickets')
      .send({ message: 'Odd.', attachments: [{ key: 'x' }] });

    expect(res.status).toBe(400);
  });

  test('bounds how many attachments one ticket may carry', async () => {
    const many = Array.from({ length: 11 }, (_, i) => own(`f${i}.png`));
    const res = await request(createApp({ uniqueId: 10000001 }))
      .post('/api/support-tickets')
      .send({ message: 'Too many.', attachments: many });

    expect(res.status).toBe(400);
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  test('refuses attachments that are not a list', async () => {
    const res = await request(createApp())
      .post('/api/support-tickets')
      .send({ message: 'Odd.', attachments: 'support-tickets/10000001/a.png' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/support-tickets/:id/attachments', () => {
  const ticketWith = (attachments) => ({
    exists: true,
    data: () => ({ userId: 10000001, attachments }),
  });

  test('an admin gets a short-lived link for each attachment', async () => {
    mockDocGet.mockResolvedValue(
      ticketWith(['support-tickets/10000001/a.png', 'support-tickets/10000001/b.mp4']),
    );

    const res = await request(createApp({ admin: true })).get(
      '/api/support-tickets/t-1/attachments',
    );

    expect(res.status).toBe(200);
    expect(res.body.attachments).toEqual([
      'https://r2.example/get/support-tickets/10000001/a.png',
      'https://r2.example/get/support-tickets/10000001/b.mp4',
    ]);
  });

  test('the links expire', async () => {
    mockDocGet.mockResolvedValue(ticketWith(['support-tickets/10000001/a.png']));

    await request(createApp({ admin: true })).get('/api/support-tickets/t-1/attachments');

    // A link that never expires is a permanent public URL to somebody's
    // support attachment, handed out by a bearer-token endpoint.
    const [, expiry] = mockGetSignedGetUrl.mock.calls[0];
    expect(typeof expiry).toBe('number');
    expect(expiry).toBeGreaterThan(0);
  });

  test('a ticket with nothing attached returns an empty list, not an error', async () => {
    mockDocGet.mockResolvedValue(ticketWith([]));

    const res = await request(createApp({ admin: true })).get(
      '/api/support-tickets/t-1/attachments',
    );

    expect(res.status).toBe(200);
    expect(res.body.attachments).toEqual([]);
  });

  test('a ticket predating attachments does not crash', async () => {
    mockDocGet.mockResolvedValue({ exists: true, data: () => ({ userId: 10000001 }) });

    const res = await request(createApp({ admin: true })).get(
      '/api/support-tickets/t-1/attachments',
    );

    expect(res.status).toBe(200);
    expect(res.body.attachments).toEqual([]);
  });

  test('a ticket that does not exist is a 404', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const res = await request(createApp({ admin: true })).get(
      '/api/support-tickets/nope/attachments',
    );

    expect(res.status).toBe(404);
  });

  test('a non-admin is refused and no link is issued', async () => {
    mockIsLiveAdmin.mockResolvedValue(false);
    mockDocGet.mockResolvedValue(ticketWith(['support-tickets/10000001/a.png']));

    const res = await request(createApp({ admin: false })).get(
      '/api/support-tickets/t-1/attachments',
    );

    expect(res.status).toBe(403);
    expect(mockGetSignedGetUrl).not.toHaveBeenCalled();
  });
});

describe('a caller with no resolved identity — SHY-0426', () => {
  /**
   * `resolveUniqueId` answers null when a Firebase uid has no identityMap
   * entry, and the auth middleware passes that straight through as
   * `req.auth.uniqueId = null`. Nothing downstream treated null as "unknown" —
   * it was used as though it were an account number.
   *
   * Reproduced against the real stack on 2026-08-22: two personas whose
   * uniqueId was null could READ each other's support tickets, including the
   * summary of a SAFETY report, and APPEND to each other's tickets (HTTP 200).
   * Their attachments also shared one `support-tickets/null/` folder, so each
   * could attach the other's uploads.
   *
   * The cause is that `null === null`. Every ownership test in this file is of
   * the form `where('userId','==',uniqueId)` or `doc.userId !== uniqueId`, and
   * both are satisfied when everybody's id is the same absent value.
   *
   * An account we cannot identify cannot be authorised. Refused, not guessed.
   */
  test('cannot raise a ticket', async () => {
    const res = await request(createApp({ uniqueId: null }))
      .post('/api/support-tickets')
      .send({ message: 'Who am I?' });

    expect(res.status).toBe(403);
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  test("cannot list open tickets — this is how one account read another's", async () => {
    mockQueryDocs.mockResolvedValue([
      { id: 'someone-else', userId: null, status: 'open', message: 'my private problem' },
    ]);

    const res = await request(createApp({ uniqueId: null })).get('/api/support-tickets/mine/open');

    expect(res.status).toBe(403);
    expect(res.body.tickets).toBeUndefined();
  });

  test("cannot append to a ticket — this is how one account wrote into another's", async () => {
    mockDocGet.mockResolvedValue({ exists: true, data: () => ({ userId: null }) });

    const res = await request(createApp({ uniqueId: null }))
      .post('/api/support-tickets/someone-elses/messages')
      .send({ message: "writing into a stranger's ticket" });

    expect(res.status).toBe(403);
  });

  test('cannot be issued an upload slot, so no shared null folder exists', async () => {
    const res = await request(createApp({ uniqueId: null }))
      .post('/api/support-tickets/upload-url')
      .send({ contentType: 'image/png' });

    expect(res.status).toBe(403);
  });

  /** Zero is a real account number and must not be caught by a falsy test. */
  test('an account whose id is 0 is still a real account', async () => {
    mockQueryDocs.mockResolvedValue([]);
    const res = await request(createApp({ uniqueId: 0 })).get('/api/support-tickets/mine/open');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/support-tickets/mine/open — SHY-0396', () => {
  // The client cannot offer "it's the problem I already reported" without
  // something to show. A summary of their own words is enough to recognise the
  // problem, and needs no new stored field.
  test('returns a brief summary of each open ticket', async () => {
    mockQueryDocs.mockResolvedValue([
      {
        id: 't1',
        userId: 10000001,
        status: 'open',
        category: 'payment',
        message: 'My coins never arrived after I paid',
        createdAt: 1709913600000,
      },
    ]);

    const res = await request(createApp()).get('/api/support-tickets/mine/open');

    expect(res.status).toBe(200);
    expect(res.body.tickets).toHaveLength(1);
    expect(res.body.tickets[0]).toEqual({
      ticketId: 't1',
      category: 'payment',
      summary: 'My coins never arrived after I paid',
      createdAt: 1709913600000,
    });
  });

  test('a long message is shortened, so the choice stays readable', async () => {
    mockQueryDocs.mockResolvedValue([
      { id: 't1', userId: 10000001, status: 'open', category: 'bug', message: 'x'.repeat(400) },
    ]);

    const res = await request(createApp()).get('/api/support-tickets/mine/open');

    expect(res.body.tickets[0].summary.length).toBeLessThanOrEqual(121);
    expect(res.body.tickets[0].summary.endsWith('…')).toBe(true);
  });

  test('nothing open answers an empty list, not an error', async () => {
    mockQueryDocs.mockResolvedValue([]);

    const res = await request(createApp()).get('/api/support-tickets/mine/open');

    expect(res.status).toBe(200);
    expect(res.body.tickets).toEqual([]);
  });

  test("never leaks another person's ticket", async () => {
    // The query is scoped by the TOKEN's uniqueId. If a ticket belonging to
    // somebody else reaches the mapper, it must not be returned -- a support
    // queue holds other people's words.
    mockQueryDocs.mockResolvedValue([
      { id: 'mine', userId: 10000001, status: 'open', category: 'bug', message: 'mine' },
      { id: 'theirs', userId: 10000002, status: 'open', category: 'bug', message: 'theirs' },
    ]);

    const res = await request(createApp()).get('/api/support-tickets/mine/open');

    expect(res.body.tickets.map((t) => t.ticketId)).toEqual(['mine']);
  });
});

describe('POST /api/support-tickets/:id/messages — SHY-0396', () => {
  // "It's the problem I already reported" needs somewhere to put the text.
  // Without this the message is simply dropped.
  test('adds the message to the existing ticket', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ userId: 10000001, status: 'open', message: 'first' }),
    });

    const res = await request(createApp())
      .post('/api/support-tickets/t1/messages')
      .send({ message: 'Here is more detail' });

    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalled();
  });

  test("refuses to write to somebody else's ticket", async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ userId: 10000002, status: 'open', message: 'not yours' }),
    });

    const res = await request(createApp())
      .post('/api/support-tickets/t1/messages')
      .send({ message: 'let me in' });

    expect(res.status).toBe(404);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('an empty message is refused', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ userId: 10000001, status: 'open', message: 'first' }),
    });

    const res = await request(createApp())
      .post('/api/support-tickets/t1/messages')
      .send({ message: '   ' });

    expect(res.status).toBe(400);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('a ticket that does not exist is refused', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const res = await request(createApp())
      .post('/api/support-tickets/nope/messages')
      .send({ message: 'hello' });

    expect(res.status).toBe(404);
  });
});

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

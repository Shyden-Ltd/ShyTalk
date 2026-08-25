/**
 * Turning a support ticket into a report — SHY-0438, and the terminal state it
 * leaves behind — SHY-0439.
 *
 *   POST /api/support-tickets/:id/convert-to-report  (admin only)
 *
 * The order matters more than anything else here: the report is created FIRST
 * and the ticket is closed only once that succeeded. A half-conversion that
 * closes somebody's ticket and files nothing is the worst outcome available,
 * so it is asserted by FORCING the failure rather than by reading the code.
 *
 * Named `.unit.test.js` deliberately -- the repository's no-stubs ratchet allows
 * doubles only in unit-test locations, and this isolates the router.
 *
 * See `.project/stories/SHY-0438-an-admin-can-turn-a-support-ticket-into-a-report.md`.
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
// Server-authoritative: the route resolves the reported account itself rather
// than trusting the id it was handed. Defaults to a real, different account.
const mockResolveUniqueId = jest.fn().mockResolvedValue(10000042);
jest.mock('../../src/middleware/auth', () => ({
  resolveUniqueId: (...args) => mockResolveUniqueId(...args),
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
const mockDeleteObject = jest.fn();
const mockHeadObject = jest.fn(async () => ({ contentType: 'image/png', size: 1024 }));
const mockGetObject = jest.fn(async () => ({
  ContentType: 'image/png',
  Body: { pipe: (res) => res.end() },
}));
jest.mock('../../src/utils/r2', () => ({
  getSignedPutUrl: (...args) => mockGetSignedPutUrl(...args),
  getSignedGetUrl: (...args) => mockGetSignedGetUrl(...args),
  deleteObject: (...args) => mockDeleteObject(...args),
  // SHY-0420: the limits are checked against what was actually STORED, so the
  // create path asks R2 what each object is. An ordinary small image by
  // default; individual tests override it.
  headObject: (...args) => mockHeadObject(...args),
  getObject: (...args) => mockGetObject(...args),
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
  mockResolveUniqueId.mockResolvedValue(10000042);
  mockHeadObject.mockResolvedValue({ contentType: 'image/png', size: 1024 });
  mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });
  mockGetSignedPutUrl.mockResolvedValue('https://r2.example/signed-put');
  mockGetSignedGetUrl.mockImplementation(async (key) => `https://r2.example/get/${key}`);
  mockDeleteObject.mockResolvedValue(undefined);
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

// ─── Fixtures ───────────────────────────────────────────────────

const TICKET_ID = 'ticket-1';
const TICKET_PATH = `supportTickets/${TICKET_ID}`;

const openTicket = (extra = {}) => ({
  id: TICKET_ID,
  userId: 10000009,
  category: 'safety',
  message: 'Someone in the Vietnamese room keeps sending me abusive messages.',
  attachments: ['support/10000009/a.jpg', 'support/10000009/b.mp4'],
  status: 'open',
  createdAt: 1709913600000,
  ...extra,
});

const convert = (app, body = {}) =>
  request(app)
    .post(`/api/support-tickets/${TICKET_ID}/convert-to-report`)
    .send({ reportedUserId: 'firebase-uid-of-raul', reason: 'Harassment', ...body });

/** Everything written to the reports collection by the last call. */
function writtenReport() {
  const call = mockDocSet.mock.calls.find(([path]) => path.startsWith('reports/'));
  expect(call).toBeDefined();
  return call[1];
}

/** How the ticket was updated by the last call. */
function ticketUpdate() {
  const call = mockDocUpdate.mock.calls.find(([path]) => path === TICKET_PATH);
  expect(call).toBeDefined();
  return call[1];
}

beforeEach(() => {
  mockGetDoc.mockImplementation(async (path) => {
    if (path === TICKET_PATH) return openTicket();
    if (path.startsWith('users/')) return { displayName: 'Nora', uniqueId: 10000009 };
    return null;
  });
});

// ─── Who may convert ────────────────────────────────────────────

describe('POST /api/support-tickets/:id/convert-to-report — authorisation', () => {
  test('a signed-in non-admin is refused', async () => {
    const res = await convert(createApp({ admin: false }));
    expect(res.status).toBe(403);
  });

  test('an admin whose admin claim is no longer live is refused', async () => {
    mockIsLiveAdmin.mockResolvedValue(false);
    const res = await convert(createApp({ admin: true }));
    expect(res.status).toBe(403);
  });

  test('nothing is written when the caller is refused', async () => {
    await convert(createApp({ admin: false }));
    expect(mockDocSet).not.toHaveBeenCalled();
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });
});

// ─── The conversion itself ──────────────────────────────────────

describe('POST /api/support-tickets/:id/convert-to-report — the report', () => {
  test('creates a report and returns its id', async () => {
    const res = await convert(createApp({ admin: true }));
    expect(res.status).toBe(200);
    expect(res.body.reportId).toBe('ticket-id');
  });

  test('the report is attributed to the person who raised the ticket', async () => {
    // NOT the admin pressing the button. This is the whole point of filing it
    // on somebody's behalf.
    await convert(createApp({ admin: true, uniqueId: 10000012 }));
    expect(writtenReport().reporterId).toBe(10000009);
  });

  test('the report carries the ticket message verbatim', async () => {
    await convert(createApp({ admin: true }));
    expect(writtenReport().description).toBe(openTicket().message);
  });

  test('the report carries every attachment', async () => {
    await convert(createApp({ admin: true }));
    expect(writtenReport().evidenceUrls).toEqual([
      'support/10000009/a.jpg',
      'support/10000009/b.mp4',
    ]);
  });

  test('a follow-up is carried too, not just the original message', async () => {
    mockGetDoc.mockImplementation(async (path) => {
      if (path === TICKET_PATH) {
        // The real shape: `POST /support-tickets/:id/messages` appends to
        // `messages` with FieldValue.arrayUnion.
        return openTicket({
          messages: [{ message: 'It happened again this morning.', addedAt: 1, addedBy: 10000009 }],
        });
      }
      if (path.startsWith('users/')) return { displayName: 'Nora', uniqueId: 10000009 };
      return null;
    });
    await convert(createApp({ admin: true }));
    expect(writtenReport().description).toContain('It happened again this morning.');
  });

  test('the report records the ticket it came from', async () => {
    await convert(createApp({ admin: true }));
    expect(writtenReport().sourceSupportTicketId).toBe(TICKET_ID);
  });

  test('the report is distinguishable from a directly-filed one', async () => {
    await convert(createApp({ admin: true }));
    expect(writtenReport().origin).toBe('support_ticket');
  });

  test('the admin supplies the reason, which is what only a reader can decide', async () => {
    await convert(createApp({ admin: true }), { reason: 'Inappropriate Content' });
    expect(writtenReport().reason).toBe('Inappropriate Content');
  });
});

// ─── What happens to the ticket ─────────────────────────────────

describe('POST /api/support-tickets/:id/convert-to-report — the ticket', () => {
  test('the ticket is closed permanently, in its own terminal state', async () => {
    await convert(createApp({ admin: true }));
    expect(ticketUpdate().status).toBe('converted_to_report');
  });

  test('the ticket records the report it became', async () => {
    await convert(createApp({ admin: true }));
    expect(ticketUpdate().convertedToReportId).toBe('ticket-id');
  });

  test('the ticket records who converted it and when', async () => {
    await convert(createApp({ admin: true, uid: 'firebase-uid-admin' }));
    expect(ticketUpdate().convertedBy).toBe('firebase-uid-admin');
    expect(typeof ticketUpdate().convertedAt).toBe('number');
  });

  test('the conversion is audited', async () => {
    await convert(createApp({ admin: true }));
    const audit = mockCollectionAdd.mock.calls.find(([name]) => name === 'auditLog');
    expect(audit).toBeDefined();
    expect(audit[1]).toMatchObject({
      action: 'support_ticket_convert_to_report',
      targetType: 'support_ticket',
      targetId: TICKET_ID,
    });
    expect(audit[1].details).toMatchObject({ reportId: 'ticket-id' });
  });
});

// ─── When it must not happen ────────────────────────────────────

describe('POST /api/support-tickets/:id/convert-to-report — refusals', () => {
  test('a missing ticket is a 404', async () => {
    mockGetDoc.mockResolvedValue(null);
    const res = await convert(createApp({ admin: true }));
    expect(res.status).toBe(404);
  });

  test('reportedUserId is required', async () => {
    const res = await convert(createApp({ admin: true }), { reportedUserId: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reportedUserId/);
  });

  test('reason is required', async () => {
    const res = await convert(createApp({ admin: true }), { reason: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason/);
  });

  test('an already-converted ticket is refused, and says which report it became', async () => {
    mockGetDoc.mockImplementation(async (path) => {
      if (path === TICKET_PATH) {
        return openTicket({ status: 'converted_to_report', convertedToReportId: 'report-9' });
      }
      return { displayName: 'Nora', uniqueId: 10000009 };
    });
    const res = await convert(createApp({ admin: true }));
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('report-9');
  });

  test('an already-converted ticket is not written to again', async () => {
    mockGetDoc.mockImplementation(async (path) => {
      if (path === TICKET_PATH) {
        return openTicket({ status: 'converted_to_report', convertedToReportId: 'report-9' });
      }
      return { displayName: 'Nora', uniqueId: 10000009 };
    });
    await convert(createApp({ admin: true }));
    expect(mockDocUpdate).not.toHaveBeenCalled();
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  test('reporting the ticket raiser against themselves is refused', () => {
    // Guarded in one place -- the document builder -- so both this route and
    // POST /reports get it. Asserted here because this route is the one where
    // an admin, not the person, chooses who is reported.
    const { buildReportDocument, REPORT_ORIGIN } = require('../../src/utils/report-document');
    expect(() =>
      buildReportDocument({
        reporterUniqueId: 'u-nora',
        reportedUserUniqueId: 'u-nora',
        reason: 'Harassment',
        origin: REPORT_ORIGIN.SUPPORT_TICKET,
        sourceSupportTicketId: 'ticket-1',
        createdAt: 1,
      }),
    ).toThrow(/themselves/);
  });

  test('an admin naming the ticket raiser as the reported person gets a 400', async () => {
    mockResolveUniqueId.mockResolvedValue(10000009);
    const res = await convert(createApp({ admin: true }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/themselves/);
  });

  test('a reportedUserId matching nobody is refused', async () => {
    mockResolveUniqueId.mockResolvedValue(null);
    const res = await convert(createApp({ admin: true }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not match any known user/);
  });
});

// ─── The half-conversion, which must be impossible ──────────────

describe('POST /api/support-tickets/:id/convert-to-report — nothing is lost on failure', () => {
  test('a failed report write leaves the ticket exactly as it was', async () => {
    // FORCED, not inspected. The order of two writes is not something reading
    // the code proves -- a later edit can swap them and every other test here
    // still passes.
    mockDocSet.mockRejectedValueOnce(new Error('firestore unavailable'));
    const res = await convert(createApp({ admin: true }));

    expect(res.status).toBe(500);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('a failed report write is not audited as a conversion', async () => {
    mockDocSet.mockRejectedValueOnce(new Error('firestore unavailable'));
    await convert(createApp({ admin: true }));
    const audit = mockCollectionAdd.mock.calls.find(
      ([, entry]) => entry?.action === 'support_ticket_convert_to_report',
    );
    expect(audit).toBeUndefined();
  });

  test('a ticket whose attachments have gone still converts, and says which were missing', async () => {
    mockHeadObject.mockRejectedValue(new Error('NoSuchKey'));
    const res = await convert(createApp({ admin: true }));
    expect(res.status).toBe(200);
    expect(res.body.missingAttachments).toEqual([
      'support/10000009/a.jpg',
      'support/10000009/b.mp4',
    ]);
  });
});

// ─── The terminal state — SHY-0439 ──────────────────────────────

describe('a converted ticket cannot be moved again', () => {
  const converted = () =>
    openTicket({ status: 'converted_to_report', convertedToReportId: 'report-9' });

  beforeEach(() => {
    mockGetDoc.mockImplementation(async (path) =>
      path === TICKET_PATH ? converted() : { displayName: 'Nora', uniqueId: 10000009 },
    );
  });

  test('resolving it is refused, with a reason rather than a generic error', async () => {
    // The API refusal is the half that matters: hiding the control is a choice
    // about a screen, and this state has to hold for anything that calls us.
    const res = await request(createApp({ admin: true }))
      .patch(`/api/support-tickets/${TICKET_ID}`)
      .send({ status: 'resolved' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/report/i);
    expect(res.body.error).toContain('report-9');
  });

  test('the refusal writes nothing', async () => {
    await request(createApp({ admin: true }))
      .patch(`/api/support-tickets/${TICKET_ID}`)
      .send({ status: 'resolved' });
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('a ticket that was reopened once can still be converted, and then cannot move', async () => {
    // `resolved` is not terminal; this is. A ticket that has been round the
    // houses still ends here.
    mockGetDoc.mockImplementation(async (path) =>
      path === TICKET_PATH
        ? openTicket({ status: 'resolved', resolvedAt: 1 })
        : { displayName: 'Nora', uniqueId: 10000009 },
    );
    const first = await convert(createApp({ admin: true }));
    expect(first.status).toBe(200);

    mockGetDoc.mockImplementation(async (path) =>
      path === TICKET_PATH ? converted() : { displayName: 'Nora', uniqueId: 10000009 },
    );
    const second = await convert(createApp({ admin: true }));
    expect(second.status).toBe(409);
  });
});

describe('listing tickets by the terminal state', () => {
  test('an admin can filter for tickets that became reports', async () => {
    mockQueryDocs.mockResolvedValue([]);
    const res = await request(createApp({ admin: true })).get(
      '/api/support-tickets?status=converted_to_report',
    );
    expect(res.status).toBe(200);
  });

  test('a status nobody defined is still refused', async () => {
    const res = await request(createApp({ admin: true })).get('/api/support-tickets?status=banana');
    expect(res.status).toBe(400);
  });
});

// ─── The guide's measurement reaching the server — SHY-0437 ─────

describe('a ticket raised after the report guide records that it was', () => {
  /**
   * The context bag is an ALLOWLIST, which is right — it is written by a client
   * — but it means a field the server does not name is silently dropped. A
   * client sending this flag against a server that does not know it produces
   * tickets that all look like nobody saw the guide, and the ratio the ticket is
   * judged on comes out wrong rather than absent.
   */
  test('the flag survives sanitisation and is stored', async () => {
    await request(createApp())
      .post('/api/support-tickets')
      .send({
        message: 'I read the guide and still could not report them',
        category: 'safety',
        context: { raisedAfterReportGuide: 'true', screen: 'support' },
      });

    const written = mockDocSet.mock.calls.find(([path]) => path.startsWith('supportTickets/'));
    expect(written).toBeDefined();
    expect(written[1].context).toEqual({
      screen: 'support',
      raisedAfterReportGuide: 'true',
    });
  });

  test('a ticket raised without it carries no such claim', async () => {
    await request(createApp())
      .post('/api/support-tickets')
      .send({ message: 'The room list will not load', category: 'bug' });

    const written = mockDocSet.mock.calls.find(([path]) => path.startsWith('supportTickets/'));
    expect(written[1].context.raisedAfterReportGuide).toBeUndefined();
  });

  test('a field nobody allowlisted is still dropped', async () => {
    await request(createApp())
      .post('/api/support-tickets')
      .send({
        message: 'Hello',
        context: { raisedAfterReportGuide: 'true', somethingNobodyAdded: 'x' },
      });

    const written = mockDocSet.mock.calls.find(([path]) => path.startsWith('supportTickets/'));
    expect(written[1].context.somethingNobodyAdded).toBeUndefined();
  });
});

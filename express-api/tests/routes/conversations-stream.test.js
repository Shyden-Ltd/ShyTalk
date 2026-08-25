/**
 * SHY-0169 — the conversation stream, and the thing that makes it safe.
 *
 * A stream is ONE request. `authMiddleware` therefore runs its suspension check
 * exactly once, at subscribe, and then never again for a connection that may
 * last hours. Without a per-delivery re-check, suspending somebody would not
 * stop their messages arriving — the moderator would see the account disabled
 * and the person would carry on reading.
 *
 * That is the property these tests exist for. The rest — the wire format, the
 * heartbeat, the teardown — belongs to tests/utils/sse.test.js.
 */

let mockSuspended = new Set();
const mockSnapshotHandlers = [];
const mockUnsubscribe = jest.fn();

jest.mock('../../src/middleware/auth', () => ({
  isLiveAdmin: async () => false,
  checkSuspension: async (uniqueId) => mockSuspended.has(String(uniqueId)),
}));

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({ get: async () => ({ exists: false, data: () => undefined }) })),
    collection: jest.fn(() => {
      const q = {
        where: () => q,
        orderBy: () => q,
        limit: () => q,
        get: async () => ({ docs: [], empty: true, size: 0 }),
        onSnapshot: (onNext, onError) => {
          mockSnapshotHandlers.push({ onNext, onError });
          return mockUnsubscribe;
        },
      };
      return q;
    }),
  },
  rtdb: { ref: jest.fn(() => ({ set: jest.fn().mockResolvedValue() })) },
  FieldValue: { serverTimestamp: () => 'ts' },
}));

jest.mock('../../src/middleware/sameCohort', () => ({
  requireSameCohort: () => (req, res, next) => next(),
}));

const routes = require('../../src/routes/conversations');

/** Doubles that capture what the stream would put on the wire. */
const makeRes = () => ({
  headers: {},
  chunks: [],
  ended: false,
  setHeader(k, v) {
    this.headers[k.toLowerCase()] = v;
  },
  flushHeaders() {},
  write(c) {
    this.chunks.push(c);
    return true;
  },
  end() {
    this.ended = true;
  },
});

const makeReq = (uniqueId = 50000010) => {
  const handlers = {};
  return {
    auth: { uniqueId, cohort: 'adult' },
    method: 'GET',
    url: '/conversations/stream',
    on(evt, fn) {
      handlers[evt] = fn;
    },
    emitClose() {
      handlers.close?.();
    },
  };
};

/** Pull the stream handler straight off the router — no server needed. */
const streamHandler = () => {
  const layer = routes.stack.find(
    (l) => l.route?.path === '/conversations/stream' && l.route.methods.get,
  );
  if (!layer) throw new Error('GET /conversations/stream is not registered');
  return layer.route.stack[0].handle;
};

const events = (res) =>
  res.chunks
    .filter((c) => c.startsWith('event:'))
    .map((c) => {
      const [, name] = c.match(/^event: (\w+)/);
      const [, payload] = c.match(/data: (.*)\n\n$/s);
      return { name, data: JSON.parse(payload) };
    });

const snapshotOf = (docs) => ({ docs: docs.map((d) => ({ id: d.id, data: () => d.data })) });

beforeEach(() => {
  mockSuspended = new Set();
  mockSnapshotHandlers.length = 0;
  mockUnsubscribe.mockClear();
});

describe('GET /api/conversations/stream', () => {
  test('is registered as a route, before the :id routes could swallow it', () => {
    expect(() => streamHandler()).not.toThrow();
  });

  test('opens an event stream', async () => {
    const res = makeRes();
    await streamHandler()(makeReq(), res);
    expect(res.headers['content-type']).toBe('text/event-stream');
  });

  test('delivers the caller conversations on a snapshot', async () => {
    const res = makeRes();
    await streamHandler()(makeReq(), res);
    mockSnapshotHandlers[0].onNext(
      snapshotOf([{ id: 'a', data: { participantIds: ['50000010', '50000020'] } }]),
    );
    await Promise.resolve();
    await Promise.resolve();
    const got = events(res);
    expect(got.map((e) => e.name)).toContain('conversations');
    expect(got.find((e) => e.name === 'conversations').data.map((c) => c.id)).toEqual(['a']);
  });

  test('never delivers threads frozen at migration (UK OSA #17)', async () => {
    const res = makeRes();
    await streamHandler()(makeReq(), res);
    mockSnapshotHandlers[0].onNext(
      snapshotOf([
        { id: 'ok', data: { participantIds: ['50000010'] } },
        { id: 'frozen', data: { participantIds: ['50000010'], crossCohortAtMigration: true } },
      ]),
    );
    await Promise.resolve();
    await Promise.resolve();
    const delivered = events(res).find((e) => e.name === 'conversations').data;
    expect(delivered.map((c) => c.id)).toEqual(['ok']);
  });

  test('a caller suspended AFTER subscribing stops receiving, and the stream closes', async () => {
    // The whole point. Authorization is re-checked per delivery, because the
    // middleware's check ran once, hours ago, when the connection opened.
    const res = makeRes();
    await streamHandler()(makeReq(), res);

    mockSnapshotHandlers[0].onNext(
      snapshotOf([{ id: 'a', data: { participantIds: ['50000010'] } }]),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(events(res).some((e) => e.name === 'conversations')).toBe(true);

    mockSuspended.add('50000010'); // moderator suspends them mid-stream
    mockSnapshotHandlers[0].onNext(
      snapshotOf([{ id: 'b', data: { participantIds: ['50000010'] } }]),
    );
    await Promise.resolve();
    await Promise.resolve();

    const got = events(res);
    expect(got.some((e) => e.name === 'closed')).toBe(true);
    expect(got.filter((e) => e.name === 'conversations')).toHaveLength(1);
    expect(got.find((e) => e.name === 'conversations').data.map((c) => c.id)).toEqual(['a']);
  });

  test('a caller already suspended at subscribe never receives anything', async () => {
    mockSuspended.add('50000010');
    const res = makeRes();
    await streamHandler()(makeReq(), res);
    mockSnapshotHandlers[0].onNext(
      snapshotOf([{ id: 'a', data: { participantIds: ['50000010'] } }]),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(events(res).some((e) => e.name === 'conversations')).toBe(false);
  });

  test('disconnect detaches the Firestore listener', async () => {
    // A leaked listener per dropped phone is the failure mode that kills the
    // server slowly rather than loudly.
    const req = makeReq();
    await streamHandler()(req, makeRes());
    expect(mockUnsubscribe).not.toHaveBeenCalled();
    req.emitClose();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  test('a listener error closes the stream instead of hanging the client', async () => {
    const res = makeRes();
    await streamHandler()(makeReq(), res);
    mockSnapshotHandlers[0].onError(new Error('permission denied'));
    expect(events(res).some((e) => e.name === 'error')).toBe(true);
    expect(res.ended).toBe(true);
  });
});

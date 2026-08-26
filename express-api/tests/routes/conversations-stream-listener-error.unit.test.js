/**
 * SHY-0169 — what the stream does when its Firestore listener FAILS.
 *
 * The rest of this route is tested against the real emulator, in
 * `tests/routes/conversations-stream.test.js`: real writes drive a real
 * `onSnapshot`, and a real suspension in Firestore closes a real stream.
 *
 * This one branch cannot be reached that way. `onSnapshot`'s error callback
 * fires on things a test has no way to cause from outside — a revoked
 * credential, a dropped backend connection, a rules denial the admin SDK does
 * not get. Waiting for one would be waiting for an accident.
 *
 * So the listener is injected, and the file is named `.unit.test.js`, which is
 * the location the no-new-stubs ratchet (EPIC-0003) reserves for exactly this:
 * a branch that is genuinely a unit, tested as one, rather than a route test
 * wearing a double because the real thing was inconvenient.
 *
 * What it protects: without the error branch the client hangs. The stream is
 * open, nothing will ever arrive on it, and nothing tells the app so — the
 * worst shape of failure for a transport whose whole promise is that messages
 * turn up on their own.
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

let mockListenerError = null;

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: () => ({ get: async () => ({ exists: false, data: () => undefined }) }),
    collection: () => {
      const q = {
        where: () => q,
        orderBy: () => q,
        limit: () => q,
        onSnapshot: (_onNext, onError) => {
          // Fail on the next tick, the way a backend that drops a connection
          // does — not synchronously inside the subscribe call.
          setImmediate(() => onError(mockListenerError));
          return () => {};
        },
      };
      return q;
    },
  },
  rtdb: { ref: () => ({ set: async () => {} }) },
  FieldValue: { serverTimestamp: () => 'ts' },
}));

jest.mock('../../src/middleware/auth', () => ({
  isLiveAdmin: async () => false,
  checkSuspension: async () => false,
}));

const routes = require('../../src/routes/conversations');

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

const makeReq = () => ({
  auth: { uniqueId: 64400001, cohort: 'adult' },
  method: 'GET',
  url: '/conversations/stream',
  on() {},
});

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
      return name;
    });

beforeEach(() => {
  mockListenerError = new Error('permission denied');
});

afterAll(() => {
  if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('GET /api/conversations/stream — the listener fails', () => {
  test('the client is told, instead of being left holding an open stream', async () => {
    const res = makeRes();
    await streamHandler()(makeReq(), res);
    await new Promise((r) => setImmediate(r));

    expect(events(res)).toContain('error');
  });

  test('and the stream is closed rather than left open and silent', async () => {
    const res = makeRes();
    await streamHandler()(makeReq(), res);
    await new Promise((r) => setImmediate(r));

    expect(res.ended).toBe(true);
  });

  test('the error sent to the client says nothing about why', async () => {
    // The reason is logged, not sent. A listener failure can carry a rules
    // message naming documents and fields, and this stream is answering a
    // phone.
    mockListenerError = new Error('PERMISSION_DENIED: no access to conversations/1_2');
    const res = makeRes();
    await streamHandler()(makeReq(), res);
    await new Promise((r) => setImmediate(r));

    const sent = res.chunks.join('');
    expect(sent).toContain('stream failed');
    expect(sent).not.toContain('PERMISSION_DENIED');
    expect(sent).not.toContain('conversations/1_2');
  });
});

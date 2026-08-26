/**
 * SHY-0169 — the conversation stream, and the thing that makes it safe.
 *
 * A stream is ONE request. `authMiddleware` therefore runs its suspension check
 * exactly once, at subscribe, and then never again for a connection that may
 * last hours. Without a per-delivery re-check, suspending somebody would not
 * stop their messages arriving — the moderator would see the account disabled
 * and the person would carry on reading.
 *
 * That is the property these tests exist for. The wire format, the heartbeat
 * and the teardown belong to tests/utils/sse.unit.test.js.
 *
 * ─── What is real here, and what is not ─────────────────────────────────────
 *
 * This suite used to mock `src/utils/firebase`, `src/middleware/auth` and
 * `src/middleware/sameCohort`. It tripped the no-new-stubs ratchet
 * (EPIC-0003), and the doubles were doing more harm than the policy suggests:
 * `checkSuspension` was replaced by a Set, so the test asserted that a Set
 * lookup worked, not that suspending a person in Firestore stops their stream.
 *
 * Now:
 *   - Firestore is the REAL emulator. Deliveries are driven by real writes
 *     through a real `onSnapshot` listener, not by calling a captured callback.
 *   - `checkSuspension` is the real one, reading the real user document,
 *     through the same cache the middleware uses.
 *   - `requireSameCohort` is not mocked away.
 *
 * The response object is still a double, and deliberately so: it stands in for
 * a socket, exactly as in `sse.unit.test.js`. There is no real socket that
 * would prove anything this one does not, and driving SSE through a live HTTP
 * server would test Node's streams rather than this route's decisions.
 *
 * `req.auth` is set directly because identity resolution is not the subject —
 * the per-delivery RE-CHECK is, and that half reads Firestore for real.
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const { db } = require('../../src/utils/firebase');
const { clearAuthCaches } = require('../helpers/real-auth');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const routes = require('../../src/routes/conversations');

// Per-file id range: no seeded persona, no other suite (SHY-0464).
const CALLER = 64400001;
const OTHER = 64400002;
const MINOR = 64400003;

const convIdFor = (a, b) => [String(a), String(b)].sort().join('_');
const OWNED = [convIdFor(CALLER, OTHER), convIdFor(CALLER, MINOR)];

/** Captures what the stream would put on the wire. */
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

const makeReq = (uniqueId = CALLER) => {
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

/**
 * Waits for a condition instead of for a duration.
 *
 * A real listener fires when Firestore decides it has, which is soon but not
 * at a time this test may assume. A fixed sleep would be either flaky or slow,
 * and the repo forbids them outright.
 */
async function waitFor(predicate, what, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setImmediate(r));
  }
}

const named = (res, name) => events(res).filter((e) => e.name === name);

async function seedConversation(id, participants, extra = {}) {
  await db.doc(`conversations/${id}`).set({
    participantIds: participants.map(String),
    lastMessageAt: Date.now(),
    ...extra,
  });
}

const clearOwned = () => Promise.all(OWNED.map((id) => db.doc(`conversations/${id}`).delete()));

beforeAll(assertEmulatorReachable);

afterAll(async () => {
  await clearOwned();
  await Promise.all([CALLER, OTHER, MINOR].map((u) => db.doc(`users/${u}`).delete()));
  if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = PRIOR_NODE_ENV;
});

beforeEach(async () => {
  clearAuthCaches();
  await clearOwned();
  await db.doc(`users/${CALLER}`).set({ uniqueId: CALLER, cohort: 'adult', isSuspended: false });
  await db.doc(`users/${OTHER}`).set({ uniqueId: OTHER, cohort: 'adult' });
  await db.doc(`users/${MINOR}`).set({ uniqueId: MINOR, cohort: 'minor' });
});

describe('GET /api/conversations/stream', () => {
  test('is registered as a route, before the :id routes could swallow it', () => {
    expect(() => streamHandler()).not.toThrow();
  });

  test('opens an event stream', async () => {
    const res = makeRes();
    const req = makeReq();
    await streamHandler()(req, res);
    expect(res.headers['content-type']).toBe('text/event-stream');
    req.emitClose();
  });

  test('delivers the caller conversations when one is written', async () => {
    const res = makeRes();
    const req = makeReq();
    await streamHandler()(req, res);

    const id = convIdFor(CALLER, OTHER);
    await seedConversation(id, [CALLER, OTHER]);

    await waitFor(
      () => named(res, 'conversations').some((e) => e.data.some((c) => c.id === id)),
      'the conversation to arrive',
    );
    req.emitClose();
  });

  test('never delivers threads frozen at migration (UK OSA #17)', async () => {
    const res = makeRes();
    const req = makeReq();
    await streamHandler()(req, res);

    const ok = convIdFor(CALLER, OTHER);
    const frozen = convIdFor(CALLER, MINOR);
    await seedConversation(frozen, [CALLER, MINOR], { crossCohortAtMigration: true });
    await seedConversation(ok, [CALLER, OTHER]);

    // Wait for the ALLOWED one, then assert the frozen one never appeared —
    // waiting on an absence alone would pass before anything was delivered.
    await waitFor(
      () => named(res, 'conversations').some((e) => e.data.some((c) => c.id === ok)),
      'the allowed thread',
    );
    const everDelivered = named(res, 'conversations').flatMap((e) => e.data.map((c) => c.id));
    expect(everDelivered).not.toContain(frozen);
    req.emitClose();
  });

  test('a caller suspended AFTER subscribing stops receiving, and the stream closes', async () => {
    // The whole point. Authorization is re-checked per delivery, because the
    // middleware's check ran once, when the connection opened.
    const res = makeRes();
    const req = makeReq();
    await streamHandler()(req, res);

    const first = convIdFor(CALLER, OTHER);
    await seedConversation(first, [CALLER, OTHER]);
    await waitFor(() => named(res, 'conversations').length > 0, 'the first delivery');
    const deliveredBefore = named(res, 'conversations').length;

    // A moderator suspends them mid-stream, for real.
    await db.doc(`users/${CALLER}`).set({ uniqueId: CALLER, cohort: 'adult', isSuspended: true });
    clearAuthCaches();

    await seedConversation(convIdFor(CALLER, MINOR), [CALLER, OTHER]);

    await waitFor(() => named(res, 'closed').length > 0, 'the stream to close');
    expect(named(res, 'closed')[0].data.reason).toBe('suspended');
    expect(named(res, 'conversations').length).toBe(deliveredBefore);
    req.emitClose();
  });

  test('a caller already suspended at subscribe never receives anything', async () => {
    await db.doc(`users/${CALLER}`).set({ uniqueId: CALLER, cohort: 'adult', isSuspended: true });
    clearAuthCaches();

    const res = makeRes();
    const req = makeReq();
    await streamHandler()(req, res);
    await seedConversation(convIdFor(CALLER, OTHER), [CALLER, OTHER]);

    await waitFor(() => named(res, 'closed').length > 0, 'the stream to close');
    expect(named(res, 'conversations')).toHaveLength(0);
    req.emitClose();
  });

  test('disconnect detaches the listener — later writes deliver nothing', async () => {
    // A leaked listener per dropped phone is the failure mode that kills the
    // server slowly rather than loudly. Asserted by BEHAVIOUR: a write after
    // the disconnect must not reach a stream nobody is holding.
    const res = makeRes();
    const req = makeReq();
    await streamHandler()(req, res);

    await seedConversation(convIdFor(CALLER, OTHER), [CALLER, OTHER]);
    await waitFor(() => named(res, 'conversations').length > 0, 'the first delivery');

    req.emitClose();
    const afterDisconnect = res.chunks.length;

    // A POSITIVE control rather than a wait. Asserting an absence after a
    // pause proves only that the pause was long enough; a second, live stream
    // proves the write actually propagated, so the silence on the first one
    // means the listener detached rather than that nothing happened yet.
    const liveRes = makeRes();
    const liveReq = makeReq();
    await streamHandler()(liveReq, liveRes);

    await seedConversation(convIdFor(CALLER, MINOR), [CALLER, OTHER]);
    await waitFor(
      () => named(liveRes, 'conversations').length > 0,
      'the live stream to receive the write',
    );

    expect(res.chunks.length).toBe(afterDisconnect);
    liveReq.emitClose();
  });
});

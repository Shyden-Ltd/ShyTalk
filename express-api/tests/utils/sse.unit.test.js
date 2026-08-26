/**
 * SHY-0169 / SHY-0458 — the Server-Sent Events transport.
 *
 * The clients hold ~48 live Firestore and RTDB listeners between them, which is
 * how authorization ended up being decided on the phone instead of on the
 * server (EPIC-0006). Request/response endpoints cannot replace a listener, so
 * the operator ratified SSE on 2026-08-25: Express holds the listener with the
 * Admin SDK and fans out to authorised subscribers.
 *
 * This is the transport itself, kept separate from any one feature so the
 * remaining migrations reuse it rather than each inventing their own framing.
 *
 * What these tests pin, and why each one is here:
 *   - the headers a proxy needs in order NOT to buffer the stream; without
 *     `X-Accel-Buffering: no` an nginx in front of Express holds every event
 *     until the response ends, which for a stream is never
 *   - the wire format, exactly, because a missing blank line means the client
 *     sees nothing and the connection merely looks idle
 *   - that a closed stream stops writing. Writing to a dead socket throws
 *     asynchronously and takes the process with it
 *   - that the heartbeat and the listener are BOTH released on disconnect. A
 *     leaked interval per dropped phone is how a server dies quietly.
 */

/*
 * Named `.unit.test.js` deliberately (EPIC-0003). `utils/sse.js` is a pure
 * transport: it requires nothing, talks to no emulator, and its whole contract
 * is what it writes to a response object and when it stops. Testing it needs a
 * fake socket — there is no "real" one to point at that would prove anything
 * the fake does not, and a real HTTP server would only test Node.
 *
 * The no-new-stubs ratchet allows exactly this case, in exactly this location.
 * The suite it shipped beside, `conversations-stream.test.js`, is a ROUTE test
 * and does not qualify — that one runs on the real stack.
 */

const { openStream, DEFAULT_HEARTBEAT_MS } = require('../../src/utils/sse');

/** A response double that records what would go over the wire. */
const makeRes = () => {
  const res = {
    headers: {},
    chunks: [],
    ended: false,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    flushHeaders: jest.fn(),
    write(c) {
      if (this.ended) throw new Error('write after end');
      this.chunks.push(c);
      return true;
    },
    end() {
      this.ended = true;
    },
  };
  return res;
};

/** A request double with the `close` event Express gives us. */
const makeReq = () => {
  const handlers = {};
  return {
    on(evt, fn) {
      handlers[evt] = fn;
    },
    emitClose() {
      handlers.close?.();
    },
  };
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('openStream — headers', () => {
  test('declares an event stream', () => {
    const res = makeRes();
    openStream(makeReq(), res);
    expect(res.headers['content-type']).toBe('text/event-stream');
  });

  test('disables caching and proxy buffering', () => {
    // X-Accel-Buffering is the one people forget. Without it a buffering proxy
    // holds every event until the response ends — and a stream never ends.
    const res = makeRes();
    openStream(makeReq(), res);
    expect(res.headers['cache-control']).toMatch(/no-cache/);
    expect(res.headers['x-accel-buffering']).toBe('no');
    expect(res.headers['connection']).toBe('keep-alive');
  });

  test('flushes headers immediately so the client knows it is connected', () => {
    const res = makeRes();
    openStream(makeReq(), res);
    expect(res.flushHeaders).toHaveBeenCalled();
  });
});

describe('openStream — the wire format', () => {
  test('an event carries its name and JSON payload, terminated by a blank line', () => {
    const res = makeRes();
    const stream = openStream(makeReq(), res);
    stream.send('conversations', { id: 'a' });
    expect(res.chunks.join('')).toBe('event: conversations\ndata: {"id":"a"}\n\n');
  });

  test('a heartbeat is a comment, so clients ignore it but proxies see traffic', () => {
    const res = makeRes();
    openStream(makeReq(), res, { heartbeatMs: 1000 });
    jest.advanceTimersByTime(1000);
    expect(res.chunks.join('')).toMatch(/^:/);
  });

  test('the heartbeat keeps beating', () => {
    const res = makeRes();
    openStream(makeReq(), res, { heartbeatMs: 1000 });
    jest.advanceTimersByTime(3000);
    expect(res.chunks.filter((c) => c.startsWith(':')).length).toBe(3);
  });
});

describe('openStream — teardown', () => {
  test('client disconnect stops the heartbeat', () => {
    const res = makeRes();
    const req = makeReq();
    openStream(req, res, { heartbeatMs: 1000 });
    req.emitClose();
    jest.advanceTimersByTime(5000);
    expect(res.chunks.filter((c) => c.startsWith(':')).length).toBe(0);
  });

  test('client disconnect actually CLEARS the interval, not just silences it', () => {
    // Asserting "no heartbeats were written" is not enough: the interval's own
    // `if (!open) return` suppresses the write, so that assertion passes even
    // when the timer is never cleared. Mutation testing caught exactly that —
    // deleting the clearInterval left every test green while leaking one live
    // timer per dropped phone, forever. Count the resource, not the symptom.
    const req = makeReq();
    openStream(req, makeRes(), { heartbeatMs: 1000 });
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    req.emitClose();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('client disconnect runs the cleanup that releases the listener', () => {
    // The Firestore listener is the expensive half. A leaked one per dropped
    // phone is how the server dies quietly.
    const release = jest.fn();
    const req = makeReq();
    const stream = openStream(req, makeRes());
    stream.onClose(release);
    req.emitClose();
    expect(release).toHaveBeenCalledTimes(1);
  });

  test('cleanup runs once, not once per close signal', () => {
    const release = jest.fn();
    const req = makeReq();
    const stream = openStream(req, makeRes());
    stream.onClose(release);
    req.emitClose();
    req.emitClose();
    expect(release).toHaveBeenCalledTimes(1);
  });

  test('sending after close is a no-op, not a throw', () => {
    // Writing to a dead socket throws asynchronously and takes the process with
    // it. A fan-out that races a disconnect must not be able to do that.
    const res = makeRes();
    const req = makeReq();
    const stream = openStream(req, res);
    req.emitClose();
    expect(() => stream.send('conversations', { id: 'a' })).not.toThrow();
    expect(res.chunks.filter((c) => c.startsWith('event:'))).toHaveLength(0);
  });

  test('closing explicitly ends the response', () => {
    const res = makeRes();
    const stream = openStream(makeReq(), res);
    stream.close();
    expect(res.ended).toBe(true);
  });

  test('a cleanup that throws does not prevent the others from running', () => {
    const boom = () => {
      throw new Error('listener already gone');
    };
    const after = jest.fn();
    const req = makeReq();
    const stream = openStream(req, makeRes());
    stream.onClose(boom);
    stream.onClose(after);
    expect(() => req.emitClose()).not.toThrow();
    expect(after).toHaveBeenCalled();
  });
});

/**
 * A socket that has gone away.
 *
 * These paths are the module's central claim: "writing to a dead socket throws
 * asynchronously, which takes the process down — and a fan-out racing a
 * disconnect is the normal case, not an edge case." Every one of them was
 * uncovered, so the claim was made in a comment and nowhere else.
 */
const makeDeadRes = ({ failWrite = true, failEnd = false } = {}) => ({
  headers: {},
  chunks: [],
  ended: false,
  setHeader(k, v) {
    this.headers[k.toLowerCase()] = v;
  },
  flushHeaders() {},
  write(c) {
    if (failWrite) throw new Error('EPIPE: socket is gone');
    this.chunks.push(c);
    return true;
  },
  end() {
    if (failEnd) throw new Error('EPIPE: cannot end a gone socket');
    this.ended = true;
  },
});

describe('openStream — the socket has gone away', () => {
  test('a failed send answers false instead of throwing at the caller', () => {
    // The caller is a fan-out loop. A throw here would abort delivery to
    // everyone else on the same snapshot.
    const stream = openStream(makeReq(), makeDeadRes());
    expect(() => stream.send('conversations', [])).not.toThrow();
    expect(stream.send('conversations', [])).toBe(false);
  });

  test('a failed send closes the stream rather than leaving it half-alive', () => {
    const stream = openStream(makeReq(), makeDeadRes());
    stream.send('conversations', []);
    expect(stream.isOpen).toBe(false);
  });

  test('a failed heartbeat closes the stream and stops beating', () => {
    // One dead socket per dropped phone, beating for ever, is the leak that
    // kills a server slowly rather than loudly.
    const before = jest.getTimerCount();
    const stream = openStream(makeReq(), makeDeadRes());
    jest.advanceTimersByTime(DEFAULT_HEARTBEAT_MS + 1);
    expect(stream.isOpen).toBe(false);
    expect(jest.getTimerCount()).toBeLessThanOrEqual(before);
  });

  test('a socket that refuses to end does not take the close path down with it', () => {
    // close() is called from cleanup paths. A throw here would strand every
    // cleanup registered after it.
    const stream = openStream(makeReq(), makeDeadRes({ failWrite: false, failEnd: true }));
    expect(() => stream.close()).not.toThrow();
    expect(stream.isOpen).toBe(false);
  });
});

describe('openStream — a cleanup registered too late', () => {
  test('runs immediately rather than being queued on a dead stream', () => {
    // Registering after the stream has gone is a race, not a mistake: the
    // caller sets up its teardown after an await that the disconnect beat.
    // Queueing it would leak the very thing it was meant to release.
    const stream = openStream(makeReq(), makeRes());
    stream.close();

    let released = false;
    stream.onClose(() => {
      released = true;
    });
    expect(released).toBe(true);
  });

  test('a late cleanup that throws is contained', () => {
    const stream = openStream(makeReq(), makeRes());
    stream.close();
    expect(() =>
      stream.onClose(() => {
        throw new Error('cleanup exploded');
      }),
    ).not.toThrow();
  });
});

describe('openStream — isOpen', () => {
  test('reports the stream state, so callers can stop before writing', () => {
    const stream = openStream(makeReq(), makeRes());
    expect(stream.isOpen).toBe(true);
    stream.close();
    expect(stream.isOpen).toBe(false);
  });
});

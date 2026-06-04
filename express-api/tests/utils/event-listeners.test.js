// Test the wiring layer between Express boot and the owner-left listener.
// startEventListeners() is the single seam we wire from src/index.js — it
// builds the presence checker closure (so callers don't need to know the RTDB
// path) and delegates to registerOwnerLeftListener.

jest.mock('../../src/utils/owner-left-listener', () => ({
  registerOwnerLeftListener: jest.fn(),
}));

const { registerOwnerLeftListener } = require('../../src/utils/owner-left-listener');
const { startEventListeners } = require('../../src/utils/event-listeners');

function makeRtdbMock({ presenceExists = true, throwOnGet = false } = {}) {
  const get = jest.fn().mockImplementation(async () => {
    if (throwOnGet) throw new Error('rtdb unreachable');
    return { exists: () => presenceExists };
  });
  const ref = jest.fn(() => ({ get }));
  return { ref, get };
}

const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
const db = { __sentinel: 'firestore' };

beforeEach(() => {
  registerOwnerLeftListener.mockReset();
  registerOwnerLeftListener.mockReturnValue(() => {});
});

describe('startEventListeners — wiring', () => {
  test('calls registerOwnerLeftListener exactly once', () => {
    const rtdb = makeRtdbMock().ref;
    startEventListeners({ db, rtdb: { ref: rtdb }, log });
    expect(registerOwnerLeftListener).toHaveBeenCalledTimes(1);
  });

  test('passes db / rtdb / log straight through', () => {
    const rtdb = { ref: jest.fn() };
    startEventListeners({ db, rtdb, log });
    const arg = registerOwnerLeftListener.mock.calls[0][0];
    expect(arg.db).toBe(db);
    expect(arg.rtdb).toBe(rtdb);
    expect(arg.log).toBe(log);
  });

  test('builds a presenceChecker function (not undefined)', () => {
    startEventListeners({ db, rtdb: { ref: jest.fn() }, log });
    const arg = registerOwnerLeftListener.mock.calls[0][0];
    expect(typeof arg.presenceChecker).toBe('function');
  });

  test('returns a stop function that detaches the listener', () => {
    const detach = jest.fn();
    registerOwnerLeftListener.mockReturnValue(detach);
    const stop = startEventListeners({ db, rtdb: { ref: jest.fn() }, log });
    expect(typeof stop).toBe('function');
    stop();
    expect(detach).toHaveBeenCalledTimes(1);
  });

  test('stop is idempotent', () => {
    const detach = jest.fn();
    registerOwnerLeftListener.mockReturnValue(detach);
    const stop = startEventListeners({ db, rtdb: { ref: jest.fn() }, log });
    stop();
    stop();
    // detach is called every time (the listener wrapper itself handles
    // its own idempotency). What we care about: no exceptions.
    expect(() => stop()).not.toThrow();
  });
});

describe('startEventListeners — presenceChecker closure behavior', () => {
  test('reads from the canonical rooms/{roomId}/presence/{userId} RTDB path', async () => {
    const rtdb = makeRtdbMock({ presenceExists: true });
    startEventListeners({ db, rtdb, log });
    const presenceChecker = registerOwnerLeftListener.mock.calls[0][0].presenceChecker;
    await presenceChecker('room-X', 'user-Y');
    expect(rtdb.ref).toHaveBeenCalledWith('rooms/room-X/presence/user-Y');
  });

  test('returns true when snapshot exists', async () => {
    const rtdb = makeRtdbMock({ presenceExists: true });
    startEventListeners({ db, rtdb, log });
    const presenceChecker = registerOwnerLeftListener.mock.calls[0][0].presenceChecker;
    expect(await presenceChecker('room-1', 'user-1')).toBe(true);
  });

  test('returns false when snapshot does not exist', async () => {
    const rtdb = makeRtdbMock({ presenceExists: false });
    startEventListeners({ db, rtdb, log });
    const presenceChecker = registerOwnerLeftListener.mock.calls[0][0].presenceChecker;
    expect(await presenceChecker('room-1', 'user-1')).toBe(false);
  });

  test('PROPAGATES errors (does NOT fail-safe to true) so the listener can preserve the signal for retry', async () => {
    // Compare with isUserPresent in room-mutations.js which fails-safe-to-true
    // for use INSIDE a request handler (forging owner-away is the worse
    // outcome). For the listener path, retry-on-error is preferable to
    // silent-loss-of-event-on-error.
    const rtdb = makeRtdbMock({ throwOnGet: true });
    startEventListeners({ db, rtdb, log });
    const presenceChecker = registerOwnerLeftListener.mock.calls[0][0].presenceChecker;
    await expect(presenceChecker('room-1', 'user-1')).rejects.toThrow('rtdb unreachable');
  });

  test('escapes/forwards roomId and userId verbatim into the path (no transformation)', async () => {
    // The orchestrator passes ownerId from the Firestore room doc (trusted
    // source). Verify the closure doesn't accidentally mangle it.
    const rtdb = makeRtdbMock({ presenceExists: true });
    startEventListeners({ db, rtdb, log });
    const presenceChecker = registerOwnerLeftListener.mock.calls[0][0].presenceChecker;
    await presenceChecker('room_with-mixed.chars', 'user-42');
    expect(rtdb.ref).toHaveBeenCalledWith('rooms/room_with-mixed.chars/presence/user-42');
  });
});

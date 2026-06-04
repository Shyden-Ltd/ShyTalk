const { registerOwnerLeftListener } = require('../../src/utils/owner-left-listener');
const { OWNER_LEFT_ACTION } = require('../../src/utils/owner-left-handler');

// `registerOwnerLeftListener` attaches a `child_added` listener to the RTDB
// `ownerLeft` ref. Each fired child is a signal that an owner's onDisconnect
// fired for some room. The listener:
//   - validates the roomId (rejects empty/structurally-invalid keys)
//   - delegates to handleOwnerLeftSignal (the orchestrator) for the actual
//     room mutation + decision
//   - clears the signal entry on SUCCESS only (so a failure preserves the
//     signal for a later retry or restart-scan)
//   - never throws into the listener — errors are logged
//   - returns a `detach` function for shutdown / test cleanup
//
// The orchestrator is INJECTED so tests don't need a real Firestore — we
// substitute a jest.fn() and assert on it.

/**
 * RTDB mock matching the firebase-admin Reference shape the listener uses:
 *   rtdb.ref('ownerLeft').on('child_added', cb)
 *   rtdb.ref('ownerLeft').off('child_added', cb)
 *   rtdb.ref(`ownerLeft/${roomId}`).remove()
 *
 * `.on('child_added', cb)` synchronously fires for any existing children at
 * the moment of attach — mirrors Firebase admin SDK behavior. This is what
 * gives us "free" restart-scan: existing signals get processed on listener
 * boot without any explicit catch-up code.
 */
function makeMockRtdb({ initialChildren = {} } = {}) {
  let children = { ...initialChildren };
  const childRefs = new Map();
  const listeners = [];

  function getChildRef(path) {
    if (!childRefs.has(path)) {
      childRefs.set(path, {
        path,
        remove: jest.fn().mockImplementation(async () => {
          const m = path.match(/^ownerLeft\/(.+)$/);
          if (m) delete children[m[1]];
        }),
      });
    }
    return childRefs.get(path);
  }

  function makeSnap(roomId, value) {
    return {
      key: roomId,
      val: () => value,
      exists: () => value !== undefined && value !== null,
      ref: getChildRef(`ownerLeft/${roomId}`),
    };
  }

  const ownerLeftRef = {
    path: 'ownerLeft',
    on: jest.fn((eventType, callback) => {
      listeners.push({ eventType, callback });
      if (eventType === 'child_added') {
        for (const [key, value] of Object.entries(children)) {
          // Fire synchronously; tests await via the promise the callback returns
          callback(makeSnap(key, value));
        }
      }
    }),
    off: jest.fn((eventType, callback) => {
      const idx = listeners.findIndex((l) => l.eventType === eventType && l.callback === callback);
      if (idx !== -1) listeners.splice(idx, 1);
    }),
  };

  const rtdb = {
    ref: jest.fn((path) => (path === 'ownerLeft' ? ownerLeftRef : getChildRef(path))),
  };

  return {
    rtdb,
    ownerLeftRef,
    fireChildAdded: async (roomId, value = true) => {
      const childAdded = listeners.find((l) => l.eventType === 'child_added');
      if (!childAdded) throw new Error('No child_added listener attached');
      await childAdded.callback(makeSnap(roomId, value));
      return getChildRef(`ownerLeft/${roomId}`);
    },
    getChildren: () => ({ ...children }),
    getChildRef,
  };
}

function makeLog() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
}

// Stable args used across many tests.
const dummyDb = { __sentinel: 'firestore' };
const dummyPresenceChecker = jest.fn();

describe('registerOwnerLeftListener — attach / detach', () => {
  test('attaches a child_added listener to the ownerLeft ref on construction', () => {
    const { rtdb, ownerLeftRef } = makeMockRtdb();
    registerOwnerLeftListener({
      rtdb,
      db: dummyDb,
      presenceChecker: dummyPresenceChecker,
      log: makeLog(),
      handleSignal: jest.fn(),
    });
    expect(rtdb.ref).toHaveBeenCalledWith('ownerLeft');
    expect(ownerLeftRef.on).toHaveBeenCalledWith('child_added', expect.any(Function));
  });

  test('returns a detach function that removes the listener', () => {
    const { rtdb, ownerLeftRef } = makeMockRtdb();
    const detach = registerOwnerLeftListener({
      rtdb,
      db: dummyDb,
      presenceChecker: dummyPresenceChecker,
      log: makeLog(),
      handleSignal: jest.fn(),
    });
    expect(typeof detach).toBe('function');
    detach();
    expect(ownerLeftRef.off).toHaveBeenCalledWith('child_added', expect.any(Function));
    // Confirm the function passed to off matches the one passed to on (so
    // detachment actually targets our listener, not a stray reference).
    const onArgs = ownerLeftRef.on.mock.calls[0];
    const offArgs = ownerLeftRef.off.mock.calls[0];
    expect(offArgs[1]).toBe(onArgs[1]);
  });

  test('detach is idempotent (calling twice does not throw)', () => {
    const { rtdb } = makeMockRtdb();
    const detach = registerOwnerLeftListener({
      rtdb,
      db: dummyDb,
      presenceChecker: dummyPresenceChecker,
      log: makeLog(),
      handleSignal: jest.fn(),
    });
    detach();
    expect(() => detach()).not.toThrow();
  });
});

describe('registerOwnerLeftListener — signal processing', () => {
  test('invokes handleSignal with the roomId extracted from snap.key', async () => {
    const handleSignal = jest.fn().mockResolvedValue({ action: OWNER_LEFT_ACTION.OWNER_AWAY });
    const mock = makeMockRtdb();
    registerOwnerLeftListener({
      rtdb: mock.rtdb,
      db: dummyDb,
      presenceChecker: dummyPresenceChecker,
      log: makeLog(),
      handleSignal,
    });
    await mock.fireChildAdded('room-abc-123', 1700000000000);
    expect(handleSignal).toHaveBeenCalledTimes(1);
    const callArgs = handleSignal.mock.calls[0][0];
    expect(callArgs.roomId).toBe('room-abc-123');
    expect(callArgs.db).toBe(dummyDb);
    expect(callArgs.presenceChecker).toBe(dummyPresenceChecker);
  });

  test('removes the signal entry after successful processing', async () => {
    const handleSignal = jest.fn().mockResolvedValue({ action: OWNER_LEFT_ACTION.CLOSE_IMMEDIATE });
    const mock = makeMockRtdb();
    registerOwnerLeftListener({
      rtdb: mock.rtdb,
      db: dummyDb,
      presenceChecker: dummyPresenceChecker,
      log: makeLog(),
      handleSignal,
    });
    const childRef = await mock.fireChildAdded('room-1');
    expect(childRef.remove).toHaveBeenCalledTimes(1);
  });

  test('removes the signal entry even on NOOP outcome (idempotency drives cleanup)', async () => {
    // If the orchestrator decided NOOP (room missing, already CLOSED, etc.),
    // the signal still needs clearing — a retry would just NOOP again.
    const handleSignal = jest.fn().mockResolvedValue({
      action: OWNER_LEFT_ACTION.NOOP,
      reason: 'room-missing',
    });
    const mock = makeMockRtdb();
    registerOwnerLeftListener({
      rtdb: mock.rtdb,
      db: dummyDb,
      presenceChecker: dummyPresenceChecker,
      log: makeLog(),
      handleSignal,
    });
    const childRef = await mock.fireChildAdded('room-2');
    expect(childRef.remove).toHaveBeenCalledTimes(1);
  });

  test('does NOT throw out of the listener when handleSignal rejects', async () => {
    const handleSignal = jest.fn().mockRejectedValue(new Error('firestore down'));
    const mock = makeMockRtdb();
    registerOwnerLeftListener({
      rtdb: mock.rtdb,
      db: dummyDb,
      presenceChecker: dummyPresenceChecker,
      log: makeLog(),
      handleSignal,
    });
    // No unhandled rejection — the fire should resolve normally
    await expect(mock.fireChildAdded('room-3')).resolves.not.toThrow();
  });

  test('PRESERVES the signal entry on handleSignal failure (retry on next signal-fire)', async () => {
    const handleSignal = jest.fn().mockRejectedValue(new Error('firestore down'));
    const mock = makeMockRtdb();
    registerOwnerLeftListener({
      rtdb: mock.rtdb,
      db: dummyDb,
      presenceChecker: dummyPresenceChecker,
      log: makeLog(),
      handleSignal,
    });
    const childRef = await mock.fireChildAdded('room-4');
    expect(childRef.remove).not.toHaveBeenCalled();
  });

  test('logs an error message on handleSignal failure with roomId + error', async () => {
    const log = makeLog();
    const handleSignal = jest.fn().mockRejectedValue(new Error('firestore down'));
    const mock = makeMockRtdb();
    registerOwnerLeftListener({
      rtdb: mock.rtdb,
      db: dummyDb,
      presenceChecker: dummyPresenceChecker,
      log,
      handleSignal,
    });
    await mock.fireChildAdded('room-5');
    expect(log.error).toHaveBeenCalled();
    const errorPayload = log.error.mock.calls[0];
    // The error payload should include the roomId so an operator can find it
    expect(JSON.stringify(errorPayload)).toContain('room-5');
    expect(JSON.stringify(errorPayload)).toContain('firestore down');
  });
});

describe('registerOwnerLeftListener — startup-scan (existing children at attach)', () => {
  test('processes EVERY existing child at .on() time (free restart-scan)', async () => {
    const handleSignal = jest.fn().mockResolvedValue({ action: OWNER_LEFT_ACTION.OWNER_AWAY });
    const mock = makeMockRtdb({
      initialChildren: {
        'room-a': 1700000000001,
        'room-b': 1700000000002,
        'room-c': 1700000000003,
      },
    });
    registerOwnerLeftListener({
      rtdb: mock.rtdb,
      db: dummyDb,
      presenceChecker: dummyPresenceChecker,
      log: makeLog(),
      handleSignal,
    });
    // Allow microtasks to drain — synchronous callback invocation returns
    // a promise; we need to flush.
    await new Promise((r) => setImmediate(r));
    const roomIds = handleSignal.mock.calls.map((c) => c[0].roomId);
    expect(roomIds.sort()).toEqual(['room-a', 'room-b', 'room-c']);
  });
});

describe('registerOwnerLeftListener — adversarial: malicious / malformed keys', () => {
  test('ignores empty-string roomId', async () => {
    const log = makeLog();
    const handleSignal = jest.fn();
    const mock = makeMockRtdb();
    registerOwnerLeftListener({
      rtdb: mock.rtdb,
      db: dummyDb,
      presenceChecker: dummyPresenceChecker,
      log,
      handleSignal,
    });
    await mock.fireChildAdded('', 1700000000000);
    expect(handleSignal).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalled();
  });

  test('ignores null/undefined roomId', async () => {
    const handleSignal = jest.fn();
    const log = makeLog();
    const mock = makeMockRtdb();
    registerOwnerLeftListener({
      rtdb: mock.rtdb,
      db: dummyDb,
      presenceChecker: dummyPresenceChecker,
      log,
      handleSignal,
    });
    await mock.fireChildAdded(null, 1700000000000);
    await mock.fireChildAdded(undefined, 1700000000000);
    expect(handleSignal).not.toHaveBeenCalled();
  });

  test('ignores a roomId that violates the safe-key character allowlist', async () => {
    // RTDB itself disallows `/`, `.`, `#`, `$`, `[`, `]` in keys, so most of
    // these "shouldn't happen". Defense-in-depth: the listener validates
    // anyway, in case Firebase rules slip or a future SDK exposes raw keys.
    const log = makeLog();
    const handleSignal = jest.fn();
    const mock = makeMockRtdb();
    registerOwnerLeftListener({
      rtdb: mock.rtdb,
      db: dummyDb,
      presenceChecker: dummyPresenceChecker,
      log,
      handleSignal,
    });
    const malicious = ['../../foo', 'a/b', 'a.b', 'a#b', 'a$b', 'a[b]', 'a b', 'a\tb', 'a\nb'];
    for (const key of malicious) {
      await mock.fireChildAdded(key, 1700000000000);
    }
    expect(handleSignal).not.toHaveBeenCalled();
  });

  test('accepts standard room-id shapes (alphanumeric + dash + underscore)', async () => {
    const handleSignal = jest.fn().mockResolvedValue({ action: OWNER_LEFT_ACTION.OWNER_AWAY });
    const mock = makeMockRtdb();
    registerOwnerLeftListener({
      rtdb: mock.rtdb,
      db: dummyDb,
      presenceChecker: dummyPresenceChecker,
      log: makeLog(),
      handleSignal,
    });
    const validKeys = [
      'room-1',
      'ROOM_2',
      'a1b2c3',
      'abc-def-123_xyz',
      // Long but plausible Firestore-style ID
      'abcDEF0123456789xyzABCdef0123456789',
    ];
    for (const key of validKeys) {
      await mock.fireChildAdded(key, 1700000000000);
    }
    expect(handleSignal).toHaveBeenCalledTimes(validKeys.length);
  });

  test('rejects roomId longer than the safe maximum (DoS / abuse prevention)', async () => {
    const log = makeLog();
    const handleSignal = jest.fn();
    const mock = makeMockRtdb();
    registerOwnerLeftListener({
      rtdb: mock.rtdb,
      db: dummyDb,
      presenceChecker: dummyPresenceChecker,
      log,
      handleSignal,
    });
    // A pathologically long key shouldn't crash anything but doesn't match
    // a real Firestore document id (max 1500 bytes path; we choose 256
    // chars as a comfortable cap that still allows long IDs).
    const tooLong = 'a'.repeat(257);
    await mock.fireChildAdded(tooLong, 1700000000000);
    expect(handleSignal).not.toHaveBeenCalled();
  });
});

describe('registerOwnerLeftListener — adversarial: race / re-fire / concurrency', () => {
  test('second signal for the same roomId is processed independently (idempotent at handler layer)', async () => {
    // Even if RTDB somehow re-fires for the same key, the handler should
    // safely NOOP via decideOwnerLeftAction's state-machine guards. The
    // listener should NOT swallow the duplicate — it should pass it through.
    const handleSignal = jest.fn().mockResolvedValue({ action: OWNER_LEFT_ACTION.NOOP });
    const mock = makeMockRtdb();
    registerOwnerLeftListener({
      rtdb: mock.rtdb,
      db: dummyDb,
      presenceChecker: dummyPresenceChecker,
      log: makeLog(),
      handleSignal,
    });
    await mock.fireChildAdded('room-X');
    await mock.fireChildAdded('room-X');
    expect(handleSignal).toHaveBeenCalledTimes(2);
  });

  test('a failing signal does NOT prevent subsequent signals from being processed', async () => {
    const handleSignal = jest
      .fn()
      .mockRejectedValueOnce(new Error('transient failure'))
      .mockResolvedValueOnce({ action: OWNER_LEFT_ACTION.CLOSE_IMMEDIATE });
    const mock = makeMockRtdb();
    registerOwnerLeftListener({
      rtdb: mock.rtdb,
      db: dummyDb,
      presenceChecker: dummyPresenceChecker,
      log: makeLog(),
      handleSignal,
    });
    await mock.fireChildAdded('room-fail');
    await mock.fireChildAdded('room-ok');
    expect(handleSignal).toHaveBeenCalledTimes(2);
  });

  test('a remove() failure after success does not break the listener (logs + continues)', async () => {
    // If RTDB rejects the .remove(), we lose the cleanup but the room state
    // is already correct in Firestore. Listener should log and keep going.
    const handleSignal = jest.fn().mockResolvedValue({ action: OWNER_LEFT_ACTION.OWNER_AWAY });
    const mock = makeMockRtdb();
    const log = makeLog();
    registerOwnerLeftListener({
      rtdb: mock.rtdb,
      db: dummyDb,
      presenceChecker: dummyPresenceChecker,
      log,
      handleSignal,
    });
    // Make the next .remove() fail
    const childRef = mock.getChildRef('ownerLeft/room-remove-fails');
    childRef.remove.mockRejectedValueOnce(new Error('rtdb unreachable'));
    await expect(mock.fireChildAdded('room-remove-fails')).resolves.not.toThrow();
    // The error MUST be logged with the roomId, the action taken (so the
    // operator knows the Firestore mutation HAS committed even though the
    // signal entry is still around), and the error message — per the I4
    // review finding.
    expect(log.error).toHaveBeenCalledWith(
      'owner-left-listener',
      'Failed to clear signal after success',
      expect.objectContaining({
        roomId: 'room-remove-fails',
        action: OWNER_LEFT_ACTION.OWNER_AWAY,
        error: 'rtdb unreachable',
      }),
    );
    // After the failed remove, the next signal must still be processable
    await mock.fireChildAdded('room-after');
    expect(handleSignal).toHaveBeenCalledTimes(2);
  });
});

describe('registerOwnerLeftListener — dependency injection', () => {
  test('uses the injected handleSignal (default exposes the real orchestrator)', () => {
    // The signature accepts handleSignal so tests can swap it out — but the
    // default must be the real orchestrator so wiring "just works" in prod.
    // This test asserts the module exposes a sane default by attempting
    // registration without handleSignal injected.
    const mock = makeMockRtdb();
    expect(() =>
      registerOwnerLeftListener({
        rtdb: mock.rtdb,
        db: dummyDb,
        presenceChecker: dummyPresenceChecker,
        log: makeLog(),
        // handleSignal omitted on purpose — should fall back to the real one
      }),
    ).not.toThrow();
  });
});

describe('registerOwnerLeftListener — writer-uid forwarding (C2 + spoof prevention)', () => {
  test('passes snap.val() to handleSignal as writerUid', async () => {
    const handleSignal = jest.fn().mockResolvedValue({ action: OWNER_LEFT_ACTION.OWNER_AWAY });
    const mock = makeMockRtdb();
    registerOwnerLeftListener({
      rtdb: mock.rtdb,
      db: dummyDb,
      presenceChecker: dummyPresenceChecker,
      log: makeLog(),
      handleSignal,
    });
    await mock.fireChildAdded('room-w1', 'owner-uid-99');
    expect(handleSignal).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: 'room-w1', writerUid: 'owner-uid-99' }),
    );
  });

  test('forwards a numeric writerUid verbatim (string normalisation happens downstream)', async () => {
    const handleSignal = jest.fn().mockResolvedValue({ action: OWNER_LEFT_ACTION.OWNER_AWAY });
    const mock = makeMockRtdb();
    registerOwnerLeftListener({
      rtdb: mock.rtdb,
      db: dummyDb,
      presenceChecker: dummyPresenceChecker,
      log: makeLog(),
      handleSignal,
    });
    await mock.fireChildAdded('room-w2', 42);
    expect(handleSignal).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: 'room-w2', writerUid: 42 }),
    );
  });

  test('forwards null writerUid when snap.val() returns null (removal / cancel arm)', async () => {
    // RTDB child_added with a null value can occur in narrow edge cases
    // (e.g. arming with explicit null, or test fixtures). The orchestrator
    // treats null and undefined as "no attestation" and falls back to the
    // ownerStillPresent check.
    const handleSignal = jest.fn().mockResolvedValue({ action: OWNER_LEFT_ACTION.NOOP });
    const mock = makeMockRtdb();
    registerOwnerLeftListener({
      rtdb: mock.rtdb,
      db: dummyDb,
      presenceChecker: dummyPresenceChecker,
      log: makeLog(),
      handleSignal,
    });
    await mock.fireChildAdded('room-w3', null);
    expect(handleSignal).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: 'room-w3', writerUid: null }),
    );
  });
});

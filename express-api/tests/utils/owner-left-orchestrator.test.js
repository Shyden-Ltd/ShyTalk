const { OWNER_LEFT_ACTION } = require('../../src/utils/owner-left-handler');
const { handleOwnerLeftSignal } = require('../../src/utils/owner-left-orchestrator');

// `handleOwnerLeftSignal` is the orchestrator wired to the RTDB `ownerLeft/{roomId}`
// signal. Given a roomId, it:
//   1. Reads the room from Firestore (pre-txn) to obtain ownerId.
//   2. Re-checks RTDB presence for the owner (TOCTOU window — owner may have
//      reconnected on a second device between signal fire and processing).
//   3. Inside a Firestore transaction: re-reads the room, decides the action
//      via `decideOwnerLeftAction`, applies via `applyOwnerLeftTx`.
//   4. Returns `{ action, ...details }` for the caller (the RTDB listener
//      wrapper) to decide whether to clear the signal entry.
//
// The orchestrator does NOT touch the RTDB signal entry itself — that's the
// listener wrapper's job. Separation of concerns lets the wrapper retain the
// signal on error (so a later signal-fire or restart-scan can retry).

const baseActiveRoom = {
  state: 'ACTIVE',
  ownerId: 'owner-1',
  ownerLeftAt: null,
  participantIds: ['owner-1', 'user-2'],
  seats: {
    0: { userId: 'owner-1', state: 'OCCUPIED', isMuted: false },
    1: { userId: null, state: 'EMPTY', isMuted: false },
  },
};

const activeWithSeatedUser = {
  ...baseActiveRoom,
  seats: {
    0: { userId: 'owner-1', state: 'OCCUPIED', isMuted: false },
    1: { userId: 'user-2', state: 'OCCUPIED', isMuted: false },
  },
};

/**
 * Build a mock `db` matching the firebase-admin Firestore shape used by the
 * orchestrator: `db.doc(path)` returns a stable ref; `db.runTransaction(cb)`
 * supplies a transaction object with `t.get(ref)` and `t.update(ref, patch)`.
 *
 * The factory exposes the captured mocks so tests can assert against them.
 */
function makeMockDb({ initialRoom }) {
  const roomRef = { __ref: true };
  let currentRoom = initialRoom; // may be null/undefined to simulate missing
  const docFn = jest.fn(() => roomRef);

  const preGetMock = jest
    .fn()
    .mockImplementation(async () => ({ exists: !!currentRoom, data: () => currentRoom }));
  roomRef.get = preGetMock;

  const txMock = {
    get: jest
      .fn()
      .mockImplementation(async () => ({ exists: !!currentRoom, data: () => currentRoom })),
    update: jest.fn().mockImplementation((ref, patch) => {
      // Apply the patch locally so subsequent t.get calls inside the same
      // test (rare but possible) see the post-update shape.
      currentRoom = { ...currentRoom, ...patch };
    }),
  };

  const runTransaction = jest.fn().mockImplementation(async (callback) => callback(txMock));

  return { db: { doc: docFn, runTransaction }, roomRef, txMock, preGetMock };
}

describe('handleOwnerLeftSignal', () => {
  const nowMs = 1700000000000;
  let presenceChecker;

  beforeEach(() => {
    presenceChecker = jest.fn();
  });

  describe('room missing (pre-txn read)', () => {
    test('returns NOOP with reason room-missing and never queries presence', async () => {
      const { db } = makeMockDb({ initialRoom: null });
      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        nowMs,
      });
      expect(result.action).toBe(OWNER_LEFT_ACTION.NOOP);
      expect(result.reason).toBe('room-missing');
      expect(presenceChecker).not.toHaveBeenCalled();
    });

    test('does not open a transaction when room is missing', async () => {
      const { db } = makeMockDb({ initialRoom: null });
      await handleOwnerLeftSignal({ db, presenceChecker, roomId: 'room-1', nowMs });
      expect(db.runTransaction).not.toHaveBeenCalled();
    });
  });

  describe('owner still present (TOCTOU re-check returns true)', () => {
    test('returns NOOP without applying a txn update', async () => {
      const { db, txMock } = makeMockDb({ initialRoom: baseActiveRoom });
      presenceChecker.mockResolvedValue(true);

      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        nowMs,
      });

      expect(result.action).toBe(OWNER_LEFT_ACTION.NOOP);
      expect(presenceChecker).toHaveBeenCalledWith('room-1', 'owner-1');
      expect(txMock.update).not.toHaveBeenCalled();
    });

    test('still opens the transaction (to atomically observe state, even if no-op)', async () => {
      // The txn is the only safe place to make the decision atomically with
      // any concurrent client mutations — the TOCTOU re-check inside the txn
      // sees the latest room state.
      const { db } = makeMockDb({ initialRoom: baseActiveRoom });
      presenceChecker.mockResolvedValue(true);
      await handleOwnerLeftSignal({ db, presenceChecker, roomId: 'room-1', nowMs });
      expect(db.runTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('owner absent + ACTIVE + non-owner seated → OWNER_AWAY', () => {
    test('applies OWNER_AWAY patch inside transaction', async () => {
      const { db, txMock, roomRef } = makeMockDb({ initialRoom: activeWithSeatedUser });
      presenceChecker.mockResolvedValue(false);

      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        nowMs,
      });

      expect(result.action).toBe(OWNER_LEFT_ACTION.OWNER_AWAY);
      expect(txMock.update).toHaveBeenCalledTimes(1);
      expect(txMock.update).toHaveBeenCalledWith(roomRef, {
        state: 'OWNER_AWAY',
        ownerLeftAt: nowMs,
      });
    });

    test('returns the post-transition room shape', async () => {
      const { db } = makeMockDb({ initialRoom: activeWithSeatedUser });
      presenceChecker.mockResolvedValue(false);

      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        nowMs,
      });

      expect(result.postRoom.state).toBe('OWNER_AWAY');
      expect(result.postRoom.ownerLeftAt).toBe(nowMs);
    });
  });

  describe('owner absent + ACTIVE + no non-owner seated → CLOSE_IMMEDIATE', () => {
    test('applies the close payload inside transaction', async () => {
      const { db, txMock, roomRef } = makeMockDb({ initialRoom: baseActiveRoom });
      presenceChecker.mockResolvedValue(false);

      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        nowMs,
      });

      expect(result.action).toBe(OWNER_LEFT_ACTION.CLOSE_IMMEDIATE);
      const updateArgs = txMock.update.mock.calls[0];
      expect(updateArgs[0]).toBe(roomRef);
      expect(updateArgs[1]).toMatchObject({
        state: 'CLOSED',
        closedAt: nowMs,
        ownerLeftAt: null,
        participantIds: [],
      });
    });

    test('returns the closed room with participantIds cleared', async () => {
      const { db } = makeMockDb({ initialRoom: baseActiveRoom });
      presenceChecker.mockResolvedValue(false);

      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        nowMs,
      });

      expect(result.postRoom.state).toBe('CLOSED');
      expect(result.postRoom.participantIds).toEqual([]);
    });
  });

  describe('idempotent (room already transitioned)', () => {
    test('returns NOOP when room is already OWNER_AWAY (no double-stamp)', async () => {
      const alreadyAway = {
        ...activeWithSeatedUser,
        state: 'OWNER_AWAY',
        ownerLeftAt: nowMs - 1000,
      };
      const { db, txMock } = makeMockDb({ initialRoom: alreadyAway });
      presenceChecker.mockResolvedValue(false);

      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        nowMs,
      });

      expect(result.action).toBe(OWNER_LEFT_ACTION.NOOP);
      expect(txMock.update).not.toHaveBeenCalled();
    });

    test('returns NOOP when room is already CLOSED', async () => {
      const closed = { ...baseActiveRoom, state: 'CLOSED' };
      const { db, txMock } = makeMockDb({ initialRoom: closed });
      presenceChecker.mockResolvedValue(false);

      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        nowMs,
      });

      expect(result.action).toBe(OWNER_LEFT_ACTION.NOOP);
      expect(txMock.update).not.toHaveBeenCalled();
    });
  });

  describe('room disappears between pre-snap and txn (race)', () => {
    test('returns NOOP with reason room-missing-in-txn', async () => {
      const { db, txMock, preGetMock } = makeMockDb({ initialRoom: baseActiveRoom });
      // Pre-snap sees the room, but the txn sees it deleted.
      preGetMock.mockResolvedValueOnce({ exists: true, data: () => baseActiveRoom });
      txMock.get.mockResolvedValueOnce({ exists: false, data: () => undefined });
      presenceChecker.mockResolvedValue(false);

      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        nowMs,
      });

      expect(result.action).toBe(OWNER_LEFT_ACTION.NOOP);
      expect(result.reason).toBe('room-missing-in-txn');
      expect(txMock.update).not.toHaveBeenCalled();
    });
  });

  describe('error propagation', () => {
    test('throws when presenceChecker throws (caller decides whether to clear signal)', async () => {
      const { db } = makeMockDb({ initialRoom: baseActiveRoom });
      const boom = new Error('rtdb read failed');
      presenceChecker.mockRejectedValue(boom);

      await expect(
        handleOwnerLeftSignal({ db, presenceChecker, roomId: 'room-1', nowMs }),
      ).rejects.toThrow('rtdb read failed');
    });

    test('throws when Firestore runTransaction throws', async () => {
      const { db } = makeMockDb({ initialRoom: baseActiveRoom });
      const boom = new Error('firestore unavailable');
      db.runTransaction.mockRejectedValue(boom);
      presenceChecker.mockResolvedValue(false);

      await expect(
        handleOwnerLeftSignal({ db, presenceChecker, roomId: 'room-1', nowMs }),
      ).rejects.toThrow('firestore unavailable');
    });

    test('throws when pre-snap roomRef.get throws', async () => {
      const { db, preGetMock } = makeMockDb({ initialRoom: baseActiveRoom });
      const boom = new Error('firestore read failed');
      preGetMock.mockRejectedValue(boom);

      await expect(
        handleOwnerLeftSignal({ db, presenceChecker, roomId: 'room-1', nowMs }),
      ).rejects.toThrow('firestore read failed');
    });
  });

  describe('ownerId trust boundary', () => {
    test('reads ownerId from the Firestore room doc, not from caller args', async () => {
      // A malicious or buggy caller could pass a forged ownerId. The
      // orchestrator must ignore that and use the authoritative Firestore
      // value. We assert this by giving presenceChecker the chance to
      // observe what ownerId was passed and checking it matches the doc.
      const { db } = makeMockDb({ initialRoom: { ...baseActiveRoom, ownerId: 'real-owner' } });
      presenceChecker.mockResolvedValue(true); // pretend present so we can read invocation args

      await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        nowMs,
        ownerIdFromSignal: 'attacker-id', // ignored
      });

      expect(presenceChecker).toHaveBeenCalledWith('room-1', 'real-owner');
    });
  });

  describe('default nowMs', () => {
    test('uses Date.now() when nowMs is omitted', async () => {
      const { db, txMock } = makeMockDb({ initialRoom: activeWithSeatedUser });
      presenceChecker.mockResolvedValue(false);
      const realNow = Date.now;
      const fakeNow = 1234567890;
      Date.now = jest.fn(() => fakeNow);
      try {
        await handleOwnerLeftSignal({ db, presenceChecker, roomId: 'room-1' });
        expect(txMock.update).toHaveBeenCalledWith(expect.anything(), {
          state: 'OWNER_AWAY',
          ownerLeftAt: fakeNow,
        });
      } finally {
        Date.now = realNow;
      }
    });
  });
});

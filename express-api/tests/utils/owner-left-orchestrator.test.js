const { OWNER_LEFT_ACTION } = require('../../src/utils/owner-left-handler');
const {
  handleOwnerLeftSignal,
  isValidOwnerId,
} = require('../../src/utils/owner-left-orchestrator');

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

  describe('ownerId path-safety guard (C2 + I2)', () => {
    // C2: ownerId from Firestore is interpolated into an RTDB path; it MUST
    // be validated as path-safe BEFORE it crosses module boundaries.
    // I2:  ownerId may be missing/null/undefined in a corrupt-but-present
    // room doc; without a guard the orchestrator silently closes the room.
    test('returns NOOP with reason owner-id-missing-or-invalid when ownerId is null', async () => {
      const { db } = makeMockDb({ initialRoom: { ...baseActiveRoom, ownerId: null } });
      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        nowMs,
      });
      expect(result.action).toBe(OWNER_LEFT_ACTION.NOOP);
      expect(result.reason).toBe('owner-id-missing-or-invalid');
      expect(presenceChecker).not.toHaveBeenCalled();
    });

    test('returns NOOP when ownerId is undefined', async () => {
      const room = { ...baseActiveRoom };
      delete room.ownerId;
      const { db } = makeMockDb({ initialRoom: room });
      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        nowMs,
      });
      expect(result.action).toBe(OWNER_LEFT_ACTION.NOOP);
      expect(result.reason).toBe('owner-id-missing-or-invalid');
      expect(presenceChecker).not.toHaveBeenCalled();
    });

    test('returns NOOP when ownerId is an empty string', async () => {
      const { db } = makeMockDb({ initialRoom: { ...baseActiveRoom, ownerId: '' } });
      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        nowMs,
      });
      expect(result.action).toBe(OWNER_LEFT_ACTION.NOOP);
      expect(result.reason).toBe('owner-id-missing-or-invalid');
      expect(presenceChecker).not.toHaveBeenCalled();
    });

    test('returns NOOP when ownerId contains a forward slash (path traversal attempt)', async () => {
      const { db } = makeMockDb({ initialRoom: { ...baseActiveRoom, ownerId: '../../etc' } });
      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        nowMs,
      });
      expect(result.action).toBe(OWNER_LEFT_ACTION.NOOP);
      expect(result.reason).toBe('owner-id-missing-or-invalid');
      expect(presenceChecker).not.toHaveBeenCalled();
    });

    test('returns NOOP when ownerId contains RTDB-illegal chars (., #, $, [, ])', async () => {
      const illegalIds = ['a.b', 'a#b', 'a$b', 'a[b]', 'a b', 'a\nb', ' '];
      for (const ownerId of illegalIds) {
        const { db } = makeMockDb({ initialRoom: { ...baseActiveRoom, ownerId } });
        const result = await handleOwnerLeftSignal({
          db,
          presenceChecker,
          roomId: 'room-1',
          nowMs,
        });
        expect(result.action).toBe(OWNER_LEFT_ACTION.NOOP);
        expect(result.reason).toBe('owner-id-missing-or-invalid');
      }
      expect(presenceChecker).not.toHaveBeenCalled();
    });

    test('returns NOOP when ownerId exceeds the safe length cap', async () => {
      const { db } = makeMockDb({
        initialRoom: { ...baseActiveRoom, ownerId: 'a'.repeat(257) },
      });
      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        nowMs,
      });
      expect(result.action).toBe(OWNER_LEFT_ACTION.NOOP);
      expect(result.reason).toBe('owner-id-missing-or-invalid');
      expect(presenceChecker).not.toHaveBeenCalled();
    });

    test('accepts ownerId with standard alphanumeric + dash + underscore shapes', async () => {
      const validIds = ['owner-1', 'OWNER_2', '42', 'a1b2-c3_d4', 'abcDEF0123456789'];
      for (const ownerId of validIds) {
        presenceChecker.mockClear();
        presenceChecker.mockResolvedValue(true); // present → NOOP, no txn write
        const { db } = makeMockDb({ initialRoom: { ...baseActiveRoom, ownerId } });
        const result = await handleOwnerLeftSignal({
          db,
          presenceChecker,
          roomId: 'room-1',
          nowMs,
        });
        expect(result.reason).not.toBe('owner-id-missing-or-invalid');
        expect(presenceChecker).toHaveBeenCalledWith('room-1', ownerId);
      }
    });

    // R2 finding I1: boolean primitives silently passed the original guard
    // because String(true)/String(false) yield alphanumeric strings.
    test('returns NOOP when ownerId is the boolean true (data corruption)', async () => {
      const { db } = makeMockDb({ initialRoom: { ...baseActiveRoom, ownerId: true } });
      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        nowMs,
      });
      expect(result.action).toBe(OWNER_LEFT_ACTION.NOOP);
      expect(result.reason).toBe('owner-id-missing-or-invalid');
      expect(presenceChecker).not.toHaveBeenCalled();
    });

    test('returns NOOP when ownerId is the boolean false (data corruption)', async () => {
      const { db } = makeMockDb({ initialRoom: { ...baseActiveRoom, ownerId: false } });
      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        nowMs,
      });
      expect(result.action).toBe(OWNER_LEFT_ACTION.NOOP);
      expect(result.reason).toBe('owner-id-missing-or-invalid');
      expect(presenceChecker).not.toHaveBeenCalled();
    });

    test('returns NOOP when ownerId is NaN', async () => {
      const { db } = makeMockDb({ initialRoom: { ...baseActiveRoom, ownerId: NaN } });
      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        nowMs,
      });
      expect(result.action).toBe(OWNER_LEFT_ACTION.NOOP);
      expect(result.reason).toBe('owner-id-missing-or-invalid');
    });

    test('returns NOOP when ownerId is Infinity', async () => {
      const { db } = makeMockDb({ initialRoom: { ...baseActiveRoom, ownerId: Infinity } });
      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        nowMs,
      });
      expect(result.action).toBe(OWNER_LEFT_ACTION.NOOP);
      expect(result.reason).toBe('owner-id-missing-or-invalid');
    });

    test('returns NOOP when ownerId is an object', async () => {
      const { db } = makeMockDb({
        initialRoom: { ...baseActiveRoom, ownerId: { uniqueId: 42 } },
      });
      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        nowMs,
      });
      expect(result.action).toBe(OWNER_LEFT_ACTION.NOOP);
      expect(result.reason).toBe('owner-id-missing-or-invalid');
    });

    test('returns NOOP when ownerId is an array', async () => {
      const { db } = makeMockDb({ initialRoom: { ...baseActiveRoom, ownerId: ['42'] } });
      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        nowMs,
      });
      expect(result.action).toBe(OWNER_LEFT_ACTION.NOOP);
      expect(result.reason).toBe('owner-id-missing-or-invalid');
    });

    // ShyTalk's accountDeletion.js:148 calls `String(roomDoc.data().ownerId)`
    // for comparison, which means the schema legitimately stores ownerId as
    // either a string or a finite number. The guard MUST accept both.
    test('accepts a finite number ownerId (e.g. uniqueId stored as int)', async () => {
      presenceChecker.mockResolvedValue(true);
      const { db } = makeMockDb({ initialRoom: { ...baseActiveRoom, ownerId: 42 } });
      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        nowMs,
      });
      expect(result.reason).not.toBe('owner-id-missing-or-invalid');
      expect(presenceChecker).toHaveBeenCalledWith('room-1', 42);
    });

    test('accepts numeric 0 (path-safe, single-char id)', async () => {
      presenceChecker.mockResolvedValue(true);
      const { db } = makeMockDb({ initialRoom: { ...baseActiveRoom, ownerId: 0 } });
      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        nowMs,
      });
      expect(result.reason).not.toBe('owner-id-missing-or-invalid');
      expect(presenceChecker).toHaveBeenCalledWith('room-1', 0);
    });

    test('accepts ownerId at exactly the 256-char boundary (inclusive)', async () => {
      presenceChecker.mockResolvedValue(true);
      const at256 = 'a'.repeat(256);
      const { db } = makeMockDb({ initialRoom: { ...baseActiveRoom, ownerId: at256 } });
      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        nowMs,
      });
      expect(result.reason).not.toBe('owner-id-missing-or-invalid');
    });
  });

  describe('isValidOwnerId — direct unit tests (path-safety primitive)', () => {
    // Direct tests on the exported guard so future callers can rely on
    // documented behaviour without inferring it from integration paths.
    test('returns false for null + undefined', () => {
      expect(isValidOwnerId(null)).toBe(false);
      expect(isValidOwnerId(undefined)).toBe(false);
    });

    test('returns false for booleans', () => {
      expect(isValidOwnerId(true)).toBe(false);
      expect(isValidOwnerId(false)).toBe(false);
    });

    test('returns false for empty string', () => {
      expect(isValidOwnerId('')).toBe(false);
    });

    test('returns true for valid strings', () => {
      expect(isValidOwnerId('owner-1')).toBe(true);
      expect(isValidOwnerId('A')).toBe(true);
      expect(isValidOwnerId('abc_DEF-123')).toBe(true);
    });

    test('returns true for string "0" (path-safe single-char digit, distinct from numeric 0)', () => {
      // R3 I2: pins the string-zero boundary so a future regex tightening
      // (e.g. requiring leading non-digit) doesn't silently break valid IDs.
      expect(isValidOwnerId('0')).toBe(true);
    });

    test('returns true for finite numbers', () => {
      expect(isValidOwnerId(42)).toBe(true);
      expect(isValidOwnerId(0)).toBe(true);
      expect(isValidOwnerId(1e9)).toBe(true);
    });

    test('returns false for non-finite numbers', () => {
      expect(isValidOwnerId(NaN)).toBe(false);
      expect(isValidOwnerId(Infinity)).toBe(false);
      expect(isValidOwnerId(-Infinity)).toBe(false);
    });

    test('returns false for strings with RTDB-illegal chars', () => {
      const bad = ['a/b', 'a.b', 'a#b', 'a$b', 'a[b]', 'a b', 'a\tb', '../../foo'];
      for (const id of bad) expect(isValidOwnerId(id)).toBe(false);
    });

    test('returns false for objects + arrays + functions', () => {
      expect(isValidOwnerId({})).toBe(false);
      expect(isValidOwnerId([])).toBe(false);
      expect(isValidOwnerId(['a'])).toBe(false);
      expect(isValidOwnerId(() => 'fn')).toBe(false);
    });

    test('boundary: exactly 256 chars is accepted, 257 is rejected', () => {
      expect(isValidOwnerId('a'.repeat(256))).toBe(true);
      expect(isValidOwnerId('a'.repeat(257))).toBe(false);
    });

    test('returns false for negative numbers (dash is not interpreted in the regex)', () => {
      // String(-1) = "-1"; "-1" contains a dash, which IS in the allowlist
      // pattern [A-Za-z0-9_-]. So negative numbers DO pass the regex when
      // string-normalised. This test documents that behaviour explicitly so
      // a future reviewer doesn't misread "should be rejected".
      // ShyTalk's uniqueIds are non-negative, but the path-safety guard is
      // schema-agnostic; negative numbers are valid RTDB path components.
      expect(isValidOwnerId(-1)).toBe(true);
    });
  });

  describe('writer-uid spoof prevention', () => {
    // Without this check, an attacker can write `ownerLeft/{victim-room} = attacker-uid`
    // (allowed by the RTDB rule `newData.val() === auth.uid`); the listener fires;
    // the server reads room.ownerId = victim; presenceChecker for victim returns
    // false if victim has a brief network blip — and the room is illegitimately
    // closed or transitioned to OWNER_AWAY. The writerUid arg is the value at
    // the RTDB signal entry (snap.val()) — it MUST match the room owner.
    test('returns NOOP when writerUid does not match preRoom.ownerId', async () => {
      const { db } = makeMockDb({ initialRoom: { ...baseActiveRoom, ownerId: 'owner-1' } });
      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        writerUid: 'attacker-uid',
        nowMs,
      });
      expect(result.action).toBe(OWNER_LEFT_ACTION.NOOP);
      expect(result.reason).toBe('writer-not-owner');
      // Critical: presenceChecker was NOT called — attacker can't even probe
      // the victim's presence state via this signal-spam.
      expect(presenceChecker).not.toHaveBeenCalled();
    });

    test('proceeds when writerUid matches preRoom.ownerId', async () => {
      const { db } = makeMockDb({ initialRoom: { ...baseActiveRoom, ownerId: 'owner-1' } });
      presenceChecker.mockResolvedValue(false);
      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        writerUid: 'owner-1',
        nowMs,
      });
      expect(result.action).toBe(OWNER_LEFT_ACTION.CLOSE_IMMEDIATE);
      expect(presenceChecker).toHaveBeenCalledWith('room-1', 'owner-1');
    });

    test('writerUid omitted (undefined) is accepted — backward compat for direct callers', async () => {
      // The orchestrator can be called from contexts other than the RTDB
      // listener; when no writer attestation is available, the existing
      // ownerStillPresent / state-machine guards still apply.
      const { db } = makeMockDb({ initialRoom: { ...baseActiveRoom, ownerId: 'owner-1' } });
      presenceChecker.mockResolvedValue(false);
      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        nowMs,
      });
      expect(result.action).toBe(OWNER_LEFT_ACTION.CLOSE_IMMEDIATE);
    });

    test('writerUid normalisation handles string vs numeric ownerId', async () => {
      const { db } = makeMockDb({ initialRoom: { ...baseActiveRoom, ownerId: 42 } });
      presenceChecker.mockResolvedValue(true);
      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        writerUid: '42',
        nowMs,
      });
      // Match by string-normalised compare — should NOT be writer-not-owner.
      expect(result.reason).not.toBe('writer-not-owner');
    });

    // R3 I1: the listener forwards `null` as writerUid when snap.val() is
    // null. The orchestrator's `writerUid !== null && writerUid !== undefined`
    // guard treats both as "no attestation" — but null and undefined exit
    // the check at DIFFERENT short-circuit conditions, so test both paths.
    test('writerUid explicitly null is accepted — treated as no attestation', async () => {
      const { db } = makeMockDb({ initialRoom: { ...baseActiveRoom, ownerId: 'owner-1' } });
      presenceChecker.mockResolvedValue(false);
      const result = await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        writerUid: null,
        nowMs,
      });
      expect(result.reason).not.toBe('writer-not-owner');
      expect(result.action).toBe(OWNER_LEFT_ACTION.CLOSE_IMMEDIATE);
      expect(presenceChecker).toHaveBeenCalledWith('room-1', 'owner-1');
    });
  });

  describe('transaction retry on contention (I3)', () => {
    // Firestore Admin SDK retries the transaction callback on contention.
    // ownerStillPresent is captured BEFORE the txn opens and re-used across
    // every retry — that's intentional (the presence read can't run inside
    // the txn). This test pins that semantic so a future refactor that
    // tries to re-read presence inside the callback (which would deadlock
    // or block) is caught.
    test('does not re-invoke presenceChecker on transaction retry', async () => {
      const { db, txMock } = makeMockDb({ initialRoom: activeWithSeatedUser });
      presenceChecker.mockResolvedValue(false);
      // Force the runTransaction mock to invoke the callback twice (simulating
      // a contention-retry from the SDK).
      let invocations = 0;
      db.runTransaction.mockImplementation(async (callback) => {
        invocations += 1;
        const first = await callback(txMock);
        if (invocations === 1) {
          // Pretend the first attempt was retried by the SDK (contention).
          return callback(txMock);
        }
        return first;
      });

      await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        nowMs,
      });

      // presenceChecker is called exactly once even though the txn callback
      // ran twice — captured outside, by design.
      expect(presenceChecker).toHaveBeenCalledTimes(1);
    });

    test('reuses the same effectiveNowMs across transaction retries', async () => {
      // Simulate Firestore SDK contention-retry: the same callback runs
      // twice. In real Firestore, between attempts the SDK rolls back the
      // first attempt's writes and re-reads the data, so attempt 2 sees the
      // original (pre-attempt-1) room state. The mock replays that by
      // returning the SAME pre-mutation room shape from t.get() on every
      // call, regardless of how many t.update calls fired earlier.
      const { db, roomRef } = makeMockDb({ initialRoom: activeWithSeatedUser });
      presenceChecker.mockResolvedValue(false);

      let invocations = 0;
      const constantTxMock = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => activeWithSeatedUser,
        }),
        update: jest.fn(),
      };
      db.runTransaction.mockImplementation(async (callback) => {
        invocations += 1;
        const first = await callback(constantTxMock);
        if (invocations === 1) return callback(constantTxMock);
        return first;
      });

      await handleOwnerLeftSignal({
        db,
        presenceChecker,
        roomId: 'room-1',
        nowMs,
      });

      // Both callback invocations should have called update with the same
      // OWNER_AWAY patch — same nowMs reused across retries.
      expect(constantTxMock.update.mock.calls.length).toBe(2);
      for (const call of constantTxMock.update.mock.calls) {
        expect(call[0]).toBe(roomRef);
        expect(call[1]).toEqual({ state: 'OWNER_AWAY', ownerLeftAt: nowMs });
      }
    });
  });
});

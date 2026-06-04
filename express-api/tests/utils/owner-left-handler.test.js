const {
  OWNER_LEFT_ACTION,
  decideOwnerLeftAction,
  applyOwnerLeftTx,
} = require('../../src/utils/owner-left-handler');
const { buildClosePayload } = require('../../src/utils/stale-room-reap');

// The handler implements the operator's refined state machine for owner
// disconnect (2026-06-04):
//   - On owner disconnect (signalled via RTDB onDisconnect), the server
//     decides per the ROOM's current shape:
//       * if owner is still present somewhere else (multi-device, reconnect
//         within the listener's processing window) — NOOP
//       * if room is not ACTIVE (already AWAY/CLOSED) — NOOP (idempotent)
//       * if ACTIVE and no non-owner seated — CLOSE_IMMEDIATELY
//       * if ACTIVE and at least one non-owner seated — OWNER_AWAY
//     The cron is NOT involved in any branch.

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

const activeWithNonOwnerSeated = {
  ...baseActiveRoom,
  seats: {
    0: { userId: 'owner-1', state: 'OCCUPIED', isMuted: false },
    1: { userId: 'user-2', state: 'OCCUPIED', isMuted: false },
  },
};

describe('OWNER_LEFT_ACTION', () => {
  test('exports NOOP, OWNER_AWAY, CLOSE_IMMEDIATE constants', () => {
    expect(OWNER_LEFT_ACTION.NOOP).toBeDefined();
    expect(OWNER_LEFT_ACTION.OWNER_AWAY).toBeDefined();
    expect(OWNER_LEFT_ACTION.CLOSE_IMMEDIATE).toBeDefined();
    // All three must be distinct strings so callers can switch/branch reliably.
    const values = [
      OWNER_LEFT_ACTION.NOOP,
      OWNER_LEFT_ACTION.OWNER_AWAY,
      OWNER_LEFT_ACTION.CLOSE_IMMEDIATE,
    ];
    expect(new Set(values).size).toBe(3);
  });
});

describe('decideOwnerLeftAction', () => {
  describe('TOCTOU presence re-check (ownerStillPresent === true)', () => {
    // The RTDB signal can fire on a transient disconnect, but the owner may
    // already have reconnected by the time the listener processes the event,
    // or the owner may be present on a SECOND device that never disconnected.
    // The presence re-check is the authoritative gate — if the owner is
    // present anywhere, do nothing.
    test('returns NOOP when owner still present on ACTIVE room with non-owner seated', () => {
      expect(decideOwnerLeftAction(activeWithNonOwnerSeated, true)).toBe(OWNER_LEFT_ACTION.NOOP);
    });

    test('returns NOOP when owner still present on ACTIVE room without non-owner seated', () => {
      expect(decideOwnerLeftAction(baseActiveRoom, true)).toBe(OWNER_LEFT_ACTION.NOOP);
    });

    test('returns NOOP when owner still present on OWNER_AWAY room', () => {
      const room = { ...baseActiveRoom, state: 'OWNER_AWAY', ownerLeftAt: 1700000000000 };
      expect(decideOwnerLeftAction(room, true)).toBe(OWNER_LEFT_ACTION.NOOP);
    });

    test('returns NOOP when owner still present on CLOSED room', () => {
      const room = { ...baseActiveRoom, state: 'CLOSED' };
      expect(decideOwnerLeftAction(room, true)).toBe(OWNER_LEFT_ACTION.NOOP);
    });
  });

  describe('input guards (ownerStillPresent === false)', () => {
    test('returns NOOP when room is null', () => {
      expect(decideOwnerLeftAction(null, false)).toBe(OWNER_LEFT_ACTION.NOOP);
    });

    test('returns NOOP when room is undefined', () => {
      expect(decideOwnerLeftAction(undefined, false)).toBe(OWNER_LEFT_ACTION.NOOP);
    });

    test('returns NOOP when room.state is missing', () => {
      const room = { ...baseActiveRoom };
      delete room.state;
      expect(decideOwnerLeftAction(room, false)).toBe(OWNER_LEFT_ACTION.NOOP);
    });

    test('returns NOOP when room.state is null', () => {
      const room = { ...baseActiveRoom, state: null };
      expect(decideOwnerLeftAction(room, false)).toBe(OWNER_LEFT_ACTION.NOOP);
    });
  });

  describe('idempotency (state is not ACTIVE)', () => {
    // If state is OWNER_AWAY, the client-driven path already detected and
    // transitioned the room — the listener's job is done, signal should
    // just be cleared. Same for CLOSED rooms.
    test('returns NOOP when state is OWNER_AWAY (already transitioned)', () => {
      const room = { ...baseActiveRoom, state: 'OWNER_AWAY', ownerLeftAt: 1700000000000 };
      expect(decideOwnerLeftAction(room, false)).toBe(OWNER_LEFT_ACTION.NOOP);
    });

    test('returns NOOP when state is CLOSED', () => {
      const room = { ...baseActiveRoom, state: 'CLOSED' };
      expect(decideOwnerLeftAction(room, false)).toBe(OWNER_LEFT_ACTION.NOOP);
    });

    test('returns NOOP when state is an unrecognised string', () => {
      const room = { ...baseActiveRoom, state: 'UNKNOWN_STATE' };
      expect(decideOwnerLeftAction(room, false)).toBe(OWNER_LEFT_ACTION.NOOP);
    });
  });

  describe('CLOSE_IMMEDIATE branch (ACTIVE + no non-owner seated)', () => {
    test('returns CLOSE_IMMEDIATE when only owner is seated', () => {
      // Owner on seat 0, all other seats empty.
      expect(decideOwnerLeftAction(baseActiveRoom, false)).toBe(OWNER_LEFT_ACTION.CLOSE_IMMEDIATE);
    });

    test('returns CLOSE_IMMEDIATE when no one is seated', () => {
      const room = {
        ...baseActiveRoom,
        seats: {
          0: { userId: null, state: 'EMPTY', isMuted: false },
          1: { userId: null, state: 'EMPTY', isMuted: false },
        },
      };
      expect(decideOwnerLeftAction(room, false)).toBe(OWNER_LEFT_ACTION.CLOSE_IMMEDIATE);
    });

    test('returns CLOSE_IMMEDIATE when seats object is empty', () => {
      const room = { ...baseActiveRoom, seats: {} };
      expect(decideOwnerLeftAction(room, false)).toBe(OWNER_LEFT_ACTION.CLOSE_IMMEDIATE);
    });

    test('returns CLOSE_IMMEDIATE when seats object is missing', () => {
      const room = { ...baseActiveRoom };
      delete room.seats;
      expect(decideOwnerLeftAction(room, false)).toBe(OWNER_LEFT_ACTION.CLOSE_IMMEDIATE);
    });

    test('returns CLOSE_IMMEDIATE when a non-owner is seated but state is RESERVED, not OCCUPIED', () => {
      // A user with a pending seat-request that hasn't fully occupied yet
      // doesn't count as "seated" — hasNonOwnerSeated requires OCCUPIED.
      const room = {
        ...baseActiveRoom,
        seats: {
          0: { userId: 'owner-1', state: 'OCCUPIED', isMuted: false },
          1: { userId: 'user-2', state: 'RESERVED', isMuted: false },
        },
      };
      expect(decideOwnerLeftAction(room, false)).toBe(OWNER_LEFT_ACTION.CLOSE_IMMEDIATE);
    });
  });

  describe('OWNER_AWAY branch (ACTIVE + non-owner seated)', () => {
    test('returns OWNER_AWAY when one non-owner is seated', () => {
      expect(decideOwnerLeftAction(activeWithNonOwnerSeated, false)).toBe(
        OWNER_LEFT_ACTION.OWNER_AWAY,
      );
    });

    test('returns OWNER_AWAY when multiple non-owners are seated', () => {
      const room = {
        ...baseActiveRoom,
        seats: {
          0: { userId: 'owner-1', state: 'OCCUPIED', isMuted: false },
          1: { userId: 'user-2', state: 'OCCUPIED', isMuted: false },
          2: { userId: 'user-3', state: 'OCCUPIED', isMuted: false },
        },
      };
      expect(decideOwnerLeftAction(room, false)).toBe(OWNER_LEFT_ACTION.OWNER_AWAY);
    });

    test('returns OWNER_AWAY when only a non-owner is seated (owner not on a seat)', () => {
      // Owner has departed their seat but the room is still ACTIVE because
      // there are seated non-owners. This is a transient state during the
      // owner's normal leave flow — the lazy-reap or client-driven path
      // would normally have flipped state by now, but if we get here, the
      // safe action is the standard OWNER_AWAY transition.
      const room = {
        ...baseActiveRoom,
        seats: {
          0: { userId: null, state: 'EMPTY', isMuted: false },
          1: { userId: 'user-2', state: 'OCCUPIED', isMuted: false },
        },
      };
      expect(decideOwnerLeftAction(room, false)).toBe(OWNER_LEFT_ACTION.OWNER_AWAY);
    });
  });

  describe('owner-id normalization', () => {
    // hasNonOwnerSeated already normalises ownerId via String(); the decision
    // function must honour that so a numeric ownerId in Firestore doesn't
    // confuse the predicate.
    test('treats numeric ownerId vs string userId as the same identity (owner alone)', () => {
      const room = {
        ...baseActiveRoom,
        ownerId: 42,
        seats: {
          0: { userId: '42', state: 'OCCUPIED', isMuted: false },
        },
      };
      expect(decideOwnerLeftAction(room, false)).toBe(OWNER_LEFT_ACTION.CLOSE_IMMEDIATE);
    });

    test('treats string ownerId vs numeric userId as the same identity (owner alone)', () => {
      const room = {
        ...baseActiveRoom,
        ownerId: '42',
        seats: {
          0: { userId: 42, state: 'OCCUPIED', isMuted: false },
        },
      };
      expect(decideOwnerLeftAction(room, false)).toBe(OWNER_LEFT_ACTION.CLOSE_IMMEDIATE);
    });
  });
});

describe('applyOwnerLeftTx', () => {
  // applyOwnerLeftTx is the transactional applier — given an action decided
  // upstream, it issues the appropriate t.update call. Returning the
  // post-transition room shape mirrors reapStaleRoomTx so callers (txn
  // mutators) can read the new state without an extra t.get().

  let mockTx;
  let roomRef;
  const nowMs = 1700000000000;

  beforeEach(() => {
    mockTx = { update: jest.fn() };
    roomRef = { path: 'rooms/room-1' };
  });

  describe('NOOP', () => {
    test('does not call t.update', () => {
      applyOwnerLeftTx(mockTx, roomRef, baseActiveRoom, OWNER_LEFT_ACTION.NOOP, nowMs);
      expect(mockTx.update).not.toHaveBeenCalled();
    });

    test('returns the room unchanged', () => {
      const result = applyOwnerLeftTx(
        mockTx,
        roomRef,
        baseActiveRoom,
        OWNER_LEFT_ACTION.NOOP,
        nowMs,
      );
      expect(result).toEqual(baseActiveRoom);
    });
  });

  describe('OWNER_AWAY', () => {
    test('updates state to OWNER_AWAY and stamps ownerLeftAt', () => {
      applyOwnerLeftTx(
        mockTx,
        roomRef,
        activeWithNonOwnerSeated,
        OWNER_LEFT_ACTION.OWNER_AWAY,
        nowMs,
      );
      expect(mockTx.update).toHaveBeenCalledWith(roomRef, {
        state: 'OWNER_AWAY',
        ownerLeftAt: nowMs,
      });
    });

    test('does NOT touch seats or participants (still ACTIVE-shape data)', () => {
      applyOwnerLeftTx(
        mockTx,
        roomRef,
        activeWithNonOwnerSeated,
        OWNER_LEFT_ACTION.OWNER_AWAY,
        nowMs,
      );
      const updatePayload = mockTx.update.mock.calls[0][1];
      expect(updatePayload).not.toHaveProperty('seats');
      expect(updatePayload).not.toHaveProperty('participantIds');
      expect(updatePayload).not.toHaveProperty('closedAt');
    });

    test('returns the room with state and ownerLeftAt patched', () => {
      const result = applyOwnerLeftTx(
        mockTx,
        roomRef,
        activeWithNonOwnerSeated,
        OWNER_LEFT_ACTION.OWNER_AWAY,
        nowMs,
      );
      expect(result.state).toBe('OWNER_AWAY');
      expect(result.ownerLeftAt).toBe(nowMs);
      expect(result.seats).toEqual(activeWithNonOwnerSeated.seats);
    });
  });

  describe('CLOSE_IMMEDIATE', () => {
    test('updates room to the standard close payload (matches buildClosePayload)', () => {
      applyOwnerLeftTx(mockTx, roomRef, baseActiveRoom, OWNER_LEFT_ACTION.CLOSE_IMMEDIATE, nowMs);
      const expectedPayload = buildClosePayload(nowMs);
      expect(mockTx.update).toHaveBeenCalledWith(roomRef, expectedPayload);
    });

    test('payload includes ownerLeftAt: null (matches /close + lazy-reap contract)', () => {
      applyOwnerLeftTx(mockTx, roomRef, baseActiveRoom, OWNER_LEFT_ACTION.CLOSE_IMMEDIATE, nowMs);
      const updatePayload = mockTx.update.mock.calls[0][1];
      // Invariant: every close path must set ownerLeftAt: null so a closed
      // room never carries a stale OWNER_AWAY timestamp. This is the
      // PR #996 reviewer-Critical-finding contract.
      expect(updatePayload).toHaveProperty('ownerLeftAt', null);
    });

    test('returns the post-close room shape', () => {
      const result = applyOwnerLeftTx(
        mockTx,
        roomRef,
        baseActiveRoom,
        OWNER_LEFT_ACTION.CLOSE_IMMEDIATE,
        nowMs,
      );
      expect(result.state).toBe('CLOSED');
      expect(result.closedAt).toBe(nowMs);
      expect(result.ownerLeftAt).toBeNull();
      expect(result.participantIds).toEqual([]);
    });
  });

  describe('unknown action', () => {
    test('does not call t.update and returns the room unchanged', () => {
      const result = applyOwnerLeftTx(mockTx, roomRef, baseActiveRoom, 'BOGUS_ACTION', nowMs);
      expect(mockTx.update).not.toHaveBeenCalled();
      expect(result).toEqual(baseActiveRoom);
    });
  });
});

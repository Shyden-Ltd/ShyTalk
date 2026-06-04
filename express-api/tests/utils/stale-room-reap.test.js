const {
  STALE_ROOM_TIMEOUT_MS,
  STALE_ROOM_NO_HOLDOUTS_GRACE_MS,
  shouldReapStaleRoom,
  reapStaleRoomTx,
  buildClosePayload,
} = require('../../src/utils/stale-room-reap');

describe('shouldReapStaleRoom', () => {
  const baseRoom = {
    state: 'OWNER_AWAY',
    ownerId: 'owner-1',
    ownerLeftAt: 1700000000000,
    seats: {},
  };
  const wellPastTimeout = baseRoom.ownerLeftAt + STALE_ROOM_TIMEOUT_MS + 1000;
  const pastGrace = baseRoom.ownerLeftAt + STALE_ROOM_NO_HOLDOUTS_GRACE_MS + 1000;

  describe('state-machine preconditions', () => {
    test('returns false when room is null/undefined', () => {
      expect(shouldReapStaleRoom(null, wellPastTimeout)).toBe(false);
      expect(shouldReapStaleRoom(undefined, wellPastTimeout)).toBe(false);
    });

    test('returns false when state is ACTIVE', () => {
      expect(shouldReapStaleRoom({ ...baseRoom, state: 'ACTIVE' }, wellPastTimeout)).toBe(false);
    });

    test('returns false when state is CLOSED', () => {
      expect(shouldReapStaleRoom({ ...baseRoom, state: 'CLOSED' }, wellPastTimeout)).toBe(false);
    });

    test('returns false when ownerLeftAt is missing/zero', () => {
      expect(shouldReapStaleRoom({ ...baseRoom, ownerLeftAt: undefined }, wellPastTimeout)).toBe(
        false,
      );
      expect(shouldReapStaleRoom({ ...baseRoom, ownerLeftAt: null }, wellPastTimeout)).toBe(false);
      expect(shouldReapStaleRoom({ ...baseRoom, ownerLeftAt: 0 }, wellPastTimeout)).toBe(false);
    });
  });

  describe('owner-caller short-circuit', () => {
    test('returns false when callerId is the owner (returning), even past timeout', () => {
      expect(shouldReapStaleRoom(baseRoom, wellPastTimeout, 'owner-1')).toBe(false);
    });

    test('returns false for owner caller even with numeric/string-id mismatch', () => {
      const room = { ...baseRoom, ownerId: 42 };
      expect(shouldReapStaleRoom(room, wellPastTimeout, '42')).toBe(false);
      expect(shouldReapStaleRoom(room, wellPastTimeout, 42)).toBe(false);
    });

    test('returns true when callerId is a non-owner past timeout', () => {
      // Other user trying to mutate well after timeout — reap.
      expect(shouldReapStaleRoom(baseRoom, wellPastTimeout, 'other-1')).toBe(true);
    });

    test('returns true when callerId is null (system call, no caller)', () => {
      // No caller info — fall back to reap-by-state-only.
      expect(shouldReapStaleRoom(baseRoom, wellPastTimeout, null)).toBe(true);
    });
  });

  describe('no-holdouts branch (grace window)', () => {
    test('returns false when no holdouts and within grace window (owner can still return)', () => {
      // Room is OWNER_AWAY, no non-owner seated, but within the grace.
      // The owner-returned endpoint or a join-during-grace must still succeed.
      const justAfterOwnerLeft = baseRoom.ownerLeftAt + 1000;
      expect(shouldReapStaleRoom(baseRoom, justAfterOwnerLeft, 'other-1')).toBe(false);
    });

    test('returns true when no holdouts and past grace window', () => {
      expect(shouldReapStaleRoom(baseRoom, pastGrace, 'other-1')).toBe(true);
    });

    test('returns true at exactly ownerLeftAt + grace boundary (>=)', () => {
      // Predicate uses >= so AT grace boundary, returns true.
      const exactBoundary = baseRoom.ownerLeftAt + STALE_ROOM_NO_HOLDOUTS_GRACE_MS;
      expect(shouldReapStaleRoom(baseRoom, exactBoundary, 'other-1')).toBe(true);
    });

    test('returns false at just-before grace boundary', () => {
      const justBefore = baseRoom.ownerLeftAt + STALE_ROOM_NO_HOLDOUTS_GRACE_MS - 1;
      expect(shouldReapStaleRoom(baseRoom, justBefore, 'other-1')).toBe(false);
    });

    test('owner-seated stale record counts as "no holdouts" (matches cron)', () => {
      // Owner has a stale seat record but is the only seated user.
      const roomWithOwnerSeat = {
        ...baseRoom,
        seats: { 0: { userId: 'owner-1', state: 'OCCUPIED' } },
      };
      expect(shouldReapStaleRoom(roomWithOwnerSeat, pastGrace, 'other-1')).toBe(true);
    });
  });

  describe('holdouts branch (full timeout)', () => {
    test('returns false when non-owner seated and within timeout', () => {
      const room = {
        ...baseRoom,
        seats: { 1: { userId: 'other-1', state: 'OCCUPIED' } },
      };
      const withinTimeout = room.ownerLeftAt + STALE_ROOM_TIMEOUT_MS - 1;
      expect(shouldReapStaleRoom(room, withinTimeout, 'other-2')).toBe(false);
    });

    test('returns true when non-owner seated AND ownerLeftAt past timeout', () => {
      const room = {
        ...baseRoom,
        seats: { 1: { userId: 'other-1', state: 'OCCUPIED' } },
      };
      expect(shouldReapStaleRoom(room, wellPastTimeout, 'other-2')).toBe(true);
    });

    test('returns true at exactly ownerLeftAt + timeout (>=)', () => {
      const room = {
        ...baseRoom,
        seats: { 1: { userId: 'other-1', state: 'OCCUPIED' } },
      };
      const exactBoundary = room.ownerLeftAt + STALE_ROOM_TIMEOUT_MS;
      expect(shouldReapStaleRoom(room, exactBoundary, 'other-2')).toBe(true);
    });

    test('returns false at just-before timeout boundary', () => {
      const room = {
        ...baseRoom,
        seats: { 1: { userId: 'other-1', state: 'OCCUPIED' } },
      };
      const justBefore = room.ownerLeftAt + STALE_ROOM_TIMEOUT_MS - 1;
      expect(shouldReapStaleRoom(room, justBefore, 'other-2')).toBe(false);
    });
  });

  describe('type tolerance', () => {
    test('treats string ownerLeftAt as numeric (mirrors staleRooms cron)', () => {
      const room = {
        ...baseRoom,
        ownerLeftAt: String(baseRoom.ownerLeftAt),
        seats: { 1: { userId: 'other-1', state: 'OCCUPIED' } },
      };
      expect(shouldReapStaleRoom(room, wellPastTimeout, 'other-2')).toBe(true);
    });
  });
});

describe('buildClosePayload', () => {
  test('returns shape matching staleRooms.js + /close endpoint close payload', () => {
    const payload = buildClosePayload(1700000000000);

    expect(payload).toEqual({
      state: 'CLOSED',
      closedAt: 1700000000000,
      seats: expect.any(Object),
      participantIds: [],
      ownerLeftAt: null,
    });
  });

  test('clears ownerLeftAt to null (must match /close + cron payload)', () => {
    // Reaped rooms must not carry the stale OWNER_AWAY timestamp on a
    // CLOSED row — every other close path writes `ownerLeftAt: null`.
    const payload = buildClosePayload(0);
    expect(payload.ownerLeftAt).toBeNull();
  });

  test('emits all 8 seats as EMPTY', () => {
    const payload = buildClosePayload(0);

    expect(Object.keys(payload.seats)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7']);
    for (let i = 0; i < 8; i++) {
      expect(payload.seats[String(i)]).toEqual({
        userId: null,
        state: 'EMPTY',
        isMuted: false,
      });
    }
  });

  test('each seat is an independent object (no shared reference)', () => {
    const payload = buildClosePayload(0);
    // Mutating one seat must not leak into another.
    payload.seats['0'].userId = 'leaked';
    expect(payload.seats['1'].userId).toBeNull();
  });
});

describe('reapStaleRoomTx', () => {
  test('calls t.update with the close payload', () => {
    const mockUpdate = jest.fn();
    const t = { update: mockUpdate };
    const roomRef = { _id: 'roomRef' };
    const room = {
      state: 'OWNER_AWAY',
      ownerId: 'o',
      ownerLeftAt: 1000,
      seats: { 0: { userId: 'o', state: 'OCCUPIED' } },
      participantIds: ['o', 'p'],
    };

    reapStaleRoomTx(t, roomRef, room, 2000);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      roomRef,
      expect.objectContaining({
        state: 'CLOSED',
        closedAt: 2000,
        participantIds: [],
      }),
    );
  });

  test('returns the room shape merged with the close payload', () => {
    const t = { update: jest.fn() };
    const roomRef = {};
    const room = {
      state: 'OWNER_AWAY',
      ownerId: 'owner',
      ownerLeftAt: 1000,
      name: 'My room',
      seats: { 0: { userId: 'owner', state: 'OCCUPIED' } },
      participantIds: ['owner'],
    };

    const result = reapStaleRoomTx(t, roomRef, room, 5000);

    // Preserved fields from the input room
    expect(result.ownerId).toBe('owner');
    expect(result.name).toBe('My room');
    // Overwritten by the close payload
    expect(result.state).toBe('CLOSED');
    expect(result.closedAt).toBe(5000);
    expect(result.participantIds).toEqual([]);
    // ownerLeftAt is explicitly cleared (matches /close + cron payload).
    expect(result.ownerLeftAt).toBeNull();
  });
});

describe('STALE_ROOM_TIMEOUT_MS', () => {
  test('is 10 minutes (matches staleRooms cron tenMinutesAgo computation)', () => {
    expect(STALE_ROOM_TIMEOUT_MS).toBe(10 * 60 * 1000);
  });
});

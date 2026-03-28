/**
 * Tests for staleRooms cron job.
 *
 * Covers:
 * - Empty snapshot (no OWNER_AWAY rooms)
 * - Rooms with no ownerLeftAt timestamp (filtered out)
 * - Rooms with empty non-owner seats close immediately
 * - Rooms with seated non-owners wait for 10-minute timeout
 * - Rooms past 10-minute timeout close regardless of seat state
 * - Participant currentRoomId is cleared on close
 * - Rooms with no participantIds array
 * - Batch writing in chunks of 500
 * - Multiple rooms in a single run
 */

// --- Mocks ---

const mockBatchSet = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue(undefined);

const mockGet = jest.fn();
const mockDoc = jest.fn((path) => ({ path }));
const mockBatchFn = jest.fn(() => ({
  set: mockBatchSet,
  commit: mockBatchCommit,
}));

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collection: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: mockGet,
    doc: mockDoc,
    batch: mockBatchFn,
  },
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  fatal: jest.fn(),
}));

const staleRooms = require('../../src/cron/staleRooms');
const log = require('../../src/utils/log');

// --- Helpers ---

function makeEmptySeat() {
  return { userId: null, state: 'EMPTY', isMuted: false };
}

function makeOccupiedSeat(userId) {
  return { userId, state: 'OCCUPIED', isMuted: false };
}

function makeRoomDoc(id, overrides) {
  const data = {
    state: 'OWNER_AWAY',
    ownerId: 'owner1',
    ownerLeftAt: Date.now() - 1 * 60 * 1000, // 1 minute ago by default
    seats: {
      0: makeOccupiedSeat('owner1'),
      1: makeEmptySeat(),
      2: makeEmptySeat(),
      3: makeEmptySeat(),
      4: makeEmptySeat(),
      5: makeEmptySeat(),
      6: makeEmptySeat(),
      7: makeEmptySeat(),
    },
    participantIds: ['owner1'],
    ...overrides,
  };
  return {
    id,
    data: () => data,
  };
}

function mockSnapshot(docs) {
  mockGet.mockResolvedValue({
    empty: docs.length === 0,
    docs,
  });
}

// --- Tests ---

beforeEach(() => {
  jest.clearAllMocks();
});

describe('staleRooms cron', () => {
  test('returns early when snapshot is empty (no OWNER_AWAY rooms)', async () => {
    mockSnapshot([]);

    await staleRooms();

    expect(mockBatchFn).not.toHaveBeenCalled();
    expect(mockBatchSet).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
  });

  test('skips rooms with no ownerLeftAt', async () => {
    const room = makeRoomDoc('room-no-timestamp', {
      ownerLeftAt: null,
    });
    mockSnapshot([room]);

    await staleRooms();

    expect(mockBatchFn).not.toHaveBeenCalled();
    expect(mockBatchSet).not.toHaveBeenCalled();
  });

  test('skips rooms with ownerLeftAt = 0 (falsy)', async () => {
    const room = makeRoomDoc('room-zero', {
      ownerLeftAt: 0,
    });
    mockSnapshot([room]);

    await staleRooms();

    // ownerLeftAt of 0 is falsy, so filter returns false
    expect(mockBatchFn).not.toHaveBeenCalled();
  });

  test('closes OWNER_AWAY rooms with empty non-owner seats immediately', async () => {
    // Room where owner left only 1 minute ago, but all non-owner seats are empty
    const room = makeRoomDoc('room-empty', {
      ownerLeftAt: Date.now() - 1 * 60 * 1000, // Only 1 minute ago
    });
    mockSnapshot([room]);

    await staleRooms();

    // Should have created a batch and committed it
    expect(mockBatchFn).toHaveBeenCalled();
    expect(mockBatchSet).toHaveBeenCalled();

    // Verify the room was included in the batch write with state CLOSED
    const roomWrite = mockBatchSet.mock.calls.find(([ref]) => ref.path === 'rooms/room-empty');
    expect(roomWrite).toBeDefined();
    expect(roomWrite[1].state).toBe('CLOSED');
    expect(roomWrite[1].ownerLeftAt).toBeNull();
    expect(roomWrite[1].participantIds).toEqual([]);
    expect(roomWrite[1].seats).toBeDefined();
    // Verify all 8 seats are empty
    for (let i = 0; i < 8; i++) {
      expect(roomWrite[1].seats[String(i)].state).toBe('EMPTY');
      expect(roomWrite[1].seats[String(i)].userId).toBeNull();
    }
  });

  test('does NOT close OWNER_AWAY rooms that still have seated non-owners within 10 minutes', async () => {
    // Room where owner left 1 minute ago, but seat 1 has a non-owner
    const room = makeRoomDoc('room-occupied', {
      ownerLeftAt: Date.now() - 1 * 60 * 1000, // Only 1 minute ago
      seats: {
        0: makeOccupiedSeat('owner1'),
        1: makeOccupiedSeat('user2'), // Non-owner seated
        2: makeEmptySeat(),
        3: makeEmptySeat(),
        4: makeEmptySeat(),
        5: makeEmptySeat(),
        6: makeEmptySeat(),
        7: makeEmptySeat(),
      },
      participantIds: ['owner1', 'user2'],
    });
    mockSnapshot([room]);

    await staleRooms();

    // Should NOT have created a batch (no rooms to close)
    expect(mockBatchFn).not.toHaveBeenCalled();
    expect(mockBatchSet).not.toHaveBeenCalled();
  });

  test('closes OWNER_AWAY rooms after 10 minutes regardless of seat state', async () => {
    // Room where owner left 11 minutes ago with a non-owner still seated
    const room = makeRoomDoc('room-stale', {
      ownerLeftAt: Date.now() - 11 * 60 * 1000, // 11 minutes ago
      seats: {
        0: makeOccupiedSeat('owner1'),
        1: makeOccupiedSeat('user2'), // Non-owner seated
        2: makeEmptySeat(),
        3: makeEmptySeat(),
        4: makeEmptySeat(),
        5: makeEmptySeat(),
        6: makeEmptySeat(),
        7: makeEmptySeat(),
      },
      participantIds: ['owner1', 'user2'],
    });
    mockSnapshot([room]);

    await staleRooms();

    // Should have created a batch and committed it
    expect(mockBatchFn).toHaveBeenCalled();
    expect(mockBatchSet).toHaveBeenCalled();

    // Verify the room was included in the batch write with state CLOSED
    const roomWrite = mockBatchSet.mock.calls.find(([ref]) => ref.path === 'rooms/room-stale');
    expect(roomWrite).toBeDefined();
    expect(roomWrite[1].state).toBe('CLOSED');

    // Verify participant currentRoomId was cleared
    const ownerWrite = mockBatchSet.mock.calls.find(([ref]) => ref.path === 'users/owner1');
    expect(ownerWrite).toBeDefined();
    expect(ownerWrite[1].currentRoomId).toBeNull();

    const userWrite = mockBatchSet.mock.calls.find(([ref]) => ref.path === 'users/user2');
    expect(userWrite).toBeDefined();
    expect(userWrite[1].currentRoomId).toBeNull();
  });

  test('handles rooms with no seats property', async () => {
    const room = makeRoomDoc('room-no-seats', {
      ownerLeftAt: Date.now() - 1 * 60 * 1000,
      seats: undefined,
    });
    mockSnapshot([room]);

    await staleRooms();

    // hasNonOwnerSeated returns false when seats is undefined, so room closes immediately
    expect(mockBatchFn).toHaveBeenCalled();
    const roomWrite = mockBatchSet.mock.calls.find(([ref]) => ref.path === 'rooms/room-no-seats');
    expect(roomWrite).toBeDefined();
    expect(roomWrite[1].state).toBe('CLOSED');
  });

  test('handles rooms with empty participantIds array', async () => {
    const room = makeRoomDoc('room-no-participants', {
      ownerLeftAt: Date.now() - 11 * 60 * 1000,
      participantIds: [],
    });
    mockSnapshot([room]);

    await staleRooms();

    // Room should be closed, but no user writes
    expect(mockBatchFn).toHaveBeenCalled();
    const roomWrite = mockBatchSet.mock.calls.find(
      ([ref]) => ref.path === 'rooms/room-no-participants',
    );
    expect(roomWrite).toBeDefined();

    // Only one write: the room itself (no participant clears)
    expect(mockBatchSet).toHaveBeenCalledTimes(1);
  });

  test('handles rooms with no participantIds property', async () => {
    const room = makeRoomDoc('room-undef-participants', {
      ownerLeftAt: Date.now() - 11 * 60 * 1000,
      participantIds: undefined,
    });
    mockSnapshot([room]);

    await staleRooms();

    expect(mockBatchFn).toHaveBeenCalled();
    // Only the room write, no user writes since participantIds defaults to []
    expect(mockBatchSet).toHaveBeenCalledTimes(1);
  });

  test('closes multiple rooms in a single run', async () => {
    const room1 = makeRoomDoc('room-1', {
      ownerLeftAt: Date.now() - 1 * 60 * 1000, // No non-owner seated
      participantIds: ['owner1'],
    });
    const room2 = makeRoomDoc('room-2', {
      ownerLeftAt: Date.now() - 15 * 60 * 1000, // Past timeout
      participantIds: ['owner1', 'user3'],
    });
    mockSnapshot([room1, room2]);

    await staleRooms();

    const roomWrite1 = mockBatchSet.mock.calls.find(([ref]) => ref.path === 'rooms/room-1');
    const roomWrite2 = mockBatchSet.mock.calls.find(([ref]) => ref.path === 'rooms/room-2');
    expect(roomWrite1).toBeDefined();
    expect(roomWrite2).toBeDefined();
    expect(roomWrite1[1].state).toBe('CLOSED');
    expect(roomWrite2[1].state).toBe('CLOSED');

    expect(log.info).toHaveBeenCalledWith('cron', 'staleRooms: closed stale OWNER_AWAY rooms', {
      count: 2,
    });
  });

  test('uses merge:true when batch setting', async () => {
    const room = makeRoomDoc('room-merge', {
      ownerLeftAt: Date.now() - 1 * 60 * 1000,
      participantIds: ['owner1'],
    });
    mockSnapshot([room]);

    await staleRooms();

    // Verify all batch.set calls use { merge: true }
    for (const call of mockBatchSet.mock.calls) {
      expect(call[2]).toEqual({ merge: true });
    }
  });

  test('sets closedAt timestamp on closed rooms', async () => {
    const room = makeRoomDoc('room-ts', {
      ownerLeftAt: Date.now() - 1 * 60 * 1000,
    });
    mockSnapshot([room]);

    await staleRooms();

    const roomWrite = mockBatchSet.mock.calls.find(([ref]) => ref.path === 'rooms/room-ts');
    expect(roomWrite[1].closedAt).toBeDefined();
    expect(typeof roomWrite[1].closedAt).toBe('number');
  });

  test('filters mix of closeable and non-closeable rooms correctly', async () => {
    // Room 1: no non-owner seated, should close
    const room1 = makeRoomDoc('room-close', {
      ownerLeftAt: Date.now() - 2 * 60 * 1000,
    });
    // Room 2: non-owner seated, only 2 minutes - should NOT close
    const room2 = makeRoomDoc('room-keep', {
      ownerLeftAt: Date.now() - 2 * 60 * 1000,
      seats: {
        0: makeOccupiedSeat('owner1'),
        1: makeOccupiedSeat('user2'),
        2: makeEmptySeat(),
        3: makeEmptySeat(),
        4: makeEmptySeat(),
        5: makeEmptySeat(),
        6: makeEmptySeat(),
        7: makeEmptySeat(),
      },
      participantIds: ['owner1', 'user2'],
    });
    // Room 3: no ownerLeftAt - should NOT close
    const room3 = makeRoomDoc('room-no-ts', {
      ownerLeftAt: null,
    });
    mockSnapshot([room1, room2, room3]);

    await staleRooms();

    const closedRoom = mockBatchSet.mock.calls.find(([ref]) => ref.path === 'rooms/room-close');
    expect(closedRoom).toBeDefined();

    const keptRoom = mockBatchSet.mock.calls.find(([ref]) => ref.path === 'rooms/room-keep');
    expect(keptRoom).toBeUndefined();

    const noTsRoom = mockBatchSet.mock.calls.find(([ref]) => ref.path === 'rooms/room-no-ts');
    expect(noTsRoom).toBeUndefined();
  });

  test('owner-only occupied seat does not count as non-owner seated', async () => {
    // Only the owner is in seat 0, all others empty
    const room = makeRoomDoc('room-owner-only', {
      ownerLeftAt: Date.now() - 1 * 60 * 1000,
      seats: {
        0: makeOccupiedSeat('owner1'),
        1: makeEmptySeat(),
        2: makeEmptySeat(),
        3: makeEmptySeat(),
        4: makeEmptySeat(),
        5: makeEmptySeat(),
        6: makeEmptySeat(),
        7: makeEmptySeat(),
      },
    });
    mockSnapshot([room]);

    await staleRooms();

    // Should close immediately since only owner is seated
    const roomWrite = mockBatchSet.mock.calls.find(([ref]) => ref.path === 'rooms/room-owner-only');
    expect(roomWrite).toBeDefined();
    expect(roomWrite[1].state).toBe('CLOSED');
  });

  test('seat with userId but non-OCCUPIED state does not count as non-owner seated', async () => {
    // Seat has a userId but state is not OCCUPIED (e.g., 'SPEAKING' should not count)
    const room = makeRoomDoc('room-non-occupied', {
      ownerLeftAt: Date.now() - 1 * 60 * 1000,
      seats: {
        0: makeOccupiedSeat('owner1'),
        1: { userId: 'user2', state: 'SPEAKING', isMuted: false },
        2: makeEmptySeat(),
        3: makeEmptySeat(),
        4: makeEmptySeat(),
        5: makeEmptySeat(),
        6: makeEmptySeat(),
        7: makeEmptySeat(),
      },
    });
    mockSnapshot([room]);

    await staleRooms();

    // SPEAKING state !== OCCUPIED, so hasNonOwnerSeated returns false -> close immediately
    const roomWrite = mockBatchSet.mock.calls.find(
      ([ref]) => ref.path === 'rooms/room-non-occupied',
    );
    expect(roomWrite).toBeDefined();
    expect(roomWrite[1].state).toBe('CLOSED');
  });

  test('logs closure count', async () => {
    const room = makeRoomDoc('room-log', {
      ownerLeftAt: Date.now() - 1 * 60 * 1000,
    });
    mockSnapshot([room]);

    await staleRooms();

    expect(log.info).toHaveBeenCalledWith('cron', 'staleRooms: closed stale OWNER_AWAY rooms', {
      count: 1,
    });
  });
});

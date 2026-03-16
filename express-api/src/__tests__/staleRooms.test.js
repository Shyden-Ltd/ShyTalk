/**
 * Tests for staleRooms cron job.
 *
 * Verifies:
 * 1. Rooms with OWNER_AWAY and all non-owner seats empty close immediately
 * 2. Rooms with seated non-owners wait for the 10-minute timeout
 * 3. Rooms past the 10-minute timeout always close regardless of seat state
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

jest.mock('../utils/firebase', () => ({
  db: {
    collection: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: mockGet,
    doc: mockDoc,
    batch: mockBatchFn,
  },
}));

jest.mock('../utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  fatal: jest.fn(),
}));

const staleRooms = require('../cron/staleRooms');

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
  });

  test('does NOT close OWNER_AWAY rooms that still have seated non-owners', async () => {
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
    const userWrite = mockBatchSet.mock.calls.find(([ref]) => ref.path === 'users/user2');
    expect(userWrite).toBeDefined();
    expect(userWrite[1].currentRoomId).toBeNull();
  });
});

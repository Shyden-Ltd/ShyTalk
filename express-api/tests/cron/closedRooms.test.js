// ─── Firebase mock ───────────────────────────────────────────────

const mockBatchDelete = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();
const mockRoomDocDelete = jest.fn().mockResolvedValue();

// Subcollection get — messages and seatRequests
const mockSubGet = jest.fn();

// Top-level rooms query
const mockRoomsGet = jest.fn();

const mockDoc = jest.fn(() => ({
  delete: mockRoomDocDelete,
}));

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collection: jest.fn((path) => {
      if (path === 'rooms') {
        return {
          where: jest.fn(() => ({
            limit: jest.fn(() => ({
              get: mockRoomsGet,
            })),
          })),
        };
      }
      // Subcollections: rooms/{id}/messages, rooms/{id}/seatRequests
      return {
        limit: jest.fn(() => ({
          get: mockSubGet,
        })),
      };
    }),
    doc: (...args) => mockDoc(...args),
    batch: jest.fn(() => ({
      delete: mockBatchDelete,
      commit: mockBatchCommit,
    })),
  },
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const closedRooms = require('../../src/cron/closedRooms');

// Helper: timestamp more than 7 days ago
function oldTimestamp() {
  return Date.now() - 8 * 24 * 60 * 60 * 1000;
}

// Helper: timestamp less than 7 days ago (recent)
function recentTimestamp() {
  return Date.now() - 1 * 24 * 60 * 60 * 1000;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBatchCommit.mockResolvedValue();
  mockRoomDocDelete.mockResolvedValue();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('closedRooms cron', () => {
  test('does nothing when collection is empty', async () => {
    mockRoomsGet.mockResolvedValue({ empty: true, docs: [] });

    await closedRooms();

    expect(mockBatchDelete).not.toHaveBeenCalled();
    expect(mockRoomDocDelete).not.toHaveBeenCalled();
  });

  test('does nothing when all closed rooms are newer than 7 days', async () => {
    mockRoomsGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'room-recent',
          data: () => ({ state: 'CLOSED', closedAt: recentTimestamp() }),
        },
      ],
    });

    await closedRooms();

    expect(mockBatchDelete).not.toHaveBeenCalled();
    expect(mockRoomDocDelete).not.toHaveBeenCalled();
  });

  test('deletes old closed rooms and their subcollections', async () => {
    mockRoomsGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'room-old',
          data: () => ({ state: 'CLOSED', closedAt: oldTimestamp() }),
        },
      ],
    });

    // messages subcollection: one page with 2 docs, then empty
    const msgRef1 = { ref: { path: 'rooms/room-old/messages/msg1' } };
    const msgRef2 = { ref: { path: 'rooms/room-old/messages/msg2' } };
    const seatRef1 = { ref: { path: 'rooms/room-old/seatRequests/seat1' } };

    mockSubGet
      // First call: messages page 1 (< 500, so loop ends)
      .mockResolvedValueOnce({ empty: false, size: 2, docs: [msgRef1, msgRef2] })
      // Second call: seatRequests page 1 (< 500, so loop ends)
      .mockResolvedValueOnce({ empty: false, size: 1, docs: [seatRef1] });

    await closedRooms();

    // batch.delete called for 2 messages + 1 seat = 3 times
    expect(mockBatchDelete).toHaveBeenCalledTimes(3);
    expect(mockBatchCommit).toHaveBeenCalledTimes(2); // once for messages, once for seatRequests
    // room doc itself deleted
    expect(mockRoomDocDelete).toHaveBeenCalledTimes(1);
    expect(mockDoc).toHaveBeenCalledWith('rooms/room-old');
  });

  test('handles rooms with no messages or seat requests gracefully', async () => {
    mockRoomsGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'room-empty',
          data: () => ({ state: 'CLOSED', closedAt: oldTimestamp() }),
        },
      ],
    });

    // Both subcollections return empty on first call
    mockSubGet
      .mockResolvedValueOnce({ empty: true, size: 0, docs: [] }) // messages
      .mockResolvedValueOnce({ empty: true, size: 0, docs: [] }); // seatRequests

    await closedRooms();

    expect(mockBatchDelete).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
    expect(mockRoomDocDelete).toHaveBeenCalledTimes(1);
  });

  test('continues to next room when one room deletion fails', async () => {
    mockRoomsGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'room-error',
          data: () => ({ state: 'CLOSED', closedAt: oldTimestamp() }),
        },
        {
          id: 'room-ok',
          data: () => ({ state: 'CLOSED', closedAt: oldTimestamp() }),
        },
      ],
    });

    // room-error: messages subcollection throws
    mockSubGet
      .mockRejectedValueOnce(new Error('Firestore error')) // messages for room-error
      // room-ok: both subcollections empty
      .mockResolvedValueOnce({ empty: true, size: 0, docs: [] })
      .mockResolvedValueOnce({ empty: true, size: 0, docs: [] });

    await expect(closedRooms()).resolves.not.toThrow();

    // room-ok should still have its doc deleted despite room-error failing
    expect(mockRoomDocDelete).toHaveBeenCalledTimes(1);
    expect(mockDoc).toHaveBeenCalledWith('rooms/room-ok');
  });

  test('paginates messages when a room has exactly 500 messages', async () => {
    mockRoomsGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'room-big',
          data: () => ({ state: 'CLOSED', closedAt: oldTimestamp() }),
        },
      ],
    });

    // Create 500 fake message refs
    const msgDocs = Array.from({ length: 500 }, (_, i) => ({
      ref: { path: `rooms/room-big/messages/msg${i}` },
    }));

    mockSubGet
      // messages page 1: 500 docs → triggers another page fetch
      .mockResolvedValueOnce({ empty: false, size: 500, docs: msgDocs })
      // messages page 2: empty → exits loop
      .mockResolvedValueOnce({ empty: true, size: 0, docs: [] })
      // seatRequests: empty
      .mockResolvedValueOnce({ empty: true, size: 0, docs: [] });

    await closedRooms();

    // Two batch commits for messages (page1 + page2 terminates the do-while)
    // Actually: page1 commits (500 deletes), page2 is empty so break exits
    expect(mockBatchCommit).toHaveBeenCalledTimes(1); // only the 500-doc page commits
    expect(mockBatchDelete).toHaveBeenCalledTimes(500);
    expect(mockRoomDocDelete).toHaveBeenCalledTimes(1);
  });

  test('skips rooms without a closedAt timestamp', async () => {
    mockRoomsGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'room-no-date',
          data: () => ({ state: 'CLOSED' }), // no closedAt
        },
      ],
    });

    await closedRooms();

    expect(mockRoomDocDelete).not.toHaveBeenCalled();
  });

  test('processes up to 20 rooms per run even if query returns more', async () => {
    // Build 25 old closed rooms
    const docs = Array.from({ length: 25 }, (_, i) => ({
      id: `room-${i}`,
      data: () => ({ state: 'CLOSED', closedAt: oldTimestamp() }),
    }));

    mockRoomsGet.mockResolvedValue({ empty: false, docs });

    // All subcollections are empty
    mockSubGet.mockResolvedValue({ empty: true, size: 0, docs: [] });

    await closedRooms();

    // Should only delete 20 rooms (the slice(0,20) cap)
    expect(mockRoomDocDelete).toHaveBeenCalledTimes(20);
  });
});

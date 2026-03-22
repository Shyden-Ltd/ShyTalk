// ─── Firebase mock ───────────────────────────────────────────────

const mockBatchUpdate = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();
const mockCollectionGet = jest.fn();

const mockWhere = jest.fn(() => ({
  where: mockWhere,
  get: mockCollectionGet,
}));

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collection: jest.fn(() => ({
      where: (...args) => {
        mockWhere(...args);
        return {
          where: (...args2) => {
            mockWhere(...args2);
            return { limit: () => ({ get: mockCollectionGet }), get: mockCollectionGet };
          },
          get: mockCollectionGet,
        };
      },
    })),
    batch: jest.fn(() => ({
      update: mockBatchUpdate,
      commit: mockBatchCommit,
    })),
  },
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const expireTempIds = require('../../src/cron/expireTempIds');

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('expireTempIds', () => {
  test('expires temp IDs past their expiry', async () => {
    const pastExpiry = Date.now() - 86400000;
    const docRef1 = { path: 'users/u1' };
    const docRef2 = { path: 'users/u2' };

    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      size: 2,
      docs: [
        { ref: docRef1, data: () => ({ tempUniqueId: 11111111, tempUniqueIdExpiry: pastExpiry }) },
        {
          ref: docRef2,
          data: () => ({ tempUniqueId: 22222222, tempUniqueIdExpiry: pastExpiry - 100000 }),
        },
      ],
    });

    await expireTempIds();

    expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
    expect(mockBatchUpdate).toHaveBeenCalledWith(docRef1, {
      tempUniqueId: null,
      tempUniqueIdExpiry: null,
    });
    expect(mockBatchUpdate).toHaveBeenCalledWith(docRef2, {
      tempUniqueId: null,
      tempUniqueIdExpiry: null,
    });
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  test('does not expire future temp IDs', async () => {
    // Query returns empty because Firestore filters server-side
    mockCollectionGet.mockResolvedValueOnce({
      empty: true,
      size: 0,
      docs: [],
    });

    await expireTempIds();

    expect(mockBatchUpdate).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  test('handles empty results gracefully', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: true,
      size: 0,
      docs: [],
    });

    await expireTempIds();

    expect(mockBatchUpdate).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });
});

// ─── Firebase mock ───────────────────────────────────────────────

const mockBatchUpdate = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();

const mockUsersGet = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collection: jest.fn(() => ({
      where: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(() => ({
            get: mockUsersGet,
          })),
        })),
      })),
    })),
    doc: jest.fn((path) => ({ path })),
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

const subscriptions = require('../../src/cron/subscriptions');

// Helper: timestamp in the past (expired)
function pastTimestamp() {
  return Date.now() - 24 * 60 * 60 * 1000; // 1 day ago
}

// Helper: timestamp in the future (not expired)
function _futureTimestamp() {
  return Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days from now
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBatchCommit.mockResolvedValue();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('subscriptions cron', () => {
  test('does nothing when collection is empty', async () => {
    mockUsersGet.mockResolvedValue({ empty: true, docs: [] });

    await subscriptions();

    expect(mockBatchUpdate).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  test('expires users with past superShyExpiry', async () => {
    mockUsersGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'user-1',
          data: () => ({
            isSuperShy: true,
            superShyExpiry: pastTimestamp(),
            superShyTier: 'monthly',
          }),
        },
      ],
    });

    await subscriptions();

    expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
    expect(mockBatchUpdate).toHaveBeenCalledWith(expect.anything(), {
      isSuperShy: false,
      superShyExpiry: null,
      superShyTier: null,
    });
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  test('expires multiple users in the same batch', async () => {
    mockUsersGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'user-1',
          data: () => ({
            isSuperShy: true,
            superShyExpiry: pastTimestamp(),
            superShyTier: 'monthly',
          }),
        },
        {
          id: 'user-2',
          data: () => ({
            isSuperShy: true,
            superShyExpiry: pastTimestamp(),
            superShyTier: 'annual',
          }),
        },
      ],
    });

    await subscriptions();

    expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  test('skips lifetime subscribers even if past expiry', async () => {
    mockUsersGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'user-lifetime',
          data: () => ({
            isSuperShy: true,
            superShyExpiry: pastTimestamp(),
            superShyTier: 'lifetime', // must be skipped
          }),
        },
      ],
    });

    await subscriptions();

    expect(mockBatchUpdate).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  test('expires non-lifetime users while keeping lifetime users', async () => {
    mockUsersGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'user-monthly',
          data: () => ({
            isSuperShy: true,
            superShyExpiry: pastTimestamp(),
            superShyTier: 'monthly',
          }),
        },
        {
          id: 'user-lifetime',
          data: () => ({
            isSuperShy: true,
            superShyExpiry: pastTimestamp(),
            superShyTier: 'lifetime',
          }),
        },
      ],
    });

    await subscriptions();

    // Only the monthly user should be expired
    expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  test('does nothing when all matched users are lifetime subscribers', async () => {
    mockUsersGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'user-a',
          data: () => ({
            isSuperShy: true,
            superShyExpiry: pastTimestamp(),
            superShyTier: 'lifetime',
          }),
        },
        {
          id: 'user-b',
          data: () => ({
            isSuperShy: true,
            superShyExpiry: pastTimestamp(),
            superShyTier: 'lifetime',
          }),
        },
      ],
    });

    await subscriptions();

    expect(mockBatchUpdate).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  test('sets isSuperShy=false, superShyExpiry=null, superShyTier=null on expired user', async () => {
    mockUsersGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'user-expired',
          data: () => ({
            isSuperShy: true,
            superShyExpiry: pastTimestamp(),
            superShyTier: 'monthly',
          }),
        },
      ],
    });

    await subscriptions();

    expect(mockBatchUpdate).toHaveBeenCalledWith(expect.anything(), {
      isSuperShy: false,
      superShyExpiry: null,
      superShyTier: null,
    });
  });

  test('processes users in batches of 500', async () => {
    // Build 501 expired non-lifetime users to trigger two batch commits
    const docs = Array.from({ length: 501 }, (_, i) => ({
      id: `user-${i}`,
      data: () => ({ isSuperShy: true, superShyExpiry: pastTimestamp(), superShyTier: 'monthly' }),
    }));

    mockUsersGet.mockResolvedValue({ empty: false, docs });

    await subscriptions();

    // 501 updates split into chunk of 500 + chunk of 1
    expect(mockBatchUpdate).toHaveBeenCalledTimes(501);
    expect(mockBatchCommit).toHaveBeenCalledTimes(2);
  });

  test('resolves without throwing when Firestore batch commit succeeds', async () => {
    mockUsersGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'user-ok',
          data: () => ({
            isSuperShy: true,
            superShyExpiry: pastTimestamp(),
            superShyTier: 'annual',
          }),
        },
      ],
    });
    mockBatchCommit.mockResolvedValue();

    await expect(subscriptions()).resolves.not.toThrow();
  });
});

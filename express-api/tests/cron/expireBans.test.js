// ─── Firebase mock ───────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockCollectionGet = jest.fn();
const mockBatchDelete = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();

// Query chain supports `.where(...).limit(N).get()` for the cron's
// CRON_LIMIT cap. The chain returns the same `mockCollectionGet`
// regardless of the limit value, so existing test expectations still
// hold.
const mockLimit = jest.fn(() => ({ get: mockCollectionGet }));
const mockWhere = jest.fn(() => ({
  get: mockCollectionGet,
  limit: mockLimit,
}));

const mockCollection = jest.fn(() => ({
  where: (...args) => {
    mockWhere(...args);
    return { get: mockCollectionGet, limit: mockLimit };
  },
}));

const mockDoc = jest.fn(() => ({
  get: mockDocGet,
}));

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collection: (...args) => mockCollection(...args),
    doc: (...args) => mockDoc(...args),
    batch: jest.fn(() => ({
      delete: mockBatchDelete,
      commit: mockBatchCommit,
    })),
  },
}));

// Mock FCM utility
const mockSendFcmToTokens = jest.fn().mockResolvedValue([]);
const mockCleanupInvalidTokens = jest.fn().mockResolvedValue();
jest.mock('../../src/utils/fcm', () => ({
  sendFcmToTokens: (...args) => mockSendFcmToTokens(...args),
  cleanupInvalidTokens: (...args) => mockCleanupInvalidTokens(...args),
}));

const expireBans = require('../../src/cron/expireBans');

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('expireBans', () => {
  test('removes expired bans via batch', async () => {
    const pastExpiry = new Date(Date.now() - 86400000).toISOString();

    // deviceBans query
    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'dev1',
          data: () => ({ expiresAt: pastExpiry, reason: 'old' }),
          ref: { path: 'deviceBans/dev1' },
        },
      ],
    });

    // networkBans query
    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'net1',
          data: () => ({ expiresAt: pastExpiry, reason: 'old ip' }),
          ref: { path: 'networkBans/net1' },
        },
      ],
    });

    // alertConfig/settings
    mockDocGet.mockResolvedValueOnce({ exists: false });

    await expireBans();

    expect(mockBatchDelete).toHaveBeenCalledTimes(2);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  test('skips non-expired bans', async () => {
    const futureExpiry = new Date(Date.now() + 86400000).toISOString();

    // deviceBans — not expired
    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'dev1',
          data: () => ({ expiresAt: futureExpiry, reason: 'active' }),
          ref: { path: 'deviceBans/dev1' },
        },
      ],
    });

    // networkBans — not expired
    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'net1',
          data: () => ({ expiresAt: futureExpiry, reason: 'active ip' }),
          ref: { path: 'networkBans/net1' },
        },
      ],
    });

    await expireBans();

    expect(mockBatchDelete).not.toHaveBeenCalled();
  });

  test('handles empty collections', async () => {
    mockCollectionGet.mockResolvedValueOnce({ docs: [] });
    mockCollectionGet.mockResolvedValueOnce({ docs: [] });

    await expireBans();

    expect(mockBatchDelete).not.toHaveBeenCalled();
  });

  test('sends FCM notification via shared utility on expiry', async () => {
    const pastExpiry = new Date(Date.now() - 86400000).toISOString();

    // deviceBans — one expired
    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'dev1',
          data: () => ({ expiresAt: pastExpiry, reason: 'old' }),
          ref: { path: 'deviceBans/dev1' },
        },
      ],
    });

    // networkBans — empty
    mockCollectionGet.mockResolvedValueOnce({ docs: [] });

    // alertConfig/settings — has recipients
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ fcmRecipientUserIds: ['adminUser1'] }),
    });

    // users/adminUser1 — has FCM tokens
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ fcmTokens: ['token-abc', 'token-def'] }),
    });

    await expireBans();

    expect(mockBatchDelete).toHaveBeenCalledTimes(1);
    expect(mockSendFcmToTokens).toHaveBeenCalledWith(
      ['token-abc', 'token-def'],
      expect.objectContaining({
        type: 'admin_notification',
        title: 'Bans Expired',
      }),
    );
  });

  test('skips FCM when alertConfig has empty fcmRecipientUserIds', async () => {
    const pastExpiry = new Date(Date.now() - 86400000).toISOString();

    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'dev1',
          data: () => ({ expiresAt: pastExpiry, reason: 'old' }),
          ref: { path: 'deviceBans/dev1' },
        },
      ],
    });
    mockCollectionGet.mockResolvedValueOnce({ docs: [] });

    // alertConfig exists but empty recipients
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ fcmRecipientUserIds: [] }),
    });

    await expireBans();

    expect(mockBatchDelete).toHaveBeenCalledTimes(1);
    expect(mockSendFcmToTokens).not.toHaveBeenCalled();
  });

  test('skips FCM for recipient user that does not exist', async () => {
    const pastExpiry = new Date(Date.now() - 86400000).toISOString();

    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'dev1',
          data: () => ({ expiresAt: pastExpiry, reason: 'old' }),
          ref: { path: 'deviceBans/dev1' },
        },
      ],
    });
    mockCollectionGet.mockResolvedValueOnce({ docs: [] });

    // alertConfig with one recipient
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ fcmRecipientUserIds: ['ghost-user'] }),
    });

    // user does not exist
    mockDocGet.mockResolvedValueOnce({ exists: false });

    await expireBans();

    expect(mockSendFcmToTokens).not.toHaveBeenCalled();
  });

  test('skips FCM for recipient user with empty fcmTokens', async () => {
    const pastExpiry = new Date(Date.now() - 86400000).toISOString();

    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'dev1',
          data: () => ({ expiresAt: pastExpiry, reason: 'old' }),
          ref: { path: 'deviceBans/dev1' },
        },
      ],
    });
    mockCollectionGet.mockResolvedValueOnce({ docs: [] });

    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ fcmRecipientUserIds: ['admin1'] }),
    });

    // user exists but has no FCM tokens
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ fcmTokens: [] }),
    });

    await expireBans();

    expect(mockSendFcmToTokens).not.toHaveBeenCalled();
  });

  test('skips FCM for recipient user with no fcmTokens field at all', async () => {
    const pastExpiry = new Date(Date.now() - 86400000).toISOString();

    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'dev1',
          data: () => ({ expiresAt: pastExpiry, reason: 'old' }),
          ref: { path: 'deviceBans/dev1' },
        },
      ],
    });
    mockCollectionGet.mockResolvedValueOnce({ docs: [] });

    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ fcmRecipientUserIds: ['admin1'] }),
    });

    // user exists but fcmTokens is undefined
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({}),
    });

    await expireBans();

    expect(mockSendFcmToTokens).not.toHaveBeenCalled();
  });

  test('sends FCM to multiple recipients', async () => {
    const pastExpiry = new Date(Date.now() - 86400000).toISOString();

    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'dev1',
          data: () => ({ expiresAt: pastExpiry, reason: 'old' }),
          ref: { path: 'deviceBans/dev1' },
        },
      ],
    });
    mockCollectionGet.mockResolvedValueOnce({ docs: [] });

    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ fcmRecipientUserIds: ['admin1', 'admin2'] }),
    });

    // admin1 has tokens
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ fcmTokens: ['token-a'] }),
    });

    // admin2 has tokens
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ fcmTokens: ['token-b'] }),
    });

    await expireBans();

    expect(mockSendFcmToTokens).toHaveBeenCalledTimes(2);
    expect(mockCleanupInvalidTokens).toHaveBeenCalledTimes(2);
  });

  test('handles FCM notification error gracefully', async () => {
    const pastExpiry = new Date(Date.now() - 86400000).toISOString();

    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'dev1',
          data: () => ({ expiresAt: pastExpiry, reason: 'old' }),
          ref: { path: 'deviceBans/dev1' },
        },
      ],
    });
    mockCollectionGet.mockResolvedValueOnce({ docs: [] });

    // alertConfig fetch throws
    mockDocGet.mockRejectedValueOnce(new Error('FCM service down'));

    // Should not throw — error is caught internally
    await expect(expireBans()).resolves.not.toThrow();
    expect(mockBatchDelete).toHaveBeenCalledTimes(1);
  });

  test('handles alertConfig with missing fcmRecipientUserIds field', async () => {
    const pastExpiry = new Date(Date.now() - 86400000).toISOString();

    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'dev1',
          data: () => ({ expiresAt: pastExpiry, reason: 'old' }),
          ref: { path: 'deviceBans/dev1' },
        },
      ],
    });
    mockCollectionGet.mockResolvedValueOnce({ docs: [] });

    // alertConfig exists but has no fcmRecipientUserIds field
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({}),
    });

    await expireBans();

    expect(mockSendFcmToTokens).not.toHaveBeenCalled();
  });

  test('batches deletes when more than 500 expired bans', async () => {
    const pastExpiry = new Date(Date.now() - 86400000).toISOString();

    // 600 expired device bans
    const deviceDocs = Array.from({ length: 600 }, (_, i) => ({
      id: `dev${i}`,
      data: () => ({ expiresAt: pastExpiry, reason: 'old' }),
      ref: { path: `deviceBans/dev${i}` },
    }));

    mockCollectionGet.mockResolvedValueOnce({ docs: deviceDocs });
    mockCollectionGet.mockResolvedValueOnce({ docs: [] });

    // No alert config
    mockDocGet.mockResolvedValueOnce({ exists: false });

    await expireBans();

    // Should have 2 batches: 500 + 100
    expect(mockBatchCommit).toHaveBeenCalledTimes(2);
    expect(mockBatchDelete).toHaveBeenCalledTimes(600);
  });

  test('cleans up invalid FCM tokens returned by sendFcmToTokens', async () => {
    const pastExpiry = new Date(Date.now() - 86400000).toISOString();

    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'dev1',
          data: () => ({ expiresAt: pastExpiry, reason: 'old' }),
          ref: { path: 'deviceBans/dev1' },
        },
      ],
    });
    mockCollectionGet.mockResolvedValueOnce({ docs: [] });

    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ fcmRecipientUserIds: ['admin1'] }),
    });

    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ fcmTokens: ['valid-token', 'invalid-token'] }),
    });

    // sendFcmToTokens returns invalid tokens
    mockSendFcmToTokens.mockResolvedValueOnce(['invalid-token']);

    await expireBans();

    expect(mockCleanupInvalidTokens).toHaveBeenCalledWith(['invalid-token'], 'admin1');
  });

  test('logs truncation warning when query hits CRON_LIMIT (500)', async () => {
    const log = require('../../src/utils/log');
    const warnSpy = jest.spyOn(log, 'warn').mockImplementation(() => {});

    // 500 device bans (= CRON_LIMIT) — none expired so no batch work
    const futureExpiry = new Date(Date.now() + 86400000).toISOString();
    const fullPage = Array.from({ length: 500 }, (_, i) => ({
      id: `dev${i}`,
      data: () => ({ expiresAt: futureExpiry }),
      ref: { path: `deviceBans/dev${i}` },
    }));
    mockCollectionGet.mockResolvedValueOnce({ docs: fullPage, size: 500 });
    mockCollectionGet.mockResolvedValueOnce({ docs: [], size: 0 });

    await expireBans();

    expect(warnSpy).toHaveBeenCalledWith(
      'cron',
      expect.stringContaining('deviceBans hit CRON_LIMIT'),
      expect.objectContaining({ limit: 500 }),
    );

    warnSpy.mockRestore();
  });

  test('logs truncation warning on networkBans hitting CRON_LIMIT', async () => {
    const log = require('../../src/utils/log');
    const warnSpy = jest.spyOn(log, 'warn').mockImplementation(() => {});

    const futureExpiry = new Date(Date.now() + 86400000).toISOString();
    mockCollectionGet.mockResolvedValueOnce({ docs: [], size: 0 });
    const fullPage = Array.from({ length: 500 }, (_, i) => ({
      id: `net${i}`,
      data: () => ({ expiresAt: futureExpiry }),
      ref: { path: `networkBans/net${i}` },
    }));
    mockCollectionGet.mockResolvedValueOnce({ docs: fullPage, size: 500 });

    await expireBans();

    expect(warnSpy).toHaveBeenCalledWith(
      'cron',
      expect.stringContaining('networkBans hit CRON_LIMIT'),
      expect.objectContaining({ limit: 500 }),
    );

    warnSpy.mockRestore();
  });
});

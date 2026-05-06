/**
 * Tests for expireDataExports cron job.
 *
 * Covers:
 * - Deletes R2 objects under exports/ older than 48 hours
 * - Updates Firestore user docs to mark export as expired
 * - Handles empty query (no expired exports)
 * - Handles R2 deletion failure gracefully
 * - Does not delete non-expired exports
 */

const mockDocUpdate = jest.fn().mockResolvedValue();
const mockCollectionGet = jest.fn();
const mockListObjects = jest.fn().mockResolvedValue([]);
const mockDeleteObjects = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      update: (...args) => mockDocUpdate(path, ...args),
    })),
    collection: jest.fn(() => {
      // Chain supports `.where().where().limit().get()` for the cron's
      // CRON_LIMIT cap. limit returns the same chain so further calls
      // (and .get()) work uniformly.
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: mockCollectionGet,
      };
      return chain;
    }),
  },
}));

jest.mock('../../src/utils/r2', () => ({
  listObjects: (...args) => mockListObjects(...args),
  deleteObjects: (...args) => mockDeleteObjects(...args),
  listObjectsWithMetadata: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const log = require('../../src/utils/log');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('expireDataExports cron', () => {
  let expireDataExports;

  beforeEach(() => {
    expireDataExports = require('../../src/cron/expireDataExports');
  });

  test('deletes expired export R2 objects', async () => {
    const expiredUser = {
      id: '10000001',
      data: () => ({
        dataExportStatus: 'ready',
        dataExportR2Key: 'exports/10000001/gen-id.zip',
        dataExportExpiresAt: Date.now() - 3600000, // 1 hour ago
      }),
    };
    mockCollectionGet.mockResolvedValueOnce({
      docs: [expiredUser],
      empty: false,
    });

    await expireDataExports();

    expect(mockDeleteObjects).toHaveBeenCalledWith(['exports/10000001/gen-id.zip']);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.stringContaining('users/10000001'),
      expect.objectContaining({
        dataExportStatus: 'expired',
      }),
    );
  });

  test('handles no expired exports', async () => {
    mockCollectionGet.mockResolvedValueOnce({ docs: [], empty: true });

    await expireDataExports();

    expect(mockDeleteObjects).not.toHaveBeenCalled();
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('handles R2 deletion failure gracefully', async () => {
    const expiredUser = {
      id: '10000001',
      data: () => ({
        dataExportStatus: 'ready',
        dataExportR2Key: 'exports/10000001/gen-id.zip',
        dataExportExpiresAt: Date.now() - 3600000,
      }),
    };
    mockCollectionGet.mockResolvedValueOnce({
      docs: [expiredUser],
      empty: false,
    });
    mockDeleteObjects.mockRejectedValueOnce(new Error('R2 down'));

    await expireDataExports();

    // Should log error but not crash
    expect(log.error).toHaveBeenCalled();
  });

  test('does not delete non-expired exports', async () => {
    const activeUser = {
      id: '10000002',
      data: () => ({
        dataExportStatus: 'ready',
        dataExportR2Key: 'exports/10000002/gen-id.zip',
        dataExportExpiresAt: Date.now() + 24 * 3600000, // 24 hours from now
      }),
    };
    mockCollectionGet.mockResolvedValueOnce({
      docs: [activeUser],
      empty: false,
    });

    await expireDataExports();

    // Should not delete active exports
    expect(mockDeleteObjects).not.toHaveBeenCalled();
  });

  test('logs truncation warning when query hits CRON_LIMIT (500)', async () => {
    // All 500 docs are not-yet-expired (future expiresAt), so the loop hits
    // `continue` for every one — keeps the test fast while still tripping
    // the `size === CRON_LIMIT` truncation branch.
    const futureExpiry = Date.now() + 24 * 3600000;
    const fullPage = Array.from({ length: 500 }, (_, i) => ({
      id: `1000${String(i).padStart(4, '0')}`,
      data: () => ({
        dataExportStatus: 'ready',
        dataExportR2Key: `exports/1000${String(i).padStart(4, '0')}/gen.zip`,
        dataExportExpiresAt: futureExpiry,
      }),
    }));
    mockCollectionGet.mockResolvedValueOnce({
      docs: fullPage,
      size: 500,
      empty: false,
    });

    await expireDataExports();

    expect(log.warn).toHaveBeenCalledWith(
      'cron',
      expect.stringContaining('hit CRON_LIMIT'),
      expect.objectContaining({ limit: 500 }),
    );
    // No deletions because all docs are not-yet-expired
    expect(mockDeleteObjects).not.toHaveBeenCalled();
  });
});

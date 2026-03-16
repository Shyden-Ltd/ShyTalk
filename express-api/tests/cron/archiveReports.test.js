/**
 * Tests for cron/archiveReports.js
 *
 * archiveReports():
 * - Queries 'reports' collection for resolved docs older than 6 months
 * - Copies each to 'reportsArchive/{id}', deletes original from 'reports'
 * - Processes in batches of 250 (each doc = 2 ops: set + delete)
 * - Skips pending reports (they are not returned by the Firestore query)
 * - Does nothing when the collection is empty
 */

// ─── Firebase mock ────────────────────────────────────────────────

const mockBatchSet = jest.fn();
const mockBatchDelete = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();

const makeDocRef = (path) => ({ _path: path });

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collection: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn(),
    })),
    doc: jest.fn((path) => makeDocRef(path)),
    batch: jest.fn(() => ({
      set: mockBatchSet,
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

const { db } = require('../../src/utils/firebase');
const log = require('../../src/utils/log');
const archiveReports = require('../../src/cron/archiveReports');

// ─── Helpers ─────────────────────────────────────────────────────

function makeReportDoc(id, overrides = {}) {
  return {
    id,
    data: () => ({
      reportedUserId: 'user-abc',
      reporterId: 'user-xyz',
      reason: 'spam',
      status: 'resolved',
      resolvedAt: Date.now() - 7 * 30 * 24 * 60 * 60 * 1000, // 7 months ago
      ...overrides,
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBatchCommit.mockResolvedValue();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('archiveReports', () => {
  describe('when there are no resolved reports older than 6 months', () => {
    it('does not create any batch operations', async () => {
      db.collection.mockReturnValueOnce({
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      });

      await archiveReports();

      expect(mockBatchSet).not.toHaveBeenCalled();
      expect(mockBatchDelete).not.toHaveBeenCalled();
      expect(mockBatchCommit).not.toHaveBeenCalled();
    });

    it('does not log an info message when snapshot is empty', async () => {
      db.collection.mockReturnValueOnce({
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      });

      await archiveReports();

      expect(log.info).not.toHaveBeenCalled();
    });
  });

  describe('when resolved reports older than threshold exist', () => {
    it('copies each report to reportsArchive collection', async () => {
      const doc1 = makeReportDoc('report-1');
      const doc2 = makeReportDoc('report-2');

      db.collection.mockReturnValueOnce({
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: false, docs: [doc1, doc2] }),
      });

      await archiveReports();

      expect(mockBatchSet).toHaveBeenCalledTimes(2);

      // Verify each set targets the reportsArchive path
      const setCalls = mockBatchSet.mock.calls;
      expect(setCalls[0][0]._path).toBe('reportsArchive/report-1');
      expect(setCalls[1][0]._path).toBe('reportsArchive/report-2');
    });

    it('deletes each report from the original reports collection', async () => {
      const doc1 = makeReportDoc('report-1');
      const doc2 = makeReportDoc('report-2');

      db.collection.mockReturnValueOnce({
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: false, docs: [doc1, doc2] }),
      });

      await archiveReports();

      expect(mockBatchDelete).toHaveBeenCalledTimes(2);

      const deleteCalls = mockBatchDelete.mock.calls;
      expect(deleteCalls[0][0]._path).toBe('reports/report-1');
      expect(deleteCalls[1][0]._path).toBe('reports/report-2');
    });

    it('commits the batch after processing', async () => {
      const doc1 = makeReportDoc('report-1');

      db.collection.mockReturnValueOnce({
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: false, docs: [doc1] }),
      });

      await archiveReports();

      expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    });

    it('includes all original report fields when copying to archive', async () => {
      const reportData = {
        reportedUserId: 'user-bad',
        reporterId: 'user-good',
        reason: 'harassment',
        status: 'resolved',
        resolvedAt: Date.now() - 7 * 30 * 24 * 60 * 60 * 1000,
      };
      const doc1 = {
        id: 'report-x',
        data: () => reportData,
      };

      db.collection.mockReturnValueOnce({
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: false, docs: [doc1] }),
      });

      await archiveReports();

      const setCall = mockBatchSet.mock.calls[0];
      const archivedData = setCall[1];
      // The archived doc includes the id field (added via spread) and original data fields
      expect(archivedData.id).toBe('report-x');
      expect(archivedData.reportedUserId).toBe('user-bad');
      expect(archivedData.reason).toBe('harassment');
      expect(archivedData.status).toBe('resolved');
    });

    it('logs the count of archived reports', async () => {
      const docs = [makeReportDoc('r1'), makeReportDoc('r2'), makeReportDoc('r3')];

      db.collection.mockReturnValueOnce({
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: false, docs }),
      });

      await archiveReports();

      expect(log.info).toHaveBeenCalledWith(
        'cron',
        'archiveReports: archived old reports',
        expect.objectContaining({ count: 3 }),
      );
    });
  });

  describe('when there are more than 250 reports (chunked batch processing)', () => {
    it('commits multiple batches for large result sets', async () => {
      // Create 260 report docs to trigger the chunking path (250 per batch)
      const docs = Array.from({ length: 260 }, (_, i) => makeReportDoc(`report-${i}`));

      db.collection.mockReturnValueOnce({
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: false, docs }),
      });

      await archiveReports();

      // 260 docs → 2 batches (250 + 10)
      expect(mockBatchCommit).toHaveBeenCalledTimes(2);
      // Each doc = 2 ops: set + delete
      expect(mockBatchSet).toHaveBeenCalledTimes(260);
      expect(mockBatchDelete).toHaveBeenCalledTimes(260);
    });
  });

  describe('when query returns pending reports', () => {
    it('does not archive pending reports (they are excluded by the Firestore query)', async () => {
      // The route uses .where('status', '==', 'resolved'), so pending reports
      // are never returned. This test validates the query is built correctly.
      const queryChain = {
        whereArgs: [],
        where: jest.fn(function (...args) {
          this.whereArgs.push(args);
          return this;
        }),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      };
      db.collection.mockReturnValueOnce(queryChain);

      await archiveReports();

      // Confirm the query filtered on status = resolved
      const statusFilter = queryChain.whereArgs.find((args) => args[0] === 'status');
      expect(statusFilter).toBeDefined();
      expect(statusFilter[1]).toBe('==');
      expect(statusFilter[2]).toBe('resolved');
    });
  });

  describe('error handling', () => {
    it('propagates Firestore read errors', async () => {
      db.collection.mockReturnValueOnce({
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockRejectedValue(new Error('Firestore unavailable')),
      });

      await expect(archiveReports()).rejects.toThrow('Firestore unavailable');
    });

    it('propagates batch commit errors', async () => {
      const doc1 = makeReportDoc('report-1');

      db.collection.mockReturnValueOnce({
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: false, docs: [doc1] }),
      });
      mockBatchCommit.mockRejectedValueOnce(new Error('Batch commit failed'));

      await expect(archiveReports()).rejects.toThrow('Batch commit failed');
    });
  });
});

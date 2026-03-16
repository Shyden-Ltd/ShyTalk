/**
 * Tests for cron/backpackCleanup.js
 *
 * backpackCleanup():
 * - Uses a collection group query on 'backpack' to find all expired items
 *   (where expiresAt <= now) across all user backpacks in a single read
 * - Batch-deletes expired items (500 per batch)
 * - Skips (no-ops) when there are no expired items
 * - Items without an expiresAt field are not returned by the query (valid items)
 */

// ─── Firebase mock ────────────────────────────────────────────────

const mockBatchDelete = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collectionGroup: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn(),
    })),
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

const { db } = require('../../src/utils/firebase');
const log = require('../../src/utils/log');
const backpackCleanup = require('../../src/cron/backpackCleanup');

// ─── Helpers ─────────────────────────────────────────────────────

function makeExpiredItem(userId, giftId) {
  return {
    id: giftId,
    ref: { path: `users/${userId}/backpack/${giftId}` },
    data: () => ({
      giftId,
      quantity: 1,
      expiresAt: Date.now() - 86400000, // expired yesterday
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBatchCommit.mockResolvedValue();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('backpackCleanup', () => {
  describe('when there are no expired backpack items', () => {
    it('does not delete anything when snapshot is empty', async () => {
      db.collectionGroup.mockReturnValueOnce({
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      });

      await backpackCleanup();

      expect(mockBatchDelete).not.toHaveBeenCalled();
      expect(mockBatchCommit).not.toHaveBeenCalled();
    });

    it('logs an info message when no expired items are found', async () => {
      db.collectionGroup.mockReturnValueOnce({
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      });

      await backpackCleanup();

      expect(log.info).toHaveBeenCalledWith('cron', 'backpackCleanup: no expired items');
    });
  });

  describe('when expired backpack items exist', () => {
    it('deletes all expired items via batch', async () => {
      const docs = [
        makeExpiredItem('user-1', 'gift-rose'),
        makeExpiredItem('user-2', 'gift-diamond'),
        makeExpiredItem('user-3', 'gift-cake'),
      ];

      db.collectionGroup.mockReturnValueOnce({
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: false, docs }),
      });

      await backpackCleanup();

      expect(mockBatchDelete).toHaveBeenCalledTimes(3);
    });

    it('passes doc.ref to batch.delete (not the doc id)', async () => {
      const item = makeExpiredItem('user-1', 'gift-rose');

      db.collectionGroup.mockReturnValueOnce({
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: false, docs: [item] }),
      });

      await backpackCleanup();

      expect(mockBatchDelete).toHaveBeenCalledWith(item.ref);
    });

    it('commits the batch after deleting items', async () => {
      const docs = [makeExpiredItem('user-1', 'gift-abc')];

      db.collectionGroup.mockReturnValueOnce({
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: false, docs }),
      });

      await backpackCleanup();

      expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    });

    it('logs the count of cleaned expired items', async () => {
      const docs = [makeExpiredItem('user-1', 'gift-a'), makeExpiredItem('user-2', 'gift-b')];

      db.collectionGroup.mockReturnValueOnce({
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: false, docs }),
      });

      await backpackCleanup();

      expect(log.info).toHaveBeenCalledWith(
        'cron',
        'backpackCleanup: cleaned expired items',
        expect.objectContaining({ count: 2 }),
      );
    });
  });

  describe('when there are more than 500 expired items (chunked batch processing)', () => {
    it('commits multiple batches for large result sets', async () => {
      // Create 600 expired items to trigger the chunking path (500 per batch)
      const docs = Array.from({ length: 600 }, (_, i) => makeExpiredItem(`user-${i}`, `gift-${i}`));

      db.collectionGroup.mockReturnValueOnce({
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: false, docs }),
      });

      await backpackCleanup();

      // 600 docs → 2 batches (500 + 100)
      expect(mockBatchCommit).toHaveBeenCalledTimes(2);
      expect(mockBatchDelete).toHaveBeenCalledTimes(600);
    });
  });

  describe('query filtering', () => {
    it('queries the backpack collection group', async () => {
      db.collectionGroup.mockReturnValueOnce({
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      });

      await backpackCleanup();

      expect(db.collectionGroup).toHaveBeenCalledWith('backpack');
    });

    it('applies expiresAt <= timestamp filter', async () => {
      const whereArgs = [];
      const chainMock = {
        where: jest.fn((...args) => {
          whereArgs.push(args);
          return chainMock;
        }),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      };
      db.collectionGroup.mockReturnValueOnce(chainMock);

      await backpackCleanup();

      expect(whereArgs.length).toBeGreaterThan(0);
      const filter = whereArgs.find((args) => args[0] === 'expiresAt');
      expect(filter).toBeDefined();
      expect(filter[1]).toBe('<=');
      expect(typeof filter[2]).toBe('number');
    });

    it('limits results to 500 per run', async () => {
      const limitMock = jest.fn().mockReturnThis();
      db.collectionGroup.mockReturnValueOnce({
        where: jest.fn().mockReturnThis(),
        limit: limitMock,
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      });

      await backpackCleanup();

      expect(limitMock).toHaveBeenCalledWith(500);
    });
  });

  describe('error handling', () => {
    it('propagates Firestore collection group query errors', async () => {
      db.collectionGroup.mockReturnValueOnce({
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockRejectedValue(new Error('Firestore collection group unavailable')),
      });

      await expect(backpackCleanup()).rejects.toThrow('Firestore collection group unavailable');
    });

    it('propagates batch commit errors', async () => {
      const docs = [makeExpiredItem('user-1', 'gift-x')];

      db.collectionGroup.mockReturnValueOnce({
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: false, docs }),
      });
      mockBatchCommit.mockRejectedValueOnce(new Error('Batch commit failed'));

      await expect(backpackCleanup()).rejects.toThrow('Batch commit failed');
    });
  });
});

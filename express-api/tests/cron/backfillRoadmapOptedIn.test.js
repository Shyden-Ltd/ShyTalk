/**
 * Tests for src/cron/backfillRoadmapOptedIn.js — one-shot migration that
 * populates `roadmapUpdateOptedIn` on legacy subscription docs.
 *
 * Phase 2A finding #2 follow-up: roadmap-notify uses a server-side equality
 * filter on this flag. Existing subs written before the route fix don't
 * have the field. This cron migrates them in CRON_LIMIT-sized pages until
 * every doc has the flag set, then becomes a no-op.
 */

const mockBatchUpdate = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue(undefined);
const mockBatch = jest.fn(() => ({ update: mockBatchUpdate, commit: mockBatchCommit }));
const mockCollectionGet = jest.fn();
const mockLimit = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collection: jest.fn(() => ({ limit: mockLimit })),
    batch: () => mockBatch(),
  },
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// `computeRoadmapOptedIn` is the real helper (small, no Firebase deps).
// No need to mock — the test just exercises the cron's batch logic.

const backfillRoadmapOptedIn = require('../../src/cron/backfillRoadmapOptedIn');

beforeEach(() => {
  jest.clearAllMocks();
  mockLimit.mockReturnValue({ get: mockCollectionGet });
});

function makeSub(id, data) {
  return {
    id,
    ref: { path: `subscriptions/${id}` },
    data: () => data,
  };
}

describe('backfillRoadmapOptedIn cron', () => {
  test('skips docs that already have the flag set (idempotent)', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      size: 2,
      docs: [
        makeSub('a', { roadmapUpdateOptedIn: true }),
        makeSub('b', { roadmapUpdateOptedIn: false }),
      ],
    });

    await backfillRoadmapOptedIn();

    expect(mockBatchUpdate).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  test('writes the flag for legacy docs missing it (computed from prefs)', async () => {
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      size: 3,
      docs: [
        makeSub('legacy-on', {
          channelPreferences: { roadmapUpdate: { inApp: true } },
        }),
        makeSub('legacy-off', {
          channelPreferences: { roadmapUpdate: { email: false, inApp: false } },
        }),
        makeSub('legacy-no-prefs', {}),
      ],
    });

    await backfillRoadmapOptedIn();

    // Three updates — each legacy doc gets the field set, even when
    // computed value is `false`. Future PUTs only re-write when the
    // value differs.
    expect(mockBatchUpdate).toHaveBeenCalledTimes(3);
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'subscriptions/legacy-on' }),
      { roadmapUpdateOptedIn: true },
    );
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'subscriptions/legacy-off' }),
      { roadmapUpdateOptedIn: false },
    );
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'subscriptions/legacy-no-prefs' }),
      { roadmapUpdateOptedIn: false },
    );
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  test('logs truncation warning when page hits CRON_LIMIT', async () => {
    const log = require('../../src/utils/log');
    const fullPage = Array.from({ length: 500 }, (_, i) =>
      makeSub(`u${i}`, { roadmapUpdateOptedIn: true }),
    );
    mockCollectionGet.mockResolvedValueOnce({ empty: false, size: 500, docs: fullPage });

    await backfillRoadmapOptedIn();

    expect(log.warn).toHaveBeenCalledWith(
      'cron',
      expect.stringContaining('hit CRON_LIMIT'),
      expect.objectContaining({ limit: 500 }),
    );
  });

  test('flushes batches at 400 ops to leave Firestore-batch headroom', async () => {
    // Construct a page of 401 legacy docs → triggers a mid-loop batch
    // commit at op 400, then a final commit for op 401.
    const docs = Array.from({ length: 401 }, (_, i) =>
      makeSub(`u${i}`, { channelPreferences: { roadmapUpdate: { inApp: true } } }),
    );
    mockCollectionGet.mockResolvedValueOnce({ empty: false, size: 401, docs });

    await backfillRoadmapOptedIn();

    expect(mockBatchUpdate).toHaveBeenCalledTimes(401);
    // Two commits: one at the 400-op flush, one at the end for op 401.
    expect(mockBatchCommit).toHaveBeenCalledTimes(2);
  });

  test('logs "complete" when an empty page arrives (migration done)', async () => {
    const log = require('../../src/utils/log');
    mockCollectionGet.mockResolvedValueOnce({ empty: true, size: 0, docs: [] });

    await backfillRoadmapOptedIn();

    expect(log.info).toHaveBeenCalledWith(
      'cron',
      expect.stringContaining('no subscriptions to backfill'),
    );
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  test('logs "complete" when every doc on the page already has the flag', async () => {
    const log = require('../../src/utils/log');
    mockCollectionGet.mockResolvedValueOnce({
      empty: false,
      size: 2,
      docs: [
        makeSub('a', { roadmapUpdateOptedIn: true }),
        makeSub('b', { roadmapUpdateOptedIn: true }),
      ],
    });

    await backfillRoadmapOptedIn();

    expect(log.info).toHaveBeenCalledWith(
      'cron',
      expect.stringContaining('complete (no docs missing the field)'),
      expect.objectContaining({ alreadySet: 2 }),
    );
  });
});

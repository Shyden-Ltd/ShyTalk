// Mock Firebase
const mockGet = jest.fn();
const mockBatchDelete = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue(undefined);
const mockBatch = jest.fn(() => ({
  delete: mockBatchDelete,
  commit: mockBatchCommit,
}));
const mockDoc = jest.fn();
const mockCollection = jest.fn();
const mockWhere = jest.fn();
const mockOrderBy = jest.fn();
const mockLimit = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collection: (...args) => {
      mockCollection(...args);
      return {
        doc: (...dArgs) => {
          mockDoc(...dArgs);
          return { get: mockGet };
        },
        where: (...wArgs) => {
          mockWhere(...wArgs);
          return {
            orderBy: (...oArgs) => {
              mockOrderBy(...oArgs);
              return {
                limit: (...lArgs) => {
                  mockLimit(...lArgs);
                  return { get: mockGet };
                },
              };
            },
          };
        },
      };
    },
    batch: mockBatch,
  },
}));

// Mock R2
jest.mock('../../src/utils/r2', () => ({
  putObject: jest.fn().mockResolvedValue(undefined),
  listObjects: jest.fn().mockResolvedValue([]),
  deleteObject: jest.fn().mockResolvedValue(undefined),
  deleteObjects: jest.fn().mockResolvedValue(undefined),
}));

// Mock log so we can assert on truncation warnings without polluting stderr
jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const rotateLogs = require('../../src/cron/rotateLogs');
const r2 = require('../../src/utils/r2');
const log = require('../../src/utils/log');

beforeEach(() => {
  jest.clearAllMocks();
  // Reset default: config doc doesn't exist, no logs
  mockGet.mockReset();
  r2.listObjects.mockResolvedValue([]);
});

function makeLogDoc(id, data) {
  return {
    id,
    data: () => data,
    ref: { path: `logs/${id}` },
  };
}

describe('rotateLogs', () => {
  test('archives logs older than retention to R2 as NDJSON', async () => {
    // First call: config doc
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ retentionHours: 48 }) });

    const docs = [
      makeLogDoc('log1', { timestamp: '2020-01-01T00:00:00Z', level: 'INFO', message: 'hello' }),
      makeLogDoc('log2', { timestamp: '2020-01-01T01:00:00Z', level: 'ERROR', message: 'oops' }),
    ];
    // Second call: logs query
    mockGet.mockResolvedValueOnce({ empty: false, docs });

    await rotateLogs();

    // Should write NDJSON to R2
    expect(r2.putObject).toHaveBeenCalledTimes(1);
    const [key, body, contentType] = r2.putObject.mock.calls[0];
    expect(key).toMatch(/^logs\/\d{4}\/\d{2}\/\d{2}\/\d{2}-\d+\.ndjson$/);
    expect(contentType).toBe('application/x-ndjson');

    // Verify NDJSON content
    const lines = body.split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({
      id: 'log1',
      timestamp: '2020-01-01T00:00:00Z',
      level: 'INFO',
      message: 'hello',
    });
    expect(JSON.parse(lines[1])).toEqual({
      id: 'log2',
      timestamp: '2020-01-01T01:00:00Z',
      level: 'ERROR',
      message: 'oops',
    });
  });

  test('deletes archived docs from Firestore', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ retentionHours: 48 }) });

    const docs = [
      makeLogDoc('log1', { timestamp: '2020-01-01T00:00:00Z', level: 'INFO', message: 'a' }),
      makeLogDoc('log2', { timestamp: '2020-01-01T01:00:00Z', level: 'WARN', message: 'b' }),
    ];
    mockGet.mockResolvedValueOnce({ empty: false, docs });

    await rotateLogs();

    expect(mockBatch).toHaveBeenCalledTimes(1);
    expect(mockBatchDelete).toHaveBeenCalledTimes(2);
    expect(mockBatchDelete).toHaveBeenCalledWith(docs[0].ref);
    expect(mockBatchDelete).toHaveBeenCalledWith(docs[1].ref);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  test('does nothing when no expired logs', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ retentionHours: 48 }) });
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });

    await rotateLogs();

    expect(r2.putObject).not.toHaveBeenCalled();
    expect(mockBatch).not.toHaveBeenCalled();
  });

  test('uses configurable retentionHours from Firestore', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ retentionHours: 24 }) });
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });

    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    await rotateLogs();

    // The cutoff should be 24 hours ago
    const expectedCutoff = new Date(now - 24 * 3600000).toISOString();
    expect(mockWhere).toHaveBeenCalledWith('timestamp', '<', expectedCutoff);

    Date.now.mockRestore();
  });

  test('prunes R2 files older than 90 days', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ retentionHours: 48 }) });
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });

    // Pin "now" so the recent/old boundary is deterministic regardless
    // of wall clock — without this, the test goes flaky as `recentKey`
    // (originally written 2026-03-06) drifts past the 90-day window
    // with calendar progression. Pre-existing flake surfaced on PR #988.
    const FIXED_NOW = new Date('2026-04-01T00:00:00Z').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);

    // Set up old and recent R2 keys
    const oldKey = 'logs/2025/01/01/12-1234567890.ndjson';
    const recentKey = `logs/2026/03/06/10-9999999999.ndjson`;
    r2.listObjects.mockResolvedValue([oldKey, recentKey]);

    await rotateLogs();

    expect(r2.listObjects).toHaveBeenCalledWith('logs/');
    // Bulk delete should include old key but not recent key
    const deletedKeys = r2.deleteObjects.mock.calls.flatMap((c) => c[0]);
    expect(deletedKeys).toContain(oldKey);
    expect(deletedKeys).not.toContain(recentKey);

    Date.now.mockRestore();
  });

  test('handles missing config doc gracefully (uses default 48h)', async () => {
    // Config doc doesn't exist
    mockGet.mockResolvedValueOnce({ exists: false });
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });

    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    await rotateLogs();

    // Should use default 48h
    const expectedCutoff = new Date(now - 48 * 3600000).toISOString();
    expect(mockWhere).toHaveBeenCalledWith('timestamp', '<', expectedCutoff);

    Date.now.mockRestore();
  });

  // ─── CRON_LIMIT truncation warning (Phase 2-cron batch 2) ──────────
  // rotateLogs always pulls a capped page (CRON_LIMIT=500) from `logs`. If
  // the page is full, we're behind on rotation — the next tick will pick
  // up the rest, but operators need a signal so they can lean in (raise
  // retentionHours? add a sweep cron?) before backlog snowballs and ages
  // past compliance thresholds. Without this warn, a stuck rotation cron
  // is silent until R2 storage starts getting noisy.
  test('logs truncation warning when query hits CRON_LIMIT (500)', async () => {
    // Config: default retention OK
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ retentionHours: 48 }) });

    // 500 log docs returned — fills the page exactly.
    const fullPage = Array.from({ length: 500 }, (_, i) =>
      makeLogDoc(`log${i}`, { timestamp: '2020-01-01T00:00:00Z', message: `msg ${i}` }),
    );
    mockGet.mockResolvedValueOnce({ empty: false, size: 500, docs: fullPage });

    await rotateLogs();

    expect(log.warn).toHaveBeenCalledWith(
      'cron',
      expect.stringContaining('hit CRON_LIMIT'),
      expect.objectContaining({ limit: 500 }),
    );
    // Verify the limit was actually applied (so the cap is real, not just logged)
    expect(mockLimit).toHaveBeenCalledWith(500);
  });

  test('does NOT log truncation warning when query returns < CRON_LIMIT', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ retentionHours: 48 }) });
    // Smaller page than the cap
    const partialPage = Array.from({ length: 100 }, (_, i) =>
      makeLogDoc(`log${i}`, { timestamp: '2020-01-01T00:00:00Z', message: `msg ${i}` }),
    );
    mockGet.mockResolvedValueOnce({ empty: false, size: 100, docs: partialPage });

    await rotateLogs();

    // The warn message must be specifically about CRON_LIMIT — other
    // log.warn callers in this cron (none today, but defensively) won't
    // mask a regression that drops the truncation check.
    const truncationWarn = log.warn.mock.calls.find(
      ([_, msg]) => typeof msg === 'string' && msg.includes('hit CRON_LIMIT'),
    );
    expect(truncationWarn).toBeUndefined();
  });
});

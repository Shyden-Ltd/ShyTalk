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

const rotateLogs = require('../../src/cron/rotateLogs');
const r2 = require('../../src/utils/r2');

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
});

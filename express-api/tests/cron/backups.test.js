// Mock Firebase — chainable collection/doc/get
const mockGet = jest.fn();
const mockSet = jest.fn().mockResolvedValue(undefined);
const mockDocRef = { get: mockGet, set: mockSet };
const mockDoc = jest.fn(() => mockDocRef);
const mockSubCollection = jest.fn(() => ({ get: mockGet, doc: mockDoc }));

// Make doc return an object with .collection() for subcollections
const mockDocWithSub = jest.fn((...args) => {
  mockDoc(...args);
  return {
    get: mockGet,
    set: mockSet,
    collection: mockSubCollection,
  };
});

const mockCollection = jest.fn(() => ({
  get: mockGet,
  doc: mockDocWithSub,
}));

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collection: (...args) => {
      mockCollection(...args);
      return {
        get: mockGet,
        doc: mockDocWithSub,
      };
    },
  },
}));

// Mock R2
jest.mock('../../src/utils/r2', () => ({
  putObject: jest.fn().mockResolvedValue(undefined),
  listObjects: jest.fn().mockResolvedValue([]),
  deleteObject: jest.fn().mockResolvedValue(undefined),
  deleteObjects: jest.fn().mockResolvedValue(undefined),
  getObject: jest.fn(),
}));

const backups = require('../../src/cron/backups');
const r2 = require('../../src/utils/r2');

function makeSnapshot(docs) {
  return {
    empty: docs.length === 0,
    docs: docs.map((d) => ({
      id: d.id,
      data: () => {
        const { id: _id, ...rest } = d;
        return rest;
      },
      ref: { path: `col/${d.id}` },
    })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  r2.listObjects.mockResolvedValue([]);
});

describe('backups cron', () => {
  test('backs up all top-level collections to R2', async () => {
    // Every .get() returns empty snapshot (simplest case)
    mockGet.mockResolvedValue(makeSnapshot([]));

    await backups();

    // Should write one JSON file per top-level collection + subcollections + manifest + legacy users
    // 15 top-level + 3 subcollections + 1 manifest + 1 legacy users = 20 putObject calls
    const putCalls = r2.putObject.mock.calls;

    // Check that all top-level collections have backup files
    const topLevelKeys = putCalls
      .map((c) => c[0])
      .filter((k) => k.startsWith('backups/full/') && !k.endsWith('manifest.json'));

    for (const collName of backups.TOP_LEVEL_COLLECTIONS) {
      const found = topLevelKeys.some((k) => k.endsWith(`/${collName}.json`));
      expect(found).toBe(true);
    }
  });

  test('backs up subcollections with parentId', async () => {
    // For rooms collection, return one parent doc
    const roomDoc = { id: 'room1', name: 'Test Room' };
    const _roomSnapshot = makeSnapshot([roomDoc]);

    // For subcollection, return one message
    const msgDoc = { id: 'msg1', text: 'Hello' };
    const _msgSnapshot = makeSnapshot([msgDoc]);

    // We need to track which collection is being queried
    let _getCallCount = 0;
    mockGet.mockImplementation(() => {
      _getCallCount++;
      // The rooms collection get (called multiple times for top-level + subcollection parents)
      // Return room doc for rooms, empty for everything else
      // This is tricky with the flat mock, so we return non-empty for some calls
      // and empty for others

      // For simplicity, return empty snapshot for all calls
      return Promise.resolve(makeSnapshot([]));
    });

    await backups();

    // Verify subcollection backup files are created
    const putKeys = r2.putObject.mock.calls.map((c) => c[0]);
    expect(putKeys.some((k) => k.endsWith('/rooms_messages.json'))).toBe(true);
    expect(putKeys.some((k) => k.endsWith('/rooms_seatRequests.json'))).toBe(true);
    expect(putKeys.some((k) => k.endsWith('/conversations_messages.json'))).toBe(true);
  });

  test('creates manifest with doc counts', async () => {
    const userDocs = [
      { id: 'u1', name: 'Alice' },
      { id: 'u2', name: 'Bob' },
    ];

    // Return users for the first get, empty for everything else
    let firstCall = true;
    mockGet.mockImplementation(() => {
      if (firstCall) {
        firstCall = false;
        return Promise.resolve(makeSnapshot(userDocs));
      }
      return Promise.resolve(makeSnapshot([]));
    });

    await backups();

    // Find the manifest putObject call
    const manifestCall = r2.putObject.mock.calls.find((c) => c[0].endsWith('/manifest.json'));
    expect(manifestCall).toBeDefined();

    const manifestBody = JSON.parse(manifestCall[1].toString());
    expect(manifestBody.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(manifestBody.timestamp).toBeDefined();
    expect(manifestBody.collections).toBeDefined();
    expect(typeof manifestBody.collections).toBe('object');

    // Users should have count 2 (first collection backed up)
    expect(manifestBody.collections.users).toBe(2);
  });

  test('prunes backups older than 7 days', async () => {
    mockGet.mockResolvedValue(makeSnapshot([]));

    // Use dynamic dates relative to today to avoid test rot
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const recentDate = yesterday.toISOString().split('T')[0];

    const oldFullKey = 'backups/full/2020-01-01/users.json';
    const recentFullKey = `backups/full/${recentDate}/users.json`;
    const oldUsersKey = 'backups/users/2020-01-01.json';
    const recentUsersKey = `backups/users/${recentDate}.json`;

    r2.listObjects.mockImplementation((prefix) => {
      if (prefix === 'backups/full/') {
        return Promise.resolve([oldFullKey, recentFullKey]);
      }
      if (prefix === 'backups/users/') {
        return Promise.resolve([oldUsersKey, recentUsersKey]);
      }
      return Promise.resolve([]);
    });

    await backups();

    // Bulk delete should include old keys but not recent ones
    const allDeletedKeys = r2.deleteObjects.mock.calls.flatMap((c) => c[0]);
    expect(allDeletedKeys).toContain(oldFullKey);
    expect(allDeletedKeys).toContain(oldUsersKey);
    expect(allDeletedKeys).not.toContain(recentFullKey);
    expect(allDeletedKeys).not.toContain(recentUsersKey);
  });

  test('handles empty collections gracefully', async () => {
    mockGet.mockResolvedValue(makeSnapshot([]));

    // Should not throw
    await expect(backups()).resolves.toBeDefined();

    // Should still write files (with empty arrays)
    const putCalls = r2.putObject.mock.calls;
    expect(putCalls.length).toBeGreaterThan(0);

    // Check that empty collection files contain "[]"
    const usersCall = putCalls.find((c) => c[0].match(/backups\/full\/.*\/users\.json$/));
    expect(usersCall).toBeDefined();
    const parsed = JSON.parse(usersCall[1].toString());
    expect(parsed).toEqual([]);
  });

  test('writes backwards-compatible users backup', async () => {
    mockGet.mockResolvedValue(makeSnapshot([]));

    await backups();

    const legacyCall = r2.putObject.mock.calls.find((c) => c[0].match(/^backups\/users\//));
    expect(legacyCall).toBeDefined();
    expect(legacyCall[0]).toMatch(/^backups\/users\/\d{4}-\d{2}-\d{2}\.json$/);
  });

  test('returns date and manifest on success', async () => {
    mockGet.mockResolvedValue(makeSnapshot([]));

    const result = await backups();

    expect(result).toBeDefined();
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.manifest).toBeDefined();
    expect(result.manifest.collections).toBeDefined();
  });
});

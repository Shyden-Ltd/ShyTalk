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
  describe('collection scope based on environment', () => {
    test('DEV_TOP_LEVEL_COLLECTIONS contains only essential data', () => {
      expect(backups.DEV_TOP_LEVEL_COLLECTIONS).toEqual(['users', 'config', 'counters']);
    });

    test('ALL_TOP_LEVEL_COLLECTIONS contains all 27 collections', () => {
      expect(backups.ALL_TOP_LEVEL_COLLECTIONS).toContain('users');
      expect(backups.ALL_TOP_LEVEL_COLLECTIONS).toContain('rooms');
      expect(backups.ALL_TOP_LEVEL_COLLECTIONS).toContain('conversations');
      expect(backups.ALL_TOP_LEVEL_COLLECTIONS).toContain('deviceBans');
      expect(backups.ALL_TOP_LEVEL_COLLECTIONS).toContain('networkBans');
      expect(backups.ALL_TOP_LEVEL_COLLECTIONS.length).toBe(27);
    });

    test('ALL_SUBCOLLECTIONS contains 11 subcollection pairs', () => {
      expect(backups.ALL_SUBCOLLECTIONS.length).toBe(11);
    });

    test('in test/dev, TOP_LEVEL_COLLECTIONS uses dev subset', () => {
      // Tests run in non-production, so should use dev collections
      expect(backups.TOP_LEVEL_COLLECTIONS).toEqual(backups.DEV_TOP_LEVEL_COLLECTIONS);
    });

    test('in test/dev, SUBCOLLECTIONS is empty', () => {
      expect(backups.SUBCOLLECTIONS).toEqual([]);
    });
  });

  test('backs up only dev collections to R2 in non-production', async () => {
    mockGet.mockResolvedValue(makeSnapshot([]));

    await backups();

    const putCalls = r2.putObject.mock.calls;
    const backupKeys = putCalls
      .map((c) => c[0])
      .filter(
        (k) =>
          k.startsWith('backups/full/') &&
          !k.endsWith('manifest.json') &&
          !k.startsWith('backups/users/'),
      );

    // Should only have dev collections: users, config, counters
    for (const collName of backups.DEV_TOP_LEVEL_COLLECTIONS) {
      const found = backupKeys.some((k) => k.endsWith(`/${collName}.json`));
      expect(found).toBe(true);
    }

    // Should NOT have non-dev collections
    expect(backupKeys.some((k) => k.endsWith('/rooms.json'))).toBe(false);
    expect(backupKeys.some((k) => k.endsWith('/conversations.json'))).toBe(false);
    expect(backupKeys.some((k) => k.endsWith('/deviceBans.json'))).toBe(false);
  });

  test('does not back up subcollections in non-production', async () => {
    mockGet.mockResolvedValue(makeSnapshot([]));

    await backups();

    const putKeys = r2.putObject.mock.calls.map((c) => c[0]);
    // No subcollection files should exist
    expect(putKeys.some((k) => k.endsWith('/rooms_messages.json'))).toBe(false);
    expect(putKeys.some((k) => k.endsWith('/rooms_seatRequests.json'))).toBe(false);
    expect(putKeys.some((k) => k.endsWith('/conversations_messages.json'))).toBe(false);
    expect(putKeys.some((k) => k.endsWith('/users_backpack.json'))).toBe(false);
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

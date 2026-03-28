// Mock Firebase — chainable collection/doc/get
const mockGet = jest.fn();
const mockSet = jest.fn().mockResolvedValue(undefined);
const mockDocRef = { get: mockGet, set: mockSet };
const mockDoc = jest.fn(() => mockDocRef);
const mockSubCol = jest.fn(() => ({ get: mockGet, doc: mockDoc }));

// Make doc return an object with .collection() for subcollections
const mockDocSub = jest.fn((...args) => {
  mockDoc(...args);
  return {
    get: mockGet,
    set: mockSet,
    collection: mockSubCol,
  };
});

const mockCollection = jest.fn(() => ({
  get: mockGet,
  doc: mockDocSub,
}));

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collection: (...args) => {
      mockCollection(...args);
      return {
        get: mockGet,
        doc: mockDocSub,
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

  test('continues backing up remaining collections when one fails (line 139)', async () => {
    let callCount = 0;
    mockGet.mockImplementation(() => {
      callCount++;
      // Fail the first collection (users), succeed for the rest
      if (callCount === 1) {
        return Promise.reject(new Error('Firestore read failed'));
      }
      return Promise.resolve(makeSnapshot([]));
    });

    // Should not throw — errors are caught per-collection
    const result = await backups();
    expect(result).toBeDefined();
    expect(result.manifest).toBeDefined();

    // The remaining collections (config, counters) should still be saved
    const putKeys = r2.putObject.mock.calls.map((c) => c[0]);
    expect(putKeys.some((k) => k.endsWith('/config.json'))).toBe(true);
    expect(putKeys.some((k) => k.endsWith('/counters.json'))).toBe(true);

    // users.json should NOT appear (it failed)
    const backupKeys = putKeys.filter(
      (k) => k.startsWith('backups/full/') && !k.endsWith('manifest.json'),
    );
    expect(backupKeys.some((k) => k.endsWith('/users.json'))).toBe(false);
  });

  test('manifest omits collections that failed to back up', async () => {
    let callCount = 0;
    mockGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error('read timeout'));
      }
      return Promise.resolve(makeSnapshot([{ id: 'c1', key: 'val' }]));
    });

    const result = await backups();
    const manifest = result.manifest;

    // users failed, so should not appear in manifest
    expect(manifest.collections.users).toBeUndefined();
    // config and counters succeeded
    expect(manifest.collections.config).toBe(1);
    expect(manifest.collections.counters).toBe(1);
  });

  test('backwards-compat users backup writes empty array when users collection fails', async () => {
    // Make every get() fail — users will fail, usersJsonStr stays null
    mockGet.mockRejectedValue(new Error('all reads fail'));

    const result = await backups();
    expect(result).toBeDefined();

    // Backwards-compat file should still be written with "[]" fallback
    const legacyCall = r2.putObject.mock.calls.find((c) => c[0].match(/^backups\/users\//));
    expect(legacyCall).toBeDefined();
    const body = legacyCall[1].toString();
    expect(body).toBe('[]');
  });

  test('prune skips keys with unparseable dates', async () => {
    mockGet.mockResolvedValue(makeSnapshot([]));

    r2.listObjects.mockImplementation((prefix) => {
      if (prefix === 'backups/full/') {
        return Promise.resolve([
          'backups/full/not-a-date/users.json',
          'backups/full/2020-01-01/users.json', // old, should be pruned
        ]);
      }
      return Promise.resolve([]);
    });

    await backups();

    const allDeletedKeys = r2.deleteObjects.mock.calls.flatMap((c) => c[0]);
    // Old key should still be pruned
    expect(allDeletedKeys).toContain('backups/full/2020-01-01/users.json');
    // Invalid date key should NOT be pruned (isNaN check filters it)
    expect(allDeletedKeys).not.toContain('backups/full/not-a-date/users.json');
  });

  test('prune does not call deleteObjects when nothing is old', async () => {
    mockGet.mockResolvedValue(makeSnapshot([]));

    const today = new Date().toISOString().split('T')[0];
    r2.listObjects.mockImplementation((prefix) => {
      if (prefix === 'backups/full/') {
        return Promise.resolve([`backups/full/${today}/users.json`]);
      }
      return Promise.resolve([]);
    });

    await backups();

    // deleteObjects should NOT be called for the full prefix (all keys are recent)
    const fullPrefixDeleteCalls = r2.deleteObjects.mock.calls.filter(
      (c) => Array.isArray(c[0]) && c[0].some((k) => k.startsWith('backups/full/')),
    );
    expect(fullPrefixDeleteCalls).toHaveLength(0);
  });
});

describe('backups cron (production mode with subcollections)', () => {
  let prodBackups;
  let prodR2;
  let prodMockGet;
  let prodMockSubGet;

  beforeEach(() => {
    jest.resetModules();

    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    // Track which collection path is being queried
    prodMockGet = jest.fn();
    prodMockSubGet = jest.fn().mockResolvedValue({ docs: [] });

    const prodSubCol = jest.fn(() => ({ get: prodMockSubGet }));
    const prodDocSub = jest.fn(() => ({
      collection: prodSubCol,
    }));

    jest.doMock('../../src/utils/firebase', () => ({
      db: {
        collection: jest.fn(() => ({
          get: prodMockGet,
          doc: prodDocSub,
        })),
      },
    }));

    jest.doMock('../../src/utils/r2', () => ({
      putObject: jest.fn().mockResolvedValue(undefined),
      listObjects: jest.fn().mockResolvedValue([]),
      deleteObjects: jest.fn().mockResolvedValue(undefined),
    }));

    // Suppress console output from log utility
    jest.doMock('../../src/utils/log', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      fatal: jest.fn(),
    }));

    prodBackups = require('../../src/cron/backups');
    prodR2 = require('../../src/utils/r2');

    process.env.NODE_ENV = originalEnv;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeProdSnapshot(docs) {
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

  test('production mode includes all top-level collections', () => {
    expect(prodBackups.TOP_LEVEL_COLLECTIONS).toEqual(prodBackups.ALL_TOP_LEVEL_COLLECTIONS);
    expect(prodBackups.SUBCOLLECTIONS).toEqual(prodBackups.ALL_SUBCOLLECTIONS);
  });

  test('backs up subcollections in production mode (lines 85-105, 145-162)', async () => {
    // Parent docs with subcollection data
    const parentDocs = [{ id: 'room1', name: 'Room One' }];
    const subDocs = [
      { id: 'msg1', text: 'hello' },
      { id: 'msg2', text: 'world' },
    ];

    prodMockGet.mockResolvedValue(makeProdSnapshot(parentDocs));
    prodMockSubGet.mockResolvedValue(makeProdSnapshot(subDocs));

    await prodBackups();

    const putKeys = prodR2.putObject.mock.calls.map((c) => c[0]);

    // Should have subcollection files
    expect(putKeys.some((k) => k.endsWith('/rooms_messages.json'))).toBe(true);
    expect(putKeys.some((k) => k.endsWith('/rooms_seatRequests.json'))).toBe(true);
    expect(putKeys.some((k) => k.endsWith('/conversations_messages.json'))).toBe(true);
    expect(putKeys.some((k) => k.endsWith('/users_backpack.json'))).toBe(true);
  });

  test('subcollection backup includes parentId in each doc (lines 96-101)', async () => {
    const parentDocs = [{ id: 'parent1', title: 'P1' }];
    const subDocs = [{ id: 'sub1', content: 'data' }];

    prodMockGet.mockResolvedValue(makeProdSnapshot(parentDocs));
    prodMockSubGet.mockResolvedValue(makeProdSnapshot(subDocs));

    await prodBackups();

    // Find a subcollection put call and verify parentId is included
    const subCall = prodR2.putObject.mock.calls.find((c) => c[0].endsWith('/rooms_messages.json'));
    expect(subCall).toBeDefined();

    const docs = JSON.parse(subCall[1].toString());
    expect(docs.length).toBe(1);
    expect(docs[0].parentId).toBe('parent1');
    expect(docs[0].id).toBe('sub1');
    expect(docs[0].content).toBe('data');
  });

  test('subcollection backup aggregates docs across multiple parent docs', async () => {
    const parentDocs = [
      { id: 'p1', title: 'P1' },
      { id: 'p2', title: 'P2' },
    ];

    prodMockGet.mockResolvedValue(makeProdSnapshot(parentDocs));
    prodMockSubGet.mockResolvedValue(makeProdSnapshot([{ id: 's1', val: 'x' }]));

    await prodBackups();

    const subCall = prodR2.putObject.mock.calls.find((c) => c[0].endsWith('/rooms_messages.json'));
    expect(subCall).toBeDefined();

    const docs = JSON.parse(subCall[1].toString());
    // 1 subdoc per parent x 2 parents = 2 docs
    expect(docs.length).toBe(2);
    expect(docs[0].parentId).toBe('p1');
    expect(docs[1].parentId).toBe('p2');
  });

  test('continues when a subcollection backup fails (lines 161-166)', async () => {
    prodMockGet.mockResolvedValue(makeProdSnapshot([{ id: 'p1' }]));

    let subCallCount = 0;
    prodMockSubGet.mockImplementation(() => {
      subCallCount++;
      // Fail on first subcollection get, succeed on the rest
      if (subCallCount === 1) {
        return Promise.reject(new Error('subcollection read failed'));
      }
      return Promise.resolve(makeProdSnapshot([{ id: `doc${subCallCount}`, data: 'ok' }]));
    });

    // Should not throw — subcollection errors are caught
    const result = await prodBackups();
    expect(result).toBeDefined();
    expect(result.manifest).toBeDefined();

    // Manifest should still have entries for successfully backed up subcollections
    const manifestKeys = Object.keys(result.manifest.collections);
    expect(manifestKeys.length).toBeGreaterThan(0);
  });

  test('manifest includes subcollection doc counts in production', async () => {
    const parentDocs = [{ id: 'p1' }];
    const subDocs = [
      { id: 's1', msg: 'hi' },
      { id: 's2', msg: 'bye' },
    ];

    prodMockGet.mockResolvedValue(makeProdSnapshot(parentDocs));
    prodMockSubGet.mockResolvedValue(makeProdSnapshot(subDocs));

    const result = await prodBackups();

    // Subcollection entries should appear with their doc counts
    expect(result.manifest.collections.rooms_messages).toBe(2);
    expect(result.manifest.collections.rooms_seatRequests).toBe(2);
  });
});

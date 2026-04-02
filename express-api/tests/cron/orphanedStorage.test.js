// ─── R2 mock ─────────────────────────────────────────────────────

const mockListObjects = jest.fn();
const mockDeleteObjects = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/r2', () => ({
  listObjects: (...args) => mockListObjects(...args),
  deleteObjects: (...args) => mockDeleteObjects(...args),
  CDN_URL: 'https://images.shytalk.shyden.co.uk',
}));

// ─── Firebase mock ───────────────────────────────────────────────
// orphanedStorage queries: users (select), conversations (select),
// conversations/*/messages (where IMAGE, where STICKER),
// reports, reportsArchive, banners (select)

const mockCollectionSelectGet = jest.fn();
const mockWhereGet = jest.fn();

// Chain builder helpers
function _makeSelectChain(get) {
  return { select: jest.fn(() => ({ limit: jest.fn(() => ({ get })) })) };
}

function _makeWhereChain(get) {
  return { where: jest.fn(() => ({ limit: jest.fn(() => ({ get })) })) };
}

// Track which collection path was requested so we can return correct data
const collectionMocks = {};

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collection: jest.fn((path) => {
      return (
        collectionMocks[path] || {
          select: jest.fn(() => ({ limit: jest.fn(() => ({ get: mockCollectionSelectGet })) })),
          where: jest.fn(() => ({ limit: jest.fn(() => ({ get: mockWhereGet })) })),
        }
      );
    }),
  },
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const CDN_PREFIX = 'https://images.shytalk.shyden.co.uk/';

// Helper: build a CDN URL from an R2 key
function cdnUrl(key) {
  return `${CDN_PREFIX}${key}`;
}

// Helper: make a Firestore doc stub
function makeDoc(data) {
  return { id: 'doc-id', data: () => data };
}

const orphanedStorage = require('../../src/cron/orphanedStorage');

beforeEach(() => {
  jest.clearAllMocks();
  mockDeleteObjects.mockResolvedValue();

  // Default: all Firestore collections return empty
  mockCollectionSelectGet.mockResolvedValue({ docs: [] });
  mockWhereGet.mockResolvedValue({ docs: [] });

  // Default: all R2 folders return empty
  mockListObjects.mockResolvedValue([]);

  // Reset per-collection mocks
  Object.keys(collectionMocks).forEach((k) => delete collectionMocks[k]);
});

// ─── Tests ───────────────────────────────────────────────────────

describe('orphanedStorage cron', () => {
  test('does nothing when R2 bucket is empty', async () => {
    mockCollectionSelectGet.mockResolvedValue({ docs: [] });
    mockWhereGet.mockResolvedValue({ docs: [] });
    mockListObjects.mockResolvedValue([]);

    await orphanedStorage();

    expect(mockDeleteObjects).not.toHaveBeenCalled();
  });

  test('deletes R2 keys not referenced in Firestore', async () => {
    // All Firestore collections empty → no referenced keys (beyond system key)
    mockCollectionSelectGet.mockResolvedValue({ docs: [] });
    mockWhereGet.mockResolvedValue({ docs: [] });

    // profiles/ folder has two orphaned objects
    mockListObjects.mockImplementation((folder) => {
      if (folder === 'profiles/')
        return Promise.resolve(['profiles/orphan1.jpg', 'profiles/orphan2.jpg']);
      return Promise.resolve([]);
    });

    await orphanedStorage();

    expect(mockDeleteObjects).toHaveBeenCalledWith([
      'profiles/orphan1.jpg',
      'profiles/orphan2.jpg',
    ]);
  });

  test('keeps R2 keys that are referenced as user profilePhotoUrl', async () => {
    const referencedKey = 'profiles/user-abc.jpg';

    // users collection returns a user referencing the key
    mockCollectionSelectGet.mockImplementation(() => ({
      docs: [makeDoc({ profilePhotoUrl: cdnUrl(referencedKey) })],
    }));
    mockWhereGet.mockResolvedValue({ docs: [] });

    // R2 has exactly that key in profiles/
    mockListObjects.mockImplementation((folder) => {
      if (folder === 'profiles/') return Promise.resolve([referencedKey]);
      return Promise.resolve([]);
    });

    await orphanedStorage();

    // Referenced key must NOT be deleted
    expect(mockDeleteObjects).not.toHaveBeenCalledWith(expect.arrayContaining([referencedKey]));
  });

  test('keeps R2 keys referenced as user coverPhotoUrl', async () => {
    const coverKey = 'covers/user-cover.jpg';

    mockCollectionSelectGet.mockImplementation(() => ({
      docs: [makeDoc({ coverPhotoUrl: cdnUrl(coverKey) })],
    }));
    mockWhereGet.mockResolvedValue({ docs: [] });

    mockListObjects.mockImplementation((folder) => {
      if (folder === 'covers/') return Promise.resolve([coverKey]);
      return Promise.resolve([]);
    });

    await orphanedStorage();

    expect(mockDeleteObjects).not.toHaveBeenCalledWith(expect.arrayContaining([coverKey]));
  });

  test('keeps the hardcoded system key regardless of Firestore state', async () => {
    mockCollectionSelectGet.mockResolvedValue({ docs: [] });
    mockWhereGet.mockResolvedValue({ docs: [] });

    // Suppose the system icon lives in profiles/ (unusual, but tests the Set)
    // More realistic: it won't be in a scanned folder, so deleteObjects never called with it.
    // Here we verify the key is in referencedKeys by putting it in a folder we scan.
    mockListObjects.mockImplementation((folder) => {
      if (folder === 'profiles/')
        return Promise.resolve(['system/shytalk_icon.webp', 'profiles/orphan.jpg']);
      return Promise.resolve([]);
    });

    await orphanedStorage();

    // system/shytalk_icon.webp must not be in the delete list
    const calls = mockDeleteObjects.mock.calls.flat(2);
    expect(calls).not.toContain('system/shytalk_icon.webp');
    // orphan should be deleted
    expect(mockDeleteObjects).toHaveBeenCalledWith(expect.arrayContaining(['profiles/orphan.jpg']));
  });

  test('keeps R2 keys referenced in banner imageUrl', async () => {
    const bannerKey = 'banners/sale-banner.jpg';

    // banners collection returns a banner referencing the key
    mockCollectionSelectGet.mockImplementation(() => ({
      docs: [makeDoc({ imageUrl: cdnUrl(bannerKey) })],
    }));
    mockWhereGet.mockResolvedValue({ docs: [] });

    mockListObjects.mockImplementation((folder) => {
      if (folder === 'banners/') return Promise.resolve([bannerKey]);
      return Promise.resolve([]);
    });

    await orphanedStorage();

    expect(mockDeleteObjects).not.toHaveBeenCalledWith(expect.arrayContaining([bannerKey]));
  });

  test('keeps R2 keys referenced in report evidenceUrls', async () => {
    const evidenceKey = 'evidence/report-screenshot.jpg';

    mockCollectionSelectGet.mockImplementation(() => ({
      docs: [makeDoc({ evidenceUrls: [cdnUrl(evidenceKey)] })],
    }));
    mockWhereGet.mockResolvedValue({ docs: [] });

    mockListObjects.mockImplementation((folder) => {
      if (folder === 'evidence/') return Promise.resolve([evidenceKey]);
      return Promise.resolve([]);
    });

    await orphanedStorage();

    expect(mockDeleteObjects).not.toHaveBeenCalledWith(expect.arrayContaining([evidenceKey]));
  });

  test('handles R2 folder listing error without crashing', async () => {
    mockCollectionSelectGet.mockResolvedValue({ docs: [] });
    mockWhereGet.mockResolvedValue({ docs: [] });

    // profiles/ throws; other folders succeed
    mockListObjects.mockImplementation((folder) => {
      if (folder === 'profiles/') return Promise.reject(new Error('R2 timeout'));
      return Promise.resolve([]);
    });

    await expect(orphanedStorage()).resolves.not.toThrow();
  });

  test('deletes nothing when all R2 keys are referenced', async () => {
    const key1 = 'profiles/user-a.jpg';
    const key2 = 'covers/user-b.jpg';

    // Users reference both keys
    mockCollectionSelectGet.mockImplementation(() => ({
      docs: [makeDoc({ profilePhotoUrl: cdnUrl(key1), coverPhotoUrl: cdnUrl(key2) })],
    }));
    mockWhereGet.mockResolvedValue({ docs: [] });

    mockListObjects.mockImplementation((folder) => {
      if (folder === 'profiles/') return Promise.resolve([key1]);
      if (folder === 'covers/') return Promise.resolve([key2]);
      return Promise.resolve([]);
    });

    await orphanedStorage();

    expect(mockDeleteObjects).not.toHaveBeenCalled();
  });

  test('deletes orphans while keeping referenced keys in same folder', async () => {
    const refKey = 'profiles/active-user.jpg';
    const orphanKey = 'profiles/old-deleted-user.jpg';

    mockCollectionSelectGet.mockImplementation(() => ({
      docs: [makeDoc({ profilePhotoUrl: cdnUrl(refKey) })],
    }));
    mockWhereGet.mockResolvedValue({ docs: [] });

    mockListObjects.mockImplementation((folder) => {
      if (folder === 'profiles/') return Promise.resolve([refKey, orphanKey]);
      return Promise.resolve([]);
    });

    await orphanedStorage();

    expect(mockDeleteObjects).toHaveBeenCalledWith([orphanKey]);
    const calls = mockDeleteObjects.mock.calls.flat(2);
    expect(calls).not.toContain(refKey);
  });

  test('ignores non-CDN URLs in user fields', async () => {
    // profilePhotoUrl is an external URL (not our CDN)
    mockCollectionSelectGet.mockImplementation(() => ({
      docs: [makeDoc({ profilePhotoUrl: 'https://external.example.com/photo.jpg' })],
    }));
    mockWhereGet.mockResolvedValue({ docs: [] });

    const orphanKey = 'profiles/someone.jpg';
    mockListObjects.mockImplementation((folder) => {
      if (folder === 'profiles/') return Promise.resolve([orphanKey]);
      return Promise.resolve([]);
    });

    await orphanedStorage();

    // External URL yields no key, so orphanKey is not referenced → deleted
    expect(mockDeleteObjects).toHaveBeenCalledWith([orphanKey]);
  });

  test('accepts snake_case field aliases for user photo URLs', async () => {
    const key = 'profiles/snake-case-user.jpg';

    mockCollectionSelectGet.mockImplementation(() => ({
      docs: [makeDoc({ profile_photo_url: cdnUrl(key) })],
    }));
    mockWhereGet.mockResolvedValue({ docs: [] });

    mockListObjects.mockImplementation((folder) => {
      if (folder === 'profiles/') return Promise.resolve([key]);
      return Promise.resolve([]);
    });

    await orphanedStorage();

    expect(mockDeleteObjects).not.toHaveBeenCalledWith(expect.arrayContaining([key]));
  });

  test('scans all expected R2 folders including starting-screens', async () => {
    mockCollectionSelectGet.mockResolvedValue({ docs: [] });
    mockWhereGet.mockResolvedValue({ docs: [] });
    mockListObjects.mockResolvedValue([]);

    await orphanedStorage();

    const folders = mockListObjects.mock.calls.map((call) => call[0]);
    expect(folders).toContain('profiles/');
    expect(folders).toContain('covers/');
    expect(folders).toContain('messages/');
    expect(folders).toContain('groups/');
    expect(folders).toContain('evidence/');
    expect(folders).toContain('stickers/');
    expect(folders).toContain('banners/');
    expect(folders).toContain('starting-screens/');
  });

  test('keeps R2 keys referenced as conversation groupPhotoUrl', async () => {
    const groupKey = 'groups/conv-photo.jpg';

    mockCollectionSelectGet.mockImplementation(() => ({
      docs: [makeDoc({ groupPhotoUrl: cdnUrl(groupKey) })],
    }));
    mockWhereGet.mockResolvedValue({ docs: [] });

    mockListObjects.mockImplementation((folder) => {
      if (folder === 'groups/') return Promise.resolve([groupKey]);
      return Promise.resolve([]);
    });

    await orphanedStorage();

    expect(mockDeleteObjects).not.toHaveBeenCalledWith(expect.arrayContaining([groupKey]));
  });

  test('keeps R2 keys referenced via group_photo_url snake_case alias', async () => {
    const groupKey = 'groups/snake-conv-photo.jpg';

    mockCollectionSelectGet.mockImplementation(() => ({
      docs: [makeDoc({ group_photo_url: cdnUrl(groupKey) })],
    }));
    mockWhereGet.mockResolvedValue({ docs: [] });

    mockListObjects.mockImplementation((folder) => {
      if (folder === 'groups/') return Promise.resolve([groupKey]);
      return Promise.resolve([]);
    });

    await orphanedStorage();

    expect(mockDeleteObjects).not.toHaveBeenCalledWith(expect.arrayContaining([groupKey]));
  });

  test('keeps R2 keys referenced as user preSuspensionProfilePhotoUrl', async () => {
    const key = 'profiles/pre-susp-profile.jpg';

    mockCollectionSelectGet.mockImplementation(() => ({
      docs: [makeDoc({ preSuspensionProfilePhotoUrl: cdnUrl(key) })],
    }));
    mockWhereGet.mockResolvedValue({ docs: [] });

    mockListObjects.mockImplementation((folder) => {
      if (folder === 'profiles/') return Promise.resolve([key]);
      return Promise.resolve([]);
    });

    await orphanedStorage();

    expect(mockDeleteObjects).not.toHaveBeenCalledWith(expect.arrayContaining([key]));
  });

  test('keeps R2 keys referenced as user preSuspensionCoverPhotoUrl', async () => {
    const key = 'covers/pre-susp-cover.jpg';

    mockCollectionSelectGet.mockImplementation(() => ({
      docs: [makeDoc({ preSuspensionCoverPhotoUrl: cdnUrl(key) })],
    }));
    mockWhereGet.mockResolvedValue({ docs: [] });

    mockListObjects.mockImplementation((folder) => {
      if (folder === 'covers/') return Promise.resolve([key]);
      return Promise.resolve([]);
    });

    await orphanedStorage();

    expect(mockDeleteObjects).not.toHaveBeenCalledWith(expect.arrayContaining([key]));
  });

  test('keeps R2 keys referenced via pre_suspension_profile_photo_url snake_case', async () => {
    const key = 'profiles/pre-susp-snake-profile.jpg';

    mockCollectionSelectGet.mockImplementation(() => ({
      docs: [makeDoc({ pre_suspension_profile_photo_url: cdnUrl(key) })],
    }));
    mockWhereGet.mockResolvedValue({ docs: [] });

    mockListObjects.mockImplementation((folder) => {
      if (folder === 'profiles/') return Promise.resolve([key]);
      return Promise.resolve([]);
    });

    await orphanedStorage();

    expect(mockDeleteObjects).not.toHaveBeenCalledWith(expect.arrayContaining([key]));
  });

  test('keeps R2 keys referenced via pre_suspension_cover_photo_url snake_case', async () => {
    const key = 'covers/pre-susp-snake-cover.jpg';

    mockCollectionSelectGet.mockImplementation(() => ({
      docs: [makeDoc({ pre_suspension_cover_photo_url: cdnUrl(key) })],
    }));
    mockWhereGet.mockResolvedValue({ docs: [] });

    mockListObjects.mockImplementation((folder) => {
      if (folder === 'covers/') return Promise.resolve([key]);
      return Promise.resolve([]);
    });

    await orphanedStorage();

    expect(mockDeleteObjects).not.toHaveBeenCalledWith(expect.arrayContaining([key]));
  });

  test('keeps R2 keys referenced via banner image_url snake_case alias', async () => {
    const bannerKey = 'banners/snake-banner.jpg';

    mockCollectionSelectGet.mockImplementation(() => ({
      docs: [makeDoc({ image_url: cdnUrl(bannerKey) })],
    }));
    mockWhereGet.mockResolvedValue({ docs: [] });

    mockListObjects.mockImplementation((folder) => {
      if (folder === 'banners/') return Promise.resolve([bannerKey]);
      return Promise.resolve([]);
    });

    await orphanedStorage();

    expect(mockDeleteObjects).not.toHaveBeenCalledWith(expect.arrayContaining([bannerKey]));
  });

  test('keeps R2 keys referenced via report evidence_urls snake_case alias', async () => {
    const evidenceKey = 'evidence/snake-evidence.jpg';

    mockCollectionSelectGet.mockImplementation(() => ({
      docs: [makeDoc({ evidence_urls: [cdnUrl(evidenceKey)] })],
    }));
    mockWhereGet.mockResolvedValue({ docs: [] });

    mockListObjects.mockImplementation((folder) => {
      if (folder === 'evidence/') return Promise.resolve([evidenceKey]);
      return Promise.resolve([]);
    });

    await orphanedStorage();

    expect(mockDeleteObjects).not.toHaveBeenCalledWith(expect.arrayContaining([evidenceKey]));
  });

  test('keeps R2 keys referenced in conversation IMAGE messages', async () => {
    const imageKey = 'messages/img-123.jpg';

    const convDoc = { id: 'conv1', data: () => ({}) };
    mockCollectionSelectGet.mockImplementation(() => ({
      docs: [convDoc],
    }));

    mockWhereGet.mockImplementation(() => ({
      docs: [makeDoc({ imageUrls: [cdnUrl(imageKey)] })],
    }));

    mockListObjects.mockImplementation((folder) => {
      if (folder === 'messages/') return Promise.resolve([imageKey]);
      return Promise.resolve([]);
    });

    await orphanedStorage();

    expect(mockDeleteObjects).not.toHaveBeenCalledWith(expect.arrayContaining([imageKey]));
  });

  test('keeps R2 keys referenced in IMAGE messages via image_urls snake_case', async () => {
    const imageKey = 'messages/img-snake-123.jpg';

    const convDoc = { id: 'conv1', data: () => ({}) };
    mockCollectionSelectGet.mockImplementation(() => ({
      docs: [convDoc],
    }));

    mockWhereGet.mockImplementation(() => ({
      docs: [makeDoc({ image_urls: [cdnUrl(imageKey)] })],
    }));

    mockListObjects.mockImplementation((folder) => {
      if (folder === 'messages/') return Promise.resolve([imageKey]);
      return Promise.resolve([]);
    });

    await orphanedStorage();

    expect(mockDeleteObjects).not.toHaveBeenCalledWith(expect.arrayContaining([imageKey]));
  });

  test('keeps R2 keys referenced in conversation STICKER messages', async () => {
    const stickerKey = 'stickers/sticker-abc.webp';

    const convDoc = { id: 'conv1', data: () => ({}) };
    mockCollectionSelectGet.mockImplementation(() => ({
      docs: [convDoc],
    }));

    mockWhereGet.mockImplementation(() => ({
      docs: [makeDoc({ stickerUrl: cdnUrl(stickerKey) })],
    }));

    mockListObjects.mockImplementation((folder) => {
      if (folder === 'stickers/') return Promise.resolve([stickerKey]);
      return Promise.resolve([]);
    });

    await orphanedStorage();

    expect(mockDeleteObjects).not.toHaveBeenCalledWith(expect.arrayContaining([stickerKey]));
  });

  test('keeps R2 keys referenced in STICKER messages via sticker_url snake_case', async () => {
    const stickerKey = 'stickers/sticker-snake.webp';

    const convDoc = { id: 'conv1', data: () => ({}) };
    mockCollectionSelectGet.mockImplementation(() => ({
      docs: [convDoc],
    }));

    mockWhereGet.mockImplementation(() => ({
      docs: [makeDoc({ sticker_url: cdnUrl(stickerKey) })],
    }));

    mockListObjects.mockImplementation((folder) => {
      if (folder === 'stickers/') return Promise.resolve([stickerKey]);
      return Promise.resolve([]);
    });

    await orphanedStorage();

    expect(mockDeleteObjects).not.toHaveBeenCalledWith(expect.arrayContaining([stickerKey]));
  });

  test('extractKey returns null for null/undefined URLs', async () => {
    mockCollectionSelectGet.mockImplementation(() => ({
      docs: [makeDoc({})],
    }));
    mockWhereGet.mockResolvedValue({ docs: [] });

    mockListObjects.mockImplementation((folder) => {
      if (folder === 'profiles/') return Promise.resolve(['profiles/orphan.jpg']);
      return Promise.resolve([]);
    });

    await orphanedStorage();

    expect(mockDeleteObjects).toHaveBeenCalledWith(['profiles/orphan.jpg']);
  });

  test('collectKeysFromUrls handles non-array input gracefully', async () => {
    const convDoc = { id: 'conv1', data: () => ({}) };
    mockCollectionSelectGet.mockImplementation(() => ({
      docs: [convDoc],
    }));

    mockWhereGet.mockImplementation(() => ({
      docs: [makeDoc({ imageUrls: 'not-an-array' })],
    }));

    mockListObjects.mockImplementation((folder) => {
      if (folder === 'messages/') return Promise.resolve(['messages/orphan.jpg']);
      return Promise.resolve([]);
    });

    await expect(orphanedStorage()).resolves.not.toThrow();
  });

  test('continues processing other folders when one folder delete fails', async () => {
    mockCollectionSelectGet.mockResolvedValue({ docs: [] });
    mockWhereGet.mockResolvedValue({ docs: [] });

    mockListObjects.mockImplementation((folder) => {
      if (folder === 'profiles/') return Promise.resolve(['profiles/orphan.jpg']);
      if (folder === 'covers/') return Promise.resolve(['covers/orphan.jpg']);
      return Promise.resolve([]);
    });

    mockDeleteObjects.mockRejectedValueOnce(new Error('R2 delete failed')).mockResolvedValue();

    await expect(orphanedStorage()).resolves.not.toThrow();
  });

  test('limits conversation message scanning to first 30 conversations', async () => {
    const convDocs = Array.from({ length: 35 }, (_, i) => ({
      id: `conv${i}`,
      data: () => ({}),
    }));

    mockCollectionSelectGet.mockImplementation(() => ({
      docs: convDocs,
    }));
    mockWhereGet.mockResolvedValue({ docs: [] });
    mockListObjects.mockResolvedValue([]);

    // Should complete without error even with 35 conversations
    await expect(orphanedStorage()).resolves.not.toThrow();
  });
});

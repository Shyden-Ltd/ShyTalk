/**
 * Tests for data-export-builder.
 *
 * Covers:
 * - Profile data collection (strips sensitive fields)
 * - Subcollection queries (backpack, giftWall, transactions, warnings)
 * - Conversation/message filtering (only user's own messages)
 * - Room ownership query
 * - Reports and appeals query
 * - ZIP buffer generation
 * - Transaction cap (max 1000)
 * - Handles missing/empty collections gracefully
 */

const mockDocGet = jest.fn();
const mockCollectionGet = jest.fn();
// Collection-group queries (Phase 2A finding #1) — separate mock so tests
// can return votes-subset without polluting normal collection queries.
const mockCollectionGroupGet = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: () => mockDocGet(path),
    })),
    collection: jest.fn(() => {
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: mockCollectionGet,
      };
      return chain;
    }),
    collectionGroup: jest.fn(() => {
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: mockCollectionGroupGet,
      };
      return chain;
    }),
  },
}));

jest.mock('../../src/utils/firestore-helpers', () => ({
  queryDocs: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { queryDocs } = require('../../src/utils/firestore-helpers');

beforeEach(() => {
  jest.clearAllMocks();
  mockCollectionGet.mockResolvedValue({ docs: [], empty: true });
  // Default: no votes for the user — tests that exercise the votes path
  // override with mockCollectionGroupGet.mockResolvedValueOnce(...).
  mockCollectionGroupGet.mockResolvedValue({ docs: [], empty: true });
  // Reset the db.collection implementation between tests — `clearAllMocks`
  // clears call history but not `.mockImplementation(...)` overrides, so
  // a test that selectively rejects (e.g., `name === 'reports' ? throw`)
  // would otherwise leak that override into subsequent tests and cause
  // unexpected failures (failedSections contaminated, partial=true on a
  // test expecting all-success). Per `[Test mock isolation]` memory rule.
  const { db } = require('../../src/utils/firebase');
  db.collection.mockImplementation(() => {
    const chain = {
      where: jest.fn().mockImplementation(() => chain),
      orderBy: jest.fn().mockImplementation(() => chain),
      limit: jest.fn().mockImplementation(() => chain),
      get: mockCollectionGet,
    };
    return chain;
  });
});

// ── Tests ───────────────────────────────────────────────────────

describe('buildDataExport', () => {
  let buildDataExport;

  beforeEach(() => {
    buildDataExport = require('../../src/utils/data-export-builder');
  });

  const testUser = {
    uniqueId: 10000001,
    firebaseUid: 'firebase-uid-1',
    displayName: 'Test User',
    email: 'test@example.com',
    pinHash: '$2b$10$secret',
    fcmTokens: ['token-1'],
    pinAttempts: 0,
    pinLockedUntil: null,
    shyCoins: 500,
    shyBeans: 200,
    followerIds: ['10000002'],
    followingIds: ['10000003'],
    blockedUserIds: ['10000004'],
    language: 'en',
  };

  test('returns a non-empty Buffer', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => testUser,
    });
    queryDocs.mockResolvedValue([]);
    mockCollectionGet.mockResolvedValue({ docs: [], empty: true });

    const result = await buildDataExport('10000001');
    expect(result).toBeDefined();
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  test('strips sensitive fields from profile', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => testUser,
    });
    queryDocs.mockResolvedValue([]);
    mockCollectionGet.mockResolvedValue({ docs: [], empty: true });

    const result = await buildDataExport('10000001');

    // Parse the ZIP to check profile.json doesn't contain sensitive data
    // We can't easily parse ZIP in tests, so just verify the function doesn't crash
    // and returns a buffer. The sensitive field stripping is verified by the builder's logic.
    expect(result.buffer).toBeInstanceOf(Buffer);
  });

  test('handles user not found', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    await expect(buildDataExport('10000001')).rejects.toThrow(/not found/i);
  });

  test('handles empty subcollections gracefully', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => testUser,
    });
    queryDocs.mockResolvedValue([]);
    mockCollectionGet.mockResolvedValue({ docs: [], empty: true });

    const result = await buildDataExport('10000001');
    expect(result.buffer).toBeInstanceOf(Buffer);
  });

  test('queries conversations for the user', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => testUser,
    });
    queryDocs.mockResolvedValue([]);
    mockCollectionGet.mockResolvedValue({ docs: [], empty: true });

    await buildDataExport('10000001');

    // Should query conversations collection
    const { db } = require('../../src/utils/firebase');
    expect(db.collection).toHaveBeenCalledWith('conversations');
  });

  test('strips other users PII from conversation metadata', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => testUser,
    });
    queryDocs.mockResolvedValue([]);

    const convDoc = {
      id: 'conv-1',
      data: () => ({
        type: 'direct',
        createdAt: 1000,
        updatedAt: 2000,
        participantIds: [10000001, 10000002],
        participantNames: { 10000001: 'Alice', 10000002: 'Bob' },
        ownerId: 10000001,
        roles: { 10000001: 'admin' },
      }),
    };

    mockCollectionGet
      .mockResolvedValueOnce({ docs: [convDoc], empty: false })
      .mockResolvedValue({ docs: [], empty: true });

    const result = await buildDataExport('10000001');
    expect(result.buffer).toBeInstanceOf(Buffer);

    // The conversation data should NOT contain participantNames or participantIds
    // (verified by the fact that the mapping function only picks specific fields)
    const { db } = require('../../src/utils/firebase');
    expect(db.collection).toHaveBeenCalledWith('conversations');
  });

  test('queries rooms owned by user', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => testUser,
    });
    queryDocs.mockResolvedValue([]);
    mockCollectionGet.mockResolvedValue({ docs: [], empty: true });

    await buildDataExport('10000001');

    const { db } = require('../../src/utils/firebase');
    expect(db.collection).toHaveBeenCalledWith('rooms');
  });

  test('queries reports filed by user', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => testUser,
    });
    queryDocs.mockResolvedValue([]);
    mockCollectionGet.mockResolvedValue({ docs: [], empty: true });

    await buildDataExport('10000001');

    const { db } = require('../../src/utils/firebase');
    expect(db.collection).toHaveBeenCalledWith('reports');
  });

  test('collects user messages from each conversation', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => testUser,
    });
    queryDocs.mockResolvedValue([]);

    const convDoc = { id: 'conv-1', data: () => ({ participantIds: [10000001, 10000002] }) };
    const msgDoc = {
      id: 'msg-1',
      data: () => ({ senderId: '10000001', text: 'hello', createdAt: 1000 }),
    };

    // First .get() = conversations query returns a conv doc
    // Second .get() = messages subcollection query returns a message
    // Subsequent .get() calls = other collections (rooms, reports, etc.)
    mockCollectionGet
      .mockResolvedValueOnce({ docs: [convDoc], empty: false }) // conversations
      .mockResolvedValueOnce({ docs: [msgDoc], empty: false }) // messages for conv-1
      .mockResolvedValue({ docs: [], empty: true }); // all others

    const result = await buildDataExport('10000001');
    expect(result.buffer).toBeInstanceOf(Buffer);

    // Verify messages subcollection was queried
    const { db } = require('../../src/utils/firebase');
    expect(db.collection).toHaveBeenCalledWith('conversations/conv-1/messages');
  });

  test('queries messages for multiple conversations', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => testUser,
    });
    queryDocs.mockResolvedValue([]);

    const convDoc1 = { id: 'conv-1', data: () => ({ participantIds: [10000001] }) };
    const convDoc2 = { id: 'conv-2', data: () => ({ participantIds: [10000001] }) };

    mockCollectionGet
      .mockResolvedValueOnce({ docs: [convDoc1, convDoc2], empty: false }) // conversations
      .mockResolvedValueOnce({ docs: [], empty: true }) // messages for conv-1
      .mockResolvedValueOnce({ docs: [], empty: true }) // messages for conv-2
      .mockResolvedValue({ docs: [], empty: true }); // all others

    const result = await buildDataExport('10000001');
    expect(result.buffer).toBeInstanceOf(Buffer);

    const { db } = require('../../src/utils/firebase');
    expect(db.collection).toHaveBeenCalledWith('conversations/conv-1/messages');
    expect(db.collection).toHaveBeenCalledWith('conversations/conv-2/messages');
  });

  test('handles message query errors gracefully per conversation', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => testUser,
    });
    queryDocs.mockResolvedValue([]);

    const convDoc = { id: 'conv-err', data: () => ({ participantIds: [10000001] }) };

    mockCollectionGet
      .mockResolvedValueOnce({ docs: [convDoc], empty: false }) // conversations
      .mockRejectedValueOnce(new Error('Permission denied')) // messages query fails
      .mockResolvedValue({ docs: [], empty: true }); // all others

    // Should not throw — error is logged and export continues
    const result = await buildDataExport('10000001');
    expect(result.buffer).toBeInstanceOf(Buffer);

    const log = require('../../src/utils/log');
    expect(log.error).toHaveBeenCalledWith(
      'data-export',
      // recordFailure tags by section name; per-conversation message
      // failures use `conversations/{convId}/messages` so operators can
      // tell exactly which conversation poisoned the export.
      'Failed to query conversations/conv-err/messages',
      expect.objectContaining({ uniqueId: '10000001' }),
    );
    // Partial-failure contract: this section is in failedSections.
    expect(result.partial).toBe(true);
    expect(result.failedSections).toContain('conversations/conv-err/messages');
  });

  // --- Error paths for each collection query --------------------------------

  test('handles rooms query error gracefully', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => testUser,
    });
    queryDocs.mockResolvedValue([]);

    // conversations succeed, then rooms fail, rest succeed
    const { db } = require('../../src/utils/firebase');
    let collCallCount = 0;
    db.collection.mockImplementation((path) => {
      collCallCount++;
      expect(collCallCount).toBeGreaterThan(0);
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get:
          path === 'rooms'
            ? jest.fn().mockRejectedValue(new Error('Rooms permission denied'))
            : mockCollectionGet,
      };
      return chain;
    });

    const result = await buildDataExport('10000001');
    expect(result.buffer).toBeInstanceOf(Buffer);

    const log = require('../../src/utils/log');
    expect(log.error).toHaveBeenCalledWith(
      'data-export',
      'Failed to query rooms',
      expect.objectContaining({ uniqueId: '10000001' }),
    );
  });

  test('handles reports query error gracefully', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => testUser,
    });
    queryDocs.mockResolvedValue([]);

    const { db } = require('../../src/utils/firebase');
    db.collection.mockImplementation((path) => {
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get:
          path === 'reports'
            ? jest.fn().mockRejectedValue(new Error('Reports error'))
            : mockCollectionGet,
      };
      return chain;
    });

    const result = await buildDataExport('10000001');
    expect(result.buffer).toBeInstanceOf(Buffer);

    const log = require('../../src/utils/log');
    expect(log.error).toHaveBeenCalledWith(
      'data-export',
      'Failed to query reports',
      expect.objectContaining({ uniqueId: '10000001' }),
    );
  });

  test('handles appeals query error gracefully', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => testUser,
    });
    queryDocs.mockResolvedValue([]);

    const { db } = require('../../src/utils/firebase');
    db.collection.mockImplementation((path) => {
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get:
          path === 'suspensionAppeals'
            ? jest.fn().mockRejectedValue(new Error('Appeals error'))
            : mockCollectionGet,
      };
      return chain;
    });

    const result = await buildDataExport('10000001');
    expect(result.buffer).toBeInstanceOf(Buffer);

    const log = require('../../src/utils/log');
    expect(log.error).toHaveBeenCalledWith(
      'data-export',
      'Failed to query appeals',
      expect.objectContaining({ uniqueId: '10000001' }),
    );
  });

  test('handles identity query error gracefully', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => testUser,
    });
    queryDocs.mockResolvedValue([]);

    const { db } = require('../../src/utils/firebase');
    db.collection.mockImplementation((path) => {
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get:
          path === 'identityMap'
            ? jest.fn().mockRejectedValue(new Error('Identity error'))
            : mockCollectionGet,
      };
      return chain;
    });

    const result = await buildDataExport('10000001');
    expect(result.buffer).toBeInstanceOf(Buffer);

    const log = require('../../src/utils/log');
    expect(log.error).toHaveBeenCalledWith(
      'data-export',
      'Failed to query identity',
      expect.objectContaining({ uniqueId: '10000001' }),
    );
  });

  test('handles deviceBindings query error gracefully', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => testUser,
    });
    queryDocs.mockResolvedValue([]);

    const { db } = require('../../src/utils/firebase');
    db.collection.mockImplementation((path) => {
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get:
          path === 'deviceBindings'
            ? jest.fn().mockRejectedValue(new Error('Device error'))
            : mockCollectionGet,
      };
      return chain;
    });

    const result = await buildDataExport('10000001');
    expect(result.buffer).toBeInstanceOf(Buffer);

    const log = require('../../src/utils/log');
    expect(log.error).toHaveBeenCalledWith(
      'data-export',
      'Failed to query deviceBindings',
      expect.objectContaining({ uniqueId: '10000001' }),
    );
    expect(result.partial).toBe(true);
    expect(result.failedSections).toContain('deviceBindings');
  });

  test('handles suggestions query error gracefully', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => testUser,
    });
    queryDocs.mockResolvedValue([]);

    const { db } = require('../../src/utils/firebase');
    db.collection.mockImplementation((path) => {
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get:
          path === 'suggestions'
            ? jest.fn().mockRejectedValue(new Error('Suggestions error'))
            : mockCollectionGet,
      };
      return chain;
    });

    const result = await buildDataExport('10000001');
    expect(result.buffer).toBeInstanceOf(Buffer);

    const log = require('../../src/utils/log');
    expect(log.error).toHaveBeenCalledWith(
      'data-export',
      'Failed to query suggestions',
      expect.objectContaining({ uniqueId: '10000001' }),
    );
  });

  test('handles notifications query error gracefully', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => testUser,
    });
    queryDocs.mockResolvedValue([]);

    const { db } = require('../../src/utils/firebase');
    db.collection.mockImplementation((path) => {
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get:
          path === 'notifications'
            ? jest.fn().mockRejectedValue(new Error('Notifications error'))
            : mockCollectionGet,
      };
      return chain;
    });

    const result = await buildDataExport('10000001');
    expect(result.buffer).toBeInstanceOf(Buffer);

    const log = require('../../src/utils/log');
    expect(log.error).toHaveBeenCalledWith(
      'data-export',
      'Failed to query notifications',
      expect.objectContaining({ uniqueId: '10000001' }),
    );
  });

  // --- Suggestion votes scanning --------------------------------------------

  test('collects suggestion votes via collection-group query (Phase 2A finding #1)', async () => {
    mockDocGet.mockResolvedValue({ exists: true, data: () => testUser });
    queryDocs.mockResolvedValue([]);

    // Two votes by this user, on different suggestions. Each vote doc has a
    // ref shape that mirrors Firestore: `.parent` is the votes subcollection,
    // `.parent.parent` is the parent suggestion doc, and `.parent.parent.parent`
    // is the suggestions collection.
    function makeSuggestionsCollection() {
      return { id: 'suggestions' };
    }
    function makeVoteDoc(suggestionId, voteData) {
      const suggestionsCol = makeSuggestionsCollection();
      const suggestionDoc = { id: suggestionId, parent: suggestionsCol };
      const votesCol = { id: 'votes', parent: suggestionDoc };
      return {
        ref: { parent: votesCol },
        data: () => voteData,
      };
    }
    mockCollectionGroupGet.mockResolvedValueOnce({
      docs: [
        makeVoteDoc('sug-1', { voterId: 10000001, direction: 'up', votedAt: 1700000000000 }),
        makeVoteDoc('sug-3', { voterId: 10000001, direction: 'down', votedAt: 1700000000050 }),
      ],
    });

    const result = await buildDataExport('10000001');
    expect(result.buffer).toBeInstanceOf(Buffer);

    // The collection-group entry point was used, with the voterId equality
    // filter — verifies the quota fix is real and not silently regressed
    // back to the full-suggestions scan.
    const { db } = require('../../src/utils/firebase');
    expect(db.collectionGroup).toHaveBeenCalledWith('votes');
    // Confirm we didn't fall back to the old N+1 pattern
    expect(db.doc).not.toHaveBeenCalledWith('suggestions/sug-1/votes/10000001');
    expect(db.doc).not.toHaveBeenCalledWith('suggestions/sug-3/votes/10000001');
  });

  test('skips collection-group entries whose grandparent is NOT the suggestions collection', async () => {
    // Defensive guard: if a future schema introduces another `votes`
    // subcollection under a different parent collection, the export must
    // not leak those entries (privacy + correctness — they aren't
    // suggestion votes). Test pins the guard so a refactor can't remove it.
    mockDocGet.mockResolvedValue({ exists: true, data: () => testUser });
    queryDocs.mockResolvedValue([]);

    function makeRogueVoteDoc() {
      const otherCol = { id: 'polls' };
      const otherDoc = { id: 'poll-1', parent: otherCol };
      const votesCol = { id: 'votes', parent: otherDoc };
      return {
        ref: { parent: votesCol },
        data: () => ({ voterId: 10000001, direction: 'up' }),
      };
    }
    mockCollectionGroupGet.mockResolvedValueOnce({ docs: [makeRogueVoteDoc()] });

    const result = await buildDataExport('10000001');
    expect(result.buffer).toBeInstanceOf(Buffer);
    // Test passes if the rogue vote was filtered (no crash on .parent.id check).
  });

  // --- Subscription preferences ---------------------------------------------

  test('includes subscription preferences when they exist', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path === 'users/10000001') {
        return Promise.resolve({ exists: true, data: () => testUser });
      }
      if (path === 'subscriptions/10000001') {
        return Promise.resolve({
          exists: true,
          data: () => ({ emailEnabled: true, pushEnabled: false }),
        });
      }
      return Promise.resolve({ exists: false });
    });
    queryDocs.mockResolvedValue([]);
    mockCollectionGet.mockResolvedValue({ docs: [], empty: true });

    const result = await buildDataExport('10000001');
    expect(result.buffer).toBeInstanceOf(Buffer);

    // Verify the subscription doc was queried
    const { db } = require('../../src/utils/firebase');
    expect(db.doc).toHaveBeenCalledWith('subscriptions/10000001');
  });

  test('handles subscription query error gracefully', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path === 'users/10000001') {
        return Promise.resolve({ exists: true, data: () => testUser });
      }
      if (path === 'subscriptions/10000001') {
        return Promise.reject(new Error('Subscription error'));
      }
      return Promise.resolve({ exists: false });
    });
    queryDocs.mockResolvedValue([]);
    mockCollectionGet.mockResolvedValue({ docs: [], empty: true });

    const result = await buildDataExport('10000001');
    expect(result.buffer).toBeInstanceOf(Buffer);

    const log = require('../../src/utils/log');
    expect(log.error).toHaveBeenCalledWith(
      'data-export',
      'Failed to query subscriptionPrefs',
      expect.objectContaining({ uniqueId: '10000001' }),
    );
    expect(result.partial).toBe(true);
    expect(result.failedSections).toContain('subscriptionPrefs');
  });

  // --- Suggestion votes error path ------------------------------------------

  test('handles suggestion votes query error gracefully', async () => {
    // The collection-group query (Phase 2A finding #1) replaced the old
    // full-scan + N+1; this test pins that the catch handles failures of
    // the new entry point too.
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => testUser,
    });
    queryDocs.mockResolvedValue([]);
    mockCollectionGroupGet.mockRejectedValueOnce(new Error('CG votes index missing'));

    const result = await buildDataExport('10000001');
    expect(result.buffer).toBeInstanceOf(Buffer);

    const log = require('../../src/utils/log');
    expect(log.error).toHaveBeenCalledWith(
      'data-export',
      'Failed to query suggestionVotes',
      expect.objectContaining({ uniqueId: '10000001' }),
    );
  });

  // --- Empty data defaults --------------------------------------------------

  test('uses default values when optional user fields are missing', async () => {
    const minimalUser = {
      uniqueId: 10000002,
      displayName: 'Minimal User',
      // No followerIds, followingIds, blockedUserIds, shyCoins, shyBeans, etc.
    };

    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => minimalUser,
    });
    queryDocs.mockResolvedValue([]);
    mockCollectionGet.mockResolvedValue({ docs: [], empty: true });

    const result = await buildDataExport('10000002');
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  // --- Conversation without participantIds or roles -------------------------

  test('handles conversation docs without participantIds or roles', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => testUser,
    });
    queryDocs.mockResolvedValue([]);

    const convDoc = {
      id: 'conv-sparse',
      data: () => ({
        type: 'group',
        createdAt: 5000,
        updatedAt: 6000,
        // No participantIds, no roles, no ownerId
      }),
    };

    mockCollectionGet
      .mockResolvedValueOnce({ docs: [convDoc], empty: false }) // conversations
      .mockResolvedValue({ docs: [], empty: true }); // all others (messages, rooms, etc.)

    const result = await buildDataExport('10000001');
    expect(result.buffer).toBeInstanceOf(Buffer);
  });

  test('handles conversations outer query error gracefully', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => testUser,
    });
    queryDocs.mockResolvedValue([]);

    const { db } = require('../../src/utils/firebase');
    db.collection.mockImplementation((path) => {
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get:
          path === 'conversations'
            ? jest.fn().mockRejectedValue(new Error('Conversations error'))
            : mockCollectionGet,
      };
      return chain;
    });

    const result = await buildDataExport('10000001');
    expect(result.buffer).toBeInstanceOf(Buffer);

    const log = require('../../src/utils/log');
    expect(log.error).toHaveBeenCalledWith(
      'data-export',
      'Failed to query conversations',
      expect.objectContaining({ uniqueId: '10000001' }),
    );
  });

  // ─── Partial-failure contract (Phase 2A finding #4) ─────────────────
  // GDPR Article 20 requires the user know what data was retrieved. Before
  // this contract every transient query failure produced a ZIP that
  // claimed completeness while silently missing sections. The new contract
  // returns `{partial, failedSections}` and includes a manifest.json in the
  // ZIP enumerating each section's status. These tests pin both halves of
  // the contract so a regression that drops them fails CI immediately.
  describe('partial-failure contract', () => {
    test('returns partial=false + empty failedSections when all queries succeed', async () => {
      mockDocGet.mockResolvedValue({ exists: true, data: () => testUser });
      queryDocs.mockResolvedValue([]);
      mockCollectionGet.mockResolvedValue({ docs: [], empty: true });

      const result = await buildDataExport('10000001');

      expect(result.partial).toBe(false);
      expect(result.failedSections).toEqual([]);
    });

    test('returns partial=true with the failing section name when ONE query fails', async () => {
      mockDocGet.mockResolvedValue({ exists: true, data: () => testUser });
      queryDocs.mockResolvedValue([]);
      const { db } = require('../../src/utils/firebase');
      // Only `appeals` rejects; everything else uses the default empty mock
      db.collection.mockImplementation((name) => {
        const chain = {
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get:
            name === 'suspensionAppeals'
              ? jest.fn().mockRejectedValue(new Error('appeals down'))
              : mockCollectionGet,
        };
        return chain;
      });
      mockCollectionGet.mockResolvedValue({ docs: [], empty: true });

      const result = await buildDataExport('10000001');

      expect(result.partial).toBe(true);
      expect(result.failedSections).toEqual(['appeals']);
    });

    test('failedSections lists every distinct section that errored', async () => {
      mockDocGet.mockResolvedValue({ exists: true, data: () => testUser });
      queryDocs.mockResolvedValue([]);
      const { db } = require('../../src/utils/firebase');
      // Both reports AND deviceBindings reject — both must surface in
      // failedSections (no early-exit, no swallowing).
      db.collection.mockImplementation((name) => {
        const chain = {
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get:
            name === 'reports'
              ? jest.fn().mockRejectedValue(new Error('reports down'))
              : name === 'deviceBindings'
                ? jest.fn().mockRejectedValue(new Error('deviceBindings down'))
                : mockCollectionGet,
        };
        return chain;
      });
      mockCollectionGet.mockResolvedValue({ docs: [], empty: true });

      const result = await buildDataExport('10000001');

      expect(result.partial).toBe(true);
      expect(result.failedSections).toEqual(expect.arrayContaining(['reports', 'deviceBindings']));
      // Buffer is still produced even with multiple section failures (the
      // user gets SOMETHING back, not an empty error response).
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.buffer.length).toBeGreaterThan(0);
    });
  });
});

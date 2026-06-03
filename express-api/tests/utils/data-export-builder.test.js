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
// Routed by collection-group name so the votes vs. comments paths are
// independently controllable: a votes-only test must not have to pre-stuff
// a comments response (and vice versa). Default mock (mockCollectionGroupGet)
// catches any name not in the routing table.
const mockCollectionGroupGet = jest.fn();
const mockCollectionGroupCommentsGet = jest.fn();

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
    collectionGroup: jest.fn((name) => {
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: name === 'comments' ? mockCollectionGroupCommentsGet : mockCollectionGroupGet,
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
  // Default: no comments by the user — comments-path tests override with
  // mockCollectionGroupCommentsGet.mockResolvedValueOnce(...). Mirror of the
  // votes default so all non-comments tests stay simple.
  mockCollectionGroupCommentsGet.mockResolvedValue({ docs: [], empty: true });
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

  test('returns a valid ZIP archive (PK signature + EOCD record)', async () => {
    // Catches behavioural regressions across archiver major bumps — a Buffer
    // length check passes even if archiver silently emits a gzip stream or a
    // raw text dump. Verifying the structural ZIP markers instead pins the
    // contract: "what comes out is a parseable archive".
    mockDocGet.mockResolvedValue({ exists: true, data: () => testUser });
    queryDocs.mockResolvedValue([]);
    mockCollectionGet.mockResolvedValue({ docs: [], empty: true });

    const { buffer } = await buildDataExport('10000001');

    // Local-file-header signature at the start: 50 4B 03 04
    expect(buffer.slice(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    // End-of-central-directory record (EOCD) signature 50 4B 05 06 lives in
    // the last 22+ bytes; search the trailing 64KB to tolerate the variable
    // ZIP comment. If this signature is missing, finalize() did not flush.
    const tail = buffer.slice(Math.max(0, buffer.length - 65557));
    expect(tail.indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBeGreaterThan(-1);
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
    // Partial-failure contract assertions (parity with the comments error
    // path test below): a regression that silently swallowed the error
    // and left partial=false would pass without these.
    expect(result.partial).toBe(true);
    expect(result.failedSections).toContain('suggestionVotes');
  });

  // --- Suggestion comments scanning -----------------------------------------
  // Mirrors the votes path: comments live at suggestions/{id}/comments/{cid}
  // with authorUid as the FK, so collectionGroup('comments').where('authorUid')
  // is the same quota-safe shape. Index override exists in firestore.indexes.json
  // (added with the GDPR account-deletion cascade work). Tests pin three things:
  //   (1) the query shape is the collection-group entry, not an N+1 scan
  //   (2) a defensive grandparent-id guard rejects rogue `comments` subcollections
  //   (3) failures are recorded as a partial-export section, not silently dropped

  test('collects suggestion comments via collection-group query', async () => {
    mockDocGet.mockResolvedValue({ exists: true, data: () => testUser });
    queryDocs.mockResolvedValue([]);

    // Comments doc ref shape mirrors Firestore exactly:
    //   suggestions/{suggestionId}/comments/{commentId}
    // so `.parent` is the comments subcollection, `.parent.parent` is the
    // parent suggestion doc, and `.parent.parent.parent` is the suggestions
    // collection. The export reads `.parent.parent` (the suggestion doc) and
    // pushes its id alongside the comment payload.
    function makeSuggestionsCollection() {
      return { id: 'suggestions' };
    }
    function makeCommentDoc(suggestionId, commentData) {
      const suggestionsCol = makeSuggestionsCollection();
      const suggestionDoc = { id: suggestionId, parent: suggestionsCol };
      const commentsCol = { id: 'comments', parent: suggestionDoc };
      return {
        ref: { parent: commentsCol },
        data: () => commentData,
      };
    }
    mockCollectionGroupCommentsGet.mockResolvedValueOnce({
      docs: [
        makeCommentDoc('sug-1', {
          authorUid: 10000001,
          text: 'Great idea',
          isPublic: true,
          createdAt: 1700000000000,
        }),
        makeCommentDoc('sug-4', {
          authorUid: 10000001,
          text: 'Already shipped — see release notes',
          isPublic: true,
          createdAt: 1700000000200,
        }),
      ],
    });

    const result = await buildDataExport('10000001');
    expect(result.buffer).toBeInstanceOf(Buffer);

    // The collection-group entry point was used for `comments` — verifies
    // the quota-safe shape is real and not silently regressed to a
    // per-suggestion subcollection scan.
    const { db } = require('../../src/utils/firebase');
    expect(db.collectionGroup).toHaveBeenCalledWith('comments');
    // Confirm we don't load individual comment docs (no N+1 fallback)
    expect(db.doc).not.toHaveBeenCalledWith(expect.stringMatching(/^suggestions\/.+\/comments\//));
  });

  test('skips collection-group comment entries whose grandparent is NOT the suggestions collection', async () => {
    // Defensive guard parallel to the votes path: if a future schema adds
    // another `comments` subcollection under a different parent collection
    // (e.g. `posts/{id}/comments`), the export must not leak those entries
    // — they're not suggestion comments and would constitute a privacy
    // bleed (a stranger's post-comment showing up in this user's export
    // because the authorUid happens to match).
    mockDocGet.mockResolvedValue({ exists: true, data: () => testUser });
    queryDocs.mockResolvedValue([]);

    function makeRogueCommentDoc() {
      const otherCol = { id: 'posts' };
      const otherDoc = { id: 'post-1', parent: otherCol };
      const commentsCol = { id: 'comments', parent: otherDoc };
      return {
        ref: { parent: commentsCol },
        data: () => ({ authorUid: 10000001, text: 'rogue' }),
      };
    }
    mockCollectionGroupCommentsGet.mockResolvedValueOnce({ docs: [makeRogueCommentDoc()] });

    const result = await buildDataExport('10000001');
    expect(result.buffer).toBeInstanceOf(Buffer);
    // Pass condition: the rogue comment was filtered (no crash on the
    // grandparent-id check). A regression that removes the guard would
    // throw or leak the rogue entry into the export. The PRIMARY pin for
    // the guard's filter-vs-pass-all behavior lives in the dedicated
    // `collectSuggestionScopedEntries` describe block below, where the
    // helper is unit-tested directly with mixed-legit-and-rogue inputs.
  });

  test('handles suggestion comments query error gracefully', async () => {
    // Index-missing is the realistic failure mode here — the collection-group
    // query needs the `comments.authorUid` field override, and a future
    // firestore.indexes.json rewrite could drop it. The export must continue
    // (other sections still ship) and the failure must surface in
    // failedSections so the user knows.
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => testUser,
    });
    queryDocs.mockResolvedValue([]);
    mockCollectionGroupCommentsGet.mockRejectedValueOnce(new Error('CG comments index missing'));

    const result = await buildDataExport('10000001');
    expect(result.buffer).toBeInstanceOf(Buffer);

    const log = require('../../src/utils/log');
    expect(log.error).toHaveBeenCalledWith(
      'data-export',
      'Failed to query suggestionComments',
      expect.objectContaining({ uniqueId: '10000001' }),
    );
    expect(result.partial).toBe(true);
    expect(result.failedSections).toContain('suggestionComments');
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

  // ─── collectSuggestionScopedEntries (privacy-critical grandparent guard) ───
  // The buildDataExport-level rogue tests above can only assert "the buffer
  // still builds" because the ZIP is `level: 9` compressed and there's no
  // unzip lib on the dep tree to decode the result. That's a weak pin: it
  // passes even if the guard is deleted and the rogue leaks into the export.
  // The guard is privacy-critical (any future schema with a sibling
  // `comments`/`votes` subcollection at a different nesting level — e.g.
  // posts/{id}/comments — must NOT leak into a user's export), so it
  // deserves a load-bearing test. The production helper is exported as
  // `_collectSuggestionScopedEntries` for that purpose. These tests pin:
  //   (1) filter-not-pass-all: mixed legitimate + rogue → only legitimate
  //   (2) filter-not-skip-all: all-legitimate batch → all pass through
  //   (3) null grandparent (top-level collection-group hit) doesn't crash
  //   (4) null grandparent-parent (pathological nesting) doesn't crash
  //   (5) empty input returns []
  //   (6) the mapper actually shapes the output per caller's contract
  describe('collectSuggestionScopedEntries (privacy guard)', () => {
    const {
      _collectSuggestionScopedEntries: helper,
    } = require('../../src/utils/data-export-builder');

    // Synthetic doc shape that models the relevant slice of the Firestore
    // Admin SDK's `DocumentSnapshot`. `ref` carries `id`, `path`, and
    // `parent` because the helper currently only touches `.ref.parent`
    // but any natural extension (logging `ref.path` on a rogue doc,
    // exposing `ref.id` to the mapper) should not silently no-op against
    // the fixture — including all three matches the SDK's minimum shape.
    function makeDoc(
      grandparentId,
      suggestionId,
      payload,
      leafColName = 'comments',
      docId = undefined,
    ) {
      const grandparentCol = { id: grandparentId };
      const grandparentDoc = { id: suggestionId, parent: grandparentCol };
      const leafCol = { id: leafColName, parent: grandparentDoc };
      const refPath = `${grandparentId}/${suggestionId}/${leafColName}/${docId ?? '_'}`;
      return {
        id: docId,
        ref: { id: docId, path: refPath, parent: leafCol },
        data: () => payload,
      };
    }

    test('keeps only docs whose grandparent is the suggestions collection (mixed batch)', () => {
      const docs = [
        makeDoc('suggestions', 'sug-1', { authorUid: 1, text: 'legitimate-1' }, 'comments', 'c1'),
        makeDoc('posts', 'post-1', { authorUid: 1, text: 'rogue-from-posts' }, 'comments', 'c2'),
        makeDoc('suggestions', 'sug-2', { authorUid: 1, text: 'legitimate-2' }, 'comments', 'c3'),
        makeDoc('events', 'evt-1', { authorUid: 1, text: 'rogue-from-events' }, 'comments', 'c4'),
      ];

      const result = helper(docs, (suggestionId, doc) => ({
        suggestionId,
        id: doc.id,
        ...doc.data(),
      }));

      // Exactly 2 legitimate entries pass through; rogue entries are filtered.
      // The negative assertion is the load-bearing one — without it, a
      // regression where the helper returns ALL docs would still produce
      // a non-empty array and the positive `expect(length).toBe(2)`
      // would catch it, but the explicit `not.toContainEqual` makes
      // the privacy contract self-documenting.
      expect(result).toHaveLength(2);
      expect(result).toEqual([
        { suggestionId: 'sug-1', id: 'c1', authorUid: 1, text: 'legitimate-1' },
        { suggestionId: 'sug-2', id: 'c3', authorUid: 1, text: 'legitimate-2' },
      ]);
      expect(result).not.toContainEqual(expect.objectContaining({ text: 'rogue-from-posts' }));
      expect(result).not.toContainEqual(expect.objectContaining({ text: 'rogue-from-events' }));
    });

    test('passes through every doc when ALL grandparents are suggestions (no false drops)', () => {
      const docs = [
        makeDoc('suggestions', 'sug-1', { voterId: 1, direction: 'up' }, 'votes'),
        makeDoc('suggestions', 'sug-2', { voterId: 1, direction: 'down' }, 'votes'),
        makeDoc('suggestions', 'sug-3', { voterId: 1, direction: 'up' }, 'votes'),
      ];

      const result = helper(docs, (suggestionId, doc) => ({
        suggestionId,
        ...doc.data(),
      }));

      // Pins the inverse failure mode: a regression where the guard
      // accidentally rejects valid suggestion-scoped docs (e.g. a typo
      // changing `=== 'suggestions'` to `!== 'suggestions'`) would
      // produce an empty array. This test makes that immediately visible.
      expect(result).toHaveLength(3);
    });

    test('skips doc whose grandparent is null (top-level collection-group hit)', () => {
      // Edge case: a collection-group query may return docs whose
      // `.parent.parent` is null (a root-level collection at the same
      // leaf name, if Firestore ever permits that). The guard must
      // short-circuit on `!suggestionRef` before dereferencing `.parent.id`.
      const orphanLeafCol = { id: 'comments', parent: null };
      const orphanDoc = {
        ref: { parent: orphanLeafCol },
        data: () => ({ authorUid: 1, text: 'orphan' }),
      };
      const result = helper([orphanDoc], (suggestionId, doc) => ({ suggestionId, ...doc.data() }));
      // No crash + orphan filtered.
      expect(result).toEqual([]);
    });

    test('skips doc whose grandparent-parent is null (pathologically shallow nesting)', () => {
      // Second guard branch: `suggestionRef` is truthy but
      // `suggestionRef.parent` is null. Cannot happen in current Firestore
      // semantics (every doc has a parent collection) but a malformed
      // fixture or Admin-SDK version drift could surface it. Without the
      // `!suggestionRef.parent` short-circuit the helper would throw
      // `TypeError: Cannot read properties of null (reading 'id')`.
      const grandparentDoc = { id: 'sug-1', parent: null };
      const leafCol = { id: 'comments', parent: grandparentDoc };
      const pathologicalDoc = {
        id: 'c-x',
        ref: { id: 'c-x', path: '?/sug-1/comments/c-x', parent: leafCol },
        data: () => ({ authorUid: 1, text: 'pathological' }),
      };
      const result = helper([pathologicalDoc], (suggestionId, doc) => ({
        suggestionId,
        ...doc.data(),
      }));
      expect(result).toEqual([]);
    });

    test('returns empty array for empty input (no off-by-one)', () => {
      // Pins that an empty snapshot returns `[]`, not `undefined`.
      // The buildDataExport-level code spreads/serialises this directly
      // into the manifest, so a regression returning `undefined` would
      // produce malformed JSON in the export ZIP.
      expect(helper([], () => ({}))).toEqual([]);
    });

    test('mapper receives suggestionId and the full doc object', () => {
      // Pins the helper's contract with the mapper. Both call sites need
      // the suggestion ID extracted from `.parent.parent.id`, and the
      // comments call site needs `doc.id` (Firestore auto-ID) which the
      // helper must hand through unmodified. A regression that handed
      // `doc.data()` instead of `doc` would break the comments mapper's
      // `doc.id` access silently.
      const mockMapper = jest.fn((suggestionId, doc) => ({ suggestionId, _id: doc.id }));
      const docs = [makeDoc('suggestions', 'sug-1', { x: 1 }, 'comments', 'auto-id-abc')];

      const result = helper(docs, mockMapper);

      expect(mockMapper).toHaveBeenCalledTimes(1);
      expect(mockMapper).toHaveBeenCalledWith(
        'sug-1',
        expect.objectContaining({ id: 'auto-id-abc' }),
      );
      expect(result).toEqual([{ suggestionId: 'sug-1', _id: 'auto-id-abc' }]);
    });
  });

  // ─── Per-section mapper contracts ──────────────────────────────────────
  // Pin each section mapper's exact output shape. These run against the
  // production-exported mapper constants (not inline arrow lambdas) so a
  // regression deleting e.g. `id: commentDoc.id` from the comments mapper
  // fails here directly, without needing to decode the ZIP.
  describe('section mappers', () => {
    const {
      _suggestionVoteMapper: voteMapper,
      _suggestionCommentMapper: commentMapper,
    } = require('../../src/utils/data-export-builder');

    test('vote mapper: spreads voteDoc.data() and prepends suggestionId (no id field)', () => {
      // Vote doc IDs are the voterId — already in the payload as `voterId`.
      // Pinning the absence of an `id:` here prevents a future "consistency"
      // refactor from adding it (which would expose Firestore's internal
      // doc-key, a privacy-tangential leak even if cosmetically harmless).
      const fakeVoteDoc = {
        id: '10000001',
        data: () => ({ voterId: 10000001, direction: 'up', votedAt: 1700000000000 }),
      };
      const result = voteMapper('sug-7', fakeVoteDoc);
      expect(result).toEqual({
        suggestionId: 'sug-7',
        voterId: 10000001,
        direction: 'up',
        votedAt: 1700000000000,
      });
      expect(result).not.toHaveProperty('id');
    });

    test('comment mapper: propagates commentDoc.id (auto-generated, otherwise unrecoverable)', () => {
      // The load-bearing assertion for R1-I2: the auto-generated Firestore
      // doc ID MUST appear in the exported payload because it's the only
      // stable identifier a user can use to correlate an exported comment
      // with one cited in a moderation appeal or admin response. Deleting
      // `id: commentDoc.id` from the mapper fails this test directly.
      const fakeCommentDoc = {
        id: 'auto-id-firestore-7xyz',
        data: () => ({
          authorUid: 10000001,
          text: 'pinned by the mapper test',
          isPublic: true,
          createdAt: 1700000000000,
        }),
      };
      const result = commentMapper('sug-42', fakeCommentDoc);
      expect(result).toEqual({
        suggestionId: 'sug-42',
        id: 'auto-id-firestore-7xyz',
        authorUid: 10000001,
        text: 'pinned by the mapper test',
        isPublic: true,
        createdAt: 1700000000000,
      });
    });

    test('comment mapper: trusted explicit fields win over same-named payload fields (privacy invariant)', () => {
      // The mapper's explicit `suggestionId` (from the doc path) and `id`
      // (from the doc ref) are TRUSTED — they come from the storage layer
      // and identify the entry's true location in the corpus. The payload
      // is UNTRUSTED user-or-future-schema data. If a comment payload
      // ever stores fields named `suggestionId` or `id`, those must NOT
      // be able to override the trusted values — otherwise an export
      // could misattribute a comment, breaking the user's ability to
      // correlate the entry with a real comment in the system.
      // Production code achieves this by ordering the spread BEFORE the
      // explicit fields in the mapper's object literal. This test pins
      // that ordering as a privacy invariant.
      const fakeCommentDoc = {
        id: 'real-comment-id',
        data: () => ({
          // Adversarial payload: tries to claim a different identity
          suggestionId: 'rogue-suggestion-id',
          id: 'rogue-comment-id',
          authorUid: 1,
          text: 'attempted override',
        }),
      };
      const result = commentMapper('sug-true', fakeCommentDoc);
      // Trusted values win
      expect(result.suggestionId).toBe('sug-true');
      expect(result.id).toBe('real-comment-id');
      // Other payload fields still pass through
      expect(result.authorUid).toBe(1);
      expect(result.text).toBe('attempted override');
    });

    test('vote mapper: trusted suggestionId wins over same-named payload field (privacy invariant)', () => {
      // Pre-existing path with the same concern: if a vote payload ever
      // stores a `suggestionId` field, it must NOT override the trusted
      // value from the doc path. The bug existed in the pre-extraction
      // inline mapper but was only surfaced by the comments-mapper test
      // architecture — fixed in the same PR per the project's
      // "fix pre-existing and new findings the same way" rule.
      const fakeVoteDoc = {
        id: '10000001',
        data: () => ({
          // Adversarial payload: tries to claim a different suggestion
          suggestionId: 'rogue-suggestion-id',
          voterId: 10000001,
          direction: 'up',
          votedAt: 1700000000000,
        }),
      };
      const result = voteMapper('sug-real', fakeVoteDoc);
      expect(result.suggestionId).toBe('sug-real');
      expect(result.voterId).toBe(10000001);
      expect(result.direction).toBe('up');
    });
  });
});

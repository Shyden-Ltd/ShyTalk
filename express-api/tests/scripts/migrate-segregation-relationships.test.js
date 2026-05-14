/**
 * Tests for the one-shot cross-cohort relationship migration
 * (`scripts/migrate-segregation-relationships.js`). UK OSA #17 PR 6.
 *
 * Coverage focuses on the pure scan + dry-run vs apply behaviour, the
 * sanitisation contract for displayNames, the audit-trail writes to
 * `segregationEvents`, the block-bypass for system PMs, the CLI flag
 * parser (`determineMode`), and the snapshot-file writer. The actual
 * batched-write path is mocked at the `db.runTransaction` /
 * `db.batch` seam — Firestore atomicity itself is exercised by the
 * Phase 3 firestore-rules / integration tests, not here.
 *
 * Invariants we pin:
 *   - dry-run reports affected counts without any writes
 *   - apply mode removes cross-cohort edges from BOTH sides
 *   - apply mode dispatches a system PM to both ex-follower and
 *     ex-followee, with block-bypass swapping in a generic name
 *     when a side previously blocked the other
 *   - apply mode writes a `segregationEvents` audit row per edge
 *   - same-cohort follows are preserved
 *   - idempotent: second apply on already-migrated graph is no-op
 *   - missing / invalid cohort on the counterparty defaults to
 *     `minor` (matches `effectiveCohort` semantics)
 *   - non-integer ids in followingIds are skipped (counted stale)
 *   - per-edge transaction failure surfaces but does NOT corrupt
 *     already-committed pairs
 *   - displayName sanitisation: HTML, control chars, bidi overrides,
 *     newlines all stripped; max length enforced
 *   - PM body is cohort-agnostic (privacy contract — recipient
 *     cannot infer counterparty cohort from the body alone)
 */

const mockUsersGet = jest.fn();
const mockRoomsGet = jest.fn();
const mockConversationsGet = jest.fn();
const mockSegregationEventsAdd = jest.fn();
const mockRunTransaction = jest.fn();
const mockBatchUpdate = jest.fn();
const mockBatchCommit = jest.fn();
const mockDoc = jest.fn();
const mockSendSystemPm = jest.fn();
const mockMkdirSync = jest.fn();
const mockWriteFileSync = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collection: jest.fn((name) => {
      if (name === 'users') return { get: mockUsersGet };
      if (name === 'rooms') return { get: mockRoomsGet };
      if (name === 'conversations') return { get: mockConversationsGet };
      if (name === 'segregationEvents') {
        return { add: mockSegregationEventsAdd };
      }
      return { get: jest.fn(), add: jest.fn() };
    }),
    doc: (...args) => mockDoc(...args),
    runTransaction: (...args) => mockRunTransaction(...args),
    batch: jest.fn(() => ({
      update: mockBatchUpdate,
      commit: mockBatchCommit,
    })),
  },
  FieldValue: {
    arrayRemove: (...vals) => ({ __op: 'arrayRemove', vals }),
  },
  auth: {},
}));

jest.mock('../../src/utils/system-pm', () => ({
  sendSystemPm: (...args) => mockSendSystemPm(...args),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('fs', () => ({
  mkdirSync: (...args) => mockMkdirSync(...args),
  writeFileSync: (...args) => mockWriteFileSync(...args),
}));

const {
  scanCrossCohortEdges,
  scanCrossCohortRooms,
  scanCrossCohortConversations,
  applyMigration,
  applyRoomMigration,
  applyConversationMigration,
  formatRelationshipRemovedPm,
  formatRoomEjectionPm,
  formatConversationHiddenPm,
  formatGroupFrozenPm,
  sanitiseDisplayName,
  isPositiveIntegerString,
  writeSnapshot,
  determineMode,
  SAFE_DISPLAY_NAME_MAX_LEN,
} = require('../../scripts/migrate-segregation-relationships');

beforeEach(() => {
  jest.clearAllMocks();
  mockBatchCommit.mockResolvedValue();
  mockSendSystemPm.mockResolvedValue();
  mockSegregationEventsAdd.mockResolvedValue();
});

// ──────────────────────────────────────────────────────────────────
// Fixture builders
// ──────────────────────────────────────────────────────────────────

function userDoc(
  id,
  {
    cohort = 'minor',
    displayName = `user${id}`,
    following = [],
    followers = [],
    blocked = [],
    cohortOverride,
  } = {},
) {
  const data = {
    id,
    displayName,
    cohort,
    followingIds: following,
    followerIds: followers,
    blockedUserIds: blocked,
  };
  if (cohortOverride !== undefined) data.cohortOverride = cohortOverride;
  return { id: String(id), data: () => data, _data: data };
}

function seedUsers(users) {
  mockUsersGet.mockResolvedValue({ docs: users });

  // doc('users/X') — write targets for the apply path. The migration
  // does not read these (it uses the in-memory index), so return a
  // sentinel ref. Numeric-id docs that ARE in the seed get a working
  // `get()` so any future test that exercises a point-read path
  // continues to work without modification.
  const index = new Map(users.map((u) => [u.id, u]));
  mockDoc.mockImplementation((path) => {
    const match = /^users\/(.+)$/.exec(path);
    if (!match) return { __ref: path };
    const id = match[1];
    return {
      get: () => Promise.resolve(index.get(id) || { exists: false, data: () => null }),
      __ref: path,
    };
  });
}

function seedSegregationFollowGraph() {
  //   100 (minor)  →  200 (adult)   cross-cohort
  //   100 (minor)  →  201 (minor)   same-cohort   (preserve)
  //   101 (minor)  →  200 (adult)   cross-cohort
  //   200 (adult)  →  101 (minor)   cross-cohort (reverse direction)
  const u100 = userDoc(100, {
    cohort: 'minor',
    following: [200, 201],
    followers: [],
  });
  const u101 = userDoc(101, {
    cohort: 'minor',
    following: [200],
    followers: [200],
  });
  const u200 = userDoc(200, {
    cohort: 'adult',
    following: [101],
    followers: [100, 101],
  });
  const u201 = userDoc(201, {
    cohort: 'minor',
    following: [],
    followers: [100],
  });
  seedUsers([u100, u101, u200, u201]);
  return { u100, u101, u200, u201 };
}

// ──────────────────────────────────────────────────────────────────
// isPositiveIntegerString
// ──────────────────────────────────────────────────────────────────

describe('isPositiveIntegerString', () => {
  test('accepts canonical positive integers', () => {
    expect(isPositiveIntegerString('1')).toBe(true);
    expect(isPositiveIntegerString('10000001')).toBe(true);
    expect(isPositiveIntegerString(10000001)).toBe(true);
  });

  test('rejects non-integer numerics and zero / negative', () => {
    expect(isPositiveIntegerString('0')).toBe(false);
    expect(isPositiveIntegerString('-1')).toBe(false);
    expect(isPositiveIntegerString('1.5')).toBe(false);
    expect(isPositiveIntegerString('1e5')).toBe(false);
  });

  test('rejects parseInt-truncatable strings (silent-truncation defence)', () => {
    expect(isPositiveIntegerString('123abc')).toBe(false);
    expect(isPositiveIntegerString('  123')).toBe(true); // whitespace-only trim
    expect(isPositiveIntegerString('123 evil')).toBe(false);
  });

  test('rejects empty / nullish / non-string-non-numeric', () => {
    expect(isPositiveIntegerString('')).toBe(false);
    expect(isPositiveIntegerString(null)).toBe(false);
    expect(isPositiveIntegerString(undefined)).toBe(false);
    expect(isPositiveIntegerString({})).toBe(false);
    expect(isPositiveIntegerString(NaN)).toBe(false);
  });

  test('rejects non-numeric doc-ids (e.g. SHYTALK_SYSTEM)', () => {
    expect(isPositiveIntegerString('SHYTALK_SYSTEM')).toBe(false);
    expect(isPositiveIntegerString('admin-uid-abc123')).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────
// scanCrossCohortEdges
// ──────────────────────────────────────────────────────────────────

describe('scanCrossCohortEdges', () => {
  test('identifies cross-cohort follows from both directions', async () => {
    seedSegregationFollowGraph();

    const result = await scanCrossCohortEdges();

    expect(result.crossCohortEdges).toHaveLength(3);
    const keys = result.crossCohortEdges.map((e) => `${e.from}→${e.to}`).sort();
    expect(keys).toEqual(['100→200', '101→200', '200→101']);
  });

  test('preserves same-cohort follows', async () => {
    seedSegregationFollowGraph();
    const result = await scanCrossCohortEdges();
    const crossKeys = result.crossCohortEdges.map((e) => `${e.from}→${e.to}`);
    expect(crossKeys).not.toContain('100→201');
  });

  test('reports per-user affected counts and a total count', async () => {
    seedSegregationFollowGraph();
    const result = await scanCrossCohortEdges();
    expect(result.affectedFollowsCount).toBe(3);
    expect(result.preservedFollowsCount).toBe(1);
  });

  test('treats missing counterparty cohort as "minor" (effectiveCohort fallback)', async () => {
    const u100 = userDoc(100, { cohort: 'adult', following: [200] });
    const u200 = {
      id: '200',
      data: () => ({ id: 200, displayName: 'no-cohort', blockedUserIds: [] }),
    };
    seedUsers([u100, u200]);

    const result = await scanCrossCohortEdges();
    expect(result.crossCohortEdges).toHaveLength(1);
    expect(result.crossCohortEdges[0]).toMatchObject({
      from: '100',
      fromCohort: 'adult',
      to: '200',
      toCohort: 'minor',
    });
  });

  test('honours cohortOverride on the counterparty', async () => {
    const u100 = userDoc(100, { cohort: 'adult', following: [200] });
    const u200 = userDoc(200, { cohort: 'minor', cohortOverride: 'adult' });
    seedUsers([u100, u200]);

    const result = await scanCrossCohortEdges();
    expect(result.crossCohortEdges).toHaveLength(0);
    expect(result.preservedFollowsCount).toBe(1);
  });

  test('skips invalid cohortOverride and falls back to cohort field', async () => {
    const u100 = userDoc(100, { cohort: 'adult', following: [200] });
    const u200 = userDoc(200, { cohort: 'minor', cohortOverride: 'admin' });
    seedUsers([u100, u200]);

    const result = await scanCrossCohortEdges();
    expect(result.crossCohortEdges).toHaveLength(1);
    expect(result.crossCohortEdges[0]).toMatchObject({ from: '100', to: '200' });
  });

  test('handles users with empty / missing followingIds arrays', async () => {
    const u100 = userDoc(100, { cohort: 'adult', following: [], followers: [] });
    const u200 = {
      id: '200',
      data: () => ({ id: 200, cohort: 'adult', blockedUserIds: [] }),
    };
    seedUsers([u100, u200]);

    const result = await scanCrossCohortEdges();
    expect(result.crossCohortEdges).toEqual([]);
    expect(result.affectedFollowsCount).toBe(0);
  });

  test('skips edges pointing at missing counterparty docs (stale id)', async () => {
    const u100 = userDoc(100, { cohort: 'adult', following: [999] });
    seedUsers([u100]);

    const result = await scanCrossCohortEdges();
    expect(result.crossCohortEdges).toEqual([]);
    expect(result.staleEdgeCount).toBe(1);
  });

  test('skips non-integer ids in followingIds (data-corruption defence)', async () => {
    // `'bogus'` is a legacy corrupted entry. Number('bogus') is NaN
    // and arrayRemove(NaN) is a silent no-op, which would leak a
    // cross-cohort edge if the migration tried to apply it. The
    // migration must skip + count as stale instead.
    const u100 = userDoc(100, { cohort: 'adult', following: [200, 'bogus', 0] });
    const u200 = userDoc(200, { cohort: 'minor' });
    seedUsers([u100, u200]);

    const result = await scanCrossCohortEdges();
    expect(result.crossCohortEdges).toHaveLength(1);
    expect(result.crossCohortEdges[0]).toMatchObject({ from: '100', to: '200' });
    expect(result.staleEdgeCount).toBe(2); // 'bogus' + 0
  });

  test('skips non-numeric source-user docs (e.g. SHYTALK_SYSTEM)', async () => {
    // System user has a non-numeric doc-id and no follow edges, but
    // even if a malformed seed somehow gave it a followingIds array,
    // the migration must NOT try to arrayRemove on a non-integer id.
    const uSystem = {
      id: 'SHYTALK_SYSTEM',
      data: () => ({
        id: 'SHYTALK_SYSTEM',
        cohort: 'adult',
        followingIds: [200],
        blockedUserIds: [],
      }),
    };
    const u200 = userDoc(200, { cohort: 'minor' });
    seedUsers([uSystem, u200]);

    const result = await scanCrossCohortEdges();
    // The system user is skipped entirely as a from-source; the
    // potential cross-cohort edge from SHYTALK_SYSTEM is silently
    // ignored (no edge produced, no stale count — system docs are
    // legitimate non-numeric ids, not corruption).
    expect(result.crossCohortEdges).toHaveLength(0);
  });

  test('records blockedUserIds in each direction for the edge', async () => {
    // u100 blocked u200 previously; u200 did not block u100.
    const u100 = userDoc(100, {
      cohort: 'minor',
      following: [200],
      blocked: [200],
    });
    const u200 = userDoc(200, {
      cohort: 'adult',
      followers: [100],
      blocked: [],
    });
    seedUsers([u100, u200]);

    const result = await scanCrossCohortEdges();
    expect(result.crossCohortEdges[0]).toMatchObject({
      from: '100',
      to: '200',
      fromBlockedToUser: true,
      toBlockedFromUser: false,
    });
  });
});

// ──────────────────────────────────────────────────────────────────
// applyMigration — dry-run vs commit
// ──────────────────────────────────────────────────────────────────

describe('applyMigration', () => {
  test('dry-run reports counts without invoking transactions, PMs, or audit', async () => {
    seedSegregationFollowGraph();

    const result = await applyMigration({ dryRun: true });

    expect(result.affectedFollowsCount).toBe(3);
    expect(result.preservedFollowsCount).toBe(1);
    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
    expect(mockSendSystemPm).not.toHaveBeenCalled();
    expect(mockSegregationEventsAdd).not.toHaveBeenCalled();
  });

  test('commit mode revokes both sides of each cross-cohort edge', async () => {
    seedSegregationFollowGraph();
    const writes = [];
    mockRunTransaction.mockImplementation(async (fn) => {
      const txn = {
        update: (ref, patch) => writes.push({ ref: ref.__ref, patch }),
      };
      return fn(txn);
    });

    await applyMigration({ dryRun: false });

    // 3 cross-cohort edges → 6 writes (one removal per side per edge).
    expect(writes).toHaveLength(6);
    const refs = writes.map((w) => w.ref).sort();
    expect(refs).toContain('users/100');
    expect(refs).toContain('users/101');
    expect(refs).toContain('users/200');
  });

  test('commit mode passes numeric ids to arrayRemove (matches stored type)', async () => {
    // The follow route writes `arrayUnion(targetId)` where targetId
    // is the result of `Number.parseInt(...)` — a number. The
    // migration must call `arrayRemove(<number>)` so the strict-
    // equality match used by Firestore actually fires.
    seedSegregationFollowGraph();
    const patches = [];
    mockRunTransaction.mockImplementation(async (fn) => {
      const txn = {
        update: (ref, patch) => patches.push(patch),
      };
      return fn(txn);
    });

    await applyMigration({ dryRun: false });

    // Each patch is `{ followingIds: {__op:'arrayRemove', vals:[...]} }`
    // or `{ followerIds: ... }`. Every value in `vals` must be a JS
    // number (not a string).
    for (const patch of patches) {
      const op = patch.followingIds || patch.followerIds;
      expect(op.__op).toBe('arrayRemove');
      for (const v of op.vals) {
        expect(typeof v).toBe('number');
        expect(Number.isInteger(v)).toBe(true);
      }
    }
  });

  test('commit mode dispatches one system PM per cross-cohort edge to BOTH parties', async () => {
    seedSegregationFollowGraph();
    mockRunTransaction.mockImplementation(async (fn) => fn({ update: () => {} }));

    await applyMigration({ dryRun: false });

    expect(mockSendSystemPm).toHaveBeenCalledTimes(6);
    const recipients = mockSendSystemPm.mock.calls.map((c) => c[0]).sort();
    expect(recipients).toEqual(['100', '101', '101', '200', '200', '200']);
  });

  test('commit mode writes a segregationEvents audit row per edge', async () => {
    // PR 3 introduced the segregationEvents collection for cross-cohort
    // request-time audits. The migration writes one row per migrated
    // edge with action='migration_removed' so analytics can distinguish
    // migration removals from request-time blocks. Schema matches the
    // PR 3 middleware writer (middleware/sameCohort.writeSegregationEvent)
    // — `action` is the discriminator, no separate `type` field.
    seedSegregationFollowGraph();
    mockRunTransaction.mockImplementation(async (fn) => fn({ update: () => {} }));

    await applyMigration({ dryRun: false });

    expect(mockSegregationEventsAdd).toHaveBeenCalledTimes(3);
    const rows = mockSegregationEventsAdd.mock.calls.map((c) => c[0]);
    for (const row of rows) {
      expect(row).toMatchObject({
        action: 'migration_removed',
        surface: 'scripts/migrate-segregation-relationships',
        requestId: null,
      });
      expect(row).not.toHaveProperty('type'); // discriminator is `action`
      expect(['minor', 'adult']).toContain(row.sourceCohort);
      expect(['minor', 'adult']).toContain(row.targetCohort);
      expect(typeof row.timestamp).toBe('number');
      expect(typeof row.sourceUniqueId).toBe('string');
      expect(typeof row.targetUniqueId).toBe('string');
    }
  });

  test('block-bypass: PM omits counterparty displayName when recipient previously blocked them', async () => {
    // u100 blocked u200; u100 must still receive the PM (the link
    // removal is real), but the PM must NOT reveal u200's name.
    // u200 did not block u100 → u200's PM names u100 normally.
    const u100 = userDoc(100, {
      cohort: 'minor',
      displayName: 'Alice',
      following: [200],
      blocked: [200],
    });
    const u200 = userDoc(200, {
      cohort: 'adult',
      displayName: 'Bob',
      followers: [100],
      blocked: [],
    });
    seedUsers([u100, u200]);
    mockRunTransaction.mockImplementation(async (fn) => fn({ update: () => {} }));

    await applyMigration({ dryRun: false });

    const calls = mockSendSystemPm.mock.calls;
    const pmTo100 = calls.find((c) => c[0] === '100')[1];
    const pmTo200 = calls.find((c) => c[0] === '200')[1];
    expect(pmTo100).not.toContain('Bob');
    expect(pmTo100).toContain('another user');
    expect(pmTo200).toContain('Alice');
  });

  test('idempotent: second commit on already-migrated graph is a no-op', async () => {
    const u100 = userDoc(100, { cohort: 'minor', following: [201] });
    const u201 = userDoc(201, { cohort: 'minor', followers: [100] });
    seedUsers([u100, u201]);

    const result = await applyMigration({ dryRun: false });

    expect(result.affectedFollowsCount).toBe(0);
    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(mockSendSystemPm).not.toHaveBeenCalled();
    expect(mockSegregationEventsAdd).not.toHaveBeenCalled();
  });

  test('per-edge transaction failure surfaces, prior pairs stay committed', async () => {
    seedSegregationFollowGraph();
    let callIndex = 0;
    const completed = [];
    mockRunTransaction.mockImplementation(async (fn) => {
      const idx = callIndex++;
      const txn = { update: (ref) => completed.push({ idx, ref: ref.__ref }) };
      if (idx === 1) {
        await fn(txn);
        throw new Error('simulated firestore failure on edge #2');
      }
      return fn(txn);
    });

    await expect(applyMigration({ dryRun: false })).rejects.toThrow(/edge #2/);
    expect(completed.some((w) => w.idx === 0)).toBe(true);
  });

  test('PM dispatch failure does NOT roll back the transaction', async () => {
    const u100 = userDoc(100, { cohort: 'minor', following: [200] });
    const u200 = userDoc(200, { cohort: 'adult', followers: [100] });
    seedUsers([u100, u200]);
    mockRunTransaction.mockImplementation(async (fn) => fn({ update: () => {} }));
    mockSendSystemPm.mockRejectedValueOnce(new Error('PM dispatch failed')).mockResolvedValue();

    const result = await applyMigration({ dryRun: false });

    expect(result.affectedFollowsCount).toBe(1);
    expect(result.pmDispatchFailures).toBe(1);
    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
    expect(mockSegregationEventsAdd).toHaveBeenCalledTimes(1);
  });

  test('PM dispatch failure records the recipient uniqueId for ops re-broadcast', async () => {
    // arrayRemove is idempotent → a second run sees zero cross-cohort
    // edges → the failed PM is never re-attempted automatically. The
    // result surfaces the specific recipient(s) so the operator can
    // re-broadcast from the snapshot file. Without this, the count is
    // unactionable.
    const u100 = userDoc(100, { cohort: 'minor', following: [200] });
    const u200 = userDoc(200, { cohort: 'adult', followers: [100] });
    seedUsers([u100, u200]);
    mockRunTransaction.mockImplementation(async (fn) => fn({ update: () => {} }));
    mockSendSystemPm
      .mockRejectedValueOnce(new Error('first PM failed'))
      .mockRejectedValueOnce(new Error('second PM failed'));

    const result = await applyMigration({ dryRun: false });

    expect(result.pmDispatchFailures).toBe(2);
    expect(result.pmDispatchFailedRecipients).toEqual(['100', '200']);
  });

  test('block-bypass: both sides blocked each other — both PMs use the generic fallback', async () => {
    const u100 = userDoc(100, {
      cohort: 'minor',
      displayName: 'Alice',
      following: [200],
      blocked: [200],
    });
    const u200 = userDoc(200, {
      cohort: 'adult',
      displayName: 'Bob',
      followers: [100],
      blocked: [100],
    });
    seedUsers([u100, u200]);
    mockRunTransaction.mockImplementation(async (fn) => fn({ update: () => {} }));

    await applyMigration({ dryRun: false });

    const calls = mockSendSystemPm.mock.calls;
    const pmTo100 = calls.find((c) => c[0] === '100')[1];
    const pmTo200 = calls.find((c) => c[0] === '200')[1];
    expect(pmTo100).toContain('another user');
    expect(pmTo200).toContain('another user');
    expect(pmTo100).not.toContain('Bob');
    expect(pmTo200).not.toContain('Alice');
  });

  test('segregationEvents write failure does NOT roll back the transaction or block PMs', async () => {
    // The audit row is best-effort: a Firestore quota glitch must not
    // hold up the migration. The edge removal is durable, the PMs go
    // out, and the failure is counted in `segregationEventFailures`.
    const u100 = userDoc(100, { cohort: 'minor', following: [200] });
    const u200 = userDoc(200, { cohort: 'adult', followers: [100] });
    seedUsers([u100, u200]);
    mockRunTransaction.mockImplementation(async (fn) => fn({ update: () => {} }));
    mockSegregationEventsAdd.mockRejectedValueOnce(new Error('quota exceeded'));

    const result = await applyMigration({ dryRun: false });

    expect(result.affectedFollowsCount).toBe(1);
    expect(result.segregationEventFailures).toBe(1);
    expect(mockSendSystemPm).toHaveBeenCalledTimes(2);
  });

  test('accepts a pre-computed scan, does not double-scan', async () => {
    // main() runs the scan once and feeds the result into
    // applyMigration so the snapshot file and the applied writes
    // describe the same graph state. The contract: if a scan is
    // passed, applyMigration must not re-fetch.
    seedSegregationFollowGraph();
    const firstScan = await scanCrossCohortEdges();
    mockUsersGet.mockClear();
    mockRunTransaction.mockImplementation(async (fn) => fn({ update: () => {} }));

    await applyMigration({ dryRun: false, scan: firstScan });

    expect(mockUsersGet).not.toHaveBeenCalled();
  });

  test('refuses to apply an edge with a non-integer endpoint (defence in depth)', async () => {
    // The scan should never produce a non-integer-id edge, but if a
    // future caller hands us a hand-rolled scan, the apply path
    // re-validates and skips rather than calling arrayRemove(NaN).
    mockRunTransaction.mockImplementation(async (fn) => fn({ update: () => {} }));
    const handRolledScan = {
      crossCohortEdges: [
        {
          from: 'SHYTALK_SYSTEM',
          fromCohort: 'adult',
          fromDisplayName: 'System',
          fromBlockedToUser: false,
          to: '200',
          toCohort: 'minor',
          toDisplayName: 'Bob',
          toBlockedFromUser: false,
        },
      ],
      affectedFollowsCount: 1,
      preservedFollowsCount: 0,
      staleEdgeCount: 0,
    };

    const result = await applyMigration({ dryRun: false, scan: handRolledScan });

    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(mockSendSystemPm).not.toHaveBeenCalled();
    expect(mockSegregationEventsAdd).not.toHaveBeenCalled();
    expect(result.affectedFollowsCount).toBe(1); // count comes from scan, unchanged
  });
});

// ──────────────────────────────────────────────────────────────────
// sanitiseDisplayName
// ──────────────────────────────────────────────────────────────────

describe('sanitiseDisplayName', () => {
  test('passes a normal name unchanged (trimmed)', () => {
    expect(sanitiseDisplayName('Alice')).toBe('Alice');
    expect(sanitiseDisplayName('  Alice  ')).toBe('Alice');
  });

  test('strips angle brackets and ampersand', () => {
    expect(sanitiseDisplayName('<script>')).toBe('script');
    expect(sanitiseDisplayName('Alice & Bob')).not.toContain('&');
  });

  test('strips C0/DEL control chars', () => {
    expect(sanitiseDisplayName('Alice Bob')).toBe('AliceBob');
    expect(sanitiseDisplayName('AliceBob')).toBe('AliceBob');
  });

  test('strips zero-width / joiner / non-joiner code points', () => {
    expect(sanitiseDisplayName('A\u200Blice')).toBe('Alice');
    expect(sanitiseDisplayName('A\u200Dlice')).toBe('Alice');
  });

  test('strips bidi-override code points (RTL spoofing defence)', () => {
    expect(sanitiseDisplayName('Alice\u202EBob')).toBe('AliceBob');
    expect(sanitiseDisplayName('\u202DEvil\u202C')).toBe('Evil');
  });

  test('collapses newlines / tabs to single space (injection defence)', () => {
    // A multi-line displayName could fake a new system-message block
    // when interpolated into a `\n`-delimited body.
    const out = sanitiseDisplayName('Alice\n\n[fake admin notice]');
    expect(out).not.toContain('\n');
    expect(out).toBe('Alice [fake admin notice]');
  });

  test('caps length at SAFE_DISPLAY_NAME_MAX_LEN with ellipsis', () => {
    const long = 'A'.repeat(SAFE_DISPLAY_NAME_MAX_LEN * 2);
    const out = sanitiseDisplayName(long);
    expect(out.length).toBeLessThanOrEqual(SAFE_DISPLAY_NAME_MAX_LEN);
    expect(out.endsWith('…')).toBe(true);
  });

  test('returns null for non-strings and whitespace-only', () => {
    expect(sanitiseDisplayName(null)).toBeNull();
    expect(sanitiseDisplayName(undefined)).toBeNull();
    expect(sanitiseDisplayName(42)).toBeNull();
    expect(sanitiseDisplayName({})).toBeNull();
    expect(sanitiseDisplayName('   ')).toBeNull();
    expect(sanitiseDisplayName('  ')).toBeNull();
  });

  test('strips C1 control range including U+0085 NEL (line terminator)', () => {
    // U+0085 NEL is not in C0 (U+0000-001F) and not in JS \s — some
    // downstream renderers and log aggregators (ICU, RFC-5322,
    // syslog) treat it as a record terminator. Stripping the entire
    // C1 range U+0080-U+009F catches NEL plus the rest of the
    // control block.
    const nelInjection = 'Alice\u0085[fake notice]';
    const out = sanitiseDisplayName(nelInjection);
    expect(out).not.toContain('\u0085');
    expect(out).toBe('Alice[fake notice]');

    expect(sanitiseDisplayName('A\u0080B')).toBe('AB');
    expect(sanitiseDisplayName('A\u009FB')).toBe('AB');
  });

  test('collapses LINE / PARAGRAPH separators (U+2028, U+2029) to space', () => {
    // Belt-and-braces: JS \s in step 6 would collapse these too, but
    // the explicit strip step is contract-stable against any future
    // narrowing of the \s regex.
    const out = sanitiseDisplayName('Alice\u2028[fake notice]');
    expect(out).not.toContain('\u2028');
    expect(out).toBe('Alice [fake notice]');

    const out2 = sanitiseDisplayName('Alice\u2029Bob');
    expect(out2).not.toContain('\u2029');
    expect(out2).toBe('Alice Bob');
  });

  test('strips U+061C Arabic Letter Mark (bidi formatter)', () => {
    // ALM is a bidi directional hint that does not render as a glyph
    // but can shift the visual flow of the surrounding English copy.
    const out = sanitiseDisplayName('Alice\u061CBob');
    expect(out).not.toContain('\u061C');
    expect(out).toBe('AliceBob');
  });

  test('strips U+2060-U+2064 invisible format chars and U+FEFF (BOM)', () => {
    expect(sanitiseDisplayName('A\u2060B')).toBe('AB');
    expect(sanitiseDisplayName('A\u2061B')).toBe('AB');
    expect(sanitiseDisplayName('A\u2064B')).toBe('AB');
    expect(sanitiseDisplayName('A\uFEFFB')).toBe('AB');
  });
});

// ──────────────────────────────────────────────────────────────────
// formatRelationshipRemovedPm
// ──────────────────────────────────────────────────────────────────

describe('formatRelationshipRemovedPm', () => {
  test('renders the counterparty displayName into the body', () => {
    const body = formatRelationshipRemovedPm({ counterpartyDisplayName: 'Alice' });
    expect(body).toContain('Alice');
  });

  test('falls back to "another user" when displayName is null', () => {
    const body = formatRelationshipRemovedPm({ counterpartyDisplayName: null });
    expect(body).not.toContain('null');
    expect(body).toContain('another user');
  });

  test('falls back when displayName is undefined', () => {
    const body = formatRelationshipRemovedPm({ counterpartyDisplayName: undefined });
    expect(body).toContain('another user');
  });

  test('falls back when displayName is whitespace-only', () => {
    const body = formatRelationshipRemovedPm({ counterpartyDisplayName: '   ' });
    expect(body).toContain('another user');
  });

  test('escapes raw HTML / ampersand in displayName', () => {
    const body = formatRelationshipRemovedPm({
      counterpartyDisplayName: '<script>x</script> & evil',
    });
    expect(body).not.toContain('<');
    expect(body).not.toContain('>');
    expect(body).not.toContain('&');
  });

  test('truncates very long names', () => {
    const body = formatRelationshipRemovedPm({
      counterpartyDisplayName: 'A'.repeat(500),
    });
    // The body header line is approximately 90 chars of fixed copy
    // plus the (truncated) displayName, which itself is capped at
    // SAFE_DISPLAY_NAME_MAX_LEN. The first line must therefore be
    // bounded, not unbounded.
    const firstLine = body.split('\n')[0];
    expect(firstLine.length).toBeLessThan(200);
    expect(firstLine).toContain('…');
  });

  test('includes the load-bearing cohort-agnostic phrase (positive pin)', () => {
    // If a future copy edit drops the policy framing in favour of
    // "your account group has changed" or similar, this assertion
    // fails — that's intentional. The phrase IS the cohort-agnostic
    // disclaimer.
    const body = formatRelationshipRemovedPm({ counterpartyDisplayName: 'Alice' });
    expect(body).toContain('recent change to how ShyTalk organises accounts');
  });

  test('is cohort-agnostic — no cohort vocabulary anywhere in body', () => {
    // Negative pin: the recipient already knows their own cohort, so
    // ANY of these words let them deduce the counterparty's. The
    // denylist is intentionally wide to catch future copy drift.
    const body = formatRelationshipRemovedPm({ counterpartyDisplayName: 'Alice' });
    expect(body).not.toMatch(/\badult\b/i);
    expect(body).not.toMatch(/\bminor\b/i);
    expect(body).not.toMatch(/\bage\b/i);
    expect(body).not.toMatch(/\bcohort\b/i);
    expect(body).not.toMatch(/\bsegregation\b/i);
    expect(body).not.toMatch(/\b18\+?\b/i);
    expect(body).not.toMatch(/over 18/i);
    expect(body).not.toMatch(/under 18/i);
    expect(body).not.toMatch(/younger/i);
    expect(body).not.toMatch(/older/i);
    expect(body).not.toMatch(/\bteen\b/i);
    expect(body).not.toMatch(/\bkid\b/i);
    expect(body).not.toMatch(/\bdifferent group\b/i);
    expect(body).not.toMatch(/\bnot in the same\b/i);
  });
});

// ══════════════════════════════════════════════════════════════════
// UK OSA #17 PR 7 — Room migration (extends PR 6 scan/apply pattern)
// ══════════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────────
// Room fixture builders
// ──────────────────────────────────────────────────────────────────

function roomDoc(
  id,
  { cohort, ownerId, name = `room-${id}`, state = 'ACTIVE', participantIds = [], seats = {} } = {},
) {
  const data = {
    id,
    name,
    ownerId,
    state,
    participantIds,
    seats,
  };
  if (cohort !== undefined) data.cohort = cohort;
  return { id: String(id), data: () => data, _data: data };
}

function seedRooms(rooms) {
  mockRoomsGet.mockResolvedValue({ docs: rooms });
}

function seatFor(userId) {
  return { userId, state: 'OCCUPIED', isMuted: false };
}

// ──────────────────────────────────────────────────────────────────
// scanCrossCohortRooms
// ──────────────────────────────────────────────────────────────────

describe('scanCrossCohortRooms', () => {
  test('identifies mismatched participants in a tagged room', async () => {
    seedUsers([
      userDoc(100, { cohort: 'adult' }),
      userDoc(200, { cohort: 'minor' }),
      userDoc(201, { cohort: 'adult' }),
    ]);
    seedRooms([
      roomDoc('R1', {
        cohort: 'adult',
        ownerId: '100',
        participantIds: ['100', '200', '201'],
        seats: { 0: seatFor('100'), 1: seatFor('200') },
      }),
    ]);

    const scan = await scanCrossCohortRooms();
    expect(scan.roomEntries).toHaveLength(1);
    const entry = scan.roomEntries[0];
    expect(entry.roomId).toBe('R1');
    expect(entry.roomCohort).toBe('adult');
    expect(entry.mismatchedParticipants).toHaveLength(1);
    expect(entry.mismatchedParticipants[0]).toMatchObject({
      participantId: '200',
      participantCohort: 'minor',
      seatIndex: '1',
    });
    expect(scan.affectedRoomsCount).toBe(1);
    expect(scan.affectedParticipantsCount).toBe(1);
  });

  test('preserves rooms where all participants share the room cohort', async () => {
    seedUsers([userDoc(100, { cohort: 'adult' }), userDoc(101, { cohort: 'adult' })]);
    seedRooms([
      roomDoc('R1', {
        cohort: 'adult',
        ownerId: '100',
        participantIds: ['100', '101'],
      }),
    ]);

    const scan = await scanCrossCohortRooms();
    expect(scan.affectedRoomsCount).toBe(0);
    expect(scan.affectedParticipantsCount).toBe(0);
    expect(scan.preservedParticipantsCount).toBe(2);
  });

  test('infers room cohort from owner when room.cohort is missing (legacy room)', async () => {
    seedUsers([userDoc(100, { cohort: 'adult' }), userDoc(200, { cohort: 'minor' })]);
    seedRooms([
      roomDoc('R1', {
        // no cohort field — pre-PR-7 legacy room
        ownerId: '100',
        participantIds: ['100', '200'],
      }),
    ]);

    const scan = await scanCrossCohortRooms();
    expect(scan.roomEntries).toHaveLength(1);
    const entry = scan.roomEntries[0];
    expect(entry.roomCohort).toBe('adult');
    expect(entry.needsCohortBackfill).toBe(true);
    expect(entry.mismatchedParticipants).toHaveLength(1);
    expect(entry.mismatchedParticipants[0].participantId).toBe('200');
    expect(scan.legacyRoomsCount).toBe(1);
  });

  test('skips non-ACTIVE rooms (closed rooms cannot evict participants)', async () => {
    seedUsers([userDoc(100, { cohort: 'adult' }), userDoc(200, { cohort: 'minor' })]);
    seedRooms([
      roomDoc('R1', {
        cohort: 'adult',
        ownerId: '100',
        state: 'CLOSED',
        participantIds: ['100', '200'],
      }),
    ]);

    const scan = await scanCrossCohortRooms();
    expect(scan.roomEntries).toHaveLength(0);
    expect(scan.skippedRoomsCount).toBe(1);
  });

  test('skips ownerless rooms (legacy data corruption — admin cleanup target)', async () => {
    seedUsers([userDoc(200, { cohort: 'minor' })]);
    seedRooms([
      roomDoc('R1', {
        ownerId: null,
        participantIds: ['200'],
      }),
    ]);

    const scan = await scanCrossCohortRooms();
    expect(scan.roomEntries).toHaveLength(0);
    expect(scan.skippedRoomsCount).toBe(1);
  });

  test('skips rooms whose owner is missing from the users index', async () => {
    seedUsers([userDoc(200, { cohort: 'minor' })]);
    seedRooms([
      roomDoc('R1', {
        ownerId: '999',
        participantIds: ['200'],
      }),
    ]);

    const scan = await scanCrossCohortRooms();
    expect(scan.roomEntries).toHaveLength(0);
    expect(scan.skippedRoomsCount).toBe(1);
  });

  test('treats missing participant cohort as "minor" (fail-closed default)', async () => {
    seedUsers([
      userDoc(100, { cohort: 'adult' }),
      // u200 — no cohort field set
      {
        id: '200',
        data: () => ({ id: 200, displayName: 'legacy', blockedUserIds: [] }),
      },
    ]);
    seedRooms([
      roomDoc('R1', {
        cohort: 'adult',
        ownerId: '100',
        participantIds: ['100', '200'],
      }),
    ]);

    const scan = await scanCrossCohortRooms();
    expect(scan.roomEntries[0].mismatchedParticipants).toHaveLength(1);
    expect(scan.roomEntries[0].mismatchedParticipants[0].participantCohort).toBe('minor');
  });

  test('honours participant cohortOverride', async () => {
    seedUsers([
      userDoc(100, { cohort: 'adult' }),
      userDoc(200, { cohort: 'adult', cohortOverride: 'minor' }),
    ]);
    seedRooms([
      roomDoc('R1', {
        cohort: 'adult',
        ownerId: '100',
        participantIds: ['100', '200'],
      }),
    ]);

    const scan = await scanCrossCohortRooms();
    expect(scan.roomEntries[0].mismatchedParticipants).toHaveLength(1);
    expect(scan.roomEntries[0].mismatchedParticipants[0].participantId).toBe('200');
    expect(scan.roomEntries[0].mismatchedParticipants[0].participantCohort).toBe('minor');
  });

  test('skips non-integer participant ids in array (defence against corruption)', async () => {
    seedUsers([userDoc(100, { cohort: 'adult' })]);
    seedRooms([
      roomDoc('R1', {
        cohort: 'adult',
        ownerId: '100',
        participantIds: ['100', 'SHYTALK_SYSTEM', 'not-a-number'],
      }),
    ]);

    const scan = await scanCrossCohortRooms();
    expect(scan.roomEntries).toHaveLength(0); // no mismatches
    expect(scan.staleParticipantCount).toBe(2);
  });

  test('identifies multiple mismatched participants in one room', async () => {
    seedUsers([
      userDoc(100, { cohort: 'adult' }),
      userDoc(200, { cohort: 'minor' }),
      userDoc(201, { cohort: 'minor' }),
      userDoc(202, { cohort: 'adult' }),
    ]);
    seedRooms([
      roomDoc('R1', {
        cohort: 'adult',
        ownerId: '100',
        participantIds: ['100', '200', '201', '202'],
      }),
    ]);

    const scan = await scanCrossCohortRooms();
    expect(scan.roomEntries[0].mismatchedParticipants).toHaveLength(2);
    expect(scan.roomEntries[0].mismatchedParticipants.map((p) => p.participantId).sort()).toEqual([
      '200',
      '201',
    ]);
    expect(scan.affectedParticipantsCount).toBe(2);
  });

  test('owner is never flagged as a mismatched participant (skipped by design)', async () => {
    // Even if room.cohort drifted, the owner stays — they ARE the
    // room. The cohort tag is treated as authoritative for *other*
    // participants only. Drift is a separate ops concern.
    // Add a real mismatch (300=minor) so the room ends up in
    // roomEntries; the assertion targets owner-exclusion from the
    // mismatch list, not whether the room is scanned at all.
    seedUsers([
      userDoc(100, { cohort: 'minor' }),
      userDoc(200, { cohort: 'adult' }),
      userDoc(300, { cohort: 'minor' }),
    ]);
    seedRooms([
      roomDoc('R1', {
        cohort: 'adult', // drifted (owner became minor)
        ownerId: '100',
        participantIds: ['100', '200', '300'],
      }),
    ]);

    const scan = await scanCrossCohortRooms();
    const mismatches = scan.roomEntries[0].mismatchedParticipants.map((p) => p.participantId);
    expect(mismatches).not.toContain('100');
    // 300 is the genuine cross-cohort mismatch
    expect(mismatches).toContain('300');
  });

  test('records the participant seat index when they hold a seat', async () => {
    seedUsers([userDoc(100, { cohort: 'adult' }), userDoc(200, { cohort: 'minor' })]);
    seedRooms([
      roomDoc('R1', {
        cohort: 'adult',
        ownerId: '100',
        participantIds: ['100', '200'],
        seats: {
          0: seatFor('100'),
          3: seatFor('200'),
        },
      }),
    ]);

    const scan = await scanCrossCohortRooms();
    expect(scan.roomEntries[0].mismatchedParticipants[0].seatIndex).toBe('3');
  });

  test('records null seatIndex when the participant has no seat (lobby)', async () => {
    seedUsers([userDoc(100, { cohort: 'adult' }), userDoc(200, { cohort: 'minor' })]);
    seedRooms([
      roomDoc('R1', {
        cohort: 'adult',
        ownerId: '100',
        participantIds: ['100', '200'],
        seats: { 0: seatFor('100') },
      }),
    ]);

    const scan = await scanCrossCohortRooms();
    expect(scan.roomEntries[0].mismatchedParticipants[0].seatIndex).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────
// applyRoomMigration
// ──────────────────────────────────────────────────────────────────

describe('applyRoomMigration', () => {
  beforeEach(() => {
    // Default: transactions resolve. Each test that needs failure
    // re-overrides mockRunTransaction.
    mockRunTransaction.mockImplementation(async (fn) => {
      const txn = {
        get: jest.fn(),
        update: jest.fn(),
        set: jest.fn(),
        delete: jest.fn(),
      };
      return fn(txn);
    });
  });

  test('dry-run reports counts without invoking transactions, PMs, or audit', async () => {
    seedUsers([userDoc(100, { cohort: 'adult' }), userDoc(200, { cohort: 'minor' })]);
    seedRooms([
      roomDoc('R1', {
        cohort: 'adult',
        ownerId: '100',
        participantIds: ['100', '200'],
      }),
    ]);

    const result = await applyRoomMigration({ dryRun: true });

    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(mockSendSystemPm).not.toHaveBeenCalled();
    expect(mockSegregationEventsAdd).not.toHaveBeenCalled();
    expect(result.affectedParticipantsCount).toBe(1);
    expect(result.affectedRoomsCount).toBe(1);
  });

  test('commit mode evicts mismatched participant via transaction', async () => {
    seedUsers([userDoc(100, { cohort: 'adult' }), userDoc(200, { cohort: 'minor' })]);
    seedRooms([
      roomDoc('R1', {
        cohort: 'adult',
        ownerId: '100',
        participantIds: ['100', '200'],
        seats: { 0: seatFor('100'), 3: seatFor('200') },
      }),
    ]);

    // Capture the updates patch so we can assert the arrayRemove
    // contains the evicted participant (the load-bearing op for the
    // gate).
    const mockUpdate = jest.fn();
    mockRunTransaction.mockImplementationOnce(async (fn) => fn({ update: mockUpdate }));

    await applyRoomMigration({ dryRun: false });

    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
    const [, patch] = mockUpdate.mock.calls[0];
    expect(patch.participantIds).toEqual({ __op: 'arrayRemove', vals: ['200'] });
  });

  test('SECURITY: multi-mismatch — all evicted ids appear in a single arrayRemove call', async () => {
    // Regression test for the `FieldValue.arrayRemove` accumulator
    // bug: assigning `updates.participantIds = arrayRemove(id)` per
    // mismatched participant in a loop would overwrite the prior
    // sentinel, leaving only the LAST participant evicted. Multi-
    // mismatch rooms would silently retain N-1 cross-cohort ids in
    // `participantIds`. The fix: pass all ids as varargs to ONE
    // arrayRemove call.
    seedUsers([
      userDoc(100, { cohort: 'adult' }),
      userDoc(200, { cohort: 'minor' }),
      userDoc(201, { cohort: 'minor' }),
      userDoc(202, { cohort: 'minor' }),
    ]);
    seedRooms([
      roomDoc('R1', {
        cohort: 'adult',
        ownerId: '100',
        participantIds: ['100', '200', '201', '202'],
      }),
    ]);

    const mockUpdate = jest.fn();
    mockRunTransaction.mockImplementationOnce(async (fn) => fn({ update: mockUpdate }));

    await applyRoomMigration({ dryRun: false });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [, patch] = mockUpdate.mock.calls[0];
    // All three mismatched ids in a single arrayRemove.
    expect(patch.participantIds).toEqual({
      __op: 'arrayRemove',
      vals: expect.arrayContaining(['200', '201', '202']),
    });
    expect(patch.participantIds.vals).toHaveLength(3);
  });

  test('pure-backfill: room with only same-cohort participants gets cohort written, no eviction', async () => {
    // Legacy room (no cohort field), owner = adult, all participants
    // adult. Migration should backfill cohort='adult' but not evict
    // anyone. Tests the `needsBackfill: true, mismatchedParticipants:
    // []` code path which the multi-mismatch test does not exercise.
    seedUsers([userDoc(100, { cohort: 'adult' }), userDoc(101, { cohort: 'adult' })]);
    seedRooms([
      roomDoc('R1', {
        // no cohort field
        ownerId: '100',
        participantIds: ['100', '101'],
      }),
    ]);

    const mockUpdate = jest.fn();
    mockRunTransaction.mockImplementationOnce(async (fn) => fn({ update: mockUpdate }));

    const result = await applyRoomMigration({ dryRun: false });

    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
    expect(result.cohortBackfilledRoomsCount).toBe(1);
    expect(result.affectedParticipantsCount).toBe(0);
    const [, patch] = mockUpdate.mock.calls[0];
    expect(patch.cohort).toBe('adult');
    expect(patch.participantIds).toBeUndefined();
  });

  test('commit mode backfills room.cohort when legacy room had no field', async () => {
    seedUsers([userDoc(100, { cohort: 'adult' }), userDoc(200, { cohort: 'minor' })]);
    seedRooms([
      roomDoc('R1', {
        // no cohort — owner is adult → infer 'adult'
        ownerId: '100',
        participantIds: ['100', '200'],
      }),
    ]);

    const result = await applyRoomMigration({ dryRun: false });
    expect(result.cohortBackfilledRoomsCount).toBe(1);
  });

  test('commit mode dispatches one system PM to the evicted participant', async () => {
    seedUsers([
      userDoc(100, { cohort: 'adult', displayName: 'Alice' }),
      userDoc(200, { cohort: 'minor', displayName: 'Bob' }),
    ]);
    seedRooms([
      roomDoc('R1', {
        cohort: 'adult',
        ownerId: '100',
        name: 'The Library',
        participantIds: ['100', '200'],
      }),
    ]);

    await applyRoomMigration({ dryRun: false });
    expect(mockSendSystemPm).toHaveBeenCalledTimes(1);
    const [recipient, body] = mockSendSystemPm.mock.calls[0];
    expect(recipient).toBe('200');
    expect(body).toContain('The Library');
  });

  test('commit mode writes a segregationEvents audit row per evicted participant', async () => {
    seedUsers([
      userDoc(100, { cohort: 'adult' }),
      userDoc(200, { cohort: 'minor' }),
      userDoc(201, { cohort: 'minor' }),
    ]);
    seedRooms([
      roomDoc('R1', {
        cohort: 'adult',
        ownerId: '100',
        participantIds: ['100', '200', '201'],
      }),
    ]);

    await applyRoomMigration({ dryRun: false });
    expect(mockSegregationEventsAdd).toHaveBeenCalledTimes(2);
    const audit0 = mockSegregationEventsAdd.mock.calls[0][0];
    // sourceCohort = the participant's cohort (the entity being
    // evicted); targetCohort = the room's cohort. Mirrors the
    // follow-edge migration's `sourceCohort: edge.fromCohort` —
    // "source" is the actor, "target" is the destination. The
    // `targetRoomId` field is explicit for downstream analytics
    // queries that need to discriminate room-target events from
    // user-target events without parsing `surface`.
    expect(audit0).toMatchObject({
      surface: 'scripts/migrate-segregation-rooms',
      action: 'room_eviction',
      sourceCohort: 'minor',
      targetCohort: 'adult',
      targetUniqueId: 'R1',
      targetRoomId: 'R1',
    });
    expect(typeof audit0.timestamp).toBe('number');
  });

  test('PM body is cohort-agnostic (no cohort vocabulary)', async () => {
    seedUsers([
      userDoc(100, { cohort: 'adult', displayName: 'Owner' }),
      userDoc(200, { cohort: 'minor' }),
    ]);
    seedRooms([
      roomDoc('R1', {
        cohort: 'adult',
        ownerId: '100',
        name: 'Some Room',
        participantIds: ['100', '200'],
      }),
    ]);

    await applyRoomMigration({ dryRun: false });
    const body = mockSendSystemPm.mock.calls[0][1];
    expect(body).not.toMatch(/\badult\b/i);
    expect(body).not.toMatch(/\bminor\b/i);
    expect(body).not.toMatch(/\bage\b/i);
  });

  test('idempotent — second commit on already-migrated rooms is a no-op', async () => {
    seedUsers([userDoc(100, { cohort: 'adult' }), userDoc(200, { cohort: 'minor' })]);
    // First pass: room had cross-cohort. After eviction, the room has
    // only same-cohort. Second seed reflects that state.
    seedRooms([
      roomDoc('R1', {
        cohort: 'adult',
        ownerId: '100',
        participantIds: ['100'], // post-eviction
      }),
    ]);
    const result = await applyRoomMigration({ dryRun: false });
    expect(result.affectedParticipantsCount).toBe(0);
    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(mockSendSystemPm).not.toHaveBeenCalled();
  });

  test('per-room transaction failure surfaces but does NOT corrupt prior rooms', async () => {
    seedUsers([
      userDoc(100, { cohort: 'adult' }),
      userDoc(101, { cohort: 'adult' }),
      userDoc(200, { cohort: 'minor' }),
      userDoc(201, { cohort: 'minor' }),
    ]);
    seedRooms([
      roomDoc('R1', {
        cohort: 'adult',
        ownerId: '100',
        participantIds: ['100', '200'],
      }),
      roomDoc('R2', {
        cohort: 'adult',
        ownerId: '101',
        participantIds: ['101', '201'],
      }),
    ]);

    mockRunTransaction
      .mockImplementationOnce(async (fn) => fn({ update: jest.fn() })) // R1 ok
      .mockImplementationOnce(async () => {
        throw new Error('R2 contention');
      });

    await expect(applyRoomMigration({ dryRun: false })).rejects.toThrow('R2 contention');
    // R1's transaction did fire (already-applied edits are durable —
    // arrayRemove is idempotent on rerun).
    expect(mockRunTransaction).toHaveBeenCalledTimes(2);
  });

  test('PM dispatch failure does NOT roll back the eviction transaction', async () => {
    seedUsers([userDoc(100, { cohort: 'adult' }), userDoc(200, { cohort: 'minor' })]);
    seedRooms([
      roomDoc('R1', {
        cohort: 'adult',
        ownerId: '100',
        participantIds: ['100', '200'],
      }),
    ]);
    mockSendSystemPm.mockRejectedValueOnce(new Error('PM service down'));

    const result = await applyRoomMigration({ dryRun: false });
    expect(result.pmDispatchFailures).toBe(1);
    expect(result.pmDispatchFailedRecipients).toEqual(['200']);
    // Eviction still ran (one transaction)
    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
  });

  test('segregationEvents write failure does NOT roll back eviction or block PM', async () => {
    seedUsers([userDoc(100, { cohort: 'adult' }), userDoc(200, { cohort: 'minor' })]);
    seedRooms([
      roomDoc('R1', {
        cohort: 'adult',
        ownerId: '100',
        participantIds: ['100', '200'],
      }),
    ]);
    mockSegregationEventsAdd.mockRejectedValueOnce(new Error('quota exhausted'));

    const result = await applyRoomMigration({ dryRun: false });
    expect(result.segregationEventFailures).toBe(1);
    expect(mockSendSystemPm).toHaveBeenCalled();
    expect(mockRunTransaction).toHaveBeenCalled();
  });

  test('accepts a pre-computed scan, does not double-scan', async () => {
    seedUsers([userDoc(100, { cohort: 'adult' }), userDoc(200, { cohort: 'minor' })]);
    seedRooms([
      roomDoc('R1', {
        cohort: 'adult',
        ownerId: '100',
        participantIds: ['100', '200'],
      }),
    ]);
    const scan = await scanCrossCohortRooms();
    mockRoomsGet.mockClear();
    mockUsersGet.mockClear();

    await applyRoomMigration({ dryRun: false, scan });
    expect(mockRoomsGet).not.toHaveBeenCalled();
    expect(mockUsersGet).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────
// formatRoomEjectionPm — cohort-agnostic PM template
// ──────────────────────────────────────────────────────────────────

describe('formatRoomEjectionPm', () => {
  test('includes the sanitised room name in the body', () => {
    const body = formatRoomEjectionPm({ roomName: 'The Library' });
    expect(body).toContain('The Library');
  });

  test('falls back to "a room" when roomName is null', () => {
    const body = formatRoomEjectionPm({ roomName: null });
    expect(body).not.toContain('null');
    expect(body).toContain('a room');
  });

  test('falls back when roomName is whitespace-only', () => {
    const body = formatRoomEjectionPm({ roomName: '   ' });
    expect(body).toContain('a room');
  });

  test('escapes raw HTML / ampersand in roomName (XSS defence)', () => {
    const body = formatRoomEjectionPm({
      roomName: '<script>alert(1)</script> & evil',
    });
    expect(body).not.toContain('<');
    expect(body).not.toContain('>');
    expect(body).not.toContain('&');
  });

  test('strips control chars from roomName', () => {
    // Use String.fromCharCode for NUL (0) + BEL (7) so the
    // source file stays ESLint-clean (no-control-regex) while
    // still exercising the sanitiser's C0-strip contract.
    const body = formatRoomEjectionPm({
      roomName: 'Lib' + String.fromCharCode(0) + 'rary' + String.fromCharCode(7),
    });
    expect(body).toContain('Library');
    expect(body).not.toMatch(new RegExp(String.fromCharCode(0)));
    expect(body).not.toMatch(new RegExp(String.fromCharCode(7)));
  });

  test('truncates very long room names', () => {
    const body = formatRoomEjectionPm({ roomName: 'A'.repeat(500) });
    const firstLine = body.split('\n')[0];
    expect(firstLine.length).toBeLessThan(200);
    expect(firstLine).toContain('…');
  });

  test('is cohort-agnostic — no cohort vocabulary anywhere in body', () => {
    const body = formatRoomEjectionPm({ roomName: 'The Library' });
    expect(body).not.toMatch(/\badult\b/i);
    expect(body).not.toMatch(/\bminor\b/i);
    expect(body).not.toMatch(/\bage\b/i);
    expect(body).not.toMatch(/under 18/i);
    expect(body).not.toMatch(/over 18/i);
    expect(body).not.toMatch(/younger/i);
    expect(body).not.toMatch(/older/i);
    expect(body).not.toMatch(/\bteen\b/i);
    expect(body).not.toMatch(/\bkid\b/i);
    expect(body).not.toMatch(/\bdifferent group\b/i);
    expect(body).not.toMatch(/\bnot in the same\b/i);
  });

  test('includes the load-bearing cohort-agnostic phrase (positive pin)', () => {
    const body = formatRoomEjectionPm({ roomName: 'The Library' });
    expect(body).toContain('recent change to how ShyTalk organises accounts');
  });
});

// ══════════════════════════════════════════════════════════════════
// UK OSA #17 PR 8 — Conversation migration (1:1 hide + group freeze)
// ══════════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────────
// Conversation fixture builders
// ──────────────────────────────────────────────────────────────────

function convDoc(
  id,
  {
    participantIds = [],
    isGroup = false,
    groupName = null,
    crossCohortAtMigration,
    frozenAtMigration,
  } = {},
) {
  const data = {
    id,
    participantIds,
    isGroup,
  };
  if (groupName !== null) data.groupName = groupName;
  if (crossCohortAtMigration !== undefined) data.crossCohortAtMigration = crossCohortAtMigration;
  if (frozenAtMigration !== undefined) data.frozenAtMigration = frozenAtMigration;
  return { id: String(id), data: () => data, _data: data };
}

function seedConversations(convs) {
  mockConversationsGet.mockResolvedValue({ docs: convs });
}

// Default — most tests want zero rooms in the index so the room scan
// doesn't pollute their docs. Tests that DO seed rooms call
// seedRooms() themselves and override this.
beforeEach(() => {
  mockConversationsGet.mockResolvedValue({ docs: [] });
});

// ──────────────────────────────────────────────────────────────────
// scanCrossCohortConversations
// ──────────────────────────────────────────────────────────────────

describe('scanCrossCohortConversations', () => {
  test('classifies a 1:1 adult↔minor conversation as cross-cohort 1:1', async () => {
    seedUsers([
      userDoc(100, { cohort: 'adult', displayName: 'Alice' }),
      userDoc(200, { cohort: 'minor', displayName: 'Bob' }),
    ]);
    seedConversations([convDoc('dm_100_200', { participantIds: ['100', '200'], isGroup: false })]);

    const scan = await scanCrossCohortConversations();

    expect(scan.oneToOneEntries).toHaveLength(1);
    expect(scan.groupEntries).toHaveLength(0);
    expect(scan.oneToOneEntries[0]).toMatchObject({
      conversationId: 'dm_100_200',
      participantIds: ['100', '200'],
      participantCohorts: ['adult', 'minor'],
      participantDisplayNames: ['Alice', 'Bob'],
    });
    expect(scan.affectedOneToOneCount).toBe(1);
    expect(scan.affectedGroupCount).toBe(0);
  });

  test('classifies a cross-cohort group as group (not 1:1) regardless of size', async () => {
    seedUsers([
      userDoc(100, { cohort: 'adult' }),
      userDoc(200, { cohort: 'minor' }),
      userDoc(201, { cohort: 'adult' }),
    ]);
    seedConversations([
      convDoc('g1', {
        participantIds: ['100', '200', '201'],
        isGroup: true,
        groupName: 'Hangout',
      }),
    ]);

    const scan = await scanCrossCohortConversations();

    expect(scan.oneToOneEntries).toHaveLength(0);
    expect(scan.groupEntries).toHaveLength(1);
    expect(scan.groupEntries[0]).toMatchObject({
      conversationId: 'g1',
      groupName: 'Hangout',
      participantIds: ['100', '200', '201'],
    });
    expect(scan.affectedGroupCount).toBe(1);
  });

  test('preserves same-cohort 1:1 and same-cohort groups', async () => {
    seedUsers([
      userDoc(100, { cohort: 'adult' }),
      userDoc(101, { cohort: 'adult' }),
      userDoc(102, { cohort: 'adult' }),
    ]);
    seedConversations([
      convDoc('dm_100_101', { participantIds: ['100', '101'] }),
      convDoc('g1', { participantIds: ['100', '101', '102'], isGroup: true, groupName: 'Same' }),
    ]);

    const scan = await scanCrossCohortConversations();

    expect(scan.oneToOneEntries).toHaveLength(0);
    expect(scan.groupEntries).toHaveLength(0);
    expect(scan.preservedConversationsCount).toBe(2);
  });

  test('counts already-flagged 1:1 conversations as alreadyFlagged (idempotent)', async () => {
    seedUsers([userDoc(100, { cohort: 'adult' }), userDoc(200, { cohort: 'minor' })]);
    seedConversations([
      convDoc('dm_100_200', {
        participantIds: ['100', '200'],
        crossCohortAtMigration: true,
        frozenAtMigration: true,
      }),
    ]);

    const scan = await scanCrossCohortConversations();

    expect(scan.oneToOneEntries).toHaveLength(0);
    expect(scan.alreadyFlaggedCount).toBe(1);
  });

  test('counts already-flagged frozen groups as alreadyFlagged (idempotent)', async () => {
    seedUsers([userDoc(100, { cohort: 'adult' }), userDoc(200, { cohort: 'minor' })]);
    seedConversations([
      convDoc('g1', {
        participantIds: ['100', '200'],
        isGroup: true,
        frozenAtMigration: true,
      }),
    ]);

    const scan = await scanCrossCohortConversations();

    expect(scan.groupEntries).toHaveLength(0);
    expect(scan.alreadyFlaggedCount).toBe(1);
  });

  test('treats participants absent from users index as "minor" (fail-closed)', async () => {
    seedUsers([userDoc(100, { cohort: 'adult' })]);
    seedConversations([convDoc('dm_100_999', { participantIds: ['100', '999'] })]);

    const scan = await scanCrossCohortConversations();

    expect(scan.oneToOneEntries).toHaveLength(1);
    expect(scan.oneToOneEntries[0].participantCohorts).toEqual(['adult', 'minor']);
  });

  test('skips conversations with <2 participants (data corruption)', async () => {
    seedUsers([userDoc(100, { cohort: 'adult' })]);
    seedConversations([
      convDoc('lonely', { participantIds: ['100'] }),
      convDoc('empty', { participantIds: [] }),
    ]);

    const scan = await scanCrossCohortConversations();

    expect(scan.oneToOneEntries).toHaveLength(0);
    expect(scan.groupEntries).toHaveLength(0);
    expect(scan.skippedConversationsCount).toBe(2);
  });

  test('records block-bypass flags when a side previously blocked the other', async () => {
    seedUsers([
      userDoc(100, { cohort: 'adult', displayName: 'Alice', blocked: [200] }),
      userDoc(200, { cohort: 'minor', displayName: 'Bob' }),
    ]);
    seedConversations([convDoc('dm_100_200', { participantIds: ['100', '200'] })]);

    const scan = await scanCrossCohortConversations();

    expect(scan.oneToOneEntries[0].blockedBetween).toEqual([true, false]);
  });

  test('treats 2-participant isGroup=true as group, not 1:1', async () => {
    // Edge case: small group of 2. The classifier should follow
    // isGroup, not participantIds.length — a 2-member group remains a
    // group (frozenAtMigration only) and does NOT get the 1:1 hide
    // flag (crossCohortAtMigration would orphan it from the list-rules
    // path designed for 1:1 DMs).
    seedUsers([userDoc(100, { cohort: 'adult' }), userDoc(200, { cohort: 'minor' })]);
    seedConversations([
      convDoc('tiny_group', {
        participantIds: ['100', '200'],
        isGroup: true,
        groupName: 'Just Us',
      }),
    ]);

    const scan = await scanCrossCohortConversations();

    expect(scan.oneToOneEntries).toHaveLength(0);
    expect(scan.groupEntries).toHaveLength(1);
  });

  test('treats absent isGroup field as 1:1 for 2-participant conv (default falsy)', async () => {
    // Backward-compat: pre-PR-8 conversation docs may lack the
    // isGroup field. For 2 participants, the classifier treats this
    // as 1:1 (the historical default) and the migration applies the
    // 1:1 hide flag pair. If a future schema migration adds an
    // explicit `isGroup: false`, this test continues to pass.
    seedUsers([userDoc(100, { cohort: 'adult' }), userDoc(200, { cohort: 'minor' })]);
    // Note: convDoc omits the isGroup field by default (not even
    // setting it to false) since the helper uses the default arg.
    mockConversationsGet.mockResolvedValue({
      docs: [
        {
          id: 'legacy_dm',
          data: () => ({ participantIds: ['100', '200'] }),
        },
      ],
    });

    const scan = await scanCrossCohortConversations();

    expect(scan.oneToOneEntries).toHaveLength(1);
    expect(scan.oneToOneEntries[0].conversationId).toBe('legacy_dm');
    expect(scan.groupEntries).toHaveLength(0);
  });

  test('treats isGroup=false with >2 participants as group (data-corruption fallback)', async () => {
    // Corruption: isGroup:false yet 3+ participants. The 1:1 hide
    // flow assumes exactly 2 participants for the PM dispatch; the
    // corruption fallback routes these into the group path so the
    // freeze flag is set + every member gets a PM (and no 1:1 path
    // tries to index into participantIds[2] with undefined cohort).
    seedUsers([
      userDoc(100, { cohort: 'adult' }),
      userDoc(101, { cohort: 'adult' }),
      userDoc(200, { cohort: 'minor' }),
    ]);
    mockConversationsGet.mockResolvedValue({
      docs: [
        {
          id: 'corrupt_three_no_group',
          data: () => ({
            participantIds: ['100', '101', '200'],
            isGroup: false, // contradicts size
          }),
        },
      ],
    });

    const scan = await scanCrossCohortConversations();

    expect(scan.oneToOneEntries).toHaveLength(0);
    expect(scan.groupEntries).toHaveLength(1);
    expect(scan.groupEntries[0].conversationId).toBe('corrupt_three_no_group');
    expect(scan.groupEntries[0].participantIds).toEqual(['100', '101', '200']);
  });
});

// ──────────────────────────────────────────────────────────────────
// applyConversationMigration
// ──────────────────────────────────────────────────────────────────

describe('applyConversationMigration', () => {
  beforeEach(() => {
    mockRunTransaction.mockImplementation(async (fn) => {
      const txn = {
        get: jest.fn(),
        update: jest.fn(),
        set: jest.fn(),
        delete: jest.fn(),
      };
      return fn(txn);
    });
  });

  test('dry-run reports counts without invoking transactions, PMs, or audit', async () => {
    seedUsers([userDoc(100, { cohort: 'adult' }), userDoc(200, { cohort: 'minor' })]);
    seedConversations([convDoc('dm_100_200', { participantIds: ['100', '200'] })]);

    const result = await applyConversationMigration({ dryRun: true });

    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(mockSendSystemPm).not.toHaveBeenCalled();
    expect(mockSegregationEventsAdd).not.toHaveBeenCalled();
    expect(result.affectedOneToOneCount).toBe(1);
  });

  test('commit mode sets BOTH crossCohortAtMigration AND frozenAtMigration on 1:1', async () => {
    seedUsers([userDoc(100, { cohort: 'adult' }), userDoc(200, { cohort: 'minor' })]);
    seedConversations([convDoc('dm_100_200', { participantIds: ['100', '200'] })]);

    const mockUpdate = jest.fn();
    mockRunTransaction.mockImplementationOnce(async (fn) => fn({ update: mockUpdate }));

    await applyConversationMigration({ dryRun: false });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [, patch] = mockUpdate.mock.calls[0];
    expect(patch.crossCohortAtMigration).toBe(true);
    expect(patch.frozenAtMigration).toBe(true);
    expect(typeof patch.frozenAtMigrationAt).toBe('number');
  });

  test('commit mode sets ONLY frozenAtMigration on cross-cohort group (no crossCohortAtMigration)', async () => {
    // Design: groups keep read/write for existing members but cannot
    // grow. Setting crossCohortAtMigration would hide the group from
    // the list (defeating "preserved but cannot grow further"). The
    // group's freeze is participant-list only.
    seedUsers([
      userDoc(100, { cohort: 'adult' }),
      userDoc(200, { cohort: 'minor' }),
      userDoc(201, { cohort: 'adult' }),
    ]);
    seedConversations([
      convDoc('g1', {
        participantIds: ['100', '200', '201'],
        isGroup: true,
        groupName: 'Hangout',
      }),
    ]);

    const mockUpdate = jest.fn();
    mockRunTransaction.mockImplementationOnce(async (fn) => fn({ update: mockUpdate }));

    await applyConversationMigration({ dryRun: false });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [, patch] = mockUpdate.mock.calls[0];
    expect(patch.frozenAtMigration).toBe(true);
    expect(patch.crossCohortAtMigration).toBeUndefined();
  });

  test('commit mode dispatches a PM to BOTH 1:1 participants', async () => {
    seedUsers([
      userDoc(100, { cohort: 'adult', displayName: 'Alice' }),
      userDoc(200, { cohort: 'minor', displayName: 'Bob' }),
    ]);
    seedConversations([convDoc('dm_100_200', { participantIds: ['100', '200'] })]);

    await applyConversationMigration({ dryRun: false });

    expect(mockSendSystemPm).toHaveBeenCalledTimes(2);
    const recipients = mockSendSystemPm.mock.calls.map((c) => c[0]).sort();
    expect(recipients).toEqual(['100', '200']);
  });

  test('1:1 PM applies block-bypass — recipient who blocked the other gets generic counterparty', async () => {
    seedUsers([
      userDoc(100, { cohort: 'adult', displayName: 'Alice', blocked: [200] }),
      userDoc(200, { cohort: 'minor', displayName: 'Bob' }),
    ]);
    seedConversations([convDoc('dm_100_200', { participantIds: ['100', '200'] })]);

    await applyConversationMigration({ dryRun: false });

    const callByRecipient = new Map(mockSendSystemPm.mock.calls.map((c) => [c[0], c[1]]));
    // 100 blocked 200 → 100's PM must NOT contain "Bob"
    expect(callByRecipient.get('100')).not.toContain('Bob');
    // 200 did not block 100 → 200's PM names Alice
    expect(callByRecipient.get('200')).toContain('Alice');
  });

  test('commit mode dispatches one PM per group member (informing every member)', async () => {
    seedUsers([
      userDoc(100, { cohort: 'adult' }),
      userDoc(200, { cohort: 'minor' }),
      userDoc(201, { cohort: 'adult' }),
    ]);
    seedConversations([
      convDoc('g1', {
        participantIds: ['100', '200', '201'],
        isGroup: true,
        groupName: 'Hangout',
      }),
    ]);

    await applyConversationMigration({ dryRun: false });

    expect(mockSendSystemPm).toHaveBeenCalledTimes(3);
    const recipients = mockSendSystemPm.mock.calls.map((c) => c[0]).sort();
    expect(recipients).toEqual(['100', '200', '201']);
  });

  test('group PM body contains the group name', async () => {
    seedUsers([userDoc(100, { cohort: 'adult' }), userDoc(200, { cohort: 'minor' })]);
    seedConversations([
      convDoc('g1', {
        participantIds: ['100', '200'],
        isGroup: true,
        groupName: 'Movie Club',
      }),
    ]);

    await applyConversationMigration({ dryRun: false });

    for (const call of mockSendSystemPm.mock.calls) {
      expect(call[1]).toContain('Movie Club');
    }
  });

  test('writes a segregationEvents audit row per 1:1 + per cross-cohort group', async () => {
    seedUsers([
      userDoc(100, { cohort: 'adult' }),
      userDoc(200, { cohort: 'minor' }),
      userDoc(201, { cohort: 'adult' }),
    ]);
    seedConversations([
      convDoc('dm_100_200', { participantIds: ['100', '200'] }),
      convDoc('g1', {
        participantIds: ['100', '200', '201'],
        isGroup: true,
        groupName: 'Hangout',
      }),
    ]);

    await applyConversationMigration({ dryRun: false });

    expect(mockSegregationEventsAdd).toHaveBeenCalledTimes(2);
    const surfaces = mockSegregationEventsAdd.mock.calls.map((c) => c[0].surface).sort();
    expect(surfaces).toEqual([
      'scripts/migrate-segregation-conversations-1to1',
      'scripts/migrate-segregation-conversations-group',
    ]);
    const actions = mockSegregationEventsAdd.mock.calls.map((c) => c[0].action).sort();
    expect(actions).toEqual(['conversation_1to1_hidden', 'group_frozen']);
  });

  test('1:1 audit row pins source/target cohorts + conversation id', async () => {
    seedUsers([userDoc(100, { cohort: 'adult' }), userDoc(200, { cohort: 'minor' })]);
    seedConversations([convDoc('dm_100_200', { participantIds: ['100', '200'] })]);

    await applyConversationMigration({ dryRun: false });

    expect(mockSegregationEventsAdd).toHaveBeenCalledTimes(1);
    const audit = mockSegregationEventsAdd.mock.calls[0][0];
    expect(audit).toMatchObject({
      sourceUniqueId: '100',
      sourceCohort: 'adult',
      targetUniqueId: '200',
      targetCohort: 'minor',
      targetConversationId: 'dm_100_200',
      action: 'conversation_1to1_hidden',
    });
    expect(typeof audit.timestamp).toBe('number');
  });

  test('idempotent — second commit on already-migrated convs is a no-op', async () => {
    seedUsers([userDoc(100, { cohort: 'adult' }), userDoc(200, { cohort: 'minor' })]);
    seedConversations([
      convDoc('dm_100_200', {
        participantIds: ['100', '200'],
        crossCohortAtMigration: true,
        frozenAtMigration: true,
      }),
    ]);

    const result = await applyConversationMigration({ dryRun: false });

    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(mockSendSystemPm).not.toHaveBeenCalled();
    expect(mockSegregationEventsAdd).not.toHaveBeenCalled();
    expect(result.affectedOneToOneCount).toBe(0);
    expect(result.alreadyFlaggedCount).toBe(1);
  });

  test('per-conversation transaction failure surfaces but does NOT corrupt prior convs', async () => {
    seedUsers([
      userDoc(100, { cohort: 'adult' }),
      userDoc(101, { cohort: 'adult' }),
      userDoc(200, { cohort: 'minor' }),
      userDoc(201, { cohort: 'minor' }),
    ]);
    seedConversations([
      convDoc('dm_100_200', { participantIds: ['100', '200'] }),
      convDoc('dm_101_201', { participantIds: ['101', '201'] }),
    ]);

    mockRunTransaction
      .mockImplementationOnce(async (fn) => fn({ update: jest.fn() })) // first ok
      .mockImplementationOnce(async () => {
        throw new Error('contention');
      });

    await expect(applyConversationMigration({ dryRun: false })).rejects.toThrow('contention');
    expect(mockRunTransaction).toHaveBeenCalledTimes(2);
  });

  test('PM dispatch failure does NOT roll back flag-set transaction', async () => {
    seedUsers([userDoc(100, { cohort: 'adult' }), userDoc(200, { cohort: 'minor' })]);
    seedConversations([convDoc('dm_100_200', { participantIds: ['100', '200'] })]);
    mockSendSystemPm.mockRejectedValueOnce(new Error('PM service down'));

    const result = await applyConversationMigration({ dryRun: false });

    expect(result.pmDispatchFailures).toBe(1);
    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
  });

  test('segregationEvents write failure does NOT block PM or flag write', async () => {
    seedUsers([userDoc(100, { cohort: 'adult' }), userDoc(200, { cohort: 'minor' })]);
    seedConversations([convDoc('dm_100_200', { participantIds: ['100', '200'] })]);
    mockSegregationEventsAdd.mockRejectedValueOnce(new Error('quota exhausted'));

    const result = await applyConversationMigration({ dryRun: false });

    expect(result.segregationEventFailures).toBe(1);
    expect(mockSendSystemPm).toHaveBeenCalled();
    expect(mockRunTransaction).toHaveBeenCalled();
  });

  test('accepts a pre-computed scan, does not double-scan', async () => {
    seedUsers([userDoc(100, { cohort: 'adult' }), userDoc(200, { cohort: 'minor' })]);
    seedConversations([convDoc('dm_100_200', { participantIds: ['100', '200'] })]);
    const scan = await scanCrossCohortConversations();
    mockConversationsGet.mockClear();
    mockUsersGet.mockClear();

    await applyConversationMigration({ dryRun: false, scan });

    expect(mockConversationsGet).not.toHaveBeenCalled();
    expect(mockUsersGet).not.toHaveBeenCalled();
  });

  test('group PM dispatch failure tracks each failed recipient', async () => {
    seedUsers([
      userDoc(100, { cohort: 'adult' }),
      userDoc(200, { cohort: 'minor' }),
      userDoc(201, { cohort: 'adult' }),
    ]);
    seedConversations([
      convDoc('g1', {
        participantIds: ['100', '200', '201'],
        isGroup: true,
        groupName: 'X',
      }),
    ]);
    // Fail PM for 200 only.
    mockSendSystemPm.mockImplementation(async (recipient) => {
      if (recipient === '200') throw new Error('PM down for 200');
    });

    const result = await applyConversationMigration({ dryRun: false });

    expect(result.pmDispatchFailures).toBe(1);
    expect(result.pmDispatchFailedRecipients).toEqual(['200']);
  });

  test('group PMs skip non-integer participant ids (data corruption defence)', async () => {
    seedUsers([userDoc(100, { cohort: 'adult' }), userDoc(200, { cohort: 'minor' })]);
    seedConversations([
      convDoc('g1', {
        participantIds: ['100', '200', 'SHYTALK_SYSTEM', 'not-a-number'],
        isGroup: true,
        groupName: 'Mixed',
      }),
    ]);

    await applyConversationMigration({ dryRun: false });

    const recipients = mockSendSystemPm.mock.calls.map((c) => c[0]).sort();
    expect(recipients).toEqual(['100', '200']);
  });
});

// ──────────────────────────────────────────────────────────────────
// formatConversationHiddenPm — cohort-agnostic PM for 1:1 hide
// ──────────────────────────────────────────────────────────────────

describe('formatConversationHiddenPm', () => {
  test('includes the sanitised counterparty displayName when provided', () => {
    const body = formatConversationHiddenPm({ counterpartyDisplayName: 'Alice' });
    expect(body).toContain('Alice');
  });

  test('falls back to "another user" when displayName is null (block-bypass)', () => {
    const body = formatConversationHiddenPm({ counterpartyDisplayName: null });
    expect(body).toContain('another user');
    expect(body).not.toContain('null');
  });

  test('falls back when displayName is whitespace-only', () => {
    const body = formatConversationHiddenPm({ counterpartyDisplayName: '   ' });
    expect(body).toContain('another user');
  });

  test('strips raw HTML brackets + ampersand (XSS defence)', () => {
    const body = formatConversationHiddenPm({
      counterpartyDisplayName: '<script>alert(1)</script> & evil',
    });
    expect(body).not.toContain('<script>');
    expect(body).not.toContain('</script>');
    expect(body).not.toContain('&');
  });

  test('truncates very long displayNames', () => {
    const body = formatConversationHiddenPm({ counterpartyDisplayName: 'A'.repeat(500) });
    const firstLine = body.split('\n')[0];
    expect(firstLine.length).toBeLessThan(200);
    expect(firstLine).toContain('…');
  });

  test('is cohort-agnostic — no cohort vocabulary anywhere in body', () => {
    const body = formatConversationHiddenPm({ counterpartyDisplayName: 'Alice' });
    expect(body).not.toMatch(/\badult\b/i);
    expect(body).not.toMatch(/\bminor\b/i);
    expect(body).not.toMatch(/\bage\b/i);
    expect(body).not.toMatch(/\bcohort\b/i);
    expect(body).not.toMatch(/\bsegregation\b/i);
    expect(body).not.toMatch(/under 18/i);
    expect(body).not.toMatch(/over 18/i);
    expect(body).not.toMatch(/younger/i);
    expect(body).not.toMatch(/older/i);
    expect(body).not.toMatch(/\bteen\b/i);
    expect(body).not.toMatch(/\bkid\b/i);
    expect(body).not.toMatch(/\bdifferent group\b/i);
    expect(body).not.toMatch(/\bnot in the same\b/i);
  });

  test('includes the load-bearing cohort-agnostic phrase (positive pin)', () => {
    const body = formatConversationHiddenPm({ counterpartyDisplayName: 'Alice' });
    expect(body).toContain('recent change to how ShyTalk organises accounts');
  });
});

// ──────────────────────────────────────────────────────────────────
// formatGroupFrozenPm — cohort-agnostic PM for group freeze
// ──────────────────────────────────────────────────────────────────

describe('formatGroupFrozenPm', () => {
  test('includes the sanitised group name when provided', () => {
    const body = formatGroupFrozenPm({ groupName: 'Movie Club' });
    expect(body).toContain('Movie Club');
  });

  test('falls back to "a group" when groupName is null', () => {
    const body = formatGroupFrozenPm({ groupName: null });
    expect(body).toContain('a group');
    expect(body).not.toContain('null');
  });

  test('falls back when groupName is whitespace-only', () => {
    const body = formatGroupFrozenPm({ groupName: '   ' });
    expect(body).toContain('a group');
  });

  test('strips raw HTML brackets + ampersand (XSS defence)', () => {
    const body = formatGroupFrozenPm({ groupName: '<b>Evil</b> & co' });
    expect(body).not.toContain('<b>');
    expect(body).not.toContain('</b>');
    expect(body).not.toContain('&');
  });

  test('truncates very long group names', () => {
    const body = formatGroupFrozenPm({ groupName: 'G'.repeat(500) });
    const firstLine = body.split('\n')[0];
    expect(firstLine.length).toBeLessThan(200);
    expect(firstLine).toContain('…');
  });

  test('mentions that no new members can be added (load-bearing semantics)', () => {
    // Positive pin on the phrase that signals the "preserved but
    // cannot grow further" contract per the design doc. Copy edits
    // may rephrase but must keep the no-new-members signal.
    const body = formatGroupFrozenPm({ groupName: 'Movie Club' });
    expect(body.toLowerCase()).toMatch(/new members|cannot grow|cannot be added/);
  });

  test('is cohort-agnostic — no cohort vocabulary anywhere in body', () => {
    const body = formatGroupFrozenPm({ groupName: 'Movie Club' });
    expect(body).not.toMatch(/\badult\b/i);
    expect(body).not.toMatch(/\bminor\b/i);
    expect(body).not.toMatch(/\bage\b/i);
    expect(body).not.toMatch(/\bcohort\b/i);
    expect(body).not.toMatch(/\bsegregation\b/i);
    expect(body).not.toMatch(/under 18/i);
    expect(body).not.toMatch(/over 18/i);
    expect(body).not.toMatch(/younger/i);
    expect(body).not.toMatch(/older/i);
    expect(body).not.toMatch(/\bteen\b/i);
    expect(body).not.toMatch(/\bkid\b/i);
  });

  test('includes the load-bearing cohort-agnostic phrase (positive pin)', () => {
    const body = formatGroupFrozenPm({ groupName: 'Movie Club' });
    expect(body).toContain('recent change to how ShyTalk organises accounts');
  });
});

// ──────────────────────────────────────────────────────────────────
// determineMode — CLI flag parser
// ──────────────────────────────────────────────────────────────────

describe('determineMode', () => {
  test('returns dry-run mode for --dry-run alone', () => {
    expect(determineMode(['--dry-run'], {})).toEqual({ mode: 'dry-run' });
  });

  test('returns apply mode for --apply when MIGRATION_CONFIRM=yes', () => {
    expect(determineMode(['--apply'], { MIGRATION_CONFIRM: 'yes' })).toEqual({
      mode: 'apply',
    });
  });

  test('refuses --apply without MIGRATION_CONFIRM=yes', () => {
    const result = determineMode(['--apply'], {});
    expect(result.error).toBe('no-confirm');
    expect(result.exitCode).toBe(3);
  });

  test('refuses --apply with MIGRATION_CONFIRM set to wrong value', () => {
    const result = determineMode(['--apply'], { MIGRATION_CONFIRM: 'YES' });
    expect(result.error).toBe('no-confirm');
  });

  test('refuses missing both flags', () => {
    const result = determineMode([], {});
    expect(result.error).toBe('no-mode');
    expect(result.exitCode).toBe(2);
  });

  test('refuses --dry-run AND --apply simultaneously (mutual exclusion)', () => {
    // The most subtle bug class: operator sets MIGRATION_CONFIRM=yes,
    // types both flags, and gets a dry-run pass while believing they
    // ran --apply. Fail loud instead.
    const result = determineMode(['--dry-run', '--apply'], { MIGRATION_CONFIRM: 'yes' });
    expect(result.error).toBe('mutually-exclusive');
    expect(result.exitCode).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────
// writeSnapshot
// ──────────────────────────────────────────────────────────────────

describe('writeSnapshot', () => {
  test('creates the migration-snapshots dir if missing', async () => {
    await writeSnapshot({
      crossCohortEdges: [],
      affectedFollowsCount: 0,
      preservedFollowsCount: 0,
      staleEdgeCount: 0,
    });
    expect(mockMkdirSync).toHaveBeenCalled();
    const [dir, opts] = mockMkdirSync.mock.calls[0];
    expect(dir).toMatch(/migration-snapshots$/);
    expect(opts).toEqual({ recursive: true });
  });

  test('writes a JSON file with the expected top-level shape', async () => {
    const scan = {
      crossCohortEdges: [
        {
          from: '100',
          fromCohort: 'adult',
          fromDisplayName: 'Alice',
          to: '200',
          toCohort: 'minor',
          toDisplayName: 'Bob',
        },
      ],
      affectedFollowsCount: 1,
      preservedFollowsCount: 5,
      staleEdgeCount: 2,
    };
    await writeSnapshot(scan);

    expect(mockWriteFileSync).toHaveBeenCalled();
    const [file, body] = mockWriteFileSync.mock.calls[0];
    expect(file).toMatch(/seg-relationships-.*\.json$/);
    const parsed = JSON.parse(body);
    expect(parsed).toMatchObject({
      migration: 'seg-relationships',
      affectedFollowsCount: 1,
      preservedFollowsCount: 5,
      staleEdgeCount: 2,
    });
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.edges[0]).toMatchObject({ from: '100', to: '200' });
    expect(typeof parsed.ranAt).toBe('string');
  });

  test('writes the file with restricted mode 0o600 (PII defence)', async () => {
    await writeSnapshot({
      crossCohortEdges: [],
      affectedFollowsCount: 0,
      preservedFollowsCount: 0,
      staleEdgeCount: 0,
    });
    const opts = mockWriteFileSync.mock.calls[0][2];
    expect(opts).toEqual({ mode: 0o600 });
  });

  test('uses a filesystem-safe timestamp suffix (no colons / dots)', async () => {
    await writeSnapshot({
      crossCohortEdges: [],
      affectedFollowsCount: 0,
      preservedFollowsCount: 0,
      staleEdgeCount: 0,
    });
    const file = mockWriteFileSync.mock.calls[0][0];
    const suffix = file.match(/seg-relationships-(.+)\.json$/)[1];
    expect(suffix).not.toContain(':');
    expect(suffix).not.toContain('.');
  });
});

// ──────────────────────────────────────────────────────────────────
// Module exports — the migration's public surface is part of its
// contract; failing to export a documented helper would break the
// caller (main) silently and isn't caught by other tests.
// ──────────────────────────────────────────────────────────────────

describe('module exports', () => {
  test('exposes the documented public surface', () => {
    const mod = require('../../scripts/migrate-segregation-relationships');
    expect(typeof mod.scanCrossCohortEdges).toBe('function');
    expect(typeof mod.scanCrossCohortRooms).toBe('function');
    expect(typeof mod.scanCrossCohortConversations).toBe('function');
    expect(typeof mod.applyMigration).toBe('function');
    expect(typeof mod.applyRoomMigration).toBe('function');
    expect(typeof mod.applyConversationMigration).toBe('function');
    expect(typeof mod.formatRelationshipRemovedPm).toBe('function');
    expect(typeof mod.formatRoomEjectionPm).toBe('function');
    expect(typeof mod.formatConversationHiddenPm).toBe('function');
    expect(typeof mod.formatGroupFrozenPm).toBe('function');
    expect(typeof mod.sanitiseDisplayName).toBe('function');
    expect(typeof mod.isPositiveIntegerString).toBe('function');
    expect(typeof mod.writeSnapshot).toBe('function');
    expect(typeof mod.determineMode).toBe('function');
    expect(mod.VALID_COHORTS).toBeInstanceOf(Set);
    expect(mod.VALID_COHORTS.has('adult')).toBe(true);
    expect(mod.VALID_COHORTS.has('minor')).toBe(true);
    expect(typeof mod.SAFE_DISPLAY_NAME_MAX_LEN).toBe('number');
    expect(mod.SEGREGATION_EVENTS_COLLECTION).toBe('segregationEvents');
  });
});

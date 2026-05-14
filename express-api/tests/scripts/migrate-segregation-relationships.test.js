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
  applyMigration,
  formatRelationshipRemovedPm,
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
    expect(typeof mod.applyMigration).toBe('function');
    expect(typeof mod.formatRelationshipRemovedPm).toBe('function');
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

/**
 * UK OSA #17 PR 11 — FCM dispatcher cross-cohort filter.
 *
 * Defence-in-depth: even if a future caller forgets the upstream
 * `requireSameCohort` gate, the FCM dispatcher itself drops payloads
 * whose sender and recipient are in different cohorts. Push is a
 * side-channel ("you got a DM from X") that would otherwise leak
 * cross-cohort presence to a minor's device — silent drop is the
 * equivalent of the HTTP gate's 404 existence-hiding.
 *
 * Contract under test (utils/fcm.js#sendFcmToTokens):
 *
 *   - Opt-in via `{ senderUniqueId, recipientUniqueId }`. System /
 *     admin / self pushes that pass neither (legacy callers) keep
 *     existing behavior — no Firestore reads, no filter.
 *   - When both IDs are provided AND distinct, the dispatcher loads
 *     both user docs and compares `effectiveCohort` (cohortOverride ||
 *     cohort || 'minor').
 *   - Same cohort → push sent normally (or local-mode captured).
 *   - Cross cohort → push dropped; one fire-and-forget audit doc
 *     written to `segregationEvents` with `action: 'push_blocked'`
 *     and `surface: 'fcm:dispatch'`. No `_fcmCaptures` entry in
 *     local mode (the drop must not pollute integration tests).
 *   - Sender or recipient doc missing / Firestore read fails →
 *     fail-CLOSED (drop). Defence-in-depth's whole point is to catch
 *     paths where the upstream gate may not have run; allowing a push
 *     on a read error would defeat that.
 *   - Audit write failure is swallowed — the drop still happens. A
 *     leaked "audit failed" log signal must NEVER surface to callers.
 *   - Self push (sender === recipient) skips the filter regardless of
 *     cohort fields — a user notifying themselves cannot leak their
 *     own cohort to themselves.
 *
 * Test scaffold mirrors PR 10's leaderboards-cohort.test.js: doc-path
 * map for the Firestore mock, dedicated mock for the segregationEvents
 * collection, and a `segregation-audit` mock surface so audit-failure
 * paths can be exercised without bleeding into the real Firestore stub.
 */

const mockDocGet = jest.fn();
const mockSegregationAdd = jest.fn().mockResolvedValue({ id: 'evt_1' });
const mockSendEachForMulticast = jest.fn();
const mockArrayRemove = jest.fn((...t) => ({ _arrayRemove: t }));

const docResponses = new Map();
function setUser(uniqueId, data) {
  if (data === undefined) {
    docResponses.set(`users/${uniqueId}`, { exists: false, data: () => undefined });
  } else {
    docResponses.set(`users/${uniqueId}`, { exists: true, data: () => data });
  }
}
function clearUsers() {
  docResponses.clear();
}

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: () => mockDocGet(path),
      update: jest.fn().mockResolvedValue(),
    })),
    collection: jest.fn((name) => {
      if (name === 'segregationEvents') {
        return { add: mockSegregationAdd };
      }
      return {
        get: () => Promise.resolve({ empty: true, docs: [] }),
      };
    }),
  },
  FieldValue: {
    arrayRemove: (...args) => mockArrayRemove(...args),
  },
  messaging: {
    sendEachForMulticast: (...args) => mockSendEachForMulticast(...args),
  },
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

let sendFcmToTokens;
let getFcmCaptures;
let clearFcmCaptures;
let log;
let resetFcmAuditDedup;

const ADULT_USER = { id: '10000001', data: { cohort: 'adult' } };
const ANOTHER_ADULT = { id: '10000002', data: { cohort: 'adult' } };
const MINOR_USER = { id: '10000003', data: { cohort: 'minor' } };
const ANOTHER_MINOR = { id: '10000004', data: { cohort: 'minor' } };
const ADULT_VIA_OVERRIDE = {
  id: '10000005',
  data: { cohort: 'minor', cohortOverride: 'adult' },
};
const MINOR_VIA_OVERRIDE = {
  id: '10000006',
  data: { cohort: 'adult', cohortOverride: 'minor' },
};
const UNKNOWN_COHORT_USER = { id: '10000007', data: {} }; // effectiveCohort → 'minor'

const TOKENS = ['tok-a', 'tok-b'];
const PAYLOAD = { type: 'PM', title: 'New message' };

function primeAllUsers() {
  setUser(ADULT_USER.id, ADULT_USER.data);
  setUser(ANOTHER_ADULT.id, ANOTHER_ADULT.data);
  setUser(MINOR_USER.id, MINOR_USER.data);
  setUser(ANOTHER_MINOR.id, ANOTHER_MINOR.data);
  setUser(ADULT_VIA_OVERRIDE.id, ADULT_VIA_OVERRIDE.data);
  setUser(MINOR_VIA_OVERRIDE.id, MINOR_VIA_OVERRIDE.data);
  setUser(UNKNOWN_COHORT_USER.id, UNKNOWN_COHORT_USER.data);
}

function mountFcmModule(nodeEnv) {
  jest.isolateModules(() => {
    process.env.NODE_ENV = nodeEnv;
    ({ sendFcmToTokens, getFcmCaptures, clearFcmCaptures } = require('../../src/utils/fcm'));
    log = require('../../src/utils/log');
    ({ _resetFcmAuditDedup: resetFcmAuditDedup } = require('../../src/utils/segregation-audit'));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  clearUsers();
  // Reset the PR 11 audit-write dedup so per-test "exactly N audits"
  // expectations are independent. Without this, the second cross-
  // cohort test sees zero audit writes (the first test already won
  // the 5-min dedup window for that source:target key).
  if (resetFcmAuditDedup) resetFcmAuditDedup();
  mockDocGet.mockImplementation((path) => {
    const resp = docResponses.get(path);
    if (resp) return Promise.resolve(resp);
    return Promise.resolve({ exists: false, data: () => undefined });
  });
  mockSendEachForMulticast.mockResolvedValue({ responses: TOKENS.map(() => ({ error: null })) });
  primeAllUsers();
});

// ────────────────────────────────────────────────────────────────────
// 1. Legacy callers (no identity params) — back-compat unchanged
// ────────────────────────────────────────────────────────────────────

describe('sendFcmToTokens — legacy callers without identity params', () => {
  beforeAll(() => mountFcmModule('test'));

  test('omits both IDs → no Firestore reads, payload dispatched', async () => {
    const invalid = await sendFcmToTokens(TOKENS, PAYLOAD);
    expect(invalid).toEqual([]);
    expect(mockDocGet).not.toHaveBeenCalled();
    expect(mockSegregationAdd).not.toHaveBeenCalled();
    expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
  });

  test('omits sender only → no filter, dispatch proceeds', async () => {
    const invalid = await sendFcmToTokens(TOKENS, PAYLOAD, {
      recipientUniqueId: ADULT_USER.id,
    });
    expect(invalid).toEqual([]);
    expect(mockDocGet).not.toHaveBeenCalled();
    expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
  });

  test('omits recipient only → no filter, dispatch proceeds', async () => {
    const invalid = await sendFcmToTokens(TOKENS, PAYLOAD, {
      senderUniqueId: ADULT_USER.id,
    });
    expect(invalid).toEqual([]);
    expect(mockDocGet).not.toHaveBeenCalled();
    expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
  });

  test('empty tokens array → returns [] without any Firestore reads', async () => {
    const invalid = await sendFcmToTokens([], PAYLOAD, {
      senderUniqueId: ADULT_USER.id,
      recipientUniqueId: MINOR_USER.id,
    });
    expect(invalid).toEqual([]);
    expect(mockDocGet).not.toHaveBeenCalled();
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('null tokens → returns [] without any Firestore reads', async () => {
    const invalid = await sendFcmToTokens(null, PAYLOAD, {
      senderUniqueId: ADULT_USER.id,
      recipientUniqueId: MINOR_USER.id,
    });
    expect(invalid).toEqual([]);
    expect(mockDocGet).not.toHaveBeenCalled();
  });

  test('null sender ID + valid recipient → filter skipped (treated as legacy)', async () => {
    // Defence-in-depth invariant: a null in either slot must not
    // produce a Firestore read. The conversations / rooms call sites
    // pull `senderId` from `req.auth.uniqueId` which is never null in
    // practice, but the dispatcher must not assume that.
    const invalid = await sendFcmToTokens(TOKENS, PAYLOAD, {
      senderUniqueId: null,
      recipientUniqueId: MINOR_USER.id,
    });
    expect(invalid).toEqual([]);
    expect(mockDocGet).not.toHaveBeenCalled();
    expect(mockSegregationAdd).not.toHaveBeenCalled();
    expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
  });

  test('valid sender + null recipient → filter skipped (treated as legacy)', async () => {
    const invalid = await sendFcmToTokens(TOKENS, PAYLOAD, {
      senderUniqueId: ADULT_USER.id,
      recipientUniqueId: null,
    });
    expect(invalid).toEqual([]);
    expect(mockDocGet).not.toHaveBeenCalled();
    expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
  });
});

// ────────────────────────────────────────────────────────────────────
// 2. Same cohort → push sent, no audit
// ────────────────────────────────────────────────────────────────────

describe('sendFcmToTokens — same-cohort pairs', () => {
  beforeAll(() => mountFcmModule('test'));

  test('adult → adult: payload dispatched, no audit row', async () => {
    const invalid = await sendFcmToTokens(TOKENS, PAYLOAD, {
      senderUniqueId: ADULT_USER.id,
      recipientUniqueId: ANOTHER_ADULT.id,
    });
    expect(invalid).toEqual([]);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
    expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
  });

  test('minor → minor: payload dispatched, no audit row', async () => {
    const invalid = await sendFcmToTokens(TOKENS, PAYLOAD, {
      senderUniqueId: MINOR_USER.id,
      recipientUniqueId: ANOTHER_MINOR.id,
    });
    expect(invalid).toEqual([]);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
    expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
  });

  test('cohortOverride aligns both sides → same cohort, dispatched', async () => {
    // ADULT_VIA_OVERRIDE has cohort='minor' but override='adult'
    const invalid = await sendFcmToTokens(TOKENS, PAYLOAD, {
      senderUniqueId: ADULT_VIA_OVERRIDE.id,
      recipientUniqueId: ANOTHER_ADULT.id,
    });
    expect(invalid).toEqual([]);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
    expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
  });
});

// ────────────────────────────────────────────────────────────────────
// 3. Cross-cohort → silent drop + audit row
// ────────────────────────────────────────────────────────────────────

describe('sendFcmToTokens — cross-cohort pairs', () => {
  beforeAll(() => mountFcmModule('test'));

  test('adult → minor: dropped, audit row written, no FCM call', async () => {
    const invalid = await sendFcmToTokens(TOKENS, PAYLOAD, {
      senderUniqueId: ADULT_USER.id,
      recipientUniqueId: MINOR_USER.id,
    });
    expect(invalid).toEqual([]);
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
    expect(mockSegregationAdd).toHaveBeenCalledTimes(1);
    expect(mockSegregationAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUniqueId: String(ADULT_USER.id),
        sourceCohort: 'adult',
        targetUniqueId: String(MINOR_USER.id),
        targetCohort: 'minor',
        surface: 'fcm:dispatch',
        action: 'push_blocked',
      }),
    );
    expect(mockSegregationAdd.mock.calls[0][0].timestamp).toEqual(expect.any(Number));
  });

  test('minor → adult: dropped, audit row written', async () => {
    const invalid = await sendFcmToTokens(TOKENS, PAYLOAD, {
      senderUniqueId: MINOR_USER.id,
      recipientUniqueId: ADULT_USER.id,
    });
    expect(invalid).toEqual([]);
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
    expect(mockSegregationAdd).toHaveBeenCalledTimes(1);
    expect(mockSegregationAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUniqueId: String(MINOR_USER.id),
        sourceCohort: 'minor',
        targetUniqueId: String(ADULT_USER.id),
        targetCohort: 'adult',
        action: 'push_blocked',
      }),
    );
  });

  test('cohortOverride flips an "adult" doc to minor for filter purposes', async () => {
    // MINOR_VIA_OVERRIDE: cohort='adult' but override='minor' — effectiveCohort is 'minor'
    const invalid = await sendFcmToTokens(TOKENS, PAYLOAD, {
      senderUniqueId: MINOR_VIA_OVERRIDE.id,
      recipientUniqueId: ADULT_USER.id,
    });
    expect(invalid).toEqual([]);
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
    expect(mockSegregationAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceCohort: 'minor',
        targetCohort: 'adult',
      }),
    );
  });

  test('unknown-cohort doc resolves to "minor" → adult sender is cross-cohort', async () => {
    const invalid = await sendFcmToTokens(TOKENS, PAYLOAD, {
      senderUniqueId: ADULT_USER.id,
      recipientUniqueId: UNKNOWN_COHORT_USER.id,
    });
    expect(invalid).toEqual([]);
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
    expect(mockSegregationAdd).toHaveBeenCalledWith(
      expect.objectContaining({ sourceCohort: 'adult', targetCohort: 'minor' }),
    );
  });

  test('numeric IDs are coerced to strings in audit row', async () => {
    setUser('99999', { cohort: 'adult' });
    setUser('88888', { cohort: 'minor' });
    await sendFcmToTokens(TOKENS, PAYLOAD, {
      senderUniqueId: 99999,
      recipientUniqueId: 88888,
    });
    expect(mockSegregationAdd).toHaveBeenCalledWith(
      expect.objectContaining({ sourceUniqueId: '99999', targetUniqueId: '88888' }),
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// 4. Self-push exemption
// ────────────────────────────────────────────────────────────────────

describe('sendFcmToTokens — self pushes', () => {
  beforeAll(() => mountFcmModule('test'));

  test('sender === recipient: no Firestore reads, no audit, dispatched', async () => {
    const invalid = await sendFcmToTokens(TOKENS, PAYLOAD, {
      senderUniqueId: ADULT_USER.id,
      recipientUniqueId: ADULT_USER.id,
    });
    expect(invalid).toEqual([]);
    expect(mockDocGet).not.toHaveBeenCalled();
    expect(mockSegregationAdd).not.toHaveBeenCalled();
    expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
  });

  test('sender === recipient as number vs string: still treated as self', async () => {
    const invalid = await sendFcmToTokens(TOKENS, PAYLOAD, {
      senderUniqueId: 10000001,
      recipientUniqueId: '10000001',
    });
    expect(invalid).toEqual([]);
    expect(mockDocGet).not.toHaveBeenCalled();
    expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
  });
});

// ────────────────────────────────────────────────────────────────────
// 5. Fail-closed on read errors
// ────────────────────────────────────────────────────────────────────

describe('sendFcmToTokens — read-error fail-closed', () => {
  beforeAll(() => mountFcmModule('test'));

  test('sender doc missing → drop, no FCM call, no audit (no cohorts to record)', async () => {
    setUser('99000', undefined); // not-exists
    setUser(MINOR_USER.id, MINOR_USER.data);
    const invalid = await sendFcmToTokens(TOKENS, PAYLOAD, {
      senderUniqueId: '99000',
      recipientUniqueId: MINOR_USER.id,
    });
    expect(invalid).toEqual([]);
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
    expect(mockSegregationAdd).not.toHaveBeenCalled();
  });

  test('recipient doc missing → drop', async () => {
    setUser(ADULT_USER.id, ADULT_USER.data);
    setUser('99001', undefined);
    const invalid = await sendFcmToTokens(TOKENS, PAYLOAD, {
      senderUniqueId: ADULT_USER.id,
      recipientUniqueId: '99001',
    });
    expect(invalid).toEqual([]);
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
  });

  test('Firestore read throws → drop, error logged, no crash', async () => {
    mockDocGet.mockImplementationOnce(() => Promise.reject(new Error('rpc timeout')));
    const invalid = await sendFcmToTokens(TOKENS, PAYLOAD, {
      senderUniqueId: ADULT_USER.id,
      recipientUniqueId: MINOR_USER.id,
    });
    expect(invalid).toEqual([]);
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(
      'fcm',
      expect.stringContaining('cohort'),
      expect.objectContaining({ error: expect.stringContaining('rpc timeout') }),
    );
  });

  test('audit write fails → push still dropped, error swallowed, promise resolves cleanly', async () => {
    mockSegregationAdd.mockRejectedValueOnce(new Error('quota exceeded'));
    // Explicit `resolves` assertion pins that the audit rejection
    // does NOT bubble out of sendFcmToTokens — without this we'd
    // only catch unhandled-rejection warnings via process-level
    // listeners. Fire-and-forget must be airtight.
    await expect(
      sendFcmToTokens(TOKENS, PAYLOAD, {
        senderUniqueId: ADULT_USER.id,
        recipientUniqueId: MINOR_USER.id,
      }),
    ).resolves.toEqual([]);
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────
// 7. Audit-write dedup — DoS hardening
// ────────────────────────────────────────────────────────────────────

describe('sendFcmToTokens — audit dedup throttles repeat cross-cohort attempts', () => {
  beforeAll(() => mountFcmModule('test'));

  test('repeat cross-cohort (same pair) writes only one audit row in window', async () => {
    // PR 4's HTTP gate dedups audit writes per source:target:surface.
    // The dispatcher uses source:target (one fixed surface). A
    // determined attacker spamming cross-cohort DMs must not be able
    // to drain the Spark-tier daily-write budget via the audit path.
    for (let i = 0; i < 5; i += 1) {
      await sendFcmToTokens(TOKENS, PAYLOAD, {
        senderUniqueId: ADULT_USER.id,
        recipientUniqueId: MINOR_USER.id,
      });
    }
    expect(mockSegregationAdd).toHaveBeenCalledTimes(1);
    expect(mockSendEachForMulticast).not.toHaveBeenCalled(); // every push still dropped
  });

  test('distinct cross-cohort pairs each get their own audit row', async () => {
    await sendFcmToTokens(TOKENS, PAYLOAD, {
      senderUniqueId: ADULT_USER.id,
      recipientUniqueId: MINOR_USER.id,
    });
    await sendFcmToTokens(TOKENS, PAYLOAD, {
      senderUniqueId: ADULT_USER.id,
      recipientUniqueId: ANOTHER_MINOR.id,
    });
    await sendFcmToTokens(TOKENS, PAYLOAD, {
      senderUniqueId: MINOR_USER.id,
      recipientUniqueId: ADULT_USER.id,
    });
    expect(mockSegregationAdd).toHaveBeenCalledTimes(3);
  });

  test('drop is unconditional even when audit row is throttled', async () => {
    // First call writes audit + drops push.
    await sendFcmToTokens(TOKENS, PAYLOAD, {
      senderUniqueId: ADULT_USER.id,
      recipientUniqueId: MINOR_USER.id,
    });
    expect(mockSegregationAdd).toHaveBeenCalledTimes(1);
    mockSegregationAdd.mockClear();
    // Second call: audit deduped, but push MUST still be dropped.
    const invalid = await sendFcmToTokens(TOKENS, PAYLOAD, {
      senderUniqueId: ADULT_USER.id,
      recipientUniqueId: MINOR_USER.id,
    });
    expect(invalid).toEqual([]);
    expect(mockSegregationAdd).not.toHaveBeenCalled();
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────
// 6. Local mode (NODE_ENV=local) integration-test contract
// ────────────────────────────────────────────────────────────────────

describe('sendFcmToTokens — local-mode capture buffer', () => {
  beforeAll(() => mountFcmModule('local'));

  beforeEach(() => {
    clearFcmCaptures();
  });

  test('same-cohort push is captured in the local buffer', async () => {
    const invalid = await sendFcmToTokens(TOKENS, PAYLOAD, {
      senderUniqueId: ADULT_USER.id,
      recipientUniqueId: ANOTHER_ADULT.id,
    });
    expect(invalid).toEqual([]);
    const captures = getFcmCaptures();
    expect(captures).toHaveLength(1);
    expect(captures[0].tokens).toEqual(TOKENS);
    expect(captures[0].data).toEqual(PAYLOAD);
  });

  test('cross-cohort drop is NOT captured (integration tests should see no payload)', async () => {
    const invalid = await sendFcmToTokens(TOKENS, PAYLOAD, {
      senderUniqueId: ADULT_USER.id,
      recipientUniqueId: MINOR_USER.id,
    });
    expect(invalid).toEqual([]);
    expect(getFcmCaptures()).toEqual([]);
    // Audit row still written even in local mode — admins running
    // local integration tests need to see segregationEvents traffic.
    expect(mockSegregationAdd).toHaveBeenCalledTimes(1);
  });

  test('legacy caller (no IDs) still captured in local mode', async () => {
    await sendFcmToTokens(TOKENS, PAYLOAD);
    expect(getFcmCaptures()).toHaveLength(1);
    expect(mockDocGet).not.toHaveBeenCalled();
  });

  test('self push captured in local mode without Firestore reads', async () => {
    await sendFcmToTokens(TOKENS, PAYLOAD, {
      senderUniqueId: ADULT_USER.id,
      recipientUniqueId: ADULT_USER.id,
    });
    expect(getFcmCaptures()).toHaveLength(1);
    expect(mockDocGet).not.toHaveBeenCalled();
  });
});

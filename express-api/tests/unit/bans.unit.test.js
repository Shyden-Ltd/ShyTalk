/**
 * utils/bans.js — UNIT tests (SHY-0149).
 *
 * The mock-necessary slices of the ban engine, relocated here from the old
 * fully-mocked routes/device-info.test.js during its real-emulator
 * migration (doubles are permitted only in unit-test locations):
 *
 *  - checkBans FAIL-OPEN posture (sign-in report): a thrown lookup returns
 *    noBan + logs — it must never turn telemetry into an outage. (The
 *    gate-side FAIL-CLOSED posture is pinned in
 *    tests/unit/auth-ban-gate-posture.unit.test.js.)
 *  - the 500-limit truncation warning (seeding 500 real docs per test run
 *    buys no extra proof — the limit interaction is pure logic).
 *  - pure matcher edges: ASN normalization (the 'AS64500' vs '64500'
 *    defect fixed under SHY-0149), subnet CIDR edges, unknown ban types,
 *    expiry semantics.
 *
 * Everything behavioral (real Firestore queries, Filter.or owner
 * resolution, cache invalidation) is covered against the REAL emulator in
 * tests/middleware/auth-ban-gate.test.js and routes/device-info.test.js.
 */

const mockDocGet = jest.fn();
// One fake per collection: checkUserBans touches networkBans, deviceBans and
// deviceBindings, and the cache assertions below count queries per collection.
const mockNetworkBansGet = jest.fn();
const mockLinkedBansGet = jest.fn();
const mockBindingsGet = jest.fn();

const COLLECTION_FAKES = {
  networkBans: (...a) => mockNetworkBansGet(...a),
  deviceBans: (...a) => mockLinkedBansGet(...a),
  deviceBindings: (...a) => mockBindingsGet(...a),
};

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({ _path: path, get: () => mockDocGet(path) })),
    // networkBans is now PAGED and unfiltered (`isBanActive` is the sole
    // arbiter — R8-C1; paged + fail-closed — R9-C2), while deviceBans and
    // deviceBindings still filter by owner.
    collection: jest.fn((name) => {
      const paged = () => ({
        limit: jest.fn(() => ({
          get: () => COLLECTION_FAKES[name](),
          startAfter: jest.fn((cursor) => ({ get: () => COLLECTION_FAKES[name](cursor) })),
        })),
      });
      return {
        orderBy: jest.fn(paged),
        limit: jest.fn(() => ({ get: () => COLLECTION_FAKES[name]() })),
        where: jest.fn(() => ({
          limit: jest.fn(() => ({ get: () => COLLECTION_FAKES[name]() })),
        })),
      };
    }),
  },
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const log = require('../../src/utils/log');
const {
  checkBans,
  checkUserBans,
  clearBanCache,
  isBanActive,
  networkBanMatches,
  isIpInSubnet,
  NETWORK_BANS_QUERY_LIMIT,
  NETWORK_BANS_MAX_PAGES,
  MAX_CACHE_SIZE,
} = require('../../src/utils/bans');

/** Firestore query-snapshot shape: `.size` + `.docs[].data()` (+ `.id`, `.ref`). */
const mockDelete = jest.fn().mockResolvedValue();
function snap(docs) {
  return {
    size: docs.length,
    docs: docs.map((d, i) => ({
      id: d.id ?? `d${i}`,
      data: () => d,
      // The expired-ban reaper deletes through the doc ref.
      ref: { delete: mockDelete },
    })),
  };
}
const networkBansSnap = snap;

beforeEach(() => {
  jest.clearAllMocks();
  mockDocGet.mockReset();
  mockNetworkBansGet.mockReset();
  mockLinkedBansGet.mockReset();
  mockBindingsGet.mockReset();
  mockDelete.mockClear();
  clearBanCache(); // the module caches ban state process-wide
  mockDocGet.mockResolvedValue({ exists: false });
  mockNetworkBansGet.mockResolvedValue(snap([]));
  mockLinkedBansGet.mockResolvedValue(snap([]));
  mockBindingsGet.mockResolvedValue(snap([]));
});

describe('checkBans is fail-open (sign-in ban REPORT, not the gate)', () => {
  test('a thrown device-ban lookup returns noBan and logs the error', async () => {
    mockDocGet.mockRejectedValue(new Error('firestore down'));

    const result = await checkBans('dev-1', '1.2.3.4', null);

    expect(result).toEqual({ isBanned: false, banType: null, reason: null, expiresAt: null });
    expect(log.error).toHaveBeenCalledWith(
      'bans',
      'Error checking bans',
      expect.objectContaining({ deviceId: 'dev-1' }),
    );
  });

  test('a thrown network-ban query returns noBan (not a crash)', async () => {
    mockNetworkBansGet.mockRejectedValue(new Error('query exploded'));

    const result = await checkBans('dev-2', '1.2.3.4', null);
    expect(result.isBanned).toBe(false);
  });
});

describe('the network-ban scan is paged and fails CLOSED rather than guessing', () => {
  const LIMIT = NETWORK_BANS_QUERY_LIMIT;

  /** A page of `n` permanent bans, ids prefixed so the cursor advances. */
  const page = (prefix, n, extra = {}) =>
    snap(
      Array.from({ length: n }, (_, i) => ({
        id: `${prefix}-${i}`,
        type: 'ip',
        value: `10.0.0.${i}`,
        expiresAt: null,
        ...extra,
      })),
    );

  test('an active ban on the SECOND page is still enforced (a full page is not the end)', async () => {
    // The old design filtered expired docs server-side, so the 500-doc budget
    // held only active bans. It now holds active + not-yet-reaped expired ones,
    // so a single page can silently omit an active ban (reviewer R9-C2).
    const target = { id: 'p2-target', type: 'ip', value: '203.0.113.5', expiresAt: null };
    mockNetworkBansGet
      .mockResolvedValueOnce(page('p1', LIMIT)) // full page → keep going
      .mockResolvedValueOnce(snap([target])); // short page → done

    const result = await checkBans('dev-1', '203.0.113.5', null);
    expect(result).toMatchObject({ isBanned: true, banType: 'network_ip' });
    expect(mockNetworkBansGet).toHaveBeenCalledTimes(2);
  });

  test('a collection larger than the page budget throws — the gate must not guess', async () => {
    mockNetworkBansGet.mockResolvedValue(page('endless', LIMIT)); // every page is full

    // checkBans is the fail-OPEN sign-in report: it absorbs the throw.
    await expect(checkBans('dev-2', '1.2.3.4', null)).resolves.toMatchObject({ isBanned: false });
    expect(log.error).toHaveBeenCalledWith(
      'bans',
      expect.stringContaining('failing closed'),
      expect.any(Object),
    );

    // checkUserBans is the fail-CLOSED gate: the rejection reaches the caller,
    // which turns it into a 401 in authMiddleware.
    clearBanCache();
    await expect(checkUserBans('9001', '1.2.3.4')).rejects.toThrow(/truncated/i);
  });

  // The budget is a DOCUMENT budget (MAX_PAGES x LIMIT), not a page-index
  // budget. A collection of exactly MAX_PAGES full pages was fully scanned —
  // failing it closed locks every caller out of a collection the code claims to
  // support. Only MORE than the budget is unprovable (reviewer R10-I1).
  test('a collection of exactly the budget is scanned COMPLETELY, not failed closed', async () => {
    for (let i = 0; i < NETWORK_BANS_MAX_PAGES; i++) {
      mockNetworkBansGet.mockResolvedValueOnce(page(`full${i}`, LIMIT));
    }
    mockNetworkBansGet.mockResolvedValueOnce(snap([])); // probe: nothing beyond the budget

    await expect(checkUserBans('9101', '198.51.100.7')).resolves.toMatchObject({ isBanned: false });
    expect(log.error).not.toHaveBeenCalled();
  });

  test('a ban on the LAST page of an exactly-budget-sized collection is still enforced', async () => {
    const target = { id: 'last-target', type: 'ip', value: '198.51.100.9', expiresAt: null };
    for (let i = 0; i < NETWORK_BANS_MAX_PAGES - 1; i++) {
      mockNetworkBansGet.mockResolvedValueOnce(page(`full${i}`, LIMIT));
    }
    // Final full page carries the ban; ids stay distinct so the cursor advances.
    const finalPage = page('final', LIMIT - 1);
    finalPage.docs.push({ id: target.id, data: () => target, ref: { delete: mockDelete } });
    finalPage.size = LIMIT;
    mockNetworkBansGet.mockResolvedValueOnce(finalPage);
    mockNetworkBansGet.mockResolvedValueOnce(snap([])); // probe

    await expect(checkUserBans('9102', '198.51.100.9')).resolves.toMatchObject({
      isBanned: true,
      banType: 'network_ip',
    });
  });

  test('one document BEYOND the budget fails closed — that scan cannot be proven complete', async () => {
    for (let i = 0; i < NETWORK_BANS_MAX_PAGES; i++) {
      mockNetworkBansGet.mockResolvedValueOnce(page(`full${i}`, LIMIT));
    }
    mockNetworkBansGet.mockResolvedValueOnce(page('overflow', 1)); // probe finds one more

    await expect(checkUserBans('9103', '1.2.3.4')).rejects.toThrow(/truncated/i);
  });

  test('a single short page is one query — no needless paging', async () => {
    mockNetworkBansGet.mockResolvedValue(snap([]));
    await checkBans('dev-3', '1.2.3.4', null);
    expect(mockNetworkBansGet).toHaveBeenCalledTimes(1);
  });
});

describe('networkBanMatches — matcher edges', () => {
  test.each([
    ['exact IP match', { type: 'ip', value: '1.2.3.4' }, '1.2.3.4', null, true],
    ['IP mismatch', { type: 'ip', value: '1.2.3.4' }, '1.2.3.5', null, false],
    ['subnet hit', { type: 'subnet', value: '10.5.0.0/16' }, '10.5.200.7', null, true],
    ['subnet miss', { type: 'subnet', value: '10.5.0.0/16' }, '10.6.0.1', null, false],
    ['unknown ban type never matches', { type: 'mystery', value: 'x' }, 'x', 'x', false],
  ])('%s', (_name, ban, ip, asn, expected) => {
    expect(networkBanMatches(ban, ip, asn)).toBe(expected);
  });

  test.each([
    ['numeric ban value vs AS-prefixed caller ASN', '64500', 'AS64500', true],
    ['AS-prefixed ban value vs numeric caller ASN', 'AS64500', '64500', true],
    ['case-insensitive AS prefix', 'as64500', 'AS64500', true],
    ['different ASNs never match', '64500', 'AS64501', false],
    ['null caller ASN never matches', '64500', null, false],
    ['undefined caller ASN never matches', '64500', undefined, false],
  ])('ASN normalization: %s', (_name, banValue, callerAsn, expected) => {
    expect(networkBanMatches({ type: 'asn', value: banValue }, '9.9.9.9', callerAsn)).toBe(
      expected,
    );
  });
});

describe('isIpInSubnet — CIDR edges', () => {
  test('/0 prefix matches every IPv4 address', () => {
    expect(isIpInSubnet('203.0.113.9', '0.0.0.0/0')).toBe(true);
    expect(isIpInSubnet('10.0.0.1', '0.0.0.0/0')).toBe(true);
  });

  test('/32 matches only the exact address', () => {
    expect(isIpInSubnet('203.0.113.9', '203.0.113.9/32')).toBe(true);
    expect(isIpInSubnet('203.0.113.10', '203.0.113.9/32')).toBe(false);
  });

  test('invalid CIDR falls back safely to no-match', () => {
    expect(isIpInSubnet('203.0.113.9', 'not-a-cidr')).toBe(false);
  });

  test('an IPv6 caller address never matches an IPv4 subnet', () => {
    expect(isIpInSubnet('::ffff:203.0.113.9', '203.0.113.0/24')).toBe(false);
  });
});

describe('the active-networkBans list is fetched once, not per request', () => {
  test('N concurrent checkBans calls issue exactly ONE networkBans query (in-flight dedup)', async () => {
    // The deferred must exist BEFORE the calls start — checkBans awaits a doc
    // read first, so the query is not invoked in the same tick.
    let resolveQuery;
    const pending = new Promise((resolve) => {
      resolveQuery = () => resolve(networkBansSnap([]));
    });
    mockNetworkBansGet.mockReturnValue(pending);

    const inFlight = Promise.all([
      checkBans('d1', '1.2.3.4', null),
      checkBans('d2', '1.2.3.4', null),
      checkBans('d3', '1.2.3.4', null),
    ]);
    await Promise.resolve(); // let all three reach getActiveNetworkBans
    resolveQuery();
    await inFlight;

    expect(mockNetworkBansGet).toHaveBeenCalledTimes(1);
  });

  test('a subsequent call is served from the cache, and clearBanCache() forces a re-read', async () => {
    mockNetworkBansGet.mockResolvedValue(networkBansSnap([]));

    await checkBans('d1', '1.2.3.4', null);
    await checkBans('d2', '1.2.3.4', null);
    expect(mockNetworkBansGet).toHaveBeenCalledTimes(1); // cached

    clearBanCache();
    await checkBans('d3', '1.2.3.4', null);
    expect(mockNetworkBansGet).toHaveBeenCalledTimes(2); // re-read after clear
  });

  test('a REJECTED networkBans query is never cached — the next call retries', async () => {
    mockNetworkBansGet.mockRejectedValueOnce(new Error('transient'));
    await checkBans('d1', '1.2.3.4', null); // fail-open, nothing cached

    mockNetworkBansGet.mockResolvedValue(
      networkBansSnap([{ type: 'ip', value: '1.2.3.4', expiresAt: null }]),
    );
    const result = await checkBans('d2', '1.2.3.4', null);
    expect(result).toMatchObject({ isBanned: true, banType: 'network_ip' });
  });
});

describe('userBanCache is bounded, and a recently-used entry is not evicted (LRU)', () => {
  test('a key USED once mid-flood survives; the same key would be evicted under FIFO', async () => {
    // Each distinct uniqueId costs one deviceBans query on a cache MISS, so
    // query counts are the observable proxy for "was it still cached?".
    //
    // The construction must DISTINGUISH LRU from FIFO. Touching the hot key on
    // every iteration does not: eviction only begins near the end, and a FIFO
    // eviction is immediately undone by the very next miss-and-reinsert. So:
    // insert `hot` FIRST, touch it exactly ONCE at the midpoint, then flood
    // hard enough that ~10 evictions occur. Under FIFO `hot` sits at insertion
    // position 0 and is the first thing evicted; under LRU the mid-flood touch
    // moved it to the tail, so the fillers go first.
    const half = MAX_CACHE_SIZE / 2;

    await checkUserBans('hot-key', '1.2.3.4'); // insertion position 0
    for (let i = 0; i < half; i++) await checkUserBans(`early-${i}`, '1.2.3.4');

    await checkUserBans('hot-key', '1.2.3.4'); // the single LRU refresh

    // Enough inserts to overflow the bound and force ~10 evictions.
    for (let i = 0; i < half + 10; i++) await checkUserBans(`late-${i}`, '1.2.3.4');

    // Sanity: eviction really happened — the oldest filler is gone (a MISS).
    const beforeEarly = mockLinkedBansGet.mock.calls.length;
    await checkUserBans('early-0', '1.2.3.4');
    expect(mockLinkedBansGet.mock.calls.length).toBe(beforeEarly + 1);

    // The refreshed key survived: still a cache HIT, no new query. Under FIFO
    // it would have been evicted before `early-0` and this would fail.
    const beforeHot = mockLinkedBansGet.mock.calls.length;
    await checkUserBans('hot-key', '1.2.3.4');
    expect(mockLinkedBansGet.mock.calls.length).toBe(beforeHot);
  });

  test('N concurrent gate checks for the SAME caller issue exactly one deviceBans query', async () => {
    let release;
    const pending = new Promise((resolve) => {
      release = () => resolve(snap([]));
    });
    mockLinkedBansGet.mockReturnValue(pending);

    const inFlight = Promise.all([
      checkUserBans('dedup-me', '1.2.3.4'),
      checkUserBans('dedup-me', '1.2.3.4'),
      checkUserBans('dedup-me', '1.2.3.4'),
    ]);
    await Promise.resolve();
    release();
    await inFlight;

    expect(mockLinkedBansGet).toHaveBeenCalledTimes(1);
  });

  test('a REJECTED standing lookup is never cached and never pins a stuck in-flight entry', async () => {
    mockLinkedBansGet.mockRejectedValueOnce(new Error('transient'));
    // Fail-closed: the gate propagates rather than returning "not banned".
    await expect(checkUserBans('retry-me', '1.2.3.4')).rejects.toThrow('transient');

    mockLinkedBansGet.mockResolvedValue(snap([{ reason: 'now banned', expiresAt: null }]));
    const result = await checkUserBans('retry-me', '1.2.3.4');
    expect(result).toMatchObject({ isBanned: true, banType: 'device', reason: 'now banned' });
  });
});

describe('isBanActive — expiry semantics', () => {
  test('permanent ban (no expiresAt) is active', () => {
    expect(isBanActive({ reason: 'x' })).toBe(true);
    expect(isBanActive({ expiresAt: null })).toBe(true);
  });

  test('future expiry is active; past expiry is not', () => {
    expect(isBanActive({ expiresAt: new Date(Date.now() + 60_000).toISOString() })).toBe(true);
    expect(isBanActive({ expiresAt: new Date(Date.now() - 60_000).toISOString() })).toBe(false);
  });

  test.each([['garbage'], ['not-a-real-date'], ['2026-13-45'], ['']])(
    'an expiry we cannot parse (%s) keeps the ban in force — never fails open',
    (expiresAt) => {
      // `new Date(x).getTime()` is NaN, and `NaN > Date.now()` is false, so the
      // naive comparison silently retires the ban. A safety control must not
      // lapse because its expiry field is corrupt.
      expect(isBanActive({ expiresAt })).toBe(true);
    },
  );
});

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
    collection: jest.fn((name) => ({
      where: jest.fn(() => ({
        limit: jest.fn(() => ({ get: () => COLLECTION_FAKES[name]() })),
      })),
    })),
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
  MAX_CACHE_SIZE,
} = require('../../src/utils/bans');

/** Firestore query-snapshot shape: `.size` + `.docs[].data()` (+ `.id`). */
function snap(docs) {
  return { size: docs.length, docs: docs.map((d, i) => ({ id: d.id ?? `d${i}`, data: () => d })) };
}
const networkBansSnap = snap;

beforeEach(() => {
  jest.clearAllMocks();
  mockDocGet.mockReset();
  mockNetworkBansGet.mockReset();
  mockLinkedBansGet.mockReset();
  mockBindingsGet.mockReset();
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

describe('network-ban truncation warning', () => {
  test(`warns when the active-ban query returns exactly ${NETWORK_BANS_QUERY_LIMIT} rows`, async () => {
    const bans = Array.from({ length: NETWORK_BANS_QUERY_LIMIT }, (_, i) => ({
      type: 'ip',
      value: `10.0.${Math.floor(i / 250)}.${i % 250}`,
      expiresAt: null,
    }));
    mockNetworkBansGet.mockResolvedValue(networkBansSnap(bans));

    await checkBans('dev-3', '198.51.100.1', null);

    expect(log.warn).toHaveBeenCalledWith(
      'bans',
      expect.stringContaining('truncation'),
      expect.objectContaining({ limit: NETWORK_BANS_QUERY_LIMIT }),
    );
  });

  test('does not warn below the limit', async () => {
    mockNetworkBansGet.mockResolvedValue(
      networkBansSnap([{ type: 'ip', value: '10.0.0.1', expiresAt: null }]),
    );

    await checkBans('dev-4', '198.51.100.1', null);
    expect(log.warn).not.toHaveBeenCalled();
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

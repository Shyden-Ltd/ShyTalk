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
const mockCollectionGet = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({ _path: path, get: () => mockDocGet(path) })),
    collection: jest.fn(() => ({
      where: jest.fn(() => ({
        limit: jest.fn(() => ({ get: () => mockCollectionGet() })),
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
  clearBanCache,
  isBanActive,
  networkBanMatches,
  isIpInSubnet,
  NETWORK_BANS_QUERY_LIMIT,
} = require('../../src/utils/bans');

function networkBansSnap(bans) {
  return { size: bans.length, docs: bans.map((b) => ({ data: () => b })) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDocGet.mockReset();
  mockCollectionGet.mockReset();
  clearBanCache(); // the module caches the network-ban list process-wide
  mockDocGet.mockResolvedValue({ exists: false });
  mockCollectionGet.mockResolvedValue(networkBansSnap([]));
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
    mockCollectionGet.mockRejectedValue(new Error('query exploded'));

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
    mockCollectionGet.mockResolvedValue(networkBansSnap(bans));

    await checkBans('dev-3', '198.51.100.1', null);

    expect(log.warn).toHaveBeenCalledWith(
      'bans',
      expect.stringContaining('truncation'),
      expect.objectContaining({ limit: NETWORK_BANS_QUERY_LIMIT }),
    );
  });

  test('does not warn below the limit', async () => {
    mockCollectionGet.mockResolvedValue(
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

describe('isBanActive — expiry semantics', () => {
  test('permanent ban (no expiresAt) is active', () => {
    expect(isBanActive({ reason: 'x' })).toBe(true);
    expect(isBanActive({ expiresAt: null })).toBe(true);
  });

  test('future expiry is active; past expiry is not', () => {
    expect(isBanActive({ expiresAt: new Date(Date.now() + 60_000).toISOString() })).toBe(true);
    expect(isBanActive({ expiresAt: new Date(Date.now() - 60_000).toISOString() })).toBe(false);
  });
});

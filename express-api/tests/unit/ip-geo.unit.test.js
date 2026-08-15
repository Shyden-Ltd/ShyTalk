/**
 * `getIpGeo` — the shared IP→ASN lookup, and its cache.
 *
 * SHY-0143 extracted this from `device-info.js` so `/api/ban-status` resolves
 * an ASN the SAME way the authenticated path does, then put it on the
 * cold-start path — and on Android, the rotation path, since the Activity
 * declares no configChanges.
 *
 * The cache is not an optimisation. ip-api's free tier caps at ~45 req/min per
 * CALLING ip, and the API server has one egress IP, so that cap is shared by
 * every user of the app. Past it, lookups fail, `asn` is null, and
 * `networkBanMatches` refuses every ASN-scoped ban by design — they would
 * silently stop matching for everyone, a security degradation that scales with
 * how well the app is doing.
 */

const { getIpGeo, clearIpGeoCache } = require('../../src/utils/ip-geo');

const originalFetch = global.fetch;
let calls;

function stubFetch(response) {
  calls = [];
  global.fetch = jest.fn(async (url) => {
    calls.push(url);
    return response;
  });
}

const ok = (body) => ({ ok: true, json: async () => body });

beforeEach(() => {
  clearIpGeoCache();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('lookup', () => {
  test('extracts the ASN from the leading token of `as`', () => {
    // `networkBanMatches` compares this against a ban's stored ASN, so the
    // exact shape decides whether an ASN ban applies.
    stubFetch(ok({ as: 'AS15169 Google LLC', isp: 'Google', country: 'US', regionName: 'CA' }));
    return getIpGeo('198.51.100.1').then((geo) => {
      expect(geo.asn).toBe('AS15169');
      expect(geo.isp).toBe('Google');
    });
  });

  test('a non-IPv4 value never reaches the network', async () => {
    stubFetch(ok({}));
    for (const bad of ['not-an-ip', '', '::1', '2001:db8::1', '999.999.999.999.1']) {
      expect(await getIpGeo(bad)).toEqual({});
    }
    expect(calls).toHaveLength(0);
  });

  test('a non-ok response yields {} rather than throwing', async () => {
    stubFetch({ ok: false, json: async () => ({}) });
    expect(await getIpGeo('198.51.100.2')).toEqual({});
  });

  test('a thrown fetch yields {} rather than propagating', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    });
    expect(await getIpGeo('198.51.100.3')).toEqual({});
  });
});

describe('cache', () => {
  test('a repeated lookup for the same IP hits the network ONCE', async () => {
    stubFetch(ok({ as: 'AS64500 Example', isp: 'Example' }));

    const first = await getIpGeo('198.51.100.10');
    const second = await getIpGeo('198.51.100.10');
    const third = await getIpGeo('198.51.100.10');

    expect(calls).toHaveLength(1);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  test('different IPs are cached independently', async () => {
    calls = [];
    global.fetch = jest.fn(async (url) => {
      calls.push(url);
      return ok({ as: `AS${url.length} Example` });
    });

    const a = await getIpGeo('198.51.100.11');
    const b = await getIpGeo('198.51.100.12');
    await getIpGeo('198.51.100.11');

    expect(calls).toHaveLength(2);
    expect(a.asn).toBeTruthy();
    expect(b.asn).toBeTruthy();
  });

  test('a FAILED lookup is not cached, so ASN bans recover when the quota does', async () => {
    // Caching a failure would pin `asn` to null for the whole TTL and keep
    // ASN-scoped bans switched off for that IP even after ip-api recovers.
    let failing = true;
    calls = [];
    global.fetch = jest.fn(async (url) => {
      calls.push(url);
      return failing ? { ok: false, json: async () => ({}) } : ok({ as: 'AS64500 Example' });
    });

    expect(await getIpGeo('198.51.100.13')).toEqual({});
    failing = false;
    const recovered = await getIpGeo('198.51.100.13');

    expect(calls).toHaveLength(2);
    expect(recovered.asn).toBe('AS64500');
  });

  test('clearIpGeoCache actually clears', async () => {
    stubFetch(ok({ as: 'AS64500 Example' }));
    await getIpGeo('198.51.100.14');
    clearIpGeoCache();
    await getIpGeo('198.51.100.14');

    expect(calls).toHaveLength(2);
  });
});

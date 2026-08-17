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
    stubFetch(
      ok({
        status: 'success',
        as: 'AS15169 Google LLC',
        isp: 'Google',
        country: 'US',
        regionName: 'CA',
      }),
    );
    return getIpGeo('198.51.100.1').then((geo) => {
      expect(geo.asn).toBe('AS15169');
      expect(geo.isp).toBe('Google');
    });
  });

  test('a non-IPv4 value never reaches the network', async () => {
    stubFetch(ok({}));
    // null/undefined included: `req.ip` is undefined when there is no socket,
    // and the repo's convention pins all four input-rejection cases.
    for (const bad of [
      'not-an-ip',
      '',
      '::1',
      '2001:db8::1',
      '999.999.999.999.1',
      null,
      undefined,
    ]) {
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

describe('the request itself', () => {
  test('asks for status AND as — the guard and the ASN both depend on the mask', async () => {
    // ip-api returns ONLY the fields you ask for. `status` was missing from
    // the mask, so the failure guard could never fire — measured against the
    // live service: `?fields=isp,as,country,regionName` answers with no
    // `status` key at all. Nothing asserted the request's content before.
    stubFetch(ok({ status: 'success', as: 'AS1 X' }));
    await getIpGeo('198.51.100.30');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('fields=');
    expect(calls[0]).toContain('status');
    expect(calls[0]).toContain('as');
  });

  test('a response with no status field is treated as a failure', async () => {
    // Fail CLOSED if the mask is ever trimmed again.
    stubFetch(ok({ as: 'AS1 X', isp: 'X' }));
    expect(await getIpGeo('198.51.100.31')).toEqual({});
  });
});

describe('cache correctness', () => {
  test('a success with an EMPTY as IS cached, briefly', async () => {
    // ip-api answers `success` with `as: ""` for addresses it has no routing
    // data for. Caching that pins `asn: null` for the whole TTL, and a null
    // asn makes `networkBanMatches` refuse every ASN-scoped ban for that IP —
    // the exact degradation the cache exists to prevent. "Did the request
    // succeed" is the wrong condition; "did we learn the ASN" is right.
    let empty = true;
    calls = [];
    global.fetch = jest.fn(async (url) => {
      calls.push(url);
      return empty
        ? ok({ status: 'success', as: '', isp: 'Somewhere' })
        : ok({ status: 'success', as: 'AS64500 Example' });
    });

    expect((await getIpGeo('198.51.100.21')).asn).toBeNull();
    empty = false;

    // WITHIN the negative window: still cached, so no second call. An earlier
    // version skipped caching these entirely, which meant every ASN-less IP
    // re-queried on every request — one anonymous caller could then exhaust
    // ip-api's ~45/min shared budget and switch ASN bans off for everyone.
    expect((await getIpGeo('198.51.100.21')).asn).toBeNull();
    expect(calls).toHaveLength(1);

    // PAST it: re-queried, so routing data appearing is picked up promptly.
    const realNow = Date.now;
    try {
      const base = realNow();
      Date.now = () => base + 30 * 1000 + 1;
      const recovered = await getIpGeo('198.51.100.21');
      expect(calls).toHaveLength(2);
      expect(recovered.asn).toBe('AS64500');
    } finally {
      Date.now = realNow;
    }
  });

  test('failures are cached for the SHORT window, not the long one', async () => {
    // The bound that stops a starved ip-api from being re-queried per request.
    calls = [];
    global.fetch = jest.fn(async (url) => {
      calls.push(url);
      return { ok: false, json: async () => ({}) };
    });

    expect(await getIpGeo('198.51.100.23')).toEqual({});
    expect(await getIpGeo('198.51.100.23')).toEqual({});
    expect(calls).toHaveLength(1);

    const realNow = Date.now;
    try {
      const base = realNow();
      Date.now = () => base + 30 * 1000 + 1;
      await getIpGeo('198.51.100.23');
      expect(calls).toHaveLength(2);
    } finally {
      Date.now = realNow;
    }
  });

  test('a SUCCESS with an ASN is cached for the long window', async () => {
    // The negative TTL must not shorten the positive one.
    stubFetch(ok({ status: 'success', as: 'AS64500 Example' }));

    await getIpGeo('198.51.100.24');
    const realNow = Date.now;
    try {
      const base = realNow();
      Date.now = () => base + 60 * 1000; // past the negative TTL, inside the positive
      await getIpGeo('198.51.100.24');
      expect(calls).toHaveLength(1);
    } finally {
      Date.now = realNow;
    }
  });

  test('concurrent lookups for one IP make exactly ONE outbound call', async () => {
    // The stampede: N cold starts from one IP arriving together are N calls
    // even with a cache, because none has completed yet.
    calls = [];
    global.fetch = jest.fn(async (url) => {
      calls.push(url);
      await new Promise((r) => setTimeout(r, 5));
      return ok({ status: 'success', as: 'AS64500 Example' });
    });

    const results = await Promise.all([
      getIpGeo('198.51.100.25'),
      getIpGeo('198.51.100.25'),
      getIpGeo('198.51.100.25'),
      getIpGeo('198.51.100.25'),
    ]);

    expect(calls).toHaveLength(1);
    results.forEach((r) => expect(r.asn).toBe('AS64500'));
  });

  test('an entry expires after the TTL', async () => {
    // Nothing exercised the expiry branch — setting GEO_TTL_MS to Infinity
    // left the suite green.
    const realNow = Date.now;
    stubFetch(ok({ status: 'success', as: 'AS64500 Example' }));
    try {
      let clock = 1000000;
      Date.now = () => clock;

      await getIpGeo('198.51.100.22');
      await getIpGeo('198.51.100.22');
      expect(calls).toHaveLength(1);

      clock += 5 * 60 * 1000 + 1;
      await getIpGeo('198.51.100.22');

      expect(calls).toHaveLength(2);
    } finally {
      Date.now = realNow;
    }
  });

  test('the cache is bounded and evicts oldest-first', async () => {
    // The unbounded-growth defence. Asserting only the size would pass an
    // implementation that evicted the NEWEST, so this pins the ordering.
    calls = [];
    global.fetch = jest.fn(async (url) => {
      calls.push(url);
      return ok({ status: 'success', as: 'AS64500 Example' });
    });

    const MAX = 5000;
    const ipAt = (i) => `10.${Math.floor(i / 65536) % 256}.${Math.floor(i / 256) % 256}.${i % 256}`;
    for (let i = 0; i < MAX + 1; i += 1) {
      await getIpGeo(ipAt(i));
    }

    const afterFill = calls.length;
    await getIpGeo(ipAt(0)); // the first inserted — evicted
    expect(calls.length).toBe(afterFill + 1);

    const beforeLate = calls.length;
    await getIpGeo(ipAt(MAX)); // a recent one — still cached
    expect(calls.length).toBe(beforeLate);
  });
});

describe('cache', () => {
  test('a repeated lookup for the same IP hits the network ONCE', async () => {
    stubFetch(ok({ status: 'success', as: 'AS64500 Example', isp: 'Example' }));

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
      return ok({ status: 'success', as: `AS${url.length} Example` });
    });

    const a = await getIpGeo('198.51.100.11');
    const b = await getIpGeo('198.51.100.12');
    await getIpGeo('198.51.100.11');

    expect(calls).toHaveLength(2);
    expect(a.asn).toBeTruthy();
    expect(b.asn).toBeTruthy();
  });

  test('a FAILED lookup recovers once the SHORT window passes', async () => {
    // Caching a failure for the FULL TTL would keep ASN-scoped bans switched
    // off for that IP for five minutes after ip-api recovers. Not caching it
    // at all was worse — see the negative-TTL tests above.
    let failing = true;
    calls = [];
    global.fetch = jest.fn(async (url) => {
      calls.push(url);
      return failing
        ? { ok: false, json: async () => ({}) }
        : ok({ status: 'success', as: 'AS64500 Example' });
    });

    expect(await getIpGeo('198.51.100.13')).toEqual({});
    failing = false;

    const realNow = Date.now;
    try {
      const base = realNow();
      Date.now = () => base + 30 * 1000 + 1;
      const recovered = await getIpGeo('198.51.100.13');
      expect(calls).toHaveLength(2);
      expect(recovered.asn).toBe('AS64500');
    } finally {
      Date.now = realNow;
    }
  });

  test('an HTTP 200 with status:"fail" recovers once the SHORT window passes', async () => {
    // ip-api reports failures — reserved ranges, invalid queries, and the
    // OVER-QUOTA response — as HTTP 200 with `status: "fail"`. That took the
    // success path, so a null ASN got cached and ASN-scoped bans stayed off
    // for the full TTL: the exact degradation this cache exists to prevent,
    // caused by the cache. The `ok:false` test above does not reach it.
    let failing = true;
    calls = [];
    global.fetch = jest.fn(async (url) => {
      calls.push(url);
      return failing
        ? ok({ status: 'fail', message: 'reserved range' })
        : ok({ status: 'success', as: 'AS64500 Example' });
    });

    expect(await getIpGeo('198.51.100.20')).toEqual({});
    failing = false;

    const realNow = Date.now;
    try {
      const base = realNow();
      Date.now = () => base + 30 * 1000 + 1;
      const recovered = await getIpGeo('198.51.100.20');
      expect(calls).toHaveLength(2);
      expect(recovered.asn).toBe('AS64500');
    } finally {
      Date.now = realNow;
    }
  });

  test('a 429 pauses ALL outbound lookups, not just that IP', async () => {
    // The negative TTL alone inverts the outbound rate at the worst moment:
    // 0.2 calls/min per IP while healthy, 2/min while failing. Against a
    // budget shared through one egress IP, that makes a starved state
    // self-sustaining. ip-api says how long to wait; honour it.
    calls = [];
    global.fetch = jest.fn(async (url) => {
      calls.push(url);
      return { ok: false, status: 429, headers: { get: () => '30' }, json: async () => ({}) };
    });

    expect(await getIpGeo('203.0.113.1')).toEqual({});
    expect(await getIpGeo('203.0.113.2')).toEqual({});
    expect(await getIpGeo('203.0.113.3')).toEqual({});

    expect(calls).toHaveLength(1);
  });

  test('the pause lifts after the X-Ttl the server asked for', async () => {
    calls = [];
    let limited = true;
    global.fetch = jest.fn(async (url) => {
      calls.push(url);
      return limited
        ? { ok: false, status: 429, headers: { get: () => '30' }, json: async () => ({}) }
        : ok({ status: 'success', as: 'AS64500 Example' });
    });

    await getIpGeo('203.0.113.4');
    expect(calls).toHaveLength(1);
    limited = false;

    const realNow = Date.now;
    try {
      const base = realNow();
      Date.now = () => base + 30 * 1000 + 1;
      const recovered = await getIpGeo('203.0.113.5');
      expect(calls).toHaveLength(2);
      expect(recovered.asn).toBe('AS64500');
    } finally {
      Date.now = realNow;
    }
  });

  test('a missing or unparseable X-Ttl still pauses, for a default minute', async () => {
    // Fail-closed on the header: a 429 with no usable hint must not be
    // treated as "carry on".
    calls = [];
    global.fetch = jest.fn(async (url) => {
      calls.push(url);
      return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({}) };
    });

    await getIpGeo('203.0.113.6');
    await getIpGeo('203.0.113.7');

    expect(calls).toHaveLength(1);
  });

  test('clearIpGeoCache actually clears', async () => {
    stubFetch(ok({ status: 'success', as: 'AS64500 Example' }));
    await getIpGeo('198.51.100.14');
    clearIpGeoCache();
    await getIpGeo('198.51.100.14');

    expect(calls).toHaveLength(2);
  });
});

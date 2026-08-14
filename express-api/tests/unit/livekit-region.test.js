/**
 * Unit test for the LiveKit region resolver (src/utils/livekit-region.js).
 *
 * SHY-0125 (EPIC-0003 · SHY-0113 Rooms slice 1). This is a genuine UNIT test:
 * `getRegion(req)` + `getRegionConfig(region)` are PURE logic — they read a
 * request header against a static country set and read env vars. There is no
 * real collaborator (no Firestore / Auth / network / LiveKit server), so the
 * `{ headers }` argument is a plain data FIXTURE (not a mock collaborator) and
 * `process.env` manipulation is real. No test doubles — unit-test location
 * (tests/unit/) keeps it ratchet-exempt while staying double-free.
 *
 * Why a separate unit test: the integration suite (livekit.test.js) proves the
 * route SELECTS the right region by JWT signature, but the route runs in
 * NODE_ENV=local where it deliberately omits the `url` field — so the per-region
 * url/key/secret VALUE matrix cannot be asserted there. This file pins those
 * exact values (region-specific wins over fallback; unknown region → asia
 * branch; nothing set → all undefined).
 */

const { getRegion, getRegionConfig } = require('../../src/utils/livekit-region');

// Distinct sentinel values so each assertion proves WHICH branch resolved.
const VALS = {
  LIVEKIT_URL: 'wss://fallback.example',
  LIVEKIT_API_KEY: 'fallback-key',
  LIVEKIT_API_SECRET: 'fallback-secret',
  LIVEKIT_URL_ASIA: 'wss://asia.example',
  LIVEKIT_KEY_ASIA: 'asia-key',
  LIVEKIT_SECRET_ASIA: 'asia-secret',
  LIVEKIT_URL_EU: 'wss://eu.example',
  LIVEKIT_KEY_EU: 'eu-key',
  LIVEKIT_SECRET_EU: 'eu-secret',
};
const ENV_KEYS = Object.keys(VALS);
const PRIOR = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function clearAll() {
  for (const k of ENV_KEYS) delete process.env[k];
}
function setAll() {
  for (const [k, v] of Object.entries(VALS)) process.env[k] = v;
}
function reqWith(country) {
  // Plain data fixture standing in for an Express req — NOT a mock collaborator.
  return { headers: country === undefined ? {} : { 'cf-ipcountry': country } };
}

beforeEach(clearAll);

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (PRIOR[k] === undefined) delete process.env[k];
    else process.env[k] = PRIOR[k];
  }
});

describe('getRegion — country → region value matrix', () => {
  test('no cf-ipcountry header defaults to asia (direct-to-origin)', () => {
    expect(getRegion(reqWith(undefined))).toBe('asia');
  });

  test('empty cf-ipcountry defaults to asia', () => {
    expect(getRegion(reqWith(''))).toBe('asia');
  });

  test.each(['GB', 'DE', 'FR', 'PL', 'TR', 'SA', 'ZA', 'UA', 'RU', 'AF'])(
    'EU-routed country %s → eu',
    (country) => {
      expect(getRegion(reqWith(country))).toBe('eu');
    },
  );

  test.each(['SG', 'US', 'JP', 'AU', 'IN', 'BR', 'CN', 'KR'])(
    'non-EU country %s → asia',
    (country) => {
      expect(getRegion(reqWith(country))).toBe('asia');
    },
  );

  test('country matching is case-sensitive — lowercase gb is NOT EU (CF sends uppercase ISO codes)', () => {
    // Edge: Cloudflare emits uppercase ISO-3166 alpha-2; the set is uppercase.
    // A lowercase value (only reachable via a spoofed/non-CF header) fails the
    // set membership and falls through to asia — pinned so a future case-fold
    // refactor is a conscious choice, not a silent reroute.
    expect(getRegion(reqWith('gb'))).toBe('asia');
  });
});

describe('getRegionConfig — per-region credential resolution value matrix', () => {
  test('asia: region-specific vars win when set', () => {
    setAll();
    expect(getRegionConfig('asia')).toEqual({
      url: 'wss://asia.example',
      apiKey: 'asia-key',
      apiSecret: 'asia-secret',
    });
  });

  test('eu: region-specific vars win when set', () => {
    setAll();
    expect(getRegionConfig('eu')).toEqual({
      url: 'wss://eu.example',
      apiKey: 'eu-key',
      apiSecret: 'eu-secret',
    });
  });

  test('asia: falls back to the global LIVEKIT_API_* vars when region vars are unset', () => {
    process.env.LIVEKIT_URL = VALS.LIVEKIT_URL;
    process.env.LIVEKIT_API_KEY = VALS.LIVEKIT_API_KEY;
    process.env.LIVEKIT_API_SECRET = VALS.LIVEKIT_API_SECRET;
    expect(getRegionConfig('asia')).toEqual({
      url: 'wss://fallback.example',
      apiKey: 'fallback-key',
      apiSecret: 'fallback-secret',
    });
  });

  test('eu: falls back to the global LIVEKIT_API_* vars when region vars are unset', () => {
    process.env.LIVEKIT_URL = VALS.LIVEKIT_URL;
    process.env.LIVEKIT_API_KEY = VALS.LIVEKIT_API_KEY;
    process.env.LIVEKIT_API_SECRET = VALS.LIVEKIT_API_SECRET;
    expect(getRegionConfig('eu')).toEqual({
      url: 'wss://fallback.example',
      apiKey: 'fallback-key',
      apiSecret: 'fallback-secret',
    });
  });

  test('asia: region key falls back per-field independently (key region-set, secret fallback)', () => {
    // Each field resolves independently (|| per field), so a partially-configured
    // region mixes region + fallback values — pin that exact behaviour.
    process.env.LIVEKIT_KEY_ASIA = 'asia-key';
    process.env.LIVEKIT_API_SECRET = 'fallback-secret';
    process.env.LIVEKIT_URL = 'wss://fallback.example';
    expect(getRegionConfig('asia')).toEqual({
      url: 'wss://fallback.example',
      apiKey: 'asia-key',
      apiSecret: 'fallback-secret',
    });
  });

  test('eu: region url falls back per-field independently (url region-set, key+secret fallback)', () => {
    // Mirror of the asia per-field test for the EU branch — identical ||-per-field
    // logic, so a refactor that breaks EU's chaining (e.g. all-or-nothing fallback)
    // would otherwise slip through.
    process.env.LIVEKIT_URL_EU = 'wss://eu.example';
    process.env.LIVEKIT_API_KEY = 'fallback-key';
    process.env.LIVEKIT_API_SECRET = 'fallback-secret';
    expect(getRegionConfig('eu')).toEqual({
      url: 'wss://eu.example',
      apiKey: 'fallback-key',
      apiSecret: 'fallback-secret',
    });
  });

  test('unknown region resolves via the asia/global branch (only "eu" is special-cased)', () => {
    setAll();
    // getRegionConfig special-cases only 'eu'; everything else uses the asia path.
    expect(getRegionConfig('mars')).toEqual({
      url: 'wss://asia.example',
      apiKey: 'asia-key',
      apiSecret: 'asia-secret',
    });
  });

  test('nothing configured → all fields undefined (the route turns this into a 503)', () => {
    expect(getRegionConfig('asia')).toEqual({
      url: undefined,
      apiKey: undefined,
      apiSecret: undefined,
    });
    expect(getRegionConfig('eu')).toEqual({
      url: undefined,
      apiKey: undefined,
      apiSecret: undefined,
    });
  });
});

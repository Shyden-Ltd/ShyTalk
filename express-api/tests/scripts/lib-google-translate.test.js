/**
 * Unit tests for scripts/lib/google-translate.js.
 *
 * The lib was extracted from scripts/translate-strings.js so both the
 * XML and admin-JS translators can share one Google adapter — keeping
 * the quota contract (`GOOGLE_QUOTA_EXHAUSTED` sentinel) and response
 * parser in one place. Drift across two copies would silently fork on
 * future API changes.
 *
 * The lib must never be called in tests with the real network — every
 * test injects a fake `fetch` so the suite stays offline and
 * deterministic.
 */

const path = require('node:path');

const LIB_PATH = path.join(__dirname, '..', '..', '..', 'scripts', 'lib', 'google-translate.js');

describe('scripts/lib/google-translate.js — module surface', () => {
  test('exports the adapter surface', () => {
    const mod = require(LIB_PATH);
    expect(typeof mod.googleTranslate).toBe('function');
    expect(typeof mod.sleep).toBe('function');
    expect(mod.GOOGLE_QUOTA_EXHAUSTED).toBe('GOOGLE_QUOTA_EXHAUSTED');
  });
});

describe('googleTranslate', () => {
  let googleTranslate;
  let originalFetch;

  beforeAll(() => {
    googleTranslate = require(LIB_PATH).googleTranslate;
  });

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function fakeFetchResolvingTo(body, { status = 200 } = {}) {
    return jest.fn(async () =>
      Object({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      }),
    );
  }

  test('returns the translated text for a single-segment response', async () => {
    global.fetch = fakeFetchResolvingTo([[['hola', 'hello', null, null]]]);
    await expect(googleTranslate('hello', 'es')).resolves.toBe('hola');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('concatenates multi-segment responses', async () => {
    // Google chunks sentences into separate sub-arrays for long input.
    // The adapter joins them so the caller sees one string back.
    global.fetch = fakeFetchResolvingTo([
      [
        ['Hola.', 'Hello.', null, null],
        [' ¿Qué tal?', ' How are you?', null, null],
      ],
    ]);
    await expect(googleTranslate('Hello. How are you?', 'es')).resolves.toBe('Hola. ¿Qué tal?');
  });

  test('maps zh → zh-CN (Google expects the regional code)', async () => {
    const fetchSpy = fakeFetchResolvingTo([[['你好', 'hello', null, null]]]);
    global.fetch = fetchSpy;
    await googleTranslate('hello', 'zh');
    const url = fetchSpy.mock.calls[0][0];
    expect(url).toMatch(/[?&]tl=zh-CN(&|$)/);
  });

  test('passes other locales through unchanged', async () => {
    const fetchSpy = fakeFetchResolvingTo([[['привет', 'hello', null, null]]]);
    global.fetch = fetchSpy;
    await googleTranslate('hello', 'ru');
    const url = fetchSpy.mock.calls[0][0];
    expect(url).toMatch(/[?&]tl=ru(&|$)/);
  });

  test('URL-encodes the source text — apostrophes, ampersands, spaces', async () => {
    const fetchSpy = fakeFetchResolvingTo([[['x', 'x', null, null]]]);
    global.fetch = fetchSpy;
    await googleTranslate("Bob's cat & dog", 'fr');
    const url = fetchSpy.mock.calls[0][0];
    // The string must round-trip via decodeURIComponent to the original.
    const qMatch = url.match(/[?&]q=([^&]+)/);
    expect(qMatch).not.toBeNull();
    expect(decodeURIComponent(qMatch[1])).toBe("Bob's cat & dog");
  });

  test('throws GOOGLE_QUOTA_EXHAUSTED on HTTP 429', async () => {
    global.fetch = fakeFetchResolvingTo({}, { status: 429 });
    await expect(googleTranslate('hello', 'es')).rejects.toThrow('GOOGLE_QUOTA_EXHAUSTED');
  });

  test('throws on other HTTP errors with the status code surfaced', async () => {
    global.fetch = fakeFetchResolvingTo({}, { status: 503 });
    await expect(googleTranslate('hello', 'es')).rejects.toThrow(/503/);
  });

  test('throws on unexpected JSON shape rather than returning garbage', async () => {
    global.fetch = fakeFetchResolvingTo({ not: 'an array' });
    await expect(googleTranslate('hello', 'es')).rejects.toThrow(/unexpected.*shape/i);
  });

  test('treats null sub-arrays as empty strings', async () => {
    // Google occasionally sends `null` for the unchanged-source sub-arrays;
    // the adapter must not crash, just skip those segments.
    global.fetch = fakeFetchResolvingTo([[['Hola', 'Hello', null, null], null]]);
    await expect(googleTranslate('Hello', 'es')).resolves.toBe('Hola');
  });
});

describe('sleep', () => {
  let sleep;
  beforeAll(() => {
    sleep = require(LIB_PATH).sleep;
  });

  test('resolves after at least the requested delay', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    // 5ms grace for timer scheduler jitter on busy hosts.
    expect(elapsed).toBeGreaterThanOrEqual(45);
  });

  test('returns a Promise', () => {
    const p = sleep(0);
    expect(p).toBeInstanceOf(Promise);
    return p; // settle so jest doesn't warn about an unawaited promise
  });
});

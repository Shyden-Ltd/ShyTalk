/**
 * Provider-chain unit tests (SHY-0072): unofficial Google gtx FIRST,
 * self-hosted LibreTranslate fallback, soft-fail to {ok:false}.
 *
 * gtx reality (architect-verified live 2026-06-10): responds text/plain
 * whose body is JSON shaped [[["<translated>","<source>",null,null,10]],
 * null,"<src>",...] — translation at body[0][0][0]; ONE text per call.
 * A wrong-shape body (e.g. LibreTranslate's {translatedText}) must be a
 * SOFT failure that falls through the chain — this exact property is what
 * keeps the pre-existing chat tests (catch-all fetch mock returning the
 * LT shape) green unchanged after the merge.
 */

const { translateOne } = require('../../src/utils/translation-provider');

const GTX_BODY = (t, src = 'en') =>
  JSON.stringify([[[t, 'source-echo', null, null, 10]], null, src]);
const LT_BODY = (t) => JSON.stringify({ translatedText: t, detectedLanguage: { language: 'en' } });

function fetchMock(handlers) {
  // handlers: array of fn(url, opts) -> Response-like or throw; consumed per call
  const calls = [];
  const fn = jest.fn(async (url, opts) => {
    calls.push(String(url));
    const h = handlers[Math.min(calls.length - 1, handlers.length - 1)];
    return h(String(url), opts);
  });
  fn.calls = calls;
  return fn;
}

const okText = (body) => ({
  ok: true,
  status: 200,
  text: async () => body,
  json: async () => JSON.parse(body),
});
const httpFail = (status = 503) => ({
  ok: false,
  status,
  text: async () => 'err',
  json: async () => ({}),
});

describe('translateOne — chain order and shapes', () => {
  test('gtx succeeds: returns its translation, LibreTranslate never called', async () => {
    const f = fetchMock([() => okText(GTX_BODY('Hallo'))]);
    const r = await translateOne('hello', 'de', { fetchImpl: f });
    expect(r).toMatchObject({
      ok: true,
      translated: 'Hallo',
      provider: 'gtx',
      detectedSourceLang: 'en',
    });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.calls[0]).toContain('translate.googleapis.com');
    expect(f.calls[0]).toContain('client=gtx');
  });

  test('gtx HTTP failure falls through to LibreTranslate', async () => {
    const f = fetchMock([() => httpFail(503), () => okText(LT_BODY('Bonjour'))]);
    const r = await translateOne('hello', 'fr', { fetchImpl: f });
    expect(r).toMatchObject({ ok: true, translated: 'Bonjour', provider: 'libretranslate' });
    expect(f).toHaveBeenCalledTimes(2);
  });

  test('gtx wrong-shape body (LT-shaped JSON) is a SOFT failure → falls through', async () => {
    // The catch-all mock scenario from the legacy chat tests.
    const f = fetchMock([() => okText(LT_BODY('Hola'))]);
    const r = await translateOne('hello', 'es', { fetchImpl: f });
    // First call (gtx) got an object, not the nested array → soft fail;
    // second call (LT) gets the same handler (catch-all) and succeeds.
    expect(r.ok).toBe(true);
    expect(r.translated).toBe('Hola');
    expect(r.provider).toBe('libretranslate');
    expect(f).toHaveBeenCalledTimes(2);
  });

  test('gtx non-JSON body is a soft failure → LT serves', async () => {
    const f = fetchMock([() => okText('<html>blocked</html>'), () => okText(LT_BODY('Ciao'))]);
    const r = await translateOne('hello', 'it', { fetchImpl: f });
    expect(r).toMatchObject({ ok: true, translated: 'Ciao', provider: 'libretranslate' });
  });

  test('both providers fail → { ok:false } with reasons, never throws', async () => {
    const f = fetchMock([() => httpFail(429), () => httpFail(500)]);
    const r = await translateOne('hello', 'ja', { fetchImpl: f });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/gtx.*429.*libretranslate.*500/i);
  });

  test('fetch rejection (network) on both → ok:false, no throw', async () => {
    const f = fetchMock([
      () => {
        throw new Error('ECONNREFUSED');
      },
      () => {
        throw new Error('ECONNREFUSED');
      },
    ]);
    await expect(translateOne('hello', 'ko', { fetchImpl: f })).resolves.toMatchObject({
      ok: false,
    });
  });

  test('per-provider timeout: a hanging gtx is abandoned (~3s) and LT serves', async () => {
    jest.useFakeTimers();
    const never = () => new Promise(() => {});
    const f = jest
      .fn()
      .mockImplementationOnce(() => never())
      .mockImplementationOnce(async () => okText(LT_BODY('Hej')));
    const p = translateOne('hello', 'sv', { fetchImpl: f });
    await jest.advanceTimersByTimeAsync(3100);
    const r = await p;
    expect(r).toMatchObject({ ok: true, translated: 'Hej', provider: 'libretranslate' });
    jest.useRealTimers();
  });

  test('gtx echo (input returned unchanged) is a VALID translation, not a miss', async () => {
    const f = fetchMock([() => okText(GTX_BODY('hello'))]);
    const r = await translateOne('hello', 'km', { fetchImpl: f });
    expect(r).toMatchObject({ ok: true, translated: 'hello', provider: 'gtx' });
  });

  test('URL building uses URLSearchParams (text with &, =, # round-trips encoded)', async () => {
    const f = fetchMock([
      (url) => {
        expect(url).toContain(encodeURIComponent('a&b=c#d'));
        return okText(GTX_BODY('x'));
      },
    ]);
    const r = await translateOne('a&b=c#d', 'nl', { fetchImpl: f });
    expect(r.ok).toBe(true);
  });
});

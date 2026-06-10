/**
 * Translation provider chain (SHY-0072): unofficial Google gtx FIRST,
 * self-hosted LibreTranslate fallback (operator decision 2026-06-10 —
 * "google first, libre fallback").
 *
 * gtx reality (architect-verified live 2026-06-10): the endpoint answers
 * `text/plain` whose body is JSON shaped
 *   [[["<translated>","<source>",null,null,10]],null,"<src-lang>",...]
 * so parsing is response.text() + JSON.parse with the translation at
 * body[0][0][0]. It accepts ONE text per call — batch callers fan out
 * with Promise.allSettled (each call individually time-bounded, so any
 * batch resolves in ~TIMEOUT_MS, never N×TIMEOUT).
 *
 * A wrong-shape body is a SOFT failure that falls through the chain —
 * this property is load-bearing: the legacy chat tests use a catch-all
 * fetch mock returning LibreTranslate's shape, which must make gtx
 * fall through and LibreTranslate serve, keeping those tests green
 * unchanged through the endpoint merge.
 *
 * Failures never throw: callers get { ok:false, reason } and own the
 * fail-silent/502 decision per their contract.
 */

const GTX_URL = 'https://translate.googleapis.com/translate_a/single';
const TIMEOUT_MS = 3000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const t = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
      if (typeof t.unref === 'function') t.unref();
    }),
  ]);
}

async function tryGtx(text, target, fetchImpl) {
  const params = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: target, dt: 't', q: text });
  const resp = await withTimeout(fetchImpl(`${GTX_URL}?${params.toString()}`), TIMEOUT_MS, 'gtx');
  if (!resp.ok) throw new Error(`gtx ${resp.status}`);
  // Content-Type is text/plain — manual parse, never resp.json().
  let body;
  try {
    body = JSON.parse(await resp.text());
  } catch {
    throw new Error('gtx malformed body (JSON.parse failure)');
  }
  const translated = body?.[0]?.[0]?.[0];
  if (typeof translated !== 'string') throw new Error('gtx malformed shape');
  return { translated, detectedSourceLang: typeof body?.[2] === 'string' ? body[2] : 'unknown' };
}

async function tryLibreTranslate(text, target, fetchImpl) {
  const base = process.env.LIBRETRANSLATE_URL || 'http://localhost:5000';
  const resp = await withTimeout(
    fetchImpl(`${base}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, source: 'auto', target }),
    }),
    TIMEOUT_MS,
    'libretranslate',
  );
  if (!resp.ok) throw new Error(`libretranslate ${resp.status}`);
  const data = await resp.json();
  if (typeof data?.translatedText !== 'string') throw new Error('libretranslate malformed shape');
  return {
    translated: data.translatedText,
    detectedSourceLang: data.detectedLanguage?.language || 'unknown',
  };
}

/**
 * Translate one text through the chain.
 * @returns {Promise<{ok:true, translated:string, provider:string, detectedSourceLang:string}
 *   | {ok:false, reason:string}>}
 */
async function translateOne(text, target, { fetchImpl = globalThis.fetch } = {}) {
  let gtxReason;
  try {
    const r = await tryGtx(text, target, fetchImpl);
    return { ok: true, provider: 'gtx', ...r };
  } catch (err) {
    gtxReason = err.message;
  }
  try {
    const r = await tryLibreTranslate(text, target, fetchImpl);
    return { ok: true, provider: 'libretranslate', ...r };
  } catch (err) {
    return { ok: false, reason: `gtx: ${gtxReason}; libretranslate: ${err.message}` };
  }
}

module.exports = { translateOne };

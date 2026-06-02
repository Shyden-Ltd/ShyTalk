/**
 * Shared adapter for the free Google Translate web endpoint.
 *
 * Extracted from scripts/translate-strings.js so both the compose-XML
 * translator and scripts/translate-admin-strings.js can share one
 * quota contract — a 429 surfaces as `GOOGLE_QUOTA_EXHAUSTED` and the
 * caller is expected to spool the failed (locale, key, en) tuples into
 * a claude-fallback manifest. Drift across two separate copies would
 * silently fork on future API shape changes.
 *
 * The endpoint is the same one https://translate.google.com/ uses for
 * unauthenticated users — no API key, no quota dashboard, but rate
 * limited (~100 req/min). The official Cloud Translation API requires
 * a paid GCP project; the $0 hosting constraint rules it out.
 */

const GOOGLE_QUOTA_EXHAUSTED = 'GOOGLE_QUOTA_EXHAUSTED';

async function googleTranslate(text, targetLang) {
  // Google's endpoint uses regional code for Mandarin; everything else
  // matches our two-letter locale codes one-to-one.
  const tl = targetLang === 'zh' ? 'zh-CN' : targetLang;
  const url =
    'https://translate.googleapis.com/translate_a/single' +
    '?client=gtx&sl=en&dt=t' +
    `&tl=${encodeURIComponent(tl)}` +
    `&q=${encodeURIComponent(text)}`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ShyTalk-Translate/1.0)' },
  });
  if (resp.status === 429) {
    throw new Error(GOOGLE_QUOTA_EXHAUSTED);
  }
  if (!resp.ok) {
    throw new Error(`Google Translate HTTP ${resp.status}`);
  }
  const json = await resp.json();
  if (!Array.isArray(json) || !Array.isArray(json[0])) {
    throw new Error('Unexpected Google Translate response shape');
  }
  // Long inputs come back as multiple segments — concatenate them so
  // the caller sees one continuous string back. Null sub-arrays
  // (occasional in the response) become empty strings.
  return json[0]
    .map((seg) => (Array.isArray(seg) ? seg[0] : ''))
    .join('');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  googleTranslate,
  sleep,
  GOOGLE_QUOTA_EXHAUSTED,
};

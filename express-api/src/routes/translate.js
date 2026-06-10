/**
 * Translation routes — MERGED endpoint (SHY-0072, operator decision):
 *
 * POST /api/translate
 *   • Authenticated (Bearer attached by authMiddleware): the ORIGINAL
 *     chat-message contract, unchanged — input {text, targetLang,
 *     messagePath}, per-user daily quota, Firestore message-doc cache,
 *     response {translatedText, detectedSourceLang, cached}, 502 when no
 *     provider can translate. Its provider call now goes through the
 *     unified chain + string cache underneath (engine upgrade, same
 *     contract — pinned by tests/routes/translate.test.js, which must
 *     stay green UNCHANGED).
 *   • Anonymous (no Authorization header — index.js skip-list lets it
 *     through): the PUBLIC page-content flow — input {texts[], target},
 *     unified string cache → provider chain (gtx → LibreTranslate) →
 *     fail-silent English with missed[] + X-Translation-Missed header +
 *     dedup'd JSONL miss queue. Always 200 for valid input: the public
 *     page must never break on translation trouble.
 *     Anonymous CHAT-shaped bodies are rejected 401 (chat requires auth).
 *
 * GET /api/translate/quota — authenticated, unchanged.
 *
 * Translated strings are stored/returned RAW — escaping is the
 * renderer's job at insertion (SHY-0073).
 */

const express = require('express');
const { db, FieldValue } = require('../utils/firebase');
const log = require('../utils/log');
const { translateOne } = require('../utils/translation-provider');
const { createTranslationCache } = require('../utils/translation-cache');
const { getDefaultMissQueue } = require('../utils/translation-miss-queue');
const { SUPPORTED_LOCALES } = require('../utils/supported-locales');

const router = express.Router();

const FREE_DAILY_LIMIT = 50;
const PUBLIC_MAX_TEXTS = 50;
const PUBLIC_MAX_TEXT_LEN = 2000;

// Unified string cache — engine-level, shared by both caller classes.
// Env overrides exist for test isolation (fresh module per test via
// jest.resetModules binds these singletons to per-test tmp paths).
const stringCache = createTranslationCache({
  seedPath: process.env.TRANSLATION_CACHE_SEED_PATH || undefined,
  runtimePath: process.env.TRANSLATION_CACHE_RUNTIME_PATH || undefined,
});
const missQueue = getDefaultMissQueue();

/** Chain + string-cache lookup shared by both flows. */
async function translateCached(text, target) {
  const cached = stringCache.get(text, target);
  if (cached !== null) {
    return { ok: true, translated: cached, provider: 'cache', detectedSourceLang: 'unknown' };
  }
  const result = await translateOne(text, target);
  if (result.ok) stringCache.set(text, target, result.translated);
  return result;
}

// ─── Anonymous public-content flow ────────────────────────────────

function validatePublicInput(texts, target) {
  if (target === 'en') return 'target en is a no-op';
  if (!SUPPORTED_LOCALES.includes(target)) return 'Unsupported target locale';
  if (!Array.isArray(texts) || texts.length === 0) return 'texts must be a non-empty array';
  if (texts.length > PUBLIC_MAX_TEXTS) return `Too many texts (max ${PUBLIC_MAX_TEXTS})`;
  for (const t of texts) {
    if (typeof t !== 'string' || t.length === 0) return 'texts entries must be non-empty strings';
    if (t.length > PUBLIC_MAX_TEXT_LEN)
      return `Text too long (max ${PUBLIC_MAX_TEXT_LEN} characters)`;
  }
  return null;
}

async function handlePublicTranslate(req, res) {
  const { texts, target } = req.body || {};
  const inputError = validatePublicInput(texts, target);
  if (inputError) return res.status(400).json({ error: inputError });

  const unique = [...new Set(texts)];
  const translations = {};
  const missed = [];
  let firstReason = null;

  const results = await Promise.allSettled(unique.map((t) => translateCached(t, target)));
  results.forEach((settled, i) => {
    const text = unique[i];
    const r =
      settled.status === 'fulfilled'
        ? settled.value
        : { ok: false, reason: settled.reason?.message };
    if (r.ok) {
      translations[text] = r.translated;
    } else {
      // Fail-silent: English text, recorded as missed, queued for backfill.
      translations[text] = text;
      missed.push(text);
      if (!firstReason) firstReason = r.reason || 'unknown';
      missQueue.enqueue(text, target, r.reason || 'unknown');
    }
  });

  if (missed.length > 0) {
    log.warn('translate', 'provider chain failed for some public texts', {
      target,
      missedCount: missed.length,
      reason: firstReason,
    });
  }

  res.set('X-Translation-Missed', String(missed.length));
  return res.json({ translations, missed });
}

// ─── Authenticated chat flow (original contract) ──────────────────

/** Validate translate request inputs. Returns error string or null. */
function validateTranslateInput(text, targetLang) {
  if (!text || !targetLang) return 'text and targetLang required';
  if (!/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(targetLang)) return 'Invalid language code';
  if (text.length > 5000) return 'Text too long (max 5000 characters)';
  return null;
}

/** Verify the user is a participant of the parent conversation/room. */
async function verifyParticipant(messagePath, uniqueId) {
  const parentPath = messagePath.split('/').slice(0, 2).join('/');
  const parentSnap = await db.doc(parentPath).get();
  if (!parentSnap.exists) return false;
  const participantIds = parentSnap.data().participantIds || [];
  return participantIds.includes(uniqueId);
}

/** Check translation cache on the message doc. */
async function checkTranslationCache(messagePath, targetLang) {
  const msgSnap = await db.doc(messagePath).get();
  return msgSnap.data()?.translations?.[targetLang] || null;
}

async function handleChatTranslate(req, res) {
  const { text, targetLang, messagePath } = req.body;
  const uniqueId = req.auth.uniqueId;

  const inputError = validateTranslateInput(text, targetLang);
  if (inputError) return res.status(400).json({ error: inputError });

  const validMessagePath =
    messagePath &&
    /^(conversations|rooms)\/[a-zA-Z0-9_-]+\/messages\/[a-zA-Z0-9_-]+$/.test(messagePath);

  const participantVerified = validMessagePath
    ? await verifyParticipant(messagePath, uniqueId)
    : false;

  // Check cache
  if (validMessagePath && participantVerified) {
    const cached = await checkTranslationCache(messagePath, targetLang);
    if (cached) return res.json({ translatedText: cached, cached: true });
  }

  // Check quota for non-SuperShy users
  const userSnap = await db.doc(`users/${uniqueId}`).get();
  const userData = userSnap.data() || {};
  const isSuperShy = userData.isSuperShy === true;
  const today = new Date().toISOString().slice(0, 10);

  if (!isSuperShy) {
    const translationDate = userData.translationDate || '';
    const translationsToday = translationDate === today ? userData.translationsToday || 0 : 0;
    if (translationsToday >= FREE_DAILY_LIMIT) {
      return res.status(429).json({
        error: 'Daily translation limit reached',
        limit: FREE_DAILY_LIMIT,
        upgradePrompt: true,
      });
    }
  }

  // Unified chain + string cache. Full-chain failure keeps the original
  // 502 contract for chat callers.
  const result = await translateCached(text, targetLang);
  if (!result.ok) {
    log.error('translate', 'translation provider chain failed', { error: result.reason });
    return res.status(502).json({ error: 'Translation service unavailable' });
  }

  // Cache translation on message doc (only if participant verified)
  if (validMessagePath && participantVerified) {
    db.doc(messagePath)
      .update({ [`translations.${targetLang}`]: result.translated })
      .catch((err) =>
        log.error('translate', 'Failed to cache translation', {
          messagePath,
          targetLang,
          error: err.message,
        }),
      );
  }

  // Increment daily counter (non-SuperShy only)
  if (!isSuperShy) {
    db.doc(`users/${uniqueId}`)
      .update({
        translationsToday: userData.translationDate === today ? FieldValue.increment(1) : 1,
        translationDate: today,
      })
      .catch((err) =>
        log.error('translate', 'Failed to update translation quota', {
          userId: uniqueId,
          error: err.message,
        }),
      );
  }

  return res.json({
    translatedText: result.translated,
    detectedSourceLang: result.detectedSourceLang,
    cached: false,
  });
}

// POST /api/translate — merged entry point
router.post('/translate', async (req, res) => {
  try {
    if (!req.auth) {
      // Anonymous caller. Explicitly chat-shaped bodies ({text/targetLang}
      // without texts) are 401 — chat translation requires authentication,
      // exactly as before. Everything else is treated as a public-flow
      // attempt and gets that flow's 400-grade validation.
      const b = req.body || {};
      const chatShaped =
        b.texts === undefined && (b.text !== undefined || b.targetLang !== undefined);
      if (chatShaped) return res.status(401).json({ error: 'Authentication required' });
      return await handlePublicTranslate(req, res);
    }
    return await handleChatTranslate(req, res);
  } catch (err) {
    log.error('translate', 'Translation request failed', { error: err.message });
    return res.status(500).json({ error: 'Translation failed' });
  }
});

// GET /api/translate/quota
router.get('/translate/quota', async (req, res) => {
  try {
    const uniqueId = req.auth.uniqueId;
    const userSnap = await db.doc(`users/${uniqueId}`).get();
    const userData = userSnap.data() || {};
    const isSuperShy = userData.isSuperShy === true;
    const today = new Date().toISOString().slice(0, 10);
    const translationsToday =
      userData.translationDate === today ? userData.translationsToday || 0 : 0;

    res.json({
      used: translationsToday,
      limit: isSuperShy ? -1 : FREE_DAILY_LIMIT,
      unlimited: isSuperShy,
    });
  } catch (err) {
    log.error('translate', 'Failed to check translation quota', {
      userId: req.auth.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Failed to check quota' });
  }
});

module.exports = router;

/**
 * Translation routes — machine translation via LibreTranslate with caching and quotas.
 *
 * POST /api/translate       → Translate text (cached per message doc)
 * GET  /api/translate/quota → Check daily translation quota
 */

const express = require('express');
const { db, FieldValue } = require('../utils/firebase');
const log = require('../utils/log');

const router = express.Router();

const LIBRETRANSLATE_URL = process.env.LIBRETRANSLATE_URL || 'http://localhost:5000';
const FREE_DAILY_LIMIT = 50;

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

/** Call LibreTranslate API. Returns { translatedText, detectedSourceLang } or null on error. */
async function callLibreTranslate(text, targetLang, res) {
  const ltResp = await fetch(`${LIBRETRANSLATE_URL}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, source: 'auto', target: targetLang }),
  });

  if (!ltResp.ok) {
    const err = await ltResp.text();
    log.error('translate', 'LibreTranslate request failed', { status: ltResp.status, error: err });
    res.status(502).json({ error: 'Translation service unavailable' });
    return null;
  }

  const ltData = await ltResp.json();
  return {
    translatedText: ltData.translatedText,
    detectedSourceLang: ltData.detectedLanguage?.language || 'unknown',
  };
}

// POST /api/translate
router.post('/translate', async (req, res) => {
  try {
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

    const result = await callLibreTranslate(text, targetLang, res);
    if (!result) return; // error response already sent

    // Cache translation on message doc (only if participant verified)
    if (validMessagePath && participantVerified) {
      db.doc(messagePath)
        .update({ [`translations.${targetLang}`]: result.translatedText })
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

    res.json({
      translatedText: result.translatedText,
      detectedSourceLang: result.detectedSourceLang,
      cached: false,
    });
  } catch (err) {
    log.error('translate', 'Translation request failed', { error: err.message });
    res.status(500).json({ error: 'Translation failed' });
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

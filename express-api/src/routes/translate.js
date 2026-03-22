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

// POST /api/translate
router.post('/translate', async (req, res) => {
  try {
    const { text, targetLang, messagePath } = req.body;
    const uniqueId = req.auth.uniqueId;

    if (!text || !targetLang) {
      return res.status(400).json({ error: 'text and targetLang required' });
    }
    if (!/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(targetLang)) {
      return res.status(400).json({ error: 'Invalid language code' });
    }
    if (text.length > 5000) {
      return res.status(400).json({ error: 'Text too long (max 5000 characters)' });
    }

    // Check cache on message doc if messagePath provided
    // Validate messagePath matches expected patterns to prevent path traversal
    const validMessagePath =
      messagePath &&
      /^(conversations|rooms)\/[a-zA-Z0-9_-]+\/messages\/[a-zA-Z0-9_-]+$/.test(messagePath);

    // Verify the user is a participant of the referenced conversation/room
    let participantVerified = false;
    if (validMessagePath) {
      const parentPath = messagePath.split('/').slice(0, 2).join('/');
      const parentSnap = await db.doc(parentPath).get();
      if (parentSnap.exists) {
        const participantIds = parentSnap.data().participantIds || [];
        participantVerified = participantIds.includes(uniqueId);
      }
    }

    if (validMessagePath && participantVerified) {
      const msgSnap = await db.doc(messagePath).get();
      const cached = msgSnap.data()?.translations?.[targetLang];
      if (cached) {
        return res.json({ translatedText: cached, cached: true });
      }
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

    // Call LibreTranslate
    const ltResp = await fetch(`${LIBRETRANSLATE_URL}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: text,
        source: 'auto',
        target: targetLang,
      }),
    });

    if (!ltResp.ok) {
      const err = await ltResp.text();
      log.error('translate', 'LibreTranslate request failed', {
        status: ltResp.status,
        error: err,
      });
      return res.status(502).json({ error: 'Translation service unavailable' });
    }

    const ltData = await ltResp.json();
    const translatedText = ltData.translatedText;
    const detectedSourceLang = ltData.detectedLanguage?.language || 'unknown';

    // Cache translation on message doc (only if participant verified)
    if (validMessagePath && participantVerified) {
      db.doc(messagePath)
        .update({
          [`translations.${targetLang}`]: translatedText,
        })
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

    res.json({ translatedText, detectedSourceLang, cached: false });
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

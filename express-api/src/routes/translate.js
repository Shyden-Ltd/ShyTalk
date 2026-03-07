const express = require('express');
const { db } = require('../utils/firebase');
const { FieldValue } = require('firebase-admin/firestore');

const router = express.Router();

const LIBRETRANSLATE_URL = process.env.LIBRETRANSLATE_URL || 'http://localhost:5000';
const FREE_DAILY_LIMIT = 50;

// POST /api/translate
router.post('/translate', async (req, res) => {
  try {
    const { text, targetLang, messagePath } = req.body;
    const uid = req.auth.uid;

    if (!text || !targetLang) {
      return res.status(400).json({ error: 'text and targetLang required' });
    }

    // Check cache on message doc if messagePath provided
    if (messagePath) {
      const msgSnap = await db.doc(messagePath).get();
      const cached = msgSnap.data()?.translations?.[targetLang];
      if (cached) {
        return res.json({ translatedText: cached, cached: true });
      }
    }

    // Check quota for non-SuperShy users
    const userSnap = await db.doc(`users/${uid}`).get();
    const userData = userSnap.data() || {};
    const isSuperShy = userData.isSuperShy === true;
    const today = new Date().toISOString().slice(0, 10);

    if (!isSuperShy) {
      const translationDate = userData.translationDate || '';
      const translationsToday = translationDate === today ? (userData.translationsToday || 0) : 0;
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
      console.error('LibreTranslate error:', err);
      return res.status(502).json({ error: 'Translation service unavailable' });
    }

    const ltData = await ltResp.json();
    const translatedText = ltData.translatedText;
    const detectedSourceLang = ltData.detectedLanguage?.language || 'unknown';

    // Cache translation on message doc
    if (messagePath) {
      db.doc(messagePath).update({
        [`translations.${targetLang}`]: translatedText,
      }).catch(err => console.error('Cache translation error:', err));
    }

    // Increment daily counter (non-SuperShy only)
    if (!isSuperShy) {
      db.doc(`users/${uid}`).update({
        translationsToday: userData.translationDate === today
          ? FieldValue.increment(1)
          : 1,
        translationDate: today,
      }).catch(err => console.error('Quota update error:', err));
    }

    res.json({ translatedText, detectedSourceLang, cached: false });
  } catch (err) {
    console.error('Translate error:', err);
    res.status(500).json({ error: 'Translation failed' });
  }
});

// GET /api/translate/quota
router.get('/translate/quota', async (req, res) => {
  try {
    const uid = req.auth.uid;
    const userSnap = await db.doc(`users/${uid}`).get();
    const userData = userSnap.data() || {};
    const isSuperShy = userData.isSuperShy === true;
    const today = new Date().toISOString().slice(0, 10);
    const translationsToday = userData.translationDate === today
      ? (userData.translationsToday || 0) : 0;

    res.json({
      used: translationsToday,
      limit: isSuperShy ? -1 : FREE_DAILY_LIMIT,
      unlimited: isSuperShy,
    });
  } catch (err) {
    console.error('Quota check error:', err);
    res.status(500).json({ error: 'Failed to check quota' });
  }
});

module.exports = router;

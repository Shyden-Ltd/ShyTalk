/**
 * Subscription routes for roadmap/suggestion notifications.
 *
 * GET    /subscriptions/me            → get preferences
 * PUT    /subscriptions/me            → update preferences
 * POST   /subscriptions/me/watch      → add to watch list
 * DELETE /subscriptions/me/watch/:id  → remove from watch list
 * POST   /subscriptions/push-token    → register push token
 * DELETE /subscriptions/push-token    → revoke push token
 * POST   /subscriptions/unsubscribe   → one-click email unsubscribe (token-based, no auth)
 */

const crypto = require('node:crypto');
const router = require('express').Router();
const { db, FieldValue } = require('../utils/firebase');
const log = require('../utils/log');
const { now } = require('../utils/helpers');

// Default channel preferences (in-app only for most, +systemMessage for key events)
const DEFAULT_PREFS = {
  roadmapUpdate: { email: false, push: false, inApp: true, systemMessage: false },
  suggestionAccepted: { email: false, push: false, inApp: true, systemMessage: true },
  suggestionPlanned: { email: false, push: false, inApp: true, systemMessage: false },
  suggestionCompleted: { email: false, push: false, inApp: true, systemMessage: true },
  suggestionRejected: { email: false, push: false, inApp: true, systemMessage: true },
  suggestionMerged: { email: false, push: false, inApp: true, systemMessage: true },
  commentOnSuggestion: { email: false, push: false, inApp: true, systemMessage: false },
};

const { computeRoadmapOptedIn } = require('../utils/notification-prefs');

function requireAuth(req, res) {
  if (!req.auth || !req.auth.uniqueId) {
    res.status(401).json({ error: 'Authentication required' });
    return true;
  }
  return false;
}

// ─── GET /subscriptions/me ──────────────────────────────────────

router.get('/subscriptions/me', async (req, res) => {
  try {
    if (requireAuth(req, res)) return;

    const doc = await db.doc(`subscriptions/${req.auth.uniqueId}`).get();
    if (!doc.exists) {
      return res.json({
        channelPreferences: DEFAULT_PREFS,
        scope: 'all',
        watchedFeatures: [],
        watchedSuggestions: [],
        language: 'en',
        pushToken: null,
        email: null,
        emailConsentAt: null,
      });
    }

    res.json(doc.data());
  } catch (err) {
    log.error('subscriptions', 'Failed to get preferences', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /subscriptions/me ──────────────────────────────────────

router.put('/subscriptions/me', async (req, res) => {
  try {
    if (requireAuth(req, res)) return;

    const { channelPreferences, emailConsent, email, scope } = req.body;
    const updates = { updatedAt: now() };

    if (channelPreferences) {
      // GDPR: if any channel enables email, require either emailConsent in this request
      // or existing emailConsentAt in the stored subscription doc
      const wantsEmail = Object.values(channelPreferences).some((ch) => ch && ch.email === true);
      if (wantsEmail && emailConsent !== true) {
        const existing = await db.doc(`subscriptions/${req.auth.uniqueId}`).get();
        const hasConsent = existing.exists && existing.data().emailConsentAt;
        if (!hasConsent) {
          return res
            .status(400)
            .json({ error: 'Email consent required (GDPR). Set emailConsent: true.' });
        }
      }
      updates.channelPreferences = channelPreferences;
    }

    if (emailConsent === true) {
      updates.emailConsentAt = now();
      if (email) updates.email = email;
    } else if (emailConsent === false) {
      updates.emailConsentAt = null;
      // Disable all email channels
      if (updates.channelPreferences) {
        for (const key of Object.keys(updates.channelPreferences)) {
          if (updates.channelPreferences[key]) {
            updates.channelPreferences[key].email = false;
          }
        }
      }
    }

    if (scope) updates.scope = scope;

    // Maintain the denormalised opt-in flag so roadmap-notify can use a
    // server-side filter instead of scanning the whole collection. We
    // recompute against the *full* prefs object (caller-supplied OR
    // existing-doc fallback) so a partial update like `{ inApp: true }`
    // doesn't silently flip the flag to false because the other channels
    // are absent from the request body.
    if (updates.channelPreferences) {
      const roadmapPrefs = updates.channelPreferences.roadmapUpdate;
      updates.roadmapUpdateOptedIn = computeRoadmapOptedIn(roadmapPrefs);
    }

    await db.doc(`subscriptions/${req.auth.uniqueId}`).set(updates, { merge: true });

    // Return current state
    const doc = await db.doc(`subscriptions/${req.auth.uniqueId}`).get();
    res.json(doc.exists ? doc.data() : { channelPreferences: DEFAULT_PREFS });
  } catch (err) {
    log.error('subscriptions', 'Failed to update preferences', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /subscriptions/me/watch ───────────────────────────────

router.post('/subscriptions/me/watch', async (req, res) => {
  try {
    if (requireAuth(req, res)) return;

    const { type, id } = req.body;
    if (!type || !id) return res.status(400).json({ error: 'Type and ID required' });

    // Validate that the target exists
    const collection = type === 'feature' ? 'roadmapFeatures' : 'suggestions';
    const targetDoc = await db.doc(`${collection}/${id}`).get();
    if (!targetDoc.exists) {
      return res.status(404).json({ error: `${type} not found` });
    }

    const field = type === 'feature' ? 'watchedFeatures' : 'watchedSuggestions';
    await db
      .doc(`subscriptions/${req.auth.uniqueId}`)
      .set({ [field]: FieldValue.arrayUnion(id), updatedAt: now() }, { merge: true });

    res.json({ success: true });
  } catch (err) {
    log.error('subscriptions', 'Failed to add watch', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /subscriptions/me/watch/:id ─────────────────────────

router.delete('/subscriptions/me/watch/:id', async (req, res) => {
  try {
    if (requireAuth(req, res)) return;

    const { id } = req.params;
    const doc = await db.doc(`subscriptions/${req.auth.uniqueId}`).get();
    if (!doc.exists) return res.status(404).json({ error: 'Not watching this item' });

    const data = doc.data();
    const inFeatures = (data.watchedFeatures || []).includes(id);
    const inSuggestions = (data.watchedSuggestions || []).includes(id);

    if (!inFeatures && !inSuggestions) {
      return res.status(404).json({ error: 'Not watching this item' });
    }

    const updates = { updatedAt: now() };
    if (inFeatures) updates.watchedFeatures = FieldValue.arrayRemove(id);
    if (inSuggestions) updates.watchedSuggestions = FieldValue.arrayRemove(id);

    await db.doc(`subscriptions/${req.auth.uniqueId}`).update(updates);
    res.json({ success: true });
  } catch (err) {
    log.error('subscriptions', 'Failed to remove watch', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /subscriptions/push-token ─────────────────────────────

router.post('/subscriptions/push-token', async (req, res) => {
  try {
    if (requireAuth(req, res)) return;

    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });

    await db
      .doc(`subscriptions/${req.auth.uniqueId}`)
      .set({ pushToken: token, updatedAt: now() }, { merge: true });

    res.json({ success: true });
  } catch (err) {
    log.error('subscriptions', 'Failed to register push token', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /subscriptions/push-token ───────────────────────────

router.delete('/subscriptions/push-token', async (req, res) => {
  try {
    if (requireAuth(req, res)) return;

    await db
      .doc(`subscriptions/${req.auth.uniqueId}`)
      .set({ pushToken: null, updatedAt: now() }, { merge: true });

    res.json({ success: true });
  } catch (err) {
    log.error('subscriptions', 'Failed to remove push token', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /subscriptions/unsubscribe (no auth — HMAC token-based) ────

router.post('/subscriptions/unsubscribe', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      return res.status(400).json({ error: 'Unsubscribe token required' });
    }

    // Token format: base64(uid:timestamp:hmac)
    const secret = process.env.UNSUBSCRIBE_SECRET || 'dev-unsubscribe-secret';
    let decoded;
    try {
      decoded = Buffer.from(token, 'base64').toString('utf-8');
    } catch {
      return res.status(400).json({ error: 'Invalid unsubscribe token' });
    }

    const parts = decoded.split(':');
    if (parts.length !== 3) {
      return res.status(400).json({ error: 'Invalid unsubscribe token format' });
    }

    const [uid, timestamp, providedHmac] = parts;
    const expectedHmac = crypto
      .createHmac('sha256', secret)
      .update(`${uid}:${timestamp}`)
      .digest('hex');

    if (providedHmac !== expectedHmac) {
      return res.status(403).json({ error: 'Invalid unsubscribe token' });
    }

    // Token is valid — disable email channel for this user
    const subRef = db.collection('subscriptions').doc(uid);
    const subSnap = await subRef.get();
    if (subSnap.exists) {
      const prefs = subSnap.data().preferences || {};
      for (const [event, channels] of Object.entries(prefs)) {
        if (channels && channels.email) {
          prefs[event] = { ...channels, email: false };
        }
      }
      await subRef.update({ preferences: prefs, gdprEmailConsent: false });
    }

    res.json({ success: true, message: 'Email notifications disabled' });
  } catch (err) {
    log.error('subscriptions', 'Unsubscribe failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

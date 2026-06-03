/**
 * Roadmap page authentication routes.
 *
 * GET  /roadmap/me      → check if ShyTalk account exists for authenticated user
 * POST /roadmap/signout → sign out acknowledgment
 */

const router = require('express').Router();
const { db } = require('../utils/firebase');
const log = require('../utils/log');

// Fields safe to expose on the roadmap profile
const SAFE_FIELDS = ['uniqueId', 'displayName', 'avatarUrl', 'profilePhotoUrl'];

const DOWNLOAD_LINKS = {
  android: 'https://play.google.com/store/apps/details?id=com.shyden.shytalk',
  ios: 'https://apps.apple.com/app/shytalk/id6741488545',
};

function requireAuth(req, res) {
  if (!req.auth || (!req.auth.uniqueId && !req.auth.uid)) {
    res.status(401).json({ error: 'Authentication required' });
    return true;
  }
  return false;
}

function pickSafeFields(data) {
  const safe = {};
  for (const key of SAFE_FIELDS) {
    if (key in data) safe[key] = data[key];
  }
  return safe;
}

// ─── GET /roadmap/me ────────────────────────────────────────────

router.get('/roadmap/me', async (req, res) => {
  try {
    if (requireAuth(req, res)) return;

    let userData = null;

    // Try direct lookup by uniqueId
    if (req.auth.uniqueId) {
      const userDoc = await db.doc(`users/${req.auth.uniqueId}`).get();
      if (userDoc.exists) {
        // Trust the authenticated uniqueId, NOT whatever the user-doc payload
        // claims — payload spread comes first so the trusted value wins.
        userData = { ...userDoc.data(), uniqueId: Number(req.auth.uniqueId) };
      }
    }

    // Fallback: lookup via identityMap using Firebase UID
    if (!userData && req.auth.uid) {
      const idSnap = await db
        .collection('identityMap')
        .where('firebaseUid', '==', req.auth.uid)
        .get();

      if (!idSnap.empty) {
        for (const idDoc of idSnap.docs) {
          const idData = idDoc.data();
          // Skip unlinked entries
          if (idData.unlinked) continue;

          const userDoc = await db.doc(`users/${idData.uniqueId}`).get();
          if (userDoc.exists) {
            // Same identity-pinning + numeric coercion as the direct path
            // above. `Number(...)` keeps the response shape consistent
            // across both auth paths (identityMap may legacy-store the FK
            // as a string).
            userData = { ...userDoc.data(), uniqueId: Number(idData.uniqueId) };
            break;
          }
        }
      }
    }

    // No ShyTalk account found
    if (!userData) {
      return res.status(404).json({
        error:
          'No ShyTalk account found. Download the app to create an account, then come back to login.',
        downloadLinks: DOWNLOAD_LINKS,
      });
    }

    // Return safe profile fields only
    res.json(pickSafeFields(userData));
  } catch (err) {
    log.error('roadmap-auth', 'Failed to check account', {
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /roadmap/signout ──────────────────────────────────────

router.post('/roadmap/signout', (req, res) => {
  if (requireAuth(req, res)) return;
  // Sign out is handled client-side (Firebase Auth).
  // This endpoint acknowledges the sign out.
  res.json({ success: true });
});

module.exports = router;

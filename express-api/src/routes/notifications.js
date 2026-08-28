/**
 * Notification routes — FCM token management and notification settings.
 *
 * POST   /api/notifications/token    -> Save an FCM token or installation ID
 * DELETE /api/notifications/token    -> Remove an FCM token or installation ID
 * PATCH  /api/notifications/settings -> Update notification settings
 */

const router = require('express').Router();
const { db, FieldValue } = require('../utils/firebase');
const log = require('../utils/log');

// -- Save FCM token --
/**
 * Work out which registration model the client is speaking.
 *
 * SHY-0244. Firebase replaced the registration-token model with one keyed on
 * the Firebase Installation ID, and the two coexist across a fleet that
 * upgrades over time. The CLIENT declares which it is sending; the shape of
 * the string is never inspected. Guessing would put a user's reachability on a
 * format heuristic, and would store the identifier under the wrong model with
 * no symptom until their notifications quietly stopped.
 *
 * Returns `{ field, value }`, or `{ error }` with the 400 message.
 */
function identifierFrom(body) {
  const token = body?.token;
  const installationId = body?.installationId;
  const hasToken = token !== undefined && token !== null;
  const hasFid = installationId !== undefined && installationId !== null;

  if (hasToken && hasFid) {
    // A client sending both has a bug. Picking one silently would be a
    // coin-flip on whether that device ever receives another notification.
    return { error: 'send exactly one of token or installationId, not both' };
  }
  if (!hasToken && !hasFid) {
    return { error: 'token must be a non-empty string' };
  }

  const value = hasToken ? token : installationId;
  const field = hasToken ? 'fcmTokens' : 'fcmInstallationIds';
  const name = hasToken ? 'token' : 'installationId';
  if (typeof value !== 'string' || value.length === 0 || value.length > 500) {
    return { error: `${name} must be a non-empty string` };
  }
  return { field, value };
}

router.post('/notifications/token', async (req, res) => {
  try {
    const identifier = identifierFrom(req.body);
    if (identifier.error) return res.status(400).json({ error: identifier.error });

    const uniqueId = req.auth.uniqueId;
    await db.doc(`users/${uniqueId}`).update({
      [identifier.field]: FieldValue.arrayUnion(identifier.value),
    });

    return res.json({ success: true });
  } catch (err) {
    log.error('notifications', 'Error saving FCM token', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Remove FCM token --
router.delete('/notifications/token', async (req, res) => {
  try {
    const identifier = identifierFrom(req.body);
    if (identifier.error) return res.status(400).json({ error: identifier.error });

    const uniqueId = req.auth.uniqueId;
    await db.doc(`users/${uniqueId}`).update({
      [identifier.field]: FieldValue.arrayRemove(identifier.value),
    });

    return res.json({ success: true });
  } catch (err) {
    log.error('notifications', 'Error removing FCM token', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Update notification settings --
// -- Read the caller's notification settings (EPIC-0006) --
//
// The PATCH below has existed for a long time; this read did not, so the app
// went straight to Firestore for `users/{id}.pmNotificationsEnabled`. Setter
// behind the API, getter not — the half-migration shape that hid the
// private-messaging outage in SHY-0458.
//
// Deliberately takes NO user id. The client method accepts one, and honouring
// it would let anybody read anybody's settings; the token already says who is
// asking.
const NOTIFICATION_SETTING_FIELDS = [
  'pmNotificationsEnabled',
  'pmSoundEnabled',
  'pmShowTimestamps',
  'pmShowDateSeparators',
  'pmNotificationPreview',
];

/** Absent means enabled — the default the client applied before this existed. */
const DEFAULT_SETTING = true;

router.get('/notifications/settings', async (req, res) => {
  try {
    const snap = await db.doc(`users/${req.auth.uniqueId}`).get();
    const data = (snap.exists && snap.data()) || {};

    const settings = {};
    for (const key of NOTIFICATION_SETTING_FIELDS) {
      // Coerced, so a bad write in Firestore cannot hand the client a string
      // where it expects a boolean.
      settings[key] = key in data ? Boolean(data[key]) : DEFAULT_SETTING;
    }
    return res.json(settings);
  } catch (err) {
    log.error('notifications', 'Error reading notification settings', {
      uniqueId: req.auth?.uniqueId,
      error: err.message,
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/notifications/settings', async (req, res) => {
  try {
    if (!req.body) {
      return res.status(400).json({ error: 'Invalid body' });
    }

    // The same list the GET returns. Two copies would drift, and a setting
    // that can be written but never read back is invisible until somebody
    // notices it does nothing.
    const allowedFields = NOTIFICATION_SETTING_FIELDS;

    const updates = {};
    for (const key of allowedFields) {
      if (key in req.body) updates[key] = !!req.body[key];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields' });
    }

    await db.doc(`users/${req.auth.uniqueId}`).update(updates);

    return res.json({ success: true });
  } catch (err) {
    log.error('notifications', 'Error updating notification settings', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

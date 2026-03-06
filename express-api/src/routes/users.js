/**
 * User routes — profile CRUD, unique ID, suspension appeals, social.
 *
 * GET    /api/users/:uid              → Get user profile
 * PATCH  /api/users/:uid              → Update user profile fields
 * POST   /api/users                   → Create or update user (upsert)
 * POST   /api/users/:uid/unique-id    → Generate a unique numeric ID
 * POST   /api/users/:uid/appeal       → Submit suspension appeal
 * POST   /api/users/:uid/lift-suspension → Lift expired suspension
 * POST   /api/users/:uid/follow       → Follow a user
 * POST   /api/users/:uid/unfollow     → Unfollow a user
 * POST   /api/users/:uid/remove-follower → Remove a follower
 * POST   /api/users/:uid/record-visit → Record profile visit (stalker)
 */

const router = require('express').Router();
const { db, FieldValue } = require('../utils/firebase');
const { generateId, now } = require('../utils/helpers');

// ─── Helpers ─────────────────────────────────────────────────────

async function getDoc(path) {
  const snap = await db.doc(path).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Return a full user doc from Firestore.
 * Imported by admin-users.js — keep it exported.
 */
async function assembleUser(uid) {
  return getDoc(`users/${uid}`);
}

// ── Get user profile ──
router.get('/users/:uid', async (req, res) => {
  try {
    const user = await getDoc(`users/${req.params.uid}`);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Ensure arrays are present even when missing from Firestore doc
    user.blockedUserIds = user.blockedUserIds || [];
    user.followingIds   = user.followingIds   || [];
    user.followerIds    = user.followerIds     || [];

    res.json(user);
  } catch (err) {
    console.error('GET /api/users/:uid error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Update user profile ──
router.patch('/users/:uid', async (req, res) => {
  try {
    if (req.auth.uid !== req.params.uid) {
      return res.status(403).json({ error: 'Cannot update another user' });
    }

    const body = req.body;
    if (!body) return res.status(400).json({ error: 'Invalid JSON body' });

    // Only allow whitelisted camelCase fields
    const allowedFields = [
      'displayName', 'bio', 'country', 'gender',
      'profilePhotoUrl', 'coverPhotoUrl',
      'pmPrivacy', 'pmNotificationsEnabled', 'pmSoundEnabled',
      'pmShowTimestamps', 'pmShowDateSeparators', 'pmNotificationPreview',
      'hideFollowing', 'hideOnlineStatus', 'hideAge',
      'selfDestructAlertEnabled', 'minGiftAnimationValue',
      'dndEnabled', 'dndStartHour', 'dndStartMinute', 'dndEndHour', 'dndEndMinute',
      'acceptedLegalVersion', 'currentRoomId', 'lastRoomName',
      'language',
    ];

    const updates = {};
    for (const key of allowedFields) {
      if (key in body) updates[key] = body[key];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    await db.doc(`users/${req.params.uid}`).update(updates);

    res.json({ success: true });
  } catch (err) {
    console.error('PATCH /api/users/:uid error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Create or update user ──
router.post('/users', async (req, res) => {
  try {
    const body = req.body;
    if (!body?.uid) return res.status(400).json({ error: 'uid required' });

    const uid = body.uid;
    if (req.auth.uid !== uid) {
      return res.status(403).json({ error: 'Cannot create user for another uid' });
    }

    const existing = await getDoc(`users/${uid}`);

    if (existing) {
      // Update lastSeen + backfill missing fields
      const updates = { lastSeen: now() };
      const incomingEmail = body.email || null;
      if (incomingEmail && !existing.email) updates.email = incomingEmail;
      if (!existing.userType) updates.userType = 'MEMBER';
      await db.doc(`users/${uid}`).update(updates);
      return res.json({ success: true, created: false });
    }

    // Create new user doc with camelCase fields
    const photoUrl = body.profilePhotoUrl || body.profile_photo_url || null;
    const dob = body.dateOfBirth || body.date_of_birth || null;
    await db.doc(`users/${uid}`).set({
      uid,
      displayName:     body.displayName || body.display_name || null,
      email:           body.email || null,
      profilePhotoUrl: photoUrl,
      dateOfBirth:     dob,
      userType:        'MEMBER',
      blockedUserIds:  [],
      followingIds:    [],
      followerIds:     [],
      fcmTokens:       [],
      aliases:         {},
      language:        body.language || 'en',
      stalkerCount:    0,
      newStalkerCount: 0,
      createdAt:       now(),
      lastSeen:        now(),
    }, { merge: true });

    res.json({ success: true, created: true });
  } catch (err) {
    console.error('POST /api/users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Generate unique numeric ID ──
// IDs are always 8-digit numbers starting at 10000000.
const MIN_UNIQUE_ID = 10000000;

router.post('/users/:uid/unique-id', async (req, res) => {
  try {
    if (req.auth.uid !== req.params.uid) {
      return res.status(403).json({ error: 'Cannot generate ID for another user' });
    }

    // Return existing ID if already assigned
    const user = await getDoc(`users/${req.params.uid}`);
    const existingId = user?.uniqueId ?? user?.unique_id ?? null;
    if (existingId && existingId >= MIN_UNIQUE_ID) {
      return res.json({ uniqueId: existingId });
    }

    // Atomic increment of the global counter via Firestore transaction
    const counterRef = db.doc('counters/uniqueId');
    let newId = await db.runTransaction(async (t) => {
      const snap = await t.get(counterRef);
      const current = snap.exists ? (snap.data().value || 0) : 0;
      const next = current + 1;
      t.set(counterRef, { value: next }, { merge: true });
      return next;
    });

    // Guard: if counter was corrupted/reset, fix it to start at MIN_UNIQUE_ID
    if (newId < MIN_UNIQUE_ID) {
      await db.doc('counters/uniqueId').set({ value: MIN_UNIQUE_ID });
      newId = MIN_UNIQUE_ID;
    }

    await db.doc(`users/${req.params.uid}`).update({ uniqueId: newId });

    res.json({ uniqueId: newId });
  } catch (err) {
    console.error('POST /api/users/:uid/unique-id error:', err);
    res.status(500).json({ error: 'Failed to generate unique ID' });
  }
});

// ── Suspension appeal ──
router.post('/users/:uid/appeal', async (req, res) => {
  try {
    if (req.auth.uid !== req.params.uid) return res.status(403).json({ error: 'Forbidden' });
    const body = req.body;
    if (!body?.appealText) return res.status(400).json({ error: 'appealText required' });

    // Write appeal to a subcollection and update the user doc status
    await Promise.all([
      db.doc(`suspensionAppeals/${generateId()}`).set({
        userId:      req.params.uid,
        appealText:  body.appealText,
        status:      'pending',
        createdAt:   now(),
      }, { merge: true }),
      db.doc(`users/${req.params.uid}`).update({
        suspensionAppealStatus: 'pending',
      }),
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/users/:uid/appeal error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Lift expired suspension ──
router.post('/users/:uid/lift-suspension', async (req, res) => {
  try {
    if (req.auth.uid !== req.params.uid) return res.status(403).json({ error: 'Forbidden' });

    const user = await getDoc(`users/${req.params.uid}`);
    const isSuspended = user?.isSuspended ?? user?.is_suspended ?? false;
    if (!user || !isSuspended) {
      return res.status(400).json({ error: 'User is not suspended' });
    }

    const suspensionExpiry = user.suspensionExpiry ?? user.suspension_end_date ?? null;
    if (suspensionExpiry && suspensionExpiry > now()) {
      return res.status(400).json({ error: 'Suspension has not expired yet' });
    }

    await db.doc(`users/${req.params.uid}`).update({
      isSuspended:            false,
      suspensionReason:       null,
      suspensionExpiry:       null,
      suspensionCanAppeal:    true,
      suspensionAppealStatus: null,
      suspendedBy:            null,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/users/:uid/lift-suspension error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Follow user ──
router.post('/users/:uid/follow', async (req, res) => {
  try {
    const body = req.body;
    const targetUid = body?.targetUserId;
    if (!targetUid) return res.status(400).json({ error: 'targetUserId required' });
    if (req.auth.uid !== req.params.uid) return res.status(403).json({ error: 'Forbidden' });
    if (req.params.uid === targetUid) return res.status(400).json({ error: 'Cannot follow yourself' });

    const batch = db.batch();
    batch.update(db.doc(`users/${req.params.uid}`), {
      followingIds: FieldValue.arrayUnion(targetUid),
    });
    batch.update(db.doc(`users/${targetUid}`), {
      followerIds: FieldValue.arrayUnion(req.params.uid),
    });
    await batch.commit();

    res.json({ success: true });
  } catch (err) {
    console.error('Follow failed:', err);
    res.status(500).json({ error: 'Failed to follow user' });
  }
});

// ── Unfollow user ──
router.post('/users/:uid/unfollow', async (req, res) => {
  try {
    const body = req.body;
    const targetUid = body?.targetUserId;
    if (!targetUid) return res.status(400).json({ error: 'targetUserId required' });
    if (req.auth.uid !== req.params.uid) return res.status(403).json({ error: 'Forbidden' });

    const batch = db.batch();
    batch.update(db.doc(`users/${req.params.uid}`), {
      followingIds: FieldValue.arrayRemove(targetUid),
    });
    batch.update(db.doc(`users/${targetUid}`), {
      followerIds: FieldValue.arrayRemove(req.params.uid),
    });
    await batch.commit();

    res.json({ success: true });
  } catch (err) {
    console.error('Unfollow failed:', err);
    res.status(500).json({ error: 'Failed to unfollow user' });
  }
});

// ── Remove follower ──
router.post('/users/:uid/remove-follower', async (req, res) => {
  try {
    const body = req.body;
    const followerUid = body?.followerUserId;
    if (!followerUid) return res.status(400).json({ error: 'followerUserId required' });
    if (req.auth.uid !== req.params.uid) return res.status(403).json({ error: 'Forbidden' });

    const batch = db.batch();
    batch.update(db.doc(`users/${req.params.uid}`), {
      followerIds: FieldValue.arrayRemove(followerUid),
    });
    batch.update(db.doc(`users/${followerUid}`), {
      followingIds: FieldValue.arrayRemove(req.params.uid),
    });
    await batch.commit();

    res.json({ success: true });
  } catch (err) {
    console.error('Remove follower failed:', err);
    res.status(500).json({ error: 'Failed to remove follower' });
  }
});

// ── Record profile visit (stalker) ──
router.post('/users/:uid/record-visit', async (req, res) => {
  try {
    const body = req.body;
    const visitorId = body?.visitorId;
    if (!visitorId) return res.status(400).json({ error: 'visitorId required' });
    if (req.auth.uid !== visitorId) return res.status(403).json({ error: 'Forbidden' });
    if (req.params.uid === visitorId) return res.json({ success: true }); // don't stalk yourself

    const stalkerPath = `users/${req.params.uid}/stalkers/${visitorId}`;
    const existing = await getDoc(stalkerPath);
    const timestamp = now();

    if (existing) {
      await db.doc(stalkerPath).update({
        lastVisitedAt: timestamp,
        visitCount: (existing.visitCount || 1) + 1,
      });
    } else {
      await db.doc(stalkerPath).set({
        visitorId,
        lastVisitedAt: timestamp,
        firstVisitedAt: timestamp,
        visitCount: 1,
      }, { merge: true });
      // Increment stalkerCount only for new visitors
      await db.doc(`users/${req.params.uid}`).update({
        stalkerCount: FieldValue.increment(1),
      });
    }

    // Always increment newStalkerCount (reset when user views their stalkers list)
    await db.doc(`users/${req.params.uid}`).update({
      newStalkerCount: FieldValue.increment(1),
    });

    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/users/:uid/record-visit error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
module.exports.assembleUser = assembleUser;

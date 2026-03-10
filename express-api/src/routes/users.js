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
const { getDoc } = require('../utils/firestore-helpers');
const log = require('../utils/log');
const { clearSuspensionCache } = require('../middleware/auth');

// ── Get user profile ──
router.get('/users/:uid', async (req, res) => {
  try {
    const user = await getDoc(`users/${req.params.uid}`);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Ensure arrays are present even when missing from Firestore doc
    user.blockedUserIds = user.blockedUserIds || [];
    user.followingIds   = user.followingIds   || [];
    user.followerIds    = user.followerIds     || [];

    // Strip admin-only fields (GCS, warning internals, moderation)
    delete user.gcsScore;
    delete user.gcsLastDeductionAt;
    delete user.gcsDisplayScore;
    delete user.warningCount;
    delete user.warningIssuedAt;
    delete user.hasNewWarning;

    res.json(user);
  } catch (err) {
    log.error('users', 'GET /users/:uid failed', { uid: req.params.uid, error: err.message });
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
      'displayName', 'description', 'nationality',
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

    // Validate field value types and lengths
    const stringFields = [
      'displayName', 'description', 'nationality', 'profilePhotoUrl', 'coverPhotoUrl',
      'pmPrivacy', 'currentRoomId', 'lastRoomName', 'language',
    ];
    const maxLengths = { displayName: 20, description: 200, nationality: 3, language: 10, lastRoomName: 50 };
    for (const key of stringFields) {
      if (key in updates && updates[key] !== null && typeof updates[key] !== 'string') {
        return res.status(400).json({ error: `${key} must be a string` });
      }
      if (key in updates && typeof updates[key] === 'string' && maxLengths[key] && updates[key].length > maxLengths[key]) {
        return res.status(400).json({ error: `${key} exceeds max length of ${maxLengths[key]}` });
      }
    }
    const boolFields = [
      'pmNotificationsEnabled', 'pmSoundEnabled', 'pmShowTimestamps', 'pmShowDateSeparators',
      'pmNotificationPreview', 'hideFollowing', 'hideOnlineStatus', 'hideAge',
      'selfDestructAlertEnabled', 'dndEnabled',
    ];
    for (const key of boolFields) {
      if (key in updates && typeof updates[key] !== 'boolean') {
        return res.status(400).json({ error: `${key} must be a boolean` });
      }
    }
    const intFields = ['dndStartHour', 'dndStartMinute', 'dndEndHour', 'dndEndMinute', 'minGiftAnimationValue', 'acceptedLegalVersion'];
    for (const key of intFields) {
      if (key in updates && (typeof updates[key] !== 'number' || !Number.isInteger(updates[key]))) {
        return res.status(400).json({ error: `${key} must be an integer` });
      }
    }
    // Bounds validation for DND time fields
    for (const key of ['dndStartHour', 'dndEndHour']) {
      if (key in updates && (updates[key] < 0 || updates[key] > 23)) {
        return res.status(400).json({ error: `${key} must be between 0 and 23` });
      }
    }
    for (const key of ['dndStartMinute', 'dndEndMinute']) {
      if (key in updates && (updates[key] < 0 || updates[key] > 59)) {
        return res.status(400).json({ error: `${key} must be between 0 and 59` });
      }
    }

    log.info('users', 'Updating profile', { userId: req.params.uid, fields: Object.keys(updates) });
    await db.doc(`users/${req.params.uid}`).update(updates);

    res.json({ success: true });
  } catch (err) {
    log.error('users', 'PATCH /users/:uid failed', { uid: req.params.uid, error: err.message });
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
      log.info('users', 'User login (existing)', { userId: uid });
      // Update lastSeenAt + backfill missing fields
      const updates = { lastSeenAt: now() };
      const incomingEmail = body.email || null;
      if (incomingEmail && !existing.email) updates.email = incomingEmail;
      if (!existing.userType) updates.userType = 'MEMBER';
      await db.doc(`users/${uid}`).update(updates);
      return res.json({ success: true, created: false });
    }

    // Create new user doc with camelCase fields
    log.info('users', 'Creating new user', { userId: uid });
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
      lastSeenAt:      now(),
    }, { merge: true });

    res.json({ success: true, created: true });
  } catch (err) {
    log.error('users', 'POST /users failed', { uid: req.body?.uid, error: err.message });
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
    // Floor guard is inside the transaction to avoid race conditions
    const counterRef = db.doc('counters/uniqueId');
    const userRef = db.doc(`users/${req.params.uid}`);
    let newId = await db.runTransaction(async (t) => {
      const snap = await t.get(counterRef);
      let current = snap.exists ? (snap.data().value || 0) : 0;
      if (current < MIN_UNIQUE_ID) current = MIN_UNIQUE_ID - 1;
      const next = current + 1;
      t.set(counterRef, { value: next }, { merge: true });
      t.update(userRef, { uniqueId: next });
      return next;
    });

    res.json({ uniqueId: newId });
  } catch (err) {
    log.error('users', 'Generate unique ID failed', { uid: req.params.uid, error: err.message });
    res.status(500).json({ error: 'Failed to generate unique ID' });
  }
});

// ── Suspension appeal ──
router.post('/users/:uid/appeal', async (req, res) => {
  try {
    if (req.auth.uid !== req.params.uid) return res.status(403).json({ error: 'Forbidden' });
    const body = req.body;
    if (!body?.appealText) return res.status(400).json({ error: 'appealText required' });
    if (typeof body.appealText !== 'string' || body.appealText.length > 500) {
      return res.status(400).json({ error: 'appealText must be a string of at most 500 characters' });
    }

    log.info('users', 'Suspension appeal submitted', { userId: req.params.uid });

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
    log.error('users', 'Suspension appeal failed', { uid: req.params.uid, error: err.message });
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

    const suspensionEndDate = user.suspensionEndDate ?? user.suspension_end_date ?? null;
    if (suspensionEndDate && suspensionEndDate > now()) {
      return res.status(400).json({ error: 'Suspension has not expired yet' });
    }

    log.info('users', 'Lifting expired suspension', { userId: req.params.uid });

    await db.doc(`users/${req.params.uid}`).update({
      isSuspended:            false,
      suspensionReason:       null,
      suspensionEndDate:      null,
      suspensionCanAppeal:    true,
      suspensionAppealStatus: null,
      suspendedBy:            null,
    });

    clearSuspensionCache(req.params.uid);

    res.json({ success: true });
  } catch (err) {
    log.error('users', 'Lift suspension failed', { uid: req.params.uid, error: err.message });
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
    log.info('users', 'User followed', { userId: req.params.uid, targetUserId: targetUid });

    res.json({ success: true });
  } catch (err) {
    log.error('users', 'Follow failed', { userId: req.params.uid, targetUserId: req.body?.targetUserId, error: err.message });
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
    log.info('users', 'User unfollowed', { userId: req.params.uid, targetUserId: targetUid });

    res.json({ success: true });
  } catch (err) {
    log.error('users', 'Unfollow failed', { userId: req.params.uid, targetUserId: req.body?.targetUserId, error: err.message });
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
    log.info('users', 'Follower removed', { userId: req.params.uid, followerUserId: followerUid });

    res.json({ success: true });
  } catch (err) {
    log.error('users', 'Remove follower failed', { userId: req.params.uid, followerUserId: req.body?.followerUserId, error: err.message });
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
      const batch = db.batch();
      batch.update(db.doc(stalkerPath), {
        lastVisitedAt: timestamp,
        visitCount: (existing.visitCount || 1) + 1,
      });
      batch.update(db.doc(`users/${req.params.uid}`), {
        newStalkerCount: FieldValue.increment(1),
      });
      await batch.commit();
    } else {
      const batch = db.batch();
      batch.set(db.doc(stalkerPath), {
        visitorId,
        lastVisitedAt: timestamp,
        firstVisitedAt: timestamp,
        visitCount: 1,
      }, { merge: true });
      // Increment both counters in one write for new visitors
      batch.update(db.doc(`users/${req.params.uid}`), {
        stalkerCount: FieldValue.increment(1),
        newStalkerCount: FieldValue.increment(1),
      });
      await batch.commit();
    }

    res.json({ success: true });
  } catch (err) {
    log.error('users', 'Record visit failed', { profileUid: req.params.uid, visitorId: req.body?.visitorId, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

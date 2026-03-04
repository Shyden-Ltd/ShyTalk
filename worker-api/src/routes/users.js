/**
 * User routes — profile CRUD, unique ID, suspension appeals.
 *
 * GET    /api/users/:uid              → Get user profile
 * PATCH  /api/users/:uid              → Update user profile fields
 * POST   /api/users                   → Create or update user (upsert)
 * POST   /api/users/:uid/unique-id    → Generate a unique numeric ID
 * POST   /api/users/:uid/appeal       → Submit suspension appeal
 * POST   /api/users/:uid/lift-suspension → Lift expired suspension
 */

const { json, jsonError, generateId, now, parseBody } = require('../utils');
const {
  getDoc,
  setDoc,
  updateDoc,
  incrementField,
} = require('../utils/firestore');

/**
 * Return a full user doc from Firestore.
 * Imported by admin-users.js — keep it exported.
 */
async function assembleUser(env, uid) {
  return getDoc(env, `users/${uid}`);
}

function registerUserRoutes(router) {

  // ── Get user profile ──
  router.get('/api/users/:uid', async (request, env, params) => {
    const user = await getDoc(env, `users/${params.uid}`);
    if (!user) return jsonError('User not found', 404);

    // Ensure arrays are present even when missing from Firestore doc
    user.blockedUserIds = user.blockedUserIds || [];
    user.followingIds   = user.followingIds   || [];
    user.followerIds    = user.followerIds     || [];

    return json(user);
  });

  // ── Update user profile ──
  router.patch('/api/users/:uid', async (request, env, params) => {
    if (request.auth.uid !== params.uid) {
      return jsonError('Cannot update another user', 403);
    }

    const body = await parseBody(request);
    if (!body) return jsonError('Invalid JSON body', 400);

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
    ];

    const updates = {};
    for (const key of allowedFields) {
      if (key in body) updates[key] = body[key];
    }

    if (Object.keys(updates).length === 0) {
      return jsonError('No valid fields to update', 400);
    }

    await updateDoc(env, `users/${params.uid}`, updates);

    return json({ success: true });
  });

  // ── Create or update user ──
  router.post('/api/users', async (request, env) => {
    const body = await parseBody(request);
    if (!body?.uid) return jsonError('uid required', 400);

    const uid = body.uid;
    if (request.auth.uid !== uid) {
      return jsonError('Cannot create user for another uid', 403);
    }

    const existing = await getDoc(env, `users/${uid}`);

    if (existing) {
      // Update lastSeen only
      await updateDoc(env, `users/${uid}`, { lastSeen: now() });
      return json({ success: true, created: false });
    }

    // Create new user doc with camelCase fields
    const photoUrl = body.profilePhotoUrl || body.profile_photo_url || null;
    await setDoc(env, `users/${uid}`, {
      uid,
      displayName:     body.displayName || body.display_name || null,
      profilePhotoUrl: photoUrl,
      blockedUserIds:  [],
      followingIds:    [],
      followerIds:     [],
      fcmTokens:       [],
      aliases:         {},
      createdAt:       now(),
      lastSeen:        now(),
    });

    return json({ success: true, created: true });
  });

  // ── Generate unique numeric ID ──
  router.post('/api/users/:uid/unique-id', async (request, env, params) => {
    if (request.auth.uid !== params.uid) {
      return jsonError('Cannot generate ID for another user', 403);
    }

    // Return existing ID if already assigned
    const user = await getDoc(env, `users/${params.uid}`);
    const existingId = user?.uniqueId ?? user?.unique_id ?? null;
    if (existingId) {
      return json({ uniqueId: existingId });
    }

    // Atomic increment of the global counter
    const newId = await incrementField(env, 'counters/uniqueId', 'value', 1);
    if (newId === null) {
      return jsonError('Failed to generate unique ID', 500);
    }

    await updateDoc(env, `users/${params.uid}`, { uniqueId: newId });

    return json({ uniqueId: newId });
  });

  // ── Suspension appeal ──
  router.post('/api/users/:uid/appeal', async (request, env, params) => {
    if (request.auth.uid !== params.uid) return jsonError('Forbidden', 403);
    const body = await parseBody(request);
    if (!body?.appealText) return jsonError('appealText required', 400);

    // Write appeal to a subcollection and update the user doc status
    await Promise.all([
      setDoc(env, `suspensionAppeals/${generateId()}`, {
        userId:      params.uid,
        appealText:  body.appealText,
        status:      'pending',
        createdAt:   now(),
      }),
      updateDoc(env, `users/${params.uid}`, {
        suspensionAppealStatus: 'pending',
      }),
    ]);

    return json({ success: true });
  });

  // ── Lift expired suspension ──
  router.post('/api/users/:uid/lift-suspension', async (request, env, params) => {
    if (request.auth.uid !== params.uid) return jsonError('Forbidden', 403);

    const user = await getDoc(env, `users/${params.uid}`);
    const isSuspended = user?.isSuspended ?? user?.is_suspended ?? false;
    if (!user || !isSuspended) {
      return jsonError('User is not suspended', 400);
    }

    const suspensionExpiry = user.suspensionExpiry ?? user.suspension_end_date ?? null;
    if (suspensionExpiry && suspensionExpiry > now()) {
      return jsonError('Suspension has not expired yet', 400);
    }

    await updateDoc(env, `users/${params.uid}`, {
      isSuspended:            false,
      suspensionReason:       null,
      suspensionExpiry:       null,
      suspensionCanAppeal:    true,
      suspensionAppealStatus: null,
      suspendedBy:            null,
    });

    return json({ success: true });
  });
}

module.exports = { registerUserRoutes, assembleUser };

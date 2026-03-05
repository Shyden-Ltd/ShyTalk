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

const { json, jsonError, generateId, now, parseBody } = require('../utils');
const {
  getDoc,
  setDoc,
  updateDoc,
  incrementField,
  arrayUnionField,
  arrayRemoveField,
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
      // Update lastSeen + backfill missing fields
      const updates = { lastSeen: now() };
      const incomingEmail = body.email || null;
      if (incomingEmail && !existing.email) updates.email = incomingEmail;
      if (!existing.userType) updates.userType = 'MEMBER';
      await updateDoc(env, `users/${uid}`, updates);
      return json({ success: true, created: false });
    }

    // Create new user doc with camelCase fields
    const photoUrl = body.profilePhotoUrl || body.profile_photo_url || null;
    const dob = body.dateOfBirth || body.date_of_birth || null;
    await setDoc(env, `users/${uid}`, {
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
      createdAt:       now(),
      lastSeen:        now(),
    });

    return json({ success: true, created: true });
  });

  // ── Generate unique numeric ID ──
  // IDs are always 8-digit numbers starting at 10000000.
  const MIN_UNIQUE_ID = 10000000;

  router.post('/api/users/:uid/unique-id', async (request, env, params) => {
    if (request.auth.uid !== params.uid) {
      return jsonError('Cannot generate ID for another user', 403);
    }

    // Return existing ID if already assigned
    const user = await getDoc(env, `users/${params.uid}`);
    const existingId = user?.uniqueId ?? user?.unique_id ?? null;
    if (existingId && existingId >= MIN_UNIQUE_ID) {
      return json({ uniqueId: existingId });
    }

    // Atomic increment of the global counter
    let newId = await incrementField(env, 'counters/uniqueId', 'value', 1);
    if (newId === null) {
      return jsonError('Failed to generate unique ID', 500);
    }

    // Guard: if counter was corrupted/reset, fix it to start at MIN_UNIQUE_ID
    if (newId < MIN_UNIQUE_ID) {
      await setDoc(env, 'counters/uniqueId', { value: MIN_UNIQUE_ID });
      newId = MIN_UNIQUE_ID;
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

  // ── Follow user ──
  router.post('/api/users/:uid/follow', async (request, env, params) => {
    const body = await parseBody(request);
    const targetUid = body?.targetUserId;
    if (!targetUid) return jsonError('targetUserId required', 400);
    if (request.auth.uid !== params.uid) return jsonError('Forbidden', 403);
    if (params.uid === targetUid) return jsonError('Cannot follow yourself', 400);

    try {
      await Promise.all([
        arrayUnionField(env, `users/${params.uid}`, 'followingIds', [targetUid]),
        arrayUnionField(env, `users/${targetUid}`, 'followerIds', [params.uid]),
      ]);
    } catch (err) {
      console.error('Follow failed:', err);
      return jsonError('Failed to follow user', 500);
    }

    return json({ success: true });
  });

  // ── Unfollow user ──
  router.post('/api/users/:uid/unfollow', async (request, env, params) => {
    const body = await parseBody(request);
    const targetUid = body?.targetUserId;
    if (!targetUid) return jsonError('targetUserId required', 400);
    if (request.auth.uid !== params.uid) return jsonError('Forbidden', 403);

    try {
      await Promise.all([
        arrayRemoveField(env, `users/${params.uid}`, 'followingIds', [targetUid]),
        arrayRemoveField(env, `users/${targetUid}`, 'followerIds', [params.uid]),
      ]);
    } catch (err) {
      console.error('Unfollow failed:', err);
      return jsonError('Failed to unfollow user', 500);
    }

    return json({ success: true });
  });

  // ── Remove follower ──
  router.post('/api/users/:uid/remove-follower', async (request, env, params) => {
    const body = await parseBody(request);
    const followerUid = body?.followerUserId;
    if (!followerUid) return jsonError('followerUserId required', 400);
    if (request.auth.uid !== params.uid) return jsonError('Forbidden', 403);

    try {
      await Promise.all([
        arrayRemoveField(env, `users/${params.uid}`, 'followerIds', [followerUid]),
        arrayRemoveField(env, `users/${followerUid}`, 'followingIds', [params.uid]),
      ]);
    } catch (err) {
      console.error('Remove follower failed:', err);
      return jsonError('Failed to remove follower', 500);
    }

    return json({ success: true });
  });

  // ── Record profile visit (stalker) ──
  router.post('/api/users/:uid/record-visit', async (request, env, params) => {
    const body = await parseBody(request);
    const visitorId = body?.visitorId;
    if (!visitorId) return jsonError('visitorId required', 400);
    if (request.auth.uid !== visitorId) return jsonError('Forbidden', 403);
    if (params.uid === visitorId) return json({ success: true }); // don't stalk yourself

    const stalkerPath = `users/${params.uid}/stalkers/${visitorId}`;
    const existing = await getDoc(env, stalkerPath);
    const timestamp = now();

    if (existing) {
      await updateDoc(env, stalkerPath, {
        lastVisitedAt: timestamp,
        visitCount: (existing.visitCount || 1) + 1,
      });
    } else {
      await setDoc(env, stalkerPath, {
        visitorId,
        lastVisitedAt: timestamp,
        firstVisitedAt: timestamp,
        visitCount: 1,
      });
      // Increment stalkerCount only for new visitors
      await incrementField(env, `users/${params.uid}`, 'stalkerCount', 1);
    }

    // Always increment newStalkerCount (reset when user views their stalkers list)
    await incrementField(env, `users/${params.uid}`, 'newStalkerCount', 1);

    return json({ success: true });
  });
}

module.exports = { registerUserRoutes, assembleUser };

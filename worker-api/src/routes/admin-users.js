/**
 * Admin user routes — user CRUD, warnings, GCS reset, route aliases.
 *
 * GET    /api/user/:uid                 → Full user profile (admin)
 * PATCH  /api/user/:uid                 → Update user fields (admin)
 * POST   /api/user/:uid/warn            → Issue warning (admin)
 * POST   /api/user/:uid/reset-gcs       → Reset GCS score (admin)
 * GET    /api/search/uniqueId/:id       → Search by unique ID (alias)
 * POST   /api/resolve/uids-to-uniqueIds → Resolve UIDs to unique IDs (alias)
 * POST   /api/resolve/uniqueIds-to-uids → Resolve unique IDs to UIDs (alias)
 * POST   /api/user/:uid/suspend         → Suspend user (alias)
 * POST   /api/user/:uid/unsuspend       → Unsuspend user (alias)
 * POST   /api/report-locks/:uid/lock    → Lock reports for user (alias)
 * DELETE /api/report-locks/:uid         → Unlock reports for user (alias)
 * GET    /api/conversations/:id/messages → Admin view conversation messages
 */

const { json, jsonError, generateId, now, parseBody } = require('../utils');
const { requireAdmin } = require('../middleware/auth');
const { sendSystemPm } = require('../utils/system-pm');
const { computeDisplayScore } = require('../utils/gcs');
const { getAccessToken } = require('../utils/fcm');
const {
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  queryCollection,
  batchWrite,
  batchUpdateOp,
  fieldFilter,
  orderBy,
} = require('../utils/firestore');

/**
 * Look up a Firebase Auth user's email by UID.
 * Uses the Identity Toolkit REST API with service account credentials.
 */
async function getFirebaseAuthEmail(env, uid) {
  try {
    const accessToken = await getAccessToken(env);
    const projectId = env.FIREBASE_PROJECT_ID;
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ localId: [uid] }),
      }
    );
    if (!resp.ok) {
      const text = await resp.text();
      console.error(`Firebase Auth lookup failed (${resp.status}): ${text}`);
      return null;
    }
    const data = await resp.json();
    const authUser = data.users?.[0];
    // Return email or phone number as fallback
    return authUser?.email ?? null;
  } catch (err) {
    console.error('Firebase Auth email lookup error:', err.message);
    return null;
  }
}

function registerAdminUserRoutes(router) {

  // ══════════════════════════════════════════════════════════════
  // USER CRUD (admin)
  // ══════════════════════════════════════════════════════════════

  // ── Get user profile (admin — no ownership check) ──
  router.get('/api/user/:uid', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const user = await getDoc(env, `users/${params.uid}`);
    if (!user) return jsonError('User not found', 404);

    // Normalize snake_case → camelCase for admin panel compatibility
    user.displayName      = user.displayName      ?? user.display_name      ?? null;
    user.profilePhotoUrl  = user.profilePhotoUrl  ?? user.profile_photo_url ?? null;
    user.coverPhotoUrl    = user.coverPhotoUrl    ?? user.cover_photo_url   ?? null;
    user.dateOfBirth      = user.dateOfBirth      ?? user.date_of_birth     ?? null;
    user.uniqueId         = user.uniqueId         ?? user.unique_id         ?? null;
    user.isSuperShy       = user.isSuperShy       ?? user.is_super_shy      ?? false;
    user.superShyExpiry   = user.superShyExpiry   ?? user.super_shy_expiry  ?? null;
    user.superShyTier     = user.superShyTier     ?? user.super_shy_tier    ?? null;
    user.loginStreak      = user.loginStreak      ?? user.login_streak      ?? 0;
    user.shyCoins         = user.shyCoins         ?? user.shy_coins         ?? 0;
    user.shyBeans         = user.shyBeans         ?? user.shy_beans         ?? 0;
    user.warningCount     = user.warningCount     ?? user.warning_count     ?? 0;
    user.luckScore        = user.luckScore        ?? user.luck_score        ?? 0;
    user.pityCounter      = user.pityCounter      ?? user.pity_counter      ?? 0;
    user.gcsScore         = user.gcsScore         ?? user.gcs_score         ?? 100;
    user.gcsLastDeductionAt = user.gcsLastDeductionAt ?? user.gcs_last_deduction_at ?? null;
    user.hasActiveWarning = user.hasActiveWarning ?? user.has_active_warning ?? false;
    user.warningReason    = user.warningReason    ?? user.warning_reason    ?? null;
    user.userType         = user.userType         ?? user.user_type         ?? 'MEMBER';

    // Fetch email from Firebase Auth if not in Firestore doc
    if (!user.email) {
      user.email = await getFirebaseAuthEmail(env, params.uid);
      // Backfill to Firestore for future lookups
      if (user.email) {
        updateDoc(env, `users/${params.uid}`, { email: user.email }).catch(() => {});
      }
    }

    // Enrich with GCS display score
    user.gcsDisplayScore = computeDisplayScore(user.gcsScore, user.gcsLastDeductionAt);

    return json(user);
  });

  // ── Update user fields (admin — whitelisted fields) ──
  router.patch('/api/user/:uid', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await parseBody(request);
    if (!body) return jsonError('Invalid JSON body', 400);

    // Admin can update more fields than regular users — all in camelCase
    const allowedFields = [
      'displayName', 'description', 'nationality', 'dateOfBirth', 'gender',
      'profilePhotoUrl', 'avatarUrl', 'coverPhotoUrl', 'userType',
      'shyCoins', 'shyBeans', 'luckScore', 'pityCounter',
      'isSuperShy', 'superShyExpiry', 'superShyTier',
      'loginStreak', 'gcsScore', 'warningCount', 'warningReason',
      'hasActiveWarning', 'pmPrivacy', 'acceptedLegalVersion',
      'currentRoomId',
    ];

    const updates = {};
    for (const key of allowedFields) {
      if (key in body) {
        updates[key] = body[key];
      } else {
        // Also accept snake_case input and convert to camelCase
        const snakeKey = key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
        if (snakeKey in body) updates[key] = body[snakeKey];
      }
    }

    if (Object.keys(updates).length === 0) {
      return jsonError('No valid fields to update', 400);
    }

    await updateDoc(env, `users/${params.uid}`, updates);

    // Audit log
    await setDoc(env, `adminAuditLog/${generateId()}`, {
      adminId:      request.auth.uid,
      action:       'EDIT_USER',
      targetUserId: params.uid,
      details:      `Updated fields: ${Object.keys(updates).join(', ')}`,
      createdAt:    now(),
    });

    return json({ success: true, updatedFields: Object.keys(updates) });
  });

  // ══════════════════════════════════════════════════════════════
  // WARNINGS & GCS (admin)
  // ══════════════════════════════════════════════════════════════

  // ── Issue warning ──
  router.post('/api/user/:uid/warn', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await parseBody(request);
    if (!body?.reason) return jsonError('reason is required', 400);

    const severity = body.severity || 'standard';
    const deduction = severity === 'severe' ? 20 : 10;
    const timestamp = now();

    const user = await getDoc(env, `users/${params.uid}`);
    if (!user) return jsonError('User not found', 404);

    const gcsScore = user.gcsScore ?? user.gcs_score ?? 100;
    const warningCount = user.warningCount ?? user.warning_count ?? 0;
    const newGcs = Math.max(0, gcsScore - deduction);
    const newWarningCount = warningCount + 1;

    await Promise.all([
      updateDoc(env, `users/${params.uid}`, {
        gcsScore:           newGcs,
        gcsLastDeductionAt: timestamp,
        warningCount:       newWarningCount,
        warningReason:      body.reason,
        hasActiveWarning:   true,
        hasNewWarning:      true,
        warningIssuedAt:    timestamp,
      }),
      setDoc(env, `adminAuditLog/${generateId()}`, {
        adminId:      request.auth.uid,
        action:       'WARN',
        targetUserId: params.uid,
        details:      `Severity: ${severity}, GCS: ${gcsScore} → ${newGcs}, Reason: ${body.reason}`,
        createdAt:    timestamp,
      }),
    ]);

    // Send system PM to warned user (fire-and-forget)
    const ctx = request.ctx;
    if (ctx) {
      ctx.waitUntil(
        sendSystemPm(env, params.uid,
          `⚠️ You have received a warning from the moderation team.\n\nReason: ${body.reason}\n\nYour Good Character Score has been reduced by ${deduction} points (now ${newGcs}/100). Repeated violations may result in suspension.`
        ).catch(err => console.error('Failed to send warning PM:', err))
      );
    }

    return json({
      success: true,
      newGcs,
      deduction,
      warningCount: newWarningCount,
    });
  });

  // ── Reset GCS ──
  router.post('/api/user/:uid/reset-gcs', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const timestamp = now();

    await Promise.all([
      updateDoc(env, `users/${params.uid}`, {
        gcsScore:           100,
        gcsLastDeductionAt: null,
        warningCount:       0,
        hasActiveWarning:   false,
        hasNewWarning:      false,
        warningReason:      null,
        warningIssuedAt:    null,
      }),
      setDoc(env, `adminAuditLog/${generateId()}`, {
        adminId:      request.auth.uid,
        action:       'RESET_GCS',
        targetUserId: params.uid,
        details:      'GCS reset to 100',
        createdAt:    timestamp,
      }),
    ]);

    return json({ success: true });
  });

  // ══════════════════════════════════════════════════════════════
  // ADMIN VIEW CONVERSATION MESSAGES
  // ══════════════════════════════════════════════════════════════

  router.get('/api/conversations/:id/messages', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const url = new URL(request.url);
    const messageLimit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

    const messages = await queryCollection(env, `conversations/${params.id}/messages`, {
      orderBy: [orderBy('createdAt', 'DESCENDING')],
      limit:   messageLimit,
    });

    // Return chronological order
    return json(messages.reverse());
  });

  // ══════════════════════════════════════════════════════════════
  // ROUTE ALIASES (match admin page's expected paths)
  // ══════════════════════════════════════════════════════════════

  // ── Search by unique ID ──
  router.get('/api/search/uniqueId/:id', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const uniqueId = parseInt(params.id);
    const results = await queryCollection(env, 'users', {
      where: fieldFilter('uniqueId', 'EQUAL', uniqueId),
      limit: 1,
    });

    const user = results[0] || null;
    if (!user) return jsonError('User not found', 404);

    const gcsScore = user.gcsScore ?? user.gcs_score ?? 100;
    const gcsLastDeductionAt = user.gcsLastDeductionAt ?? user.gcs_last_deduction_at ?? null;
    user.gcsDisplayScore = computeDisplayScore(gcsScore, gcsLastDeductionAt);
    return json(user);
  });

  // ── UID → Unique ID resolver ──
  router.post('/api/resolve/uids-to-uniqueIds', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await request.json();
    const uids = body?.uids || [];
    if (uids.length === 0) return json({});

    const docs = await Promise.all(uids.map(uid => getDoc(env, `users/${uid}`)));

    const map = {};
    for (let i = 0; i < uids.length; i++) {
      const doc = docs[i];
      if (doc) {
        map[uids[i]] = {
          uniqueId: doc.uniqueId ?? doc.unique_id ?? null,
          displayName: doc.displayName ?? doc.display_name ?? null,
        };
      }
    }
    return json({ mapping: map });
  });

  // ── Unique ID → UID resolver ──
  router.post('/api/resolve/uniqueIds-to-uids', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await request.json();
    const uniqueIds = body?.uniqueIds || [];
    if (uniqueIds.length === 0) return json({});

    // Query each uniqueId in parallel (Firestore doesn't support IN on non-array fields cleanly)
    const results = await Promise.all(
      uniqueIds.map(id =>
        queryCollection(env, 'users', {
          where: fieldFilter('uniqueId', 'EQUAL', id),
          limit: 1,
        })
      )
    );

    const map = {};
    for (let i = 0; i < uniqueIds.length; i++) {
      const doc = results[i]?.[0] || null;
      if (doc) map[uniqueIds[i]] = doc.uid ?? doc.id;
    }
    return json(map);
  });

  // ── Suspend user ──
  router.post('/api/user/:uid/suspend', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await parseBody(request);
    if (!body?.reason) return jsonError('reason is required', 400);
    if (typeof body.canAppeal !== 'boolean') return jsonError('canAppeal must be a boolean', 400);

    let endTimestamp = null;
    if (body.endDate) {
      const d = new Date(body.endDate);
      if (isNaN(d.getTime())) return jsonError('endDate must be a valid ISO-8601 date', 400);
      if (d.getTime() <= Date.now()) return jsonError('endDate must be in the future', 400);
      endTimestamp = d.getTime();
    }

    const user = await getDoc(env, `users/${params.uid}`);
    if (!user) return jsonError('User not found', 404);

    const timestamp = now();

    await Promise.all([
      updateDoc(env, `users/${params.uid}`, {
        isSuspended:                    true,
        suspensionReason:               body.reason.trim(),
        suspensionStartDate:            timestamp,
        suspensionExpiry:               endTimestamp,
        suspensionCanAppeal:            body.canAppeal,
        suspendedBy:                    request.auth.uid,
        preSuspensionDisplayName:       user.displayName ?? user.display_name ?? null,
        preSuspensionProfilePhotoUrl:   user.profilePhotoUrl ?? user.profile_photo_url ?? null,
        preSuspensionCoverPhotoUrl:     user.coverPhotoUrl ?? user.cover_photo_url ?? null,
        displayName:                    'Suspended Account',
        profilePhotoUrl:                null,
        coverPhotoUrl:                  null,
        avatarUrl:                      null,
        bio:                            null,
        currentRoomId:                  null,
      }),
      setDoc(env, `adminAuditLog/${generateId()}`, {
        adminId:      request.auth.uid,
        action:       'SUSPEND',
        targetUserId: params.uid,
        details:      body.reason,
        createdAt:    timestamp,
      }),
    ]);

    // Evict from any active rooms (fire-and-forget)
    const ctx = request.ctx;
    if (ctx) {
      ctx.waitUntil(
        evictSuspendedUser(env, params.uid)
          .catch(err => console.error('Failed to evict suspended user:', err))
      );
    }

    return json({ success: true });
  });

  // ── Unsuspend user ──
  router.post('/api/user/:uid/unsuspend', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const user = await getDoc(env, `users/${params.uid}`);
    if (!user) return jsonError('User not found', 404);

    const restore = {};
    const preName  = user.preSuspensionDisplayName  ?? user.pre_suspension_display_name  ?? null;
    const prePhoto = user.preSuspensionProfilePhotoUrl ?? user.pre_suspension_profile_photo_url ?? null;
    const preCover = user.preSuspensionCoverPhotoUrl   ?? user.pre_suspension_cover_photo_url   ?? null;
    if (preName)  restore.displayName      = preName;
    if (prePhoto) restore.profilePhotoUrl  = prePhoto;
    if (preCover) restore.coverPhotoUrl    = preCover;

    await Promise.all([
      updateDoc(env, `users/${params.uid}`, {
        isSuspended:                    false,
        suspensionReason:               null,
        suspensionStartDate:            null,
        suspensionExpiry:               null,
        suspensionCanAppeal:            null,
        suspendedBy:                    null,
        preSuspensionDisplayName:       null,
        preSuspensionProfilePhotoUrl:   null,
        preSuspensionCoverPhotoUrl:     null,
        ...restore,
      }),
      setDoc(env, `adminAuditLog/${generateId()}`, {
        adminId:      request.auth.uid,
        action:       'UNSUSPEND',
        targetUserId: params.uid,
        details:      null,
        createdAt:    now(),
      }),
    ]);

    return json({ success: true });
  });

  // ── Report locks by UID ──
  router.post('/api/report-locks/:uid/lock', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    // Look up admin display name for the lock
    const admin = await getDoc(env, `users/${request.auth.uid}`);
    const displayName = admin?.displayName ?? admin?.display_name ?? null;

    await setDoc(env, `reportLocks/${params.uid}`, {
      reportId:    params.uid,
      lockedBy:    request.auth.uid,
      lockedAt:    now(),
      displayName: displayName,
    });

    return json({ success: true, displayName });
  });

  router.delete('/api/report-locks/:uid', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    await deleteDoc(env, `reportLocks/${params.uid}`);

    return json({ success: true });
  });
}

/**
 * Evict a suspended user from any active rooms they are participating in.
 * Queries rooms where the user is a participant, removes them from
 * participantIds, clears their seat, and clears their currentRoomId.
 */
async function evictSuspendedUser(env, uid) {
  const rooms = await queryCollection(env, 'rooms', {
    where: fieldFilter('participantIds', 'ARRAY_CONTAINS', uid),
  });

  if (rooms.length === 0) return;

  const writes = [];

  for (const room of rooms) {
    const participantIds = (room.participantIds || []).filter(id => id !== uid);

    // Clear any seat occupied by this user
    const seats = room.seats ? { ...room.seats } : {};
    for (const [index, seat] of Object.entries(seats)) {
      if (seat && (seat.userId === uid || seat.user_id === uid)) {
        seats[index] = {
          index:    parseInt(index),
          status:   'EMPTY',
          userId:   null,
          isMuted:  false,
        };
      }
    }

    writes.push(batchUpdateOp(env, `rooms/${room.id}`, {
      participantIds,
      seats,
    }));
  }

  // Also clear the user's currentRoomId
  writes.push(batchUpdateOp(env, `users/${uid}`, { currentRoomId: null }));

  // batchWrite handles up to 500 ops; chunk if needed
  for (let i = 0; i < writes.length; i += 500) {
    await batchWrite(env, writes.slice(i, i + 500));
  }
}

module.exports = { registerAdminUserRoutes };

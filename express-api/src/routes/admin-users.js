/**
 * Admin user routes — user CRUD, warnings, GCS reset, route aliases.
 *
 * GET    /user/:uid                 → Full user profile (admin)
 * GET    /user/:uid/auth-debug      → Debug endpoint
 * PATCH  /user/:uid                 → Update user fields (admin)
 * POST   /user/:uid/notify-changes  → Batched change notification PM (admin)
 * GET    /user/:uid/stalkers        → Read stalkers list (admin)
 * POST   /user/:uid/warn            → Issue warning (admin)
 * POST   /user/:uid/reset-gcs       → Reset GCS score (admin)
 * GET    /conversations/:id/messages → Admin view conversation messages
 * GET    /search/uniqueId/:id       → Search by unique ID (alias)
 * POST   /resolve/uids-to-uniqueIds → Resolve UIDs to unique IDs (alias)
 * POST   /resolve/uniqueIds-to-uids → Resolve unique IDs to UIDs (alias)
 * POST   /user/:uid/suspend         → Suspend user (alias)
 * POST   /user/:uid/unsuspend       → Unsuspend user (alias)
 * POST   /report-locks/:uid/lock    → Lock reports for user (alias)
 * DELETE /report-locks/:uid         → Unlock reports for user (alias)
 */

const router = require('express').Router();
const { db, auth } = require('../utils/firebase');
const { requireAdmin, clearSuspensionCache } = require('../middleware/auth');
const { generateId, now } = require('../utils/helpers');
const { computeDisplayScore } = require('../utils/gcs');
const { sendSystemPm } = require('../utils/system-pm');
const log = require('../utils/log');

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Look up a Firebase Auth user's email and phone by UID.
 * Uses Firebase Admin SDK directly.
 */
async function getFirebaseAuthInfo(uid) {
  try {
    const userRecord = await auth.getUser(uid);
    let email = userRecord.email || null;
    if (!email && userRecord.providerData) {
      for (const provider of userRecord.providerData) {
        if (provider.email) { email = provider.email; break; }
      }
    }
    return { email, phoneNumber: userRecord.phoneNumber || null };
  } catch (err) {
    log.error('admin-users', 'Firebase Auth lookup failed', { uid, error: err.message });
    return { email: null, phoneNumber: null };
  }
}

/**
 * Normalize snake_case fields and compute GCS display score.
 */
function enrichUser(user) {
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
  user.gcsDisplayScore  = computeDisplayScore(user.gcsScore, user.gcsLastDeductionAt);
  return user;
}

/**
 * Fetch email + phone from Firebase Auth and backfill into Firestore if missing.
 */
async function backfillAuthInfo(user, uid) {
  if (!user.email || !user.phoneNumber) {
    const authInfo = await getFirebaseAuthInfo(uid);
    if (!user.email && authInfo.email) {
      user.email = authInfo.email;
      db.doc(`users/${uid}`).update({ email: authInfo.email }).catch(err => log.error('admin-users', 'Failed to backfill email', { uid, error: err.message }));
    }
    if (!user.phoneNumber && authInfo.phoneNumber) {
      user.phoneNumber = authInfo.phoneNumber;
      db.doc(`users/${uid}`).update({ phoneNumber: authInfo.phoneNumber }).catch(err => log.error('admin-users', 'Failed to backfill phoneNumber', { uid, error: err.message }));
    }
  }
}

// ══════════════════════════════════════════════════════════════
// USER CRUD (admin)
// ══════════════════════════════════════════════════════════════

// ── Get user profile (admin — no ownership check) ──
router.get('/user/:uid', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const snap = await db.doc(`users/${req.params.uid}`).get();
    if (!snap.exists) return res.status(404).json({ error: 'User not found' });
    const user = enrichUser({ id: snap.id, ...snap.data() });
    await backfillAuthInfo(user, req.params.uid);

    res.json(user);
  } catch (err) {
    log.error('admin-users', 'GET /user/:uid failed', { uid: req.params.uid, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Debug: raw Firebase Auth lookup ──
router.get('/user/:uid/auth-debug', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const userRecord = await auth.getUser(req.params.uid);
    res.json({
      uid: userRecord.uid,
      email: userRecord.email || null,
      phoneNumber: userRecord.phoneNumber || null,
      providerData: userRecord.providerData,
      disabled: userRecord.disabled,
      metadata: userRecord.metadata,
    });
  } catch (err) {
    log.error('admin-users', 'Auth debug lookup failed', { uid: req.params.uid, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── Update user fields (admin — whitelisted fields) ──
router.patch('/user/:uid', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body) return res.status(400).json({ error: 'Invalid JSON body' });

    // Admin can update more fields than regular users — all in camelCase
    const allowedFields = [
      'displayName', 'description', 'nationality', 'dateOfBirth', 'gender',
      'profilePhotoUrl', 'avatarUrl', 'coverPhotoUrl', 'userType',
      'shyCoins', 'shyBeans', 'luckScore', 'pityCounter',
      'isSuperShy', 'superShyExpiry',
      'loginStreak', 'gcsScore', 'warningCount', 'warningReason',
      'hasActiveWarning', 'pmPrivacy', 'acceptedLegalVersion',
      'currentRoomId',
      // Fields editable from admin panel form
      'email',
      'blockedUserIds', 'followingIds', 'followerIds',
      'hideFollowing', 'hideOnlineStatus', 'hideAge',
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
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Validate array fields
    for (const arrayField of ['blockedUserIds', 'followingIds', 'followerIds']) {
      if (arrayField in updates && !Array.isArray(updates[arrayField])) {
        return res.status(400).json({ error: `${arrayField} must be an array` });
      }
    }

    log.info('admin-users', 'Updating user fields', { adminId: req.auth.uid, targetUid: req.params.uid, fields: Object.keys(updates) });
    await db.doc(`users/${req.params.uid}`).update(updates);

    // Audit log
    await db.doc(`adminAuditLog/${generateId()}`).set({
      adminId:      req.auth.uid,
      action:       'EDIT_USER',
      targetUserId: req.params.uid,
      details:      `Updated fields: ${Object.keys(updates).join(', ')}`,
      createdAt:    now(),
    });

    // Send system messages for user-visible changes (non-blocking)
    // When ?silent=true, skip PMs (used by per-field auto-save; PMs are batched separately)
    const silent = req.query.silent === 'true';
    if (!silent) {
      const uid = req.params.uid;
      const pmMessages = [];
      if (updates.displayName !== undefined) pmMessages.push('Your display name was updated by a moderator.');
      if (updates.profilePhotoUrl === '' || updates.profilePhotoUrl === null) pmMessages.push('Your profile photo was removed by a moderator.');
      if (updates.coverPhotoUrl === '' || updates.coverPhotoUrl === null) pmMessages.push('Your cover photo was removed by a moderator.');
      if (updates.description === '' || updates.description === null) pmMessages.push('Your profile description was cleared by a moderator.');
      if (updates.isSuperShy !== undefined) {
        pmMessages.push(updates.isSuperShy ? 'Super Shy has been activated on your account.' : 'Super Shy has been removed from your account.');
      }
      if (updates.superShyExpiry !== undefined) pmMessages.push('Your Super Shy expiry date has been updated.');
      for (const msg of pmMessages) {
        try { await sendSystemPm(uid, msg); } catch (e) { log.warn('system-pm', 'Failed to send', { uid, error: e.message }); }
      }
    }

    res.json({ success: true, updatedFields: Object.keys(updates) });
  } catch (err) {
    log.error('admin-users', 'PATCH /user/:uid failed', { uid: req.params.uid, error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ── Batched change notification ──
router.post('/user/:uid/notify-changes', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const { fields } = req.body;
    if (!Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({ error: 'fields must be a non-empty array' });
    }

    // Only notify for user-visible fields
    const NOTIFIABLE = new Set([
      'displayName', 'userType', 'email', 'description',
      'profilePhotoUrl', 'coverPhotoUrl',
    ]);
    const relevant = fields.filter(f => NOTIFIABLE.has(f));
    if (relevant.length === 0) {
      return res.json({ ok: true, notified: false, reason: 'No notifiable fields' });
    }

    const friendlyNames = {
      displayName: 'display name',
      userType: 'account type',
      email: 'email address',
      description: 'profile description',
      profilePhotoUrl: 'profile photo',
      coverPhotoUrl: 'cover photo',
    };

    const fieldList = relevant.map(f => friendlyNames[f] || f).join(', ');
    const text = `A moderator has updated your profile. Changed: ${fieldList}.`;
    await sendSystemPm(req.params.uid, text);

    log.info('admin-users', 'Sent batched change notification', {
      adminId: req.auth.uid,
      targetUid: req.params.uid,
      fields: relevant,
    });

    res.json({ ok: true, notified: true, fields: relevant });
  } catch (err) {
    log.error('admin-users', 'notify-changes failed', {
      uid: req.params.uid,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Read stalkers list (admin) ──
router.get('/user/:uid/stalkers', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const snap = await db.collection(`users/${req.params.uid}/stalkers`).get();
    const stalkerIds = snap.docs.map(doc => doc.id);

    res.json({ stalkers: stalkerIds, count: stalkerIds.length });
  } catch (err) {
    log.error('admin-users', 'GET stalkers failed', {
      uid: req.params.uid,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ══════════════════════════════════════════════════════════════
// WARNINGS & GCS (admin)
// ══════════════════════════════════════════════════════════════

// ── Issue warning ──
router.post('/user/:uid/warn', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body?.reason) return res.status(400).json({ error: 'reason is required' });

    const severity = body.severity || 'standard';
    const deduction = severity === 'severe' ? 20 : 10;
    const timestamp = now();

    const snap = await db.doc(`users/${req.params.uid}`).get();
    if (!snap.exists) return res.status(404).json({ error: 'User not found' });
    const user = { id: snap.id, ...snap.data() };

    const gcsScore = user.gcsScore ?? user.gcs_score ?? 100;
    const warningCount = user.warningCount ?? user.warning_count ?? 0;
    const newGcs = Math.max(0, gcsScore - deduction);
    const newWarningCount = warningCount + 1;

    log.info('admin-users', 'Issuing warning', { adminId: req.auth.uid, targetUid: req.params.uid, severity, deduction, gcs: `${gcsScore} -> ${newGcs}` });

    await Promise.all([
      db.doc(`users/${req.params.uid}`).update({
        gcsScore:           newGcs,
        gcsLastDeductionAt: timestamp,
        warningCount:       newWarningCount,
        warningReason:      body.reason,
        hasActiveWarning:   true,
        hasNewWarning:      true,
        warningIssuedAt:    timestamp,
      }),
      db.doc(`adminAuditLog/${generateId()}`).set({
        adminId:      req.auth.uid,
        action:       'WARN',
        targetUserId: req.params.uid,
        details:      `Severity: ${severity}, GCS: ${gcsScore} → ${newGcs}, Reason: ${body.reason}`,
        createdAt:    timestamp,
      }),
    ]);

    // Send system PM to warned user (fire-and-forget)
    sendSystemPm(req.params.uid,
      `⚠️ You have received a warning from the moderation team.\n\nReason: ${body.reason}\n\nYour Good Character Score has been reduced by ${deduction} points (now ${newGcs}/100). Repeated violations may result in suspension.`
    ).catch(err => log.error('admin-users', 'Failed to send warning PM', { targetUid: req.params.uid, error: err.message }));

    res.json({
      success: true,
      newGcs,
      deduction,
      warningCount: newWarningCount,
    });
  } catch (err) {
    log.error('admin-users', 'Warn user failed', { uid: req.params.uid, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Reset GCS ──
router.post('/user/:uid/reset-gcs', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const timestamp = now();

    log.info('admin-users', 'Resetting GCS', { adminId: req.auth.uid, targetUid: req.params.uid });

    await Promise.all([
      db.doc(`users/${req.params.uid}`).update({
        gcsScore:           100,
        gcsLastDeductionAt: null,
        warningCount:       0,
        hasActiveWarning:   false,
        hasNewWarning:      false,
        warningReason:      null,
        warningIssuedAt:    null,
      }),
      db.doc(`adminAuditLog/${generateId()}`).set({
        adminId:      req.auth.uid,
        action:       'RESET_GCS',
        targetUserId: req.params.uid,
        details:      'GCS reset to 100',
        createdAt:    timestamp,
      }),
    ]);

    res.json({ success: true });
  } catch (err) {
    log.error('admin-users', 'Reset GCS failed', { uid: req.params.uid, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ══════════════════════════════════════════════════════════════
// ADMIN VIEW CONVERSATION MESSAGES
// ══════════════════════════════════════════════════════════════

router.get('/conversations/:id/messages', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const messageLimit = Math.min(parseInt(req.query.limit) || 50, 200);

    const snapshot = await db.collection(`conversations/${req.params.id}/messages`)
      .orderBy('createdAt', 'desc')
      .limit(messageLimit)
      .get();

    const messages = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    // Return chronological order
    res.json(messages.reverse());
  } catch (err) {
    log.error('admin-users', 'Admin get messages failed', { conversationId: req.params.id, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ══════════════════════════════════════════════════════════════
// ROUTE ALIASES (match admin page's expected paths)
// ══════════════════════════════════════════════════════════════

// ── Search by unique ID ──
router.get('/search/uniqueId/:id', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const uniqueId = parseInt(req.params.id);
    const snapshot = await db.collection('users')
      .where('uniqueId', '==', uniqueId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      // Fallback: search by tempUniqueId
      const tempSnap = await db.collection('users')
        .where('tempUniqueId', '==', uniqueId)
        .limit(1)
        .get();
      if (tempSnap.empty) return res.status(404).json({ error: 'User not found' });
      const doc = tempSnap.docs[0];
      const user = enrichUser({ id: doc.id, ...doc.data() });
      await backfillAuthInfo(user, doc.id);
      return res.json(user);
    }

    const doc = snapshot.docs[0];
    const user = enrichUser({ id: doc.id, ...doc.data() });
    await backfillAuthInfo(user, doc.id);

    res.json(user);
  } catch (err) {
    log.error('admin-users', 'Search by uniqueId failed', { uniqueId: req.params.id, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── UID → Unique ID resolver ──
router.post('/resolve/uids-to-uniqueIds', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const uids = req.body?.uids || [];
    if (uids.length === 0) return res.json({});

    const snaps = await Promise.all(uids.map(uid => db.doc(`users/${uid}`).get()));

    const map = {};
    for (let i = 0; i < uids.length; i++) {
      const snap = snaps[i];
      if (snap.exists) {
        const data = snap.data();
        map[uids[i]] = {
          uniqueId: data.uniqueId ?? data.unique_id ?? null,
          displayName: data.displayName ?? data.display_name ?? null,
        };
      }
    }
    res.json({ mapping: map });
  } catch (err) {
    log.error('admin-users', 'UID-to-uniqueId resolve failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Unique ID → UID resolver ──
router.post('/resolve/uniqueIds-to-uids', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const uniqueIds = req.body?.uniqueIds || [];
    if (uniqueIds.length === 0) return res.json({});

    // Query each uniqueId in parallel
    const results = await Promise.all(
      uniqueIds.map(id =>
        db.collection('users')
          .where('uniqueId', '==', id)
          .limit(1)
          .get()
      )
    );

    const map = {};
    for (let i = 0; i < uniqueIds.length; i++) {
      const snapshot = results[i];
      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        const data = doc.data();
        map[uniqueIds[i]] = data.uid ?? doc.id;
      }
    }
    res.json({ mapping: map });
  } catch (err) {
    log.error('admin-users', 'UniqueId-to-UID resolve failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Suspend user ──
router.post('/user/:uid/suspend', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body?.reason) return res.status(400).json({ error: 'reason is required' });
    if (typeof body.canAppeal !== 'boolean') return res.status(400).json({ error: 'canAppeal must be a boolean' });

    let endTimestamp = null;
    if (body.endDate) {
      const d = new Date(body.endDate);
      if (isNaN(d.getTime())) return res.status(400).json({ error: 'endDate must be a valid ISO-8601 date' });
      if (d.getTime() <= Date.now()) return res.status(400).json({ error: 'endDate must be in the future' });
      endTimestamp = d.getTime();
    }

    const snap = await db.doc(`users/${req.params.uid}`).get();
    if (!snap.exists) return res.status(404).json({ error: 'User not found' });
    const user = { id: snap.id, ...snap.data() };

    const timestamp = now();

    log.info('admin-users', 'Suspending user', { adminId: req.auth.uid, targetUid: req.params.uid, endDate: body.endDate || 'permanent', canAppeal: body.canAppeal });

    await Promise.all([
      db.doc(`users/${req.params.uid}`).update({
        isSuspended:                    true,
        suspensionReason:               body.reason.trim(),
        suspensionStartDate:            timestamp,
        suspensionEndDate:               endTimestamp,
        suspensionCanAppeal:            body.canAppeal,
        suspendedBy:                    req.auth.uid,
        preSuspensionDisplayName:       user.displayName ?? user.display_name ?? null,
        preSuspensionProfilePhotoUrl:   user.profilePhotoUrl ?? user.profile_photo_url ?? null,
        preSuspensionCoverPhotoUrl:     user.coverPhotoUrl ?? user.cover_photo_url ?? null,
        displayName:                    'Suspended Account',
        profilePhotoUrl:                null,
        coverPhotoUrl:                  null,
        avatarUrl:                      null,
        description:                    null,
        currentRoomId:                  null,
      }),
      db.doc(`adminAuditLog/${generateId()}`).set({
        adminId:      req.auth.uid,
        action:       'SUSPEND',
        targetUserId: req.params.uid,
        details:      body.reason,
        createdAt:    timestamp,
      }),
    ]);

    // Send system PM about suspension (non-blocking)
    try { await sendSystemPm(req.params.uid, `Your account has been suspended. Reason: ${body.reason.trim()}`); } catch (e) { log.warn('system-pm', 'Failed to send', { uid: req.params.uid, error: e.message }); }

    // Auto-apply device and network bans (fire-and-forget)
    autoApplyBans(req.params.uid, body.endDate ? body.endDate : null)
      .catch(err => log.error('admin-users', 'Failed to auto-apply bans', { uid: req.params.uid, error: err.message }));

    // Evict from any active rooms (fire-and-forget)
    evictSuspendedUser(req.params.uid)
      .catch(err => log.error('admin-users', 'Failed to evict suspended user', { uid: req.params.uid, error: err.message }));

    res.json({ success: true });
  } catch (err) {
    log.error('admin-users', 'Suspend user failed', { uid: req.params.uid, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Unsuspend user ──
router.post('/user/:uid/unsuspend', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const snap = await db.doc(`users/${req.params.uid}`).get();
    if (!snap.exists) return res.status(404).json({ error: 'User not found' });
    const user = { id: snap.id, ...snap.data() };

    const restore = {};
    const preName  = user.preSuspensionDisplayName  ?? user.pre_suspension_display_name  ?? null;
    const prePhoto = user.preSuspensionProfilePhotoUrl ?? user.pre_suspension_profile_photo_url ?? null;
    const preCover = user.preSuspensionCoverPhotoUrl   ?? user.pre_suspension_cover_photo_url   ?? null;
    if (preName)  restore.displayName      = preName;
    if (prePhoto) restore.profilePhotoUrl  = prePhoto;
    if (preCover) restore.coverPhotoUrl    = preCover;

    log.info('admin-users', 'Unsuspending user', { adminId: req.auth.uid, targetUid: req.params.uid });

    await Promise.all([
      db.doc(`users/${req.params.uid}`).update({
        isSuspended:                    false,
        suspensionReason:               null,
        suspensionStartDate:            null,
        suspensionEndDate:               null,
        suspensionCanAppeal:            null,
        suspendedBy:                    null,
        preSuspensionDisplayName:       null,
        preSuspensionProfilePhotoUrl:   null,
        preSuspensionCoverPhotoUrl:     null,
        ...restore,
      }),
      db.doc(`adminAuditLog/${generateId()}`).set({
        adminId:      req.auth.uid,
        action:       'UNSUSPEND',
        targetUserId: req.params.uid,
        details:      null,
        createdAt:    now(),
      }),
    ]);

    // Send system PM about unsuspension (non-blocking)
    try { await sendSystemPm(req.params.uid, 'Your account suspension has been lifted.'); } catch (e) { log.warn('system-pm', 'Failed to send', { uid: req.params.uid, error: e.message }); }

    clearSuspensionCache(req.params.uid);
    res.json({ success: true });
  } catch (err) {
    log.error('admin-users', 'Unsuspend user failed', { uid: req.params.uid, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Report locks by UID ──
router.post('/report-locks/:uid/lock', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    // Look up admin display name for the lock
    const adminSnap = await db.doc(`users/${req.auth.uid}`).get();
    const adminData = adminSnap.exists ? adminSnap.data() : null;
    const displayName = adminData?.displayName ?? adminData?.display_name ?? null;

    await db.doc(`reportLocks/${req.params.uid}`).set({
      reportId:    req.params.uid,
      lockedBy:    req.auth.uid,
      lockedAt:    now(),
      displayName: displayName,
    });

    res.json({ success: true, displayName });
  } catch (err) {
    log.error('admin-users', 'Lock reports failed', { uid: req.params.uid, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/report-locks/:uid', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    await db.doc(`reportLocks/${req.params.uid}`).delete();

    res.json({ success: true });
  } catch (err) {
    log.error('admin-users', 'Unlock reports failed', { uid: req.params.uid, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ══════════════════════════════════════════════════════════════
// HELPER: Auto-apply device + network bans on suspension
// ══════════════════════════════════════════════════════════════

/**
 * When a user is suspended, automatically ban all their known devices
 * and their last known IP address. Uses the same duration as the
 * suspension if an endDate is provided, otherwise permanent.
 */
async function autoApplyBans(uid, endDate) {
  const timestamp = now();

  // Calculate expiry — match suspension duration or permanent
  let expiresAt = null;
  let duration = 'permanent';
  if (endDate) {
    expiresAt = new Date(endDate).toISOString();
    duration = 'suspension-match';
  }

  // Find all devices bound to this user
  const bindingsSnap = await db.collection('deviceBindings')
    .where('userId', '==', uid)
    .get();

  let lastIp = null;

  for (const doc of bindingsSnap.docs) {
    const binding = doc.data();

    // Create a device ban for each bound device
    await db.doc(`deviceBans/${doc.id}`).set({
      deviceId: doc.id,
      reason: 'Auto-applied: user suspended',
      duration,
      expiresAt,
      linkedUserId: uid,
      autoApplied: true,
      createdAt: timestamp,
      createdBy: 'system',
    });

    // Track the last known IP from the most recent binding
    if (binding.lastIp || binding.ip) {
      lastIp = binding.lastIp || binding.ip;
    }
  }

  // Create a network ban for the last known IP
  if (lastIp) {
    await db.doc(`networkBans/${generateId()}`).set({
      type: 'ip',
      value: lastIp,
      reason: 'Auto-applied: user suspended',
      duration,
      expiresAt,
      linkedUserId: uid,
      autoApplied: true,
      createdAt: timestamp,
      createdBy: 'system',
    });
  }

  const deviceCount = bindingsSnap.docs.length;
  const networkCount = lastIp ? 1 : 0;
  log.info('admin-users', 'Auto-bans applied', { uid, deviceBans: deviceCount, networkBans: networkCount });
}

// ══════════════════════════════════════════════════════════════
// HELPER: Evict suspended user from rooms
// ══════════════════════════════════════════════════════════════

/**
 * Evict a suspended user from any active rooms they are participating in.
 * Queries rooms where the user is a participant, removes them from
 * participantIds, clears their seat, and clears their currentRoomId.
 */
async function evictSuspendedUser(uid) {
  const snapshot = await db.collection('rooms')
    .where('participantIds', 'array-contains', uid)
    .get();

  if (snapshot.empty) {
    // Still clear currentRoomId even if no matching rooms found
    await db.doc(`users/${uid}`).update({ currentRoomId: null });
    return;
  }

  const rooms = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

  // Collect all writes then batch in chunks of 500
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

    writes.push({ ref: db.doc(`rooms/${room.id}`), data: { participantIds, seats } });
  }

  // Add the user's currentRoomId clear
  writes.push({ ref: db.doc(`users/${uid}`), data: { currentRoomId: null } });

  // Batch write in chunks of 500
  for (let i = 0; i < writes.length; i += 500) {
    const batch = db.batch();
    const chunk = writes.slice(i, i + 500);
    for (const w of chunk) {
      batch.update(w.ref, w.data);
    }
    await batch.commit();
  }
}

module.exports = router;

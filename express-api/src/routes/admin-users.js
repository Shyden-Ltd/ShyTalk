/**
 * Admin user routes — user CRUD, warnings, GCS reset, route aliases.
 *
 * GET    /user/:uniqueId                 → Full user profile (admin)
 * GET    /user/:uid/auth-debug           → Debug endpoint (Firebase UID)
 * PATCH  /user/:uniqueId                 → Update user fields (admin)
 * POST   /user/:uniqueId/notify-changes  → Batched change notification PM (admin)
 * GET    /user/:uniqueId/stalkers        → Read stalkers list (admin)
 * POST   /user/:uniqueId/warn            → Issue warning (admin, creates warning doc)
 * GET    /user/:uniqueId/warnings        → List warning history (admin, paginated)
 * POST   /user/:uniqueId/warnings/:id/revoke → Revoke a warning (admin)
 * POST   /user/:uniqueId/reset-gcs       → Reset GCS score (admin)
 * GET    /conversations/:id/messages → Admin view conversation messages
 * GET    /search/uniqueId/:id       → Search by unique ID (alias)
 * POST   /resolve/uids-to-uniqueIds → Resolve UIDs to unique IDs (alias)
 * POST   /resolve/uniqueIds-to-uids → Resolve unique IDs to UIDs (alias)
 * POST   /user/:uniqueId/suspend         → Suspend user (alias)
 * POST   /user/:uniqueId/unsuspend       → Unsuspend user (alias)
 * POST   /report-locks/:uniqueId/lock    → Lock reports for user (alias)
 * DELETE /report-locks/:uniqueId         → Unlock reports for user (alias)
 * POST   /user/:uniqueId/change-role      → Change user role (admin)
 * POST   /user/:uniqueId/delete          → Schedule account deletion (admin)
 * POST   /user/:uniqueId/cancel-delete   → Cancel scheduled deletion (admin)
 */

const router = require('express').Router();
const { db, auth, FieldValue } = require('../utils/firebase');
const { requireAdmin, clearSuspensionCache } = require('../middleware/auth');
const { generateId, now } = require('../utils/helpers');
const { computeDisplayScore } = require('../utils/gcs');
const { sendSystemPm } = require('../utils/system-pm');
const { getDoc } = require('../utils/firestore-helpers');
const log = require('../utils/log');
const { sendEmail } = require('../utils/email');
const { buildDeletionScheduledEmail } = require('../utils/email-templates');
const { sendFcmToTokens } = require('../utils/fcm');

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Look up a Firebase Auth user's email by UID.
 * Uses Firebase Admin SDK directly.
 */
async function getFirebaseAuthInfo(uid) {
  try {
    const userRecord = await auth.getUser(uid);
    let email = userRecord.email || null;
    if (!email && userRecord.providerData) {
      for (const provider of userRecord.providerData) {
        if (provider.email) {
          email = provider.email;
          break;
        }
      }
    }
    return { email };
  } catch (err) {
    log.error('admin-users', 'Firebase Auth lookup failed', { uid, error: err.message });
    return { email: null };
  }
}

/**
 * Normalize snake_case fields and compute GCS display score.
 */
function normalizeUser(user) {
  user.displayName = user.displayName ?? user.display_name ?? null;
  user.profilePhotoUrl = user.profilePhotoUrl ?? user.profile_photo_url ?? null;
  user.coverPhotoUrl = user.coverPhotoUrl ?? user.cover_photo_url ?? null;

  // For suspended users, show real profile data to admins (not the masked "Suspended Account")
  if (user.isSuspended) {
    const preName = user.preSuspensionDisplayName ?? user.pre_suspension_display_name;
    const prePhoto = user.preSuspensionProfilePhotoUrl ?? user.pre_suspension_profile_photo_url;
    const preCover = user.preSuspensionCoverPhotoUrl ?? user.pre_suspension_cover_photo_url;
    if (preName) user.displayName = preName;
    if (prePhoto) user.profilePhotoUrl = prePhoto;
    if (preCover) user.coverPhotoUrl = preCover;
    // Expose _preSuspension object for the admin panel's pre-suspension info section
    if (preName || prePhoto || preCover) {
      user._preSuspension = {
        displayName: preName || null,
        profilePhotoUrl: prePhoto || null,
        coverPhotoUrl: preCover || null,
      };
    }
  }
  user.dateOfBirth = user.dateOfBirth ?? user.date_of_birth ?? null;
  user.uniqueId = user.uniqueId ?? user.unique_id ?? null;
  user.isSuperShy = user.isSuperShy ?? user.is_super_shy ?? false;
  user.superShyExpiry = user.superShyExpiry ?? user.super_shy_expiry ?? null;
  user.superShyTier = user.superShyTier ?? user.super_shy_tier ?? null;
  user.loginStreak = user.loginStreak ?? user.login_streak ?? 0;
  user.shyCoins = user.shyCoins ?? user.shy_coins ?? 0;
  user.shyBeans = user.shyBeans ?? user.shy_beans ?? 0;
  user.warningCount = user.warningCount ?? user.warning_count ?? 0;
  user.luckScore = user.luckScore ?? user.luck_score ?? 0;
  user.pityCounter = user.pityCounter ?? user.pity_counter ?? 0;
  user.gcsScore = user.gcsScore ?? user.gcs_score ?? 100;
  user.gcsLastDeductionAt = user.gcsLastDeductionAt ?? user.gcs_last_deduction_at ?? null;
  user.hasActiveWarning = user.hasActiveWarning ?? user.has_active_warning ?? false;
  user.warningReason = user.warningReason ?? user.warning_reason ?? null;
  user.userType = user.userType ?? user.user_type ?? 'MEMBER';
  user.gcsDisplayScore = computeDisplayScore(user.gcsScore, user.gcsLastDeductionAt);
  return user;
}

/**
 * Fetch email from Firebase Auth and backfill into Firestore if missing.
 * @param {object} user - User data object
 * @param {string} uniqueId - User doc key (uniqueId)
 * @param {string} firebaseUid - Firebase Auth UID for auth lookup
 */
async function backfillAuthInfo(user, uniqueId, firebaseUid) {
  if (!user.email) {
    const authInfo = await getFirebaseAuthInfo(firebaseUid);
    if (authInfo.email) {
      user.email = authInfo.email;
      db.doc(`users/${uniqueId}`)
        .update({ email: authInfo.email })
        .catch((err) =>
          log.error('admin-users', 'Failed to backfill email', { uniqueId, error: err.message }),
        );
    }
  }
}

// ══════════════════════════════════════════════════════════════
// USER CRUD (admin)
// ══════════════════════════════════════════════════════════════

// ── Get user profile (admin — no ownership check) ──
router.get('/user/:uniqueId', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const snap = await db.doc(`users/${req.params.uniqueId}`).get();
    if (!snap.exists) return res.status(404).json({ error: 'User not found' });
    const user = normalizeUser({ id: snap.id, ...snap.data() });
    await backfillAuthInfo(user, req.params.uniqueId, user.uid || snap.id);

    res.json(user);
  } catch (err) {
    log.error('admin-users', 'GET /user/:uniqueId failed', {
      uniqueId: req.params.uniqueId,
      error: err.message,
    });
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
      providerData: userRecord.providerData,
      disabled: userRecord.disabled,
      metadata: userRecord.metadata,
    });
  } catch (err) {
    log.error('admin-users', 'Auth debug lookup failed', {
      uid: req.params.uid,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Update user fields (admin — whitelisted fields) ──
router.patch('/user/:uniqueId', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body) return res.status(400).json({ error: 'Invalid JSON body' });

    // Admin can update more fields than regular users — all in camelCase
    const allowedFields = [
      'displayName',
      'description',
      'nationality',
      'dateOfBirth',
      'gender',
      'profilePhotoUrl',
      'avatarUrl',
      'coverPhotoUrl',
      'userType',
      'shyCoins',
      'shyBeans',
      'luckScore',
      'pityCounter',
      'isSuperShy',
      'superShyExpiry',
      'loginStreak',
      'gcsScore',
      'warningCount',
      'warningReason',
      'hasActiveWarning',
      'pmPrivacy',
      'acceptedLegalVersion',
      'currentRoomId',
      // Fields editable from admin panel form
      'email',
      'blockedUserIds',
      'followingIds',
      'followerIds',
      'hideFollowing',
      'hideOnlineStatus',
      'hideAge',
    ];

    const updates = {};
    for (const key of allowedFields) {
      if (key in body) {
        updates[key] = body[key];
      } else {
        // Also accept snake_case input and convert to camelCase
        const snakeKey = key.replaceAll(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
        if (snakeKey in body) updates[key] = body[snakeKey];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Validate string length limits
    const maxLengths = { displayName: 20, description: 200, nationality: 3 };
    for (const [field, max] of Object.entries(maxLengths)) {
      if (field in updates && typeof updates[field] === 'string' && updates[field].length > max) {
        return res.status(400).json({ error: `${field} must be ${max} characters or fewer` });
      }
    }

    // Validate array fields
    for (const arrayField of ['blockedUserIds', 'followingIds', 'followerIds']) {
      if (arrayField in updates && !Array.isArray(updates[arrayField])) {
        return res.status(400).json({ error: `${arrayField} must be an array` });
      }
    }

    log.info('admin-users', 'Updating user fields', {
      adminId: req.auth.uid,
      targetUniqueId: req.params.uniqueId,
      fields: Object.keys(updates),
    });
    await db.doc(`users/${req.params.uniqueId}`).update(updates);

    // Audit log
    await db.doc(`adminAuditLog/${generateId()}`).set({
      adminId: req.auth.uid,
      action: 'EDIT_USER',
      targetUserId: req.params.uniqueId,
      details: `Updated fields: ${Object.keys(updates).join(', ')}`,
      createdAt: now(),
    });

    // Send system messages for user-visible changes (non-blocking)
    // When ?silent=true, skip PMs (used by per-field auto-save; PMs are batched separately)
    const silent = req.query.silent === 'true';
    if (!silent) {
      const uid = req.params.uniqueId;
      const pmMessages = [];
      if (updates.displayName !== undefined)
        pmMessages.push('Your display name was updated by a moderator.');
      if (updates.profilePhotoUrl === '' || updates.profilePhotoUrl === null)
        pmMessages.push('Your profile photo was removed by a moderator.');
      if (updates.coverPhotoUrl === '' || updates.coverPhotoUrl === null)
        pmMessages.push('Your cover photo was removed by a moderator.');
      if (updates.description === '' || updates.description === null)
        pmMessages.push('Your profile description was cleared by a moderator.');
      if (updates.isSuperShy !== undefined) {
        pmMessages.push(
          updates.isSuperShy
            ? 'Super Shy has been activated on your account.'
            : 'Super Shy has been removed from your account.',
        );
      }
      if (updates.superShyExpiry !== undefined)
        pmMessages.push('Your Super Shy expiry date has been updated.');
      for (const msg of pmMessages) {
        try {
          await sendSystemPm(uid, msg);
        } catch (e) {
          log.warn('system-pm', 'Failed to send', { uid, error: e.message });
        }
      }
    }

    res.json({ success: true, updatedFields: Object.keys(updates) });
  } catch (err) {
    log.error('admin-users', 'PATCH /user/:uniqueId failed', {
      uniqueId: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Batched change notification ──
router.post('/user/:uniqueId/notify-changes', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const { fields } = req.body;
    if (!Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({ error: 'fields must be a non-empty array' });
    }

    // Only notify for user-visible fields
    const NOTIFIABLE = new Set([
      'displayName',
      'userType',
      'email',
      'description',
      'profilePhotoUrl',
      'coverPhotoUrl',
    ]);
    const relevant = fields.filter((f) => NOTIFIABLE.has(f));
    if (relevant.length === 0) {
      return res.json({ success: true, notified: false, reason: 'No notifiable fields' });
    }

    const friendlyNames = {
      displayName: 'display name',
      userType: 'account type',
      email: 'email address',
      description: 'profile description',
      profilePhotoUrl: 'profile photo',
      coverPhotoUrl: 'cover photo',
    };

    const fieldList = relevant.map((f) => friendlyNames[f] || f).join(', ');
    const text = `A moderator has updated your profile. Changed: ${fieldList}.`;
    await sendSystemPm(req.params.uniqueId, text);

    log.info('admin-users', 'Sent batched change notification', {
      adminId: req.auth.uid,
      targetUniqueId: req.params.uniqueId,
      fields: relevant,
    });

    res.json({ success: true, notified: true, fields: relevant });
  } catch (err) {
    log.error('admin-users', 'notify-changes failed', {
      uniqueId: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Read stalkers list (admin) ──
router.get('/user/:uniqueId/stalkers', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const snap = await db.collection(`users/${req.params.uniqueId}/stalkers`).get();
    const stalkerIds = snap.docs.map((doc) => doc.id);

    res.json({ stalkers: stalkerIds, count: stalkerIds.length });
  } catch (err) {
    log.error('admin-users', 'GET stalkers failed', {
      uniqueId: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ══════════════════════════════════════════════════════════════
// WARNINGS & GCS (admin)
// ══════════════════════════════════════════════════════════════

// Severity → GCS deduction map
const SEVERITY_DEDUCTION = { 1: 5, 2: 10, 3: 15, 4: 20, 5: 25 };

/**
 * Create a warning document in the user's warnings subcollection
 * and update the user doc's GCS/warning fields.
 * Returns { warningId, newGcs, deduction, warningCount }.
 */
async function createWarning(
  uniqueId,
  { reason, severity, adminNote, source, linkedReportId, adminUid, adminUniqueId },
) {
  const deduction = SEVERITY_DEDUCTION[severity] || 15;
  const timestamp = now();

  const snap = await db.doc(`users/${uniqueId}`).get();
  if (!snap.exists) throw new Error('User not found');
  const user = { id: snap.id, ...snap.data() };

  const gcsScore = user.gcsScore ?? user.gcs_score ?? 100;
  const warningCount = user.warningCount ?? user.warning_count ?? 0;
  const newGcs = Math.max(0, gcsScore - deduction);
  const newWarningCount = warningCount + 1;

  // Look up admin display name
  let adminName = null;
  if (adminUid) {
    const adminDoc = await getDoc(`users/${adminUniqueId || adminUid}`);
    adminName = adminDoc?.displayName ?? adminDoc?.display_name ?? null;
  }

  const warningId = generateId();

  await Promise.all([
    // Write warning doc to subcollection
    db.doc(`users/${uniqueId}/warnings/${warningId}`).set({
      reason,
      severity,
      gcsDeduction: deduction,
      gcsBefore: gcsScore,
      gcsAfter: newGcs,
      adminNote: adminNote || null,
      issuedBy: adminUid,
      issuedByName: adminName,
      source: source || 'direct',
      linkedReportId: linkedReportId || null,
      revoked: false,
      revokedAt: null,
      revokedBy: null,
      createdAt: timestamp,
    }),
    // Update user doc
    db.doc(`users/${uniqueId}`).update({
      gcsScore: newGcs,
      gcsLastDeductionAt: timestamp,
      warningCount: newWarningCount,
      warningReason: reason,
      hasActiveWarning: true,
      hasNewWarning: true,
      warningIssuedAt: timestamp,
    }),
    // Audit log
    db.doc(`adminAuditLog/${generateId()}`).set({
      adminId: adminUid,
      action: 'WARN',
      targetUserId: uniqueId,
      details: `Severity: ${severity}, GCS: ${gcsScore} → ${newGcs}, Reason: ${reason}, Source: ${source || 'direct'}`,
      createdAt: timestamp,
    }),
  ]);

  return { warningId, newGcs, deduction, warningCount: newWarningCount };
}

// ── Issue warning ──
router.post('/user/:uniqueId/warn', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body?.reason) return res.status(400).json({ error: 'reason is required' });

    const severity = Number.parseInt(body.severity, 10) || 3;
    if (severity < 1 || severity > 5)
      return res.status(400).json({ error: 'severity must be 1-5' });

    log.info('admin-users', 'Issuing warning', {
      adminId: req.auth.uid,
      targetUniqueId: req.params.uniqueId,
      severity,
    });

    const result = await createWarning(req.params.uniqueId, {
      reason: body.reason,
      severity,
      adminNote: body.adminNote || null,
      source: 'direct',
      adminUid: req.auth.uid,
      adminUniqueId: req.auth.uniqueId,
    });

    // Send system PM to warned user (fire-and-forget)
    sendSystemPm(
      req.params.uniqueId,
      `\u26a0\ufe0f You have received a warning from the moderation team.\n\nReason: ${body.reason}\n\nRepeated violations may result in suspension.`,
    ).catch((err) =>
      log.error('admin-users', 'Failed to send warning PM', {
        targetUniqueId: req.params.uniqueId,
        error: err.message,
      }),
    );

    res.json({ success: true, ...result });
  } catch (err) {
    if (err.message === 'User not found') return res.status(404).json({ error: err.message });
    log.error('admin-users', 'Warn user failed', {
      uniqueId: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── List warnings ──
router.get('/user/:uniqueId/warnings', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const limit = Math.min(Number.parseInt(req.query.limit, 10) || 20, 100);
    const startAfter = req.query.startAfter ? Number.parseInt(req.query.startAfter, 10) : null;

    let query = db.collection(`users/${req.params.uniqueId}/warnings`).orderBy('createdAt', 'desc');

    if (startAfter) {
      query = query.startAfter(startAfter);
    }

    query = query.limit(limit + 1); // fetch one extra to detect "has more"

    const snapshot = await query.get();
    const docs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    const hasMore = docs.length > limit;
    if (hasMore) docs.pop();

    res.json({ warnings: docs, hasMore });
  } catch (err) {
    log.error('admin-users', 'List warnings failed', {
      uniqueId: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Revoke warning ──
router.post('/user/:uniqueId/warnings/:warningId/revoke', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const uniqueId = req.params.uniqueId;
    const warningId = req.params.warningId;
    const timestamp = now();

    const warningDoc = await getDoc(`users/${uniqueId}/warnings/${warningId}`);
    if (!warningDoc) return res.status(404).json({ error: 'Warning not found' });
    if (warningDoc.revoked) return res.status(400).json({ error: 'Warning already revoked' });

    const deduction = warningDoc.gcsDeduction || 0;

    // Read current user GCS
    const userSnap = await db.doc(`users/${uniqueId}`).get();
    if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
    const user = userSnap.data();
    const currentGcs = user.gcsScore ?? user.gcs_score ?? 100;
    const currentCount = user.warningCount ?? user.warning_count ?? 0;
    const restoredGcs = Math.min(100, currentGcs + deduction);

    log.info('admin-users', 'Revoking warning', {
      adminId: req.auth.uid,
      targetUniqueId: uniqueId,
      warningId,
      restored: deduction,
    });

    await Promise.all([
      // Mark warning as revoked
      db.doc(`users/${uniqueId}/warnings/${warningId}`).update({
        revoked: true,
        revokedAt: timestamp,
        revokedBy: req.auth.uid,
      }),
      // Restore GCS points and decrement warning count
      db.doc(`users/${uniqueId}`).update({
        gcsScore: restoredGcs,
        warningCount: Math.max(0, currentCount - 1),
      }),
      // Audit log
      db.doc(`adminAuditLog/${generateId()}`).set({
        adminId: req.auth.uid,
        action: 'REVOKE_WARNING',
        targetUserId: uniqueId,
        details: `Revoked warning ${warningId}, restored ${deduction} GCS (${currentGcs} → ${restoredGcs})`,
        createdAt: timestamp,
      }),
    ]);

    res.json({ success: true, restoredGcs, deduction });
  } catch (err) {
    log.error('admin-users', 'Revoke warning failed', {
      uniqueId: req.params.uniqueId,
      warningId: req.params.warningId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Reset GCS ──
router.post('/user/:uniqueId/reset-gcs', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const timestamp = now();

    log.info('admin-users', 'Resetting GCS', {
      adminId: req.auth.uid,
      targetUniqueId: req.params.uniqueId,
    });

    await Promise.all([
      db.doc(`users/${req.params.uniqueId}`).update({
        gcsScore: 100,
        gcsLastDeductionAt: null,
        warningCount: 0,
        hasActiveWarning: false,
        hasNewWarning: false,
        warningReason: null,
        warningIssuedAt: null,
      }),
      db.doc(`adminAuditLog/${generateId()}`).set({
        adminId: req.auth.uid,
        action: 'RESET_GCS',
        targetUserId: req.params.uniqueId,
        details: 'GCS reset to 100',
        createdAt: timestamp,
      }),
    ]);

    res.json({ success: true });
  } catch (err) {
    log.error('admin-users', 'Reset GCS failed', {
      uniqueId: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Change role ──
const VALID_USER_TYPES = ['MEMBER', 'SHYTALK_OFFICIAL', 'MC_SINGER', 'MC_EVENT_HOST', 'TEACHER'];

router.post('/user/:uniqueId/change-role', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const { userType } = req.body || {};
    if (!userType || !VALID_USER_TYPES.includes(userType)) {
      return res.status(400).json({
        error: `Invalid userType. Must be one of: ${VALID_USER_TYPES.join(', ')}`,
      });
    }

    const userRef = db.doc(`users/${req.params.uniqueId}`);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });

    const user = userSnap.data();
    const firebaseUid = user.firebaseUid;

    // Update role + write roleChanged timestamp
    await userRef.update({
      userType,
      roleChanged: FieldValue.serverTimestamp(),
    });

    // Revoke all sessions
    await auth.revokeRefreshTokens(firebaseUid);

    // If demoting from admin, remove admin claim
    if (user.isAdmin) {
      await auth.setCustomUserClaims(firebaseUid, { admin: false });
    }

    log.info('admin-users', 'Changed user role', {
      adminId: req.auth.uid,
      targetUniqueId: req.params.uniqueId,
      newRole: userType,
      previousRole: user.userType,
    });

    res.json({ success: true });
  } catch (err) {
    log.error('admin-users', 'Change role failed', {
      uniqueId: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ══════════════════════════════════════════════════════════════
// ADMIN VIEW CONVERSATION MESSAGES
// ══════════════════════════════════════════════════════════════

router.get('/conversations/:id/messages', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const messageLimit = Math.min(Number.parseInt(req.query.limit, 10) || 50, 200);

    const snapshot = await db
      .collection(`conversations/${req.params.id}/messages`)
      .orderBy('createdAt', 'desc')
      .limit(messageLimit)
      .get();

    const messages = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Return chronological order
    res.json(messages.toReversed());
  } catch (err) {
    log.error('admin-users', 'Admin get messages failed', {
      conversationId: req.params.id,
      error: err.message,
    });
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

    const uniqueId = Number.parseInt(req.params.id, 10);
    const snapshot = await db.collection('users').where('uniqueId', '==', uniqueId).limit(1).get();

    if (snapshot.empty) {
      // Fallback: search by tempUniqueId
      const tempSnap = await db
        .collection('users')
        .where('tempUniqueId', '==', uniqueId)
        .limit(1)
        .get();
      if (tempSnap.empty) return res.status(404).json({ error: 'User not found' });
      const doc = tempSnap.docs[0];
      const user = normalizeUser({ id: doc.id, ...doc.data() });
      await backfillAuthInfo(user, doc.id, user.uid || doc.id);
      return res.json(user);
    }

    const doc = snapshot.docs[0];
    const user = normalizeUser({ id: doc.id, ...doc.data() });
    await backfillAuthInfo(user, doc.id, user.uid || doc.id);

    res.json(user);
  } catch (err) {
    log.error('admin-users', 'Search by uniqueId failed', {
      uniqueId: req.params.id,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── UID → Unique ID resolver ──
router.post('/resolve/uids-to-uniqueIds', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const uids = req.body?.uids || [];
    if (uids.length === 0) return res.json({});

    const snaps = await Promise.all(uids.map((uid) => db.doc(`users/${uid}`).get()));

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
      uniqueIds.map((id) =>
        db.collection('users').where('uniqueId', '==', id).select('uid').limit(1).get(),
      ),
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
router.post('/user/:uniqueId/suspend', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body?.reason) return res.status(400).json({ error: 'reason is required' });
    if (typeof body.canAppeal !== 'boolean')
      return res.status(400).json({ error: 'canAppeal must be a boolean' });

    let endTimestamp = null;
    if (body.endDate) {
      const endDate = new Date(body.endDate);
      if (Number.isNaN(endDate.getTime()))
        return res.status(400).json({ error: 'endDate must be a valid ISO-8601 date' });
      if (endDate.getTime() <= Date.now())
        return res.status(400).json({ error: 'endDate must be in the future' });
      endTimestamp = endDate.getTime();
    }

    const snap = await db.doc(`users/${req.params.uniqueId}`).get();
    if (!snap.exists) return res.status(404).json({ error: 'User not found' });
    const user = { id: snap.id, ...snap.data() };

    const timestamp = now();

    log.info('admin-users', 'Suspending user', {
      adminId: req.auth.uid,
      targetUniqueId: req.params.uniqueId,
      endDate: body.endDate || 'permanent',
      canAppeal: body.canAppeal,
    });

    await Promise.all([
      db.doc(`users/${req.params.uniqueId}`).update({
        isSuspended: true,
        suspensionReason: body.reason.trim(),
        suspensionStartDate: timestamp,
        suspensionEndDate: endTimestamp,
        suspensionCanAppeal: body.canAppeal,
        suspendedBy: req.auth.uid,
        preSuspensionDisplayName: user.displayName ?? user.display_name ?? null,
        preSuspensionProfilePhotoUrl: user.profilePhotoUrl ?? user.profile_photo_url ?? null,
        preSuspensionCoverPhotoUrl: user.coverPhotoUrl ?? user.cover_photo_url ?? null,
        displayName: 'Suspended Account',
        profilePhotoUrl: null,
        coverPhotoUrl: null,
        avatarUrl: null,
        description: null,
        currentRoomId: null,
      }),
      db.doc(`adminAuditLog/${generateId()}`).set({
        adminId: req.auth.uid,
        action: 'SUSPEND',
        targetUserId: req.params.uniqueId,
        details: body.reason,
        createdAt: timestamp,
      }),
    ]);

    // Create a suspension warning that sets GCS to 0
    const currentGcs = user.gcsScore ?? user.gcs_score ?? 100;
    if (currentGcs > 0) {
      const warningId = generateId();
      await Promise.all([
        db.doc(`users/${req.params.uniqueId}/warnings/${warningId}`).set({
          reason: `Account suspended: ${body.reason.trim()}`,
          severity: 5,
          gcsDeduction: currentGcs,
          gcsBefore: currentGcs,
          gcsAfter: 0,
          adminNote: null,
          issuedBy: req.auth.uid,
          issuedByName: null,
          source: 'suspension',
          linkedReportId: null,
          revoked: false,
          revokedAt: null,
          revokedBy: null,
          createdAt: timestamp,
        }),
        db.doc(`users/${req.params.uniqueId}`).update({
          gcsScore: 0,
          gcsLastDeductionAt: timestamp,
        }),
      ]);
    }

    // Send system PM about suspension (non-blocking)
    try {
      await sendSystemPm(
        req.params.uniqueId,
        `Your account has been suspended. Reason: ${body.reason.trim()}`,
      );
    } catch (e) {
      log.warn('system-pm', 'Failed to send', { uniqueId: req.params.uniqueId, error: e.message });
    }

    // Auto-apply device and network bans (fire-and-forget)
    autoApplyBans(req.params.uniqueId, body.endDate ? body.endDate : null).catch((err) =>
      log.error('admin-users', 'Failed to auto-apply bans', {
        uniqueId: req.params.uniqueId,
        error: err.message,
      }),
    );

    // Evict from any active rooms (fire-and-forget)
    evictSuspendedUser(req.params.uniqueId).catch((err) =>
      log.error('admin-users', 'Failed to evict suspended user', {
        uniqueId: req.params.uniqueId,
        error: err.message,
      }),
    );

    res.json({ success: true });
  } catch (err) {
    log.error('admin-users', 'Suspend user failed', {
      uniqueId: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Unsuspend user ──
router.post('/user/:uniqueId/unsuspend', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const snap = await db.doc(`users/${req.params.uniqueId}`).get();
    if (!snap.exists) return res.status(404).json({ error: 'User not found' });
    const user = { id: snap.id, ...snap.data() };

    const restore = {};
    const preName = user.preSuspensionDisplayName ?? user.pre_suspension_display_name ?? null;
    const prePhoto =
      user.preSuspensionProfilePhotoUrl ?? user.pre_suspension_profile_photo_url ?? null;
    const preCover = user.preSuspensionCoverPhotoUrl ?? user.pre_suspension_cover_photo_url ?? null;
    if (preName) restore.displayName = preName;
    if (prePhoto) restore.profilePhotoUrl = prePhoto;
    if (preCover) restore.coverPhotoUrl = preCover;

    log.info('admin-users', 'Unsuspending user', {
      adminId: req.auth.uid,
      targetUniqueId: req.params.uniqueId,
    });

    await Promise.all([
      db.doc(`users/${req.params.uniqueId}`).update({
        isSuspended: false,
        suspensionReason: null,
        suspensionStartDate: null,
        suspensionEndDate: null,
        suspensionCanAppeal: null,
        suspendedBy: null,
        preSuspensionDisplayName: null,
        preSuspensionProfilePhotoUrl: null,
        preSuspensionCoverPhotoUrl: null,
        ...restore,
      }),
      db.doc(`adminAuditLog/${generateId()}`).set({
        adminId: req.auth.uid,
        action: 'UNSUSPEND',
        targetUserId: req.params.uniqueId,
        details: null,
        createdAt: now(),
      }),
    ]);

    // Lift auto-applied bans (non-blocking)
    liftAutoAppliedBans(req.params.uniqueId, req.auth.uid).catch((err) =>
      log.error('admin-users', 'Failed to lift auto-applied bans', {
        uniqueId: req.params.uniqueId,
        error: err.message,
      }),
    );

    // Send system PM about unsuspension (non-blocking)
    try {
      await sendSystemPm(req.params.uniqueId, 'Your account suspension has been lifted.');
    } catch (e) {
      log.warn('system-pm', 'Failed to send', { uniqueId: req.params.uniqueId, error: e.message });
    }

    clearSuspensionCache(Number(req.params.uniqueId));
    res.json({ success: true });
  } catch (err) {
    log.error('admin-users', 'Unsuspend user failed', {
      uniqueId: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Report locks by uniqueId ──
router.post('/report-locks/:uniqueId/lock', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    // Look up admin display name for the lock (admin doc keyed by uniqueId)
    const adminSnap = await db.doc(`users/${req.auth.uniqueId}`).get();
    const adminData = adminSnap.exists ? adminSnap.data() : null;
    const displayName = adminData?.displayName ?? adminData?.display_name ?? null;

    await db.doc(`reportLocks/${req.params.uniqueId}`).set({
      reportId: req.params.uniqueId,
      lockedBy: req.auth.uid,
      lockedAt: now(),
      displayName: displayName,
    });

    res.json({ success: true, displayName });
  } catch (err) {
    log.error('admin-users', 'Lock reports failed', {
      uniqueId: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/report-locks/:uniqueId', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    await db.doc(`reportLocks/${req.params.uniqueId}`).delete();

    res.json({ success: true });
  } catch (err) {
    log.error('admin-users', 'Unlock reports failed', {
      uniqueId: req.params.uniqueId,
      error: err.message,
    });
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
async function autoApplyBans(uniqueId, endDate) {
  const timestamp = now();

  // Calculate expiry — match suspension duration or permanent
  let expiresAt = null;
  let duration = 'permanent';
  if (endDate) {
    expiresAt = new Date(endDate).toISOString();
    duration = 'suspension-match';
  }

  // Find all devices bound to this user
  const bindingsSnap = await db
    .collection('deviceBindings')
    .where('uniqueId', '==', uniqueId)
    .get();

  let lastIp = null;
  const batch = db.batch();

  for (const doc of bindingsSnap.docs) {
    const binding = doc.data();

    // Create a device ban for each bound device
    batch.set(db.doc(`deviceBans/${doc.id}`), {
      deviceId: doc.id,
      reason: 'Auto-applied: user suspended',
      duration,
      expiresAt,
      linkedUniqueId: uniqueId,
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
    batch.set(db.doc(`networkBans/${generateId()}`), {
      type: 'ip',
      value: lastIp,
      reason: 'Auto-applied: user suspended',
      duration,
      expiresAt,
      linkedUniqueId: uniqueId,
      autoApplied: true,
      createdAt: timestamp,
      createdBy: 'system',
    });
  }

  await batch.commit();

  const deviceCount = bindingsSnap.docs.length;
  const networkCount = lastIp ? 1 : 0;
  log.info('admin-users', 'Auto-bans applied', {
    uniqueId,
    deviceBans: deviceCount,
    networkBans: networkCount,
  });
}

// ══════════════════════════════════════════════════════════════
// HELPER: Lift auto-applied bans on unsuspension
// ══════════════════════════════════════════════════════════════

/**
 * Remove device and network bans that were auto-applied during suspension.
 * Only removes bans with autoApplied === true and linkedUserId === uid.
 * Manually-applied bans are left untouched.
 */
async function liftAutoAppliedBans(uniqueId, adminUid) {
  const numericId = Number(uniqueId);
  const stringId = String(uniqueId);

  const [deviceSnapStr, deviceSnapNum, networkSnapStr, networkSnapNum] = await Promise.all([
    db
      .collection('deviceBans')
      .where('linkedUniqueId', '==', stringId)
      .where('autoApplied', '==', true)
      .get(),
    db
      .collection('deviceBans')
      .where('linkedUniqueId', '==', numericId)
      .where('autoApplied', '==', true)
      .get(),
    db
      .collection('networkBans')
      .where('linkedUniqueId', '==', stringId)
      .where('autoApplied', '==', true)
      .get(),
    db
      .collection('networkBans')
      .where('linkedUniqueId', '==', numericId)
      .where('autoApplied', '==', true)
      .get(),
  ]);

  // Deduplicate by doc id in case both queries match the same doc
  const seen = new Set();
  const allDocs = [];
  for (const snap of [deviceSnapStr, deviceSnapNum, networkSnapStr, networkSnapNum]) {
    for (const d of snap.docs) {
      if (!seen.has(d.id)) {
        seen.add(d.id);
        allDocs.push(d);
      }
    }
  }
  if (allDocs.length === 0) return;

  await Promise.all(allDocs.map((d) => d.ref.delete()));

  // Audit log
  await db.doc(`adminAuditLog/${generateId()}`).set({
    adminId: adminUid,
    action: 'LIFT_AUTO_BANS',
    targetUserId: uniqueId,
    details: `Removed ${allDocs.length} auto-applied ban(s) on unsuspension`,
    createdAt: now(),
  });

  log.info('admin-users', 'Auto-applied bans lifted', { uniqueId, removed: allDocs.length });
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
  const snapshot = await db
    .collection('rooms')
    .where('participantIds', 'array-contains', uid)
    .get();

  if (snapshot.empty) {
    // Still clear currentRoomId even if no matching rooms found
    await db.doc(`users/${uid}`).update({ currentRoomId: null });
    return;
  }

  const rooms = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

  // Collect all writes then batch in chunks of 500
  const writes = [];

  for (const room of rooms) {
    const participantIds = (room.participantIds || []).filter((id) => id !== uid);

    // Clear any seat occupied by this user
    const seats = room.seats ? { ...room.seats } : {};
    for (const [index, seat] of Object.entries(seats)) {
      if (seat && (seat.userId === uid || seat.user_id === uid)) {
        seats[index] = {
          index: Number.parseInt(index, 10),
          status: 'EMPTY',
          userId: null,
          isMuted: false,
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

// ═══════════════════════════════════════════════════════════════════
// Admin Auth Management (PIN lockout, biometric keys, OTP metrics)
// ═══════════════════════════════════════════════════════════════════

// GET /user/:uniqueId/auth-status — PIN, biometric, lockout state
router.get('/user/:uniqueId/auth-status', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;
    const { uniqueId } = req.params;

    const userDoc = await getDoc(`users/${uniqueId}`);
    if (!userDoc) return res.status(404).json({ error: 'User not found' });

    // Get biometric keys for this user
    const keysSnapshot = await db
      .collection('biometricKeys')
      .where('__name__', '>=', `${uniqueId}:`)
      .where('__name__', '<', `${uniqueId}:\uf8ff`)
      .get();

    const biometricKeys = keysSnapshot.docs.map((doc) => ({
      keyId: doc.id,
      deviceId: doc.id.split(':').slice(1).join(':'),
      createdAt: doc.data().createdAt,
    }));

    res.json({
      pinSet: !!userDoc.pinHash,
      pinSetAt: userDoc.pinSetAt || null,
      pinAttempts: userDoc.pinAttempts || 0,
      pinLockedUntil: userDoc.pinLockedUntil || null,
      pinLockoutCount: userDoc.pinLockoutCount || 0,
      isLocked: userDoc.pinLockedUntil ? Date.now() < userDoc.pinLockedUntil : false,
      biometricKeys,
    });
  } catch (err) {
    log.error('Admin auth-status failed', err);
    res.status(500).json({ error: 'Failed to get auth status' });
  }
});

// POST /user/:uniqueId/reset-pin-lockout — Clear PIN lockout
router.post('/user/:uniqueId/reset-pin-lockout', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;
    const { uniqueId } = req.params;

    await db.doc(`users/${uniqueId}`).update({
      pinAttempts: 0,
      pinLockedUntil: null,
      pinLockoutCount: 0,
    });

    log.info(`Admin reset PIN lockout for user ${uniqueId}`);
    res.json({ message: 'PIN lockout reset' });
  } catch (err) {
    log.error('Admin reset-pin-lockout failed', err);
    res.status(500).json({ error: 'Failed to reset lockout' });
  }
});

// DELETE /user/:uniqueId/biometric-keys/:deviceId — Revoke biometric key
router.delete('/user/:uniqueId/biometric-keys/:deviceId', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;
    const { uniqueId, deviceId } = req.params;

    await db.doc(`biometricKeys/${uniqueId}:${deviceId}`).delete();

    log.info(`Admin revoked biometric key for user ${uniqueId}, device ${deviceId}`);
    res.json({ message: 'Biometric key revoked' });
  } catch (err) {
    log.error('Admin revoke-biometric-key failed', err);
    res.status(500).json({ error: 'Failed to revoke key' });
  }
});

// GET /metrics/otp — Daily OTP email metrics
router.get('/metrics/otp', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const metricsDoc = await db.doc('emailMetrics/daily').get();
    if (!metricsDoc.exists) {
      return res.json({ count: 0, date: null, limit: 100 });
    }

    const data = metricsDoc.data();
    res.json({
      count: data.count || 0,
      date: data.date || null,
      limit: 100,
    });
  } catch (err) {
    log.error('Admin OTP metrics failed', err);
    res.status(500).json({ error: 'Failed to get OTP metrics' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/user/:uniqueId/delete — Admin schedule account deletion
// ═══════════════════════════════════════════════════════════════════

router.post('/user/:uniqueId/delete', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const uniqueId = req.params.uniqueId;
    const { reason } = req.body || {};

    const userSnap = await db.doc(`users/${uniqueId}`).get();
    if (!userSnap.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = userSnap.data();

    if (user.deletionScheduledAt) {
      return res.status(409).json({ error: 'Deletion already scheduled' });
    }

    const configSnap = await db.doc('config/app').get();
    const graceDays = configSnap.exists
      ? configSnap.data().accountDeletionGracePeriodDays || 30
      : 30;

    const timestamp = now();
    const executeAt = timestamp + graceDays * 86400000;

    await db.doc(`users/${uniqueId}`).update({
      deletionScheduledAt: timestamp,
      deletionReason: 'admin',
      deletionExecuteAt: executeAt,
      currentRoomId: null,
    });

    // Revoke refresh tokens
    try {
      await auth.revokeRefreshTokens(user.firebaseUid);
    } catch (revokeErr) {
      log.error('admin-users', 'Failed to revoke refresh tokens', { error: revokeErr.message });
    }

    // Send email notification
    if (user.email) {
      try {
        const deleteDate = new Date(executeAt).toISOString().split('T')[0];
        const template = buildDeletionScheduledEmail(deleteDate);
        await sendEmail(user.email, template.subject, template.html);
      } catch (emailErr) {
        log.error('admin-users', 'Failed to send deletion email', { error: emailErr.message });
      }
    }

    // Send push notification
    if (user.fcmTokens && user.fcmTokens.length > 0) {
      try {
        const deleteDate = new Date(executeAt).toISOString().split('T')[0];
        await sendFcmToTokens(user.fcmTokens, {
          notification: {
            title: 'Account Deletion Scheduled',
            body: `Your account will be deleted on ${deleteDate}. Sign in to cancel.`,
          },
        });
      } catch (fcmErr) {
        log.error('admin-users', 'Failed to send deletion push', { error: fcmErr.message });
      }
    }

    // Audit log
    const sanitizedReason = (reason || '').substring(0, 500).trim();
    await db.doc(`adminAuditLog/${generateId()}`).set({
      action: 'ACCOUNT_DELETION_SCHEDULED',
      adminId: req.auth.uid,
      targetUserId: uniqueId,
      details: sanitizedReason ? `Admin deletion: ${sanitizedReason}` : 'Admin deletion',
      createdAt: timestamp,
    });

    log.info('admin-users', 'Admin scheduled account deletion', {
      uniqueId,
      adminId: req.auth.uid,
    });
    res.json({ success: true, deleteAt: executeAt });
  } catch (err) {
    log.error('admin-users', 'Failed to schedule account deletion', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/user/:uniqueId/cancel-delete — Admin cancel deletion
// ═══════════════════════════════════════════════════════════════════

router.post('/user/:uniqueId/cancel-delete', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const uniqueId = req.params.uniqueId;

    const userSnap = await db.doc(`users/${uniqueId}`).get();
    if (!userSnap.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = userSnap.data();

    if (!user.deletionScheduledAt) {
      return res.status(404).json({ error: 'No deletion scheduled' });
    }

    await db.doc(`users/${uniqueId}`).update({
      deletionScheduledAt: null,
      deletionReason: null,
      deletionExecuteAt: null,
    });

    // Audit log
    await db.doc(`adminAuditLog/${generateId()}`).set({
      action: 'ACCOUNT_DELETION_CANCELLED',
      adminId: req.auth.uid,
      targetUserId: uniqueId,
      createdAt: now(),
    });

    log.info('admin-users', 'Admin cancelled account deletion', {
      uniqueId,
      adminId: req.auth.uid,
    });
    res.json({ success: true });
  } catch (err) {
    log.error('admin-users', 'Failed to cancel account deletion', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
module.exports.createWarning = createWarning;

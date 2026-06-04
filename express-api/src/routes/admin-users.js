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
const { mintClaimsMerging, VALID_COHORTS } = require('../utils/firebase-claims');
const { requireAdmin, clearSuspensionCache, clearAdminClaimCache } = require('../middleware/auth');
const { generateId, now } = require('../utils/helpers');
const { computeDisplayScore } = require('../utils/gcs');
const { sendSystemPm } = require('../utils/system-pm');
const { getDoc } = require('../utils/firestore-helpers');
const log = require('../utils/log');
const { sendEmail } = require('../utils/email');
const { buildDeletionScheduledEmail } = require('../utils/email-templates');
const { sendFcmToTokens } = require('../utils/fcm');

// Length caps for admin-supplied free-form text. Bounded inputs prevent
// a compromised or careless admin from blowing out per-user warning
// subcollections, the global audit log, and system PM bodies — Firestore
// document storage is metered and the dev project is on Spark free tier.
const REASON_MAX_LENGTH = 500;
const ADMIN_NOTE_MAX_LENGTH = 2000;

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
    if (await requireAdmin(req, res)) return;

    const snap = await db.doc(`users/${req.params.uniqueId}`).get();
    if (!snap.exists) return res.status(404).json({ error: 'User not found' });
    const user = normalizeUser({ ...snap.data(), id: snap.id });
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
    if (await requireAdmin(req, res)) return;

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
    if (await requireAdmin(req, res)) return;

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
      let pmSent = 0;
      let pmFailed = 0;
      for (const msg of pmMessages) {
        try {
          await sendSystemPm(uid, msg);
          pmSent++;
        } catch (e) {
          log.warn('system-pm', 'Failed to send', { uid, error: e.message });
          pmFailed++;
        }
      }
      // Surface partial-failure to the admin UI so it can offer "Retry notify".
      // Shape matches partial-failure-toast.js's `pms: { failed, total }`
      // contract — same as reports.js — so the existing
      // PartialFailureToast.buildPartialFailureMessage() can render it
      // without additional handler code.
      res.json({
        success: true,
        updatedFields: Object.keys(updates),
        pms: { failed: pmFailed, total: pmSent + pmFailed },
      });
      return;
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
    if (await requireAdmin(req, res)) return;

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
    if (await requireAdmin(req, res)) return;

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
  const user = { ...snap.data(), id: snap.id };

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

  // Atomic batch instead of Promise.all so a partial commit (warning subcollection
  // doc lands but user-doc update fails — or vice-versa) does NOT leave an
  // orphan warning record. Without atomicity, the admin retry path produces
  // duplicate warnings and the GCS deduction can land twice. Firestore batches
  // are all-or-nothing per chunk and stay under the 500-op limit (we have 3).
  const batch = db.batch();
  batch.set(db.doc(`users/${uniqueId}/warnings/${warningId}`), {
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
  });
  batch.update(db.doc(`users/${uniqueId}`), {
    gcsScore: newGcs,
    gcsLastDeductionAt: timestamp,
    warningCount: newWarningCount,
    warningReason: reason,
    hasActiveWarning: true,
    hasNewWarning: true,
    warningIssuedAt: timestamp,
  });
  batch.set(db.doc(`adminAuditLog/${generateId()}`), {
    adminId: adminUid,
    action: 'WARN',
    targetUserId: uniqueId,
    details: `Severity: ${severity}, GCS: ${gcsScore} → ${newGcs}, Reason: ${reason}, Source: ${source || 'direct'}`,
    createdAt: timestamp,
  });
  await batch.commit();

  return { warningId, newGcs, deduction, warningCount: newWarningCount };
}

// ── Issue warning ──
router.post('/user/:uniqueId/warn', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const body = req.body;
    if (!body?.reason) return res.status(400).json({ error: 'reason is required' });
    if (body.reason.length > REASON_MAX_LENGTH)
      return res.status(400).json({ error: `reason exceeds ${REASON_MAX_LENGTH} chars` });
    if (body.adminNote && body.adminNote.length > ADMIN_NOTE_MAX_LENGTH)
      return res.status(400).json({ error: `adminNote exceeds ${ADMIN_NOTE_MAX_LENGTH} chars` });

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

    // Send system PM to warned user. Track failure so the admin UI knows
    // whether the user was actually informed (`pms: { failed, total }`
    // shape matches partial-failure-toast.js).
    let pmFailed = 0;
    try {
      await sendSystemPm(
        req.params.uniqueId,
        `\u26a0\ufe0f You have received a warning from the moderation team.\n\nReason: ${body.reason}\n\nRepeated violations may result in suspension.`,
      );
    } catch (err) {
      log.error('admin-users', 'Failed to send warning PM', {
        targetUniqueId: req.params.uniqueId,
        error: err.message,
      });
      pmFailed = 1;
    }

    res.json({ success: true, ...result, pms: { failed: pmFailed, total: 1 } });
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
    if (await requireAdmin(req, res)) return;

    const limit = Math.min(Number.parseInt(req.query.limit, 10) || 20, 100);
    const startAfter = req.query.startAfter ? Number.parseInt(req.query.startAfter, 10) : null;

    let query = db.collection(`users/${req.params.uniqueId}/warnings`).orderBy('createdAt', 'desc');

    if (startAfter) {
      query = query.startAfter(startAfter);
    }

    query = query.limit(limit + 1); // fetch one extra to detect "has more"

    const snapshot = await query.get();
    const docs = snapshot.docs.map((d) => ({ ...d.data(), id: d.id }));
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
    if (await requireAdmin(req, res)) return;

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

    // Atomic three-write commit. Pre-fix used Promise.all which is
    // CONCURRENT, not atomic — if the user-doc update failed after
    // the warning was marked revoked, the warning would be stuck in
    // a "revoked" state with GCS NOT restored, and the retry path
    // (line 579 'Warning already revoked' guard) would block the
    // operator from fixing it. Audit H7 (Phase 2A).
    //
    // Pattern matches the warning-CREATION path at line 440 which
    // already uses db.batch() correctly.
    const batch = db.batch();
    batch.update(db.doc(`users/${uniqueId}/warnings/${warningId}`), {
      revoked: true,
      revokedAt: timestamp,
      revokedBy: req.auth.uid,
    });
    batch.update(db.doc(`users/${uniqueId}`), {
      gcsScore: restoredGcs,
      warningCount: Math.max(0, currentCount - 1),
    });
    batch.set(db.doc(`adminAuditLog/${generateId()}`), {
      adminId: req.auth.uid,
      action: 'REVOKE_WARNING',
      targetUserId: uniqueId,
      details: `Revoked warning ${warningId}, restored ${deduction} GCS (${currentGcs} → ${restoredGcs})`,
      createdAt: timestamp,
    });
    await batch.commit();

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
    if (await requireAdmin(req, res)) return;

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
    if (await requireAdmin(req, res)) return;

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

    // If demoting from admin, remove admin claim. Use the merge
    // helper (UK OSA #17 PR 2): pre-fix passed `{ admin: false }`
    // directly, which is a REPLACE that wiped `uniqueId` and the
    // new `cohort` claim along with admin. The merge preserves
    // both — the rules-layer cohort gate would otherwise fall back
    // to 'minor' until the next sign-in's pm-lock-check round-trip.
    if (user.isAdmin) {
      await mintClaimsMerging(firebaseUid, { admin: false });
      // Drop the cached admin-claim entry immediately (Phase 2H finding #2)
      // so the next request from this uid re-fetches the live customClaims
      // and sees the demotion. Without this, the demoted admin keeps
      // privileges for up to ADMIN_CLAIM_TTL (60s).
      clearAdminClaimCache(firebaseUid);
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
// COHORT OVERRIDE + STATS (UK OSA #17 PR 13)
// ══════════════════════════════════════════════════════════════

const COHORT_OVERRIDE_REASON_MAX = 500;

// Target-account gate. The override is the admin's escape hatch for
// staff/MC/test accounts whose recorded DOB is a placeholder or whose
// segregation cohort needs manual pinning. Permitting it on a regular
// MEMBER would let an admin (or a compromised admin session) launder a
// minor account into the adult cohort and so circumvent the OSA gate
// for ordinary users — the very threat segregation is meant to stop.
// The predicate accepts non-MEMBER `userType` OR `isAdmin === true`;
// anything else (including missing/undefined userType) is treated as a
// regular member and rejected with a typed 422.
function isOverrideAllowedTarget(user) {
  if (!user) return false;
  if (user.isAdmin === true) return true;
  const t = user.userType ?? user.user_type;
  return typeof t === 'string' && t.length > 0 && t !== 'MEMBER';
}

router.post('/user/:uniqueId/cohort-override', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const { override, reason } = req.body || {};

    if (override !== null && !VALID_COHORTS.has(override)) {
      return res
        .status(400)
        .json({ error: "Invalid override. Must be 'adult', 'minor', or null." });
    }
    if (typeof reason !== 'string' || reason.trim().length === 0) {
      return res.status(400).json({ error: 'reason is required.' });
    }
    if (reason.length > COHORT_OVERRIDE_REASON_MAX) {
      return res
        .status(400)
        .json({ error: `reason exceeds max length of ${COHORT_OVERRIDE_REASON_MAX}.` });
    }

    const uniqueId = req.params.uniqueId;
    const userRef = db.doc(`users/${uniqueId}`);

    let userFirebaseUid = null;
    let previousOverride = null;
    let effectiveCohortAfter = null;

    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        if (!snap.exists) {
          const err = new Error('User not found');
          err.code = 'NOT_FOUND';
          throw err;
        }
        const user = snap.data();

        if (!isOverrideAllowedTarget(user)) {
          const err = new Error('Cannot override regular user');
          err.code = 'CANNOT_OVERRIDE_REGULAR_USER';
          throw err;
        }

        userFirebaseUid = user.firebaseUid || null;
        previousOverride = user.cohortOverride ?? null;

        if (override !== null) {
          effectiveCohortAfter = override;
        } else if (typeof user.cohort === 'string' && VALID_COHORTS.has(user.cohort)) {
          effectiveCohortAfter = user.cohort;
        } else {
          // Fail-closed to the most restrictive cohort when DOB-derived
          // cohort is also missing/invalid; the next pm-lock-check sign-in
          // will recompute correctly from DOB.
          effectiveCohortAfter = 'minor';
        }

        // Same-transaction commit: field update + audit row. If the audit
        // write throws, the field update is rolled back by the Firestore
        // transaction — the regulatory contract that every override has a
        // paper trail before it becomes observable. Both rows share the
        // same `ts` so an auditor can join the user-doc update timestamp
        // to the audit-log row's createdAt exactly (review I2).
        const ts = now();
        tx.update(userRef, {
          cohortOverride: override === null ? FieldValue.delete() : override,
          cohortOverrideUpdatedAt: ts,
        });
        tx.set(db.doc(`adminAuditLog/${generateId()}`), {
          adminId: req.auth.uid,
          action: override === null ? 'COHORT_OVERRIDE_CLEAR' : 'COHORT_OVERRIDE_SET',
          targetUserId: uniqueId,
          override,
          previousOverride,
          reason: reason.trim(),
          createdAt: ts,
        });
      });
    } catch (err) {
      if (err && err.code === 'NOT_FOUND') {
        return res.status(404).json({ error: 'User not found' });
      }
      if (err && err.code === 'CANNOT_OVERRIDE_REGULAR_USER') {
        return res.status(422).json({
          error: {
            code: 'CANNOT_OVERRIDE_REGULAR_USER',
            message: 'Cohort override can only be applied to staff or admin accounts.',
          },
        });
      }
      throw err;
    }

    // Claim mint runs AFTER the transaction. A failure here is
    // recoverable: the override is in the user doc, the next sign-in's
    // pm-lock-check will re-mint the claim with the right cohort. We
    // surface the failure as `forceTokenRefresh: false` so the admin UI
    // can show a partial-failure banner instead of misleading the
    // operator into thinking the user is already on the new cohort.
    let forceTokenRefresh = false;
    if (userFirebaseUid) {
      try {
        await mintClaimsMerging(userFirebaseUid, { cohort: effectiveCohortAfter });
        forceTokenRefresh = true;
      } catch (mintErr) {
        // Real mint failure — Firebase Auth side rejected the claim update.
        // Distinct `reason: 'mint_error'` so SIEM rules can page on this without
        // also firing on the benign `unbackfilled` path below.
        log.warn('admin-users', 'cohort-override claim mint failed', {
          uniqueId,
          reason: 'mint_error',
          error: mintErr.message,
        });
      }
    } else {
      // Legitimately possible: a user doc created before the firebaseUid
      // backfill won't have the field. The override doc-write succeeded;
      // the user will pick up the new cohort claim on their next sign-in's
      // pm-lock-check call. Logged at WARN so ops can see the rate of
      // unbackfilled users hitting this path (review C1), but with a
      // distinct `reason: 'unbackfilled'` discriminator so SIEM rules
      // can differentiate this expected condition from a real mint failure.
      log.warn('admin-users', 'cohort-override skipped claim mint (missing firebaseUid)', {
        uniqueId,
        reason: 'unbackfilled',
      });
    }

    log.info('admin-users', 'cohortOverride set', {
      adminId: req.auth.uid,
      targetUniqueId: uniqueId,
      override,
      previousOverride,
    });

    return res.json({
      success: true,
      forceTokenRefresh,
      effectiveCohort: effectiveCohortAfter,
    });
  } catch (err) {
    log.error('admin-users', 'cohort-override failed', {
      uniqueId: req.params.uniqueId,
      error: err.message,
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Aggregated cohort distribution for the admin panel dashboard.
// Uses count() aggregation queries so Firestore read cost is flat (one
// billable read per aggregation, regardless of user-collection size).
router.get('/admin/cohort-stats', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const users = db.collection('users');
    const [adultSnap, minorSnap, ovAdultSnap, ovMinorSnap, totalSnap] = await Promise.all([
      users.where('cohort', '==', 'adult').count().get(),
      users.where('cohort', '==', 'minor').count().get(),
      users.where('cohortOverride', '==', 'adult').count().get(),
      users.where('cohortOverride', '==', 'minor').count().get(),
      users.count().get(),
    ]);

    const adult = adultSnap.data().count || 0;
    const minor = minorSnap.data().count || 0;
    const overrideAdult = ovAdultSnap.data().count || 0;
    const overrideMinor = ovMinorSnap.data().count || 0;
    const total = totalSnap.data().count || 0;
    // Defence against transient data drift where the count-by-cohort
    // queries see a different sub-set than the total count (e.g. a doc
    // briefly without a cohort field). Clamp to >= 0 so the admin UI
    // never renders a negative "missing" count.
    const missing = Math.max(0, total - adult - minor);

    return res.json({
      counts: { adult, minor, overrideAdult, overrideMinor, total, missing },
    });
  } catch (err) {
    log.error('admin-users', 'cohort-stats failed', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ══════════════════════════════════════════════════════════════
// ADMIN VIEW CONVERSATION MESSAGES
// ══════════════════════════════════════════════════════════════

router.get('/conversations/:id/messages', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const messageLimit = Math.min(Number.parseInt(req.query.limit, 10) || 50, 200);

    const snapshot = await db
      .collection(`conversations/${req.params.id}/messages`)
      .orderBy('createdAt', 'desc')
      .limit(messageLimit)
      .get();

    const messages = snapshot.docs.map((d) => ({ ...d.data(), id: d.id }));

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
    if (await requireAdmin(req, res)) return;

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
      const user = normalizeUser({ ...doc.data(), id: doc.id });
      await backfillAuthInfo(user, doc.id, user.uid || doc.id);
      return res.json(user);
    }

    const doc = snapshot.docs[0];
    const user = normalizeUser({ ...doc.data(), id: doc.id });
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
    if (await requireAdmin(req, res)) return;

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
    if (await requireAdmin(req, res)) return;

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
    if (await requireAdmin(req, res)) return;

    const body = req.body;
    if (!body?.reason) return res.status(400).json({ error: 'reason is required' });
    if (body.reason.length > REASON_MAX_LENGTH)
      return res.status(400).json({ error: `reason exceeds ${REASON_MAX_LENGTH} chars` });
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
    const user = { ...snap.data(), id: snap.id };

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

    // Phase 2H finding #1: invalidate the 5-min checkSuspension cache so
    // the just-suspended user can't keep making API calls during the
    // active-moderation window. See clearSuspensionCache JSDoc for full
    // rationale; mirrored at every other suspend site (reports.js,
    // identity-graph.js).
    clearSuspensionCache(Number(req.params.uniqueId));

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

    // Send system PM about suspension. Track failure so the admin UI knows
    // whether the user was actually informed — a suspension where the user
    // never got the notification is a UX failure even though the suspension
    // itself succeeded.
    let pmFailed = false;
    try {
      await sendSystemPm(
        req.params.uniqueId,
        `Your account has been suspended. Reason: ${body.reason.trim()}`,
      );
    } catch (e) {
      log.warn('system-pm', 'Failed to send', { uniqueId: req.params.uniqueId, error: e.message });
      pmFailed = true;
    }

    // Auto-apply device and network bans (fire-and-forget)
    autoApplyBans(req.params.uniqueId, body.endDate ? body.endDate : null).catch((err) =>
      log.error('admin-users', 'Failed to auto-apply bans', {
        uniqueId: req.params.uniqueId,
        error: err.message,
      }),
    );

    // Evict from any active rooms. Awaited (was fire-and-forget) so a partial
    // cascade is reflected in the admin response — without this, a chunk failure
    // mid-cascade left rooms in mixed state with the admin shown success.
    // cascade is unconditionally assigned below; earlier iterations had a
    // fire-and-forget default that's now dead (Pass-19 cleanup).
    let cascade;
    try {
      cascade = await evictSuspendedUser(req.params.uniqueId);
    } catch (err) {
      log.error('admin-users', 'Failed to evict suspended user', {
        uniqueId: req.params.uniqueId,
        error: err.message,
      });
      // 'cascade_failed' is the same token MOD_ERROR.CASCADE_FAILED in reports.js
      // exports; admin-users.js doesn't import that registry to avoid a circular
      // dep, but the wire format is identical.
      cascade = buildCascadeFailure(err, 'cascade_failed');
    }

    // Suggestion cascade is independent of room cascade — partial failure of one
    // must not skip the other. Awaited (not fire-and-forget) so admin response
    // reflects whether the flagging actually committed.
    let suggestionsCascade;
    try {
      suggestionsCascade = await flagSuspendedUserSuggestions(req.params.uniqueId, req.auth.uid);
    } catch (err) {
      log.error('admin-users', 'Failed to flag suspended user suggestions', {
        uniqueId: req.params.uniqueId,
        error: err.message,
      });
      suggestionsCascade = {
        flaggedCount: 0,
        skippedCount: 0,
        partial: true,
        failedSuggestionIds: [],
        error: err && err.message ? err.message : 'cascade_failed',
      };
    }

    // pms shape matches partial-failure-toast.js (failed, total). Single PM
    // for the suspension reason; either delivered or not.
    res.json({
      success: true,
      cascade,
      suggestionsCascade,
      pms: { failed: pmFailed ? 1 : 0, total: 1 },
    });
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
    if (await requireAdmin(req, res)) return;

    const snap = await db.doc(`users/${req.params.uniqueId}`).get();
    if (!snap.exists) return res.status(404).json({ error: 'User not found' });
    const user = { ...snap.data(), id: snap.id };

    // Idempotency guard: skip the write + PM + audit log + ban-lift
    // when the user is already unsuspended. Without this, defensive
    // `beforeAll` hooks in tests (admin-keyboard.spec.ts,
    // admin-users-moderation.spec.ts) that call unsuspend
    // belt-and-braces fire a spurious "Your suspension has been
    // lifted" PM, write a phantom UNSUSPEND audit log entry, and
    // unnecessarily call liftAutoAppliedBans on every clean run.
    // In production this also suppresses double-clicks from an admin
    // unsuspending a user whose timed suspension already expired.
    if (!user.isSuspended) {
      return res.json({ success: true, alreadyUnsuspended: true });
    }

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

    // Reverse the suggestion ban-cascade: clear `flaggedForReview` on suggestions
    // whose flag was set by the matching suspension. Only `submitter_suspended`
    // flags are cleared — unrelated manual admin flags (different reason) are
    // preserved. Awaited so the admin response reports partial failures.
    let suggestionsCascade;
    try {
      suggestionsCascade = await unflagUnsuspendedUserSuggestions(req.params.uniqueId);
    } catch (err) {
      log.error('admin-users', 'Failed to unflag suspended user suggestions', {
        uniqueId: req.params.uniqueId,
        error: err.message,
      });
      suggestionsCascade = {
        unflaggedCount: 0,
        skippedCount: 0,
        partial: true,
        failedSuggestionIds: [],
        error: err && err.message ? err.message : 'cascade_failed',
      };
    }

    // Send system PM about unsuspension — track failure so admin UI can
    // surface that the user wasn't informed about being unsuspended.
    let pmFailed = false;
    try {
      await sendSystemPm(req.params.uniqueId, 'Your account suspension has been lifted.');
    } catch (e) {
      log.warn('system-pm', 'Failed to send', { uniqueId: req.params.uniqueId, error: e.message });
      pmFailed = true;
    }

    clearSuspensionCache(Number(req.params.uniqueId));
    res.json({
      success: true,
      suggestionsCascade,
      pms: { failed: pmFailed ? 1 : 0, total: 1 },
    });
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
    if (await requireAdmin(req, res)) return;

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
    if (await requireAdmin(req, res)) return;

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

// evictSuspendedUser is exported from utils so reports.js + admin-users.js share
// one canonical implementation. See utils/evict-suspended-user.js for behaviour.
// buildCascadeFailure unifies the on-wire cascade contract across all 4 sites
// (Pass-17: previously two literals omitted rtdbEventsFailed and used a stale
// 'cascade_failed' string token, drifting from the resolve routes).
const { evictSuspendedUser, buildCascadeFailure } = require('../utils/evict-suspended-user');

// Ban-cascade for the suggestions surface: a suspended user's live (accepted/planned)
// suggestions get a `flaggedForReview` sticky note so an admin can decide case-by-case
// whether they stay on the roadmap. Status is preserved, so unsuspend cleanly reverses
// by clearing the flag fields. See utils/flag-suspended-user-suggestions.js for design.
const {
  flagSuspendedUserSuggestions,
  unflagUnsuspendedUserSuggestions,
} = require('../utils/flag-suspended-user-suggestions');

// ═══════════════════════════════════════════════════════════════════
// Admin Auth Management (PIN lockout, biometric keys, OTP metrics)
// ═══════════════════════════════════════════════════════════════════

// GET /user/:uniqueId/auth-status — PIN, biometric, lockout state
router.get('/user/:uniqueId/auth-status', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;
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
    if (await requireAdmin(req, res)) return;
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
    if (await requireAdmin(req, res)) return;
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
    if (await requireAdmin(req, res)) return;

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
    if (await requireAdmin(req, res)) return;

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
    if (await requireAdmin(req, res)) return;

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

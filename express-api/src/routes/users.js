/**
 * User routes — identity-based profile CRUD, sign-in, provider linking.
 *
 * POST   /api/users                          → Create new user (identity + uniqueId)
 * POST   /api/users/sign-in                  → Resolve identity, update firebaseUid
 * GET    /api/users/:uniqueId                → Get user profile
 * PATCH  /api/users/:uniqueId                → Update user profile fields
 * POST   /api/users/:uniqueId/link-provider  → Link additional provider
 * DELETE /api/users/:uniqueId/link-provider  → Soft-remove (unlink) provider
 * POST   /api/users/:uniqueId/appeal         → Submit suspension appeal
 * POST   /api/users/:uniqueId/lift-suspension→ Lift expired suspension
 * POST   /api/users/:uniqueId/follow         → Follow a user
 * POST   /api/users/:uniqueId/unfollow       → Unfollow a user
 * POST   /api/users/:uniqueId/remove-follower→ Remove a follower
 * POST   /api/users/:uniqueId/record-visit   → Record profile visit (stalker)
 * POST   /api/users/:uniqueId/delete         → Schedule account deletion (owner)
 * POST   /api/users/:uniqueId/cancel-delete  → Cancel scheduled deletion (owner)
 * GET    /api/users/:uniqueId/deletion-status → Check deletion status (owner)
 */

const router = require('express').Router();
const bcrypt = require('bcrypt');
const { db, auth, FieldValue } = require('../utils/firebase');
const { generateId, now } = require('../utils/helpers');
const { getDoc } = require('../utils/firestore-helpers');
const log = require('../utils/log');
const { clearSuspensionCache, updateUniqueIdCache } = require('../middleware/auth');
const { sendEmail } = require('../utils/email');
const { buildDeletionScheduledEmail } = require('../utils/email-templates');
const { sendFcmToTokens } = require('../utils/fcm');
const { viewerIsBlocked } = require('../utils/block-check');
const { mintClaimsMerging, deriveCohortFromUser } = require('../utils/firebase-claims');

const VALID_PROVIDERS = ['google', 'apple', 'email'];
const MIN_UNIQUE_ID = 10000000;
const MAX_IDENTIFIERS_PER_PROVIDER = 5;

// ─── Helper: ownership check ────────────────────────────────────

function requireOwner(req, res) {
  // Audit L1 (Phase 2A): explicit NaN guard. Without this, a non-
  // numeric :uniqueId param produces NaN from Number(), and the
  // comparison `req.auth.uniqueId !== NaN` is always true (NaN
  // is unequal to everything including itself), so the route fails
  // closed (403) — safe but obscure. Returning a clearer 400 makes
  // a malformed-route-param the visible failure mode rather than
  // a misleading 'Cannot modify another user'.
  const paramId = Number(req.params.uniqueId);
  if (!Number.isInteger(paramId)) {
    res.status(400).json({ error: 'uniqueId must be a positive integer' });
    return true; // blocked
  }
  if (req.auth.uniqueId !== paramId) {
    res.status(403).json({ error: 'Cannot modify another user' });
    return true; // blocked
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════
// POST /api/users — Create new user with identity map
// ═══════════════════════════════════════════════════════════════════

router.post('/users', async (req, res) => {
  try {
    const { provider, identifier, displayName, email, profilePhotoUrl, dateOfBirth, language } =
      req.body || {};

    if (!provider) return res.status(400).json({ error: 'provider required' });
    if (!identifier) return res.status(400).json({ error: 'identifier required' });
    if (!VALID_PROVIDERS.includes(provider)) {
      return res
        .status(400)
        .json({ error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}` });
    }

    // Server-side age validation. Floor bumped 13 → 16 on 2026-05-03 for
    // Apple App Store content-guideline compliance — see
    // `.project/plans/2026-05-03-age-verification.md`. The 16-17 cohort
    // signs up but cannot use 18+ gated features (private messages,
    // gacha) until they age in or complete ID verification.
    if (!dateOfBirth) {
      return res.status(400).json({ error: 'Date of birth is required' });
    }
    const dob = new Date(dateOfBirth);
    if (Number.isNaN(dob.getTime())) {
      return res.status(400).json({ error: 'Invalid date of birth format' });
    }
    // Calendar-year age computation. Pre-fix used (Date.now() - dob)
    // / year-in-ms which produces wrong values around leap years
    // (Feb 29 birthdays return 15.99... years for ~5 days after the
    // 16th birthday) AND can be off-by-one near year boundaries due
    // to UTC offset handling. Audit H1 (Phase 2A): regulatory issue
    // (COPPA, GDPR, Apple age gate require accurate age).
    //
    // Correct algorithm: yearDiff, then subtract 1 if today's
    // month/day is BEFORE the birth month/day (haven't had this
    // year's birthday yet).
    const today = new Date();
    let age = today.getUTCFullYear() - dob.getUTCFullYear();
    const monthDiff = today.getUTCMonth() - dob.getUTCMonth();
    const dayDiff = today.getUTCDate() - dob.getUTCDate();
    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
      age -= 1;
    }
    // Minimum sign-up age bumped 13 → 16 on 2026-05-03 for Apple App
    // Store content-guideline compliance — see
    // `.project/plans/2026-05-03-age-verification.md`. The 16-17 cohort
    // can still create accounts but cannot use 18+ gated features
    // (private messages, gacha) until they age into them OR complete
    // ID-based age verification (handled in later PRs of this plan).
    if (age < 16) {
      log.warn('users', 'Age validation rejected', { dateOfBirth });
      return res.status(403).json({ error: 'Must be at least 16 years old' });
    }

    const identityDocId = `${provider}:${identifier}`;
    const counterRef = db.doc('counters/uniqueId');
    const identityRef = db.doc(`identityMap/${identityDocId}`);

    const newUniqueId = await db.runTransaction(async (t) => {
      // All reads first (Firestore transaction requirement)
      const counterSnap = await t.get(counterRef);
      const identitySnap = await t.get(identityRef);

      // Check identity not already claimed
      if (identitySnap.exists) {
        const identityData = identitySnap.data();
        if (identityData.unlinked) {
          // Deleted accounts: allow clean re-registration, block suspended
          if (identityData.deletedAccount && identityData.deletionStanding === 'clean') {
            // Clean deletion — allow re-registration with new uniqueId
            // The old identity map entry will be replaced below
          } else {
            throw Object.assign(new Error('Identity deactivated'), { code: 'DEACTIVATED' });
          }
        } else {
          throw Object.assign(new Error('Identity already linked'), { code: 'ALREADY_LINKED' });
        }
      }

      // Atomic counter increment
      let current = counterSnap.exists ? counterSnap.data().value || 0 : 0;
      if (current < MIN_UNIQUE_ID) current = MIN_UNIQUE_ID - 1;
      const next = current + 1;

      const timestamp = now();

      // Write counter
      t.set(counterRef, { value: next }, { merge: true });

      // Write user doc
      t.set(db.doc(`users/${next}`), {
        uniqueId: next,
        firebaseUid: req.auth.uid,
        displayName: displayName || null,
        email: email || null,
        profilePhotoUrl: profilePhotoUrl || null,
        dateOfBirth: dateOfBirth || null,
        providers: [{ type: provider, identifier, active: true, linkedAt: timestamp }],
        userType: 'MEMBER',
        blockedUserIds: [],
        followingIds: [],
        followerIds: [],
        fcmTokens: [],
        aliases: {},
        language: language || 'en',
        stalkerCount: 0,
        newStalkerCount: 0,
        // Age verification (Apple App Store 18+ enforcement on PMs +
        // gacha). New users start unverified; admin approves a manual
        // ID review to flip to verified. See age-verification PR plan.
        ageVerified: false,
        ageVerifiedAt: null,
        ageVerificationMethod: null,
        createdAt: timestamp,
        lastSeenAt: timestamp,
      });

      // Write identity map entry
      t.set(db.doc(`identityMap/${identityDocId}`), {
        uniqueId: next,
        provider,
        identifier,
        linkedAt: timestamp,
        unlinked: false,
        unlinkedAt: null,
      });

      return next;
    });

    // Set Firebase custom claims so Firestore security rules can use
    // callerUniqueId() AND the UK OSA #17 cohort gate. `age` was
    // computed above from the validated DOB — cohort follows the
    // same `>=18y` predicate as pmLocked. `skipFetch: true` because
    // signup creates a brand-new Firebase Auth record with no
    // existing claims; the getUser round-trip would be wasted work
    // on the signup critical path.
    const signupCohort = age >= 18 ? 'adult' : 'minor';
    await mintClaimsMerging(
      req.auth.uid,
      { uniqueId: newUniqueId, cohort: signupCohort },
      { skipFetch: true },
    );

    // Update uid → uniqueId cache so subsequent requests resolve instantly
    updateUniqueIdCache(req.auth.uid, newUniqueId);

    log.info('users', 'New user created', { uniqueId: newUniqueId, provider });
    res.json({ success: true, created: true, uniqueId: newUniqueId });
  } catch (err) {
    if (err.code === 'ALREADY_LINKED') {
      return res.status(409).json({ error: 'Identity already linked to an account' });
    }
    if (err.code === 'DEACTIVATED') {
      return res
        .status(409)
        .json({ error: 'This identity has been deactivated. Contact support for assistance.' });
    }
    log.error('users', 'POST /users failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/users/sign-in — Identity resolution + firebaseUid update
// ═══════════════════════════════════════════════════════════════════

router.post('/users/sign-in', async (req, res) => {
  try {
    const { provider, identifier } = req.body || {};

    if (!provider) return res.status(400).json({ error: 'provider required' });
    if (!identifier) return res.status(400).json({ error: 'identifier required' });

    const identityDocId = `${provider}:${identifier}`;
    const identity = await getDoc(`identityMap/${identityDocId}`);

    if (!identity) {
      return res.json({ found: false });
    }

    if (identity.unlinked) {
      return res.json({ found: false, deactivated: true });
    }

    const uniqueId = identity.uniqueId;

    // Suspension check BEFORE updating firebaseUid + custom claims.
    // Audit M5 (Phase 2A): pre-fix signed in suspended users (updated
    // their UID and granted custom claims) before the auth-middleware
    // suspension check ran. The suspension cache had a 5-min TTL —
    // brief window where suspended users could perform writes.
    //
    // Now: read the user doc, check isSuspended, return found+suspended
    // WITHOUT mutating Firebase state. Client surfaces the suspension
    // to the user; no UID refresh, no custom claim grant.
    const userSnap = await db.doc(`users/${uniqueId}`).get();
    let userData = null;
    if (userSnap.exists) {
      userData = userSnap.data();
      const isSuspended = userData.isSuspended ?? userData.is_suspended ?? false;
      if (isSuspended) {
        log.warn('users', 'Sign-in attempt by suspended user', { uniqueId, provider });
        return res.json({
          found: true,
          suspended: true,
          uniqueId,
        });
      }
    }

    // Update firebaseUid to current project's UID + refresh lastSeenAt
    await db.doc(`users/${uniqueId}`).update({
      firebaseUid: req.auth.uid,
      lastSeenAt: now(),
    });

    // Mint custom claims (UK OSA #17 PR 2). Goes through the merge
    // helper because the user may already have other claims
    // (`admin: true` for moderators) we must preserve. Cohort is
    // resolved via `deriveCohortFromUser` (NOT `effectiveCohort`):
    // we re-derive from `dateOfBirth` rather than trusting the
    // cached `cohort` field. Defends against the narrow window
    // where admin DOB-modified the user but pm-lock-check hasn't
    // run yet — the cached field would lie. Override (allow-listed)
    // still wins; falls back to `'minor'` for legacy/missing DOB.
    await mintClaimsMerging(req.auth.uid, {
      uniqueId,
      cohort: deriveCohortFromUser(userData),
    });

    // Update caches
    updateUniqueIdCache(req.auth.uid, uniqueId);

    log.info('users', 'User signed in via identity', { uniqueId, provider });
    res.json({ found: true, uniqueId });
  } catch (err) {
    log.error('users', 'POST /users/sign-in failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/users/:uniqueId — Get user profile
// ═══════════════════════════════════════════════════════════════════

router.get('/users/:uniqueId', async (req, res) => {
  try {
    const user = await getDoc(`users/${req.params.uniqueId}`);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // C7 (block-list integrity): the target user must not be visible
    // to a viewer they have blocked. Returns 403 — the client already
    // handles 403 from interaction endpoints (gift-send) the same way.
    // Allowed exception: the user looking at their own profile.
    if (
      String(req.auth.uniqueId) !== String(req.params.uniqueId) &&
      viewerIsBlocked(req.auth.uniqueId, user)
    ) {
      return res.status(403).json({ error: 'Cannot view content of users who have blocked you' });
    }

    user.blockedUserIds = user.blockedUserIds || [];
    user.followingIds = user.followingIds || [];
    user.followerIds = user.followerIds || [];

    // Strip admin-only fields
    delete user.gcsScore;
    delete user.gcsLastDeductionAt;
    delete user.gcsDisplayScore;
    delete user.warningCount;
    delete user.warningIssuedAt;
    delete user.hasNewWarning;

    // Strip sensitive / PII fields
    delete user.pinHash;
    delete user.fcmTokens;
    delete user.firebaseUid;
    delete user.email;
    delete user.dateOfBirth;

    // Strip deletion fields (only visible to owner via /deletion-status)
    delete user.deletionScheduledAt;
    delete user.deletionReason;
    delete user.deletionExecuteAt;
    if (Array.isArray(user.providers)) {
      user.providers = user.providers.map(({ identifier: _identifier, ...rest }) => rest);
    }

    res.json(user);
  } catch (err) {
    log.error('users', 'GET /users/:uniqueId failed', {
      uniqueId: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Profile update validation ─────────────────────────────────

const PROFILE_STRING_FIELDS = [
  'displayName',
  'description',
  'nationality',
  'profilePhotoUrl',
  'coverPhotoUrl',
  'pmPrivacy',
  'currentRoomId',
  'lastRoomName',
  'language',
];
const PROFILE_MAX_LENGTHS = {
  displayName: 20,
  description: 200,
  nationality: 3,
  language: 10,
  lastRoomName: 50,
};
const PROFILE_BOOL_FIELDS = [
  'pmNotificationsEnabled',
  'pmSoundEnabled',
  'pmShowTimestamps',
  'pmShowDateSeparators',
  'pmNotificationPreview',
  'hideFollowing',
  'hideOnlineStatus',
  'hideAge',
  'selfDestructAlertEnabled',
  'dndEnabled',
];
const PROFILE_INT_FIELDS = [
  'dndStartHour',
  'dndStartMinute',
  'dndEndHour',
  'dndEndMinute',
  'minGiftAnimationValue',
  'acceptedLegalVersion',
];

/** Validate profile update field types and constraints. Returns error string or null. */
function validateProfileUpdates(updates) {
  for (const key of PROFILE_STRING_FIELDS) {
    if (key in updates && updates[key] !== null && typeof updates[key] !== 'string') {
      return `${key} must be a string`;
    }
    if (
      key in updates &&
      typeof updates[key] === 'string' &&
      PROFILE_MAX_LENGTHS[key] &&
      updates[key].length > PROFILE_MAX_LENGTHS[key]
    ) {
      return `${key} exceeds max length of ${PROFILE_MAX_LENGTHS[key]}`;
    }
  }
  for (const key of PROFILE_BOOL_FIELDS) {
    if (key in updates && typeof updates[key] !== 'boolean') return `${key} must be a boolean`;
  }
  for (const key of PROFILE_INT_FIELDS) {
    if (key in updates && (typeof updates[key] !== 'number' || !Number.isInteger(updates[key])))
      return `${key} must be an integer`;
  }
  for (const key of ['dndStartHour', 'dndEndHour']) {
    if (key in updates && (updates[key] < 0 || updates[key] > 23))
      return `${key} must be between 0 and 23`;
  }
  for (const key of ['dndStartMinute', 'dndEndMinute']) {
    if (key in updates && (updates[key] < 0 || updates[key] > 59))
      return `${key} must be between 0 and 59`;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// PATCH /api/users/:uniqueId — Update user profile
// ═══════════════════════════════════════════════════════════════════

router.patch('/users/:uniqueId', async (req, res) => {
  try {
    if (requireOwner(req, res)) return;

    const body = req.body;
    if (!body) return res.status(400).json({ error: 'Invalid JSON body' });

    const allowedFields = [
      'displayName',
      'description',
      'nationality',
      'profilePhotoUrl',
      'coverPhotoUrl',
      'pmPrivacy',
      'pmNotificationsEnabled',
      'pmSoundEnabled',
      'pmShowTimestamps',
      'pmShowDateSeparators',
      'pmNotificationPreview',
      'hideFollowing',
      'hideOnlineStatus',
      'hideAge',
      'selfDestructAlertEnabled',
      'minGiftAnimationValue',
      'dndEnabled',
      'dndStartHour',
      'dndStartMinute',
      'dndEndHour',
      'dndEndMinute',
      'acceptedLegalVersion',
      'currentRoomId',
      'lastRoomName',
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
    const validationError = validateProfileUpdates(updates);
    if (validationError) return res.status(400).json({ error: validationError });

    // GDPR consent audit trail — store acceptance timestamp
    if (updates.acceptedLegalVersion !== undefined) {
      updates.legalAcceptedAt = Date.now();
    }

    log.info('users', 'Updating profile', {
      uniqueId: req.params.uniqueId,
      fields: Object.keys(updates),
    });
    await db.doc(`users/${req.params.uniqueId}`).update(updates);

    res.json({ success: true });
  } catch (err) {
    log.error('users', 'PATCH /users/:uniqueId failed', {
      uniqueId: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/users/:uniqueId/link-provider — Link additional provider
// ═══════════════════════════════════════════════════════════════════

router.post('/users/:uniqueId/link-provider', async (req, res) => {
  try {
    if (requireOwner(req, res)) return;

    const { provider, identifier } = req.body || {};
    if (!provider) return res.status(400).json({ error: 'provider required' });
    if (!identifier) return res.status(400).json({ error: 'identifier required' });
    if (!VALID_PROVIDERS.includes(provider)) {
      return res
        .status(400)
        .json({ error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}` });
    }

    const uniqueId = Number(req.params.uniqueId);
    const identityDocId = `${provider}:${identifier}`;

    // Load user doc + identity map entry in parallel
    const [user, existingIdentity] = await Promise.all([
      getDoc(`users/${uniqueId}`),
      getDoc(`identityMap/${identityDocId}`),
    ]);

    if (!user) return res.status(404).json({ error: 'User not found' });

    // Check if identity is already claimed
    if (existingIdentity && existingIdentity.uniqueId !== uniqueId) {
      return res.status(409).json({ error: 'This identity is already linked to another account' });
    }

    if (existingIdentity && existingIdentity.unlinked) {
      // Re-linking own deactivated identity
      const timestamp = now();
      await db
        .doc(`identityMap/${identityDocId}`)
        .update({ unlinked: false, unlinkedAt: null, linkedAt: timestamp });

      const providers = (user.providers || []).map((p) =>
        p.type === provider && p.identifier === identifier
          ? { ...p, active: true, linkedAt: timestamp, unlinkedAt: undefined }
          : p,
      );
      await db.doc(`users/${uniqueId}`).update({ providers });

      log.info('users', 'Provider re-linked', {
        uniqueId,
        provider,
        identifier: identifier.includes('@') ? `***@${identifier.split('@')[1]}` : '***',
      });
      return res.json({ success: true, relinked: true });
    }

    if (existingIdentity) {
      // Already active — no-op
      return res.json({ success: true, alreadyLinked: true });
    }

    // Check provider count limit
    const existingOfType = (user.providers || []).filter((p) => p.type === provider && p.active);
    if (existingOfType.length >= MAX_IDENTIFIERS_PER_PROVIDER) {
      return res
        .status(409)
        .json({ error: 'Unable to link this account. Please contact support for assistance.' });
    }

    const timestamp = now();

    // Create identity map entry
    await db.doc(`identityMap/${identityDocId}`).set({
      uniqueId,
      provider,
      identifier,
      linkedAt: timestamp,
      unlinked: false,
      unlinkedAt: null,
    });

    // Update providers array
    const providers = [
      ...(user.providers || []),
      { type: provider, identifier, active: true, linkedAt: timestamp },
    ];
    await db.doc(`users/${uniqueId}`).update({ providers });

    log.info('users', 'Provider linked', {
      uniqueId,
      provider,
      identifier: identifier.includes('@') ? `***@${identifier.split('@')[1]}` : '***',
    });
    res.json({ success: true });
  } catch (err) {
    log.error('users', 'Link provider failed', {
      uniqueId: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// DELETE /api/users/:uniqueId/link-provider — Soft-remove provider
// ═══════════════════════════════════════════════════════════════════

router.delete('/users/:uniqueId/link-provider', async (req, res) => {
  try {
    if (requireOwner(req, res)) return;

    const { provider, identifier } = req.body || {};
    if (!provider) return res.status(400).json({ error: 'provider required' });
    if (!identifier) return res.status(400).json({ error: 'identifier required' });

    const uniqueId = Number(req.params.uniqueId);
    const identityDocId = `${provider}:${identifier}`;

    // Load user doc + identity map entry
    const [user, identity] = await Promise.all([
      getDoc(`users/${uniqueId}`),
      getDoc(`identityMap/${identityDocId}`),
    ]);

    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!identity) return res.status(404).json({ error: 'Identity not found' });

    // Verify identity belongs to this user
    if (identity.uniqueId !== uniqueId) {
      return res.status(403).json({ error: 'Identity does not belong to this user' });
    }

    // Check at least 2 active providers remain
    const activeProviders = (user.providers || []).filter((p) => p.active);
    if (activeProviders.length < 2) {
      return res.status(400).json({
        error: 'Cannot unlink your only active provider. At least one provider must remain linked.',
      });
    }

    const timestamp = now();

    // Soft-remove identity map entry
    await db.doc(`identityMap/${identityDocId}`).update({
      unlinked: true,
      unlinkedAt: timestamp,
    });

    // Update providers array — set active=false + unlinkedAt
    const providers = (user.providers || []).map((p) =>
      p.type === provider && p.identifier === identifier
        ? { ...p, active: false, unlinkedAt: timestamp }
        : p,
    );
    await db.doc(`users/${uniqueId}`).update({ providers });

    log.info('users', 'Provider unlinked', {
      uniqueId,
      provider,
      identifier: identifier.includes('@') ? `***@${identifier.split('@')[1]}` : '***',
    });
    res.json({ success: true });
  } catch (err) {
    log.error('users', 'Unlink provider failed', {
      uniqueId: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/users/:uniqueId/appeal — Suspension appeal
// ═══════════════════════════════════════════════════════════════════

router.post('/users/:uniqueId/appeal', async (req, res) => {
  try {
    if (requireOwner(req, res)) return;

    const body = req.body;
    if (!body?.appealText) return res.status(400).json({ error: 'appealText required' });
    if (typeof body.appealText !== 'string' || body.appealText.length > 500) {
      return res
        .status(400)
        .json({ error: 'appealText must be a string of at most 500 characters' });
    }

    const uniqueId = req.params.uniqueId;

    // Idempotency check: if a pending appeal already exists, reject
    // with 409. Without this, a user could spam the endpoint, creating
    // unbounded suspensionAppeals docs (Spark quota burn) and admin
    // noise. Audit H2 (Phase 2A).
    const userSnap = await db.doc(`users/${uniqueId}`).get();
    if (userSnap.exists) {
      const userData = userSnap.data();
      const currentStatus = userData.suspensionAppealStatus;
      if (currentStatus === 'pending') {
        return res.status(409).json({ error: 'Appeal already pending' });
      }
    }

    log.info('users', 'Suspension appeal submitted', { uniqueId });

    await Promise.all([
      db.doc(`suspensionAppeals/${generateId()}`).set(
        {
          uniqueId,
          appealText: body.appealText,
          status: 'pending',
          createdAt: now(),
        },
        { merge: true },
      ),
      db.doc(`users/${uniqueId}`).update({
        suspensionAppealStatus: 'pending',
      }),
    ]);

    res.json({ success: true });
  } catch (err) {
    log.error('users', 'Suspension appeal failed', {
      uniqueId: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/users/:uniqueId/lift-suspension — Lift expired suspension
// ═══════════════════════════════════════════════════════════════════

router.post('/users/:uniqueId/lift-suspension', async (req, res) => {
  try {
    if (requireOwner(req, res)) return;

    const uniqueId = req.params.uniqueId;
    const user = await getDoc(`users/${uniqueId}`);
    const isSuspended = user?.isSuspended ?? user?.is_suspended ?? false;
    if (!user || !isSuspended) {
      return res.status(400).json({ error: 'User is not suspended' });
    }

    const suspensionEndDate = user.suspensionEndDate ?? user.suspension_end_date ?? null;
    if (suspensionEndDate && suspensionEndDate > now()) {
      return res.status(400).json({ error: 'Suspension has not expired yet' });
    }

    log.info('users', 'Lifting expired suspension', { uniqueId });

    await db.doc(`users/${uniqueId}`).update({
      isSuspended: false,
      suspensionReason: null,
      suspensionEndDate: null,
      suspensionCanAppeal: true,
      suspensionAppealStatus: null,
      suspendedBy: null,
    });

    clearSuspensionCache(Number(uniqueId));

    res.json({ success: true });
  } catch (err) {
    log.error('users', 'Lift suspension failed', {
      uniqueId: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/users/:uniqueId/follow — Follow a user
// ═══════════════════════════════════════════════════════════════════

router.post('/users/:uniqueId/follow', async (req, res) => {
  try {
    const body = req.body;
    const rawTargetId = body?.targetUserId;
    if (!rawTargetId) return res.status(400).json({ error: 'targetUserId required' });
    if (requireOwner(req, res)) return;

    // Strict integer validation. Pre-fix used Number(targetId) which
    // turns 'evil../path' into NaN and stuffs NaN into followingIds via
    // arrayUnion(NaN). NaN poisoning corrupts every subsequent array
    // operation against the field. Audit H3 (Phase 2A).
    const targetId = Number.parseInt(String(rawTargetId), 10);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return res.status(400).json({ error: 'targetUserId must be a positive integer' });
    }
    if (String(targetId) !== String(rawTargetId).trim()) {
      // Reject inputs like '123abc' that parseInt would silently
      // truncate to 123 — strict round-trip equality.
      return res.status(400).json({ error: 'targetUserId must be a positive integer' });
    }

    const uniqueId = Number(req.params.uniqueId);
    if (uniqueId === targetId) {
      return res.status(400).json({ error: 'Cannot follow yourself' });
    }

    // Verify target user exists. Pre-fix would let the batch write
    // fail with a Firestore error and return 500; with the validation
    // here, the API returns the correct 404 contract.
    const targetSnap = await db.doc(`users/${targetId}`).get();
    if (!targetSnap.exists) {
      return res.status(404).json({ error: 'Target user not found' });
    }

    const batch = db.batch();
    batch.update(db.doc(`users/${uniqueId}`), {
      followingIds: FieldValue.arrayUnion(targetId),
    });
    batch.update(db.doc(`users/${targetId}`), {
      followerIds: FieldValue.arrayUnion(uniqueId),
    });
    await batch.commit();
    log.info('users', 'User followed', { uniqueId, targetUserId: targetId });

    res.json({ success: true });
  } catch (err) {
    log.error('users', 'Follow failed', {
      uniqueId: req.params.uniqueId,
      targetUserId: req.body?.targetUserId,
      error: err.message,
    });
    res.status(500).json({ error: 'Failed to follow user' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/users/:uniqueId/unfollow — Unfollow a user
// ═══════════════════════════════════════════════════════════════════

router.post('/users/:uniqueId/unfollow', async (req, res) => {
  try {
    const body = req.body;
    const targetId = body?.targetUserId;
    if (!targetId) return res.status(400).json({ error: 'targetUserId required' });
    if (requireOwner(req, res)) return;

    const uniqueId = req.params.uniqueId;
    const batch = db.batch();
    batch.update(db.doc(`users/${uniqueId}`), {
      followingIds: FieldValue.arrayRemove(Number(targetId)),
    });
    batch.update(db.doc(`users/${targetId}`), {
      followerIds: FieldValue.arrayRemove(Number(uniqueId)),
    });
    await batch.commit();
    log.info('users', 'User unfollowed', { uniqueId, targetUserId: targetId });

    res.json({ success: true });
  } catch (err) {
    log.error('users', 'Unfollow failed', {
      uniqueId: req.params.uniqueId,
      targetUserId: req.body?.targetUserId,
      error: err.message,
    });
    res.status(500).json({ error: 'Failed to unfollow user' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/users/:uniqueId/remove-follower — Remove a follower
// ═══════════════════════════════════════════════════════════════════

router.post('/users/:uniqueId/remove-follower', async (req, res) => {
  try {
    const body = req.body;
    const followerId = body?.followerUserId;
    if (!followerId) return res.status(400).json({ error: 'followerUserId required' });
    if (requireOwner(req, res)) return;

    const uniqueId = req.params.uniqueId;
    const batch = db.batch();
    batch.update(db.doc(`users/${uniqueId}`), {
      followerIds: FieldValue.arrayRemove(Number(followerId)),
    });
    batch.update(db.doc(`users/${followerId}`), {
      followingIds: FieldValue.arrayRemove(Number(uniqueId)),
    });
    await batch.commit();
    log.info('users', 'Follower removed', { uniqueId, followerUserId: followerId });

    res.json({ success: true });
  } catch (err) {
    log.error('users', 'Remove follower failed', {
      uniqueId: req.params.uniqueId,
      followerUserId: req.body?.followerUserId,
      error: err.message,
    });
    res.status(500).json({ error: 'Failed to remove follower' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/users/:uniqueId/record-visit — Record profile visit
// ═══════════════════════════════════════════════════════════════════

router.post('/users/:uniqueId/record-visit', async (req, res) => {
  try {
    const body = req.body;
    const visitorId = body?.visitorId;
    if (!visitorId) return res.status(400).json({ error: 'visitorId required' });
    // visitorId must match caller's uniqueId (string comparison since param is string)
    if (String(req.auth.uniqueId) !== String(visitorId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (req.params.uniqueId === visitorId) return res.json({ success: true }); // don't stalk yourself

    const profileUniqueId = req.params.uniqueId;

    // C7: blocked viewers must not tick the stalker counter on the
    // target's profile (otherwise blocking is observably useless —
    // the blocker keeps getting "X new visitors" notifications driven
    // by a user they've already chosen to disengage from). Return 200
    // with success:true so the client treats the call as completed,
    // avoiding a retry loop or a UI signal that reveals block state.
    const targetUser = await getDoc(`users/${profileUniqueId}`);
    if (viewerIsBlocked(visitorId, targetUser)) {
      return res.json({ success: true, recorded: false });
    }

    const stalkerPath = `users/${profileUniqueId}/stalkers/${visitorId}`;
    const existing = await getDoc(stalkerPath);
    const timestamp = now();

    if (existing) {
      const batch = db.batch();
      batch.update(db.doc(stalkerPath), {
        lastVisitedAt: timestamp,
        visitCount: (existing.visitCount || 1) + 1,
      });
      batch.update(db.doc(`users/${profileUniqueId}`), {
        newStalkerCount: FieldValue.increment(1),
      });
      await batch.commit();
    } else {
      const batch = db.batch();
      batch.set(
        db.doc(stalkerPath),
        {
          visitorId,
          lastVisitedAt: timestamp,
          firstVisitedAt: timestamp,
          visitCount: 1,
        },
        { merge: true },
      );
      batch.update(db.doc(`users/${profileUniqueId}`), {
        stalkerCount: FieldValue.increment(1),
        newStalkerCount: FieldValue.increment(1),
      });
      await batch.commit();
    }

    res.json({ success: true });
  } catch (err) {
    log.error('users', 'Record visit failed', {
      profileUniqueId: req.params.uniqueId,
      visitorId: req.body?.visitorId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Send email and push notification for scheduled account deletion. */
async function sendDeletionNotifications(user, executeAt) {
  const deleteDate = new Date(executeAt).toISOString().split('T')[0];
  if (user.email) {
    try {
      const template = buildDeletionScheduledEmail(deleteDate);
      await sendEmail(user.email, template.subject, template.html);
    } catch (emailErr) {
      log.error('users', 'Failed to send deletion email', { error: emailErr.message });
    }
  }
  if (user.fcmTokens && user.fcmTokens.length > 0) {
    try {
      await sendFcmToTokens(user.fcmTokens, {
        notification: {
          title: 'Account Deletion Scheduled',
          body: `Your account will be deleted on ${deleteDate}. Sign in to cancel.`,
        },
      });
    } catch (fcmErr) {
      log.error('users', 'Failed to send deletion push', { error: fcmErr.message });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// POST /api/users/:uniqueId/delete — Schedule account deletion
// ═══════════════════════════════════════════════════════════════════

router.post('/users/:uniqueId/delete', async (req, res) => {
  try {
    if (requireOwner(req, res)) return;

    const uniqueId = req.params.uniqueId;
    const { pin } = req.body || {};

    // Fetch user
    const userSnap = await db.doc(`users/${uniqueId}`).get();
    if (!userSnap.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = userSnap.data();

    // Check if already scheduled
    if (user.deletionScheduledAt) {
      return res.status(409).json({ error: 'Deletion already scheduled' });
    }

    // Verify identity: PIN required
    if (!pin) {
      return res.status(400).json({ error: 'PIN verification required' });
    }

    // Length-validate PIN BEFORE bcrypt.compare. Without this, a
    // 1MB-string PIN (allowed by express.json limit) would block the
    // Node event loop for hundreds of ms — single-request DoS. Audit
    // H4 (Phase 2A). PINs are app-side 4-digit codes; allowing 4-16
    // chars covers any future format expansion (alphanumeric backup
    // codes, etc.) without exposing the bcrypt-DoS surface.
    if (typeof pin !== 'string' || pin.length < 4 || pin.length > 16) {
      log.warn('users', 'PIN length validation rejected', {
        uniqueId,
        pinType: typeof pin,
        pinLength: typeof pin === 'string' ? pin.length : null,
      });
      return res.status(400).json({ error: 'PIN must be a string of 4-16 characters' });
    }

    if (!user.pinHash) {
      return res.status(400).json({ error: 'No PIN set for this account' });
    }
    const isValid = await bcrypt.compare(pin, user.pinHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Wrong PIN' });
    }

    // Get grace period from config
    const configSnap = await db.doc('config/app').get();
    const graceDays = configSnap.exists
      ? configSnap.data().accountDeletionGracePeriodDays || 30
      : 30;

    const timestamp = now();
    const executeAt = timestamp + graceDays * 86400000;

    // Set deletion fields + clear room
    const updates = {
      deletionScheduledAt: timestamp,
      deletionReason: 'self',
      deletionExecuteAt: executeAt,
      currentRoomId: null,
    };
    await db.doc(`users/${uniqueId}`).update(updates);

    // Revoke refresh tokens (sign out all devices)
    try {
      await auth.revokeRefreshTokens(user.firebaseUid);
    } catch (revokeErr) {
      log.error('users', 'Failed to revoke refresh tokens', { error: revokeErr.message });
    }

    // Send deletion notifications (best-effort)
    await sendDeletionNotifications(user, executeAt);

    // Audit log
    await db.doc(`adminAuditLog/${generateId()}`).set({
      action: 'ACCOUNT_DELETION_SCHEDULED',
      targetUserId: uniqueId,
      triggeredBy: 'self',
      reason: 'self',
      createdAt: timestamp,
    });

    log.info('users', 'Account deletion scheduled', { uniqueId, executeAt });
    res.json({ success: true, deleteAt: executeAt });
  } catch (err) {
    log.error('users', 'Failed to schedule account deletion', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/users/:uniqueId/cancel-delete — Cancel scheduled deletion
// ═══════════════════════════════════════════════════════════════════

router.post('/users/:uniqueId/cancel-delete', async (req, res) => {
  try {
    if (requireOwner(req, res)) return;

    const uniqueId = req.params.uniqueId;

    const userSnap = await db.doc(`users/${uniqueId}`).get();
    if (!userSnap.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = userSnap.data();

    if (!user.deletionScheduledAt) {
      return res.status(404).json({ error: 'No deletion scheduled' });
    }

    // Admin-initiated deletions cannot be cancelled by the user
    if (user.deletionReason === 'admin') {
      return res
        .status(403)
        .json({ error: 'Admin-initiated deletion cannot be cancelled by the user' });
    }

    // Check if deletion already executed
    if (user.deletionExecuteAt && user.deletionExecuteAt <= now()) {
      return res.status(410).json({ error: 'Deletion has already been executed' });
    }

    await db.doc(`users/${uniqueId}`).update({
      deletionScheduledAt: null,
      deletionReason: null,
      deletionExecuteAt: null,
    });

    // Audit log
    await db.doc(`adminAuditLog/${generateId()}`).set({
      action: 'ACCOUNT_DELETION_CANCELLED',
      targetUserId: uniqueId,
      triggeredBy: 'self',
      createdAt: now(),
    });

    log.info('users', 'Account deletion cancelled', { uniqueId });
    res.json({ success: true });
  } catch (err) {
    log.error('users', 'Failed to cancel account deletion', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/users/:uniqueId/deletion-status — Check deletion status
// ═══════════════════════════════════════════════════════════════════

router.get('/users/:uniqueId/deletion-status', async (req, res) => {
  try {
    if (requireOwner(req, res)) return;

    const uniqueId = req.params.uniqueId;

    const userSnap = await db.doc(`users/${uniqueId}`).get();
    if (!userSnap.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = userSnap.data();

    if (!user.deletionScheduledAt) {
      return res.json({
        scheduled: false,
        scheduledAt: null,
        executeAt: null,
        reason: null,
        daysRemaining: null,
      });
    }

    const msRemaining = user.deletionExecuteAt - now();
    const daysRemaining = Math.max(0, Math.ceil(msRemaining / 86400000));

    res.json({
      scheduled: true,
      scheduledAt: user.deletionScheduledAt,
      executeAt: user.deletionExecuteAt,
      reason: user.deletionReason,
      daysRemaining,
    });
  } catch (err) {
    log.error('users', 'Failed to get deletion status', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

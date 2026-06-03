/**
 * Admin-side age-verification routes (PR 4b/14).
 *
 *   GET  /api/admin/age-verification/pending
 *     List all pending submissions (oldest first).
 *
 *   POST /api/admin/age-verification/:id/approve
 *     Body: { reason: string }
 *     Marks the submission approved. Flips `ageVerified=true` on the
 *     target user, records `ageVerifiedAt` + `ageVerificationMethod`.
 *     Best-effort: deletes R2 ID image and writes audit-log entry.
 *
 *   POST /api/admin/age-verification/:id/reject
 *     Body: { reason: string }
 *     Marks the submission rejected. User stays unverified. Image is
 *     still deleted (privacy: spec required image destruction on
 *     decision regardless of outcome). Writes audit entry.
 *
 *   POST /api/admin/age-verification/:id/modify-dob
 *     Body: { newDob: number (ms), reason: string }
 *     Updates `users/<uid>.dateOfBirth` to the new value. If the new
 *     DOB makes the user 18+, behaves like approve. If <18, the
 *     account is reverted to unverified — they age in. PMs lock-out
 *     is downstream (PR 11 migration). DOB plausibility (1900 ≤ dob
 *     ≤ now) is validated PRE-transaction; an implausible DOB cannot
 *     get past the user-doc mutation only to fail at the audit-log
 *     stage.
 *
 * Concurrency: each decision endpoint uses `db.runTransaction(...)`
 * to atomically read submission + user docs and write both updates.
 *
 * Partial-failure contract: the route returns success with explicit
 * `auditWritten` / `imageDeleted` flags when post-commit cleanup
 * partially fails. The Firestore decision is the source of truth;
 * a failed audit-log write or R2 deletion is logged for ops sweep
 * and surfaced to the admin UI via the response flags rather than
 * masked as a 500. Crash-window between the transaction commit and
 * the post-commit cleanup leaves the decision recorded with no
 * audit / a leaked image — see follow-up task for a reconciliation
 * job that detects gaps.
 *
 * Submission-doc lifecycle: after a decision commits, the
 * `r2Key` field is set to null in the same transaction so a future
 * reader (admin audit-trail tab) doesn't see a stale reference to a
 * deleted object. The original key is preserved in the audit-log
 * entry for compliance traceability.
 */

const express = require('express');
const router = express.Router();
// FCM push helper (PR 10) — sends a data-only push to the user's
// stored fcmTokens after each decision so the Android service renders
// a local notification when the app is backgrounded. Best-effort —
// failures surface via the partial-failure response shape, not a 500.

const { db, auth, FieldValue } = require('../utils/firebase');
const r2 = require('../utils/r2');
const audit = require('../utils/age-verification-audit');
const systemPm = require('../utils/age-verification-system-pm');
const fcmPush = require('../utils/age-verification-fcm');
const { mintClaimsMerging, effectiveCohort } = require('../utils/firebase-claims');
const { now } = require('../utils/helpers');
const log = require('../utils/log');
const { requireAdmin } = require('../middleware/auth');

// Phase 2H finding #2 dedup: scope admin guard by path prefix.
const _adminGuardWrapper = async (req, res, next) => {
  if (await requireAdmin(req, res)) return;
  next();
};
router.use('/admin/age-verification', _adminGuardWrapper);

function isAtLeast18FromDob(dateOfBirthMs) {
  if (typeof dateOfBirthMs !== 'number' || !Number.isFinite(dateOfBirthMs)) return false;
  const today = new Date();
  const dob = new Date(dateOfBirthMs);
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  if (
    today.getUTCMonth() < dob.getUTCMonth() ||
    (today.getUTCMonth() === dob.getUTCMonth() && today.getUTCDate() < dob.getUTCDate())
  ) {
    age -= 1;
  }
  return age >= 18;
}

async function deleteImageBestEffort(r2Key, submissionId) {
  if (!r2Key) return true;
  try {
    await r2.deleteObject(r2Key);
    return true;
  } catch (err) {
    log.error('admin-age-verification', 'R2 image deletion failed', {
      submissionId,
      r2Key,
      error: err?.message,
    });
    return false;
  }
}

async function writeAuditBestEffort(action, submissionId, payload) {
  try {
    await action(db, payload);
    return true;
  } catch (err) {
    log.error('admin-age-verification', 'Audit-log write failed', {
      submissionId,
      payload,
      error: err?.message,
    });
    return false;
  }
}

async function sendPmBestEffort(action, submissionId, args) {
  // Same partial-failure shape as audit / R2 — a failed PM doesn't
  // roll back the decision. Surfaced via the response so the admin
  // UI can flag "decision committed, user not notified".
  try {
    await action(...args);
    return true;
  } catch (err) {
    log.error('admin-age-verification', 'System PM send failed', {
      submissionId,
      error: err?.message,
    });
    return false;
  }
}

function requireNonBlankReason(reason) {
  return typeof reason === 'string' && reason.trim().length > 0;
}

// ─── GET /pending ───────────────────────────────────────────────────

router.get('/admin/age-verification/pending', async (req, res) => {
  if (await requireAdmin(req, res)) return;
  try {
    const snap = await db
      .collection('ageVerificationSubmissions')
      .where('status', '==', 'pending')
      .orderBy('submittedAt', 'asc')
      .get();
    const submissions = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
    return res.json({ submissions });
  } catch (err) {
    log.error('admin-age-verification', 'list pending failed', { error: err?.message });
    return res
      .status(500)
      .json({ error: 'Failed to list pending submissions', errorId: 'AGE_VERIF_LIST' });
  }
});

// ─── GET /:id/image-url ─────────────────────────────────────────────
//
// Returns a short-lived signed URL the admin browser can use to view
// the submitted ID image directly from R2. Stored privately; no
// long-lived URLs leave the API surface. 5-minute expiry mirrors the
// upload PUT URL.
//
// Returns 404 if the submission's r2Key is null — that happens after
// a decision commits (key is wiped post-decision; the image is also
// deleted from R2 best-effort).

router.get('/admin/age-verification/:id/image-url', async (req, res) => {
  if (await requireAdmin(req, res)) return;
  const { id } = req.params;
  try {
    const subRef = db.doc(`ageVerificationSubmissions/${id}`);
    const snap = await subRef.get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Submission not found' });
    }
    const data = snap.data();
    if (!data.r2Key) {
      // Post-decision: image has been deleted (best-effort) and key
      // wiped from the doc. Admin can still read the audit log for
      // compliance traceability.
      return res.status(404).json({ error: 'Image already removed' });
    }
    const url = await r2.getSignedGetUrl(data.r2Key, 300);
    return res.json({ url, expiresInSec: 300 });
  } catch (err) {
    log.error('admin-age-verification', 'image-url failed', {
      submissionId: id,
      error: err?.message,
    });
    return res
      .status(500)
      .json({ error: 'Failed to issue image URL', errorId: 'AGE_VERIF_IMAGE_URL' });
  }
});

// ─── POST /:id/approve ──────────────────────────────────────────────

router.post('/admin/age-verification/:id/approve', async (req, res) => {
  if (await requireAdmin(req, res)) return;
  const { id } = req.params;
  const errorId = 'AGE_VERIF_APPROVE';
  try {
    // Approve does NOT require a reason. Original spec only asked for
    // an admin justification on outcomes the user needs explained
    // (Reject / DOB-modified). Approve is the "everything is fine"
    // path; the audit log records WHO approved + WHEN, sufficient for
    // the compliance trail. (Question 1 from 2026-05-04 spec
    // follow-up — revisit if regulators ever ask for it.)

    let submission;
    let approved = false;
    await db.runTransaction(async (tx) => {
      const subRef = db.doc(`ageVerificationSubmissions/${id}`);
      const subSnap = await tx.get(subRef);
      if (!subSnap.exists) return;
      const data = subSnap.data();
      if (data.status !== 'pending') {
        submission = { ...data, _conflict: true };
        return;
      }
      submission = { ...data, id };

      tx.update(subRef, {
        status: 'approved',
        decisionAt: now(),
        decidedBy: req.auth.uniqueId,
        // r2Key tombstoned — original preserved in audit-log entry.
        r2Key: null,
      });
      tx.update(db.doc(`users/${data.userId}`), {
        ageVerified: true,
        ageVerifiedAt: now(),
        ageVerificationMethod: data.idMethod,
      });
      approved = true;
    });

    if (!submission) return res.status(404).json({ error: 'Submission not found' });
    if (submission._conflict) return res.status(409).json({ error: 'Submission already decided' });
    if (!approved) return res.status(500).json({ error: 'Approval did not commit', errorId });

    const imageDeleted = await deleteImageBestEffort(submission.r2Key, id);
    const auditWritten = await writeAuditBestEffort(audit.logVerificationApproved, id, {
      adminUid: req.auth.uniqueId,
      targetUserId: submission.userId,
      method: submission.idMethod,
    });
    const userNotified = await sendPmBestEffort(systemPm.sendAgeVerificationApprovedPm, id, [
      submission.userId,
      submission.idMethod,
    ]);
    // FCM push (PR 10) — best-effort, separate failure flag.
    const pushNotified = await fcmPush.sendAgeVerificationApprovedPush(submission.userId);

    return res.json({ ok: true, imageDeleted, auditWritten, userNotified, pushNotified });
  } catch (err) {
    log.error('admin-age-verification', `${errorId} failed`, { id, error: err?.message });
    return res.status(500).json({ error: 'Failed to approve submission', errorId });
  }
});

// ─── POST /:id/reject ───────────────────────────────────────────────

router.post('/admin/age-verification/:id/reject', async (req, res) => {
  if (await requireAdmin(req, res)) return;
  const { id } = req.params;
  const errorId = 'AGE_VERIF_REJECT';
  try {
    const reason = (req.body?.reason || '').toString();
    if (!requireNonBlankReason(reason)) {
      return res.status(400).json({ error: 'reason is required' });
    }

    let submission;
    let rejected = false;
    await db.runTransaction(async (tx) => {
      const subRef = db.doc(`ageVerificationSubmissions/${id}`);
      const subSnap = await tx.get(subRef);
      if (!subSnap.exists) return;
      const data = subSnap.data();
      if (data.status !== 'pending') {
        submission = { ...data, _conflict: true };
        return;
      }
      submission = { ...data, id };

      tx.update(subRef, {
        status: 'rejected',
        decisionAt: now(),
        decidedBy: req.auth.uniqueId,
        decisionReason: reason,
        r2Key: null,
      });
      // User doc intentionally NOT touched — they stay unverified.
      rejected = true;
    });

    if (!submission) return res.status(404).json({ error: 'Submission not found' });
    if (submission._conflict) return res.status(409).json({ error: 'Submission already decided' });
    if (!rejected) return res.status(500).json({ error: 'Rejection did not commit', errorId });

    const imageDeleted = await deleteImageBestEffort(submission.r2Key, id);
    const auditWritten = await writeAuditBestEffort(audit.logVerificationRejected, id, {
      adminUid: req.auth.uniqueId,
      targetUserId: submission.userId,
      reason,
    });
    const userNotified = await sendPmBestEffort(systemPm.sendAgeVerificationRejectedPm, id, [
      submission.userId,
      reason,
    ]);
    const pushNotified = await fcmPush.sendAgeVerificationRejectedPush(submission.userId, reason);

    return res.json({ ok: true, imageDeleted, auditWritten, userNotified, pushNotified });
  } catch (err) {
    log.error('admin-age-verification', `${errorId} failed`, { id, error: err?.message });
    return res.status(500).json({ error: 'Failed to reject submission', errorId });
  }
});

// ─── POST /:id/modify-dob ───────────────────────────────────────────

router.post('/admin/age-verification/:id/modify-dob', async (req, res) => {
  if (await requireAdmin(req, res)) return;
  const { id } = req.params;
  const errorId = 'AGE_VERIF_MODIFY_DOB';
  try {
    const newDob = req.body?.newDob;
    const reason = (req.body?.reason || '').toString();
    if (typeof newDob !== 'number' || !Number.isFinite(newDob)) {
      return res.status(400).json({ error: 'newDob is required (ms epoch)' });
    }
    // Plausibility: 1900 <= newDob <= now. Throws if out of range.
    // Validated up-front so an implausible DOB never reaches the user
    // doc — without this, the transaction would commit the bogus
    // value, then the audit-log helper's bounds check would throw and
    // the route would 500 with the mutation already persisted.
    try {
      audit.requirePlausibleDob(newDob, 'newDob');
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!requireNonBlankReason(reason)) {
      return res.status(400).json({ error: 'reason is required' });
    }

    let submission;
    let oldDob;
    let committed = false;
    let targetUserData = null;
    let targetFirebaseUid = null;
    let newCohort = 'minor';
    let clearedEdgeCount = 0;
    await db.runTransaction(async (tx) => {
      const subRef = db.doc(`ageVerificationSubmissions/${id}`);
      const subSnap = await tx.get(subRef);
      if (!subSnap.exists) return;
      const data = subSnap.data();
      if (data.status !== 'pending') {
        submission = { ...data, _conflict: true };
        return;
      }
      submission = { ...data, id };

      const userRef = db.doc(`users/${data.userId}`);
      const userSnap = await tx.get(userRef);
      const userData = userSnap.exists ? userSnap.data() : null;
      oldDob = userData?.dateOfBirth ?? null;
      const verifiedNow = isAtLeast18FromDob(newDob);
      newCohort = verifiedNow ? 'adult' : 'minor';

      // UK OSA #17 PR 6 — runtime equivalent of migrate-segregation-
      // relationships.js. When a cohort flips (admin DOB modification can
      // take a user adult→minor or minor→adult), the user's existing
      // follow edges that are now cross-cohort MUST be cleared in the
      // same transaction as the cohort write. The one-shot migration
      // script only handles legacy data; without this runtime hook the
      // flip leaves cross-cohort edges live, which fails j19's OSA
      // invariant probe and would violate the same compliance contract
      // in prod. We batch all counterparty reads BEFORE any writes —
      // Firestore transactions forbid reads after writes.
      const oldCohort = userData?.cohort ?? null;
      const counterpartyEdges = [];
      if (oldCohort && oldCohort !== newCohort && userData) {
        const followingIds = Array.isArray(userData.followingIds) ? userData.followingIds : [];
        const followerIds = Array.isArray(userData.followerIds) ? userData.followerIds : [];
        const uniqueCounterparties = [...new Set([...followingIds, ...followerIds])];
        const counterpartySnaps = await Promise.all(
          uniqueCounterparties.map((counterpartyId) => tx.get(db.doc(`users/${counterpartyId}`))),
        );
        const cohortByCounterparty = new Map();
        counterpartySnaps.forEach((snap, idx) => {
          if (snap.exists) {
            cohortByCounterparty.set(uniqueCounterparties[idx], snap.data()?.cohort ?? null);
          }
        });
        // Exempt SHYTALK_OFFICIAL accounts: the migration script preserves
        // Officia's cross-cohort edges intentionally so system PMs can reach
        // users of any cohort. Apply the same exemption at runtime.
        const userIsOfficial = userData.userType === 'SHYTALK_OFFICIAL' || userData.isOfficial;
        for (const targetId of followingIds) {
          const c = cohortByCounterparty.get(targetId);
          if (!c || c === newCohort) continue;
          const targetSnap = counterpartySnaps[uniqueCounterparties.indexOf(targetId)];
          const targetIsOfficial =
            targetSnap?.exists &&
            (targetSnap.data()?.userType === 'SHYTALK_OFFICIAL' || targetSnap.data()?.isOfficial);
          if (userIsOfficial || targetIsOfficial) continue;
          counterpartyEdges.push({ direction: 'following', counterpartyId: targetId });
        }
        for (const sourceId of followerIds) {
          const c = cohortByCounterparty.get(sourceId);
          if (!c || c === newCohort) continue;
          const sourceSnap = counterpartySnaps[uniqueCounterparties.indexOf(sourceId)];
          const sourceIsOfficial =
            sourceSnap?.exists &&
            (sourceSnap.data()?.userType === 'SHYTALK_OFFICIAL' || sourceSnap.data()?.isOfficial);
          if (userIsOfficial || sourceIsOfficial) continue;
          counterpartyEdges.push({ direction: 'follower', counterpartyId: sourceId });
        }
      }

      tx.update(subRef, {
        status: 'dob_modified',
        decisionAt: now(),
        decidedBy: req.auth.uniqueId,
        decisionReason: reason,
        oldDob,
        newDob,
        r2Key: null,
      });
      tx.update(userRef, {
        dateOfBirth: newDob,
        ageVerified: verifiedNow,
        ageVerifiedAt: verifiedNow ? now() : null,
        ageVerificationMethod: verifiedNow ? data.idMethod : null,
        // PR 11 PM-lock side effect. New DOB <18 → lock the user out
        // of PMs (their list hides + counterparties see disabled
        // input). New DOB ≥18 → unlock. Same transaction so the
        // ageVerified flip and the lock state can never diverge.
        pmLocked: !verifiedNow,
        // UK OSA #17 PR 2: cohort follows the same predicate.
        // Same transaction so cohort + pmLocked can never diverge.
        cohort: newCohort,
      });
      // Cross-cohort edge cleanup writes — mirror the migration script's
      // both-sides arrayRemove pattern so neither side retains a dangling
      // reference (a one-sided clean leaves a phantom follower count on
      // the surviving side, which a cohort-segregation audit would flag).
      for (const edge of counterpartyEdges) {
        if (edge.direction === 'following') {
          tx.update(userRef, { followingIds: FieldValue.arrayRemove(edge.counterpartyId) });
          tx.update(db.doc(`users/${edge.counterpartyId}`), {
            followerIds: FieldValue.arrayRemove(userData.uniqueId),
          });
        } else {
          tx.update(userRef, { followerIds: FieldValue.arrayRemove(edge.counterpartyId) });
          tx.update(db.doc(`users/${edge.counterpartyId}`), {
            followingIds: FieldValue.arrayRemove(userData.uniqueId),
          });
        }
      }
      clearedEdgeCount = counterpartyEdges.length;
      // Capture for the post-commit claim mint. Effective-cohort
      // computation must see the NEW cohort but the EXISTING
      // override (admin cohortOverride survives a DOB change).
      targetUserData = userData ? { ...userData, cohort: newCohort } : { cohort: newCohort };
      targetFirebaseUid =
        userData && typeof userData.firebaseUid === 'string' ? userData.firebaseUid : null;
      committed = true;
    });

    if (!submission) return res.status(404).json({ error: 'Submission not found' });
    if (submission._conflict) return res.status(409).json({ error: 'Submission already decided' });
    if (!committed)
      return res.status(500).json({ error: 'DOB modification did not commit', errorId });

    // UK OSA #17 PR 2: claim mint after Firestore commits. No
    // forceTokenRefresh round-trip — the target user is not the
    // caller; the next sign-in's pm-lock-check round-trip catches
    // up. Partial-failure flag surfaced for admin UI alerting.
    //
    // Security defense (review MEDIUM #3): when the mint fails the
    // target user's JWT is stale relative to the new Firestore
    // cohort. For the DOB→minor case this means a now-minor user
    // can read adult-cohort data via the stale claim until ~1h of
    // auto-refresh closes the window. We revoke refresh tokens on
    // mint failure so the next ID-token request from the client
    // must re-authenticate — and re-authentication runs through
    // the sign-in mint, closing the gap immediately.
    let claimMinted = false;
    if (typeof targetFirebaseUid === 'string') {
      try {
        await mintClaimsMerging(targetFirebaseUid, { cohort: effectiveCohort(targetUserData) });
        claimMinted = true;
      } catch (_mintErr) {
        claimMinted = false;
        try {
          await auth.revokeRefreshTokens(targetFirebaseUid);
        } catch (_revokeErr) {
          // Best-effort defence in depth — if revoke also fails,
          // we've already surfaced claimMinted:false and the
          // ~1h JWT TTL is the worst-case staleness window.
        }
      }
    }

    const imageDeleted = await deleteImageBestEffort(submission.r2Key, id);
    const auditWritten = await writeAuditBestEffort(audit.logVerificationDobModified, id, {
      adminUid: req.auth.uniqueId,
      targetUserId: submission.userId,
      oldDob,
      newDob,
      reason,
    });
    const userNotified = await sendPmBestEffort(systemPm.sendAgeVerificationDobModifiedPm, id, [
      submission.userId,
      {
        ageVerified: isAtLeast18FromDob(newDob),
        method: submission.idMethod,
        reason,
      },
    ]);
    const pushNotified = await fcmPush.sendAgeVerificationDobModifiedPush(
      submission.userId,
      isAtLeast18FromDob(newDob),
    );

    return res.json({
      ok: true,
      ageVerified: isAtLeast18FromDob(newDob),
      imageDeleted,
      auditWritten,
      userNotified,
      pushNotified,
      claimMinted,
      // OSA #17 PR 6 runtime cleanup count — surfaced so the admin UI
      // can show the audit trail (e.g., "downgraded Hayato to minor;
      // cleared 2 cross-cohort follow edges").
      crossCohortEdgesCleared: clearedEdgeCount,
    });
  } catch (err) {
    log.error('admin-age-verification', `${errorId} failed`, { id, error: err?.message });
    return res.status(500).json({ error: 'Failed to modify DOB', errorId });
  }
});

module.exports = router;

#!/usr/bin/env node
/**
 * One-shot migration: revoke pre-existing cross-cohort follow
 * relationships and notify both parties. UK OSA #17 PR 6.
 *
 * Background: PR 1–5 introduced the cohort-segregation gates at the
 * route / rules / discovery layers, but legacy follow edges from
 * before the rollout still link `adult ↔ minor` pairs. The route
 * gate (PR 4) hides cross-cohort interactions on the request side,
 * but the stored edges remain inside the follower / following
 * counts and would re-emerge if a code path bypassed the gate (or if
 * the gate ever shipped a bug). This migration removes those edges
 * server-side, dispatches a system PM to both parties so the
 * disappearance is auditable, and writes a `segregationEvents` row
 * per migrated edge so PR 3's audit collection captures the loudest
 * cross-cohort event class.
 *
 * Algorithm:
 *   1. Scan the `users` collection once, building a cohort +
 *      displayName + blockedUserIds index.
 *   2. For each user, walk `followingIds[]` (canonical edge
 *      direction — A.followingIds containing B means A→B).
 *   3. Strict integer validation on both endpoints. Non-integer ids
 *      are treated as stale + skipped (the live follow route enforces
 *      strict-integer; non-integers in the array are data corruption,
 *      out of scope for this migration).
 *   4. For each edge whose endpoint cohorts differ, record the edge;
 *      otherwise count as preserved. Edges to ids absent from the
 *      `users` collection are counted stale.
 *   5. In `--apply` mode, the same scan is reused: one transaction
 *      per edge calls `arrayRemove` on BOTH sides (mirrors how
 *      `follow` writes both sides via batched update). Then a
 *      `segregationEvents` audit row is written, then `sendSystemPm`
 *      to both parties.
 *
 * Fail-safety:
 *   - `--apply` requires `MIGRATION_CONFIRM=yes` env var.
 *   - `--dry-run` and `--apply` are mutually exclusive (no silent
 *     fallback).
 *   - Pre-flight JSON snapshot listing every edge that WOULD be
 *     removed, written mode 0o600 (cohort + displayName are PII).
 *   - Each edge has its own transaction; a single failed transaction
 *     stops the migration but already-committed edges stay durable.
 *   - PM-dispatch failures are caught + counted (do NOT roll back the
 *     transactional removal — the load-bearing op is the edge revoke,
 *     and arrayRemove is idempotent, so a replay is safe).
 *   - Block-bypass: if the recipient blocked the counterparty before
 *     the migration ran, the system-PM substitutes "another user" for
 *     the counterparty displayName so the blocked name does not
 *     resurface.
 *
 * Cohort taxonomy is imported from `src/utils/firebase-claims` so
 * this script's notion of `effectiveCohort` / `VALID_COHORTS` cannot
 * drift from the live request path. A startup assertion confirms the
 * imported set is non-empty as a defensive sanity check.
 *
 * Scope: this script ONLY migrates follow-graph edges. The broader
 * segregation cutover includes additional relationship classes (1:1
 * conversations, group conversations, rooms, stalker history) which
 * are migrated by separate PRs in the same sequence (PR 7+). An
 * OSA-defensibility claim that "all pre-existing cross-cohort
 * relationships have been remediated" is FALSE on the basis of this
 * PR alone — only the follow-edge subset is covered here.
 *
 * Usage:
 *   node scripts/migrate-segregation-relationships.js --dry-run
 *   MIGRATION_CONFIRM=yes node scripts/migrate-segregation-relationships.js --apply
 */

const fs = require('fs');
const path = require('path');

const { db, FieldValue } = require('../src/utils/firebase');
const { effectiveCohort, VALID_COHORTS } = require('../src/utils/firebase-claims');
const { sendSystemPm } = require('../src/utils/system-pm');
const log = require('../src/utils/log');

const SAFE_DISPLAY_NAME_MAX_LEN = 64;
const SEGREGATION_EVENTS_COLLECTION = 'segregationEvents';

// Defensive: if `firebase-claims` ever expands to no/null exports,
// fail loud at module load — better than silently treating every user
// as `'minor'`.
if (!(VALID_COHORTS instanceof Set) || VALID_COHORTS.size === 0) {
  throw new Error('migrate-seg-relationships: VALID_COHORTS import is empty or invalid');
}

// Mirrors the strict-integer validation pattern used by the live
// follow route (users.js:976-988). The follow handler refuses to
// add non-integer ids, but legacy data may contain them — so the
// migration validates both sides at the boundary too.
function isPositiveIntegerString(value) {
  if (value === null || value === undefined) return false;
  const asStr = String(value).trim();
  if (!/^\d+$/.test(asStr)) return false;
  const asInt = Number.parseInt(asStr, 10);
  return Number.isInteger(asInt) && asInt > 0 && String(asInt) === asStr;
}

function sanitiseDisplayName(raw) {
  if (typeof raw !== 'string') return null;
  // Defence layers, in order (ORDER MATTERS):
  //   1. strip raw HTML brackets + ampersand so a markup-aware
  //      renderer cannot interpret the name as tags / entities
  //   2. collapse \r \n \t to space BEFORE the C0 strip — otherwise
  //      the next step removes them entirely and the two halves of
  //      a multi-line name end up adjacent, partially defeating
  //      the injection defence (word boundaries lost)
  //   3. collapse the unicode line / paragraph separators (U+2028 /
  //      U+2029) to space explicitly; JS \s in step 6 would catch
  //      these too but the explicit strip is contract-stable
  //   4. strip C0 + DEL + C1 control range (U+0080–U+009F includes
  //      U+0085 NEL, which some downstream renderers + log
  //      aggregators treat as a record terminator)
  //   5. strip zero-width / format chars: U+200B-U+200F + U+2060-U+2064
  //      + U+FEFF (BOM) + U+061C (Arabic Letter Mark bidi formatter)
  //   6. strip bidi overrides U+202A-U+202E + U+2066-U+2069 — RTL
  //      spoofing of the surrounding copy
  //   7. collapse runs of whitespace + trim
  //   8. cap length so a 10k-char name can't blow up the PM body
  const cleaned = raw
    .replace(/[<>&]/g, '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[\u2028\u2029]/g, ' ')
    // eslint-disable-next-line no-control-regex -- the control chars in this range ARE the strip targets; the lint defends against accidental control chars in patterns, not intentional ones.
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/[\u061C\u200B-\u200F\u2060-\u2064\uFEFF]/g, '')
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length === 0) return null;
  if (cleaned.length > SAFE_DISPLAY_NAME_MAX_LEN) {
    return cleaned.slice(0, SAFE_DISPLAY_NAME_MAX_LEN - 1).trimEnd() + '…';
  }
  return cleaned;
}

function formatRelationshipRemovedPm({ counterpartyDisplayName }) {
  // Cohort-agnostic copy: the recipient already knows their OWN
  // cohort, so any phrasing that says "the two of you are in
  // different groups" lets them infer the counterparty's cohort.
  // Stick to policy-language ("a recent change") so the notification
  // is informative but not an inferential side-channel. The test
  // suite pins both negative assertions (no cohort vocabulary) AND
  // a positive assertion on the load-bearing phrase.
  const safe = sanitiseDisplayName(counterpartyDisplayName);
  const subject = safe ?? 'another user';
  return [
    `Your follow link with ${subject} has been removed as part of a recent change to how ShyTalk organises accounts.`,
    '',
    "This is automatic; it doesn't reflect anything either of you did, and the original link can't be restored from here.",
    '',
    "If you don't recognise the name, this just means a past connection has been tidied up.",
  ].join('\n');
}

// UK OSA #17 PR 7 — sibling of `formatRelationshipRemovedPm` for
// room eviction. Reuses `sanitiseDisplayName` (same sanitisation
// contract: HTML brackets stripped, C0/C1 + bidi + ZW chars purged,
// max length capped). The body shares the load-bearing phrase
// ("recent change to how ShyTalk organises accounts") so the user-
// facing copy contract is consistent across PR 6 + PR 7. Cohort-
// agnostic by construction; the negative-pin tests guard against
// future copy drift introducing leak vocabulary.
function formatRoomEjectionPm({ roomName, counterpartyDisplayName: _ignored } = {}) {
  const safe = sanitiseDisplayName(roomName);
  const subject = safe ?? 'a room';
  return [
    `You've been removed from ${subject} as part of a recent change to how ShyTalk organises accounts.`,
    '',
    "This is automatic and doesn't reflect anything you did. The room itself is fine; we just can't keep you in it under the new arrangement.",
    '',
    'You can still create or join other rooms in your usual way.',
  ].join('\n');
}

async function scanCrossCohortEdges() {
  const usersSnap = await db.collection('users').get();

  // Single-pass cohort + blocked-list index over the whole user
  // collection. The follow-edge walk below resolves counterparty
  // cohort via this map; non-indexed ids are treated as stale (no
  // point-read fallback — the collection().get() snapshot is the
  // canonical universe of users for this one-shot run).
  const index = new Map();
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    index.set(doc.id, {
      cohort: effectiveCohort(data),
      displayName: data?.displayName ?? null,
      blockedUserIds: Array.isArray(data?.blockedUserIds) ? data.blockedUserIds : [],
    });
  }

  const crossCohortEdges = [];
  let preservedFollowsCount = 0;
  let staleEdgeCount = 0;

  for (const doc of usersSnap.docs) {
    const fromId = doc.id;
    if (!isPositiveIntegerString(fromId)) {
      // System user (SHYTALK_SYSTEM) or other non-numeric doc-id —
      // legitimate, has no follow edges to migrate. Skip silently.
      continue;
    }
    const data = doc.data();
    const fromEntry = index.get(fromId);
    const followingIds = Array.isArray(data?.followingIds) ? data.followingIds : [];
    for (const rawTo of followingIds) {
      if (!isPositiveIntegerString(rawTo)) {
        // Corrupted entry: non-integer in followingIds. Skip + count
        // — a separate dangling-id sweeper deals with cleanup.
        staleEdgeCount += 1;
        continue;
      }
      const toId = String(Number.parseInt(String(rawTo), 10));
      const toEntry = index.get(toId);
      if (!toEntry) {
        // Counterparty doc not present in the scan — stale id.
        staleEdgeCount += 1;
        continue;
      }
      if (fromEntry.cohort === toEntry.cohort) {
        preservedFollowsCount += 1;
        continue;
      }
      crossCohortEdges.push({
        from: fromId,
        fromCohort: fromEntry.cohort,
        fromDisplayName: fromEntry.displayName,
        fromBlockedToUser: fromEntry.blockedUserIds.some((id) => String(id) === toId),
        to: toId,
        toCohort: toEntry.cohort,
        toDisplayName: toEntry.displayName,
        toBlockedFromUser: toEntry.blockedUserIds.some((id) => String(id) === fromId),
      });
    }
  }

  return {
    crossCohortEdges,
    affectedFollowsCount: crossCohortEdges.length,
    preservedFollowsCount,
    staleEdgeCount,
  };
}

async function applyMigration({ dryRun, scan } = {}) {
  // The caller can pre-compute the scan (main() does this so the
  // snapshot file and the applied writes describe the same graph
  // state — otherwise a concurrent follow/cohort flip between the
  // two scans could make the snapshot misleading).
  const effectiveScan = scan ?? (await scanCrossCohortEdges());
  if (dryRun) {
    return {
      ...effectiveScan,
      pmDispatchFailures: 0,
      pmDispatchFailedRecipients: [],
      segregationEventFailures: 0,
    };
  }

  let pmDispatchFailures = 0;
  // Explicit list of recipient uniqueIds whose PM dispatch failed —
  // surfaced alongside the counter so an operator can manually
  // re-broadcast from the snapshot. arrayRemove on the edge already
  // committed is idempotent (no-op), so the scan won't re-pick the
  // edge on a future run — those PMs would otherwise be lost.
  const pmDispatchFailedRecipients = [];
  let segregationEventFailures = 0;
  const ranAt = Date.now();

  for (const edge of effectiveScan.crossCohortEdges) {
    // Defence in depth: the scan already rejected non-integer ids
    // before populating the edge list, but if a future caller hands
    // us a scan they built themselves, we re-validate at the write
    // boundary. arrayRemove(NaN) is a silent no-op, which would
    // leave cross-cohort edges in place — worse than a loud failure.
    if (!isPositiveIntegerString(edge.from) || !isPositiveIntegerString(edge.to)) {
      log.warn('migrate-seg-relationships', 'Refusing to apply non-integer edge', {
        from: edge.from,
        to: edge.to,
      });
      continue;
    }
    const fromIdNum = Number.parseInt(String(edge.from), 10);
    const toIdNum = Number.parseInt(String(edge.to), 10);

    await db.runTransaction(async (txn) => {
      txn.update(db.doc(`users/${edge.from}`), {
        followingIds: FieldValue.arrayRemove(toIdNum),
      });
      txn.update(db.doc(`users/${edge.to}`), {
        followerIds: FieldValue.arrayRemove(fromIdNum),
      });
    });

    // Audit row in the same collection PR 3's middleware writes to.
    // Schema matches `middleware/sameCohort.writeSegregationEvent`
    // exactly — `action` is the discriminator (no separate `type`
    // field), `requestId: null` because there's no inbound request.
    // Failure does NOT roll back the removal; the edge is gone
    // either way and arrayRemove is idempotent so a replay-run is
    // safe if operator notices a non-zero segregationEventFailures.
    try {
      await db.collection(SEGREGATION_EVENTS_COLLECTION).add({
        sourceUniqueId: edge.from,
        sourceCohort: edge.fromCohort,
        targetUniqueId: edge.to,
        targetCohort: edge.toCohort,
        surface: 'scripts/migrate-segregation-relationships',
        action: 'migration_removed',
        timestamp: ranAt,
        requestId: null,
      });
    } catch (err) {
      segregationEventFailures += 1;
      log.warn('migrate-seg-relationships', 'segregationEvents write failed', {
        edge: `${edge.from}→${edge.to}`,
        error: err?.message,
      });
    }

    // PMs — one per side. Block-bypass: if a side previously blocked
    // the other, omit the displayName for that side's PM so the
    // blocked user's name does not resurface in their inbox.
    const pmToFrom = formatRelationshipRemovedPm({
      counterpartyDisplayName: edge.fromBlockedToUser ? null : edge.toDisplayName,
    });
    const pmToTo = formatRelationshipRemovedPm({
      counterpartyDisplayName: edge.toBlockedFromUser ? null : edge.fromDisplayName,
    });
    try {
      await sendSystemPm(edge.from, pmToFrom);
    } catch (err) {
      pmDispatchFailures += 1;
      pmDispatchFailedRecipients.push(edge.from);
      log.warn('migrate-seg-relationships', 'PM dispatch failed', {
        recipient: edge.from,
        error: err?.message,
      });
    }
    try {
      await sendSystemPm(edge.to, pmToTo);
    } catch (err) {
      pmDispatchFailures += 1;
      pmDispatchFailedRecipients.push(edge.to);
      log.warn('migrate-seg-relationships', 'PM dispatch failed', {
        recipient: edge.to,
        error: err?.message,
      });
    }
  }

  return {
    ...effectiveScan,
    pmDispatchFailures,
    pmDispatchFailedRecipients,
    segregationEventFailures,
  };
}

// ──────────────────────────────────────────────────────────────────
// UK OSA #17 PR 7 — Room migration
// ──────────────────────────────────────────────────────────────────
//
// Sibling of the follow-edge migration. Mixed-cohort rooms (legacy
// rooms created before PR 7's cohort-tag rule) get participants of
// the non-room cohort evicted: removed from `participantIds`, their
// seat cleared, and a cohort-agnostic system PM dispatched. Legacy
// rooms with no `cohort` field get the field backfilled from the
// owner's effective cohort.
//
// Currently-active LiveKit sessions are NOT force-disconnected by
// this script — that requires a LiveKit Server API admin token
// (`RoomServiceClient.removeParticipant`), which is environment-
// dependent. The Firestore-side eviction means: (a) the next
// `/api/livekit/token` mint fails the gate (PR 7's other half),
// (b) the rules-layer room read gate (PR 3) starts failing for
// the evicted user, and (c) active sessions persist only until the
// LiveKit token TTL (24h). Force-disconnect of live sessions is
// PR 14's runbook step, not part of this code change.

const SCAN_ROOM_SURFACE = 'scripts/migrate-segregation-rooms';

function resolveRoomCohort(roomData, ownerEntry) {
  // Tagged rooms win — their cohort was bound to the creator's JWT
  // claim by firestore.rules at create-time. Untagged rooms fall
  // back to the owner's current effective cohort, which is the
  // value the room would have been tagged with under PR 7.
  const tagged = effectiveCohort(roomData);
  // `effectiveCohort` defaults to 'minor' when no cohort field is
  // set, so we can't distinguish "tagged minor" from "untagged" by
  // its return alone. Check the source field directly.
  const hasTag =
    roomData && typeof roomData.cohort === 'string' && VALID_COHORTS.has(roomData.cohort);
  if (hasTag) return { cohort: tagged, needsBackfill: false };
  return { cohort: ownerEntry.cohort, needsBackfill: true };
}

async function scanCrossCohortRooms() {
  const [usersSnap, roomsSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('rooms').get(),
  ]);

  // Single-pass cohort + displayName index. Same shape as the
  // follow-edge scan but indexed for participant lookup. The room
  // scan resolves cohort via this map; participants whose id is
  // absent default to 'minor' (fail-closed) per `effectiveCohort`.
  const userIndex = new Map();
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    userIndex.set(doc.id, {
      cohort: effectiveCohort(data),
      displayName: data?.displayName ?? null,
      blockedUserIds: Array.isArray(data?.blockedUserIds) ? data.blockedUserIds : [],
    });
  }

  const roomEntries = [];
  let affectedParticipantsCount = 0;
  let affectedRoomsCount = 0;
  let preservedParticipantsCount = 0;
  let staleParticipantCount = 0;
  let legacyRoomsCount = 0;
  let skippedRoomsCount = 0;

  for (const doc of roomsSnap.docs) {
    const roomData = doc.data() || {};
    const roomId = doc.id;

    // Skip non-ACTIVE rooms: we cannot evict from a closed room
    // (no live session, no LiveKit grant in flight). Closed rooms
    // are inert until garbage-collected by the cleanup cron.
    if (roomData.state !== 'ACTIVE') {
      skippedRoomsCount += 1;
      continue;
    }

    const ownerId = roomData.ownerId;
    if (!ownerId || typeof ownerId !== 'string') {
      // Ownerless room — legacy data corruption. Out of scope for
      // this migration; admin cleanup target.
      skippedRoomsCount += 1;
      continue;
    }

    const ownerEntry = userIndex.get(ownerId);
    if (!ownerEntry) {
      // Owner doc missing — same skip rationale as ownerless.
      skippedRoomsCount += 1;
      continue;
    }

    const { cohort: roomCohort, needsBackfill } = resolveRoomCohort(roomData, ownerEntry);
    if (needsBackfill) legacyRoomsCount += 1;

    const participantIds = Array.isArray(roomData.participantIds) ? roomData.participantIds : [];
    const seats =
      roomData.seats && typeof roomData.seats === 'object' && !Array.isArray(roomData.seats)
        ? roomData.seats
        : {};

    // Build a participant→seatIndex reverse map so we can clear the
    // seat in the eviction transaction without re-reading the doc.
    const seatByParticipant = new Map();
    for (const [seatIdx, seatRaw] of Object.entries(seats)) {
      const seat = seatRaw && typeof seatRaw === 'object' ? seatRaw : null;
      const userId = seat?.userId;
      if (userId && typeof userId === 'string') {
        seatByParticipant.set(userId, seatIdx);
      }
    }

    const mismatchedParticipants = [];
    for (const rawPid of participantIds) {
      if (!isPositiveIntegerString(rawPid)) {
        // Non-integer id in the array — stale data, no live user.
        // Counted but not migrated (a separate sweeper deals with it).
        staleParticipantCount += 1;
        continue;
      }
      const pid = String(Number.parseInt(String(rawPid), 10));
      if (pid === String(ownerId)) {
        // Owner is never flagged — the room IS the owner; cohort
        // drift between owner and the room tag is an ops concern,
        // not a participant-eviction trigger. Still counted as a
        // preserved participant so the scan totals add up.
        preservedParticipantsCount += 1;
        continue;
      }
      const participantEntry = userIndex.get(pid);
      const participantCohort = participantEntry?.cohort ?? 'minor';
      if (participantCohort === roomCohort) {
        preservedParticipantsCount += 1;
        continue;
      }
      mismatchedParticipants.push({
        participantId: pid,
        participantCohort,
        participantDisplayName: participantEntry?.displayName ?? null,
        seatIndex: seatByParticipant.get(pid) ?? null,
        participantBlockedRoomOwner:
          participantEntry?.blockedUserIds?.some((id) => String(id) === String(ownerId)) ?? false,
      });
    }

    if (mismatchedParticipants.length === 0 && !needsBackfill) {
      continue;
    }
    if (mismatchedParticipants.length > 0) {
      affectedRoomsCount += 1;
      affectedParticipantsCount += mismatchedParticipants.length;
    }
    roomEntries.push({
      roomId,
      roomName: roomData.name ?? null,
      roomCohort,
      ownerId: String(ownerId),
      ownerCohort: ownerEntry.cohort,
      needsCohortBackfill: needsBackfill,
      mismatchedParticipants,
    });
  }

  return {
    roomEntries,
    affectedRoomsCount,
    affectedParticipantsCount,
    preservedParticipantsCount,
    staleParticipantCount,
    legacyRoomsCount,
    skippedRoomsCount,
  };
}

async function applyRoomMigration({ dryRun, scan } = {}) {
  const effectiveScan = scan ?? (await scanCrossCohortRooms());
  if (dryRun) {
    return {
      ...effectiveScan,
      pmDispatchFailures: 0,
      pmDispatchFailedRecipients: [],
      segregationEventFailures: 0,
      cohortBackfilledRoomsCount: 0,
    };
  }

  let pmDispatchFailures = 0;
  const pmDispatchFailedRecipients = [];
  let segregationEventFailures = 0;
  let cohortBackfilledRoomsCount = 0;
  const ranAt = Date.now();

  for (const entry of effectiveScan.roomEntries) {
    const roomRef = db.doc(`rooms/${entry.roomId}`);

    // One transaction per room: backfill cohort (if needed) +
    // remove all mismatched participants from `participantIds` +
    // clear their seats. Single-room scope means a failed room
    // doesn't corrupt prior rooms (matches the per-edge transaction
    // pattern in `applyMigration`).
    //
    // SECURITY: `FieldValue.arrayRemove(...)` is a sentinel — if the
    // same key (`participantIds`) is assigned twice in the updates
    // object, the second assignment overwrites the first and the
    // first arrayRemove is lost (one of the load-bearing PR 7
    // invariants — only the LAST mismatched participant would be
    // evicted from the array). Solution: pass ALL mismatched ids as
    // varargs to a single arrayRemove call. The seat clears are
    // safe because their dotted-path keys are unique per participant.
    const idsToEvict = entry.mismatchedParticipants
      .filter((m) => {
        if (isPositiveIntegerString(m.participantId)) return true;
        log.warn('migrate-seg-rooms', 'Refusing to evict non-integer participant id', {
          roomId: entry.roomId,
          participantId: m.participantId,
        });
        return false;
      })
      .map((m) => m.participantId);

    await db.runTransaction(async (txn) => {
      const updates = {};
      if (entry.needsCohortBackfill) {
        updates.cohort = entry.roomCohort;
      }
      if (idsToEvict.length > 0) {
        // Single arrayRemove call with all ids — atomic + idempotent.
        // Mirrors `RoomRepositoryImpl.leaveRoom`'s transaction shape
        // so the resulting doc is indistinguishable from a normal
        // departure (modulo the seat clears below).
        updates.participantIds = FieldValue.arrayRemove(...idsToEvict);
      }
      for (const m of entry.mismatchedParticipants) {
        if (!isPositiveIntegerString(m.participantId)) continue;
        if (m.seatIndex !== null && m.seatIndex !== undefined) {
          updates[`seats.${m.seatIndex}.userId`] = null;
          updates[`seats.${m.seatIndex}.state`] = 'EMPTY';
          updates[`seats.${m.seatIndex}.isMuted`] = false;
        }
      }
      txn.update(roomRef, updates);
    });

    if (entry.needsCohortBackfill) cohortBackfilledRoomsCount += 1;

    for (const m of entry.mismatchedParticipants) {
      // Audit row: same schema as the follow-edge migration's audit
      // (and PR 4's middleware audit) so analytics can union across
      // surfaces. `action: 'room_eviction'` is the discriminator.
      // `targetRoomId` mirrors the explicit field added in the
      // LiveKit gate audit for clarity in downstream analytics.
      // Serial per participant keeps the audit ordering deterministic
      // for ops; cohort-batched concurrency adds nothing for the small
      // migration volume.
      try {
        await db.collection(SEGREGATION_EVENTS_COLLECTION).add({
          sourceUniqueId: m.participantId,
          sourceCohort: m.participantCohort,
          targetUniqueId: entry.roomId,
          targetRoomId: entry.roomId,
          targetCohort: entry.roomCohort,
          surface: SCAN_ROOM_SURFACE,
          action: 'room_eviction',
          timestamp: ranAt,
          requestId: null,
        });
      } catch (err) {
        segregationEventFailures += 1;
        log.warn('migrate-seg-rooms', 'segregationEvents write failed', {
          roomId: entry.roomId,
          participantId: m.participantId,
          error: err?.message,
        });
      }

      // PM dispatch — cohort-agnostic body per the privacy contract.
      try {
        await sendSystemPm(m.participantId, formatRoomEjectionPm({ roomName: entry.roomName }));
      } catch (err) {
        pmDispatchFailures += 1;
        pmDispatchFailedRecipients.push(m.participantId);
        log.warn('migrate-seg-rooms', 'PM dispatch failed', {
          roomId: entry.roomId,
          participantId: m.participantId,
          error: err?.message,
        });
      }
    }
  }

  return {
    ...effectiveScan,
    pmDispatchFailures,
    pmDispatchFailedRecipients,
    segregationEventFailures,
    cohortBackfilledRoomsCount,
  };
}

async function writeSnapshot(scan) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.resolve(__dirname, '../migration-snapshots');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `seg-relationships-${ts}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        migration: 'seg-relationships',
        ranAt: ts,
        affectedFollowsCount: scan.affectedFollowsCount,
        preservedFollowsCount: scan.preservedFollowsCount,
        staleEdgeCount: scan.staleEdgeCount,
        edges: scan.crossCohortEdges,
      },
      null,
      2,
    ),
    // Restricted file mode — the snapshot contains displayName +
    // cohort tags + user-id pairs, which is PII-adjacent. World-
    // readable defaults leak the entire affected follow graph if
    // backup tooling ever sweeps the directory.
    { mode: 0o600 },
  );
  return file;
}

// Parse CLI args + env into an operation mode or an error. Pulled
// out of main() so the flag-priority contract is unit-testable
// without spawning a subprocess. `main()` translates the error code
// into a `process.exit()`.
function determineMode(args, env) {
  const dryRun = args.includes('--dry-run');
  const apply = args.includes('--apply');
  if (dryRun && apply) {
    return {
      error: 'mutually-exclusive',
      exitCode: 2,
      message: '--dry-run and --apply are mutually exclusive — pick one',
    };
  }
  if (!dryRun && !apply) {
    return {
      error: 'no-mode',
      exitCode: 2,
      message: 'Specify --dry-run or --apply',
    };
  }
  if (apply && env.MIGRATION_CONFIRM !== 'yes') {
    return {
      error: 'no-confirm',
      exitCode: 3,
      message:
        'Refusing to run --apply without MIGRATION_CONFIRM=yes. Run --dry-run first, review the snapshot, then re-run with both flags.',
    };
  }
  return { mode: dryRun ? 'dry-run' : 'apply' };
}

async function main() {
  const decision = determineMode(process.argv.slice(2), process.env);
  if (decision.error) {
    log.error('migrate-seg-relationships', decision.message);
    process.exit(decision.exitCode);
  }
  const dryRun = decision.mode === 'dry-run';

  log.info('migrate-seg-relationships', dryRun ? 'Starting dry-run scan' : 'Starting --apply pass');

  // Phase 1: follow-edge migration (PR 6) — pre-flight snapshot,
  // scan summary, then either dry-run or apply.
  const edgeScan = await scanCrossCohortEdges();
  const snapshotFile = await writeSnapshot(edgeScan);
  log.info('migrate-seg-relationships', 'Follow-edge snapshot written', { snapshotFile });
  log.info('migrate-seg-relationships', 'Follow-edge scan complete', {
    affectedFollowsCount: edgeScan.affectedFollowsCount,
    preservedFollowsCount: edgeScan.preservedFollowsCount,
    staleEdgeCount: edgeScan.staleEdgeCount,
  });

  // Phase 2: room migration (PR 7) — same dry-run / apply contract.
  // Counts logged separately so the operator can distinguish edge vs
  // room outcomes when reading the migration log post-run.
  const roomScan = await scanCrossCohortRooms();
  log.info('migrate-seg-relationships', 'Room scan complete', {
    affectedRoomsCount: roomScan.affectedRoomsCount,
    affectedParticipantsCount: roomScan.affectedParticipantsCount,
    preservedParticipantsCount: roomScan.preservedParticipantsCount,
    legacyRoomsCount: roomScan.legacyRoomsCount,
    skippedRoomsCount: roomScan.skippedRoomsCount,
    staleParticipantCount: roomScan.staleParticipantCount,
  });

  if (dryRun) {
    log.info('migrate-seg-relationships', 'Dry-run complete — no writes performed');
    return;
  }

  const edgeResult = await applyMigration({ dryRun: false, scan: edgeScan });
  log.info('migrate-seg-relationships', 'Follow-edge migration complete', {
    affectedFollowsCount: edgeResult.affectedFollowsCount,
    preservedFollowsCount: edgeResult.preservedFollowsCount,
    staleEdgeCount: edgeResult.staleEdgeCount,
    pmDispatchFailures: edgeResult.pmDispatchFailures,
    pmDispatchFailedRecipients: edgeResult.pmDispatchFailedRecipients,
    segregationEventFailures: edgeResult.segregationEventFailures,
  });

  const roomResult = await applyRoomMigration({ dryRun: false, scan: roomScan });
  log.info('migrate-seg-relationships', 'Room migration complete', {
    affectedRoomsCount: roomResult.affectedRoomsCount,
    affectedParticipantsCount: roomResult.affectedParticipantsCount,
    cohortBackfilledRoomsCount: roomResult.cohortBackfilledRoomsCount,
    pmDispatchFailures: roomResult.pmDispatchFailures,
    pmDispatchFailedRecipients: roomResult.pmDispatchFailedRecipients,
    segregationEventFailures: roomResult.segregationEventFailures,
  });
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      // Stack-trace omitted from prod log — file paths in firebase-
      // admin traces can hint at service-account locations. The
      // snapshot file + ranAt timestamp are sufficient for forensics.
      log.error('migrate-seg-relationships', 'Migration failed', { error: err.message });
      process.exit(1);
    });
}

module.exports = {
  scanCrossCohortEdges,
  scanCrossCohortRooms,
  applyMigration,
  applyRoomMigration,
  formatRelationshipRemovedPm,
  formatRoomEjectionPm,
  effectiveCohort,
  sanitiseDisplayName,
  isPositiveIntegerString,
  writeSnapshot,
  determineMode,
  VALID_COHORTS,
  SAFE_DISPLAY_NAME_MAX_LEN,
  SEGREGATION_EVENTS_COLLECTION,
};

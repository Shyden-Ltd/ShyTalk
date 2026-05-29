/**
 * LiveKit token generation with multi-region routing.
 *
 * POST /api/livekit/token  -> Generate a LiveKit access token + nearest server URL
 *
 * UK OSA #17 PR 7 — token mint refuses to issue a participant grant
 * for a room whose `cohort` field does not match the caller's JWT
 * cohort claim. This is the only Express choke-point between client
 * and LiveKit; rooms are written direct-to-Firestore so the
 * firestore.rules layer carries the read/write gates. Without this
 * gate, a cross-cohort caller who somehow learns a roomId (off-band,
 * leak, or pre-PR-3 cached id) could obtain a participant grant.
 */

const router = require('express').Router();
const { AccessToken } = require('livekit-server-sdk');
const { db } = require('../utils/firebase');
const { cohortFromClaim, effectiveCohort } = require('../utils/firebase-claims');
const { writeSegregationEvent } = require('../middleware/sameCohort');
const log = require('../utils/log');
const { getRegion, getRegionConfig } = require('../utils/livekit-region');

const LIVEKIT_SURFACE = '/api/livekit/token';

// Firestore auto-ID charset + max-length-safe. Validating roomName
// shape BEFORE the `db.doc('rooms/${roomName}')` lookup closes a path-
// traversal side-channel: a crafted roomName like `r/messages/m` makes
// `db.doc()` throw (even-segment paths are invalid), which the catch
// handler turns into a 500. Probing 500-vs-404 then distinguishes
// "malformed path" from "no such room" — both should be opaque 404s.
const ROOM_NAME_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

router.post('/livekit/token', async (req, res) => {
  try {
    const { roomName } = req.body || {};

    if (!req.auth.uniqueId) {
      log.warn('livekit', 'Token request from user with no uniqueId', { uid: req.auth.uid });
      return res.status(403).json({ error: 'User profile not found' });
    }
    const identity = String(req.auth.uniqueId);

    if (!roomName || typeof roomName !== 'string') {
      log.warn('livekit', 'Token request missing roomName', { userId: identity });
      return res.status(400).json({ error: 'roomName is required' });
    }

    // UK OSA #17 PR 7 — opaque 404 for malformed roomNames. Returning
    // the same body as "no such room" so a probe can't distinguish
    // "bad path shape" (would trigger 500 in db.doc) from "no room
    // exists". Validate AFTER the shape 400 above so callers
    // debugging integration errors still see the schema error first.
    if (!ROOM_NAME_PATTERN.test(roomName)) {
      return res.status(404).json({ error: 'Not found' });
    }

    // UK OSA #17 PR 7 — cohort gate. Order matters: roomName-shape
    // 400 has already won above so callers debugging integrations
    // see the schema error first. We now do the room lookup +
    // cohort comparison BEFORE the credentials check so a missing-
    // credentials operator-error doesn't accidentally let a cross-
    // cohort caller learn of the room's existence via timing.
    const roomSnap = await db.doc(`rooms/${roomName}`).get();
    if (!roomSnap.exists) {
      // Existence-hiding 404. Byte-identical to the cross-cohort 404
      // body so a probe cannot distinguish "wrong cohort" from "no
      // such room". No audit row is written for this branch — the
      // gate hasn't fired; the caller is simply asking about a
      // non-existent room.
      return res.status(404).json({ error: 'Not found' });
    }
    const roomData = roomSnap.data() || {};
    const callerCohort = cohortFromClaim(req);
    // Reuse `effectiveCohort` so a future room-level `cohortOverride`
    // field (admin-set, audit-logged) is honoured consistently with
    // the user gates. For now `effectiveCohort` falls back to 'minor'
    // when the field is missing — fail-closed, matches the rules.
    const roomCohort = effectiveCohort(roomData);

    // Admin bypass — moderators need to dial into any cohort's room
    // to investigate reports. Mirrors `requireSameCohort`'s bypass.
    const adminClaim = req?.auth?.token?.admin === true;
    if (!adminClaim && callerCohort !== roomCohort) {
      writeSegregationEvent({
        sourceUniqueId: identity,
        sourceCohort: callerCohort,
        // `targetUniqueId` is repurposed here to hold the roomId so
        // the audit schema stays uniform across user-to-user (PR 4
        // middleware) and user-to-room (this PR) gate hits. The
        // additional `targetRoomId` field makes the polymorphism
        // explicit for downstream analytics — moderators can filter
        // by `surface` (or `targetRoomId != null`) to separate room
        // gate-hits from user gate-hits.
        targetUniqueId: String(roomName),
        targetRoomId: String(roomName),
        targetCohort: roomCohort,
        surface: LIVEKIT_SURFACE,
        action: 'blocked',
        timestamp: Date.now(),
        requestId: req?.id ?? null,
      }).catch((err) =>
        log.error('segregationEvents', 'write failed', {
          error: err?.message || String(err),
        }),
      );
      return res.status(404).json({ error: 'Not found' });
    }

    const region = getRegion(req);
    const regionConfig = getRegionConfig(region);

    if (!regionConfig.apiKey || !regionConfig.apiSecret) {
      log.error('livekit', 'LiveKit credentials not configured for region', { region });
      return res.status(503).json({ error: 'Voice service not available' });
    }

    log.info('livekit', 'Generating token', { userId: identity, roomName, region });

    const at = new AccessToken(regionConfig.apiKey, regionConfig.apiSecret, {
      identity,
      ttl: '24h',
    });

    // UK OSA #17 PR 7 — defence-in-depth cohort claim. The Express gate
    // above already refuses to mint a token whose caller cohort doesn't
    // match the room. Stamping the room's cohort onto the JWT metadata
    // lets the LiveKit server reject a stale/mis-routed token at the
    // SFU level too — if the API gate ever regresses, the LiveKit-side
    // policy (or a future inspection at signal-time) can still see the
    // cohort claim and refuse the connect. Stored as a JSON-serialized
    // string per LiveKit's metadata convention (the SDK puts the raw
    // value into the JWT's `metadata` claim verbatim; clients/servers
    // JSON.parse it to recover the structured shape). Pinned by j09
    // scenario "LiveKit access token contains cohort claim matching the
    // room" in journey-tests/j09-voice-room-host.feature.
    at.metadata = JSON.stringify({ cohort: roomCohort });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();

    const response = { token };
    if (process.env.NODE_ENV !== 'local') {
      response.url = regionConfig.url;
    }

    return res.json(response);
  } catch (err) {
    log.error('livekit', 'Failed to generate token', {
      userId: req.auth?.uniqueId,
      error: err.message,
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

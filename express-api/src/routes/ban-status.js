/**
 * Unauthenticated, read-only ban check for the cold-start gate.
 *
 * GET /api/ban-status?deviceId=<id>  → { success, banStatus }
 *
 * **Why this exists (SHY-0143).** The client has to answer "is this device or
 * this network banned?" BEFORE it routes, and at that moment there may be no
 * Firebase session at all — a signed-out user, or one whose ban is the reason
 * they were signed out. `/api/device-info` cannot answer it: it sits behind
 * `authMiddleware`, so the client's `getIdToken()` throws before the request
 * is even built and the repository's catch reports "not banned". A banned user
 * with no session therefore reached the sign-in screen, which the story's
 * acceptance criteria name explicitly as the thing that must never happen.
 *
 * **Why a new route rather than opening up device-info.** That route upserts
 * `deviceBindings/{deviceId}` and runs a binding-cap transaction. It must stay
 * authenticated, and it should not be the thing a client calls on every cold
 * start (and, on Android, every rotation — the Activity is recreated and the
 * whole pre-routing sequence re-runs). This route writes NOTHING.
 *
 * **Exposure.** It is unauthenticated by necessity. What a caller can learn is
 * whether the deviceId they supplied, or the IP they are calling from, is
 * banned — which they can already learn by opening the app. It performs no
 * writes, so it cannot be used to create state, and it is rate-limited by IP
 * in `index.js`. It deliberately does not accept an arbitrary IP to test:
 * network matching always uses the caller's own address.
 *
 * **Fail-open.** `checkBans` reports "no ban" if Firestore errors, matching
 * the long-standing behaviour on the sign-in path: a ban-service blip must not
 * lock out a legitimate user. A real ban is authoritative; an unreachable
 * service is not evidence of one. The client applies the same rule.
 */

const router = require('express').Router();
const { checkBans } = require('../utils/bans');
const { isValidDeviceId } = require('../utils/deviceId');
const { getIpGeo } = require('../utils/ip-geo');
const log = require('../utils/log');

router.get('/ban-status', async (req, res) => {
  const deviceId = req.query?.deviceId;

  // Rejected loudly rather than answered with a cheerful "not banned".
  // Silently reporting no-ban on a malformed request is the exact failure
  // shape this endpoint was created to remove.
  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId is required' });
  }
  if (!isValidDeviceId(deviceId)) {
    return res.status(400).json({ error: 'deviceId is malformed' });
  }

  try {
    // ASN-scoped network bans need the caller's ASN, so this resolves geo the
    // same way the authenticated device-info path does — via the SHARED
    // helper, so the two can never disagree about which ASN a ban is matched
    // against. Best-effort and bounded; on failure `asn` is null and IP and
    // subnet bans still match.
    const geo = await getIpGeo(req.ip);
    const banStatus = await checkBans(deviceId, req.ip, geo.asn || null);
    return res.json({ success: true, banStatus });
  } catch (err) {
    // Unreachable in practice — `checkBans` already swallows its own errors —
    // but an unhandled rejection here would 500 the cold-start gate, and a
    // 500 is one more thing the client would have to interpret. Log it and
    // fail open, consistently with everything else on this path.
    log.error('ban-status', 'ban check failed', { deviceId, error: err.message });
    return res.json({
      success: true,
      banStatus: { isBanned: false, banType: null, reason: null, expiresAt: null },
    });
  }
});

module.exports = router;

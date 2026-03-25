/**
 * LiveKit token generation — replaces generateLiveKitToken Cloud Function.
 *
 * POST /api/livekit/token  -> Generate a LiveKit access token
 */

const router = require('express').Router();
const { AccessToken } = require('livekit-server-sdk');
const log = require('../utils/log');
const { getRegion, getRegionConfig } = require('../utils/livekit-region');

router.post('/livekit/token', async (req, res) => {
  try {
    const { roomName } = req.body || {};
    const identity = String(req.auth.uniqueId);

    if (!roomName || typeof roomName !== 'string') {
      log.warn('livekit', 'Token request missing roomName', { userId: identity });
      return res.status(400).json({ error: 'roomName is required' });
    }

    const region = getRegion(req);
    const regionConfig = getRegionConfig(region);

    log.info('livekit', 'Generating token', { userId: identity, roomName, region });

    const at = new AccessToken(regionConfig.apiKey, regionConfig.apiSecret, {
      identity,
      ttl: '24h',
    });

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

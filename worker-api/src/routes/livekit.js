/**
 * LiveKit token generation — replaces generateLiveKitToken Cloud Function.
 *
 * POST /api/livekit/token  → Generate a LiveKit access token
 */

const { json, jsonError, parseBody } = require('../utils');

function registerLiveKitRoutes(router) {
  router.post('/api/livekit/token', async (request, env) => {
    const body = await parseBody(request);
    const { roomName, identity } = body || {};

    if (!roomName || !identity) {
      return jsonError('roomName and identity are required', 400);
    }

    // Dynamically import livekit-server-sdk
    const { AccessToken } = await import('livekit-server-sdk');

    const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
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
    return json({ token });
  });
}

module.exports = { registerLiveKitRoutes };

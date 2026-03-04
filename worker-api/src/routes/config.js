/**
 * Config routes — read-only app/economy/moderation configuration.
 *
 * GET /api/config/:key     → Get a config value (app, economy, moderation)
 * GET /api/gifts            → Get gift catalog (store-visible)
 * GET /api/gifts/all        → Get all gifts (including hidden)
 * GET /api/coin-packages    → Get active coin packages
 * GET /api/broadcasts       → Get recent broadcasts
 * GET /api/gift-rankings/:giftId → Get gift rankings
 * PUT /api/config/economy   → Admin update economy config (merge)
 */

const { json, jsonError, parseBody } = require('../utils');
const { requireAdmin } = require('../middleware/auth');
const { getDoc, setDoc, queryCollection, fieldFilter, orderBy } = require('../utils/firestore');

function registerConfigRoutes(router) {
  router.get('/api/config/:key', async (request, env, params) => {
    const doc = await getDoc(env, `config/${params.key}`);
    if (!doc) {
      // Return defaults for known config keys
      if (params.key === 'app') {
        return json({ minVersionCode: 1, latestVersionCode: 1, latestVersionName: '' });
      }
      return jsonError('Config not found', 404);
    }
    // Remove the Firestore doc id field, return plain config object
    const { id, ...config } = doc;
    return json(config);
  });

  router.put('/api/config/:key', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;
    const body = await parseBody(request);
    if (!body) return jsonError('Invalid JSON body', 400);
    await setDoc(env, `config/${params.key}`, body);
    return json({ success: true });
  });

  router.get('/api/gifts', async (request, env) => {
    const results = await queryCollection(env, 'gifts', {
      where: fieldFilter('showInStore', 'EQUAL', true),
      orderBy: [orderBy('order')],
    });
    return json(results);
  });

  router.get('/api/gifts/all', async (request, env) => {
    const results = await queryCollection(env, 'gifts', {
      orderBy: [orderBy('order')],
    });
    return json(results);
  });

  router.get('/api/coin-packages', async (request, env) => {
    const results = await queryCollection(env, 'coinPackages', {
      where: fieldFilter('isActive', 'EQUAL', true),
      orderBy: [orderBy('order')],
    });
    return json(results);
  });

  router.get('/api/broadcasts', async (request, env) => {
    const results = await queryCollection(env, 'broadcasts', {
      orderBy: [orderBy('timestamp', 'DESCENDING')],
      limit: 50,
    });
    return json(results);
  });

  router.get('/api/gift-rankings/:giftId', async (request, env, params) => {
    const doc = await getDoc(env, `giftRankings/${params.giftId}`);

    return json({
      rankings: doc?.rankings || [],
      totalSent: doc?.totalSent || 0,
      lastUpdated: doc?.lastUpdated || null,
    });
  });

  // ── Economy config (admin) ──
  router.put('/api/config/economy', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await parseBody(request);
    if (!body) return jsonError('Invalid JSON body', 400);

    const ECONOMY_CONFIG_FIELDS = [
      'beanConversionRate', 'beanRedeemBonusThreshold', 'beanRedeemBonusMultiplier',
      'pullCosts', 'broadcastSendThreshold', 'broadcastWinThreshold',
      'dropRateExponent', 'pitySoftStart', 'pityHardLimit', 'pitySoftMaxShift',
      'pityHighValueThreshold', 'dailyBase', 'milestoneRewards',
    ];

    const filtered = {};
    for (const key of ECONOMY_CONFIG_FIELDS) {
      if (key in body) filtered[key] = body[key];
    }

    if (Object.keys(filtered).length === 0) {
      return jsonError('No valid economy config fields', 400);
    }

    // Merge with existing config
    const existing = await getDoc(env, 'config/economy') || {};
    const { id: _id, ...currentConfig } = existing;
    const merged = { ...currentConfig, ...filtered };

    await setDoc(env, 'config/economy', merged);

    return json(merged);
  });
}

module.exports = { registerConfigRoutes };

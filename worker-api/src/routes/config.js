/**
 * Config routes — read-only app/economy/moderation configuration.
 *
 * GET /api/config/:key     → Get a config value (app, economy, moderation)
 * GET /api/gifts            → Get gift catalog
 * GET /api/gifts/all        → Get all gifts (including hidden)
 * GET /api/coin-packages    → Get active coin packages
 * GET /api/broadcasts       → Get recent broadcasts
 * GET /api/gift-rankings/:giftId → Get gift rankings
 */

const { json, jsonError, parseBody } = require('../utils');
const { requireAdmin } = require('../middleware/auth');

async function getConfig(params, env) {
  const { key } = params;
  const row = await env.DB.prepare('SELECT value FROM config WHERE key = ?').bind(key).first();
  if (!row) return jsonError('Config not found', 404);
  return json(JSON.parse(row.value));
}

async function getGiftCatalog(env) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM gifts WHERE show_in_store = 1 ORDER BY "order" ASC'
  ).all();
  return json(results);
}

async function getAllGifts(env) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM gifts ORDER BY "order" ASC'
  ).all();
  return json(results);
}

async function getCoinPackages(env) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM coin_packages WHERE is_active = 1 ORDER BY "order" ASC'
  ).all();
  return json(results);
}

async function getBroadcasts(env) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM broadcasts ORDER BY timestamp DESC LIMIT 50'
  ).all();
  return json(results);
}

async function getGiftRankings(params, env) {
  const { giftId } = params;

  const meta = await env.DB.prepare(
    'SELECT * FROM gift_rankings_meta WHERE gift_id = ?'
  ).bind(giftId).first();

  const { results: rankings } = await env.DB.prepare(
    'SELECT * FROM gift_rankings WHERE gift_id = ? ORDER BY rank ASC LIMIT 100'
  ).bind(giftId).all();

  return json({
    rankings,
    totalSent: meta?.total_sent || 0,
    lastUpdated: meta?.last_updated || null,
  });
}

function registerConfigRoutes(router) {
  router.get('/api/config/:key', async (request, env, params) => {
    return getConfig(params, env);
  });

  router.get('/api/gifts', async (request, env) => {
    return getGiftCatalog(env);
  });

  router.get('/api/gifts/all', async (request, env) => {
    return getAllGifts(env);
  });

  router.get('/api/coin-packages', async (request, env) => {
    return getCoinPackages(env);
  });

  router.get('/api/broadcasts', async (request, env) => {
    return getBroadcasts(env);
  });

  router.get('/api/gift-rankings/:giftId', async (request, env, params) => {
    return getGiftRankings(params, env);
  });

  // ── Economy config (admin — GET already handled by /api/config/:key) ──

  // PUT /api/config/economy — admin update economy config (merge-update)
  router.put('/api/config/economy', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await parseBody(request);
    if (!body) return jsonError('Invalid JSON body', 400);

    // Validate known economy config fields
    const ECONOMY_CONFIG_FIELDS = [
      'beanConversionRate', 'beanRedeemBonusThreshold', 'beanRedeemBonusMultiplier',
      'pullCosts', 'broadcastSendThreshold', 'broadcastWinThreshold',
      'dropRateExponent', 'pitySoftStart', 'pityHardLimit', 'pitySoftMaxShift',
      'pityHighValueThreshold', 'dailyBase', 'milestoneRewards',
    ];

    // Only allow known fields
    const filtered = {};
    for (const key of ECONOMY_CONFIG_FIELDS) {
      if (key in body) filtered[key] = body[key];
    }

    if (Object.keys(filtered).length === 0) {
      return jsonError('No valid economy config fields', 400);
    }

    // Merge with existing config
    const existing = await env.DB.prepare("SELECT value FROM config WHERE key = 'economy'").first();
    const current = existing ? JSON.parse(existing.value) : {};
    const merged = { ...current, ...filtered };

    await env.DB.prepare(`
      INSERT INTO config (key, value) VALUES ('economy', ?)
      ON CONFLICT(key) DO UPDATE SET value = ?
    `).bind(JSON.stringify(merged), JSON.stringify(merged)).run();

    return json(merged);
  });
}

module.exports = { registerConfigRoutes };

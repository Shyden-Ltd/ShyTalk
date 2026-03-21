/**
 * Config routes — read-only app/economy/moderation configuration.
 *
 * GET /api/config/:key     -> Get a config value (app, economy, moderation)
 * PUT /api/config/:key     -> Admin update config (merge)
 * GET /api/gifts           -> Get gift catalog (store-visible)
 * GET /api/gifts/all       -> Get all gifts (including hidden)
 * GET /api/coin-packages   -> Get active coin packages
 * GET /api/broadcasts      -> Get recent broadcasts
 * GET /api/gift-rankings/:giftId -> Get gift rankings
 * PUT /api/config/economy  -> Admin update economy config (merge)
 */

const crypto = require('crypto');
const router = require('express').Router();
const { db } = require('../utils/firebase');
const { requireAdmin } = require('../middleware/auth');
const { queryDocs } = require('../utils/firestore-helpers');
const log = require('../utils/log');

// -- Starting screens helpers --

function computeContentHash(screen) {
  const hashFields = {
    title: screen.title,
    message: screen.message,
    template: screen.template,
    imageType: screen.imageType || null,
    backgroundImage: screen.backgroundImage || null,
    dismissable: screen.dismissable,
    frequency: screen.frequency,
  };
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(hashFields, Object.keys(hashFields).sort()))
    .digest('hex');
}

function isScreenActive(screen, now) {
  if (!screen.enabled) return false;
  if (screen.startDate && new Date(screen.startDate).getTime() > now) return false;
  if (screen.endDate && new Date(screen.endDate).getTime() <= now) return false;
  return true;
}

function cidrMatch(ip, cidr) {
  const [range, bits] = cidr.split('/');
  const mask = ~(2 ** (32 - parseInt(bits)) - 1) >>> 0;
  const ipNum = ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct), 0) >>> 0;
  const rangeNum = range.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct), 0) >>> 0;
  return (ipNum & mask) === (rangeNum & mask);
}

function normalizeIp(ip) {
  // Strip IPv6-mapped IPv4 prefix (e.g. ::ffff:127.0.0.1 → 127.0.0.1)
  if (ip && ip.startsWith('::ffff:')) return ip.slice(7);
  return ip;
}

function isAllowlisted(screen, deviceId, ip) {
  if (!screen.allowlist) return false;
  const { deviceIds = [], networks = [] } = screen.allowlist;
  if (deviceId && deviceIds.includes(deviceId)) return true;
  const normalizedIp = normalizeIp(ip);
  if (normalizedIp) {
    for (const network of networks) {
      if (network.includes('/')) {
        if (cidrMatch(normalizedIp, network)) return true;
      } else if (normalizedIp === network) return true;
    }
  }
  return false;
}

// -- Get starting screens (public, auth-exempt) --
router.get('/config/startingScreens', async (req, res) => {
  try {
    const snap = await db.doc('config/startingScreens').get();
    if (!snap.exists) return res.json({});

    const allScreens = snap.data();
    const now = Date.now();
    const deviceId = req.headers['x-device-id'];
    const ip = req.ip;
    const result = {};

    const sortedIds = Object.keys(allScreens).sort();
    for (const id of sortedIds) {
      const screen = allScreens[id];
      if (!isScreenActive(screen, now)) continue;

      const dismissable =
        screen.dismissable === false && isAllowlisted(screen, deviceId, ip)
          ? true
          : screen.dismissable;

      result[id] = {
        enabled: screen.enabled,
        dismissable,
        frequency: screen.frequency,
        template: screen.template,
        title: screen.title,
        message: screen.message,
        imageType: screen.imageType || null,
        backgroundImage: screen.backgroundImage || null,
        startDate: screen.startDate || null,
        endDate: screen.endDate || null,
        contentHash: computeContentHash(screen),
        lastModifiedAt: screen.lastModifiedAt || null,
      };
    }

    log.info('config', 'Starting screens fetched', {
      screenCount: Object.keys(result).length,
      deviceId: deviceId ? '(present)' : '(absent)',
    });

    return res.json(result);
  } catch (err) {
    log.error('config', 'Error fetching starting screens', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Get config value --
router.get('/config/:key', async (req, res) => {
  try {
    const snap = await db.doc(`config/${req.params.key}`).get();
    if (!snap.exists) {
      // Return defaults for known config keys
      if (req.params.key === 'app') {
        return res.json({ minVersionCode: 1, latestVersionCode: 1, latestVersionName: '' });
      }
      if (req.params.key === 'economy') {
        const defaults = {
          beanConversionRate: 0.6,
          beanRedeemBonusThreshold: 2000,
          beanRedeemBonusMultiplier: 1.1,
          pullCosts: { 1: 10, 10: 100, 100: 1000 },
          broadcastSendThreshold: 0,
          broadcastWinThreshold: 5000,
          dropRateExponent: 1.5,
          pitySoftStart: 80,
          pityHardLimit: 120,
          pitySoftMaxShift: 0.15,
          pityHighValueThreshold: 5000,
          dailyBase: 50,
          milestoneRewards: { 7: 100, 14: 200, 30: 500, 60: 1000, 90: 2000 },
        };
        await db.doc('config/economy').set(defaults);
        return res.json(defaults);
      }
      return res.status(404).json({ error: 'Config not found' });
    }
    // Remove the Firestore doc id field, return plain config object
    const { id: _id, ...config } = { id: snap.id, ...snap.data() };
    res.set('Cache-Control', 'public, max-age=300');
    return res.json(config);
  } catch (err) {
    log.error('config', 'Error fetching config', { key: req.params.key, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Economy config (admin, with field whitelist) --
// Must be defined BEFORE the generic PUT /config/:key route
router.put('/config/economy', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body) return res.status(400).json({ error: 'Invalid JSON body' });

    const ECONOMY_CONFIG_FIELDS = [
      'beanConversionRate',
      'beanRedeemBonusThreshold',
      'beanRedeemBonusMultiplier',
      'pullCosts',
      'broadcastSendThreshold',
      'broadcastWinThreshold',
      'dropRateExponent',
      'pitySoftStart',
      'pityHardLimit',
      'pitySoftMaxShift',
      'pityHighValueThreshold',
      'dailyBase',
      'milestoneRewards',
      'wheelInnerThreshold',
      'maxRoomDurationMinutes',
      'superShyRoomDurationMinutes',
    ];

    const filtered = {};
    for (const key of ECONOMY_CONFIG_FIELDS) {
      if (key in body) filtered[key] = body[key];
    }

    if (Object.keys(filtered).length === 0) {
      return res.status(400).json({ error: 'No valid economy config fields' });
    }

    // Merge with existing config
    const snap = await db.doc('config/economy').get();
    const currentConfig = snap.exists ? snap.data() : {};
    const merged = { ...currentConfig, ...filtered };

    await db.doc('config/economy').set(merged);

    return res.json(merged);
  } catch (err) {
    log.error('config', 'Error updating economy config', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Allowed fields per config key to prevent mass assignment
const CONFIG_ALLOWED_FIELDS = {
  app: [
    'minVersionCode',
    'latestVersionCode',
    'latestVersionName',
    'maintenanceMode',
    'maintenanceMessage',
  ],
  moderation: ['maxWarnings', 'suspensionDays', 'autoModEnabled', 'bannedWords', 'reportThreshold'],
};

// -- Update config value (admin) --
router.put('/config/:key', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body || typeof body !== 'object')
      return res.status(400).json({ error: 'Invalid JSON body' });

    const allowedFields = CONFIG_ALLOWED_FIELDS[req.params.key];
    if (!allowedFields) {
      return res.status(400).json({
        error: `Unknown config key: ${req.params.key}. Use a dedicated endpoint for economy config.`,
      });
    }

    // Filter to only allowed fields
    const filtered = {};
    for (const field of allowedFields) {
      if (field in body) filtered[field] = body[field];
    }
    if (Object.keys(filtered).length === 0) {
      return res.status(400).json({ error: 'No valid fields provided' });
    }

    await db.doc(`config/${req.params.key}`).set(filtered, { merge: true });

    return res.json({ success: true });
  } catch (err) {
    log.error('config', 'Error updating config', { key: req.params.key, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Get gift catalog (store-visible) --
router.get('/gifts', async (req, res) => {
  try {
    const results = await queryDocs(
      db.collection('gifts').where('showInStore', '==', true).orderBy('order'),
    );
    res.set('Cache-Control', 'public, max-age=300');
    return res.json(results);
  } catch (err) {
    log.error('config', 'Error fetching gifts', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Get all gifts (including hidden) --
router.get('/gifts/all', async (req, res) => {
  try {
    const results = await queryDocs(db.collection('gifts').orderBy('order'));
    return res.json(results);
  } catch (err) {
    log.error('config', 'Error fetching all gifts', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Get active coin packages --
router.get('/coin-packages', async (req, res) => {
  try {
    const results = await queryDocs(
      db.collection('coinPackages').where('isActive', '==', true).orderBy('order'),
    );
    res.set('Cache-Control', 'public, max-age=300');
    return res.json(results);
  } catch (err) {
    log.error('config', 'Error fetching coin packages', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Get recent broadcasts --
router.get('/broadcasts', async (req, res) => {
  try {
    const results = await queryDocs(
      db.collection('broadcasts').orderBy('timestamp', 'desc').limit(50),
    );
    res.set('Cache-Control', 'public, max-age=60');
    return res.json(results);
  } catch (err) {
    log.error('config', 'Error fetching broadcasts', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Get gift rankings --
router.get('/gift-rankings/:giftId', async (req, res) => {
  try {
    const snap = await db.doc(`giftRankings/${req.params.giftId}`).get();
    const doc = snap.exists ? snap.data() : null;

    return res.json({
      rankings: doc?.rankings || [],
      totalSent: doc?.totalSent || 0,
      lastUpdated: doc?.lastUpdated || null,
    });
  } catch (err) {
    log.error('config', 'Error fetching gift rankings', {
      giftId: req.params.giftId,
      error: err.message,
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

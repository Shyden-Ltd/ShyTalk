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

const router = require('express').Router();
const { db } = require('../utils/firebase');
const { requireAdmin } = require('../middleware/auth');

async function queryDocs(ref) {
  const snap = await ref.get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// -- Get config value --
router.get('/api/config/:key', async (req, res) => {
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
          pullCosts: { '1': 10, '10': 100, '100': 1000 },
          broadcastSendThreshold: 0,
          broadcastWinThreshold: 5000,
          dropRateExponent: 1.5,
          pitySoftStart: 80,
          pityHardLimit: 120,
          pitySoftMaxShift: 0.15,
          pityHighValueThreshold: 5000,
          dailyBase: 50,
          milestoneRewards: { '7': 100, '14': 200, '30': 500, '60': 1000, '90': 2000 },
        };
        await db.doc('config/economy').set(defaults);
        return res.json(defaults);
      }
      return res.status(404).json({ error: 'Config not found' });
    }
    // Remove the Firestore doc id field, return plain config object
    const { id, ...config } = { id: snap.id, ...snap.data() };
    return res.json(config);
  } catch (err) {
    console.error('Error fetching config:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Update config value (admin) --
router.put('/api/config/:key', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body) return res.status(400).json({ error: 'Invalid JSON body' });

    await db.doc(`config/${req.params.key}`).set(body, { merge: true });

    return res.json({ success: true });
  } catch (err) {
    console.error('Error updating config:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Get gift catalog (store-visible) --
router.get('/api/gifts', async (req, res) => {
  try {
    const results = await queryDocs(
      db.collection('gifts').where('showInStore', '==', true).orderBy('order')
    );
    return res.json(results);
  } catch (err) {
    console.error('Error fetching gifts:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Get all gifts (including hidden) --
router.get('/api/gifts/all', async (req, res) => {
  try {
    const results = await queryDocs(
      db.collection('gifts').orderBy('order')
    );
    return res.json(results);
  } catch (err) {
    console.error('Error fetching all gifts:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Get active coin packages --
router.get('/api/coin-packages', async (req, res) => {
  try {
    const results = await queryDocs(
      db.collection('coinPackages').where('isActive', '==', true).orderBy('order')
    );
    return res.json(results);
  } catch (err) {
    console.error('Error fetching coin packages:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Get recent broadcasts --
router.get('/api/broadcasts', async (req, res) => {
  try {
    const results = await queryDocs(
      db.collection('broadcasts').orderBy('timestamp', 'desc').limit(50)
    );
    return res.json(results);
  } catch (err) {
    console.error('Error fetching broadcasts:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Get gift rankings --
router.get('/api/gift-rankings/:giftId', async (req, res) => {
  try {
    const snap = await db.doc(`giftRankings/${req.params.giftId}`).get();
    const doc = snap.exists ? snap.data() : null;

    return res.json({
      rankings: doc?.rankings || [],
      totalSent: doc?.totalSent || 0,
      lastUpdated: doc?.lastUpdated || null,
    });
  } catch (err) {
    console.error('Error fetching gift rankings:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Economy config (admin) --
router.put('/api/config/economy', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body) return res.status(400).json({ error: 'Invalid JSON body' });

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
      return res.status(400).json({ error: 'No valid economy config fields' });
    }

    // Merge with existing config
    const snap = await db.doc('config/economy').get();
    const currentConfig = snap.exists ? snap.data() : {};
    const merged = { ...currentConfig, ...filtered };

    await db.doc('config/economy').set(merged);

    return res.json(merged);
  } catch (err) {
    console.error('Error updating economy config:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

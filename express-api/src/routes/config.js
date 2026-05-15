/**
 * Config routes — read-only app/economy/moderation configuration.
 *
 * GET /api/firebase-config  -> Public Firebase web config (no secrets)
 * GET /api/config/:key     -> Get a config value (app, economy, moderation)
 * PUT /api/config/:key     -> Admin update config (merge)
 * GET /api/gifts           -> Get gift catalog (store-visible)
 * GET /api/gifts/all       -> Get all gifts (including hidden)
 * GET /api/coin-packages   -> Get active coin packages
 * GET /api/broadcasts      -> Get recent broadcasts
 * GET /api/gift-rankings/:giftId -> Get gift rankings
 * PUT /api/config/economy  -> Admin update economy config (merge)
 * DELETE /api/config/startingScreens/:screenId -> Admin delete a starting screen
 */

const crypto = require('node:crypto');
const router = require('express').Router();
const { db } = require('../utils/firebase');
const { requireAdmin, isLiveAdmin } = require('../middleware/auth');
const { cohortFromClaim } = require('../utils/firebase-claims');
const { filterListByCohort } = require('../utils/cohort-filter');
const { queryDocs } = require('../utils/firestore-helpers');
const log = require('../utils/log');

// -- Public Firebase web config (contains no secrets) --

router.get('/firebase-config', (req, res) => {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  const projectId =
    process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'shytalk-7ba69';
  const authDomain = projectId + '.firebaseapp.com';

  if (!apiKey) {
    return res.status(503).json({ error: 'Firebase config not available' });
  }

  res.json({ apiKey, authDomain, projectId });
});

// -- Starting screens helpers --

function computeContentHash(screen) {
  const hashFields = {
    title: screen.title,
    message: screen.message,
    template: screen.template,
    imageType: screen.imageType || null,
    backgroundImage: screen.backgroundImage || null,
    backgroundImageFit: screen.backgroundImageFit || 'cover',
    dismissable: screen.dismissable,
    frequency: screen.frequency,
  };
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify(
        hashFields,
        Object.keys(hashFields).sort((a, b) => a.localeCompare(b)),
      ),
    )
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
  const mask = ~(2 ** (32 - Number.parseInt(bits, 10)) - 1) >>> 0;
  const ipNum = ip.split('.').reduce((acc, oct) => (acc << 8) + Number.parseInt(oct, 10), 0) >>> 0;
  const rangeNum =
    range.split('.').reduce((acc, oct) => (acc << 8) + Number.parseInt(oct, 10), 0) >>> 0;
  return (ipNum & mask) === (rangeNum & mask);
}

function normalizeIp(ip) {
  // Strip IPv6-mapped IPv4 prefix (e.g. ::ffff:127.0.0.1 → 127.0.0.1)
  if (ip?.startsWith('::ffff:')) return ip.slice(7);
  return ip;
}

function matchesNetwork(normalizedIp, network) {
  if (network.includes('/')) {
    // Only attempt CIDR match if both IP and network are IPv4
    if (!normalizedIp.includes(':') && !network.includes(':')) {
      return cidrMatch(normalizedIp, network);
    }
    return false; // Skip IPv6 CIDR matching (not implemented)
  }
  return normalizedIp === network;
}

function isAllowlisted(screen, deviceId, ip) {
  if (!screen.allowlist) return false;
  const { deviceIds = [], networks = [] } = screen.allowlist;
  if (deviceId && deviceIds.includes(deviceId)) return true;
  const normalizedIp = normalizeIp(ip);
  if (!normalizedIp) return false;
  return networks.some((network) => matchesNetwork(normalizedIp, network));
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
    let hasAllowlistOverride = false;

    const sortedIds = Object.keys(allScreens).sort((a, b) => a.localeCompare(b));
    for (const id of sortedIds) {
      const screen = allScreens[id];
      if (screen.deleted) continue;
      if (!isScreenActive(screen, now)) continue;

      let dismissable = screen.dismissable;
      if (screen.dismissable === false && isAllowlisted(screen, deviceId, ip)) {
        hasAllowlistOverride = true;
        dismissable = true;
      }

      result[id] = {
        enabled: screen.enabled,
        dismissable,
        frequency: screen.frequency,
        template: screen.template,
        title: screen.title,
        message: screen.message,
        imageType: screen.imageType || null,
        backgroundImage: screen.backgroundImage || null,
        backgroundImageFit: screen.backgroundImageFit || 'cover',
        startDate: screen.startDate || null,
        endDate: screen.endDate || null,
        contentHash: computeContentHash(screen),
        lastModifiedAt: screen.lastModifiedAt || null,
      };
    }

    res.set('X-Content-Type-Options', 'nosniff');

    res.set('Cache-Control', 'public, max-age=60');

    if (!hasAllowlistOverride) {
      const etag =
        '"' +
        crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex').slice(0, 16) +
        '"';
      res.set('ETag', etag);
      if (req.headers['if-none-match'] === etag) {
        return res.status(304).end();
      }
    }

    return res.json(result);
  } catch (err) {
    log.error('config', 'Error fetching starting screens', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Get starting screens for admin (includes allowlist + lastModifiedBy) --
router.get('/config/startingScreens/admin', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const snap = await db.doc('config/startingScreens').get();
    if (!snap.exists) return res.json({});

    return res.json(snap.data());
  } catch (err) {
    log.error('config', 'Error fetching starting screens (admin)', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Starting screens PUT helpers --

const VALID_FREQUENCIES = ['every_launch', 'once'];
const VALID_TEMPLATES = ['warning', 'promotional', 'announcement', 'info'];
const VALID_IMAGE_TYPES = ['police_duck'];
const SCREEN_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

const SCREEN_FIELDS = [
  'enabled',
  'dismissable',
  'frequency',
  'template',
  'title',
  'message',
  'imageType',
  'backgroundImage',
  'backgroundImageFit',
  'startDate',
  'endDate',
  'allowlist',
  'deleted',
  'deletedAt',
  'deletedBy',
];

/**
 * Strip zero-width chars except ZWJ (U+200D), trim, NFC normalise.
 */
function sanitiseTitle(title) {
  // Remove zero-width chars: U+200B, U+200C, U+200E, U+200F, U+FEFF, U+2060
  // Keep U+200D (ZWJ)
  let result = title.replaceAll(/[\u200B\u200C\u200E\u200F\uFEFF\u2060]/g, '');
  result = result.trim();
  result = result.normalize('NFC');
  return result;
}

/**
 * Strip control chars except \n \r \t, collapse >2 consecutive newlines to 2, trim, NFC normalise.
 */
function sanitiseMessage(message) {
  // Remove control characters except \n (0x0A), \r (0x0D), \t (0x09)
  // eslint-disable-next-line no-control-regex
  let result = message.replaceAll(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Collapse >2 consecutive newlines to 2
  result = result.replaceAll(/\n{3,}/g, '\n\n');
  result = result.trim();
  result = result.normalize('NFC');
  return result;
}

/**
 * Validate an ISO 8601 date string with time component ('T' required).
 * Returns true if valid, false otherwise.
 */
function isValidIsoDate(str) {
  if (typeof str !== 'string') return false;
  if (!str.includes('T')) return false;
  const d = new Date(str);
  return !Number.isNaN(d.getTime());
}

function validateDates(id, screen, existingEndDate) {
  if (screen.startDate !== null && screen.startDate !== undefined) {
    if (!isValidIsoDate(screen.startDate)) {
      return {
        error: `Screen "${id}": startDate must be a valid ISO 8601 string with time`,
        field: 'startDate',
      };
    }
  }
  if (screen.endDate !== null && screen.endDate !== undefined) {
    if (!isValidIsoDate(screen.endDate)) {
      return {
        error: `Screen "${id}": endDate must be a valid ISO 8601 string with time`,
        field: 'endDate',
      };
    }
    const endDateChanged = screen.endDate !== existingEndDate;
    if (endDateChanged && new Date(screen.endDate).getTime() <= Date.now()) {
      return { error: `Screen "${id}": endDate must be in the future`, field: 'endDate' };
    }
  }
  if (screen.startDate && screen.endDate) {
    if (new Date(screen.startDate).getTime() >= new Date(screen.endDate).getTime()) {
      return { error: `Screen "${id}": startDate must be before endDate`, field: 'startDate' };
    }
  }
  return null;
}

function validateDeviceIds(id, deviceIds) {
  if (deviceIds === undefined) return null;
  if (!Array.isArray(deviceIds)) {
    return {
      error: `Screen "${id}": allowlist.deviceIds must be an array`,
      field: 'allowlist.deviceIds',
    };
  }
  for (const did of deviceIds) {
    if (typeof did !== 'string' || did === '') {
      return {
        error: `Screen "${id}": allowlist.deviceIds must contain non-empty strings`,
        field: 'allowlist.deviceIds',
      };
    }
  }
  return null;
}

function validateNetworks(id, networks) {
  if (networks === undefined) return null;
  if (!Array.isArray(networks)) {
    return {
      error: `Screen "${id}": allowlist.networks must be an array`,
      field: 'allowlist.networks',
    };
  }
  for (const net of networks) {
    if (typeof net !== 'string' || net === '') {
      return {
        error: `Screen "${id}": each allowlist network must be a non-empty string`,
        field: 'allowlist.networks',
      };
    }
    if (net.includes('/') && net.split('/')[1] === '0') {
      return {
        error: `Screen "${id}": CIDR /0 not allowed in allowlist.networks`,
        field: 'allowlist.networks',
      };
    }
  }
  return null;
}

function validateAllowlist(id, allowlist) {
  if (typeof allowlist !== 'object' || Array.isArray(allowlist)) {
    return { error: `Screen "${id}": allowlist must be an object`, field: 'allowlist' };
  }
  return (
    validateDeviceIds(id, allowlist.deviceIds) || validateNetworks(id, allowlist.networks) || null
  );
}

/** Validate required screen fields (enabled, dismissable, frequency, template). */
function validateRequiredScreenFields(id, screen) {
  if (!screen || typeof screen !== 'object' || Array.isArray(screen)) {
    return { error: `Screen "${id}" must be an object`, field: id };
  }
  if (typeof screen.enabled !== 'boolean') {
    return { error: `Screen "${id}": enabled must be a boolean`, field: 'enabled' };
  }
  if (typeof screen.dismissable !== 'boolean') {
    return { error: `Screen "${id}": dismissable must be a boolean`, field: 'dismissable' };
  }
  if (!VALID_FREQUENCIES.includes(screen.frequency)) {
    return { error: `Screen "${id}": invalid frequency`, field: 'frequency' };
  }
  if (!VALID_TEMPLATES.includes(screen.template)) {
    return { error: `Screen "${id}": invalid template`, field: 'template' };
  }
  return null;
}

/** Validate optional screen fields (imageType, backgroundImage, backgroundImageFit). */
function validateOptionalScreenFields(id, screen) {
  if (
    screen.imageType !== null &&
    screen.imageType !== undefined &&
    !VALID_IMAGE_TYPES.includes(screen.imageType)
  ) {
    return { error: `Screen "${id}": invalid imageType`, field: 'imageType' };
  }
  if (screen.backgroundImage !== null && screen.backgroundImage !== undefined) {
    if (typeof screen.backgroundImage !== 'string' || screen.backgroundImage === '') {
      return {
        error: `Screen "${id}": backgroundImage must be a non-empty string or null`,
        field: 'backgroundImage',
      };
    }
  }
  const VALID_BG_FITS = ['cover', 'contain', '100% 100%'];
  if (
    screen.backgroundImageFit !== null &&
    screen.backgroundImageFit !== undefined &&
    !VALID_BG_FITS.includes(screen.backgroundImageFit)
  ) {
    return {
      error: `Screen "${id}": backgroundImageFit must be "cover", "contain", or "100% 100%"`,
      field: 'backgroundImageFit',
    };
  }
  return null;
}

/**
 * Validate a single screen entry.
 * On success: returns { sanitisedTitle, sanitisedMessage }.
 * On failure: returns { error, field }.
 */
function validateScreen(id, screen, existingEndDate) {
  const requiredErr = validateRequiredScreenFields(id, screen);
  if (requiredErr) return requiredErr;

  if (typeof screen.title !== 'string') {
    return { error: `Screen "${id}": title must be a string`, field: 'title' };
  }
  const sanitisedTitle = sanitiseTitle(screen.title);
  const titleLength = [...sanitisedTitle].length;
  if (titleLength < 3 || titleLength > 100) {
    return {
      error: `Screen "${id}": title must be 3-100 characters (got ${titleLength})`,
      field: 'title',
    };
  }
  if (typeof screen.message !== 'string') {
    return { error: `Screen "${id}": message must be a string`, field: 'message' };
  }
  const sanitisedMessage = sanitiseMessage(screen.message);
  const messageLength = [...sanitisedMessage].length;
  if (messageLength < 10 || messageLength > 500) {
    return {
      error: `Screen "${id}": message must be 10-500 characters (got ${messageLength})`,
      field: 'message',
    };
  }

  const optionalErr = validateOptionalScreenFields(id, screen);
  if (optionalErr) return optionalErr;

  const dateErr = validateDates(id, screen, existingEndDate);
  if (dateErr) return dateErr;

  if (screen.allowlist !== null && screen.allowlist !== undefined) {
    const allowlistErr = validateAllowlist(id, screen.allowlist);
    if (allowlistErr) return allowlistErr;
  }
  return { sanitisedTitle, sanitisedMessage };
}

/** Build a clean screen object from validated data. */
function buildCleanScreen(screen, result) {
  const clean = {};
  const NULL_DEFAULT_FIELDS = new Set(['imageType', 'backgroundImage', 'startDate', 'endDate']);
  for (const field of SCREEN_FIELDS) {
    if (field === 'title') {
      clean.title = result.sanitisedTitle;
    } else if (field === 'message') {
      clean.message = result.sanitisedMessage;
    } else if (field === 'allowlist') {
      clean.allowlist = screen.allowlist
        ? { deviceIds: screen.allowlist.deviceIds || [], networks: screen.allowlist.networks || [] }
        : { deviceIds: [], networks: [] };
    } else if (field in screen) {
      clean[field] = screen[field];
    } else if (field === 'backgroundImageFit') {
      clean[field] = 'cover';
    } else if (NULL_DEFAULT_FIELDS.has(field)) {
      clean[field] = null;
    }
  }
  return clean;
}

// -- Update starting screens (admin) --
router.put('/config/startingScreens', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Request body must be a JSON object' });
    }

    const snap = await db.doc('config/startingScreens').get();
    const existing = snap.exists ? snap.data() : {};

    // Validate all screen entries first
    const validatedScreens = {};
    for (const [id, screen] of Object.entries(body)) {
      if (!id || !SCREEN_ID_REGEX.test(id)) {
        return res.status(400).json({
          error: `Invalid screen ID: "${id}". Must match ${SCREEN_ID_REGEX}`,
          field: 'screenId',
        });
      }

      const result = validateScreen(id, screen, existing[id]?.endDate || undefined);
      if (result.error) {
        return res.status(400).json({ error: result.error, field: result.field });
      }

      validatedScreens[id] = buildCleanScreen(screen, result);
    }

    // Build merged state
    const merged = { ...existing, ...validatedScreens };

    // Blocking constraint: max 1 non-dismissable screen enabled at a time
    const nonDismissable = Object.keys(merged).filter(
      (id) => merged[id].enabled && merged[id].dismissable === false && !merged[id].deleted,
    );
    if (nonDismissable.length > 1) {
      const existingBlocker =
        nonDismissable.find((id) => !(id in validatedScreens)) || nonDismissable[0];
      return res.status(409).json({
        error: 'Only one non-dismissable screen can be enabled at a time',
        existingBlocker,
      });
    }

    // Set audit fields
    const now = new Date().toISOString();
    for (const id of Object.keys(validatedScreens)) {
      merged[id].lastModifiedBy = req.auth.uniqueId;
      merged[id].lastModifiedAt = now;
    }

    await db.doc('config/startingScreens').set(merged);

    log.info('config', 'Starting screens updated', {
      updatedIds: Object.keys(validatedScreens),
      totalScreens: Object.keys(merged).length,
      admin: req.auth.uniqueId,
    });

    return res.json({ success: true, updated: Object.keys(validatedScreens) });
  } catch (err) {
    log.error('config', 'Error updating starting screens', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Restore a soft-deleted starting screen (admin) --
router.post('/config/startingScreens/:screenId/restore', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const { screenId } = req.params;
    if (!screenId || !/^[a-zA-Z0-9_-]+$/.test(screenId)) {
      return res.status(400).json({ error: 'Invalid screen ID' });
    }

    const snap = await db.doc('config/startingScreens').get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'No starting screens configured' });
    }

    const existing = snap.data();
    if (!(screenId in existing)) {
      return res.status(404).json({ error: `Screen "${screenId}" not found` });
    }

    if (!existing[screenId].deleted) {
      return res.status(400).json({ error: `Screen "${screenId}" is not deleted` });
    }

    existing[screenId].deleted = false;
    delete existing[screenId].deletedAt;
    delete existing[screenId].deletedBy;
    existing[screenId].restoredAt = new Date().toISOString();
    existing[screenId].restoredBy = req.auth.uniqueId;

    await db.doc('config/startingScreens').set(existing);

    log.info('config', 'Starting screen restored', {
      screenId,
      admin: req.auth.uniqueId,
    });

    return res.json({ success: true, restored: screenId });
  } catch (err) {
    log.error('config', 'Error restoring starting screen', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Delete a single starting screen (admin) --
// Without ?permanent=true: soft-delete (sets deleted: true)
// With ?permanent=true: hard-delete (removes from Firestore)
router.delete('/config/startingScreens/:screenId', async (req, res) => {
  try {
    if (await requireAdmin(req, res)) return;

    const { screenId } = req.params;
    if (!screenId || !/^[a-zA-Z0-9_-]+$/.test(screenId)) {
      return res.status(400).json({ error: 'Invalid screen ID' });
    }

    const snap = await db.doc('config/startingScreens').get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'No starting screens configured' });
    }

    const existing = snap.data();
    if (!(screenId in existing)) {
      return res.status(404).json({ error: `Screen "${screenId}" not found` });
    }

    const permanent = req.query.permanent === 'true';

    if (permanent) {
      // Hard-delete: remove from Firestore entirely
      delete existing[screenId];
      await db.doc('config/startingScreens').set(existing);

      log.info('config', 'Starting screen permanently deleted', {
        screenId,
        remainingScreens: Object.keys(existing).length,
        admin: req.auth.uniqueId,
      });

      return res.json({ success: true, deleted: screenId, permanent: true });
    } else {
      // Soft-delete: mark as deleted
      existing[screenId].deleted = true;
      existing[screenId].deletedAt = new Date().toISOString();
      existing[screenId].deletedBy = req.auth.uniqueId;

      await db.doc('config/startingScreens').set(existing);

      log.info('config', 'Starting screen soft-deleted', {
        screenId,
        remainingScreens: Object.keys(existing).filter((id) => !existing[id]?.deleted).length,
        admin: req.auth.uniqueId,
      });

      return res.json({ success: true, deleted: screenId, permanent: false });
    }
  } catch (err) {
    log.error('config', 'Error deleting starting screen', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- 405 catch-all for startingScreens --
router.all('/config/startingScreens', (req, res) => {
  return res.status(405).json({ error: `Method ${req.method} not allowed` });
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
    // Return plain config object
    const config = snap.data();
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
    if (await requireAdmin(req, res)) return;

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
    if (await requireAdmin(req, res)) return;

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
    const results = await queryDocs(db.collection('gifts').where('showInStore', '==', true));
    results.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
    const results = await queryDocs(db.collection('gifts'));
    results.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
// PR 10 (UK OSA #17) — inner cohort filter. Entries are stamped at write
// time by economy.js updateGiftRankings; legacy entries pre-PR-10 fall
// back to a per-entry users/<id> lookup (cohort-filter.js). Admin
// (live-verified) bypasses the filter. `totalSent` is preserved as a
// global stat — only the per-user rankings array is cohort-restricted.
router.get('/gift-rankings/:giftId', async (req, res) => {
  try {
    const snap = await db.doc(`giftRankings/${req.params.giftId}`).get();
    const doc = snap.exists ? snap.data() : null;
    const allRankings = doc?.rankings || [];

    const isAdmin = req?.auth?.token?.admin === true && Boolean(await isLiveAdmin(req.auth?.uid));

    const rankings = isAdmin
      ? allRankings
      : await filterListByCohort(allRankings, cohortFromClaim(req), 'userId');

    return res.json({
      rankings,
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

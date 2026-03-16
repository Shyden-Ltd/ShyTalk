/**
 * Test helper routes — available only in development.
 *
 * POST /api/test/setup       → Create test scenario, return testRunId + created IDs
 * GET  /api/test/verify/:col/:id → Read Firestore doc for assertion
 * POST /api/test/teardown     → Delete all data for a testRunId
 * POST /api/test/reset        → Wipe all test data, restore fixtures
 */

const router = require('express').Router();
const { db } = require('../utils/firebase');
const { generateId } = require('../utils/helpers');
const log = require('../utils/log');

const TEST_PREFIX = 'test_';

function requireTestApiKey(req, res) {
  const key = req.headers['x-test-api-key'];
  if (!key || key !== process.env.TEST_API_KEY) {
    res.status(403).json({ error: 'Invalid test API key' });
    return true;
  }
  return false;
}

// POST /api/test/setup
router.post('/test/setup', async (req, res) => {
  try {
    if (requireTestApiKey(req, res)) return;

    const testRunId = `${TEST_PREFIX}${generateId()}`;
    const now = Date.now();
    const created = { testRunId, users: [], rooms: [], gifts: [], conversations: [] };

    const spec = req.body || {};

    // Create test users
    for (const userSpec of spec.users || []) {
      const uid = `${testRunId}_user_${generateId()}`;
      const userData = {
        uid,
        displayName: `[TEST] ${userSpec.name || 'User'}`,
        userType: userSpec.role || 'MEMBER',
        coins: userSpec.coins ?? 1000,
        beans: userSpec.beans ?? 0,
        gcs: 100,
        createdAt: now,
        _testRun: testRunId,
      };
      await db.doc(`users/${uid}`).set(userData);
      created.users.push(userData);
    }

    // Create test rooms
    for (const roomSpec of spec.rooms || []) {
      const roomId = `${testRunId}_room_${generateId()}`;
      const ownerId = roomSpec.ownerId || (created.users[0]?.uid ?? testRunId);
      const roomData = {
        id: roomId,
        name: `[TEST] ${roomSpec.name || 'Room'}`,
        ownerId,
        status: roomSpec.status || 'ACTIVE',
        createdAt: now,
        _testRun: testRunId,
      };
      await db.doc(`rooms/${roomId}`).set(roomData);
      created.rooms.push(roomData);
    }

    // Create test gifts
    for (const giftSpec of spec.gifts || []) {
      const giftId = `${testRunId}_gift_${generateId()}`;
      const giftData = {
        id: giftId,
        name: `[TEST] ${giftSpec.name || 'Gift'}`,
        coinValue: giftSpec.coinValue ?? 10,
        showInStore: giftSpec.showInStore ?? true,
        showOnWheel: giftSpec.showOnWheel ?? true,
        weight: 1.0,
        order: 0,
        animationUrl: '',
        soundUrl: '',
        iconUrl: '',
        _testRun: testRunId,
      };
      await db.doc(`gifts/${giftId}`).set(giftData);
      created.gifts.push(giftData);
    }

    log.info('test-helpers', 'Test setup complete', {
      testRunId,
      users: created.users.length,
      rooms: created.rooms.length,
    });
    res.json(created);
  } catch (err) {
    log.error('test-helpers', 'Setup failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// GET /api/test/verify/:collection/:id
router.get('/test/verify/:collection/:id', async (req, res) => {
  try {
    if (requireTestApiKey(req, res)) return;

    const { collection, id } = req.params;
    const ALLOWED_COLLECTIONS = ['users', 'rooms', 'gifts', 'conversations', 'banners', 'funFacts'];
    if (!ALLOWED_COLLECTIONS.includes(collection)) {
      return res.status(400).json({ error: 'Collection not allowed' });
    }
    const doc = await db.doc(`${collection}/${id}`).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/test/teardown
router.post('/test/teardown', async (req, res) => {
  try {
    if (requireTestApiKey(req, res)) return;

    const { testRunId } = req.body;
    if (!testRunId || !testRunId.startsWith(TEST_PREFIX)) {
      return res.status(400).json({ error: 'Invalid testRunId' });
    }

    const deleted = await deleteTestData(testRunId);
    log.info('test-helpers', 'Teardown complete', { testRunId, deleted });
    res.json({ success: true, deleted });
  } catch (err) {
    log.error('test-helpers', 'Teardown failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/test/reset — wipe ALL test data
router.post('/test/reset', async (req, res) => {
  try {
    if (requireTestApiKey(req, res)) return;

    const deleted = await deleteTestData(null);
    log.info('test-helpers', 'Full test reset complete', { deleted });
    res.json({ success: true, deleted });
  } catch (err) {
    log.error('test-helpers', 'Reset failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * Delete test data. If testRunId is null, deletes ALL test data.
 */
async function deleteTestData(testRunId) {
  const collections = ['users', 'rooms', 'gifts', 'conversations', 'banners', 'funFacts'];
  let totalDeleted = 0;

  for (const colName of collections) {
    let query;
    if (testRunId) {
      query = db.collection(colName).where('_testRun', '==', testRunId);
    } else {
      query = db.collection(colName).where('_testRun', '>=', TEST_PREFIX);
    }

    const snap = await query.limit(500).get();
    if (snap.empty) continue;

    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    totalDeleted += snap.size;
  }

  return totalDeleted;
}

module.exports = router;
module.exports.deleteTestData = deleteTestData;

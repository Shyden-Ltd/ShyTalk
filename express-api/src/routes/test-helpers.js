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
    let userIndex = 0;
    for (const userSpec of spec.users || []) {
      userIndex++;
      const uid = `${testRunId}_user_${generateId()}`;

      // Allocate real uniqueId via atomic counter transaction
      const counterRef = db.doc('counters/uniqueId');
      const uniqueId = await db.runTransaction(async (t) => {
        const counterDoc = await t.get(counterRef);
        const current = counterDoc.exists ? counterDoc.data().value : 100000000;
        const next = current + 1;
        t.set(counterRef, { value: next }, { merge: true });
        return next;
      });

      const userData = {
        uid,
        firebaseUid: uid,
        uniqueId,
        displayName: userSpec.name || `Test User ${userIndex}`,
        userType: userSpec.role || 'MEMBER',
        shyCoins: userSpec.shyCoins ?? 0,
        shyBeans: userSpec.shyBeans ?? 0,
        gcsScore: 100,
        warningCount: 0,
        hasActiveWarning: false,
        luckScore: 0,
        pityCounter: 0,
        isSuspended: false,
        createdAt: now,
        _testRun: testRunId,
      };
      await db.doc(`users/${uniqueId}`).set(userData);

      // Create device binding if deviceInfo is provided
      if (userSpec.deviceInfo) {
        const { deviceId, manufacturer, model, lastIp, isp } = userSpec.deviceInfo;
        await db.doc(`deviceBindings/${deviceId}`).set({
          deviceId,
          uniqueId, // number — must match user doc type for Firestore queries
          manufacturer: manufacturer || 'Unknown',
          model: model || 'Unknown',
          lastIp: lastIp || null,
          isp: isp || null,
          boundAt: Date.now(),
          _testRun: testRunId,
        });
        // Also set lastIp on user doc for ban tests
        if (lastIp) {
          await db.doc(`users/${uniqueId}`).update({ lastIp });
        }
      }

      created.users.push({ ...userData });
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

/** Delete all docs in known subcollections, then the parent doc */
async function deleteDocWithSubcollections(docRef) {
  const subcollections = ['warnings', 'transactions', 'backpack'];
  for (const sub of subcollections) {
    const snap = await docRef.collection(sub).get();
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    if (snap.size > 0) await batch.commit();
  }
  await docRef.delete();
}

/**
 * Delete test data. If testRunId is null, deletes ALL test data.
 */
async function deleteTestData(testRunId) {
  let deleted = 0;

  // 1. Find all test users and delete docs + subcollections
  let userQuery;
  if (testRunId) {
    userQuery = db.collection('users').where('_testRun', '==', testRunId);
  } else {
    userQuery = db.collection('users').where('_testRun', '>=', TEST_PREFIX);
  }
  const userSnap = await userQuery.get();
  const userUniqueIds = [];
  for (const doc of userSnap.docs) {
    userUniqueIds.push(doc.data().uniqueId || doc.id);
    await deleteDocWithSubcollections(doc.ref);
    deleted++;
  }

  // 2. Delete device bindings tagged with this testRun
  let bindingQuery;
  if (testRunId) {
    bindingQuery = db.collection('deviceBindings').where('_testRun', '==', testRunId);
  } else {
    bindingQuery = db.collection('deviceBindings').where('_testRun', '>=', TEST_PREFIX);
  }
  const bindingSnap = await bindingQuery.get();
  const batch1 = db.batch();
  for (const doc of bindingSnap.docs) {
    batch1.delete(doc.ref);
    deleted++;
  }
  if (bindingSnap.size > 0) await batch1.commit();

  // 3. Delete device and network bans linked to test users
  // Query both number and string variants (Firestore equality is type-strict)
  for (const uid of userUniqueIds) {
    for (const uidVariant of [uid, String(uid)]) {
      const deviceBanSnap = await db
        .collection('deviceBans')
        .where('linkedUniqueId', '==', uidVariant)
        .get();
      for (const doc of deviceBanSnap.docs) {
        await doc.ref.delete();
        deleted++;
      }

      const networkBanSnap = await db
        .collection('networkBans')
        .where('linkedUniqueId', '==', uidVariant)
        .get();
      for (const doc of networkBanSnap.docs) {
        await doc.ref.delete();
        deleted++;
      }
    }
  }

  // 4. Delete other top-level test docs (gifts, rooms, banners, funFacts, conversations)
  // Note: system PMs created by admin actions won't have _testRun set — accepted trade-off
  const otherCollections = ['gifts', 'rooms', 'banners', 'funFacts', 'conversations'];
  for (const col of otherCollections) {
    let query;
    if (testRunId) {
      query = db.collection(col).where('_testRun', '==', testRunId);
    } else {
      query = db.collection(col).where('_testRun', '>=', TEST_PREFIX);
    }
    const snap = await query.get();
    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
      deleted++;
    }
    if (snap.size > 0) await batch.commit();
  }

  return deleted;
}

module.exports = router;
module.exports.deleteTestData = deleteTestData;

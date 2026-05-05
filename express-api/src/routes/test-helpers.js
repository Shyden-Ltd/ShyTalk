/**
 * Test helper routes — available only in development.
 *
 * POST /api/test/setup       → Create test scenario, return testRunId + created IDs
 * GET  /api/test/verify/:col/:id → Read Firestore doc for assertion
 * POST /api/test/write/:col   → Write a document to an allowed collection
 * POST /api/test/teardown     → Delete all data for a testRunId
 * POST /api/test/reset        → Wipe all test data, restore fixtures
 */

const router = require('express').Router();
const { db, auth } = require('../utils/firebase');
const { generateId } = require('../utils/helpers');
const log = require('../utils/log');

const TEST_PREFIX = 'test_';

function requireTestApiKey(req, res) {
  if (!process.env.TEST_API_KEY) {
    res.status(500).json({ error: 'TEST_API_KEY not configured on server' });
    return true;
  }
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
    const created = {
      testRunId,
      users: [],
      rooms: [],
      gifts: [],
      banners: [],
      funFacts: [],
      reports: [],
      appeals: [],
      alerts: [],
      conversations: [],
      economyConfig: {},
    };

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
        lastSeenAt: now,
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
        weight: 1,
        order: 0,
        animationUrl: '',
        soundUrl: '',
        iconUrl: '',
        _testRun: testRunId,
      };
      await db.doc(`gifts/${giftId}`).set(giftData);
      created.gifts.push(giftData);
    }

    // Create test banners
    for (const bannerSpec of spec.banners || []) {
      const bannerId = `${testRunId}_banner_${generateId()}`;
      const bannerData = {
        id: bannerId,
        title: bannerSpec.title || 'Test Banner',
        imageUrl: bannerSpec.imageUrl || '',
        actionType: bannerSpec.actionType || 'NONE',
        actionValue: bannerSpec.actionValue || '',
        isActive: bannerSpec.isActive ?? true,
        sortOrder: bannerSpec.sortOrder ?? 0,
        createdAt: now,
        _testRun: testRunId,
      };
      await db.doc(`banners/${bannerId}`).set(bannerData);
      created.banners.push(bannerData);
    }

    // Create test fun facts
    for (const factSpec of spec.funFacts || []) {
      const factId = `${testRunId}_fact_${generateId()}`;
      const factData = {
        id: factId,
        text: factSpec.text || 'Test fact',
        category: factSpec.category || 'trivia',
        emoji: factSpec.emoji || '📝',
        sourceLanguage: factSpec.sourceLanguage || 'English',
        isActive: factSpec.isActive ?? true,
        createdAt: now,
        _testRun: testRunId,
      };
      await db.doc(`funFacts/${factId}`).set(factData);
      created.funFacts.push(factData);
    }

    // Create test conversations with messages subcollection
    // (seeded BEFORE reports so reports can reference conversationIndex)
    // Production reads `participantIds`; legacy `participants` accepted for backward compat.
    for (const convSpec of spec.conversations || []) {
      const convId = `${testRunId}_conv_${generateId()}`;
      const participantIds = convSpec.participantIds || convSpec.participants || [];
      const convData = {
        id: convId,
        participantIds,
        createdAt: now,
        _testRun: testRunId,
      };
      await db.doc(`conversations/${convId}`).set(convData);
      for (const msg of convSpec.messages || []) {
        const msgId = `${testRunId}_msg_${generateId()}`;
        await db.doc(`conversations/${convId}/messages/${msgId}`).set({
          text: msg.text || '',
          senderId: msg.senderId || '',
          createdAt: now,
        });
      }
      created.conversations.push(convData);
    }

    // Create test reports (index-based user references)
    for (const reportSpec of spec.reports || []) {
      const reportId = `${testRunId}_report_${generateId()}`;
      const reportedUser = created.users[reportSpec.reportedUserIndex || 0];
      const reporterUser = created.users[reportSpec.reporterUserIndex || 1];
      if (!reportedUser || !reporterUser) throw new Error('Report seed requires at least 2 users');
      // Link to a seeded conversation if conversationIndex is provided
      const linkedConv =
        reportSpec.conversationIndex !== undefined && reportSpec.conversationIndex !== null
          ? created.conversations[reportSpec.conversationIndex]
          : null;
      const reportData = {
        id: reportId,
        reportedUserId: reportedUser.uid,
        reportedUserUniqueId: reportedUser.uniqueId,
        reportedUserName: reportedUser.displayName,
        reporterId: reporterUser.uid,
        reporterName: reporterUser.displayName,
        reason: reportSpec.reason || 'Spam',
        status: reportSpec.status || 'pending',
        ...(linkedConv ? { conversationId: linkedConv.id } : {}),
        createdAt: now,
        _testRun: testRunId,
      };
      await db.doc(`reports/${reportId}`).set(reportData);
      created.reports.push(reportData);
    }

    // Create test suspension appeals
    // NOTE: Does NOT set user as suspended — appeal tests manage suspension state themselves
    // to avoid cross-file fragility (other tests depend on user not being suspended)
    for (const appealSpec of spec.appeals || []) {
      const appealId = `${testRunId}_appeal_${generateId()}`;
      const appealUser = created.users[appealSpec.userIndex || 0];
      if (!appealUser) throw new Error('Appeal seed requires users to be seeded first');
      const appealData = {
        id: appealId,
        userId: appealUser.uniqueId,
        appealText: appealSpec.appealText || 'I did not do this',
        status: appealSpec.status || 'pending',
        createdAt: now,
        _testRun: testRunId,
      };
      await db.doc(`suspensionAppeals/${appealId}`).set(appealData);
      created.appeals.push(appealData);
    }

    // Create test alerts
    for (const alertSpec of spec.alerts || []) {
      const alertId = `${testRunId}_alert_${generateId()}`;
      const alertData = {
        id: alertId,
        type: alertSpec.type || 'error_rate',
        severity: alertSpec.severity || 'medium',
        message: alertSpec.message || 'Test alert',
        status: alertSpec.status || 'new',
        createdAt: now,
        _testRun: testRunId,
      };
      await db.doc(`alerts/${alertId}`).set(alertData);
      created.alerts.push(alertData);
    }

    // Read current economy config for backup/restore
    // If the doc doesn't exist, use production defaults so restore always has valid data
    const ECONOMY_DEFAULTS = {
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
    try {
      const ecoDoc = await db.doc('config/economy').get();
      created.economyConfig = ecoDoc.exists ? ecoDoc.data() : ECONOMY_DEFAULTS;
    } catch {
      // Fallback to defaults — economy config fetch is non-critical for test setup
      created.economyConfig = ECONOMY_DEFAULTS;
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
    const ALLOWED_COLLECTIONS = [
      'users',
      'rooms',
      'gifts',
      'conversations',
      'banners',
      'funFacts',
      'reports',
      'suspensionAppeals',
      'alerts',
      'ageVerificationSubmissions',
    ];
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

// POST /api/test/create-user — create a user doc (optionally without identity data)
// Used by the "empty graph: No identity data yet" test which needs a user
// without any identity graph records. /api/test/* routes bypass auth
// middleware entirely so req.auth is not set here — accept either the
// test API key OR any Bearer token (the admin panel test infra calls
// this via testData.api which uses Bearer, and the bypass means only
// direct test-helper calls ever hit this route).
router.post('/test/create-user', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Not available in production' });
    }
    const keyHeader = req.headers['x-test-api-key'];
    const hasApiKey = keyHeader && keyHeader === process.env.TEST_API_KEY;
    const hasBearer = req.headers.authorization && req.headers.authorization.startsWith('Bearer ');
    if (!hasApiKey && !hasBearer) {
      return res.status(403).json({ error: 'Test API key or Bearer token required' });
    }
    const { name, skipIdentity } = req.body || {};
    const uid = 'test_noidentity_' + Date.now();
    // Use crypto.randomInt rather than Math.random — it's cryptographically
    // secure and avoids SonarCloud's "pseudorandom number generator" hotspot
    // warning. The unique id doesn't need to be unpredictable here (it's a
    // test user), but using the secure API keeps the security gate clean.
    const crypto = require('crypto');
    const uniqueId = 900000000 + crypto.randomInt(99999999);
    await db.doc(`users/${uid}`).set({
      uid,
      uniqueId,
      displayName: name || 'Test User',
      createdAt: Date.now(),
      isSuspended: false,
    });
    if (!skipIdentity) {
      await db.doc(`identityGraphs/${uid}`).set({
        nodes: [
          { id: 'account-' + uid, type: 'account', label: String(uniqueId), suspended: false },
        ],
        edges: [],
      });
    }
    res.json({ uid, uniqueId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/test/write/:collection — write a document to an allowed collection
router.post('/test/write/:collection', async (req, res) => {
  try {
    if (requireTestApiKey(req, res)) return;

    const { collection } = req.params;
    const ALLOWED_COLLECTIONS = [
      'users',
      'rooms',
      'gifts',
      'conversations',
      'banners',
      'funFacts',
      'reports',
      'suspensionAppeals',
      'alerts',
      'suggestions',
      'ageVerificationSubmissions',
      // Phase 3 PR F (integration test #10): seed real coinPackages
      // docs so /api/economy/purchase can match a productId during
      // tests. Teardown sweeps these via the `_testRun` field
      // (deleteTestData → otherCollections list).
      'coinPackages',
    ];
    if (!ALLOWED_COLLECTIONS.includes(collection)) {
      return res.status(400).json({ error: 'Collection not allowed' });
    }

    const data = req.body;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Request body must be a JSON object' });
    }

    const docId = data.id || generateId();
    const writeData = { ...data, id: docId };
    // Propagate _testRun so teardown can clean up documents created via this endpoint
    if (data._testRun) {
      writeData._testRun = data._testRun;
    }
    await db.doc(`${collection}/${docId}`).set(writeData, { merge: true });

    res.json({ success: true, id: docId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/test/mint-id-token
//
// Mint a Firebase ID token for a test user, suitable for use as a
// Bearer Authorization header against the auth-protected Express
// routes. Used by the integration test framework
// (Phase 3, PR C) to authenticate as multi-account scenarios
// (sender, recipient, admin) without going through the real
// Firebase Auth REST flow.
//
// Flow:
//   1. Caller provides a Firebase UID (already created via
//      /test/setup or /test/create-user).
//   2. Server uses Firebase Admin to mint a *custom token* for that
//      UID.
//   3. Custom token is exchanged for a regular ID token via the
//      Auth Emulator's signInWithCustomToken REST endpoint.
//
// Step 3 happens server-side rather than in the test runner because
// the emulator host is reachable from inside the local stack
// (`http://localhost:9099` from Express). This avoids exposing the
// emulator host config to test code.
//
// Production safety: this route is gated by NODE_ENV !== 'production'
// AND by TEST_API_KEY. Even if NODE_ENV was misconfigured, the
// TEST_API_KEY check fails-closed.
router.post('/test/mint-id-token', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Not available in production' });
    }
    if (requireTestApiKey(req, res)) return;

    const { uid } = req.body || {};
    if (!uid || typeof uid !== 'string') {
      return res.status(400).json({ error: 'uid (string) required' });
    }

    // Step 1: mint custom token via Admin SDK
    const customToken = await auth.createCustomToken(uid);

    // Step 2: exchange for ID token via Auth Emulator REST.
    // FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099' in local mode.
    // FIREBASE_WEB_API_KEY can be any non-empty string in emulator
    // mode — the emulator doesn't validate it.
    const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
    const apiKey = process.env.FIREBASE_WEB_API_KEY || 'fake-api-key';
    const exchangeUrl = `http://${emulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`;

    const resp = await fetch(exchangeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    });
    if (!resp.ok) {
      const errBody = await resp.text();
      log.error('test-helpers', 'mint-id-token exchange failed', {
        status: resp.status,
        body: errBody.slice(0, 500),
      });
      return res.status(502).json({
        error: 'Failed to exchange custom token for ID token',
        details: `${resp.status}: ${errBody.slice(0, 200)}`,
      });
    }
    const exchangeBody = await resp.json();
    const idToken = exchangeBody.idToken;
    if (!idToken) {
      return res.status(502).json({
        error: 'Auth Emulator did not return idToken',
        details: JSON.stringify(exchangeBody).slice(0, 200),
      });
    }

    res.json({ idToken });
  } catch (err) {
    log.error('test-helpers', 'mint-id-token failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/test/teardown
router.post('/test/teardown', async (req, res) => {
  try {
    if (requireTestApiKey(req, res)) return;

    const { testRunId } = req.body;
    if (!testRunId?.startsWith(TEST_PREFIX)) {
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
  const subcollections = ['warnings', 'transactions', 'backpack', 'stalkers', 'giftWall'];
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

  // 4. Delete other top-level test docs (gifts, rooms, banners, funFacts, conversations, etc.)
  // Note: system PMs created by admin actions won't have _testRun set — accepted trade-off
  const otherCollections = [
    'gifts',
    'rooms',
    'banners',
    'funFacts',
    'conversations',
    'reports',
    'suspensionAppeals',
    'alerts',
    'reportLocks',
    // Phase 3 PR F: integration tests seed coinPackages tagged with
    // `_testRun` for /api/economy/purchase tests. Without this entry
    // tested packages would persist across runs and pollute later
    // queries on `coinPackages`.
    'coinPackages',
  ];
  for (const col of otherCollections) {
    let query;
    if (testRunId) {
      query = db.collection(col).where('_testRun', '==', testRunId);
    } else {
      query = db.collection(col).where('_testRun', '>=', TEST_PREFIX);
    }
    const snap = await query.get();
    for (const doc of snap.docs) {
      if (col === 'conversations') {
        // Conversations have messages subcollection — delete those first
        const msgSnap = await doc.ref.collection('messages').get();
        const msgBatch = db.batch();
        msgSnap.docs.forEach((m) => msgBatch.delete(m.ref));
        if (msgSnap.size > 0) await msgBatch.commit();
      }
      await doc.ref.delete();
      deleted++;
    }
  }

  // 5. Clean up starting screens config document
  // Starting screens live as fields in a single doc, not as individual collection docs,
  // so _testRun-based queries can't find them.
  try {
    const ssDoc = await db.doc('config/startingScreens').get();
    if (ssDoc.exists) {
      const ssData = ssDoc.data() || {};
      const testScreenIds = Object.keys(ssData).filter(
        (key) => key.startsWith('pw-') || key.startsWith('screen-') || key.startsWith('test-'),
      );
      if (testScreenIds.length > 0) {
        const { FieldValue } = require('firebase-admin/firestore');
        const updates = {};
        for (const id of testScreenIds) {
          updates[id] = FieldValue.delete();
        }
        await db.doc('config/startingScreens').update(updates);
        deleted += testScreenIds.length;
      }
    }
  } catch {
    // Best-effort cleanup — config deletion failure is non-critical
  }

  // 6. Restore uniqueId counter to the highest remaining real user (best-effort)
  if (userUniqueIds.length > 0) {
    try {
      const maxSnap = await db.collection('users').orderBy('uniqueId', 'desc').limit(1).get();
      const maxId = maxSnap.empty ? 100000000 : maxSnap.docs[0].data().uniqueId;
      await db.doc('counters/uniqueId').set({ value: maxId }, { merge: true });
    } catch {
      // Best-effort — counter restoration failure does not block test cleanup
    }
  }

  return deleted;
}

// POST /api/test/clear/:collection — delete all documents in a collection.
// Used by Playwright global-setup to clear test-generated data between runs.
//
// `reports` and `suspensionAppeals` are clearable because untagged
// reports/appeals from earlier test runs (created via `POST /api/reports`
// before the test helpers were updated to use `testWrite` with
// `_testRun`) accumulate as orphaned data with `data-uid="undefined"`
// (the reported user has been torn down) and silently break selectors
// like `.report-card.first()` in admin-cross-tab and admin-appeals
// tests.
const CLEARABLE_COLLECTIONS = new Set([
  'suggestions',
  'notifications',
  'moderationLog',
  'auditLog',
  'adminAuditLog',
  'blockedTopics',
  'funFacts',
  'reports',
  'suspensionAppeals',
]);

router.post('/test/clear/:collection', async (req, res) => {
  try {
    if (requireTestApiKey(req, res)) return;
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Not available in production' });
    }
    const { collection } = req.params;
    if (!CLEARABLE_COLLECTIONS.has(collection)) {
      return res.status(400).json({ error: `Collection ${collection} is not clearable` });
    }
    const snap = await db.collection(collection).limit(500).get();
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    res.json({ deleted: snap.size });
  } catch (err) {
    log.error('test-helpers', `Clear ${req.params.collection} failed`, { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.deleteTestData = deleteTestData;

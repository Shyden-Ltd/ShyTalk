/**
 * Admin route: Copy production Firestore data to dev.
 *
 * POST /admin/migrate-prod-data  — Wipe dev Firestore and copy all data from prod.
 *
 * Dev-only route. Requires admin auth and PROD_SERVICE_ACCOUNT_PATH env var
 * pointing to the prod Firebase service account JSON.
 */

const router = require('express').Router();
const admin = require('firebase-admin');
const { db } = require('../utils/firebase');
const { requireAdmin } = require('../middleware/auth');
const log = require('../utils/log');

// Same collections the backup cron tracks, minus large operational ones (logs, alerts)
const TOP_LEVEL_COLLECTIONS = [
  'users',
  'rooms',
  'conversations',
  'config',
  'identityMap',
  'counters',
  'deviceBindings',
  'gifts',
  'giftRankings',
  'broadcasts',
  'coinPackages',
  'funFacts',
  'banners',
  'reports',
  'reportsArchive',
  'reportLocks',
  'suspensionAppeals',
  'adminAuditLog',
  'alertConfig',
  'otpCodes',
  'biometricKeys',
  'emailMetrics',
  'purchaseReceipts',
  'logConfig',
  'deviceBans',
  'networkBans',
];

const SUBCOLLECTIONS = [
  ['rooms', 'messages'],
  ['rooms', 'seatRequests'],
  ['conversations', 'messages'],
  ['conversations', 'userSettings'],
  ['conversations', 'mutes'],
  ['users', 'backpack'],
  ['users', 'warnings'],
  ['users', 'giftWall'],
  ['users', 'transactions'],
  ['users', 'stalkers'],
];

let prodDb = null;

function getProdDb() {
  if (prodDb) return prodDb;

  const prodSaPath = process.env.PROD_SERVICE_ACCOUNT_PATH;
  if (!prodSaPath) {
    throw new Error('PROD_SERVICE_ACCOUNT_PATH env var not set');
  }

  const prodApp = admin.initializeApp(
    { credential: admin.credential.cert(require(prodSaPath)) },
    'prod-readonly',
  );
  prodDb = prodApp.firestore();
  return prodDb;
}

/**
 * Delete all documents in a collection (in batches of 500).
 */
async function deleteCollection(firestore, collectionPath) {
  const collRef = firestore.collection(collectionPath);
  let deleted = 0;

  while (true) {
    const snapshot = await collRef.limit(500).get();
    if (snapshot.empty) break;

    const batch = firestore.batch();
    for (const doc of snapshot.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    deleted += snapshot.size;
  }

  return deleted;
}

/**
 * Copy all documents from one Firestore collection to another Firestore instance.
 */
async function copyCollection(srcDb, destDb, collectionName) {
  const snapshot = await srcDb.collection(collectionName).get();
  if (snapshot.empty) return 0;

  // Write in batches of 500 (Firestore limit)
  const docs = snapshot.docs;
  for (let i = 0; i < docs.length; i += 500) {
    const batch = destDb.batch();
    const chunk = docs.slice(i, i + 500);
    for (const doc of chunk) {
      batch.set(destDb.collection(collectionName).doc(doc.id), doc.data());
    }
    await batch.commit();
  }

  return docs.length;
}

/**
 * Copy subcollection documents from all parent docs.
 */
async function copySubcollection(srcDb, destDb, parentCollection, subName) {
  const parents = await srcDb.collection(parentCollection).listDocuments();
  let total = 0;

  for (const parentRef of parents) {
    const subSnapshot = await srcDb
      .collection(parentCollection)
      .doc(parentRef.id)
      .collection(subName)
      .get();

    if (subSnapshot.empty) continue;

    const docs = subSnapshot.docs;
    for (let i = 0; i < docs.length; i += 500) {
      const batch = destDb.batch();
      const chunk = docs.slice(i, i + 500);
      for (const doc of chunk) {
        batch.set(
          destDb.collection(parentCollection).doc(parentRef.id).collection(subName).doc(doc.id),
          doc.data(),
        );
      }
      await batch.commit();
    }
    total += docs.length;
  }

  return total;
}

/** Run a migration phase operation, logging and capturing errors. */
async function runMigrationOp(results, collectionName, phase, fn) {
  try {
    const count = await fn();
    if (phase === 'delete') results.deleted[collectionName] = count;
    else results.copied[collectionName] = count;
    log.info('admin-migrate', `${phase === 'delete' ? 'Deleted' : 'Copied'} ${collectionName}`, {
      count,
    });
  } catch (err) {
    results.errors.push({ collection: collectionName, phase, error: err.message });
    log.error('admin-migrate', `Failed to ${phase} ${collectionName}`, { error: err.message });
  }
}

router.post('/admin/migrate-prod-data', async (req, res) => {
  if (requireAdmin(req, res)) return;
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'This endpoint is disabled in production' });
  }

  log.info('admin-migrate', 'Starting prod → dev data migration', { adminUid: req.auth.uniqueId });

  try {
    const srcDb = getProdDb();
    const results = { deleted: {}, copied: {}, errors: [] };

    // Phase 1: Delete subcollections in dev first
    for (const [parent, sub] of SUBCOLLECTIONS) {
      await runMigrationOp(results, `${parent}/${sub}`, 'delete', async () => {
        const parentDocs = await db.collection(parent).listDocuments();
        let subDeleted = 0;
        for (const parentRef of parentDocs) {
          subDeleted += await deleteCollection(db, `${parent}/${parentRef.id}/${sub}`);
        }
        return subDeleted;
      });
    }

    // Phase 2: Delete top-level collections in dev
    for (const name of TOP_LEVEL_COLLECTIONS) {
      await runMigrationOp(results, name, 'delete', () => deleteCollection(db, name));
    }

    // Phase 3: Copy top-level collections from prod
    for (const name of TOP_LEVEL_COLLECTIONS) {
      await runMigrationOp(results, name, 'copy', () => copyCollection(srcDb, db, name));
    }

    // Phase 4: Copy subcollections from prod
    for (const [parent, sub] of SUBCOLLECTIONS) {
      await runMigrationOp(results, `${parent}/${sub}`, 'copy', () =>
        copySubcollection(srcDb, db, parent, sub),
      );
    }

    const totalDeleted = Object.values(results.deleted).reduce((a, b) => a + b, 0);
    const totalCopied = Object.values(results.copied).reduce((a, b) => a + b, 0);

    log.info('admin-migrate', 'Migration complete', {
      totalDeleted,
      totalCopied,
      errors: results.errors.length,
    });
    res.json({
      success: true,
      totalDeleted,
      totalCopied,
      errors: results.errors,
      details: results,
    });
  } catch (err) {
    log.error('admin-migrate', 'Migration failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

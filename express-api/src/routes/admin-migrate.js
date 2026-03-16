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
  'deviceBindings',
  'gifts',
  'giftCatalog',
  'economyConfig',
  'funFacts',
  'banners',
  'reports',
  'appeals',
  'subscriptions',
  'logConfig',
  'deviceBans',
  'networkBans',
  'config',
  'coinPackages',
  'purchaseReceipts',
  'reportLocks',
  'reportsArchive',
  'suspensionAppeals',
  'broadcasts',
  'adminAuditLog',
  'alertConfig',
];

const SUBCOLLECTIONS = [
  ['rooms', 'messages'],
  ['rooms', 'seatRequests'],
  ['conversations', 'messages'],
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
      const collPath = `${parent}`;
      try {
        const parentDocs = await db.collection(collPath).listDocuments();
        let subDeleted = 0;
        for (const parentRef of parentDocs) {
          subDeleted += await deleteCollection(db, `${collPath}/${parentRef.id}/${sub}`);
        }
        results.deleted[`${parent}/${sub}`] = subDeleted;
        log.info('admin-migrate', `Deleted dev subcollection ${parent}/${sub}`, {
          count: subDeleted,
        });
      } catch (err) {
        results.errors.push({
          collection: `${parent}/${sub}`,
          phase: 'delete',
          error: err.message,
        });
        log.error('admin-migrate', `Failed to delete dev subcollection ${parent}/${sub}`, {
          error: err.message,
        });
      }
    }

    // Phase 2: Delete top-level collections in dev
    for (const name of TOP_LEVEL_COLLECTIONS) {
      try {
        const deleted = await deleteCollection(db, name);
        results.deleted[name] = deleted;
        log.info('admin-migrate', `Deleted dev collection ${name}`, { count: deleted });
      } catch (err) {
        results.errors.push({ collection: name, phase: 'delete', error: err.message });
        log.error('admin-migrate', `Failed to delete dev collection ${name}`, {
          error: err.message,
        });
      }
    }

    // Phase 3: Copy top-level collections from prod
    for (const name of TOP_LEVEL_COLLECTIONS) {
      try {
        const copied = await copyCollection(srcDb, db, name);
        results.copied[name] = copied;
        log.info('admin-migrate', `Copied prod → dev collection ${name}`, { count: copied });
      } catch (err) {
        results.errors.push({ collection: name, phase: 'copy', error: err.message });
        log.error('admin-migrate', `Failed to copy collection ${name}`, { error: err.message });
      }
    }

    // Phase 4: Copy subcollections from prod
    for (const [parent, sub] of SUBCOLLECTIONS) {
      try {
        const copied = await copySubcollection(srcDb, db, parent, sub);
        results.copied[`${parent}/${sub}`] = copied;
        log.info('admin-migrate', `Copied prod → dev subcollection ${parent}/${sub}`, {
          count: copied,
        });
      } catch (err) {
        results.errors.push({ collection: `${parent}/${sub}`, phase: 'copy', error: err.message });
        log.error('admin-migrate', `Failed to copy subcollection ${parent}/${sub}`, {
          error: err.message,
        });
      }
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

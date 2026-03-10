/**
 * Cron: Full database backup to R2.
 *
 * Backs up all Firestore collections (top-level + subcollections) to R2
 * under `backups/full/YYYY-MM-DD/`. Also writes a backwards-compatible
 * `backups/users/YYYY-MM-DD.json` file.
 *
 * Prunes backups older than 7 days.
 */

const { db } = require('../utils/firebase');
const r2 = require('../utils/r2');
const log = require('../utils/log');

// Top-level collections to back up
const TOP_LEVEL_COLLECTIONS = [
  'users', 'rooms', 'conversations', 'deviceBindings', 'gifts',
  'giftCatalog', 'economyConfig', 'funFacts', 'banners', 'reports',
  'appeals', 'subscriptions', 'logConfig', 'deviceBans', 'networkBans',
];

// Subcollections: [parentCollection, subcollectionName]
const SUBCOLLECTIONS = [
  ['rooms', 'messages'],
  ['rooms', 'seatRequests'],
  ['conversations', 'messages'],
];

/**
 * Back up a single top-level collection.
 * Returns { name, docs, count }.
 */
async function backupCollection(name) {
  const snapshot = await db.collection(name).get();
  const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  return { name, docs, count: docs.length };
}

/**
 * Back up a subcollection across all parent docs.
 * Returns { name, docs, count } where name = `parent_sub`.
 */
async function backupSubcollection(parentCollection, subName) {
  const parentSnapshot = await db.collection(parentCollection).get();
  const allDocs = [];

  for (const parentDoc of parentSnapshot.docs) {
    const subSnapshot = await db
      .collection(parentCollection)
      .doc(parentDoc.id)
      .collection(subName)
      .get();

    for (const subDoc of subSnapshot.docs) {
      allDocs.push({
        id: subDoc.id,
        parentId: parentDoc.id,
        ...subDoc.data(),
      });
    }
  }

  const name = `${parentCollection}_${subName}`;
  return { name, docs: allDocs, count: allDocs.length };
}

/**
 * Run a full database backup.
 * Returns { date, manifest } on success.
 */
async function backups() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const prefix = `backups/full/${today}`;
  const manifest = { date: today, timestamp: new Date().toISOString(), collections: {} };

  // Back up top-level collections (retain users JSON for backwards-compat copy)
  let usersJsonStr = null;
  for (const collName of TOP_LEVEL_COLLECTIONS) {
    try {
      const { name, docs, count } = await backupCollection(collName);
      const key = `${prefix}/${name}.json`;
      const jsonStr = JSON.stringify(docs, null, 2);

      if (name === 'users') usersJsonStr = jsonStr;

      await r2.putObject(key, Buffer.from(jsonStr), 'application/json', {
        docCount: String(count),
        createdAt: new Date().toISOString(),
      });

      manifest.collections[name] = count;
      log.info('cron', 'backup: collection saved', { collection: name, docs: count, bytes: jsonStr.length });
    } catch (err) {
      log.error('cron', 'backup: collection failed', { collection: collName, error: err.message });
    }
  }

  // Back up subcollections
  for (const [parent, sub] of SUBCOLLECTIONS) {
    try {
      const { name, docs, count } = await backupSubcollection(parent, sub);
      const key = `${prefix}/${name}.json`;
      const jsonStr = JSON.stringify(docs, null, 2);

      await r2.putObject(key, Buffer.from(jsonStr), 'application/json', {
        docCount: String(count),
        createdAt: new Date().toISOString(),
      });

      manifest.collections[name] = count;
      log.info('cron', 'backup: subcollection saved', { collection: name, docs: count, bytes: jsonStr.length });
    } catch (err) {
      log.error('cron', 'backup: subcollection failed', { collection: `${parent}_${sub}`, error: err.message });
    }
  }

  // Write manifest
  const manifestKey = `${prefix}/manifest.json`;
  const manifestStr = JSON.stringify(manifest, null, 2);
  await r2.putObject(manifestKey, Buffer.from(manifestStr), 'application/json');
  log.info('cron', 'backup: manifest written', { key: manifestKey });

  // Backwards compatibility: reuse the in-memory users JSON (no extra Firestore read)
  const usersKey = `backups/users/${today}.json`;
  const usersCount = manifest.collections['users'] || 0;
  await r2.putObject(usersKey, Buffer.from(usersJsonStr || '[]'), 'application/json', {
    userCount: String(usersCount),
    createdAt: new Date().toISOString(),
  });
  log.info('cron', 'backup: backwards-compat users backup saved', { key: usersKey, users: usersCount });

  // Prune full backups older than 7 days
  await pruneOldBackups('backups/full/');
  // Also prune legacy users backups
  await pruneOldBackups('backups/users/');

  return { date: today, manifest };
}

/**
 * Prune backups older than 7 days under the given prefix.
 * For `backups/full/` prefix, date is extracted from the folder name.
 * For `backups/users/` prefix, date is extracted from the filename.
 */
async function pruneOldBackups(prefix) {
  const allKeys = await r2.listObjects(prefix);
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const toDelete = allKeys.filter(objKey => {
    let dateStr;
    if (prefix === 'backups/full/') {
      const parts = objKey.replace(prefix, '').split('/');
      dateStr = parts[0];
    } else {
      dateStr = objKey.replace(prefix, '').replace('.json', '');
    }

    const backupDate = new Date(dateStr + 'T00:00:00Z');
    return !isNaN(backupDate.getTime()) && backupDate.getTime() < sevenDaysAgo;
  });

  if (toDelete.length > 0) {
    await r2.deleteObjects(toDelete);
    log.info('cron', 'backup: pruned old backups', { prefix, count: toDelete.length });
  }
}

module.exports = backups;
module.exports.TOP_LEVEL_COLLECTIONS = TOP_LEVEL_COLLECTIONS;
module.exports.SUBCOLLECTIONS = SUBCOLLECTIONS;

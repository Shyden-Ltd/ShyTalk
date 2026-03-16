/**
 * Cron: Clean up stale test data older than 1 hour.
 * Only runs in development environment.
 */

const { db } = require('../utils/firebase');
const log = require('../utils/log');

const TEST_PREFIX = 'test_';
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

async function testDataCleanup() {
  if (process.env.NODE_ENV === 'production') return;

  const cutoff = Date.now() - MAX_AGE_MS;
  const collections = ['users', 'rooms', 'gifts', 'conversations', 'banners', 'funFacts'];
  let totalDeleted = 0;

  for (const colName of collections) {
    const snap = await db
      .collection(colName)
      .where('_testRun', '>=', TEST_PREFIX)
      .where('createdAt', '<', cutoff)
      .limit(500)
      .get();

    if (snap.empty) continue;

    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    totalDeleted += snap.size;
  }

  if (totalDeleted > 0) {
    log.info('cron', 'testDataCleanup: removed stale test data', { deleted: totalDeleted });
  }
}

module.exports = testDataCleanup;

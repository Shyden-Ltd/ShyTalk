/**
 * Cron: Archive resolved reports older than 6 months.
 *
 * Copies resolved reports to reportsArchive collection,
 * then deletes the originals. Uses batch writes (max 500 per commit).
 */

const { db } = require('../utils/firebase');
const log = require('../utils/log');

async function archiveReports() {
  const sixMonthsAgo = Date.now() - 6 * 30 * 24 * 60 * 60 * 1000;

  const snapshot = await db
    .collection('reports')
    .where('status', '==', 'resolved')
    .where('resolvedAt', '<', sixMonthsAgo)
    .limit(500)
    .get();

  if (snapshot.empty) return;

  const docs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

  // Process in batches of 250 (each doc = 2 ops: set archive + delete original)
  for (let i = 0; i < docs.length; i += 250) {
    const batch = db.batch();
    const chunk = docs.slice(i, i + 250);

    for (const report of chunk) {
      // Copy to archive collection
      batch.set(db.doc(`reportsArchive/${report.id}`), report);
      // Delete from active reports
      batch.delete(db.doc(`reports/${report.id}`));
    }

    await batch.commit();
  }

  log.info('cron', 'archiveReports: archived old reports', { count: docs.length });
}

module.exports = archiveReports;

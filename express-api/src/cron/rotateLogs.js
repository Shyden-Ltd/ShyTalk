/**
 * Cron: Rotate old logs from Firestore to R2.
 *
 * 1. Reads retentionHours from Firestore logConfig/settings (default 48).
 * 2. Queries logs older than the retention cutoff (limit 500).
 * 3. Archives them as NDJSON to R2.
 * 4. Batch-deletes them from Firestore.
 * 5. Prunes R2 log files older than 90 days.
 */

const { db } = require('../utils/firebase');
const r2 = require('../utils/r2');
const log = require('../utils/log');

const DEFAULT_RETENTION_HOURS = 48;
const PRUNE_DAYS = 90;

async function rotateLogs() {
  // 1. Read config
  let retentionHours = DEFAULT_RETENTION_HOURS;
  try {
    const configDoc = await db.collection('logConfig').doc('settings').get();
    if (
      configDoc.exists &&
      configDoc.data().retentionHours !== null &&
      configDoc.data().retentionHours !== undefined
    ) {
      retentionHours = configDoc.data().retentionHours;
    }
  } catch (err) {
    log.error('cron', 'rotateLogs: failed to read config, using default', { error: err.message });
  }

  // 2. Calculate cutoff
  const cutoff = new Date(Date.now() - retentionHours * 3600000).toISOString();

  // 3. Query expired logs
  const snapshot = await db
    .collection('logs')
    .where('timestamp', '<', cutoff)
    .orderBy('timestamp')
    .limit(500)
    .get();

  if (!snapshot.empty) {
    const docs = snapshot.docs;

    // 3a. Build NDJSON
    const ndjson = docs.map((d) => JSON.stringify({ id: d.id, ...d.data() })).join('\n');

    // 3b. Write to R2
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const hh = String(now.getUTCHours()).padStart(2, '0');
    const key = `logs/${yyyy}/${mm}/${dd}/${hh}-${Date.now()}.ndjson`;

    await r2.putObject(key, ndjson, 'application/x-ndjson');

    // 4. Batch delete from Firestore (max 500 per batch)
    const batch = db.batch();
    for (const doc of docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();

    log.info('cron', 'rotateLogs: archived logs', { count: docs.length, key });
  }

  // 5. Prune R2 logs older than 90 days
  await pruneOldLogs();
}

async function pruneOldLogs() {
  const keys = await r2.listObjects('logs/');
  const cutoffDate = new Date(Date.now() - PRUNE_DAYS * 24 * 3600000);

  const toDelete = keys.filter((key) => {
    const match = key.match(/^logs\/(\d{4})\/(\d{2})\/(\d{2})\//);
    if (!match) return false;
    const keyDate = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
    return keyDate < cutoffDate;
  });

  if (toDelete.length > 0) {
    await r2.deleteObjects(toDelete);
    log.info('cron', 'rotateLogs: pruned old log files', { count: toDelete.length });
  }
}

module.exports = rotateLogs;

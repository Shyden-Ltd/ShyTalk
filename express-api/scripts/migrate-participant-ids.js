/* eslint-disable no-console */
/**
 * One-time migration: convert participantIds from strings to numbers
 * in all conversation documents.
 *
 * Firestore security rules check `uniqueId in resource.data.participantIds`
 * where uniqueId is a number (set via custom claims). If participantIds are
 * stored as strings, the type-strict `in` operator fails silently.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./sa.json FIREBASE_DATABASE_URL=... node scripts/migrate-participant-ids.js
 *
 * Safe to re-run — already-numeric values are left unchanged.
 */

async function migrateParticipantIds(db) {
  const snapshot = await db.collection('conversations').get();
  let migrated = 0;
  let skipped = 0;
  const batch = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const ids = data.participantIds;
    if (!Array.isArray(ids)) {
      skipped++;
      continue;
    }

    const hasStringIds = ids.some((id) => typeof id === 'string');
    if (!hasStringIds) {
      skipped++;
      continue;
    }

    const numericIds = ids
      .map((id) => {
        const num = Number(id);
        return Number.isFinite(num) ? num : id;
      })
      .sort((a, b) => a - b);

    batch.push({ ref: doc.ref, numericIds });
    migrated++;
  }

  // Write in batches of 500 (Firestore limit)
  for (let i = 0; i < batch.length; i += 500) {
    const writeBatch = db.batch();
    const chunk = batch.slice(i, i + 500);
    for (const { ref, numericIds } of chunk) {
      writeBatch.update(ref, { participantIds: numericIds });
    }
    await writeBatch.commit();
  }

  return { migrated, skipped, total: snapshot.size };
}

// CLI entry point
if (require.main === module) {
  const { db } = require('../src/utils/firebase');
  migrateParticipantIds(db)
    .then((result) => {
      console.log(
        `Migration complete: ${result.migrated} migrated, ${result.skipped} skipped (${result.total} total)`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = { migrateParticipantIds };

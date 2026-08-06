/* eslint-disable no-console */
/**
 * One-time migration (SHY-0130): convert `participantIds` from numbers BACK to
 * STRINGS in all conversation documents.
 *
 * Firestore security rules gate conversation reads on
 * `string(callerUniqueId()) in resource.data.participantIds` — the caller's
 * uniqueId is STRINGIFIED, so `participantIds` must be stored as STRINGS (the
 * same type the model `List<String>`, iOS, and Express `.map(String)` all use).
 *
 * This REVERSES an earlier, mistaken migration (and the Android client's
 * `toLongOrNull()` coercion) that converted ids to numbers on the false premise
 * that the rule compared a numeric uniqueId. Numeric `participantIds` make a
 * thread unreadable by the string gate — including by its own participants.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./sa.json FIREBASE_DATABASE_URL=... node scripts/migrate-participant-ids.js
 *
 * Safe to re-run — already-string values are left unchanged.
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

    const hasNonStringId = ids.some((id) => typeof id !== 'string');
    if (!hasNonStringId) {
      skipped++;
      continue;
    }

    // Stringify every id and sort lexicographically (matches the iOS/Express
    // `listOf(...).sorted()` shape; the rule's membership check is order-agnostic).
    const stringIds = ids.map((id) => String(id)).sort();

    batch.push({ ref: doc.ref, stringIds });
    migrated++;
  }

  // Write in batches of 500 (Firestore limit)
  for (let i = 0; i < batch.length; i += 500) {
    const writeBatch = db.batch();
    const chunk = batch.slice(i, i + 500);
    for (const { ref, stringIds } of chunk) {
      writeBatch.update(ref, { participantIds: stringIds });
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

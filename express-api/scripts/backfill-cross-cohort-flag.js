/* eslint-disable no-console */
/**
 * One-time backfill (SHY-0132): stamp `crossCohortAtMigration: false` on every
 * conversation document that LACKS the field.
 *
 * The conversations `list` segregation filter is `where('crossCohortAtMigration',
 * '==', false)` — a `== false` equality matches a doc ONLY if the field is present
 * and false; it EXCLUDES a doc where the field is absent. Legacy threads predate
 * the field, so without this backfill the filter would hide every legitimate
 * (non-migrated) thread. Migrated cross-cohort threads carry
 * `crossCohortAtMigration: true` and MUST stay hidden, so this NEVER overwrites an
 * existing value — it only fills in the absent ones.
 *
 * ORDERING (hard): run this on dev THEN prod, and deploy the composite index,
 * BEFORE shipping the client filter — otherwise legitimate threads vanish.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./sa.json FIREBASE_DATABASE_URL=... \
 *     node scripts/backfill-cross-cohort-flag.js
 *
 * Safe to re-run — docs that already have the field (true or false) are skipped.
 * Verify a post-run count of remaining absent-field docs == 0.
 */

async function backfillCrossCohortFlag(db) {
  const snapshot = await db.collection('conversations').get();
  let updated = 0;
  let skipped = 0;
  const refs = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    // Stamp ONLY when the field is genuinely ABSENT — never overwrite true/false.
    if (Object.prototype.hasOwnProperty.call(data, 'crossCohortAtMigration')) {
      skipped++;
      continue;
    }
    refs.push(doc.ref);
    updated++;
  }

  // Write in batches of 500 (Firestore limit).
  for (let i = 0; i < refs.length; i += 500) {
    const writeBatch = db.batch();
    for (const ref of refs.slice(i, i + 500)) {
      writeBatch.update(ref, { crossCohortAtMigration: false });
    }
    await writeBatch.commit();
  }

  return { updated, skipped, total: snapshot.size };
}

// CLI entry point
if (require.main === module) {
  const { db } = require('../src/utils/firebase');
  backfillCrossCohortFlag(db)
    .then((result) => {
      console.log(
        `Backfill complete: ${result.updated} stamped, ${result.skipped} skipped (${result.total} total)`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error('Backfill failed:', err);
      process.exit(1);
    });
}

module.exports = { backfillCrossCohortFlag };

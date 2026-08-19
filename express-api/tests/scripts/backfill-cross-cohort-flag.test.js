/**
 * SHY-0132 — backfillCrossCohortFlag stamps `crossCohortAtMigration: false` on
 * every conversation doc where the field is ABSENT, so the client's
 * `where('crossCohortAtMigration','==', false)` segregation filter (which excludes
 * absent-field docs) does not hide legitimate threads. It NEVER overwrites an
 * existing value (a migrated `true` must stay `true`). Driven against the REAL
 * Firestore emulator via rules-unit-testing `withSecurityRulesDisabled`
 * (admin-equivalent) — no mock db (EPIC-0003).
 *
 * Requires the Firestore emulator (`bash local/start.sh`, default localhost:8080).
 */

const { readFileSync } = require('fs');
const { join } = require('path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { firestoreHostPort, assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { backfillCrossCohortFlag } = require('../../scripts/backfill-cross-cohort-flag');

const RULES_PATH = join(__dirname, '..', '..', '..', 'firestore.rules');
const PROJECT_ID = `demo-shytalk-backfill-cc-${process.env.JEST_WORKER_ID || '1'}`;

let testEnv;

beforeAll(async () => {
  await assertEmulatorReachable();
  const { host, port } = firestoreHostPort();
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host, port, rules: readFileSync(RULES_PATH, 'utf8') },
  });
});

afterAll(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

/** Run `fn(db)` with a rules-disabled (admin-equivalent) Firestore handle. */
function withAdminDb(fn) {
  return testEnv.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));
}

describe('backfillCrossCohortFlag — stamp false where absent (SHY-0132, real emulator)', () => {
  test('stamps crossCohortAtMigration:false on a doc missing the field', async () => {
    await withAdminDb(async (db) => {
      await db
        .collection('conversations')
        .doc('c-1')
        .set({ participantIds: ['1', '2'] });

      const result = await backfillCrossCohortFlag(db);
      expect(result.updated).toBe(1);

      const after = (await db.collection('conversations').doc('c-1').get()).data();
      expect(after.crossCohortAtMigration).toBe(false);
    });
  });

  test('NEVER overwrites an existing crossCohortAtMigration:true (migrated thread stays hidden)', async () => {
    await withAdminDb(async (db) => {
      await db
        .collection('conversations')
        .doc('c-true')
        .set({ participantIds: ['1', '2'], crossCohortAtMigration: true });

      const result = await backfillCrossCohortFlag(db);
      expect(result.updated).toBe(0);
      expect(result.skipped).toBe(1);

      const after = (await db.collection('conversations').doc('c-true').get()).data();
      expect(after.crossCohortAtMigration).toBe(true); // untouched
    });
  });

  test('skips a doc that already has crossCohortAtMigration:false (idempotent)', async () => {
    await withAdminDb(async (db) => {
      await db
        .collection('conversations')
        .doc('c-false')
        .set({ participantIds: ['1', '2'], crossCohortAtMigration: false });

      const result = await backfillCrossCohortFlag(db);
      expect(result.updated).toBe(0);
      expect(result.skipped).toBe(1);
    });
  });

  test('reports correct total / updated / skipped across a mixed collection', async () => {
    await withAdminDb(async (db) => {
      await db
        .collection('conversations')
        .doc('a')
        .set({ participantIds: ['1'] }); // absent → update
      await db
        .collection('conversations')
        .doc('b')
        .set({ participantIds: ['2'], crossCohortAtMigration: true }); // skip
      await db
        .collection('conversations')
        .doc('c')
        .set({ participantIds: ['3'], crossCohortAtMigration: false }); // skip
      await db
        .collection('conversations')
        .doc('d')
        .set({ participantIds: ['4'] }); // absent → update

      const result = await backfillCrossCohortFlag(db);
      expect(result.total).toBe(4);
      expect(result.updated).toBe(2);
      expect(result.skipped).toBe(2);
    });
  });

  test('returns zero counts for an empty collection', async () => {
    await withAdminDb(async (db) => {
      const result = await backfillCrossCohortFlag(db);
      expect(result).toEqual({ total: 0, updated: 0, skipped: 0 });
    });
  });

  test('stamps a collection spanning multiple 500-doc write batches', async () => {
    await withAdminDb(async (db) => {
      const N = 501;
      for (let i = 0; i < N; i += 500) {
        const seed = db.batch();
        for (let j = i; j < Math.min(i + 500, N); j++) {
          seed.set(db.collection('conversations').doc(`b-${j}`), { participantIds: [`${j}`] });
        }
        await seed.commit();
      }

      const result = await backfillCrossCohortFlag(db);
      expect(result.total).toBe(N);
      expect(result.updated).toBe(N);

      const after = await db.collection('conversations').get();
      const allStamped = after.docs.every((d) => d.data().crossCohortAtMigration === false);
      expect(allStamped).toBe(true);
    });
  });
});

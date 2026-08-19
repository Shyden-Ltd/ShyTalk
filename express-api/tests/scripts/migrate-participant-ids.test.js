/**
 * SHY-0130 — migrateParticipantIds reverses the legacy corruption: it converts
 * numeric `participantIds` back to STRINGS so the rule's `string(callerUniqueId())
 * in resource.data.participantIds` gate (and iOS / Express, which use strings)
 * can read the threads. Driven against the REAL Firestore emulator via the
 * rules-unit-testing `withSecurityRulesDisabled` context (admin-equivalent, no
 * rules) — no mock db (EPIC-0003).
 *
 * Requires the Firestore emulator (`bash local/start.sh`, default localhost:8080).
 */

const { readFileSync } = require('fs');
const { join } = require('path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { firestoreHostPort, assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { migrateParticipantIds } = require('../../scripts/migrate-participant-ids');

const RULES_PATH = join(__dirname, '..', '..', '..', 'firestore.rules');
const PROJECT_ID = `demo-shytalk-migrate-pids-${process.env.JEST_WORKER_ID || '1'}`;

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

describe('migrateParticipantIds — numeric → string (SHY-0130, real emulator)', () => {
  test('converts numeric participantIds to strings', async () => {
    await withAdminDb(async (db) => {
      await db
        .collection('conversations')
        .doc('c-1')
        .set({ participantIds: [10000001, 10000002], isGroup: false });

      const result = await migrateParticipantIds(db);
      expect(result.migrated).toBe(1);

      const after = (await db.collection('conversations').doc('c-1').get()).data();
      expect(after.participantIds).toEqual(['10000001', '10000002']);
      expect(after.participantIds.every((x) => typeof x === 'string')).toBe(true);
    });
  });

  test('skips already-string participantIds (idempotent — safe to re-run)', async () => {
    await withAdminDb(async (db) => {
      await db
        .collection('conversations')
        .doc('c-2')
        .set({ participantIds: ['10000001', '10000002'] });

      const result = await migrateParticipantIds(db);
      expect(result.migrated).toBe(0);
      expect(result.skipped).toBe(1);
    });
  });

  test('skips docs without a participantIds array', async () => {
    await withAdminDb(async (db) => {
      await db.collection('conversations').doc('c-3').set({ isGroup: true });

      const result = await migrateParticipantIds(db);
      expect(result.migrated).toBe(0);
      expect(result.skipped).toBe(1);
    });
  });

  test('converts a mixed numeric+string array to all strings', async () => {
    await withAdminDb(async (db) => {
      await db
        .collection('conversations')
        .doc('c-4')
        .set({ participantIds: ['10000001', 10000002] });

      const result = await migrateParticipantIds(db);
      expect(result.migrated).toBe(1);

      const after = (await db.collection('conversations').doc('c-4').get()).data();
      expect(after.participantIds).toEqual(['10000001', '10000002']);
    });
  });

  test('reports correct total / migrated / skipped across a mixed collection', async () => {
    await withAdminDb(async (db) => {
      await db
        .collection('conversations')
        .doc('a')
        .set({ participantIds: [3, 4] });
      await db
        .collection('conversations')
        .doc('b')
        .set({ participantIds: ['5', '6'] });
      await db
        .collection('conversations')
        .doc('c')
        .set({ participantIds: [7, 8] });

      const result = await migrateParticipantIds(db);
      expect(result.total).toBe(3);
      expect(result.migrated).toBe(2);
      expect(result.skipped).toBe(1);
    });
  });

  test('returns zero counts for an empty collection', async () => {
    await withAdminDb(async (db) => {
      // beforeEach clears Firestore — the `conversations` collection is empty,
      // so the scan loop never executes.
      const result = await migrateParticipantIds(db);
      expect(result).toEqual({ total: 0, migrated: 0, skipped: 0 });
    });
  });

  test('migrates a collection spanning multiple 500-doc write batches', async () => {
    await withAdminDb(async (db) => {
      // 501 docs forces the chunked-write loop (`slice(i, i + 500)`) to commit a
      // SECOND batch — guards an off-by-one at the 500-doc Firestore batch limit.
      const N = 501;
      for (let i = 0; i < N; i += 500) {
        const seed = db.batch();
        for (let j = i; j < Math.min(i + 500, N); j++) {
          seed.set(db.collection('conversations').doc(`b-${j}`), {
            participantIds: [10000000 + j, 20000000 + j],
          });
        }
        await seed.commit();
      }

      const result = await migrateParticipantIds(db);
      expect(result.total).toBe(N);
      expect(result.migrated).toBe(N);

      // Every doc — including those written by the 2nd batch (index ≥ 500) —
      // is now all-strings, proving the second commit actually landed.
      const after = await db.collection('conversations').get();
      expect(after.size).toBe(N);
      const allStrings = after.docs.every((d) =>
        d.data().participantIds.every((x) => typeof x === 'string'),
      );
      expect(allStrings).toBe(true);
    });
  });
});

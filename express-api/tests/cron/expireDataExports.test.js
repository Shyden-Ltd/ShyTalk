/**
 * expireDataExports.test.js — EPIC-0003 / SHY-0120 (cron → real local stack).
 *
 * MIGRATED off the firebase + r2 + log Jest mocks. The prior tests faked the
 * `users` query chain and the R2 client, then asserted "the deleteObjects mock
 * was called" — so they could not catch a real R2 object surviving, a wrong
 * Firestore field write, or the `> 0` / `== 'ready'` query clauses drifting.
 *
 * This suite drives the REAL cron against the REAL local stack:
 *   - REAL Firestore emulator: users are seeded with `db.doc().set()` and the
 *     post-run state is read back and asserted at the value level
 *     (`dataExportStatus: 'expired'`, `dataExportR2Key: null`).
 *   - REAL MinIO (the local R2, NODE_ENV=local → http://localhost:9002): export
 *     objects are PUT for real via `r2.putObject` and their deletion is verified
 *     by listing the bucket — not by a spy on `deleteObjects`.
 *
 * The query's two filter clauses are each proven by a real excluded doc:
 *   - `dataExportExpiresAt > 0`  → a doc with `expiresAt: 0` is left untouched.
 *   - `dataExportStatus == 'ready'` → a `generating` doc with a past expiry is
 *     left untouched.
 *
 * The `.limit(CRON_LIMIT)` cap is proven by seeding 501 expired docs and
 * asserting exactly 500 flip while ≥1 remains `ready` for the next tick (the
 * fire-and-forget `log.warn('hit CRON_LIMIT')` is the observability echo of
 * this real truncation — `log.js` swallows its async write, so the truncation
 * is verified by the surviving backlog, not by matching the log line).
 *
 * NOT covered here (operator-approved Option-A escape-hatch, EPIC-0003): the
 * per-doc `catch` branch (R2/Firestore failure mid-loop). S3/MinIO DeleteObjects
 * is idempotent (deleting a missing key succeeds), MinIO root creds never deny,
 * and the emulator accepts every write — so a single doc's deletion cannot be
 * made to throw without a mock. There is no pure logic to extract, so loop
 * robustness is instead proven by the real multi-doc run below; true-failure
 * injection is the documented escape-hatch.
 *
 * Isolation: clears `users` and the test R2 prefix in beforeEach.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const { CreateBucketCommand } = require('@aws-sdk/client-s3');
const { db } = require('../../src/utils/firebase');
const r2 = require('../../src/utils/r2');
const expireDataExports = require('../../src/cron/expireDataExports');
const { assertEmulatorReachable, clearCollection } = require('../helpers/firebase-emulator');

const TEST_PREFIX = 'exports/cron-expire-test';
const HOUR_MS = 60 * 60 * 1000;
const keyFor = (id) => `${TEST_PREFIX}/${id}.zip`;

const seedUser = (id, fields) => db.doc(`users/${id}`).set(fields);
const getUser = async (id) => (await db.doc(`users/${id}`).get()).data();
const putExport = (key) => r2.putObject(key, Buffer.from('zip-bytes'), 'application/zip');
const objectExists = async (key) => (await r2.listObjects(key)).includes(key);

async function clearTestObjects() {
  const keys = await r2.listObjects(TEST_PREFIX);
  if (keys.length > 0) await r2.deleteObjects(keys);
}

beforeAll(async () => {
  await assertEmulatorReachable();
  // Ensure the bucket exists for real PUTs (idempotent — local seed usually
  // created it already; tolerate the already-owned/exists races).
  try {
    await r2.s3.send(new CreateBucketCommand({ Bucket: r2.bucketName }));
  } catch (err) {
    if (err.name !== 'BucketAlreadyOwnedByYou' && err.name !== 'BucketAlreadyExists') {
      throw err;
    }
  }
});

beforeEach(async () => {
  await clearCollection(db, 'users');
  await clearTestObjects();
});

afterAll(async () => {
  await clearCollection(db, 'users');
  await clearTestObjects();
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('expireDataExports cron (real Firestore emulator + real MinIO)', () => {
  test('deletes the real R2 object AND flips the doc to expired/null key when expiry has passed', async () => {
    const id = '70000001';
    const key = keyFor(id);
    await seedUser(id, {
      dataExportStatus: 'ready',
      dataExportR2Key: key,
      dataExportExpiresAt: Date.now() - HOUR_MS,
    });
    await putExport(key);
    expect(await objectExists(key)).toBe(true); // precondition

    await expireDataExports();

    expect(await objectExists(key)).toBe(false); // real object really deleted
    const user = await getUser(id);
    expect(user.dataExportStatus).toBe('expired');
    expect(user.dataExportR2Key).toBeNull();
  });

  test('leaves a not-yet-expired ready export untouched — object and doc unchanged', async () => {
    const id = '70000002';
    const key = keyFor(id);
    await seedUser(id, {
      dataExportStatus: 'ready',
      dataExportR2Key: key,
      dataExportExpiresAt: Date.now() + 24 * HOUR_MS,
    });
    await putExport(key);

    await expireDataExports();

    expect(await objectExists(key)).toBe(true);
    const user = await getUser(id);
    expect(user.dataExportStatus).toBe('ready');
    expect(user.dataExportR2Key).toBe(key);
  });

  test('excludes a ready doc with dataExportExpiresAt === 0 (the > 0 query clause)', async () => {
    const id = '70000003';
    const key = keyFor(id);
    await seedUser(id, {
      dataExportStatus: 'ready',
      dataExportR2Key: key,
      dataExportExpiresAt: 0,
    });
    await putExport(key);

    await expireDataExports();

    // expiresAt 0 means "no export pending" — never swept, even though 0 is in
    // the past. Proven by the doc + object surviving untouched.
    expect(await objectExists(key)).toBe(true);
    expect((await getUser(id)).dataExportStatus).toBe('ready');
  });

  test('excludes a non-ready (generating) doc even with a past expiry (the == ready query clause)', async () => {
    const id = '70000004';
    const key = keyFor(id);
    await seedUser(id, {
      dataExportStatus: 'generating',
      dataExportR2Key: key,
      dataExportExpiresAt: Date.now() - HOUR_MS,
    });
    await putExport(key);

    await expireDataExports();

    expect(await objectExists(key)).toBe(true);
    expect((await getUser(id)).dataExportStatus).toBe('generating');
  });

  test('flips a ready+expired doc that has no R2 key (no R2 call, no crash)', async () => {
    const id = '70000005';
    await seedUser(id, {
      dataExportStatus: 'ready',
      dataExportExpiresAt: Date.now() - HOUR_MS,
      // no dataExportR2Key — the `if (data.dataExportR2Key)` guard skips R2.
    });

    await expireDataExports();

    const user = await getUser(id);
    expect(user.dataExportStatus).toBe('expired');
    expect(user.dataExportR2Key).toBeNull();
  });

  test('processes a mixed batch in one run — deletes only the expired-with-key, leaves the future doc', async () => {
    const withKey = '70000010';
    const noKey = '70000011';
    const future = '70000012';
    const keyA = keyFor(withKey);
    const keyC = keyFor(future);

    await seedUser(withKey, {
      dataExportStatus: 'ready',
      dataExportR2Key: keyA,
      dataExportExpiresAt: Date.now() - HOUR_MS,
    });
    await seedUser(noKey, {
      dataExportStatus: 'ready',
      dataExportExpiresAt: Date.now() - HOUR_MS,
    });
    await seedUser(future, {
      dataExportStatus: 'ready',
      dataExportR2Key: keyC,
      dataExportExpiresAt: Date.now() + 24 * HOUR_MS,
    });
    await putExport(keyA);
    await putExport(keyC);

    await expireDataExports();

    // expired-with-key: object gone, doc flipped
    expect(await objectExists(keyA)).toBe(false);
    expect((await getUser(withKey)).dataExportStatus).toBe('expired');
    expect((await getUser(withKey)).dataExportR2Key).toBeNull();
    // expired-no-key: doc flipped (loop continued past the keyless one)
    expect((await getUser(noKey)).dataExportStatus).toBe('expired');
    // future: untouched, object preserved
    expect(await objectExists(keyC)).toBe(true);
    expect((await getUser(future)).dataExportStatus).toBe('ready');
    expect((await getUser(future)).dataExportR2Key).toBe(keyC);
  });

  test('caps at CRON_LIMIT (500) — flips exactly 500 and leaves a backlog of 1 for the next tick', async () => {
    // 501 ready+expired docs, no R2 keys (keeps the seed + sweep fast — the
    // only per-doc cost is the Firestore update). The query's .limit(500)
    // returns 500; the 501st is left behind, still 'ready'.
    const pastExpiry = Date.now() - HOUR_MS;
    const total = 501;
    for (let start = 0; start < total; start += 500) {
      const batch = db.batch();
      for (let i = start; i < Math.min(start + 500, total); i++) {
        batch.set(db.doc(`users/${80000000 + i}`), {
          dataExportStatus: 'ready',
          dataExportExpiresAt: pastExpiry,
        });
      }
      await batch.commit();
    }

    await expireDataExports();

    const expired = await db.collection('users').where('dataExportStatus', '==', 'expired').get();
    const stillReady = await db.collection('users').where('dataExportStatus', '==', 'ready').get();
    expect(expired.size).toBe(500);
    expect(stillReady.size).toBe(1);
  }, 30000);
});

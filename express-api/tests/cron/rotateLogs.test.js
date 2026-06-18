/**
 * rotateLogs.test.js — EPIC-0003 / SHY-0120 (cron → real local stack).
 *
 * MIGRATED off the firebase + r2 + log Jest mocks. The prior tests faked the
 * query chain + the R2 client and asserted "putObject was called" — they could
 * not verify the one property that matters for a log-rotation job: that the
 * rows deleted from Firestore are recoverable as valid NDJSON in R2.
 *
 * This suite drives the REAL cron against the live Firestore emulator + real
 * MinIO (NODE_ENV=local → http://localhost:9002):
 *   - expired `logs` are seeded for real, then after the run the archive object
 *     is READ BACK from R2, parsed line-by-line, and asserted to contain the
 *     rows (with their injected `id`) that vanished from Firestore.
 *   - the retention window comes from a real `logConfig/settings` doc.
 *   - pruning is proven by PUTting real dated R2 keys and checking which survive
 *     (a 2020 key is unconditionally > 90 days old, so no Date.now() pinning is
 *     needed — the prior mock test had to spy on the clock).
 *
 * NOT covered (escape-hatch, EPIC-0003): the config-read `catch` branch (a real
 * emulator `get()` failure is not inducible without a mock) — the config-absent
 * default path IS real and is exercised by the default-retention tests. The
 * fire-and-forget `log.warn('hit CRON_LIMIT')` is observability only; the cap is
 * proven by the surviving backlog, not by matching the log line.
 *
 * Isolation: clears `logs` + `logConfig` and the R2 `logs/` prefix in beforeEach.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const { CreateBucketCommand } = require('@aws-sdk/client-s3');
const { db } = require('../../src/utils/firebase');
const r2 = require('../../src/utils/r2');
const rotateLogs = require('../../src/cron/rotateLogs');
const { assertEmulatorReachable, clearCollection } = require('../helpers/firebase-emulator');

const HOUR_MS = 3600000;
const isoHoursAgo = (h) => new Date(Date.now() - h * HOUR_MS).toISOString();

const now = new Date();
const todayPath = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${String(
  now.getUTCDate(),
).padStart(2, '0')}`;

const seedLog = (id, fields) => db.doc(`logs/${id}`).set(fields);
const docExists = async (path) => (await db.doc(path).get()).exists;
const logCount = async () => (await db.collection('logs').get()).size;
const ndjsonObjects = async () =>
  (await r2.listObjects('logs/')).filter((k) => k.endsWith('.ndjson'));
const objectExists = async (key) => (await r2.listObjects(key)).includes(key);
const readObject = async (key) => {
  const resp = await r2.getObject(key);
  return resp.Body.transformToString();
};

async function clearLogObjects() {
  const keys = await r2.listObjects('logs/');
  if (keys.length > 0) await r2.deleteObjects(keys);
}

beforeAll(async () => {
  await assertEmulatorReachable();
  try {
    await r2.s3.send(new CreateBucketCommand({ Bucket: r2.bucketName }));
  } catch (err) {
    if (err.name !== 'BucketAlreadyOwnedByYou' && err.name !== 'BucketAlreadyExists') {
      throw err;
    }
  }
});

beforeEach(async () => {
  await clearCollection(db, 'logs');
  await clearCollection(db, 'logConfig');
  await clearLogObjects();
});

afterAll(async () => {
  await clearCollection(db, 'logs');
  await clearCollection(db, 'logConfig');
  await clearLogObjects();
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('rotateLogs cron (real Firestore emulator + real MinIO)', () => {
  test('archives expired logs to R2 as NDJSON (rows recoverable) and deletes them from Firestore', async () => {
    await seedLog('log-a', {
      level: 'INFO',
      source: 'test',
      message: 'alpha',
      timestamp: isoHoursAgo(72),
    });
    await seedLog('log-b', {
      level: 'ERROR',
      source: 'test',
      message: 'beta',
      timestamp: isoHoursAgo(71),
    });

    await rotateLogs();

    // Both rows gone from Firestore.
    expect(await logCount()).toBe(0);
    // Exactly one NDJSON archive written; the deleted rows are recoverable from it.
    const objs = await ndjsonObjects();
    expect(objs).toHaveLength(1);
    const lines = (await readObject(objs[0]))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const byId = Object.fromEntries(lines.map((e) => [e.id, e]));
    expect(byId['log-a']).toMatchObject({ id: 'log-a', level: 'INFO', message: 'alpha' });
    expect(byId['log-b']).toMatchObject({ id: 'log-b', level: 'ERROR', message: 'beta' });
  });

  test('applies retentionHours from logConfig/settings — only logs past the custom cutoff are rotated', async () => {
    await db.doc('logConfig/settings').set({ retentionHours: 1 });
    await seedLog('old', { message: 'expired', timestamp: isoHoursAgo(2) }); // > 1h cutoff
    await seedLog('fresh', { message: 'kept', timestamp: isoHoursAgo(0.5) }); // < 1h cutoff

    await rotateLogs();

    expect(await docExists('logs/old')).toBe(false);
    expect(await docExists('logs/fresh')).toBe(true);
  });

  test('archives nothing when every log is within the default (48h) retention window', async () => {
    await seedLog('fresh', { message: 'recent', timestamp: isoHoursAgo(1) });

    await rotateLogs();

    expect(await docExists('logs/fresh')).toBe(true);
    expect(await ndjsonObjects()).toHaveLength(0); // archive block skipped
  });

  test('prunes R2 log files older than 90 days, keeping recent and non-dated keys', async () => {
    const oldKey = 'logs/2020/01/01/00-old.ndjson';
    const recentKey = `logs/${todayPath}/00-recent.ndjson`;
    const nonDatedKey = 'logs/keepme.txt';
    await r2.putObject(oldKey, 'old', 'application/x-ndjson');
    await r2.putObject(recentKey, 'recent', 'application/x-ndjson');
    await r2.putObject(nonDatedKey, 'note', 'text/plain');

    // No expired Firestore logs → archive block skipped, only pruneOldLogs runs.
    await rotateLogs();

    expect(await objectExists(oldKey)).toBe(false); // > 90 days → pruned
    expect(await objectExists(recentKey)).toBe(true); // < 90 days → kept
    expect(await objectExists(nonDatedKey)).toBe(true); // regex non-match → ignored
  });

  test('caps at CRON_LIMIT (500) — archives the 500 oldest and leaves the overflow for the next tick', async () => {
    const total = 501;
    const base = Date.now() - 72 * HOUR_MS;
    for (let start = 0; start < total; start += 500) {
      const batch = db.batch();
      for (let i = start; i < Math.min(start + 500, total); i++) {
        // Distinct ascending timestamps so orderBy('timestamp') takes the 500
        // oldest; the newest (i = 500) is left behind.
        batch.set(db.doc(`logs/bulk-${i}`), {
          message: `m${i}`,
          timestamp: new Date(base + i * 1000).toISOString(),
        });
      }
      await batch.commit();
    }

    await rotateLogs();

    const objs = await ndjsonObjects();
    expect(objs).toHaveLength(1);
    expect((await readObject(objs[0])).trim().split('\n')).toHaveLength(500); // 500 archived
    expect(await logCount()).toBe(1); // 1 backlog left
  }, 30000);
});

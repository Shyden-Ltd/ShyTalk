/**
 * backups.test.js — EPIC-0003 / SHY-0120 (cron → real local stack).
 *
 * MIGRATED off the firebase + r2 + log Jest mocks. The prior 26 tests faked the
 * Firestore query chain + the R2 client and asserted putObject/deleteObjects
 * call SHAPES — they never wrote a real backup object, so they could not prove
 * the one property that matters for a disaster-recovery job: that a backed-up
 * collection is actually RECOVERABLE (valid JSON, every doc present with its
 * injected `id`) from the real object store.
 *
 * This suite drives the REAL cron against the live Firestore emulator + real
 * MinIO (NODE_ENV=local → http://localhost:9002): real collections are seeded,
 * the cron runs, and the backup objects are READ BACK from the bucket, parsed,
 * and asserted to contain the seeded docs (with their injected `id`/`parentId`).
 *
 * Dev vs production scope: backups.js fixes TOP_LEVEL_COLLECTIONS +
 * SUBCOLLECTIONS at module-load time from NODE_ENV. Because r2.js binds to MinIO
 * ONLY when NODE_ENV=local (and firebase.js routes to the emulator the same
 * way), the file MUST load under NODE_ENV=local — there is no NODE_ENV value
 * that gives both the production collection scope AND real MinIO. So the
 * production-scope tests drive `backups()` with the full collection set injected
 * explicitly (`backups({ topLevelCollections, subcollections })`) using the
 * module's own exported ALL_* constants — exercising the real expanded scope +
 * real subcollection aggregation against the real emulator + MinIO. No test
 * double, no env juggling; just the real cron driven over real seeded data.
 * The runtime NODE_ENV='production' → ALL ternary itself is the one line not
 * exercised here (its sibling — local → DEV subset — IS proven below).
 *
 * NOT covered (escape-hatch, EPIC-0003): the per-collection / per-subcollection
 * `catch` branches (a real emulator `.get()` failure — and thus the failed-
 * collection-omitted-from-manifest and users-backup-"[]"-fallback paths — is
 * not inducible against a healthy emulator without a mock).
 *
 * Isolation: clears the seeded collections + the messages collection-group
 * (orphaned subcollection docs survive parent deletion and parent IDs are
 * reused across tests) + the entire backups/ R2 prefix in beforeEach.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const { CreateBucketCommand } = require('@aws-sdk/client-s3');
const { db } = require('../../src/utils/firebase');
const r2 = require('../../src/utils/r2');
const devBackups = require('../../src/cron/backups');
const {
  assertEmulatorReachable,
  clearCollection,
  clearCollectionGroup,
} = require('../helpers/firebase-emulator');

const listKeys = (prefix) => r2.listObjects(prefix);
const exists = async (key) => (await r2.listObjects(key)).includes(key);
const readJson = async (key) => {
  const resp = await r2.getObject(key);
  return JSON.parse(await resp.Body.transformToString());
};
const dayUtc = (offsetMs) => new Date(Date.now() + offsetMs).toISOString().slice(0, 10);

async function clearBackupObjects() {
  const keys = await r2.listObjects('backups/');
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
  await clearCollection(db, 'users');
  await clearCollection(db, 'config');
  await clearCollection(db, 'counters');
  await clearCollection(db, 'rooms');
  await clearCollection(db, 'conversations');
  await clearCollection(db, 'reports');
  await clearCollection(db, 'banners');
  await clearCollectionGroup(db, 'messages');
  await clearBackupObjects();
});

afterAll(async () => {
  await clearCollection(db, 'users');
  await clearCollection(db, 'config');
  await clearCollection(db, 'counters');
  await clearCollection(db, 'rooms');
  await clearCollection(db, 'conversations');
  await clearCollection(db, 'reports');
  await clearCollection(db, 'banners');
  await clearCollectionGroup(db, 'messages');
  await clearBackupObjects();
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('backups cron — local/dev scope (real Firestore emulator + real MinIO)', () => {
  test('selects the dev subset in this (local) env and exposes the full production candidate set', () => {
    // The env-driven selection picked the dev subset here (NODE_ENV=local).
    expect(devBackups.TOP_LEVEL_COLLECTIONS).toEqual(devBackups.DEV_TOP_LEVEL_COLLECTIONS);
    expect(devBackups.SUBCOLLECTIONS).toEqual([]);
    // The full production candidate set is complete (27 top-level + 11 sub-pairs).
    expect(devBackups.ALL_TOP_LEVEL_COLLECTIONS).toHaveLength(27);
    expect(devBackups.ALL_TOP_LEVEL_COLLECTIONS).toEqual(
      expect.arrayContaining(['users', 'rooms', 'conversations', 'deviceBans', 'networkBans']),
    );
    expect(devBackups.ALL_SUBCOLLECTIONS).toHaveLength(11);
  });

  test('backs up the dev collections with recoverable content, correct manifest counts, and returns {date, manifest}', async () => {
    await db.doc('users/u1').set({ displayName: 'Alice', age: 25 });
    await db.doc('users/u2').set({ displayName: 'Bob', age: 30 });
    await db.doc('config/app').set({ minVersion: '1.0.0' });
    await db.doc('counters/global').set({ users: 2, rooms: 0 });
    await db.doc('counters/daily').set({ signups: 7 });

    const result = await devBackups();

    // Return value reflects the real run.
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.manifest.collections).toEqual({ users: 2, config: 1, counters: 2 });

    const fullKeys = await listKeys('backups/full/');

    // The users backup is recoverable from the bucket, every doc with its id.
    const usersDocs = await readJson(fullKeys.find((k) => k.endsWith('/users.json')));
    const byId = Object.fromEntries(usersDocs.map((d) => [d.id, d]));
    expect(byId.u1).toEqual({ id: 'u1', displayName: 'Alice', age: 25 });
    expect(byId.u2).toEqual({ id: 'u2', displayName: 'Bob', age: 30 });

    // The manifest object is recoverable and agrees with the return value.
    const manifest = await readJson(fullKeys.find((k) => k.endsWith('/manifest.json')));
    expect(manifest.date).toBe(result.date);
    expect(manifest.collections).toEqual({ users: 2, config: 1, counters: 2 });
  });

  test('in local/dev scope backs up ONLY the dev collections — no non-dev collection and no subcollection', async () => {
    await db.doc('users/u1').set({ displayName: 'Alice' });
    await db.doc('rooms/r1').set({ name: 'Room One' });
    await db.doc('conversations/c1').set({ name: 'Convo' });
    await db.doc('rooms/r1/messages/m1').set({ type: 'IMAGE', text: 'hi' });

    await devBackups();

    const fullKeys = await listKeys('backups/full/');
    expect(fullKeys.some((k) => k.endsWith('/users.json'))).toBe(true);
    expect(fullKeys.some((k) => k.endsWith('/config.json'))).toBe(true);
    expect(fullKeys.some((k) => k.endsWith('/counters.json'))).toBe(true);
    // Non-dev top-level collections are not in the dev scope.
    expect(fullKeys.some((k) => k.endsWith('/rooms.json'))).toBe(false);
    expect(fullKeys.some((k) => k.endsWith('/conversations.json'))).toBe(false);
    expect(fullKeys.some((k) => k.endsWith('/deviceBans.json'))).toBe(false);
    // No subcollections are backed up in the dev scope.
    expect(fullKeys.some((k) => k.endsWith('/rooms_messages.json'))).toBe(false);
  });

  test('writes empty [] backup files for empty collections without throwing', async () => {
    await expect(devBackups()).resolves.toBeDefined();

    const fullKeys = await listKeys('backups/full/');
    const usersKey = fullKeys.find((k) => k.endsWith('/users.json'));
    expect(usersKey).toBeDefined();
    expect(await readJson(usersKey)).toEqual([]);
  });

  test('writes a backwards-compatible users backup equal to the full users-collection backup', async () => {
    await db.doc('users/u1').set({ displayName: 'Alice', age: 25 });
    await db.doc('users/u2').set({ displayName: 'Bob', age: 30 });

    await devBackups();

    const legacyKey = (await listKeys('backups/users/')).find((k) =>
      /^backups\/users\/\d{4}-\d{2}-\d{2}\.json$/.test(k),
    );
    expect(legacyKey).toBeDefined();
    const legacyDocs = await readJson(legacyKey);

    const usersKey = (await listKeys('backups/full/')).find((k) => k.endsWith('/users.json'));
    const fullDocs = await readJson(usersKey);

    expect(legacyDocs).toEqual(fullDocs);
    expect(legacyDocs.map((d) => d.id).sort()).toEqual(['u1', 'u2']);
  });

  test('prunes backups older than 7 days under both backups/full/ and backups/users/, keeping recent ones', async () => {
    const recent = dayUtc(-24 * 3600 * 1000); // yesterday → < 7 days old
    const oldFull = 'backups/full/2020-01-01/users.json';
    const recentFull = `backups/full/${recent}/users.json`;
    const oldLegacy = 'backups/users/2020-01-01.json';
    const recentLegacy = `backups/users/${recent}.json`;
    for (const k of [oldFull, recentFull, oldLegacy, recentLegacy]) {
      await r2.putObject(k, Buffer.from('[]'), 'application/json');
    }

    await devBackups();

    expect(await exists(oldFull)).toBe(false); // > 7 days → pruned
    expect(await exists(oldLegacy)).toBe(false); // > 7 days → pruned
    expect(await exists(recentFull)).toBe(true); // < 7 days → kept
    expect(await exists(recentLegacy)).toBe(true); // < 7 days → kept
  });

  test('keeps a 6-day-old backup but prunes an 8-day-old one (calendar-window boundary)', async () => {
    // Dates are parsed at midnight UTC and compared against `Date.now() - 7d`.
    // 6 calendar-days ago (midnight) is always inside the window regardless of
    // the wall-clock time of day; 8 days ago is always outside. (Exactly-7-days
    // is deliberately NOT asserted — its midnight value straddles `now - 7d`, so
    // its kept/pruned outcome is time-of-day dependent and would be flaky.)
    const sixDays = dayUtc(-6 * 24 * 3600 * 1000);
    const eightDays = dayUtc(-8 * 24 * 3600 * 1000);
    const keep = `backups/full/${sixDays}/users.json`;
    const drop = `backups/full/${eightDays}/users.json`;
    await r2.putObject(keep, Buffer.from('[]'), 'application/json');
    await r2.putObject(drop, Buffer.from('[]'), 'application/json');

    await devBackups();

    expect(await exists(keep)).toBe(true); // 6d ago → inside 7d window → kept
    expect(await exists(drop)).toBe(false); // 8d ago → outside window → pruned
  });

  test('skips pruning keys whose date segment is unparseable', async () => {
    const oldFull = 'backups/full/2020-01-01/users.json';
    const weirdFull = 'backups/full/not-a-date/users.json';
    await r2.putObject(oldFull, Buffer.from('[]'), 'application/json');
    await r2.putObject(weirdFull, Buffer.from('[]'), 'application/json');

    await devBackups();

    expect(await exists(oldFull)).toBe(false); // valid old date → pruned
    expect(await exists(weirdFull)).toBe(true); // NaN date → skipped, never deleted
  });
});

describe('backups cron — full production scope (ALL collections injected, real stack)', () => {
  // Drive the real cron with the production collection set passed explicitly,
  // so the expanded top-level scope + subcollection aggregation run against the
  // real emulator + MinIO without forcing NODE_ENV (which would re-route r2 off
  // MinIO). The injected lists are the module's own exported ALL_* constants.
  const fullScope = {
    topLevelCollections: devBackups.ALL_TOP_LEVEL_COLLECTIONS,
    subcollections: devBackups.ALL_SUBCOLLECTIONS,
  };

  test('backs up non-dev top-level collections (reports, banners) that the dev subset skips', async () => {
    await db.doc('reports/rep1').set({ reason: 'spam', status: 'pending' });
    await db.doc('banners/ban1').set({ title: 'Welcome' });

    await devBackups(fullScope);

    const fullKeys = await listKeys('backups/full/');
    const reportsDocs = await readJson(fullKeys.find((k) => k.endsWith('/reports.json')));
    const bannersDocs = await readJson(fullKeys.find((k) => k.endsWith('/banners.json')));
    expect(reportsDocs).toEqual([{ id: 'rep1', reason: 'spam', status: 'pending' }]);
    expect(bannersDocs).toEqual([{ id: 'ban1', title: 'Welcome' }]);
  }, 30000);

  test('aggregates subcollection docs across parents with injected parentId and id (rooms/messages)', async () => {
    await db.doc('rooms/r1').set({ name: 'Room One' });
    await db.doc('rooms/r2').set({ name: 'Room Two' });
    await db.doc('rooms/r1/messages/m1').set({ text: 'hello' });
    await db.doc('rooms/r1/messages/m2').set({ text: 'world' });
    await db.doc('rooms/r2/messages/m3').set({ text: 'lonely' });

    await devBackups(fullScope);

    const msgsKey = (await listKeys('backups/full/')).find((k) =>
      k.endsWith('/rooms_messages.json'),
    );
    const msgs = await readJson(msgsKey);
    const byId = Object.fromEntries(msgs.map((d) => [d.id, d]));
    expect(msgs).toHaveLength(3);
    expect(byId.m1).toEqual({ id: 'm1', parentId: 'r1', text: 'hello' });
    expect(byId.m2).toEqual({ id: 'm2', parentId: 'r1', text: 'world' });
    expect(byId.m3).toEqual({ id: 'm3', parentId: 'r2', text: 'lonely' });
  }, 30000);
});

/**
 * orphanedStorage.test.js — EPIC-0003 / SHY-0120 (cron → real local stack).
 *
 * MIGRATED off the firebase + r2 + log Jest mocks. The prior 29 tests faked the
 * query chains + the R2 client and asserted `deleteObjects` call SHAPES
 * (`.not.toHaveBeenCalledWith([refKey])`) — they never put a real object, so
 * they could not prove a referenced photo actually SURVIVED on disk, nor that
 * an orphan was actually removed. For a garbage collector that deletes live
 * user media, only the real round-trip is trustworthy.
 *
 * This suite drives the REAL cron against the live Firestore emulator + real
 * MinIO (NODE_ENV=local → http://localhost:9002): referencing docs are seeded,
 * real objects are PUT in each folder, and after the run object existence is
 * read back from the bucket — referenced kept, orphans gone.
 *
 * Covers every referenced source + both field casings: user photo fields
 * (profile/cover/preSuspension × camel/snake), conversation group photo,
 * conversation IMAGE/STICKER messages, reports + reportsArchive evidence,
 * banners; plus the security-relevant CDN-prefix guard (a foreign-hosted URL
 * must NOT protect a same-named key) and graceful non-array handling.
 *
 * NOT covered (escape-hatch, EPIC-0003): the per-folder list/delete `catch`
 * branch (a real MinIO list/delete failure is not inducible without a mock).
 *
 * KNOWN PRODUCT RISK (flagged for a follow-up SHY, NOT fixed here): the cron
 * collects message/sticker keys for only the first 30 conversations
 * (`convsSnap.docs.slice(0, 30)`) but sweeps the whole messages/ + stickers/
 * folders — so referenced media in the 31st+ conversation would be deleted.
 * This suite does not assert (and thus does not bless) that data-loss behaviour.
 *
 * Isolation: clears the referencing collections + the messages collection-group
 * + all scanned R2 folders in beforeEach.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const { CreateBucketCommand } = require('@aws-sdk/client-s3');
const { db } = require('../../src/utils/firebase');
const r2 = require('../../src/utils/r2');
const orphanedStorage = require('../../src/cron/orphanedStorage');
const {
  assertEmulatorReachable,
  clearCollection,
  clearCollectionGroup,
} = require('../helpers/firebase-emulator');

const FOLDERS = [
  'profiles/',
  'covers/',
  'messages/',
  'groups/',
  'evidence/',
  'stickers/',
  'banners/',
  'starting-screens/',
];

const url = (key) => `${r2.CDN_URL}/${key}`;
const put = (key) => r2.putObject(key, Buffer.from('x'), 'image/jpeg');
const exists = async (key) => (await r2.listObjects(key)).includes(key);

async function clearFolders() {
  for (const folder of FOLDERS) {
    const keys = await r2.listObjects(folder);
    if (keys.length > 0) await r2.deleteObjects(keys);
  }
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
  await clearCollection(db, 'conversations');
  await clearCollection(db, 'reports');
  await clearCollection(db, 'reportsArchive');
  await clearCollection(db, 'banners');
  await clearCollectionGroup(db, 'messages');
  await clearFolders();
});

afterAll(async () => {
  await clearCollection(db, 'users');
  await clearCollection(db, 'conversations');
  await clearCollection(db, 'reports');
  await clearCollection(db, 'reportsArchive');
  await clearCollection(db, 'banners');
  await clearCollectionGroup(db, 'messages');
  await clearFolders();
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('orphanedStorage cron (real Firestore emulator + real MinIO)', () => {
  test('keeps every user-referenced photo (all 4 fields, camelCase + snake_case) and deletes orphans', async () => {
    const keep = [
      'profiles/p-camel.jpg',
      'profiles/p-snake.jpg',
      'covers/c-camel.jpg',
      'covers/c-snake.jpg',
      'profiles/presusp-p-camel.jpg',
      'profiles/presusp-p-snake.jpg',
      'covers/presusp-c-camel.jpg',
      'covers/presusp-c-snake.jpg',
    ];
    for (const k of keep) await put(k);
    await put('profiles/orphan.jpg');
    await put('covers/orphan.jpg');

    await db.doc('users/camel').set({
      profilePhotoUrl: url('profiles/p-camel.jpg'),
      coverPhotoUrl: url('covers/c-camel.jpg'),
      preSuspensionProfilePhotoUrl: url('profiles/presusp-p-camel.jpg'),
      preSuspensionCoverPhotoUrl: url('covers/presusp-c-camel.jpg'),
    });
    await db.doc('users/snake').set({
      profile_photo_url: url('profiles/p-snake.jpg'),
      cover_photo_url: url('covers/c-snake.jpg'),
      pre_suspension_profile_photo_url: url('profiles/presusp-p-snake.jpg'),
      pre_suspension_cover_photo_url: url('covers/presusp-c-snake.jpg'),
    });

    await orphanedStorage();

    for (const k of keep) expect(await exists(k)).toBe(true);
    expect(await exists('profiles/orphan.jpg')).toBe(false);
    expect(await exists('covers/orphan.jpg')).toBe(false);
  });

  test('keeps conversation group photos + IMAGE images + STICKER images (both casings); deletes orphans', async () => {
    const keep = [
      'groups/g-camel.jpg',
      'groups/g-snake.jpg',
      'messages/i-camel.jpg',
      'messages/i-snake.jpg',
      'stickers/s-camel.webp',
      'stickers/s-snake.webp',
    ];
    for (const k of keep) await put(k);
    await put('groups/orphan.jpg');
    await put('messages/orphan.jpg');
    await put('stickers/orphan.webp');

    await db.doc('conversations/c-camel').set({ groupPhotoUrl: url('groups/g-camel.jpg') });
    await db.doc('conversations/c-snake').set({ group_photo_url: url('groups/g-snake.jpg') });
    await db
      .doc('conversations/c-camel/messages/im1')
      .set({ type: 'IMAGE', imageUrls: [url('messages/i-camel.jpg')] });
    await db
      .doc('conversations/c-camel/messages/im2')
      .set({ type: 'IMAGE', image_urls: [url('messages/i-snake.jpg')] });
    await db
      .doc('conversations/c-camel/messages/st1')
      .set({ type: 'STICKER', stickerUrl: url('stickers/s-camel.webp') });
    await db
      .doc('conversations/c-camel/messages/st2')
      .set({ type: 'STICKER', sticker_url: url('stickers/s-snake.webp') });

    await orphanedStorage();

    for (const k of keep) expect(await exists(k)).toBe(true);
    expect(await exists('groups/orphan.jpg')).toBe(false);
    expect(await exists('messages/orphan.jpg')).toBe(false);
    expect(await exists('stickers/orphan.webp')).toBe(false);
  });

  test('keeps evidence referenced by reports AND reportsArchive (both casings); deletes orphan evidence', async () => {
    const keep = [
      'evidence/r-camel.jpg',
      'evidence/r-snake.jpg',
      'evidence/a-camel.jpg',
      'evidence/a-snake.jpg',
    ];
    for (const k of keep) await put(k);
    await put('evidence/orphan.jpg');

    await db.doc('reports/r1').set({ evidenceUrls: [url('evidence/r-camel.jpg')] });
    await db.doc('reports/r2').set({ evidence_urls: [url('evidence/r-snake.jpg')] });
    await db.doc('reportsArchive/a1').set({ evidenceUrls: [url('evidence/a-camel.jpg')] });
    await db.doc('reportsArchive/a2').set({ evidence_urls: [url('evidence/a-snake.jpg')] });

    await orphanedStorage();

    for (const k of keep) expect(await exists(k)).toBe(true);
    expect(await exists('evidence/orphan.jpg')).toBe(false);
  });

  test('keeps banner images (both casings); deletes orphan banners', async () => {
    await put('banners/b-camel.jpg');
    await put('banners/b-snake.jpg');
    await put('banners/orphan.jpg');

    await db.doc('banners/b1').set({ imageUrl: url('banners/b-camel.jpg') });
    await db.doc('banners/b2').set({ image_url: url('banners/b-snake.jpg') });

    await orphanedStorage();

    expect(await exists('banners/b-camel.jpg')).toBe(true);
    expect(await exists('banners/b-snake.jpg')).toBe(true);
    expect(await exists('banners/orphan.jpg')).toBe(false);
  });

  test('does NOT protect an object referenced by a foreign (non-CDN) URL — it is swept as an orphan', async () => {
    await put('profiles/foreign.jpg');
    // URL points at another host → extractKey returns null → key not referenced.
    await db
      .doc('users/u')
      .set({ profilePhotoUrl: 'https://evil.example.com/profiles/foreign.jpg' });

    await orphanedStorage();

    expect(await exists('profiles/foreign.jpg')).toBe(false);
  });

  test('sweeps every unreferenced object across all folders, including starting-screens', async () => {
    await put('messages/o1.jpg');
    await put('messages/o2.jpg');
    await put('starting-screens/s1.webp');

    await orphanedStorage();

    expect(await exists('messages/o1.jpg')).toBe(false);
    expect(await exists('messages/o2.jpg')).toBe(false);
    // starting-screens/ is scanned and has no referencing source → swept.
    expect(await exists('starting-screens/s1.webp')).toBe(false);
  });

  test('tolerates a non-array imageUrls field and still sweeps the orphan', async () => {
    await put('messages/orphan.jpg');
    await db.doc('conversations/c1').set({ name: 'c1' });
    await db.doc('conversations/c1/messages/m1').set({ type: 'IMAGE', imageUrls: 'not-an-array' });

    await expect(orphanedStorage()).resolves.toBeUndefined();
    expect(await exists('messages/orphan.jpg')).toBe(false);
  });
});

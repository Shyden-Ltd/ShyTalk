/**
 * Cron: Full orphaned storage cleanup.
 *
 * Collects all referenced R2 keys from users, conversations, reports, banners.
 * Lists R2 objects per folder, deletes orphans.
 */

const { db } = require('../utils/firebase');
const r2 = require('../utils/r2');
const log = require('../utils/log');

const CDN_PREFIX = r2.CDN_URL + '/';

function extractKey(url) {
  if (!url?.startsWith(CDN_PREFIX)) return null;
  return url.slice(CDN_PREFIX.length);
}

/** Add all R2 keys referenced by a URL array to the set. */
function collectKeysFromUrls(urls, referencedKeys) {
  const urlArray = Array.isArray(urls) ? urls : [];
  for (const url of urlArray) {
    const key = extractKey(url);
    if (key) referencedKeys.add(key);
  }
}

/** Collect referenced keys from user photo fields. */
async function collectUserKeys(referencedKeys) {
  const usersSnap = await db
    .collection('users')
    .select(
      'profilePhotoUrl',
      'profile_photo_url',
      'coverPhotoUrl',
      'cover_photo_url',
      'preSuspensionProfilePhotoUrl',
      'pre_suspension_profile_photo_url',
      'preSuspensionCoverPhotoUrl',
      'pre_suspension_cover_photo_url',
    )
    .limit(2000)
    .get();
  for (const doc of usersSnap.docs) {
    const d = doc.data();
    for (const url of [
      d.profilePhotoUrl || d.profile_photo_url,
      d.coverPhotoUrl || d.cover_photo_url,
      d.preSuspensionProfilePhotoUrl || d.pre_suspension_profile_photo_url,
      d.preSuspensionCoverPhotoUrl || d.pre_suspension_cover_photo_url,
    ]) {
      const key = extractKey(url);
      if (key) referencedKeys.add(key);
    }
  }
}

/** Collect referenced keys from conversation messages (images + stickers). */
async function collectConversationMessageKeys(convsSnap, referencedKeys) {
  const convsToScan = convsSnap.docs.slice(0, 30);
  for (const convDoc of convsToScan) {
    const convId = convDoc.id;

    const imageMessagesSnap = await db
      .collection(`conversations/${convId}/messages`)
      .where('type', '==', 'IMAGE')
      .limit(200)
      .get();
    for (const msgDoc of imageMessagesSnap.docs) {
      const msg = msgDoc.data();
      collectKeysFromUrls(msg.imageUrls || msg.image_urls || [], referencedKeys);
    }

    const stickerMessagesSnap = await db
      .collection(`conversations/${convId}/messages`)
      .where('type', '==', 'STICKER')
      .limit(200)
      .get();
    for (const msgDoc of stickerMessagesSnap.docs) {
      const msg = msgDoc.data();
      const storageKey = extractKey(msg.stickerUrl || msg.sticker_url);
      if (storageKey) referencedKeys.add(storageKey);
    }
  }
}

/** Collect referenced keys from reports/archive evidence URLs. */
async function collectReportKeys(referencedKeys) {
  for (const collection of ['reports', 'reportsArchive']) {
    const snap = await db
      .collection(collection)
      .select('evidenceUrls', 'evidence_urls')
      .limit(1000)
      .get();
    for (const doc of snap.docs) {
      const row = doc.data();
      collectKeysFromUrls(row.evidenceUrls || row.evidence_urls || [], referencedKeys);
    }
  }
}

async function orphanedStorage() {
  const referencedKeys = new Set();
  referencedKeys.add('system/shytalk_icon.webp');

  await collectUserKeys(referencedKeys);

  // Conversations -> groupPhotoUrl
  const convsSnap = await db
    .collection('conversations')
    .select('groupPhotoUrl', 'group_photo_url')
    .limit(2000)
    .get();
  for (const doc of convsSnap.docs) {
    const convData = doc.data();
    const key = extractKey(convData.groupPhotoUrl || convData.group_photo_url);
    if (key) referencedKeys.add(key);
  }

  await collectConversationMessageKeys(convsSnap, referencedKeys);
  await collectReportKeys(referencedKeys);

  // Banners -> imageUrl
  const bannersSnap = await db
    .collection('banners')
    .select('imageUrl', 'image_url')
    .limit(500)
    .get();
  for (const doc of bannersSnap.docs) {
    const bannerData = doc.data();
    const bannerKey = extractKey(bannerData.imageUrl || bannerData.image_url);
    if (bannerKey) referencedKeys.add(bannerKey);
  }

  // List and delete orphaned R2 objects
  const folders = [
    'profiles/',
    'covers/',
    'messages/',
    'groups/',
    'evidence/',
    'stickers/',
    'banners/',
    'starting-screens/',
  ];
  let totalDeleted = 0;

  for (const folder of folders) {
    try {
      const allKeys = await r2.listObjects(folder);
      const toDelete = allKeys.filter((objKey) => !referencedKeys.has(objKey));
      if (toDelete.length > 0) await r2.deleteObjects(toDelete);

      const folderName = folder.replace('/', '');
      log.info('cron', 'orphanedStorage: folder cleanup', {
        folder: folderName,
        deleted: toDelete.length,
        total: allKeys.length,
      });
      totalDeleted += toDelete.length;
    } catch (err) {
      log.error('cron', 'orphanedStorage: folder cleanup failed', { folder, error: err.message });
    }
  }

  log.info('cron', 'orphanedStorage: cleanup complete', { totalDeleted });
}

module.exports = orphanedStorage;

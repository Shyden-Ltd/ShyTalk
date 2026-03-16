/**
 * Cron: Full orphaned storage cleanup.
 *
 * Collects all referenced R2 keys from users, conversations, reports, banners.
 * Lists R2 objects per folder, deletes orphans.
 */

const { db } = require('../utils/firebase');
const r2 = require('../utils/r2');
const log = require('../utils/log');

const CDN_PREFIX = 'https://images.shytalk.shyden.co.uk/';

function extractKey(url) {
  if (!url || !url.startsWith(CDN_PREFIX)) return null;
  return url.slice(CDN_PREFIX.length);
}

async function orphanedStorage() {
  const referencedKeys = new Set();
  referencedKeys.add('system/shytalk_icon.webp');

  // Users -> profilePhotoUrl, coverPhotoUrl, preSuspension*
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
    const userData = doc.data();
    for (const url of [
      userData.profilePhotoUrl || userData.profile_photo_url,
      userData.coverPhotoUrl || userData.cover_photo_url,
      userData.preSuspensionProfilePhotoUrl || userData.pre_suspension_profile_photo_url,
      userData.preSuspensionCoverPhotoUrl || userData.pre_suspension_cover_photo_url,
    ]) {
      const key = extractKey(url);
      if (key) referencedKeys.add(key);
    }
  }

  // Conversations -> groupPhotoUrl (select only needed fields to save bandwidth)
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

  // Conversation messages -> imageUrls (array), stickerUrl
  // Cap at 30 conversations
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
      const urls = msg.imageUrls || msg.image_urls || [];
      const urlArray = Array.isArray(urls) ? urls : [];
      for (const url of urlArray) {
        const storageKey = extractKey(url);
        if (storageKey) referencedKeys.add(storageKey);
      }
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

  // Reports + archive -> evidenceUrls (array)
  for (const collection of ['reports', 'reportsArchive']) {
    const snap = await db
      .collection(collection)
      .select('evidenceUrls', 'evidence_urls')
      .limit(1000)
      .get();
    for (const doc of snap.docs) {
      const row = doc.data();
      const urls = row.evidenceUrls || row.evidence_urls || [];
      const urlArray = Array.isArray(urls) ? urls : [];
      for (const url of urlArray) {
        const evidenceKey = extractKey(url);
        if (evidenceKey) referencedKeys.add(evidenceKey);
      }
    }
  }

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
  // Must match ALLOWED_UPLOAD_PATHS in storage.js
  const folders = [
    'profiles/',
    'covers/',
    'messages/',
    'groups/',
    'evidence/',
    'stickers/',
    'banners/',
  ];
  let totalDeleted = 0;

  for (const folder of folders) {
    try {
      const allKeys = await r2.listObjects(folder);
      const toDelete = allKeys.filter((objKey) => !referencedKeys.has(objKey));

      if (toDelete.length > 0) {
        await r2.deleteObjects(toDelete);
      }

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

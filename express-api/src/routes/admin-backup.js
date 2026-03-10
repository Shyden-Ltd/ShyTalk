/**
 * Admin backup routes — R2-based full database backups.
 *
 * GET  /api/admin/backups                   → List available backups (with manifest data)
 * POST /api/admin/backups/trigger           → Trigger immediate full backup
 * GET  /api/admin/backups/:date/:collection → Download a specific collection's backup
 * GET  /api/admin/backups/:date             → Download legacy users backup by date
 * POST /api/admin/backups/restore/:date     → Restore from backup (full/collection/missing-only)
 * POST /api/admin/backups/recover-photos    → Scan R2 and restore missing photo URLs
 */

const router = require('express').Router();
const { db } = require('../utils/firebase');
const { requireAdmin } = require('../middleware/auth');
const r2 = require('../utils/r2');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const backupFn = require('../cron/backups');
const log = require('../utils/log');

// ─── S3 client for listing with metadata (size, lastModified) ────

const accountId = process.env.R2_ACCOUNT_ID;
const bucketName = process.env.R2_BUCKET_NAME || 'shytalk-media';

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * List R2 objects under a prefix with full metadata (size, lastModified).
 */
async function listObjectsWithMeta(prefix) {
  const objects = [];
  let continuationToken;

  do {
    const resp = await s3.send(new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
      MaxKeys: 1000,
      ContinuationToken: continuationToken,
    }));
    for (const obj of (resp.Contents || [])) {
      objects.push({ key: obj.Key, size: obj.Size, lastModified: obj.LastModified });
    }
    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

/**
 * Read and parse a JSON file from R2.
 * Returns the parsed object, or throws if not found.
 */
async function readR2Json(key) {
  let obj;
  try {
    obj = await r2.getObject(key);
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw err;
  }

  const chunks = [];
  for await (const chunk of obj.Body) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

// All collections that can be restored (matches backups.js)
const RESTORABLE_COLLECTIONS = backupFn.TOP_LEVEL_COLLECTIONS;

// ── List available backups (full backup dates with manifests) ──
router.get('/admin/backups', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    // List all manifest files under backups/full/
    const objects = await listObjectsWithMeta('backups/full/');
    const dateMap = {};

    for (const obj of objects) {
      // Extract date from key: backups/full/YYYY-MM-DD/filename.json
      const parts = obj.key.replace('backups/full/', '').split('/');
      const date = parts[0];
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

      if (!dateMap[date]) {
        dateMap[date] = { date, files: [], totalSize: 0, manifest: null };
      }
      dateMap[date].files.push(obj.key);
      dateMap[date].totalSize += obj.size || 0;
    }

    // Try to load manifest for each date
    const backups = [];
    for (const date of Object.keys(dateMap).sort().reverse()) {
      const entry = dateMap[date];
      try {
        const manifest = await readR2Json(`backups/full/${date}/manifest.json`);
        if (manifest) {
          entry.manifest = manifest;
        }
      } catch {
        // Manifest might not exist for older backups
      }
      backups.push(entry);
    }

    res.json({ backups });
  } catch (err) {
    log.error('admin-backup', 'Error listing backups', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Trigger immediate full backup ──
router.post('/admin/backups/trigger', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const result = await backupFn();
    res.json({
      message: 'Full backup completed',
      date: result.date,
      manifest: result.manifest,
    });
  } catch (err) {
    log.error('admin-backup', 'Error triggering backup', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Download a specific collection's backup ──
const BACKUP_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
// Derived from backups.js TOP_LEVEL_COLLECTIONS + subcollection backup names
const { TOP_LEVEL_COLLECTIONS, SUBCOLLECTIONS } = require('../cron/backups');
const ALLOWED_BACKUP_COLLECTIONS = new Set([
  ...TOP_LEVEL_COLLECTIONS,
  ...SUBCOLLECTIONS.map(([parent, sub]) => `${parent}_${sub}`),
]);

router.get('/admin/backups/:date/:collection', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const { date, collection } = req.params;
    if (!BACKUP_DATE_REGEX.test(date)) {
      log.warn('admin-backup', 'Invalid date format in backup download', { date, uid: req.auth?.uid });
      return res.status(400).json({ error: 'Invalid date format (expected YYYY-MM-DD)' });
    }
    if (!ALLOWED_BACKUP_COLLECTIONS.has(collection)) {
      log.warn('admin-backup', 'Invalid collection name in backup download', { collection, uid: req.auth?.uid });
      return res.status(400).json({ error: 'Invalid collection name' });
    }
    const key = `backups/full/${date}/${collection}.json`;

    let obj;
    try {
      obj = await r2.getObject(key);
    } catch (err) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        return res.status(404).json({ error: `No backup found for ${collection} on ${date}` });
      }
      throw err;
    }

    res.set('Content-Type', 'application/json');
    obj.Body.pipe(res);
  } catch (err) {
    log.error('admin-backup', 'Error downloading collection backup', { date: req.params.date, collection: req.params.collection, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Download legacy users backup (backwards compat) ──
router.get('/admin/backups/:date', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    if (!BACKUP_DATE_REGEX.test(req.params.date)) {
      log.warn('admin-backup', 'Invalid date format in legacy backup download', { date: req.params.date, uid: req.auth?.uid });
      return res.status(400).json({ error: 'Invalid date format (expected YYYY-MM-DD)' });
    }
    const key = `backups/users/${req.params.date}.json`;
    let obj;
    try {
      obj = await r2.getObject(key);
    } catch (err) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        return res.status(404).json({ error: `No backup found for ${req.params.date}` });
      }
      throw err;
    }

    res.set('Content-Type', 'application/json');
    obj.Body.pipe(res);
  } catch (err) {
    log.error('admin-backup', 'Error downloading legacy backup', { date: req.params.date, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Restore from a backup ──
router.post('/admin/backups/restore/:date', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }
    const { mode = 'missing-only', collection } = req.body;

    if (!['full', 'collection', 'missing-only'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode. Use: full, collection, or missing-only' });
    }

    if (mode === 'collection' && !collection) {
      return res.status(400).json({ error: 'collection is required when mode is "collection"' });
    }

    // Auto-create a fresh backup before any restore
    log.info('admin-backup', 'Creating pre-restore backup', { date: req.params.date, mode: req.body.mode || 'missing-only' });
    await backupFn();

    // Determine which collections to restore
    const collectionsToRestore = mode === 'collection'
      ? [collection]
      : [...RESTORABLE_COLLECTIONS];

    const results = {};

    for (const collName of collectionsToRestore) {
      const key = `backups/full/${date}/${collName}.json`;
      const backupDocs = await readR2Json(key);

      if (backupDocs === null) {
        results[collName] = { status: 'skipped', reason: 'no backup file found' };
        continue;
      }

      let restoredCount = 0;

      if (mode === 'full' || mode === 'collection') {
        // Full restore: delete existing docs in batches of 500, then write from backup
        const existingSnap = await db.collection(collName).get();
        const refs = existingSnap.docs.map(d => d.ref);
        for (let i = 0; i < refs.length; i += 500) {
          const batch = db.batch();
          refs.slice(i, i + 500).forEach(ref => batch.delete(ref));
          await batch.commit();
        }

        // Write backup docs
        for (const backupDoc of backupDocs) {
          const { id, ...data } = backupDoc;
          if (!id) continue;
          await db.collection(collName).doc(id).set(data);
          restoredCount++;
        }
      } else {
        // missing-only: only restore docs that don't exist currently
        for (const backupDoc of backupDocs) {
          const { id, ...data } = backupDoc;
          if (!id) continue;
          const existing = await db.collection(collName).doc(id).get();
          if (!existing.exists) {
            await db.collection(collName).doc(id).set(data);
            restoredCount++;
          }
        }
      }

      results[collName] = {
        status: 'restored',
        restoredCount,
        totalInBackup: backupDocs.length,
      };
    }

    res.json({
      message: `Restore completed (mode: ${mode})`,
      mode,
      date,
      results,
    });
  } catch (err) {
    log.error('admin-backup', 'Error restoring from backup', { date: req.params.date, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Recover profile/cover photos from R2 ──
router.post('/admin/backups/recover-photos', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const CDN_URL = r2.CDN_URL;
    let recovered = 0;

    // Scan R2 for profile photos and cover photos
    for (const folder of ['profiles/', 'covers/']) {
      const field = folder === 'profiles/' ? 'profilePhotoUrl' : 'coverPhotoUrl';
      const userPhotos = {}; // uid -> latest key

      const objects = await listObjectsWithMeta(folder);
      for (const obj of objects) {
        // Keys are like: profiles/{uid}/{filename} or covers/{uid}/{filename}
        const parts = obj.key.split('/');
        if (parts.length >= 3) {
          const uid = parts[1];
          // Keep the most recently uploaded photo per user
          if (!userPhotos[uid] || (obj.lastModified && obj.lastModified > userPhotos[uid].lastModified)) {
            userPhotos[uid] = { key: obj.key, lastModified: obj.lastModified };
          }
        }
      }

      // For each user with an R2 photo, check if their Firestore doc is missing the URL
      for (const [uid, photo] of Object.entries(userPhotos)) {
        const snap = await db.doc(`users/${uid}`).get();
        if (!snap.exists) continue;
        const user = snap.data();

        const currentUrl = user[field];
        if (!currentUrl) {
          const photoUrl = `${CDN_URL}/${photo.key}`;
          await db.doc(`users/${uid}`).update({ [field]: photoUrl });
          recovered++;
        }
      }
    }

    res.json({ message: `Recovered ${recovered} photo URLs from R2`, recovered });
  } catch (err) {
    log.error('admin-backup', 'Error recovering photos from R2', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

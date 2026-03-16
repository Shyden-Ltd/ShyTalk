/**
 * Storage routes — upload and delete files via R2.
 *
 * Converted from the standalone Cloudflare Worker storage proxy (worker/index.js)
 * into an Express route with multer for multipart file uploads.
 *
 * POST   /api/storage/upload  → Upload a file to R2, return public URL
 * DELETE /api/storage/delete  → Delete a file from R2 (owner-only)
 */

const express = require('express');
const multer = require('multer');
const r2 = require('../utils/r2');
const { getExtension } = require('../utils/helpers');
const log = require('../utils/log');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const ALLOWED_UPLOAD_PATHS = [
  'profiles',
  'covers',
  'messages',
  'groups',
  'evidence',
  'stickers',
  'banners',
];

// POST /api/storage/upload
router.post('/storage/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const path = req.body.path;
    const uniqueId = req.auth.uniqueId;

    if (!file || !path) {
      log.warn('storage', 'Upload missing params', { uniqueId, hasFile: !!file, hasPath: !!path });
      return res.status(400).json({ error: 'Missing file or path' });
    }

    if (!ALLOWED_UPLOAD_PATHS.includes(path)) {
      log.warn('storage', 'Upload to disallowed path', { uniqueId, path });
      return res.status(400).json({ error: 'Invalid upload path' });
    }

    const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const contentType = file.mimetype || 'image/jpeg';
    if (!ALLOWED_MIME_TYPES.includes(contentType)) {
      log.warn('storage', 'Upload rejected: disallowed MIME type', { uniqueId, contentType });
      return res
        .status(400)
        .json({ error: 'Only image uploads are allowed (jpeg, png, webp, gif)' });
    }
    const extension = getExtension(contentType);
    const key = `${path}/${uniqueId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;

    const url = await r2.putObject(key, file.buffer, contentType);
    log.info('storage', 'File uploaded', { key, uniqueId, contentType });
    res.json({ url });
  } catch (err) {
    log.error('storage', 'Upload failed', { uniqueId: req.auth?.uniqueId, error: err.message });
    res.status(500).json({ error: 'Upload failed' });
  }
});

// DELETE /api/storage/delete
router.delete('/storage/delete', async (req, res) => {
  try {
    const key = req.query.key;
    const uniqueId = req.auth.uniqueId;

    if (!key) {
      log.warn('storage', 'Delete missing key', { uniqueId });
      return res.status(400).json({ error: 'Missing key' });
    }
    // Verify the key belongs to this user: format is "{path}/{uniqueId}/{filename}"
    const keyParts = key.split('/');
    if (keyParts.length < 3 || keyParts[1] !== String(uniqueId)) {
      log.warn('storage', 'Delete forbidden — key does not belong to user', { uniqueId, key });
      return res.status(403).json({ error: 'Forbidden' });
    }

    await r2.deleteObject(key);
    log.info('storage', 'File deleted', { key, uniqueId });
    res.json({ ok: true });
  } catch (err) {
    log.error('storage', 'Delete failed', {
      uniqueId: req.auth?.uniqueId,
      key: req.query.key,
      error: err.message,
    });
    res.status(500).json({ error: 'Delete failed' });
  }
});

module.exports = router;

/**
 * Storage routes — upload and delete files via R2.
 *
 * Converted from the standalone Cloudflare Worker storage proxy (worker/index.js)
 * into an Express route with multer for multipart file uploads.
 *
 * POST   /api/storage/upload  → Upload a file to R2, return public URL
 * DELETE /api/storage/delete  → Delete a file from R2 (owner-only)
 */

const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const r2 = require('../utils/r2');
const { getExtension } = require('../utils/helpers');
const log = require('../utils/log');
const { compressImage, ImagePolicyError } = require('../utils/imageCompressor');

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
  'starting-screens',
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

    const ALLOWED_MIME_TYPES = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/heic',
      'image/heif',
    ];
    const contentType = file.mimetype || 'image/jpeg';
    if (!ALLOWED_MIME_TYPES.includes(contentType)) {
      log.warn('storage', 'Upload rejected: disallowed MIME type', { uniqueId, contentType });
      return res
        .status(400)
        .json({ error: 'Only image uploads are allowed (jpeg, png, webp, gif, heic, heif)' });
    }
    let uploadBuffer = file.buffer;
    let uploadMime = contentType;
    let originalSize = file.buffer.length;
    let compressedSize = file.buffer.length;

    try {
      const compressed = await compressImage(file.buffer, contentType);
      uploadBuffer = compressed.buffer;
      uploadMime = compressed.mimeType;
      originalSize = compressed.originalSize;
      compressedSize = compressed.compressedSize;
    } catch (compressionErr) {
      // Policy violations (oversized image, SVG, empty buffer) MUST be
      // surfaced as a 4xx — silently uploading the original would defeat
      // the dimension/MIME checks that exist for safety reasons.
      if (compressionErr instanceof ImagePolicyError) {
        log.warn('storage', 'Upload rejected: image policy violation', {
          uniqueId,
          contentType,
          error: compressionErr.message,
        });
        return res.status(400).json({ error: compressionErr.message });
      }
      // Compression-engine failures (sharp internal error, codec issue,
      // timeout) — store original, log warning, succeed. The caller asked
      // to upload an image; compression is a best-effort optimisation.
      log.warn('storage', 'Compression engine failed, storing original', {
        uniqueId,
        contentType,
        error: compressionErr.message,
      });
    }

    // Compute extension and key AFTER compression (HEIC→JPEG changes MIME)
    const extension = getExtension(uploadMime);
    const key = `${path}/${uniqueId}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${extension}`;

    const url = await r2.putObject(key, uploadBuffer, uploadMime);
    log.info('storage', 'File uploaded', { key, uniqueId, contentType: uploadMime });
    res.json({ url, originalSize, compressedSize });
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
    res.json({ success: true });
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

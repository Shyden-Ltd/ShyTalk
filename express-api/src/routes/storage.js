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
// Required as a MODULE, not destructured: the route has to call whatever
// `scanAttachment` is at call time, which is also what lets a test replace it.
const attachmentScan = require('../utils/attachment-scan');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const ALLOWED_UPLOAD_PATHS = [
  'profiles',
  'covers',
  'messages',
  'groups',
  'evidence',
  // What `submitUserReport` actually sends. Its absence meant every user report
  // WITH a screenshot was refused here, and the client abandons the whole report
  // when evidence fails -- so somebody reporting harassment with a picture of it
  // filed nothing at all. Every test of that flow mocked StorageRepository and
  // asserted the path STRING against a fake that always succeeded, so the two
  // halves disagreed and nothing went red. The admin cleanup tools have swept a
  // `report_evidence/` folder the whole time.
  'report_evidence',
  'stickers',
  'banners',
  'starting-screens',
];

// Multer must never be mounted as BARE middleware here. Mounted bare, a
// LIMIT_FILE_SIZE (or any other multer error) propagates to Express's default
// error handler, which answers 500 with an HTML body — so an API client asking
// for JSON gets an HTML 500 for the entirely expected "your file is too big".
// `banners.js` already wrapped multer this way; storage.js did not (SHY-0368).
const handleUpload = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large (max 10 MB)' });
      }
      return res.status(400).json({ error: err.message });
    }
    next();
  });
};

// POST /api/storage/upload
router.post('/storage/upload', handleUpload, async (req, res) => {
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

    // SHY-0420. Every file on this route was uploaded by somebody we do not
    // know, and a member of staff opens all of them -- report evidence, profile
    // photos, room covers alike. Scanned AFTER the store, because the scanner
    // takes a key; a file that does not pass is removed rather than left
    // behind, since storing it and merely withholding its URL leaves an object
    // reachable by anybody who later obtains the key.
    //
    // While no engine is configured this answers `scanned:false, clean:true`
    // and changes nothing -- stated loudly at startup rather than pretended
    // otherwise.
    const scan = await attachmentScan.scanAttachment(key);
    if (!scan.clean) {
      log.warn('storage', 'Upload refused by the scanner', { key, uniqueId, reason: scan.reason });
      try {
        await r2.deleteObject(key);
      } catch (deleteErr) {
        // Logged, not surfaced: the caller is being refused either way, and a
        // failure to tidy up must not read to them as a failure to refuse.
        log.error('storage', 'Could not delete a refused upload', {
          key,
          error: deleteErr.message,
        });
      }
      return res.status(400).json({
        error: 'That file could not be accepted.',
      });
    }

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

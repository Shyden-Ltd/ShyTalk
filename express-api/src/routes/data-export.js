/**
 * Data export routes — GDPR Article 20 data portability.
 *
 * POST /api/users/:uniqueId/data-export          → Request export (owner, rate-limited)
 * GET  /api/users/:uniqueId/data-export/status    → Poll export status (owner)
 * GET  /api/users/:uniqueId/data-export/download  → Download ZIP (HMAC token)
 */

const node_crypto = require('node:crypto');
const router = require('express').Router();
const { db } = require('../utils/firebase');
const { generateId, now } = require('../utils/helpers');
const log = require('../utils/log');
const buildDataExport = require('../utils/data-export-builder');
const r2 = require('../utils/r2');
const { sendEmail } = require('../utils/email');
const { buildDataExportReadyEmail } = require('../utils/email-templates');

const RATE_LIMIT_MS = 24 * 60 * 60 * 1000; // 24 hours
const EXPORT_EXPIRY_MS = 48 * 60 * 60 * 1000; // 48 hours
if (!process.env.EXPORT_DOWNLOAD_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('EXPORT_DOWNLOAD_SECRET is required in production');
}
const EXPORT_DOWNLOAD_SECRET = process.env.EXPORT_DOWNLOAD_SECRET || 'dev-export-secret';

// ─── Helper: ownership check ────────────────────────────────────

function requireOwner(req, res) {
  const paramId = Number(req.params.uniqueId);
  if (req.auth.uniqueId !== paramId) {
    res.status(403).json({ error: "Cannot access another user's data" });
    return true;
  }
  return false;
}

function generateDownloadToken(uniqueId, expiresAt) {
  const data = `${uniqueId}:${expiresAt}`;
  return node_crypto.createHmac('sha256', EXPORT_DOWNLOAD_SECRET).update(data).digest('hex');
}

function verifyDownloadToken(uniqueId, expiresAt, token) {
  const expected = generateDownloadToken(uniqueId, expiresAt);
  return node_crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'));
}

// ═══════════════════════════════════════════════════════════════
// POST /api/users/:uniqueId/data-export — Request export
// ═══════════════════════════════════════════════════════════════

router.post('/users/:uniqueId/data-export', async (req, res) => {
  try {
    if (requireOwner(req, res)) return;

    const uniqueId = req.params.uniqueId;

    const userSnap = await db.doc(`users/${uniqueId}`).get();
    if (!userSnap.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = userSnap.data();

    // Rate limit: 24 hours
    if (user.lastDataExportRequestedAt) {
      const elapsed = now() - user.lastDataExportRequestedAt;
      if (elapsed < RATE_LIMIT_MS) {
        return res.status(429).json({ error: 'Please wait 24 hours between export requests' });
      }
    }

    const timestamp = now();

    // Update user doc
    await db.doc(`users/${uniqueId}`).update({
      lastDataExportRequestedAt: timestamp,
      dataExportStatus: 'pending',
    });

    // Fire-and-forget async export
    (async () => {
      try {
        const result = await buildDataExport(uniqueId);
        const r2Key = `exports/${uniqueId}/${generateId()}.zip`;

        // Upload to R2 with private cache headers
        await r2.putObject(
          r2Key,
          result.buffer,
          'application/zip',
          { expiresAt: String(timestamp + EXPORT_EXPIRY_MS) },
          { cacheControl: 'private, no-cache, no-store' },
        );

        const expiresAt = timestamp + EXPORT_EXPIRY_MS;
        const downloadToken = generateDownloadToken(uniqueId, expiresAt);
        const apiBase =
          process.env.API_BASE_URL ||
          (process.env.NODE_ENV === 'production'
            ? 'https://api.shytalk.shyden.co.uk'
            : 'https://dev-api.shytalk.shyden.co.uk');
        const downloadUrl = `${apiBase}/api/users/${uniqueId}/data-export/download?token=${downloadToken}&expiresAt=${expiresAt}`;

        await db.doc(`users/${uniqueId}`).update({
          dataExportStatus: 'ready',
          dataExportR2Key: r2Key,
          dataExportExpiresAt: expiresAt,
        });

        // Send email with download link
        if (user.email) {
          try {
            const template = buildDataExportReadyEmail(
              downloadUrl,
              new Date(expiresAt).toISOString(),
            );
            await sendEmail(user.email, template.subject, template.html);
          } catch (emailErr) {
            log.error('data-export', 'Failed to send export email', {
              error: emailErr.message,
            });
          }
        }

        log.info('data-export', 'Export ready', { uniqueId, r2Key });
      } catch (err) {
        log.error('data-export', 'Export build failed', {
          uniqueId,
          error: err.message,
        });
        // Don't swallow the status update failure silently — if this fails,
        // the user's `dataExportStatus` stays at `building` forever, the
        // polling endpoint reports "in progress", and the user sits waiting
        // for an export that will never complete. This is a GDPR
        // data-export endpoint — silent stuck-in-progress states are a
        // compliance issue.
        await db
          .doc(`users/${uniqueId}`)
          .update({ dataExportStatus: 'failed' })
          .catch((statusErr) => {
            log.error(
              'data-export',
              'Failed to mark dataExportStatus=failed — user may be stuck in building state',
              {
                uniqueId,
                error: statusErr.message,
              },
            );
          });
      }
    })();

    res.status(202).json({ requestedAt: timestamp });
  } catch (err) {
    log.error('data-export', 'Failed to request export', {
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/users/:uniqueId/data-export/status — Poll status
// ═══════════════════════════════════════════════════════════════

router.get('/users/:uniqueId/data-export/status', async (req, res) => {
  try {
    if (requireOwner(req, res)) return;

    const uniqueId = req.params.uniqueId;

    const userSnap = await db.doc(`users/${uniqueId}`).get();
    if (!userSnap.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = userSnap.data();

    const status = user.dataExportStatus || 'none';
    res.json({
      status,
      requestedAt: user.lastDataExportRequestedAt || null,
      readyAt: status === 'ready' ? user.lastDataExportRequestedAt : null,
      expiresAt: user.dataExportExpiresAt || null,
    });
  } catch (err) {
    log.error('data-export', 'Failed to get export status', {
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/users/:uniqueId/data-export/download — Download ZIP
// ═══════════════════════════════════════════════════════════════

router.get('/users/:uniqueId/data-export/download', async (req, res) => {
  try {
    const { token, expiresAt } = req.query;
    const uniqueId = req.params.uniqueId;

    if (!token || !expiresAt) {
      return res.status(401).json({ error: 'Missing token or expiresAt' });
    }

    // Check expiry
    const expiry = Number(expiresAt);
    if (expiry <= Date.now()) {
      return res.status(410).json({ error: 'Download link has expired' });
    }

    // Verify HMAC
    try {
      if (!verifyDownloadToken(uniqueId, expiresAt, token)) {
        return res.status(401).json({ error: 'Invalid token' });
      }
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Get R2 key from user doc
    const userSnap = await db.doc(`users/${uniqueId}`).get();
    if (!userSnap.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = userSnap.data();

    if (!user.dataExportR2Key) {
      return res.status(404).json({ error: 'No export available' });
    }

    // Stream from R2
    const r2Obj = await r2.getObject(user.dataExportR2Key);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="shytalk-data-export-${uniqueId}.zip"`,
    );
    r2Obj.Body.pipe(res);
  } catch (err) {
    log.error('data-export', 'Failed to download export', {
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

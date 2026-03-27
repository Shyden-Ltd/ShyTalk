/**
 * Banner carousel routes — CRUD + active banners + image upload.
 *
 * GET    /api/banners/active           → Active banners (any authenticated user)
 * GET    /api/admin/banners            → All banners (admin)
 * POST   /api/admin/banners            → Create banner (admin)
 * PUT    /api/admin/banners/reorder    → Batch reorder (admin)
 * PUT    /api/admin/banners/:id        → Update banner (admin)
 * DELETE /api/admin/banners/:id        → Delete banner + R2 image (admin)
 * POST   /api/admin/banners/upload     → Upload image to R2 (admin)
 */

const router = require('express').Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const { db } = require('../utils/firebase');
const { generateId, now } = require('../utils/helpers');
const { requireAdmin } = require('../middleware/auth');
const { putObject, deleteObject, CDN_URL } = require('../utils/r2');
const { getDoc, queryDocs } = require('../utils/firestore-helpers');
const log = require('../utils/log');

// ── Active banners (any authenticated user) ──
router.get('/banners/active', async (req, res) => {
  try {
    const timestamp = now();

    // Query active banners, then client-filter by date range
    const results = await queryDocs(
      db.collection('banners').where('isActive', '==', true).orderBy('sortOrder', 'asc'),
    );

    // Filter by start/end date
    const active = results.filter((b) => {
      if (b.startDate && b.startDate > timestamp) return false;
      if (b.endDate && b.endDate <= timestamp) return false;
      return true;
    });

    res.set('Cache-Control', 'public, max-age=300');
    res.json(active);
  } catch (err) {
    log.error('banners', 'Failed to fetch active banners', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── All banners (admin) ──
router.get('/admin/banners', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const results = await queryDocs(db.collection('banners'));
    results.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    res.json(results);
  } catch (err) {
    log.error('banners', 'Failed to fetch all banners', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Create banner (admin) ──
router.post('/admin/banners', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body) return res.status(400).json({ error: 'Invalid JSON body' });
    if (!body.image_url && !body.imageUrl)
      return res.status(400).json({ error: 'imageUrl is required' });

    const id = generateId();
    const timestamp = now();

    // Get next sort_order by querying existing banners
    const allBanners = await queryDocs(
      db.collection('banners').orderBy('sortOrder', 'desc').limit(1),
    );
    const sortOrder = allBanners.length > 0 ? (allBanners[0].sortOrder || 0) + 1 : 0;

    await db.doc(`banners/${id}`).set(
      {
        id,
        title: body.title || null,
        imageUrl: body.imageUrl || body.image_url,
        actionType: body.actionType || body.action_type || 'NONE',
        actionValue: body.actionValue || body.action_value || null,
        startDate: body.startDate ?? body.start_date ?? null,
        endDate: body.endDate ?? body.end_date ?? null,
        sortOrder,
        isActive: body.isActive !== undefined ? !!body.isActive : body.is_active !== false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      { merge: true },
    );

    res.json({ success: true, id });
  } catch (err) {
    log.error('banners', 'Failed to create banner', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Batch reorder (admin) — must be before /:id route ──
router.put('/admin/banners/reorder', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!Array.isArray(body))
      return res.status(400).json({ error: 'Expected array of {id, sort_order}' });

    const timestamp = now();

    // Batch write in chunks of 500
    for (let i = 0; i < body.length; i += 500) {
      const chunk = body.slice(i, i + 500);
      const batch = db.batch();
      for (const item of chunk) {
        batch.set(
          db.doc(`banners/${item.id}`),
          {
            sortOrder: item.sort_order ?? item.sortOrder,
            updatedAt: timestamp,
          },
          { merge: true },
        );
      }
      await batch.commit();
    }

    res.json({ success: true });
  } catch (err) {
    log.error('banners', 'Failed to reorder banners', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Update banner (admin) ──
router.put('/admin/banners/:id', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body) return res.status(400).json({ error: 'Invalid JSON body' });

    const existing = await getDoc(`banners/${req.params.id}`);
    if (!existing) return res.status(404).json({ error: 'Banner not found' });

    const fields = {};
    if (body.title !== undefined) fields.title = body.title || null;
    if (body.imageUrl !== undefined || body.image_url !== undefined) {
      fields.imageUrl = body.imageUrl ?? body.image_url;
    }
    if (body.actionType !== undefined || body.action_type !== undefined) {
      fields.actionType = body.actionType ?? body.action_type;
    }
    if (body.actionValue !== undefined || body.action_value !== undefined) {
      fields.actionValue = (body.actionValue ?? body.action_value) || null;
    }
    if (body.startDate !== undefined || body.start_date !== undefined) {
      fields.startDate = body.startDate ?? body.start_date;
    }
    if (body.endDate !== undefined || body.end_date !== undefined) {
      fields.endDate = body.endDate ?? body.end_date;
    }
    if (body.isActive !== undefined || body.is_active !== undefined) {
      fields.isActive = !!(body.isActive ?? body.is_active);
    }

    if (Object.keys(fields).length === 0)
      return res.status(400).json({ error: 'No fields to update' });

    fields.updatedAt = now();
    await db.doc(`banners/${req.params.id}`).update(fields);

    res.json({ success: true });
  } catch (err) {
    log.error('banners', 'Failed to update banner', {
      bannerId: req.params.id,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete banner (admin) ──
router.delete('/admin/banners/:id', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const banner = await getDoc(`banners/${req.params.id}`);
    if (!banner) return res.status(404).json({ error: 'Banner not found' });

    // Delete R2 object if it's our CDN URL
    const CDN_PREFIX = CDN_URL + '/';
    if (banner.imageUrl && banner.imageUrl.startsWith(CDN_PREFIX)) {
      const key = banner.imageUrl.slice(CDN_PREFIX.length);
      await deleteObject(key);
    }

    await db.doc(`banners/${req.params.id}`).delete();

    res.json({ success: true });
  } catch (err) {
    log.error('banners', 'Failed to delete banner', {
      bannerId: req.params.id,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Upload banner image to R2 (admin) ──
router.post('/admin/banners/upload', upload.single('file'), async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const mimeToExt = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };
    const ext = mimeToExt[file.mimetype] || 'jpg';
    const key = `banners/${generateId()}_${Date.now()}.${ext}`;

    await putObject(key, file.buffer, file.mimetype);

    const imageUrl = `${CDN_URL}/${key}`;
    res.json({ success: true, image_url: imageUrl, imageUrl, key });
  } catch (err) {
    log.error('banners', 'Failed to upload banner image', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

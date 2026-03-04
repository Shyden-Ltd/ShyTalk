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

const { json, jsonError, generateId, now } = require('../utils');
const { requireAdmin } = require('../middleware/auth');
const { getDoc, setDoc, updateDoc, deleteDoc, queryCollection, batchWrite, batchUpdateOp, fieldFilter, andFilter, orderBy } = require('../utils/firestore');

function registerBannerRoutes(router) {
  // ── Active banners (any authenticated user) ──
  router.get('/api/banners/active', async (request, env) => {
    const timestamp = now();

    // Query active banners, then client-filter by date range
    const results = await queryCollection(env, 'banners', {
      where: fieldFilter('isActive', 'EQUAL', true),
      orderBy: [orderBy('sortOrder')],
    });

    // Filter by start/end date
    const active = results.filter(b => {
      if (b.startDate && b.startDate > timestamp) return false;
      if (b.endDate && b.endDate <= timestamp) return false;
      return true;
    });

    return json(active);
  });

  // ── All banners (admin) ──
  router.get('/api/admin/banners', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const results = await queryCollection(env, 'banners', {
      orderBy: [orderBy('sortOrder')],
    });

    return json(results);
  });

  // ── Create banner (admin) ──
  router.post('/api/admin/banners', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await request.json().catch(() => null);
    if (!body) return jsonError('Invalid JSON body', 400);
    if (!body.image_url && !body.imageUrl) return jsonError('imageUrl is required', 400);

    const id = generateId();
    const timestamp = now();

    // Get next sort_order by querying existing banners
    const allBanners = await queryCollection(env, 'banners', {
      orderBy: [orderBy('sortOrder', 'DESCENDING')],
      limit: 1,
    });
    const sortOrder = allBanners.length > 0 ? (allBanners[0].sortOrder || 0) + 1 : 0;

    await setDoc(env, `banners/${id}`, {
      id,
      title: body.title || null,
      imageUrl: body.imageUrl || body.image_url,
      actionType: body.actionType || body.action_type || 'NONE',
      actionValue: body.actionValue || body.action_value || null,
      startDate: body.startDate ?? body.start_date ?? null,
      endDate: body.endDate ?? body.end_date ?? null,
      sortOrder,
      isActive: body.isActive !== undefined ? !!body.isActive : (body.is_active !== false),
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return json({ success: true, id });
  });

  // ── Batch reorder (admin) — must be before /:id route ──
  router.put('/api/admin/banners/reorder', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await request.json().catch(() => null);
    if (!Array.isArray(body)) return jsonError('Expected array of {id, sort_order}', 400);

    const timestamp = now();
    const writes = body.map(item =>
      batchUpdateOp(env, `banners/${item.id}`, {
        sortOrder: item.sort_order ?? item.sortOrder,
        updatedAt: timestamp,
      })
    );

    if (writes.length > 0) await batchWrite(env, writes);

    return json({ success: true });
  });

  // ── Update banner (admin) ──
  router.put('/api/admin/banners/:id', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await request.json().catch(() => null);
    if (!body) return jsonError('Invalid JSON body', 400);

    const existing = await getDoc(env, `banners/${params.id}`);
    if (!existing) return jsonError('Banner not found', 404);

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

    if (Object.keys(fields).length === 0) return jsonError('No fields to update', 400);

    fields.updatedAt = now();
    await updateDoc(env, `banners/${params.id}`, fields);

    return json({ success: true });
  });

  // ── Delete banner (admin) ──
  router.delete('/api/admin/banners/:id', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const banner = await getDoc(env, `banners/${params.id}`);
    if (!banner) return jsonError('Banner not found', 404);

    // Delete R2 object if it's our CDN URL
    const CDN_PREFIX = 'https://images.shytalk.shyden.co.uk/';
    if (banner.imageUrl && banner.imageUrl.startsWith(CDN_PREFIX)) {
      const key = banner.imageUrl.slice(CDN_PREFIX.length);
      await env.R2_BUCKET.delete(key);
    }

    await deleteDoc(env, `banners/${params.id}`);

    return json({ success: true });
  });

  // ── Upload banner image to R2 (admin) ──
  router.post('/api/admin/banners/upload', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return jsonError('Expected multipart/form-data', 400);
    }

    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || typeof file === 'string') {
      return jsonError('No file uploaded', 400);
    }

    const mimeToExt = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };
    const ext = mimeToExt[file.type] || 'jpg';
    const key = `banners/${generateId()}_${Date.now()}.${ext}`;

    await env.R2_BUCKET.put(key, file.stream(), {
      httpMetadata: { contentType: file.type },
    });

    const imageUrl = `https://images.shytalk.shyden.co.uk/${key}`;
    return json({ success: true, image_url: imageUrl, imageUrl, key });
  });
}

module.exports = { registerBannerRoutes };

/**
 * Admin gift catalog routes — CRUD.
 *
 * POST   /gifts         → Create new gift (admin)
 * PUT    /gifts/:id     → Update gift fields (admin)
 * DELETE /gifts/:id     → Delete gift (admin)
 */

const router = require('express').Router();
const { db } = require('../utils/firebase');
const { requireAdmin } = require('../middleware/auth');
const { generateId, now } = require('../utils/helpers');
const log = require('../utils/log');

// ── Create gift ──
router.post('/gifts', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body?.name || body.coinValue === null || body.coinValue === undefined) {
      return res.status(400).json({ error: 'name and coinValue required' });
    }

    const id = body.id || generateId();
    const giftData = {
      id,
      name: body.name,
      coinValue: body.coinValue,
      animationUrl: body.animationUrl ?? body.animation_url ?? '',
      soundUrl: body.soundUrl ?? body.sound_url ?? '',
      iconUrl: body.iconUrl ?? body.icon_url ?? '',
      order: body.order ?? 0,
      expiresAfterDays: body.expiresAfterDays ?? body.expires_after_days ?? null,
      showInStore: body.showInStore !== false && body.show_in_store !== false,
      showOnWheel: body.showOnWheel !== false && body.show_on_wheel !== false,
      weight: body.weight ?? 1.0,
    };

    await Promise.all([
      db.doc(`gifts/${id}`).set(giftData),

      db.doc(`adminAuditLog/${generateId()}`).set({
        adminId: req.auth.uid,
        action: 'CREATE_GIFT',
        targetUserId: null,
        details: `Created gift: ${body.name} (${id})`,
        createdAt: now(),
      }),
    ]);

    res.json({ success: true, id });
  } catch (err) {
    log.error('admin-gifts', 'POST /gifts failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Update gift ──
router.put('/gifts/:id', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body) return res.status(400).json({ error: 'Invalid JSON body' });

    // Build camelCase update object from either camelCase or snake_case input
    const updates = {};
    if ('name' in body) updates.name = body.name;
    if ('coinValue' in body || 'coin_value' in body)
      updates.coinValue = body.coinValue ?? body.coin_value;
    if ('animationUrl' in body || 'animation_url' in body)
      updates.animationUrl = body.animationUrl ?? body.animation_url;
    if ('soundUrl' in body || 'sound_url' in body)
      updates.soundUrl = body.soundUrl ?? body.sound_url;
    if ('iconUrl' in body || 'icon_url' in body) updates.iconUrl = body.iconUrl ?? body.icon_url;
    if ('order' in body) updates.order = body.order;
    if ('expiresAfterDays' in body || 'expires_after_days' in body)
      updates.expiresAfterDays = body.expiresAfterDays ?? body.expires_after_days;
    if ('showInStore' in body || 'show_in_store' in body)
      updates.showInStore = !!(body.showInStore ?? body.show_in_store);
    if ('showOnWheel' in body || 'show_on_wheel' in body)
      updates.showOnWheel = !!(body.showOnWheel ?? body.show_on_wheel);
    if ('weight' in body) updates.weight = body.weight;

    if (Object.keys(updates).length === 0)
      return res.status(400).json({ error: 'No valid fields to update' });

    log.info('admin-gifts', 'Updating gift', {
      adminId: req.auth.uid,
      giftId: req.params.id,
      fields: Object.keys(updates),
    });
    await db.doc(`gifts/${req.params.id}`).update(updates);

    res.json({ success: true });
  } catch (err) {
    log.error('admin-gifts', 'PUT /gifts/:id failed', {
      giftId: req.params.id,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete gift ──
router.delete('/gifts/:id', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    await Promise.all([
      db.doc(`gifts/${req.params.id}`).delete(),

      db.doc(`adminAuditLog/${generateId()}`).set({
        adminId: req.auth.uid,
        action: 'DELETE_GIFT',
        targetUserId: null,
        details: `Deleted gift: ${req.params.id}`,
        createdAt: now(),
      }),
    ]);

    res.json({ success: true });
  } catch (err) {
    log.error('admin-gifts', 'DELETE /gifts/:id failed', {
      giftId: req.params.id,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

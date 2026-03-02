/**
 * Admin gift catalog routes — CRUD + seed.
 *
 * GET    /api/gifts         → List all gifts (already in config.js for public)
 * POST   /api/gifts         → Create new gift (admin)
 * PUT    /api/gifts/:id     → Update gift fields (admin)
 * DELETE /api/gifts/:id     → Delete gift (admin)
 * POST   /api/gifts/seed    → Seed 27-gift catalog (admin, idempotent)
 */

const { json, jsonError, generateId, now, parseBody } = require('../utils');
const { requireAdmin } = require('../middleware/auth');

function registerAdminGiftRoutes(router) {

  // ── Create gift ──
  router.post('/api/gifts', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await parseBody(request);
    if (!body?.name || body.coinValue == null) {
      return jsonError('name and coinValue required', 400);
    }

    const id = body.id || generateId();
    await env.DB.prepare(`
      INSERT INTO gifts (id, name, coin_value, animation_url, sound_url, icon_url,
        "order", expires_after_days, show_in_store, show_on_wheel, weight)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, body.name, body.coinValue,
      body.animationUrl || '', body.soundUrl || '', body.iconUrl || '',
      body.order || 0, body.expiresAfterDays || null,
      body.showInStore != null ? (body.showInStore ? 1 : 0) : 1,
      body.showOnWheel != null ? (body.showOnWheel ? 1 : 0) : 1,
      body.weight || 1.0
    ).run();

    await env.DB.prepare(`
      INSERT INTO admin_audit_log (id, admin_id, action, target_user_id, details, created_at)
      VALUES (?, ?, 'CREATE_GIFT', NULL, ?, ?)
    `).bind(generateId(), request.auth.uid, `Created gift: ${body.name} (${id})`, now()).run();

    return json({ success: true, id });
  });

  // ── Update gift ──
  router.put('/api/gifts/:id', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await parseBody(request);
    if (!body) return jsonError('Invalid JSON body', 400);

    const fieldMap = {
      name: 'name', coinValue: 'coin_value', coin_value: 'coin_value',
      animationUrl: 'animation_url', animation_url: 'animation_url',
      soundUrl: 'sound_url', sound_url: 'sound_url',
      iconUrl: 'icon_url', icon_url: 'icon_url',
      order: '"order"',
      expiresAfterDays: 'expires_after_days', expires_after_days: 'expires_after_days',
      showInStore: 'show_in_store', show_in_store: 'show_in_store',
      showOnWheel: 'show_on_wheel', show_on_wheel: 'show_on_wheel',
      weight: 'weight',
    };

    const updates = [];
    const binds = [];

    for (const [inputKey, dbCol] of Object.entries(fieldMap)) {
      if (inputKey in body) {
        let value = body[inputKey];
        // Convert booleans to integers
        if (typeof value === 'boolean') value = value ? 1 : 0;
        updates.push(`${dbCol} = ?`);
        binds.push(value);
      }
    }

    if (updates.length === 0) return jsonError('No valid fields to update', 400);

    binds.push(params.id);
    await env.DB.prepare(
      `UPDATE gifts SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...binds).run();

    return json({ success: true });
  });

  // ── Delete gift ──
  router.delete('/api/gifts/:id', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    await env.DB.prepare('DELETE FROM gifts WHERE id = ?').bind(params.id).run();

    await env.DB.prepare(`
      INSERT INTO admin_audit_log (id, admin_id, action, target_user_id, details, created_at)
      VALUES (?, ?, 'DELETE_GIFT', NULL, ?, ?)
    `).bind(generateId(), request.auth.uid, `Deleted gift: ${params.id}`, now()).run();

    return json({ success: true });
  });

  // ── Seed gift catalog (idempotent upsert) ──
  router.post('/api/gifts/seed', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const SEED_GIFTS = [
      { id: 'rose', name: 'Rose', coinValue: 1, order: 1 },
      { id: 'lollipop', name: 'Lollipop', coinValue: 5, order: 2 },
      { id: 'ice_cream', name: 'Ice Cream', coinValue: 10, order: 3 },
      { id: 'coffee', name: 'Coffee', coinValue: 25, order: 4 },
      { id: 'teddy_bear', name: 'Teddy Bear', coinValue: 50, order: 5 },
      { id: 'chocolate_box', name: 'Chocolate Box', coinValue: 100, order: 6 },
      { id: 'bouquet', name: 'Bouquet', coinValue: 200, order: 7 },
      { id: 'perfume', name: 'Perfume', coinValue: 500, order: 8 },
      { id: 'fireworks', name: 'Fireworks', coinValue: 1000, order: 9 },
      { id: 'diamond_ring', name: 'Diamond Ring', coinValue: 2000, order: 10 },
      { id: 'crown', name: 'Crown', coinValue: 5000, order: 11 },
      { id: 'castle', name: 'Castle', coinValue: 10000, order: 12 },
      { id: 'yacht', name: 'Yacht', coinValue: 20000, order: 13 },
      { id: 'rocket', name: 'Rocket', coinValue: 50000, order: 14 },
      { id: 'planet', name: 'Planet', coinValue: 100000, order: 15 },
      { id: 'universe', name: 'Universe', coinValue: 200000, order: 16 },
      { id: 'star', name: 'Star', coinValue: 10, order: 17 },
      { id: 'heart', name: 'Heart', coinValue: 25, order: 18 },
      { id: 'balloon', name: 'Balloon', coinValue: 5, order: 19 },
      { id: 'cake', name: 'Cake', coinValue: 50, order: 20 },
      { id: 'pizza', name: 'Pizza', coinValue: 15, order: 21 },
      { id: 'sushi', name: 'Sushi', coinValue: 30, order: 22 },
      { id: 'rainbow', name: 'Rainbow', coinValue: 500, order: 23 },
      { id: 'sunflower', name: 'Sunflower', coinValue: 100, order: 24 },
      { id: 'music_box', name: 'Music Box', coinValue: 250, order: 25 },
      { id: 'magic_lamp', name: 'Magic Lamp', coinValue: 1500, order: 26 },
      { id: 'treasure_chest', name: 'Treasure Chest', coinValue: 3000, order: 27 },
    ];

    const stmts = SEED_GIFTS.map(g =>
      env.DB.prepare(`
        INSERT INTO gifts (id, name, coin_value, "order", animation_url, sound_url, icon_url, show_in_store, show_on_wheel)
        VALUES (?, ?, ?, ?, '', '', '', 1, 1)
        ON CONFLICT(id) DO UPDATE SET name = ?, coin_value = ?, "order" = ?
      `).bind(g.id, g.name, g.coinValue, g.order, g.name, g.coinValue, g.order)
    );

    await env.DB.batch(stmts);

    await env.DB.prepare(`
      INSERT INTO admin_audit_log (id, admin_id, action, target_user_id, details, created_at)
      VALUES (?, ?, 'SEED_GIFTS', NULL, 'Seeded 27 gifts', ?)
    `).bind(generateId(), request.auth.uid, now()).run();

    return json({ success: true, count: SEED_GIFTS.length });
  });
}

module.exports = { registerAdminGiftRoutes };

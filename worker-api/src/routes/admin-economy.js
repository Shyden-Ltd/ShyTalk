/**
 * Admin economy routes — balance adjustment, backpack, luck, transactions, gacha guarantee.
 *
 * GET    /api/users/:uid/economy              → Economy snapshot
 * POST   /api/users/:uid/adjust-balance       → Adjust coins or beans
 * GET    /api/users/:uid/backpack             → (handled by economy.js, but admin also POSTs)
 * POST   /api/users/:uid/backpack             → Set backpack item quantity
 * GET    /api/users/:uid/luck                 → Get luck + pity
 * POST   /api/users/:uid/luck                 → Update luck/pity
 * GET    /api/users/:uid/transactions         → Paginated transaction history
 * GET    /api/users/:uid/guarantee-next-pull  → Check guarantee status
 * POST   /api/users/:uid/guarantee-next-pull  → Set guaranteed next pull
 * DELETE /api/users/:uid/guarantee-next-pull  → Revoke guarantee
 */

const { json, jsonError, generateId, now, parseBody } = require('../utils');
const { requireAdmin } = require('../middleware/auth');

function registerAdminEconomyRoutes(router) {

  // ── Economy snapshot ──
  router.get('/api/users/:uid/economy', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const user = await env.DB.prepare(`
      SELECT shy_coins, shy_beans, luck_score, pity_counter,
             is_super_shy, super_shy_expiry, super_shy_tier,
             login_streak, last_login_date, guaranteed_next_pull_gift_id
      FROM users WHERE uid = ?
    `).bind(params.uid).first();

    if (!user) return jsonError('User not found', 404);
    return json(user);
  });

  // ── Adjust balance (coins or beans) ──
  router.post('/api/users/:uid/adjust-balance', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await parseBody(request);
    if (!body) return jsonError('Invalid JSON body', 400);

    const { amount, currency, reason } = body;
    if (typeof amount !== 'number' || amount === 0) {
      return jsonError('amount must be a non-zero number', 400);
    }
    if (!['coins', 'beans'].includes(currency)) {
      return jsonError('currency must be "coins" or "beans"', 400);
    }

    const column = currency === 'coins' ? 'shy_coins' : 'shy_beans';
    const user = await env.DB.prepare(
      `SELECT ${column} FROM users WHERE uid = ?`
    ).bind(params.uid).first();
    if (!user) return jsonError('User not found', 404);

    const currentBalance = user[column] || 0;
    const newBalance = Math.max(0, currentBalance + amount);

    const timestamp = now();
    await env.DB.batch([
      env.DB.prepare(`UPDATE users SET ${column} = ? WHERE uid = ?`)
        .bind(newBalance, params.uid),

      env.DB.prepare(`
        INSERT INTO transactions (id, user_id, type, amount, currency, balance_after, details, timestamp)
        VALUES (?, ?, 'ADMIN_ADJUSTMENT', ?, ?, ?, ?, ?)
      `).bind(generateId(), params.uid, amount, currency.toUpperCase(), newBalance,
        reason || `Admin adjustment: ${amount > 0 ? '+' : ''}${amount} ${currency}`, timestamp),

      env.DB.prepare(`
        INSERT INTO admin_audit_log (id, admin_id, action, target_user_id, details, created_at)
        VALUES (?, ?, 'ADJUST_BALANCE', ?, ?, ?)
      `).bind(generateId(), request.auth.uid, params.uid,
        `${amount > 0 ? '+' : ''}${amount} ${currency} (${reason || 'no reason'})`, timestamp),
    ]);

    return json({ success: true, newBalance, currency });
  });

  // ── Set backpack item quantity (admin) ──
  router.post('/api/users/:uid/backpack', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await parseBody(request);
    if (!body?.giftId) return jsonError('giftId required', 400);
    if (typeof body.quantity !== 'number' || body.quantity < 0) {
      return jsonError('quantity must be a non-negative number', 400);
    }

    const timestamp = now();
    const stmts = [];

    if (body.quantity === 0) {
      stmts.push(env.DB.prepare(
        'DELETE FROM backpack_items WHERE user_id = ? AND gift_id = ?'
      ).bind(params.uid, body.giftId));
    } else {
      stmts.push(env.DB.prepare(`
        INSERT INTO backpack_items (user_id, gift_id, quantity, last_acquired)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, gift_id) DO UPDATE SET quantity = ?, last_acquired = ?
      `).bind(params.uid, body.giftId, body.quantity, timestamp, body.quantity, timestamp));
    }

    stmts.push(env.DB.prepare(`
      INSERT INTO admin_audit_log (id, admin_id, action, target_user_id, details, created_at)
      VALUES (?, ?, 'SET_BACKPACK', ?, ?, ?)
    `).bind(generateId(), request.auth.uid, params.uid,
      `Set ${body.giftId} quantity to ${body.quantity}`, timestamp));

    await env.DB.batch(stmts);
    return json({ success: true });
  });

  // ── Get luck + pity ──
  router.get('/api/users/:uid/luck', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const user = await env.DB.prepare(
      'SELECT luck_score, pity_counter FROM users WHERE uid = ?'
    ).bind(params.uid).first();
    if (!user) return jsonError('User not found', 404);

    return json({ luckScore: user.luck_score || 0, pityCounter: user.pity_counter || 0 });
  });

  // ── Update luck/pity ──
  router.post('/api/users/:uid/luck', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await parseBody(request);
    if (!body) return jsonError('Invalid JSON body', 400);

    const updates = [];
    const binds = [];

    if (body.luckScore != null) {
      const luck = Math.max(0, Math.min(100, parseInt(body.luckScore)));
      updates.push('luck_score = ?');
      binds.push(luck);
    }
    if (body.pityCounter != null) {
      const pity = Math.max(0, parseInt(body.pityCounter));
      updates.push('pity_counter = ?');
      binds.push(pity);
    }

    if (updates.length === 0) return jsonError('No fields to update', 400);

    binds.push(params.uid);
    await env.DB.prepare(
      `UPDATE users SET ${updates.join(', ')} WHERE uid = ?`
    ).bind(...binds).run();

    await env.DB.prepare(`
      INSERT INTO admin_audit_log (id, admin_id, action, target_user_id, details, created_at)
      VALUES (?, ?, 'SET_LUCK', ?, ?, ?)
    `).bind(generateId(), request.auth.uid, params.uid,
      JSON.stringify(body), now()).run();

    return json({ success: true });
  });

  // ── Transaction history (admin view — any user) ──
  router.get('/api/users/:uid/transactions', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const filterType = url.searchParams.get('type');

    let query = 'SELECT * FROM transactions WHERE user_id = ?';
    const binds = [params.uid];

    if (filterType) {
      query += ' AND type = ?';
      binds.push(filterType);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    binds.push(limit);

    const { results } = await env.DB.prepare(query).bind(...binds).all();
    return json(results);
  });

  // ── Gacha guarantee: check ──
  router.get('/api/users/:uid/guarantee-next-pull', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const user = await env.DB.prepare(
      'SELECT guaranteed_next_pull_gift_id FROM users WHERE uid = ?'
    ).bind(params.uid).first();
    if (!user) return jsonError('User not found', 404);

    let gift = null;
    if (user.guaranteed_next_pull_gift_id) {
      gift = await env.DB.prepare(
        'SELECT id, name, coin_value, icon_url FROM gifts WHERE id = ?'
      ).bind(user.guaranteed_next_pull_gift_id).first();
    }

    return json({
      guaranteedGiftId: user.guaranteed_next_pull_gift_id,
      gift,
    });
  });

  // ── Gacha guarantee: set ──
  router.post('/api/users/:uid/guarantee-next-pull', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await parseBody(request);
    if (!body?.giftId) return jsonError('giftId required', 400);

    // Verify gift exists
    const gift = await env.DB.prepare('SELECT id FROM gifts WHERE id = ?')
      .bind(body.giftId).first();
    if (!gift) return jsonError('Gift not found', 404);

    await env.DB.batch([
      env.DB.prepare('UPDATE users SET guaranteed_next_pull_gift_id = ? WHERE uid = ?')
        .bind(body.giftId, params.uid),
      env.DB.prepare(`
        INSERT INTO admin_audit_log (id, admin_id, action, target_user_id, details, created_at)
        VALUES (?, ?, 'SET_GUARANTEE', ?, ?, ?)
      `).bind(generateId(), request.auth.uid, params.uid,
        `Guaranteed: ${body.giftId}`, now()),
    ]);

    return json({ success: true });
  });

  // ── Gacha guarantee: revoke ──
  router.delete('/api/users/:uid/guarantee-next-pull', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    await env.DB.batch([
      env.DB.prepare('UPDATE users SET guaranteed_next_pull_gift_id = NULL WHERE uid = ?')
        .bind(params.uid),
      env.DB.prepare(`
        INSERT INTO admin_audit_log (id, admin_id, action, target_user_id, details, created_at)
        VALUES (?, ?, 'REVOKE_GUARANTEE', ?, NULL, ?)
      `).bind(generateId(), request.auth.uid, params.uid, now()),
    ]);

    return json({ success: true });
  });
}

module.exports = { registerAdminEconomyRoutes };

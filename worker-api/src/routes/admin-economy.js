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
const {
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  queryCollection,
  fieldFilter,
  andFilter,
  orderBy,
} = require('../utils/firestore');

function registerAdminEconomyRoutes(router) {

  // ── Economy snapshot ──
  router.get('/api/users/:uid/economy', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const user = await getDoc(env, `users/${params.uid}`);
    if (!user) return jsonError('User not found', 404);

    return json({
      shyCoins:                user.shyCoins                ?? user.shy_coins                ?? 0,
      shyBeans:                user.shyBeans                ?? user.shy_beans                ?? 0,
      luckScore:               user.luckScore               ?? user.luck_score               ?? 0,
      pityCounter:             user.pityCounter             ?? user.pity_counter             ?? 0,
      isSuperShy:              user.isSuperShy              ?? user.is_super_shy             ?? false,
      superShyExpiry:          user.superShyExpiry          ?? user.super_shy_expiry         ?? null,
      superShyTier:            user.superShyTier            ?? user.super_shy_tier           ?? null,
      loginStreak:             user.loginStreak             ?? user.login_streak             ?? 0,
      lastLoginDate:           user.lastLoginDate           ?? user.last_login_date          ?? null,
      guaranteedNextPullGiftId: user.guaranteedNextPullGiftId ?? user.guaranteed_next_pull_gift_id ?? null,
    });
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

    const field = currency === 'coins' ? 'shyCoins' : 'shyBeans';
    const user = await getDoc(env, `users/${params.uid}`);
    if (!user) return jsonError('User not found', 404);

    const currentBalance = user[field] ?? (currency === 'coins' ? (user.shy_coins ?? 0) : (user.shy_beans ?? 0));
    const newBalance = Math.max(0, currentBalance + amount);
    const timestamp = now();
    const txId = generateId();
    const logId = generateId();

    await Promise.all([
      updateDoc(env, `users/${params.uid}`, { [field]: newBalance }),

      setDoc(env, `users/${params.uid}/transactions/${txId}`, {
        id:           txId,
        userId:       params.uid,
        type:         'ADMIN_ADJUSTMENT',
        amount:       amount,
        currency:     currency.toUpperCase(),
        balanceAfter: newBalance,
        details:      reason || `Admin adjustment: ${amount > 0 ? '+' : ''}${amount} ${currency}`,
        timestamp:    timestamp,
      }),

      setDoc(env, `adminAuditLog/${logId}`, {
        adminId:      request.auth.uid,
        action:       'ADJUST_BALANCE',
        targetUserId: params.uid,
        details:      `${amount > 0 ? '+' : ''}${amount} ${currency} (${reason || 'no reason'})`,
        createdAt:    timestamp,
      }),
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
    const backpackPath = `users/${params.uid}/backpack/${body.giftId}`;

    if (body.quantity === 0) {
      await deleteDoc(env, backpackPath);
    } else {
      await setDoc(env, backpackPath, {
        giftId:       body.giftId,
        quantity:     body.quantity,
        lastAcquired: timestamp,
      });
    }

    await setDoc(env, `adminAuditLog/${generateId()}`, {
      adminId:      request.auth.uid,
      action:       'SET_BACKPACK',
      targetUserId: params.uid,
      details:      `Set ${body.giftId} quantity to ${body.quantity}`,
      createdAt:    timestamp,
    });

    return json({ success: true });
  });

  // ── Get luck + pity ──
  router.get('/api/users/:uid/luck', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const user = await getDoc(env, `users/${params.uid}`);
    if (!user) return jsonError('User not found', 404);

    return json({
      luckScore:   user.luckScore   ?? user.luck_score   ?? 0,
      pityCounter: user.pityCounter ?? user.pity_counter ?? 0,
    });
  });

  // ── Update luck/pity ──
  router.post('/api/users/:uid/luck', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await parseBody(request);
    if (!body) return jsonError('Invalid JSON body', 400);

    const updates = {};
    if (body.luckScore != null) {
      updates.luckScore = Math.max(0, Math.min(100, parseInt(body.luckScore)));
    }
    if (body.pityCounter != null) {
      updates.pityCounter = Math.max(0, parseInt(body.pityCounter));
    }

    if (Object.keys(updates).length === 0) return jsonError('No fields to update', 400);

    await Promise.all([
      updateDoc(env, `users/${params.uid}`, updates),

      setDoc(env, `adminAuditLog/${generateId()}`, {
        adminId:      request.auth.uid,
        action:       'SET_LUCK',
        targetUserId: params.uid,
        details:      JSON.stringify(body),
        createdAt:    now(),
      }),
    ]);

    return json({ success: true });
  });

  // ── Transaction history (admin view — any user) ──
  router.get('/api/users/:uid/transactions', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const filterType = url.searchParams.get('type');

    const structuredQuery = {
      orderBy: [orderBy('timestamp', 'DESCENDING')],
      limit,
    };

    if (filterType) {
      structuredQuery.where = fieldFilter('type', 'EQUAL', filterType);
    }

    const results = await queryCollection(
      env,
      `users/${params.uid}/transactions`,
      structuredQuery
    );

    return json(results);
  });

  // ── Gacha guarantee: check ──
  router.get('/api/users/:uid/guarantee-next-pull', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const user = await getDoc(env, `users/${params.uid}`);
    if (!user) return jsonError('User not found', 404);

    const guaranteedGiftId = user.guaranteedNextPullGiftId
      ?? user.guaranteed_next_pull_gift_id
      ?? null;

    let gift = null;
    if (guaranteedGiftId) {
      const giftDoc = await getDoc(env, `gifts/${guaranteedGiftId}`);
      if (giftDoc) {
        gift = {
          id:        giftDoc.id,
          name:      giftDoc.name,
          coinValue: giftDoc.coinValue ?? giftDoc.coin_value,
          iconUrl:   giftDoc.iconUrl   ?? giftDoc.icon_url,
        };
      }
    }

    return json({ guaranteedGiftId, gift });
  });

  // ── Gacha guarantee: set ──
  router.post('/api/users/:uid/guarantee-next-pull', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await parseBody(request);
    if (!body?.giftId) return jsonError('giftId required', 400);

    // Verify gift exists
    const gift = await getDoc(env, `gifts/${body.giftId}`);
    if (!gift) return jsonError('Gift not found', 404);

    await Promise.all([
      updateDoc(env, `users/${params.uid}`, { guaranteedNextPullGiftId: body.giftId }),

      setDoc(env, `adminAuditLog/${generateId()}`, {
        adminId:      request.auth.uid,
        action:       'SET_GUARANTEE',
        targetUserId: params.uid,
        details:      `Guaranteed: ${body.giftId}`,
        createdAt:    now(),
      }),
    ]);

    return json({ success: true });
  });

  // ── Gacha guarantee: revoke ──
  router.delete('/api/users/:uid/guarantee-next-pull', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    await Promise.all([
      updateDoc(env, `users/${params.uid}`, { guaranteedNextPullGiftId: null }),

      setDoc(env, `adminAuditLog/${generateId()}`, {
        adminId:      request.auth.uid,
        action:       'REVOKE_GUARANTEE',
        targetUserId: params.uid,
        details:      null,
        createdAt:    now(),
      }),
    ]);

    return json({ success: true });
  });
}

module.exports = { registerAdminEconomyRoutes };

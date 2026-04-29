/**
 * Admin economy routes — balance adjustment, backpack, luck, transactions, gacha guarantee.
 *
 * GET    /users/:uniqueId/economy              → Economy snapshot
 * POST   /users/:uniqueId/adjust-balance       → Adjust coins or beans
 * POST   /users/:uniqueId/backpack             → Set backpack item quantity
 * GET    /users/:uniqueId/luck                 → Get luck + pity
 * POST   /users/:uniqueId/luck                 → Update luck/pity
 * GET    /users/:uniqueId/transactions         → Paginated transaction history
 * GET    /users/:uniqueId/guarantee-next-pull  → Check guarantee status
 * POST   /users/:uniqueId/guarantee-next-pull  → Set guaranteed next pull
 * DELETE /users/:uniqueId/guarantee-next-pull  → Revoke guarantee
 */

const router = require('express').Router();
const { db } = require('../utils/firebase');
const { requireAdmin } = require('../middleware/auth');
const { generateId, now } = require('../utils/helpers');
const { sendSystemPm } = require('../utils/system-pm');
const log = require('../utils/log');

// ── Economy snapshot ──
router.get('/users/:uniqueId/economy', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const snap = await db.doc(`users/${req.params.uniqueId}`).get();
    if (!snap.exists) return res.status(404).json({ error: 'User not found' });
    const user = snap.data();

    res.json({
      shyCoins: user.shyCoins ?? user.shy_coins ?? 0,
      shyBeans: user.shyBeans ?? user.shy_beans ?? 0,
      luckScore: user.luckScore ?? user.luck_score ?? 0,
      pityCounter: user.pityCounter ?? user.pity_counter ?? 0,
      isSuperShy: user.isSuperShy ?? user.is_super_shy ?? false,
      superShyExpiry: user.superShyExpiry ?? user.super_shy_expiry ?? null,
      superShyTier: user.superShyTier ?? user.super_shy_tier ?? null,
      loginStreak: user.loginStreak ?? user.login_streak ?? 0,
      lastLoginDate: user.lastLoginDate ?? user.last_login_date ?? null,
      guaranteedNextPullGiftId:
        user.guaranteedNextPullGiftId ?? user.guaranteed_next_pull_gift_id ?? null,
    });
  } catch (err) {
    log.error('admin-economy', 'Error fetching economy snapshot', {
      uid: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Adjust balance (coins or beans) ──
router.post('/users/:uniqueId/adjust-balance', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body) return res.status(400).json({ error: 'Invalid JSON body' });

    const { reason } = body;
    const currency = (body.currency || '').toLowerCase();
    // Support both signed amount and operation+amount
    let amount = body.amount;
    if (typeof amount !== 'number' || amount === 0) {
      return res.status(400).json({ error: 'amount must be a non-zero number' });
    }
    if (body.operation === 'deduct' && amount > 0) amount = -amount;
    if (!['coins', 'beans'].includes(currency)) {
      return res.status(400).json({ error: 'currency must be "coins" or "beans"' });
    }

    const field = currency === 'coins' ? 'shyCoins' : 'shyBeans';
    const snap = await db.doc(`users/${req.params.uniqueId}`).get();
    if (!snap.exists) return res.status(404).json({ error: 'User not found' });
    const user = snap.data();

    const currentBalance =
      user[field] ?? (currency === 'coins' ? (user.shy_coins ?? 0) : (user.shy_beans ?? 0));
    const newBalance = Math.max(0, currentBalance + amount);
    const timestamp = now();
    const txId = generateId();
    const logId = generateId();

    await Promise.all([
      db.doc(`users/${req.params.uniqueId}`).update({ [field]: newBalance }),

      db.doc(`users/${req.params.uniqueId}/transactions/${txId}`).set({
        id: txId,
        userId: req.params.uniqueId,
        type: 'ADMIN_ADJUSTMENT',
        amount: amount,
        currency: currency.toUpperCase(),
        balanceAfter: newBalance,
        details: reason || `Admin adjustment: ${amount > 0 ? '+' : ''}${amount} ${currency}`,
        timestamp: timestamp,
      }),

      db.doc(`adminAuditLog/${logId}`).set({
        adminId: req.auth.uid,
        action: 'ADJUST_BALANCE',
        targetUserId: req.params.uniqueId,
        details: `${amount > 0 ? '+' : ''}${amount} ${currency} (${reason || 'no reason'})`,
        createdAt: timestamp,
      }),
    ]);

    // Send system PM about balance adjustment. Track failure for admin UI's
    // PartialFailureToast — `pms: { failed, total }` is the standard shape.
    const currencyName = currency === 'coins' ? 'Shy Coins' : 'Shy Beans';
    const absAmount = Math.abs(amount);
    const action = amount > 0 ? 'were added to' : 'were deducted from';
    let pmFailed = 0;
    try {
      await sendSystemPm(
        req.params.uniqueId,
        `${absAmount} ${currencyName} ${action} your account.`,
      );
    } catch (e) {
      log.warn('system-pm', 'Failed to send', { uid: req.params.uniqueId, error: e.message });
      pmFailed = 1;
    }

    res.json({
      success: true,
      newBalance,
      currency,
      pms: { failed: pmFailed, total: 1 },
    });
  } catch (err) {
    log.error('admin-economy', 'Error adjusting balance', {
      uid: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Set backpack item quantity (admin) ──
router.post('/users/:uniqueId/backpack', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body?.giftId) return res.status(400).json({ error: 'giftId required' });
    if (typeof body.quantity !== 'number' || body.quantity < 0) {
      return res.status(400).json({ error: 'quantity must be a non-negative number' });
    }

    const timestamp = now();
    const backpackRef = db.doc(`users/${req.params.uniqueId}/backpack/${body.giftId}`);

    if (body.quantity === 0) {
      await backpackRef.delete();
    } else {
      await backpackRef.set({
        giftId: body.giftId,
        quantity: body.quantity,
        lastAcquired: timestamp,
      });
    }

    await db.doc(`adminAuditLog/${generateId()}`).set({
      adminId: req.auth.uid,
      action: 'SET_BACKPACK',
      targetUserId: req.params.uniqueId,
      details: `Set ${body.giftId} quantity to ${body.quantity}`,
      createdAt: timestamp,
    });

    // Notify user about backpack change (unless silent)
    if (!body.silent) {
      const name = body.giftName || body.giftId;
      const msg =
        body.quantity === 0
          ? `🎒 "${name}" has been removed from your backpack by the moderation team.`
          : `🎒 Your backpack has been updated: "${name}" quantity set to ${body.quantity}.`;
      sendSystemPm(req.params.uniqueId, msg).catch((err) =>
        log.error('admin-economy', 'Failed to send backpack PM', {
          uid: req.params.uniqueId,
          error: err.message,
        }),
      );
    }

    res.json({ success: true });
  } catch (err) {
    log.error('admin-economy', 'Error setting backpack item', {
      uid: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Get luck + pity ──
router.get('/users/:uniqueId/luck', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const snap = await db.doc(`users/${req.params.uniqueId}`).get();
    if (!snap.exists) return res.status(404).json({ error: 'User not found' });
    const user = snap.data();

    res.json({
      luckScore: user.luckScore ?? user.luck_score ?? 0,
      pityCounter: user.pityCounter ?? user.pity_counter ?? 0,
    });
  } catch (err) {
    log.error('admin-economy', 'Error fetching luck', {
      uid: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Update luck/pity ──
router.post('/users/:uniqueId/luck', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body) return res.status(400).json({ error: 'Invalid JSON body' });

    const updates = {};
    if (body.luckScore !== null && body.luckScore !== undefined) {
      const parsed = Number.parseInt(body.luckScore, 10);
      if (Number.isNaN(parsed))
        return res.status(400).json({ error: 'luckScore must be a number' });
      updates.luckScore = Math.max(0, Math.min(100, parsed));
    }
    if (body.pityCounter !== null && body.pityCounter !== undefined) {
      const parsed = Number.parseInt(body.pityCounter, 10);
      if (Number.isNaN(parsed))
        return res.status(400).json({ error: 'pityCounter must be a number' });
      updates.pityCounter = Math.max(0, parsed);
    }

    if (Object.keys(updates).length === 0)
      return res.status(400).json({ error: 'No fields to update' });

    await Promise.all([
      db.doc(`users/${req.params.uniqueId}`).update(updates),

      db.doc(`adminAuditLog/${generateId()}`).set({
        adminId: req.auth.uid,
        action: 'SET_LUCK',
        targetUserId: req.params.uniqueId,
        details: JSON.stringify(body),
        createdAt: now(),
      }),
    ]);

    res.json({ success: true });
  } catch (err) {
    log.error('admin-economy', 'Error updating luck', {
      uid: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Transaction history (admin view — any user) ──
router.get('/users/:uniqueId/transactions', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const limit = Math.min(Number.parseInt(req.query.limit, 10) || 50, 200);
    const filterType = req.query.type;

    let query = db.collection(`users/${req.params.uniqueId}/transactions`);

    if (filterType) {
      query = query.where('type', '==', filterType);
    }

    query = query.limit(limit);

    const snapshot = await query.get();
    const results = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    results.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    res.json(results);
  } catch (err) {
    log.error('admin-economy', 'Error fetching transactions', {
      uid: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Gacha guarantee: check ──
router.get('/users/:uniqueId/guarantee-next-pull', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const snap = await db.doc(`users/${req.params.uniqueId}`).get();
    if (!snap.exists) return res.status(404).json({ error: 'User not found' });
    const user = snap.data();

    const guaranteedGiftId =
      user.guaranteedNextPullGiftId ?? user.guaranteed_next_pull_gift_id ?? null;

    let gift = null;
    if (guaranteedGiftId) {
      const giftSnap = await db.doc(`gifts/${guaranteedGiftId}`).get();
      if (giftSnap.exists) {
        const giftData = giftSnap.data();
        gift = {
          id: giftSnap.id,
          name: giftData.name,
          coinValue: giftData.coinValue ?? giftData.coin_value,
          iconUrl: giftData.iconUrl ?? giftData.icon_url,
        };
      }
    }

    res.json({
      active: !!guaranteedGiftId,
      guaranteedGiftId,
      giftName: gift?.name ?? null,
      coinValue: gift?.coinValue ?? 0,
      setAt: user.guaranteedNextPullSetAt ?? null,
      gift,
    });
  } catch (err) {
    log.error('admin-economy', 'Error checking guarantee status', {
      uid: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Gacha guarantee: set ──
router.post('/users/:uniqueId/guarantee-next-pull', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body?.giftId) return res.status(400).json({ error: 'giftId required' });

    // Verify gift exists
    const giftSnap = await db.doc(`gifts/${body.giftId}`).get();
    if (!giftSnap.exists) return res.status(404).json({ error: 'Gift not found' });
    const gift = giftSnap.data();

    await Promise.all([
      db.doc(`users/${req.params.uniqueId}`).update({ guaranteedNextPullGiftId: body.giftId }),

      db.doc(`adminAuditLog/${generateId()}`).set({
        adminId: req.auth.uid,
        action: 'SET_GUARANTEE',
        targetUserId: req.params.uniqueId,
        details: `Guaranteed: ${body.giftId}`,
        createdAt: now(),
      }),
    ]);

    res.json({
      success: true,
      giftName: gift.name ?? gift.giftName ?? body.giftId,
      coinValue: gift.coinValue ?? gift.coin_value ?? 0,
    });
  } catch (err) {
    log.error('admin-economy', 'Error setting guarantee', {
      uid: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Gacha guarantee: revoke ──
router.delete('/users/:uniqueId/guarantee-next-pull', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    await Promise.all([
      db.doc(`users/${req.params.uniqueId}`).update({ guaranteedNextPullGiftId: null }),

      db.doc(`adminAuditLog/${generateId()}`).set({
        adminId: req.auth.uid,
        action: 'REVOKE_GUARANTEE',
        targetUserId: req.params.uniqueId,
        details: null,
        createdAt: now(),
      }),
    ]);

    res.json({ success: true });
  } catch (err) {
    log.error('admin-economy', 'Error revoking guarantee', {
      uid: req.params.uniqueId,
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

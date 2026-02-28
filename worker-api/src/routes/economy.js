/**
 * Economy routes — daily rewards, gacha, gift sending, bean redemption, purchases.
 *
 * POST /api/economy/daily-reward     → Claim daily login reward
 * POST /api/economy/gacha            → Pull gacha (1, 10, or 100)
 * POST /api/economy/gift             → Send gift from backpack
 * POST /api/economy/gift-direct      → Buy and send gift directly
 * POST /api/economy/gift-batch       → Send gifts to multiple recipients
 * POST /api/economy/backpack-send    → Send entire backpack
 * POST /api/economy/redeem-beans     → Redeem beans for coins
 * POST /api/economy/purchase         → Validate in-app purchase
 * POST /api/economy/trial-claim      → Claim Super Shy trial
 * POST /api/economy/trial-activate   → Activate Super Shy trial
 * POST /api/economy/test-coins       → Add test coins (dev)
 * GET  /api/economy/balance          → Get coin/bean balance
 * GET  /api/economy/transactions     → Get transaction history
 * GET  /api/users/:uid/backpack      → Get user's backpack
 * GET  /api/users/:uid/gift-wall     → Get user's gift wall
 * GET  /api/users/:uid/gift-wall/:giftId/senders → Get gift wall senders
 */

const { json, jsonError, generateId, now, todayStr, yesterdayStr, parseBody } = require('../utils');

const DEFAULT_ECONOMY_CONFIG = {
  beanConversionRate: 0.6,
  beanRedeemBonusThreshold: 2000,
  beanRedeemBonusMultiplier: 1.1,
  pullCosts: { '1': 10, '10': 100, '100': 1000 },
  broadcastSendThreshold: 0,
  broadcastWinThreshold: 5000,
  dropRateExponent: 1.5,
  pitySoftStart: 80,
  pityHardLimit: 120,
  pitySoftMaxShift: 0.15,
  pityHighValueThreshold: 5000,
  dailyBase: 50,
  milestoneRewards: { '7': 100, '14': 200, '30': 500, '60': 1000, '90': 2000 },
};

async function loadEconomyConfig(env) {
  const row = await env.DB.prepare("SELECT value FROM config WHERE key = 'economy'").first();
  if (row) {
    return { ...DEFAULT_ECONOMY_CONFIG, ...JSON.parse(row.value) };
  }
  return { ...DEFAULT_ECONOMY_CONFIG };
}

/**
 * Add a broadcast entry and trim to last 50.
 */
async function addBroadcast(env, data) {
  await env.DB.prepare(`
    INSERT INTO broadcasts (id, type, sender_name, sender_photo_url, recipient_name,
      gift_name, gift_icon_url, gift_coin_value, quantity, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    generateId(), data.type, data.senderName, data.senderPhotoUrl || null,
    data.recipientName || '', data.giftName, data.giftIconUrl || '',
    data.giftCoinValue, data.quantity || 1, now()
  ).run();

  // Keep only last 50
  await env.DB.prepare(`
    DELETE FROM broadcasts WHERE id NOT IN (
      SELECT id FROM broadcasts ORDER BY timestamp DESC LIMIT 50
    )
  `).run();
}

function registerEconomyRoutes(router) {

  // ── Daily reward ──
  router.post('/api/economy/daily-reward', async (request, env) => {
    const uid = request.auth.uid;
    const config = await loadEconomyConfig(env);
    const today = todayStr();
    const yesterday = yesterdayStr();

    const user = await env.DB.prepare(
      'SELECT shy_coins, is_super_shy, login_streak, last_login_date, last_login_reward_date FROM users WHERE uid = ?'
    ).bind(uid).first();

    if (!user) return jsonError('User not found', 404);
    if (user.last_login_reward_date === today) {
      return jsonError('Already claimed today', 409);
    }

    const newStreak = (user.last_login_date === yesterday) ? (user.login_streak || 0) + 1 : 1;
    const milestoneRewards = config.milestoneRewards || {};
    const rawReward = milestoneRewards[String(newStreak)];
    const isMilestone = String(newStreak) in milestoneRewards;

    let coinReward = 0;
    let giftReward = null;

    if (rawReward && typeof rawReward === 'object' && rawReward.type === 'gift') {
      giftReward = { giftId: rawReward.giftId, quantity: rawReward.quantity || 1 };
    } else {
      coinReward = (typeof rawReward === 'number') ? rawReward
        : (rawReward?.amount) ? rawReward.amount
        : config.dailyBase;
      if (user.is_super_shy) coinReward = Math.ceil(coinReward * 1.1);
    }

    const newBalance = (user.shy_coins || 0) + coinReward;

    // Update user
    const stmts = [];
    stmts.push(env.DB.prepare(`
      UPDATE users SET login_streak = ?, last_login_date = ?, last_login_reward_date = ?${coinReward > 0 ? ', shy_coins = ?' : ''}
      WHERE uid = ?
    `).bind(...(coinReward > 0
      ? [newStreak, today, today, newBalance, uid]
      : [newStreak, today, today, uid])));

    // Add gift to backpack if gift reward
    if (giftReward) {
      stmts.push(env.DB.prepare(`
        INSERT INTO backpack_items (user_id, gift_id, quantity, last_acquired)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, gift_id) DO UPDATE SET
          quantity = quantity + ?, last_acquired = ?
      `).bind(uid, giftReward.giftId, giftReward.quantity, now(),
              giftReward.quantity, now()));
    }

    // Transaction record
    const txId = generateId();
    const details = giftReward
      ? `Day ${newStreak} (milestone) — ${giftReward.quantity}x ${giftReward.giftId}`
      : `Day ${newStreak}${isMilestone ? ' (milestone)' : ''}`;

    stmts.push(env.DB.prepare(`
      INSERT INTO transactions (id, user_id, type, amount, currency, balance_after, details, timestamp)
      VALUES (?, ?, 'DAILY_REWARD', ?, ?, ?, ?, ?)
    `).bind(txId, uid,
      giftReward ? giftReward.quantity : coinReward,
      giftReward ? 'GIFT' : 'COINS',
      newBalance, details, now()));

    await env.DB.batch(stmts);

    const result = { coinsAwarded: coinReward, newStreak, isMilestone, newBalance };
    if (giftReward) {
      result.giftId = giftReward.giftId;
      result.giftQuantity = giftReward.quantity;
    }
    return json(result);
  });

  // ── Gacha ──
  router.post('/api/economy/gacha', async (request, env) => {
    const uid = request.auth.uid;
    const body = await parseBody(request);
    const pullCount = body?.pullCount;
    const expectedCost = body?.expectedCost;

    if (![1, 10, 100].includes(pullCount)) {
      return jsonError('pullCount must be 1, 10, or 100', 400);
    }

    const config = await loadEconomyConfig(env);
    const pullCosts = config.pullCosts || { '1': 10, '10': 100, '100': 1000 };
    const cost = pullCosts[String(pullCount)];
    if (!cost) return jsonError('Invalid pull count', 400);

    // Price validation
    if (expectedCost != null && expectedCost !== cost) {
      return json({
        priceChanged: true,
        currentPullCosts: pullCosts,
        gifts: [], coinsSpent: 0, newBalance: 0, newPityCounter: 0, newLuckScore: 0,
      });
    }

    const user = await env.DB.prepare(
      'SELECT shy_coins, pity_counter, luck_score, guaranteed_next_pull_gift_id FROM users WHERE uid = ?'
    ).bind(uid).first();

    if (!user) return jsonError('User not found', 404);
    if ((user.shy_coins || 0) < cost) return jsonError('Insufficient coins', 402);

    // Load winnable gifts
    const { results: allGifts } = await env.DB.prepare(
      'SELECT * FROM gifts WHERE coin_value > 0 AND show_on_wheel = 1 ORDER BY "order" ASC LIMIT 16'
    ).all();

    if (allGifts.length === 0) return jsonError('No winnable gifts', 500);

    // Compute base weights
    const exponent = config.dropRateExponent;
    const baseWeights = allGifts.map(g => 1 / Math.pow(g.coin_value, exponent));

    let pity = user.pity_counter || 0;
    let luck = user.luck_score || 0;
    const highValueThreshold = config.pityHighValueThreshold;
    const results = [];

    // Admin-guaranteed first pull
    let guaranteedFirstPull = false;
    if (user.guaranteed_next_pull_gift_id) {
      const guaranteedGift = allGifts.find(g => g.id === user.guaranteed_next_pull_gift_id);
      if (guaranteedGift) {
        results.push(guaranteedGift);
        guaranteedFirstPull = true;
        pity = guaranteedGift.coin_value >= highValueThreshold ? 0 : pity + 1;
      }
    }

    for (let i = guaranteedFirstPull ? 1 : 0; i < pullCount; i++) {
      const weights = [...baseWeights];

      // Pity system
      if (pity >= config.pityHardLimit) {
        for (let j = 0; j < allGifts.length; j++) {
          if (allGifts[j].coin_value < highValueThreshold) weights[j] = 0;
        }
        if (weights.every(w => w === 0)) {
          for (let j = 0; j < weights.length; j++) weights[j] = baseWeights[j];
        }
      } else if (pity >= config.pitySoftStart) {
        const progress = (pity - config.pitySoftStart) / (config.pityHardLimit - config.pitySoftStart);
        const shift = config.pitySoftMaxShift * progress;
        let lowTotal = 0, highTotal = 0;
        for (let j = 0; j < allGifts.length; j++) {
          if (allGifts[j].coin_value >= highValueThreshold) highTotal += weights[j];
          else lowTotal += weights[j];
        }
        if (lowTotal > 0 && highTotal > 0) {
          const totalWeight = lowTotal + highTotal;
          const shiftAmount = shift * totalWeight;
          for (let j = 0; j < allGifts.length; j++) {
            if (allGifts[j].coin_value >= highValueThreshold) {
              weights[j] += shiftAmount * (weights[j] / highTotal);
            } else {
              weights[j] -= shiftAmount * (weights[j] / lowTotal);
              if (weights[j] < 0) weights[j] = 0;
            }
          }
        }
      }

      // Luck boost
      const luckBoost = (luck / 100) * 0.05;
      if (luckBoost > 0) {
        const totalWeight = weights.reduce((s, w) => s + w, 0);
        const shiftAmount = luckBoost * totalWeight;
        const minValue = Math.min(...allGifts.map(g => g.coin_value));
        let cheapTotal = 0, expensiveTotal = 0;
        for (let j = 0; j < allGifts.length; j++) {
          if (allGifts[j].coin_value === minValue) cheapTotal += weights[j];
          else expensiveTotal += weights[j];
        }
        if (cheapTotal > shiftAmount && expensiveTotal > 0) {
          for (let j = 0; j < allGifts.length; j++) {
            if (allGifts[j].coin_value === minValue) {
              weights[j] -= shiftAmount * (weights[j] / cheapTotal);
            } else {
              weights[j] += shiftAmount * (weights[j] / expensiveTotal);
            }
          }
        }
      }

      // Roll
      const total = weights.reduce((s, w) => s + w, 0);
      if (total <= 0) { results.push(allGifts[0]); pity++; continue; }

      const roll = Math.random() * total;
      let cumulative = 0, selectedIndex = 0;
      for (let j = 0; j < weights.length; j++) {
        cumulative += weights[j];
        if (roll <= cumulative) { selectedIndex = j; break; }
      }

      const gift = allGifts[selectedIndex];
      results.push(gift);
      pity = gift.coin_value >= highValueThreshold ? 0 : pity + 1;
    }

    if (pullCount === 100) luck = Math.min(100, luck + 2);

    const newBalance = (user.shy_coins || 0) - cost;
    const timestamp = now();

    // Build batch statements
    const stmts = [];

    // Update user
    stmts.push(env.DB.prepare(`
      UPDATE users SET shy_coins = ?, pity_counter = ?, luck_score = ?, guaranteed_next_pull_gift_id = NULL
      WHERE uid = ?
    `).bind(newBalance, pity, luck, uid));

    // Add gifts to backpack
    for (const gift of results) {
      const expiresAt = gift.expires_after_days
        ? timestamp + gift.expires_after_days * 86400000
        : null;
      stmts.push(env.DB.prepare(`
        INSERT INTO backpack_items (user_id, gift_id, quantity, last_acquired, expires_at)
        VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(user_id, gift_id) DO UPDATE SET
          quantity = quantity + 1, last_acquired = ?${expiresAt ? ', expires_at = ?' : ''}
      `).bind(uid, gift.id, timestamp, expiresAt, timestamp,
        ...(expiresAt ? [expiresAt] : [])));
    }

    // Transaction record
    stmts.push(env.DB.prepare(`
      INSERT INTO transactions (id, user_id, type, amount, currency, balance_after, pull_count, details, guaranteed, timestamp)
      VALUES (?, ?, 'GACHA_PULL', ?, 'COINS', ?, ?, ?, ?, ?)
    `).bind(generateId(), uid, -cost, newBalance, pullCount,
      results.map(g => g.name).join(', '),
      guaranteedFirstPull ? 1 : 0, timestamp));

    await env.DB.batch(stmts);

    // Broadcast qualifying wins (outside batch)
    const winThreshold = config.broadcastWinThreshold;
    for (const gift of results) {
      if (gift.coin_value >= winThreshold) {
        const sender = await env.DB.prepare(
          'SELECT display_name, profile_photo_url FROM users WHERE uid = ?'
        ).bind(uid).first();
        await addBroadcast(env, {
          type: 'GACHA_WIN',
          senderName: sender?.display_name || '',
          senderPhotoUrl: sender?.profile_photo_url,
          recipientName: '',
          giftName: gift.name,
          giftIconUrl: gift.icon_url || '',
          giftCoinValue: gift.coin_value,
        });
        break; // one broadcast per pull session
      }
    }

    return json({
      gifts: results.map(g => ({
        giftId: g.id, giftName: g.name,
        coinValue: g.coin_value, iconUrl: g.icon_url || '',
      })),
      coinsSpent: cost, newBalance,
      newPityCounter: pity, newLuckScore: luck,
      currentPullCosts: pullCosts,
    });
  });

  // ── Send gift from backpack ──
  router.post('/api/economy/gift', async (request, env) => {
    const uid = request.auth.uid;
    const body = await parseBody(request);
    const { recipientId, giftId } = body || {};
    const quantity = Math.max(1, Math.min(9999, parseInt(body?.quantity) || 1));

    if (!recipientId || !giftId) return jsonError('recipientId and giftId required', 400);
    if (giftId === 'super_shy_trial') return jsonError('Trial items cannot be transferred', 400);
    if (uid === recipientId) return jsonError('Cannot send gift to yourself', 400);

    const [gift, bpItem, sender, recipient] = await Promise.all([
      env.DB.prepare('SELECT * FROM gifts WHERE id = ?').bind(giftId).first(),
      env.DB.prepare('SELECT quantity FROM backpack_items WHERE user_id = ? AND gift_id = ?').bind(uid, giftId).first(),
      env.DB.prepare('SELECT shy_coins, display_name, current_room_id FROM users WHERE uid = ?').bind(uid).first(),
      env.DB.prepare('SELECT shy_beans, display_name FROM users WHERE uid = ?').bind(recipientId).first(),
    ]);

    if (!gift) return jsonError('Gift not found', 404);
    if (!bpItem || bpItem.quantity < quantity) return jsonError('Insufficient items in backpack', 402);
    if (!recipient) return jsonError('Recipient not found', 404);

    const config = await loadEconomyConfig(env);
    const beanReward = Math.floor(gift.coin_value * config.beanConversionRate * quantity);
    const timestamp = now();

    const stmts = [];

    // Decrement backpack
    const newQty = bpItem.quantity - quantity;
    if (newQty <= 0) {
      stmts.push(env.DB.prepare('DELETE FROM backpack_items WHERE user_id = ? AND gift_id = ?').bind(uid, giftId));
    } else {
      stmts.push(env.DB.prepare('UPDATE backpack_items SET quantity = ? WHERE user_id = ? AND gift_id = ?').bind(newQty, uid, giftId));
    }

    // Update recipient gift wall
    stmts.push(env.DB.prepare(`
      INSERT INTO gift_wall (user_id, gift_id, received_count) VALUES (?, ?, ?)
      ON CONFLICT(user_id, gift_id) DO UPDATE SET received_count = received_count + ?
    `).bind(recipientId, giftId, quantity, quantity));

    stmts.push(env.DB.prepare(`
      INSERT INTO gift_wall_senders (user_id, gift_id, sender_id, send_count) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, gift_id, sender_id) DO UPDATE SET send_count = send_count + ?
    `).bind(recipientId, giftId, uid, quantity, quantity));

    // Credit beans
    stmts.push(env.DB.prepare('UPDATE users SET shy_beans = shy_beans + ? WHERE uid = ?').bind(beanReward, recipientId));

    // Room message if in room
    if (sender?.current_room_id) {
      const sName = sender.display_name || 'Someone';
      const rName = recipient.display_name || 'Someone';
      const qtyLabel = quantity > 1 ? `${quantity}x ` : '';
      const msgId = generateId();
      stmts.push(env.DB.prepare(`
        INSERT INTO room_messages (id, room_id, sender_id, sender_name, text, type, gift_id, gift_icon_url, created_at)
        VALUES (?, ?, ?, ?, ?, 'GIFT', ?, ?, ?)
      `).bind(msgId, sender.current_room_id, uid, sName,
        `${sName} sent ${qtyLabel}${gift.name} to ${rName}`, giftId, gift.icon_url || '', timestamp));

      // Update last gift event
      stmts.push(env.DB.prepare(`
        INSERT INTO room_last_gift_event (room_id, sender_id, sender_name, recipient_id, recipient_name,
          gift_id, gift_name, coin_value, quantity, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(room_id) DO UPDATE SET
          sender_id = ?, sender_name = ?, recipient_id = ?, recipient_name = ?,
          gift_id = ?, gift_name = ?, coin_value = ?, quantity = ?, timestamp = ?
      `).bind(
        sender.current_room_id, uid, sender.display_name || 'Someone', recipientId, recipient.display_name || 'Someone',
        giftId, gift.name, gift.coin_value, quantity, timestamp,
        uid, sender.display_name || 'Someone', recipientId, recipient.display_name || 'Someone',
        giftId, gift.name, gift.coin_value, quantity, timestamp
      ));
    }

    // Transaction records
    stmts.push(env.DB.prepare(`
      INSERT INTO transactions (id, user_id, type, amount, currency, balance_after, gift_id, gift_name, recipient_id, quantity, timestamp)
      VALUES (?, ?, 'GIFT_SENT', ?, 'COINS', ?, ?, ?, ?, ?, ?)
    `).bind(generateId(), uid, -quantity, sender?.shy_coins || 0, giftId, gift.name, recipientId, quantity, timestamp));

    stmts.push(env.DB.prepare(`
      INSERT INTO transactions (id, user_id, type, amount, currency, balance_after, gift_id, gift_name, sender_id, quantity, timestamp)
      VALUES (?, ?, 'GIFT_RECEIVED', ?, 'BEANS', ?, ?, ?, ?, ?, ?)
    `).bind(generateId(), recipientId, beanReward, (recipient.shy_beans || 0) + beanReward,
      giftId, gift.name, uid, quantity, timestamp));

    await env.DB.batch(stmts);

    // Broadcast
    if (gift.coin_value >= config.broadcastSendThreshold) {
      await addBroadcast(env, {
        type: 'GIFT_SEND', senderName: sender?.display_name || '',
        senderPhotoUrl: null, recipientName: recipient.display_name || '',
        giftName: gift.name, giftIconUrl: gift.icon_url || '',
        giftCoinValue: gift.coin_value, quantity,
      });
    }

    return json({ success: true, beanReward, giftName: gift.name, quantity });
  });

  // ── Send gift directly (buy + send) ──
  router.post('/api/economy/gift-direct', async (request, env) => {
    const uid = request.auth.uid;
    const body = await parseBody(request);
    const { recipientId, giftId } = body || {};
    const quantity = Math.max(1, Math.min(9999, parseInt(body?.quantity) || 1));

    if (!recipientId || !giftId) return jsonError('recipientId and giftId required', 400);
    if (uid === recipientId) return jsonError('Cannot send gift to yourself', 400);

    const [gift, sender, recipient] = await Promise.all([
      env.DB.prepare('SELECT * FROM gifts WHERE id = ?').bind(giftId).first(),
      env.DB.prepare('SELECT shy_coins, display_name, current_room_id FROM users WHERE uid = ?').bind(uid).first(),
      env.DB.prepare('SELECT shy_beans, display_name FROM users WHERE uid = ?').bind(recipientId).first(),
    ]);

    if (!gift) return jsonError('Gift not found', 404);
    if (!recipient) return jsonError('Recipient not found', 404);

    const totalCost = gift.coin_value * quantity;
    if ((sender?.shy_coins || 0) < totalCost) return jsonError('Insufficient coins', 402);

    const config = await loadEconomyConfig(env);
    const beanReward = Math.floor(gift.coin_value * config.beanConversionRate * quantity);
    const newSenderCoins = (sender.shy_coins || 0) - totalCost;
    const timestamp = now();

    const stmts = [];

    // Deduct coins
    stmts.push(env.DB.prepare('UPDATE users SET shy_coins = ? WHERE uid = ?').bind(newSenderCoins, uid));

    // Gift wall
    stmts.push(env.DB.prepare(`
      INSERT INTO gift_wall (user_id, gift_id, received_count) VALUES (?, ?, ?)
      ON CONFLICT(user_id, gift_id) DO UPDATE SET received_count = received_count + ?
    `).bind(recipientId, giftId, quantity, quantity));

    stmts.push(env.DB.prepare(`
      INSERT INTO gift_wall_senders (user_id, gift_id, sender_id, send_count) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, gift_id, sender_id) DO UPDATE SET send_count = send_count + ?
    `).bind(recipientId, giftId, uid, quantity, quantity));

    // Beans
    stmts.push(env.DB.prepare('UPDATE users SET shy_beans = shy_beans + ? WHERE uid = ?').bind(beanReward, recipientId));

    // Room message
    if (sender?.current_room_id) {
      const sName = sender.display_name || 'Someone';
      const rName = recipient.display_name || 'Someone';
      const qtyLabel = quantity > 1 ? `${quantity}x ` : '';
      stmts.push(env.DB.prepare(`
        INSERT INTO room_messages (id, room_id, sender_id, sender_name, text, type, gift_id, gift_icon_url, created_at)
        VALUES (?, ?, ?, ?, ?, 'GIFT', ?, ?, ?)
      `).bind(generateId(), sender.current_room_id, uid, sName,
        `${sName} sent ${qtyLabel}${gift.name} to ${rName}`, giftId, gift.icon_url || '', timestamp));
    }

    // Transactions
    stmts.push(env.DB.prepare(`
      INSERT INTO transactions (id, user_id, type, amount, currency, balance_after, gift_id, gift_name, recipient_id, quantity, details, timestamp)
      VALUES (?, ?, 'GIFT_SENT', ?, 'COINS', ?, ?, ?, ?, ?, ?, ?)
    `).bind(generateId(), uid, -totalCost, newSenderCoins, giftId, gift.name, recipientId, quantity,
      `Sent ${quantity > 1 ? quantity + 'x ' : ''}${gift.name} directly (${totalCost} coins)`, timestamp));

    stmts.push(env.DB.prepare(`
      INSERT INTO transactions (id, user_id, type, amount, currency, balance_after, gift_id, gift_name, sender_id, quantity, timestamp)
      VALUES (?, ?, 'GIFT_RECEIVED', ?, 'BEANS', ?, ?, ?, ?, ?, ?)
    `).bind(generateId(), recipientId, beanReward, (recipient.shy_beans || 0) + beanReward,
      giftId, gift.name, uid, quantity, timestamp));

    await env.DB.batch(stmts);

    if (gift.coin_value >= config.broadcastSendThreshold) {
      await addBroadcast(env, {
        type: 'GIFT_SEND', senderName: sender?.display_name || '',
        recipientName: recipient.display_name || '',
        giftName: gift.name, giftIconUrl: gift.icon_url || '',
        giftCoinValue: gift.coin_value, quantity,
      });
    }

    return json({ success: true, beanReward, giftName: gift.name, coinsSpent: totalCost, quantity });
  });

  // ── Redeem beans ──
  router.post('/api/economy/redeem-beans', async (request, env) => {
    const uid = request.auth.uid;
    const body = await parseBody(request);
    const amount = body?.amount;

    if (!amount || typeof amount !== 'number' || amount < 1) {
      return jsonError('amount must be a positive number', 400);
    }

    const user = await env.DB.prepare('SELECT shy_beans, shy_coins FROM users WHERE uid = ?').bind(uid).first();
    if (!user) return jsonError('User not found', 404);
    if ((user.shy_beans || 0) < amount) return jsonError('Insufficient beans', 402);

    const config = await loadEconomyConfig(env);
    const hasBonus = amount >= config.beanRedeemBonusThreshold;
    const coins = hasBonus ? Math.floor(amount * config.beanRedeemBonusMultiplier) : amount;
    const newBeans = (user.shy_beans || 0) - amount;
    const newCoins = (user.shy_coins || 0) + coins;

    const bonusPct = Math.round((config.beanRedeemBonusMultiplier - 1) * 100);

    await env.DB.batch([
      env.DB.prepare('UPDATE users SET shy_beans = ?, shy_coins = ? WHERE uid = ?')
        .bind(newBeans, newCoins, uid),
      env.DB.prepare(`
        INSERT INTO transactions (id, user_id, type, amount, currency, balance_after, details, timestamp)
        VALUES (?, ?, 'BEAN_REDEEM', ?, 'COINS', ?, ?, ?)
      `).bind(generateId(), uid, coins, newCoins,
        `Redeemed ${amount} beans${hasBonus ? ` (${bonusPct}% bonus)` : ''}`, now()),
    ]);

    return json({ coinsReceived: coins, newCoinBalance: newCoins, newBeanBalance: newBeans });
  });

  // ── Validate purchase ──
  router.post('/api/economy/purchase', async (request, env) => {
    const uid = request.auth.uid;
    const body = await parseBody(request);
    const { productId, purchaseToken, isSubscription } = body || {};

    if (!productId || !purchaseToken) return jsonError('productId and purchaseToken required', 400);

    const timestamp = now();

    if (isSubscription) {
      const tierMap = {
        super_shy_monthly: { tier: 'monthly', days: 30 },
        super_shy_yearly: { tier: 'yearly', days: 365 },
        super_shy_lifetime: { tier: 'lifetime', days: null },
      };

      const sub = tierMap[productId];
      if (!sub) return jsonError('Unknown subscription product', 400);

      const expiry = sub.days ? timestamp + sub.days * 86400000 : null;

      await env.DB.batch([
        env.DB.prepare(`
          UPDATE users SET is_super_shy = 1, super_shy_expiry = ?, super_shy_tier = ? WHERE uid = ?
        `).bind(expiry, sub.tier, uid),
        env.DB.prepare(`
          INSERT INTO transactions (id, user_id, type, amount, currency, balance_after, details, timestamp)
          VALUES (?, ?, 'SUBSCRIPTION', 0, 'COINS', 0, ?, ?)
        `).bind(generateId(), uid, `Super Shy ${sub.tier}`, timestamp),
      ]);

      return json({ success: true, tier: sub.tier });
    }

    // Coin package
    const pkg = await env.DB.prepare(
      'SELECT * FROM coin_packages WHERE product_id = ? LIMIT 1'
    ).bind(productId).first();

    if (!pkg) return jsonError('Unknown coin package', 404);

    const totalCoins = (pkg.coins || 0) + (pkg.bonus_coins || 0);

    const user = await env.DB.prepare('SELECT shy_coins FROM users WHERE uid = ?').bind(uid).first();
    if (!user) return jsonError('User not found', 404);

    const newBalance = (user.shy_coins || 0) + totalCoins;

    await env.DB.batch([
      env.DB.prepare('UPDATE users SET shy_coins = ? WHERE uid = ?').bind(newBalance, uid),
      env.DB.prepare(`
        INSERT INTO transactions (id, user_id, type, amount, currency, balance_after, details, timestamp)
        VALUES (?, ?, 'PURCHASE', ?, 'COINS', ?, ?, ?)
      `).bind(generateId(), uid, totalCoins, newBalance,
        `${pkg.coins} + ${pkg.bonus_coins} bonus coins`, timestamp),
    ]);

    return json({ success: true, coinsAdded: totalCoins, newBalance });
  });

  // ── Super Shy trial ──
  router.post('/api/economy/trial-claim', async (request, env) => {
    const uid = request.auth.uid;

    const user = await env.DB.prepare(
      'SELECT has_claimed_super_shy_trial, shy_coins FROM users WHERE uid = ?'
    ).bind(uid).first();

    if (!user) return jsonError('User not found', 404);
    if (user.has_claimed_super_shy_trial) return jsonError('Trial already claimed', 409);

    await env.DB.batch([
      env.DB.prepare('UPDATE users SET has_claimed_super_shy_trial = 1 WHERE uid = ?').bind(uid),
      env.DB.prepare(`
        INSERT INTO backpack_items (user_id, gift_id, quantity) VALUES (?, 'super_shy_trial', 1)
        ON CONFLICT(user_id, gift_id) DO UPDATE SET quantity = 1
      `).bind(uid),
      env.DB.prepare(`
        INSERT INTO transactions (id, user_id, type, amount, currency, balance_after, details, timestamp)
        VALUES (?, ?, 'TRIAL_CLAIM', 0, 'COINS', ?, 'Claimed 30 days of Super Shy', ?)
      `).bind(generateId(), uid, user.shy_coins || 0, now()),
    ]);

    return json({ success: true });
  });

  router.post('/api/economy/trial-activate', async (request, env) => {
    const uid = request.auth.uid;

    const [user, bpItem] = await Promise.all([
      env.DB.prepare('SELECT shy_coins, is_super_shy, super_shy_expiry, super_shy_tier FROM users WHERE uid = ?').bind(uid).first(),
      env.DB.prepare("SELECT quantity FROM backpack_items WHERE user_id = ? AND gift_id = 'super_shy_trial'").bind(uid).first(),
    ]);

    if (!user) return jsonError('User not found', 404);
    if (!bpItem || bpItem.quantity < 1) return jsonError('No trial item in backpack', 402);

    const timestamp = now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const currentExpiry = user.super_shy_expiry || 0;
    const baseTime = Math.max(currentExpiry, timestamp);
    const newExpiry = baseTime + thirtyDays;
    const currentTier = user.super_shy_tier;
    const newTier = (currentTier && currentTier !== 'trial') ? currentTier : 'trial';

    await env.DB.batch([
      env.DB.prepare("DELETE FROM backpack_items WHERE user_id = ? AND gift_id = 'super_shy_trial'").bind(uid),
      env.DB.prepare(`
        UPDATE users SET is_super_shy = 1, super_shy_expiry = ?, super_shy_tier = ? WHERE uid = ?
      `).bind(newExpiry, newTier, uid),
      env.DB.prepare(`
        INSERT INTO transactions (id, user_id, type, amount, currency, balance_after, details, timestamp)
        VALUES (?, ?, 'TRIAL_ACTIVATE', 0, 'COINS', ?, 'Activated 30 days of Super Shy', ?)
      `).bind(generateId(), uid, user.shy_coins || 0, timestamp),
    ]);

    return json({ success: true, newTier, newExpiry });
  });

  // ── Test coins (dev) ──
  router.post('/api/economy/test-coins', async (request, env) => {
    const uid = request.auth.uid;
    const body = await parseBody(request);
    const amount = body?.amount;

    if (!amount || typeof amount !== 'number' || amount <= 0 || amount > 100000) {
      return jsonError('amount must be 1-100000', 400);
    }

    const user = await env.DB.prepare('SELECT shy_coins FROM users WHERE uid = ?').bind(uid).first();
    if (!user) return jsonError('User not found', 404);

    const newBalance = (user.shy_coins || 0) + amount;

    await env.DB.batch([
      env.DB.prepare('UPDATE users SET shy_coins = ? WHERE uid = ?').bind(newBalance, uid),
      env.DB.prepare(`
        INSERT INTO transactions (id, user_id, type, amount, currency, balance_after, details, timestamp)
        VALUES (?, ?, 'PURCHASE', ?, 'COINS', ?, ?, ?)
      `).bind(generateId(), uid, amount, newBalance, `Test purchase (+${amount} coins)`, now()),
    ]);

    return json({ success: true, coinsAdded: amount, newBalance });
  });

  // ── Send gifts to multiple recipients (batch) ──
  router.post('/api/economy/gift-batch', async (request, env) => {
    const uid = request.auth.uid;
    const body = await parseBody(request);
    const { recipientIds, giftId, fromBackpack } = body || {};
    const quantity = Math.max(1, Math.min(9999, parseInt(body?.quantity) || 1));

    if (!recipientIds || !Array.isArray(recipientIds) || recipientIds.length === 0 || !giftId) {
      return jsonError('recipientIds array and giftId required', 400);
    }
    if (giftId === 'super_shy_trial') return jsonError('Trial items cannot be transferred', 400);
    if (recipientIds.includes(uid)) return jsonError('Cannot send gift to yourself', 400);
    if (recipientIds.length > 50) return jsonError('Max 50 recipients', 400);

    const gift = await env.DB.prepare('SELECT * FROM gifts WHERE id = ?').bind(giftId).first();
    if (!gift) return jsonError('Gift not found', 404);

    const sender = await env.DB.prepare(
      'SELECT shy_coins, display_name, current_room_id FROM users WHERE uid = ?'
    ).bind(uid).first();
    if (!sender) return jsonError('Sender not found', 404);

    const totalQty = quantity * recipientIds.length;

    if (fromBackpack) {
      const bpItem = await env.DB.prepare(
        'SELECT quantity FROM backpack_items WHERE user_id = ? AND gift_id = ?'
      ).bind(uid, giftId).first();
      if (!bpItem || bpItem.quantity < totalQty) return jsonError('Insufficient items in backpack', 402);
    } else {
      const totalCost = gift.coin_value * totalQty;
      if ((sender.shy_coins || 0) < totalCost) return jsonError('Insufficient coins', 402);
    }

    const config = await loadEconomyConfig(env);
    const timestamp = now();
    const stmts = [];

    if (fromBackpack) {
      // Decrement backpack
      const bpItem = await env.DB.prepare(
        'SELECT quantity FROM backpack_items WHERE user_id = ? AND gift_id = ?'
      ).bind(uid, giftId).first();
      const newQty = (bpItem?.quantity || 0) - totalQty;
      if (newQty <= 0) {
        stmts.push(env.DB.prepare('DELETE FROM backpack_items WHERE user_id = ? AND gift_id = ?').bind(uid, giftId));
      } else {
        stmts.push(env.DB.prepare('UPDATE backpack_items SET quantity = ? WHERE user_id = ? AND gift_id = ?').bind(newQty, uid, giftId));
      }
    } else {
      const totalCost = gift.coin_value * totalQty;
      const newBalance = (sender.shy_coins || 0) - totalCost;
      stmts.push(env.DB.prepare('UPDATE users SET shy_coins = ? WHERE uid = ?').bind(newBalance, uid));
    }

    // For each recipient: gift wall + beans
    const placeholders = recipientIds.map(() => '?').join(',');
    const { results: recipients } = await env.DB.prepare(
      `SELECT uid, shy_beans, display_name FROM users WHERE uid IN (${placeholders})`
    ).bind(...recipientIds).all();

    const recipientMap = {};
    for (const r of recipients) recipientMap[r.uid] = r;

    for (const recipientId of recipientIds) {
      const recipient = recipientMap[recipientId];
      if (!recipient) continue;

      const beanReward = Math.floor(gift.coin_value * config.beanConversionRate * quantity);

      stmts.push(env.DB.prepare(`
        INSERT INTO gift_wall (user_id, gift_id, received_count) VALUES (?, ?, ?)
        ON CONFLICT(user_id, gift_id) DO UPDATE SET received_count = received_count + ?
      `).bind(recipientId, giftId, quantity, quantity));

      stmts.push(env.DB.prepare(`
        INSERT INTO gift_wall_senders (user_id, gift_id, sender_id, send_count) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, gift_id, sender_id) DO UPDATE SET send_count = send_count + ?
      `).bind(recipientId, giftId, uid, quantity, quantity));

      stmts.push(env.DB.prepare('UPDATE users SET shy_beans = shy_beans + ? WHERE uid = ?').bind(beanReward, recipientId));

      stmts.push(env.DB.prepare(`
        INSERT INTO transactions (id, user_id, type, amount, currency, balance_after, gift_id, gift_name, sender_id, quantity, timestamp)
        VALUES (?, ?, 'GIFT_RECEIVED', ?, 'BEANS', ?, ?, ?, ?, ?, ?)
      `).bind(generateId(), recipientId, beanReward, (recipient.shy_beans || 0) + beanReward,
        giftId, gift.name, uid, quantity, timestamp));
    }

    // Sender transaction
    const source = fromBackpack ? 'backpack' : 'direct';
    stmts.push(env.DB.prepare(`
      INSERT INTO transactions (id, user_id, type, amount, currency, balance_after, gift_id, gift_name, quantity,
        total_recipients, details, timestamp)
      VALUES (?, ?, 'GIFT_SENT', ?, 'COINS', ?, ?, ?, ?, ?, ?, ?)
    `).bind(generateId(), uid,
      fromBackpack ? 0 : -(gift.coin_value * totalQty),
      sender.shy_coins || 0, giftId, gift.name, quantity,
      recipientIds.length,
      `Batch ${source}: ${totalQty}x ${gift.name} to ${recipientIds.length} users`,
      timestamp));

    // Room message
    if (sender.current_room_id) {
      stmts.push(env.DB.prepare(`
        INSERT INTO room_messages (id, room_id, sender_id, sender_name, text, type, gift_id, gift_icon_url, created_at)
        VALUES (?, ?, ?, ?, ?, 'GIFT', ?, ?, ?)
      `).bind(generateId(), sender.current_room_id, uid, sender.display_name || 'Someone',
        `${sender.display_name || 'Someone'} sent ${totalQty}x ${gift.name} to ${recipientIds.length} people`,
        giftId, gift.icon_url || '', timestamp));
    }

    await env.DB.batch(stmts);

    // Broadcast
    if (gift.coin_value >= config.broadcastSendThreshold) {
      await addBroadcast(env, {
        type: 'GIFT_SEND', senderName: sender.display_name || '',
        recipientName: `${recipientIds.length} people`,
        giftName: gift.name, giftIconUrl: gift.icon_url || '',
        giftCoinValue: gift.coin_value, quantity: totalQty,
      });
    }

    return json({ success: true, giftName: gift.name, totalSent: totalQty, recipientCount: recipientIds.length });
  });

  // ── Send entire backpack ──
  router.post('/api/economy/backpack-send', async (request, env) => {
    const uid = request.auth.uid;
    const body = await parseBody(request);
    const { recipientId } = body || {};

    if (!recipientId) return jsonError('recipientId required', 400);
    if (uid === recipientId) return jsonError('Cannot send to yourself', 400);

    const [sender, recipient] = await Promise.all([
      env.DB.prepare('SELECT shy_coins, display_name, current_room_id FROM users WHERE uid = ?').bind(uid).first(),
      env.DB.prepare('SELECT shy_beans, display_name FROM users WHERE uid = ?').bind(recipientId).first(),
    ]);
    if (!sender) return jsonError('Sender not found', 404);
    if (!recipient) return jsonError('Recipient not found', 404);

    const { results: backpackItems } = await env.DB.prepare(
      "SELECT bi.*, g.name, g.coin_value, g.icon_url FROM backpack_items bi JOIN gifts g ON g.id = bi.gift_id WHERE bi.user_id = ? AND bi.gift_id != 'super_shy_trial' AND bi.quantity > 0"
    ).bind(uid).all();

    if (backpackItems.length === 0) return jsonError('Backpack is empty', 400);

    const config = await loadEconomyConfig(env);
    const timestamp = now();
    const stmts = [];
    let totalItemsSent = 0;
    let totalBeanReward = 0;

    for (const item of backpackItems) {
      totalItemsSent += item.quantity;
      const beanReward = Math.floor(item.coin_value * config.beanConversionRate * item.quantity);
      totalBeanReward += beanReward;

      // Gift wall
      stmts.push(env.DB.prepare(`
        INSERT INTO gift_wall (user_id, gift_id, received_count) VALUES (?, ?, ?)
        ON CONFLICT(user_id, gift_id) DO UPDATE SET received_count = received_count + ?
      `).bind(recipientId, item.gift_id, item.quantity, item.quantity));

      stmts.push(env.DB.prepare(`
        INSERT INTO gift_wall_senders (user_id, gift_id, sender_id, send_count) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, gift_id, sender_id) DO UPDATE SET send_count = send_count + ?
      `).bind(recipientId, item.gift_id, uid, item.quantity, item.quantity));
    }

    // Credit beans
    stmts.push(env.DB.prepare('UPDATE users SET shy_beans = shy_beans + ? WHERE uid = ?').bind(totalBeanReward, recipientId));

    // Clear sender's backpack (except trial items)
    stmts.push(env.DB.prepare(
      "DELETE FROM backpack_items WHERE user_id = ? AND gift_id != 'super_shy_trial'"
    ).bind(uid));

    // Transactions
    stmts.push(env.DB.prepare(`
      INSERT INTO transactions (id, user_id, type, amount, currency, balance_after, total_items_sent, details, timestamp)
      VALUES (?, ?, 'BACKPACK_SENT', 0, 'ITEMS', ?, ?, ?, ?)
    `).bind(generateId(), uid, sender.shy_coins || 0, totalItemsSent,
      `Sent entire backpack (${totalItemsSent} items) to ${recipient.display_name || 'user'}`, timestamp));

    stmts.push(env.DB.prepare(`
      INSERT INTO transactions (id, user_id, type, amount, currency, balance_after, total_items_received, details, timestamp)
      VALUES (?, ?, 'BACKPACK_RECEIVED', ?, 'BEANS', ?, ?, ?, ?)
    `).bind(generateId(), recipientId, totalBeanReward, (recipient.shy_beans || 0) + totalBeanReward,
      totalItemsSent, `Received entire backpack (${totalItemsSent} items) from ${sender.display_name || 'user'}`, timestamp));

    // Room message
    if (sender.current_room_id) {
      stmts.push(env.DB.prepare(`
        INSERT INTO room_messages (id, room_id, sender_id, sender_name, text, type, created_at)
        VALUES (?, ?, ?, ?, ?, 'GIFT', ?)
      `).bind(generateId(), sender.current_room_id, uid, sender.display_name || 'Someone',
        `${sender.display_name || 'Someone'} sent their entire backpack (${totalItemsSent} items) to ${recipient.display_name || 'Someone'}`,
        timestamp));
    }

    await env.DB.batch(stmts);

    return json({ success: true, totalItemsSent, totalBeanReward });
  });

  // ── Balance ──
  router.get('/api/economy/balance', async (request, env) => {
    const uid = request.auth.uid;
    const user = await env.DB.prepare('SELECT shy_coins, shy_beans FROM users WHERE uid = ?').bind(uid).first();
    if (!user) return jsonError('User not found', 404);
    return json({ coins: user.shy_coins || 0, beans: user.shy_beans || 0 });
  });

  // ── Transactions ──
  router.get('/api/economy/transactions', async (request, env) => {
    const uid = request.auth.uid;
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const filterType = url.searchParams.get('type');

    const cols = `id, type, amount, currency, balance_after AS balanceAfter,
      gift_id AS giftId, gift_name AS giftName, recipient_id AS recipientId,
      sender_id AS senderId, pull_count AS pullCount, quantity, details, timestamp`;

    let query = `SELECT ${cols} FROM transactions WHERE user_id = ?`;
    const binds = [uid];

    if (filterType) {
      query += ' AND type = ?';
      binds.push(filterType);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    binds.push(limit);

    const { results } = await env.DB.prepare(query).bind(...binds).all();
    return json(results);
  });

  // ── Backpack ──
  router.get('/api/users/:uid/backpack', async (request, env, params) => {
    const { results } = await env.DB.prepare(
      'SELECT * FROM backpack_items WHERE user_id = ?'
    ).bind(params.uid).all();
    return json(results);
  });

  // ── Gift wall ──
  router.get('/api/users/:uid/gift-wall', async (request, env, params) => {
    const { results } = await env.DB.prepare(
      'SELECT * FROM gift_wall WHERE user_id = ?'
    ).bind(params.uid).all();
    return json(results);
  });

  // ── Gift wall senders ──
  router.get('/api/users/:uid/gift-wall/:giftId/senders', async (request, env, params) => {
    const { results } = await env.DB.prepare(
      'SELECT sender_id, send_count FROM gift_wall_senders WHERE user_id = ? AND gift_id = ? ORDER BY send_count DESC'
    ).bind(params.uid, params.giftId).all();
    return json(results);
  });
}

module.exports = { registerEconomyRoutes };

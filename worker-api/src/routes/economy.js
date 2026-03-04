/**
 * Economy routes — daily rewards, gacha, gift sending, bean redemption, purchases.
 *
 * All operations use Firestore as the sole database.
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
const {
  getDoc, setDoc, updateDoc, deleteDoc,
  queryCollection, batchWrite, batchUpdateOp, batchDeleteOp, batchIncrementOp,
  fieldFilter, orderBy,
} = require('../utils/firestore');

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
  const doc = await getDoc(env, 'config/economy');
  if (doc) {
    const { id: _id, ...config } = doc;
    return { ...DEFAULT_ECONOMY_CONFIG, ...config };
  }
  return { ...DEFAULT_ECONOMY_CONFIG };
}

/**
 * Helper to read a user field with camelCase (new) or snake_case (legacy) fallback.
 */
function userField(user, camel, snake) {
  return user[camel] ?? user[snake] ?? null;
}

/**
 * Add a broadcast entry and trim to last 50.
 */
async function addBroadcast(env, data) {
  const broadcastId = generateId();
  await setDoc(env, `broadcasts/${broadcastId}`, {
    id: broadcastId,
    type: data.type,
    senderName: data.senderName,
    senderPhotoUrl: data.senderPhotoUrl || null,
    recipientName: data.recipientName || '',
    giftName: data.giftName,
    giftIconUrl: data.giftIconUrl || '',
    giftCoinValue: data.giftCoinValue,
    quantity: data.quantity || 1,
    timestamp: now(),
  });

  // Trim old broadcasts (keep last 50) — query oldest beyond 50
  const old = await queryCollection(env, 'broadcasts', {
    orderBy: [orderBy('timestamp', 'DESCENDING')],
    offset: 50,
    limit: 100,
  });
  if (old.length > 0) {
    const deletes = old.map(b => batchDeleteOp(env, `broadcasts/${b.id}`));
    await batchWrite(env, deletes);
  }
}

/**
 * Write a gift to a user's gift wall (upsert receivedCount, update senders).
 */
async function updateGiftWall(env, recipientId, giftId, senderId, quantity) {
  const wallDoc = await getDoc(env, `users/${recipientId}/giftWall/${giftId}`);

  const currentCount = wallDoc?.receivedCount || 0;
  const senders = wallDoc?.senders || [];

  // Update or add sender
  const existingSender = senders.find(s => s.senderId === senderId);
  if (existingSender) {
    existingSender.sendCount = (existingSender.sendCount || 0) + quantity;
    existingSender.lastSentAt = now();
  } else {
    senders.push({ senderId, sendCount: quantity, lastSentAt: now() });
  }

  // Sort senders by count descending, keep top 50
  senders.sort((a, b) => (b.sendCount || 0) - (a.sendCount || 0));
  const trimmedSenders = senders.slice(0, 50);

  await setDoc(env, `users/${recipientId}/giftWall/${giftId}`, {
    giftId,
    receivedCount: currentCount + quantity,
    senders: trimmedSenders,
  });
}

/**
 * Write a transaction record.
 */
async function writeTransaction(env, userId, txId, data) {
  await setDoc(env, `users/${userId}/transactions/${txId}`, {
    id: txId,
    ...data,
    timestamp: data.timestamp || now(),
  });
}

/**
 * Write a room gift message to Firestore.
 */
async function writeRoomGiftMessage(env, roomId, senderId, senderName, text, giftId, giftIconUrl) {
  const msgId = generateId();
  await setDoc(env, `rooms/${roomId}/messages/${msgId}`, {
    id: msgId,
    roomId,
    senderId,
    senderName,
    text,
    type: 'GIFT',
    giftId: giftId || null,
    giftIconUrl: giftIconUrl || '',
    createdAt: now(),
  });
}

function registerEconomyRoutes(router) {

  // ── Daily reward ──
  router.post('/api/economy/daily-reward', async (request, env) => {
    const uid = request.auth.uid;
    const config = await loadEconomyConfig(env);
    const today = todayStr();
    const yesterday = yesterdayStr();

    const user = await getDoc(env, `users/${uid}`);
    if (!user) return jsonError('User not found', 404);

    const shyCoins = userField(user, 'shyCoins', 'shy_coins') || 0;
    const isSuperShy = userField(user, 'isSuperShy', 'is_super_shy') || false;
    const loginStreak = userField(user, 'loginStreak', 'login_streak') || 0;
    const lastLoginDate = userField(user, 'lastLoginDate', 'last_login_date');
    const lastLoginRewardDate = userField(user, 'lastLoginRewardDate', 'last_login_reward_date');

    if (lastLoginRewardDate === today) {
      return jsonError('Already claimed today', 409);
    }

    const newStreak = (lastLoginDate === yesterday) ? loginStreak + 1 : 1;
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
      if (isSuperShy) coinReward = Math.ceil(coinReward * 1.1);
    }

    const newBalance = shyCoins + coinReward;

    // Update user doc
    const userUpdates = {
      loginStreak: newStreak,
      lastLoginDate: today,
      lastLoginRewardDate: today,
    };
    if (coinReward > 0) userUpdates.shyCoins = newBalance;
    await updateDoc(env, `users/${uid}`, userUpdates);

    // Add gift to backpack if gift reward
    if (giftReward) {
      const bpDoc = await getDoc(env, `users/${uid}/backpack/${giftReward.giftId}`);
      const currentQty = bpDoc?.quantity || 0;
      await setDoc(env, `users/${uid}/backpack/${giftReward.giftId}`, {
        giftId: giftReward.giftId,
        quantity: currentQty + giftReward.quantity,
        lastAcquired: now(),
      });
    }

    // Transaction record
    const txId = generateId();
    const details = giftReward
      ? `Day ${newStreak} (milestone) — ${giftReward.quantity}x ${giftReward.giftId}`
      : `Day ${newStreak}${isMilestone ? ' (milestone)' : ''}`;

    await writeTransaction(env, uid, txId, {
      type: 'DAILY_REWARD',
      amount: giftReward ? giftReward.quantity : coinReward,
      currency: giftReward ? 'GIFT' : 'COINS',
      balanceAfter: newBalance,
      details,
    });

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

    const user = await getDoc(env, `users/${uid}`);
    if (!user) return jsonError('User not found', 404);

    const shyCoins = userField(user, 'shyCoins', 'shy_coins') || 0;
    if (shyCoins < cost) return jsonError('Insufficient coins', 402);

    // Load winnable gifts
    const allGifts = await queryCollection(env, 'gifts', {
      where: fieldFilter('showOnWheel', 'EQUAL', true),
      orderBy: [orderBy('order')],
      limit: 16,
    });

    if (allGifts.length === 0) return jsonError('No winnable gifts', 500);

    // Filter to gifts with coinValue > 0
    const winnableGifts = allGifts.filter(g => (g.coinValue || 0) > 0);
    if (winnableGifts.length === 0) return jsonError('No winnable gifts', 500);

    // Compute base weights
    const exponent = config.dropRateExponent;
    const baseWeights = winnableGifts.map(g => 1 / Math.pow(g.coinValue, exponent));

    let pity = userField(user, 'pityCounter', 'pity_counter') || 0;
    let luck = userField(user, 'luckScore', 'luck_score') || 0;
    const highValueThreshold = config.pityHighValueThreshold;
    const results = [];

    // Admin-guaranteed first pull
    let guaranteedFirstPull = false;
    const guaranteedGiftId = userField(user, 'guaranteedNextPullGiftId', 'guaranteed_next_pull_gift_id');
    if (guaranteedGiftId) {
      const guaranteedGift = winnableGifts.find(g => g.id === guaranteedGiftId);
      if (guaranteedGift) {
        results.push(guaranteedGift);
        guaranteedFirstPull = true;
        pity = guaranteedGift.coinValue >= highValueThreshold ? 0 : pity + 1;
      }
    }

    for (let i = guaranteedFirstPull ? 1 : 0; i < pullCount; i++) {
      const weights = [...baseWeights];

      // Pity system
      if (pity >= config.pityHardLimit) {
        for (let j = 0; j < winnableGifts.length; j++) {
          if (winnableGifts[j].coinValue < highValueThreshold) weights[j] = 0;
        }
        if (weights.every(w => w === 0)) {
          for (let j = 0; j < weights.length; j++) weights[j] = baseWeights[j];
        }
      } else if (pity >= config.pitySoftStart) {
        const progress = (pity - config.pitySoftStart) / (config.pityHardLimit - config.pitySoftStart);
        const shift = config.pitySoftMaxShift * progress;
        let lowTotal = 0, highTotal = 0;
        for (let j = 0; j < winnableGifts.length; j++) {
          if (winnableGifts[j].coinValue >= highValueThreshold) highTotal += weights[j];
          else lowTotal += weights[j];
        }
        if (lowTotal > 0 && highTotal > 0) {
          const totalWeight = lowTotal + highTotal;
          const shiftAmount = shift * totalWeight;
          for (let j = 0; j < winnableGifts.length; j++) {
            if (winnableGifts[j].coinValue >= highValueThreshold) {
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
        const minValue = Math.min(...winnableGifts.map(g => g.coinValue));
        let cheapTotal = 0, expensiveTotal = 0;
        for (let j = 0; j < winnableGifts.length; j++) {
          if (winnableGifts[j].coinValue === minValue) cheapTotal += weights[j];
          else expensiveTotal += weights[j];
        }
        if (cheapTotal > shiftAmount && expensiveTotal > 0) {
          for (let j = 0; j < winnableGifts.length; j++) {
            if (winnableGifts[j].coinValue === minValue) {
              weights[j] -= shiftAmount * (weights[j] / cheapTotal);
            } else {
              weights[j] += shiftAmount * (weights[j] / expensiveTotal);
            }
          }
        }
      }

      // Roll
      const total = weights.reduce((s, w) => s + w, 0);
      if (total <= 0) { results.push(winnableGifts[0]); pity++; continue; }

      const roll = Math.random() * total;
      let cumulative = 0, selectedIndex = 0;
      for (let j = 0; j < weights.length; j++) {
        cumulative += weights[j];
        if (roll <= cumulative) { selectedIndex = j; break; }
      }

      const gift = winnableGifts[selectedIndex];
      results.push(gift);
      pity = gift.coinValue >= highValueThreshold ? 0 : pity + 1;
    }

    if (pullCount === 100) luck = Math.min(100, luck + 2);

    const newBalance = shyCoins - cost;
    const timestamp = now();

    // Update user
    await updateDoc(env, `users/${uid}`, {
      shyCoins: newBalance,
      pityCounter: pity,
      luckScore: luck,
      guaranteedNextPullGiftId: null,
    });

    // Add gifts to backpack
    for (const gift of results) {
      const bpDoc = await getDoc(env, `users/${uid}/backpack/${gift.id}`);
      const currentQty = bpDoc?.quantity || 0;
      const expiresAt = gift.expiresAfterDays
        ? timestamp + gift.expiresAfterDays * 86400000
        : bpDoc?.expiresAt || null;
      await setDoc(env, `users/${uid}/backpack/${gift.id}`, {
        giftId: gift.id,
        quantity: currentQty + 1,
        lastAcquired: timestamp,
        expiresAt,
        // Denormalized gift metadata for display
        giftName: gift.name,
        coinValue: gift.coinValue,
        iconUrl: gift.iconUrl || '',
      });
    }

    // Transaction record
    const gachaTxId = generateId();
    await writeTransaction(env, uid, gachaTxId, {
      type: 'GACHA_PULL',
      amount: -cost,
      currency: 'COINS',
      balanceAfter: newBalance,
      pullCount,
      details: results.map(g => g.name).join(', '),
      guaranteed: !!guaranteedFirstPull,
    });

    // Broadcast qualifying wins
    const winThreshold = config.broadcastWinThreshold;
    for (const gift of results) {
      if (gift.coinValue >= winThreshold) {
        await addBroadcast(env, {
          type: 'GACHA_WIN',
          senderName: userField(user, 'displayName', 'display_name') || '',
          senderPhotoUrl: userField(user, 'profilePhotoUrl', 'profile_photo_url'),
          recipientName: '',
          giftName: gift.name,
          giftIconUrl: gift.iconUrl || '',
          giftCoinValue: gift.coinValue,
        });
        break; // one broadcast per pull session
      }
    }

    return json({
      gifts: results.map(g => ({
        giftId: g.id, giftName: g.name,
        coinValue: g.coinValue, iconUrl: g.iconUrl || '',
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
      getDoc(env, `gifts/${giftId}`),
      getDoc(env, `users/${uid}/backpack/${giftId}`),
      getDoc(env, `users/${uid}`),
      getDoc(env, `users/${recipientId}`),
    ]);

    if (!gift) return jsonError('Gift not found', 404);
    if (!bpItem || (bpItem.quantity || 0) < quantity) return jsonError('Insufficient items in backpack', 402);
    if (!recipient) return jsonError('Recipient not found', 404);

    const config = await loadEconomyConfig(env);
    const coinValue = gift.coinValue || gift.coin_value || 0;
    const beanReward = Math.floor(coinValue * config.beanConversionRate * quantity);
    const senderCoins = userField(sender, 'shyCoins', 'shy_coins') || 0;
    const recipientBeans = userField(recipient, 'shyBeans', 'shy_beans') || 0;
    const timestamp = now();

    // Decrement backpack
    const newQty = (bpItem.quantity || 0) - quantity;
    if (newQty <= 0) {
      await deleteDoc(env, `users/${uid}/backpack/${giftId}`);
    } else {
      await updateDoc(env, `users/${uid}/backpack/${giftId}`, { quantity: newQty });
    }

    // Update recipient gift wall
    await updateGiftWall(env, recipientId, giftId, uid, quantity);

    // Credit beans
    await updateDoc(env, `users/${recipientId}`, { shyBeans: recipientBeans + beanReward });

    // Room message if sender is in a room
    const currentRoomId = userField(sender, 'currentRoomId', 'current_room_id');
    if (currentRoomId) {
      const sName = userField(sender, 'displayName', 'display_name') || 'Someone';
      const rName = userField(recipient, 'displayName', 'display_name') || 'Someone';
      const qtyLabel = quantity > 1 ? `${quantity}x ` : '';
      await writeRoomGiftMessage(env, currentRoomId, uid, sName,
        `${sName} sent ${qtyLabel}${gift.name} to ${rName}`, giftId, gift.iconUrl || gift.icon_url || '');

      // Update last gift event on room doc
      await updateDoc(env, `rooms/${currentRoomId}`, {
        lastGiftEvent: {
          senderId: uid, senderName: sName,
          recipientId, recipientName: rName,
          giftId, giftName: gift.name,
          coinValue, quantity, timestamp,
        },
      });
    }

    // Transaction records
    const giftSentTxId = generateId();
    const giftReceivedTxId = generateId();

    await Promise.all([
      writeTransaction(env, uid, giftSentTxId, {
        type: 'GIFT_SENT', amount: -quantity, currency: 'COINS',
        balanceAfter: senderCoins, giftId, giftName: gift.name,
        recipientId, quantity, timestamp,
      }),
      writeTransaction(env, recipientId, giftReceivedTxId, {
        type: 'GIFT_RECEIVED', amount: beanReward, currency: 'BEANS',
        balanceAfter: recipientBeans + beanReward, giftId, giftName: gift.name,
        senderId: uid, quantity, timestamp,
      }),
    ]);

    // Broadcast
    if (coinValue >= config.broadcastSendThreshold) {
      await addBroadcast(env, {
        type: 'GIFT_SEND',
        senderName: userField(sender, 'displayName', 'display_name') || '',
        senderPhotoUrl: null,
        recipientName: userField(recipient, 'displayName', 'display_name') || '',
        giftName: gift.name, giftIconUrl: gift.iconUrl || gift.icon_url || '',
        giftCoinValue: coinValue, quantity,
      });
    }

    // Update gift rankings incrementally
    await updateGiftRankings(env, recipientId, giftId, quantity);

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
      getDoc(env, `gifts/${giftId}`),
      getDoc(env, `users/${uid}`),
      getDoc(env, `users/${recipientId}`),
    ]);

    if (!gift) return jsonError('Gift not found', 404);
    if (!recipient) return jsonError('Recipient not found', 404);

    const coinValue = gift.coinValue || gift.coin_value || 0;
    const totalCost = coinValue * quantity;
    const senderCoins = userField(sender, 'shyCoins', 'shy_coins') || 0;
    if (senderCoins < totalCost) return jsonError('Insufficient coins', 402);

    const config = await loadEconomyConfig(env);
    const beanReward = Math.floor(coinValue * config.beanConversionRate * quantity);
    const newSenderCoins = senderCoins - totalCost;
    const recipientBeans = userField(recipient, 'shyBeans', 'shy_beans') || 0;
    const timestamp = now();

    // Deduct coins
    await updateDoc(env, `users/${uid}`, { shyCoins: newSenderCoins });

    // Gift wall
    await updateGiftWall(env, recipientId, giftId, uid, quantity);

    // Beans
    await updateDoc(env, `users/${recipientId}`, { shyBeans: recipientBeans + beanReward });

    // Room message
    const currentRoomId = userField(sender, 'currentRoomId', 'current_room_id');
    if (currentRoomId) {
      const sName = userField(sender, 'displayName', 'display_name') || 'Someone';
      const rName = userField(recipient, 'displayName', 'display_name') || 'Someone';
      const qtyLabel = quantity > 1 ? `${quantity}x ` : '';
      await writeRoomGiftMessage(env, currentRoomId, uid, sName,
        `${sName} sent ${qtyLabel}${gift.name} to ${rName}`, giftId, gift.iconUrl || '');
    }

    // Transactions
    const directSentTxId = generateId();
    const directReceivedTxId = generateId();

    await Promise.all([
      writeTransaction(env, uid, directSentTxId, {
        type: 'GIFT_SENT', amount: -totalCost, currency: 'COINS',
        balanceAfter: newSenderCoins, giftId, giftName: gift.name,
        recipientId, quantity,
        details: `Sent ${quantity > 1 ? quantity + 'x ' : ''}${gift.name} directly (${totalCost} coins)`,
        timestamp,
      }),
      writeTransaction(env, recipientId, directReceivedTxId, {
        type: 'GIFT_RECEIVED', amount: beanReward, currency: 'BEANS',
        balanceAfter: recipientBeans + beanReward, giftId, giftName: gift.name,
        senderId: uid, quantity, timestamp,
      }),
    ]);

    if (coinValue >= config.broadcastSendThreshold) {
      await addBroadcast(env, {
        type: 'GIFT_SEND',
        senderName: userField(sender, 'displayName', 'display_name') || '',
        recipientName: userField(recipient, 'displayName', 'display_name') || '',
        giftName: gift.name, giftIconUrl: gift.iconUrl || '',
        giftCoinValue: coinValue, quantity,
      });
    }

    // Update gift rankings incrementally
    await updateGiftRankings(env, recipientId, giftId, quantity);

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

    const user = await getDoc(env, `users/${uid}`);
    if (!user) return jsonError('User not found', 404);

    const shyBeans = userField(user, 'shyBeans', 'shy_beans') || 0;
    const shyCoins = userField(user, 'shyCoins', 'shy_coins') || 0;
    if (shyBeans < amount) return jsonError('Insufficient beans', 402);

    const config = await loadEconomyConfig(env);
    const hasBonus = amount >= config.beanRedeemBonusThreshold;
    const coins = hasBonus ? Math.floor(amount * config.beanRedeemBonusMultiplier) : amount;
    const newBeans = shyBeans - amount;
    const newCoins = shyCoins + coins;

    await updateDoc(env, `users/${uid}`, { shyBeans: newBeans, shyCoins: newCoins });

    const bonusPct = Math.round((config.beanRedeemBonusMultiplier - 1) * 100);
    const redeemTxId = generateId();
    await writeTransaction(env, uid, redeemTxId, {
      type: 'BEAN_REDEEM', amount: coins, currency: 'COINS',
      balanceAfter: newCoins,
      details: `Redeemed ${amount} beans${hasBonus ? ` (${bonusPct}% bonus)` : ''}`,
    });

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

      await updateDoc(env, `users/${uid}`, {
        isSuperShy: true,
        superShyExpiry: expiry,
        superShyTier: sub.tier,
      });

      const subTxId = generateId();
      await writeTransaction(env, uid, subTxId, {
        type: 'SUBSCRIPTION', amount: 0, currency: 'COINS',
        balanceAfter: 0, details: `Super Shy ${sub.tier}`, timestamp,
      });

      return json({ success: true, tier: sub.tier });
    }

    // Coin package
    const packages = await queryCollection(env, 'coinPackages', {
      where: fieldFilter('productId', 'EQUAL', productId),
      limit: 1,
    });
    const pkg = packages[0];
    if (!pkg) return jsonError('Unknown coin package', 404);

    const totalCoins = (pkg.coins || 0) + (pkg.bonusCoins || 0);

    const user = await getDoc(env, `users/${uid}`);
    if (!user) return jsonError('User not found', 404);

    const shyCoins = userField(user, 'shyCoins', 'shy_coins') || 0;
    const newBalance = shyCoins + totalCoins;

    await updateDoc(env, `users/${uid}`, { shyCoins: newBalance });

    const purchaseTxId = generateId();
    await writeTransaction(env, uid, purchaseTxId, {
      type: 'PURCHASE', amount: totalCoins, currency: 'COINS',
      balanceAfter: newBalance,
      details: `${pkg.coins} + ${pkg.bonusCoins || 0} bonus coins`, timestamp,
    });

    return json({ success: true, coinsAdded: totalCoins, newBalance });
  });

  // ── Super Shy trial ──
  router.post('/api/economy/trial-claim', async (request, env) => {
    const uid = request.auth.uid;

    const user = await getDoc(env, `users/${uid}`);
    if (!user) return jsonError('User not found', 404);

    const hasClaimed = userField(user, 'hasClaimedSuperShyTrial', 'has_claimed_super_shy_trial');
    if (hasClaimed) return jsonError('Trial already claimed', 409);

    const shyCoins = userField(user, 'shyCoins', 'shy_coins') || 0;

    await updateDoc(env, `users/${uid}`, { hasClaimedSuperShyTrial: true });

    // Add trial item to backpack
    await setDoc(env, `users/${uid}/backpack/super_shy_trial`, {
      giftId: 'super_shy_trial',
      quantity: 1,
      giftName: 'Super Shy Trial',
    });

    const trialClaimTxId = generateId();
    await writeTransaction(env, uid, trialClaimTxId, {
      type: 'TRIAL_CLAIM', amount: 0, currency: 'COINS',
      balanceAfter: shyCoins, details: 'Claimed 30 days of Super Shy',
    });

    return json({ success: true });
  });

  router.post('/api/economy/trial-activate', async (request, env) => {
    const uid = request.auth.uid;

    const [user, bpItem] = await Promise.all([
      getDoc(env, `users/${uid}`),
      getDoc(env, `users/${uid}/backpack/super_shy_trial`),
    ]);

    if (!user) return jsonError('User not found', 404);
    if (!bpItem || (bpItem.quantity || 0) < 1) return jsonError('No trial item in backpack', 402);

    const timestamp = now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const currentExpiry = userField(user, 'superShyExpiry', 'super_shy_expiry') || 0;
    const baseTime = Math.max(currentExpiry, timestamp);
    const newExpiry = baseTime + thirtyDays;
    const currentTier = userField(user, 'superShyTier', 'super_shy_tier');
    const newTier = (currentTier && currentTier !== 'trial') ? currentTier : 'trial';

    // Remove trial from backpack and activate
    await deleteDoc(env, `users/${uid}/backpack/super_shy_trial`);
    await updateDoc(env, `users/${uid}`, {
      isSuperShy: true,
      superShyExpiry: newExpiry,
      superShyTier: newTier,
    });

    const shyCoins = userField(user, 'shyCoins', 'shy_coins') || 0;
    const trialActivateTxId = generateId();
    await writeTransaction(env, uid, trialActivateTxId, {
      type: 'TRIAL_ACTIVATE', amount: 0, currency: 'COINS',
      balanceAfter: shyCoins, details: 'Activated 30 days of Super Shy', timestamp,
    });

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

    const user = await getDoc(env, `users/${uid}`);
    if (!user) return jsonError('User not found', 404);

    const shyCoins = userField(user, 'shyCoins', 'shy_coins') || 0;
    const newBalance = shyCoins + amount;

    await updateDoc(env, `users/${uid}`, { shyCoins: newBalance });

    const testTxId = generateId();
    await writeTransaction(env, uid, testTxId, {
      type: 'PURCHASE', amount, currency: 'COINS',
      balanceAfter: newBalance, details: `Test purchase (+${amount} coins)`,
    });

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

    const gift = await getDoc(env, `gifts/${giftId}`);
    if (!gift) return jsonError('Gift not found', 404);

    const sender = await getDoc(env, `users/${uid}`);
    if (!sender) return jsonError('Sender not found', 404);

    const coinValue = gift.coinValue || gift.coin_value || 0;
    const totalQty = quantity * recipientIds.length;
    const senderCoins = userField(sender, 'shyCoins', 'shy_coins') || 0;

    if (fromBackpack) {
      const bpItem = await getDoc(env, `users/${uid}/backpack/${giftId}`);
      if (!bpItem || (bpItem.quantity || 0) < totalQty) return jsonError('Insufficient items in backpack', 402);
    } else {
      const totalCost = coinValue * totalQty;
      if (senderCoins < totalCost) return jsonError('Insufficient coins', 402);
    }

    const config = await loadEconomyConfig(env);
    const timestamp = now();

    if (fromBackpack) {
      const bpItem = await getDoc(env, `users/${uid}/backpack/${giftId}`);
      const newQty = (bpItem?.quantity || 0) - totalQty;
      if (newQty <= 0) {
        await deleteDoc(env, `users/${uid}/backpack/${giftId}`);
      } else {
        await updateDoc(env, `users/${uid}/backpack/${giftId}`, { quantity: newQty });
      }
    } else {
      const totalCost = coinValue * totalQty;
      await updateDoc(env, `users/${uid}`, { shyCoins: senderCoins - totalCost });
    }

    // Process each recipient
    for (const recipientId of recipientIds) {
      const recipient = await getDoc(env, `users/${recipientId}`);
      if (!recipient) continue;

      const beanReward = Math.floor(coinValue * config.beanConversionRate * quantity);
      const recipientBeans = userField(recipient, 'shyBeans', 'shy_beans') || 0;

      // Gift wall + beans + transaction
      await updateGiftWall(env, recipientId, giftId, uid, quantity);
      await updateDoc(env, `users/${recipientId}`, { shyBeans: recipientBeans + beanReward });

      const recipientTxId = generateId();
      await writeTransaction(env, recipientId, recipientTxId, {
        type: 'GIFT_RECEIVED', amount: beanReward, currency: 'BEANS',
        balanceAfter: recipientBeans + beanReward, giftId, giftName: gift.name,
        senderId: uid, quantity, timestamp,
      });
    }

    // Sender transaction
    const source = fromBackpack ? 'backpack' : 'direct';
    const batchSenderTxId = generateId();
    await writeTransaction(env, uid, batchSenderTxId, {
      type: 'GIFT_SENT',
      amount: fromBackpack ? 0 : -(coinValue * totalQty),
      currency: 'COINS',
      balanceAfter: senderCoins, giftId, giftName: gift.name, quantity,
      details: `Batch ${source}: ${totalQty}x ${gift.name} to ${recipientIds.length} users`,
      timestamp,
    });

    // Room message
    const currentRoomId = userField(sender, 'currentRoomId', 'current_room_id');
    if (currentRoomId) {
      const sName = userField(sender, 'displayName', 'display_name') || 'Someone';
      await writeRoomGiftMessage(env, currentRoomId, uid, sName,
        `${sName} sent ${totalQty}x ${gift.name} to ${recipientIds.length} people`,
        giftId, gift.iconUrl || '');
    }

    // Broadcast
    if (coinValue >= config.broadcastSendThreshold) {
      await addBroadcast(env, {
        type: 'GIFT_SEND',
        senderName: userField(sender, 'displayName', 'display_name') || '',
        recipientName: `${recipientIds.length} people`,
        giftName: gift.name, giftIconUrl: gift.iconUrl || '',
        giftCoinValue: coinValue, quantity: totalQty,
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
      getDoc(env, `users/${uid}`),
      getDoc(env, `users/${recipientId}`),
    ]);
    if (!sender) return jsonError('Sender not found', 404);
    if (!recipient) return jsonError('Recipient not found', 404);

    // Get backpack items (excluding trial items)
    const backpackItems = await queryCollection(env, `users/${uid}/backpack`, {});
    const sendableItems = backpackItems.filter(
      item => item.giftId !== 'super_shy_trial' && (item.quantity || 0) > 0
    );

    if (sendableItems.length === 0) return jsonError('Backpack is empty', 400);

    // For each backpack item, we need gift metadata. If denormalized on the bp doc, use it.
    // Otherwise, look up the gift.
    const config = await loadEconomyConfig(env);
    const timestamp = now();
    let totalItemsSent = 0;
    let totalBeanReward = 0;

    for (const item of sendableItems) {
      const qty = item.quantity || 0;
      totalItemsSent += qty;

      // Get coin value from backpack doc or gift catalog
      let coinVal = item.coinValue;
      if (coinVal == null) {
        const giftDoc = await getDoc(env, `gifts/${item.giftId}`);
        coinVal = giftDoc?.coinValue || 0;
      }

      const beanReward = Math.floor(coinVal * config.beanConversionRate * qty);
      totalBeanReward += beanReward;

      // Gift wall
      await updateGiftWall(env, recipientId, item.giftId, uid, qty);
    }

    // Credit beans
    const recipientBeans = userField(recipient, 'shyBeans', 'shy_beans') || 0;
    await updateDoc(env, `users/${recipientId}`, { shyBeans: recipientBeans + totalBeanReward });

    // Clear sender's backpack (except trial items)
    const deleteWrites = sendableItems.map(item => batchDeleteOp(env, `users/${uid}/backpack/${item.giftId}`));
    if (deleteWrites.length > 0) await batchWrite(env, deleteWrites);

    // Transactions
    const senderCoins = userField(sender, 'shyCoins', 'shy_coins') || 0;
    const bpSentTxId = generateId();
    const bpReceivedTxId = generateId();
    const senderName = userField(sender, 'displayName', 'display_name') || 'user';
    const recipientName = userField(recipient, 'displayName', 'display_name') || 'user';

    await Promise.all([
      writeTransaction(env, uid, bpSentTxId, {
        type: 'BACKPACK_SENT', amount: 0, currency: 'ITEMS',
        balanceAfter: senderCoins, totalItemsSent,
        details: `Sent entire backpack (${totalItemsSent} items) to ${recipientName}`, timestamp,
      }),
      writeTransaction(env, recipientId, bpReceivedTxId, {
        type: 'BACKPACK_RECEIVED', amount: totalBeanReward, currency: 'BEANS',
        balanceAfter: recipientBeans + totalBeanReward, totalItemsReceived: totalItemsSent,
        details: `Received entire backpack (${totalItemsSent} items) from ${senderName}`, timestamp,
      }),
    ]);

    // Room message
    const currentRoomId = userField(sender, 'currentRoomId', 'current_room_id');
    if (currentRoomId) {
      await writeRoomGiftMessage(env, currentRoomId, uid, senderName,
        `${senderName} sent their entire backpack (${totalItemsSent} items) to ${recipientName}`,
        null, '');
    }

    return json({ success: true, totalItemsSent, totalBeanReward });
  });

  // ── Balance ──
  router.get('/api/economy/balance', async (request, env) => {
    const uid = request.auth.uid;
    const user = await getDoc(env, `users/${uid}`);
    if (!user) return jsonError('User not found', 404);
    return json({
      coins: userField(user, 'shyCoins', 'shy_coins') || 0,
      beans: userField(user, 'shyBeans', 'shy_beans') || 0,
    });
  });

  // ── Transactions ──
  router.get('/api/economy/transactions', async (request, env) => {
    const uid = request.auth.uid;
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const filterType = url.searchParams.get('type');

    const query = {
      orderBy: [orderBy('timestamp', 'DESCENDING')],
      limit,
    };

    if (filterType) {
      query.where = fieldFilter('type', 'EQUAL', filterType);
    }

    const results = await queryCollection(env, `users/${uid}/transactions`, query);
    return json(results);
  });

  // ── Backpack ──
  router.get('/api/users/:uid/backpack', async (request, env, params) => {
    const results = await queryCollection(env, `users/${params.uid}/backpack`, {});
    return json(results);
  });

  // ── Gift wall ──
  router.get('/api/users/:uid/gift-wall', async (request, env, params) => {
    const results = await queryCollection(env, `users/${params.uid}/giftWall`, {});
    return json(results);
  });

  // ── Gift wall senders ──
  router.get('/api/users/:uid/gift-wall/:giftId/senders', async (request, env, params) => {
    const doc = await getDoc(env, `users/${params.uid}/giftWall/${params.giftId}`);
    const senders = doc?.senders || [];
    // Sort by sendCount descending
    senders.sort((a, b) => (b.sendCount || 0) - (a.sendCount || 0));
    return json(senders);
  });
}

/**
 * Incrementally update gift rankings when a gift is sent.
 * Replaces the old hourly cron job with real-time updates.
 */
async function updateGiftRankings(env, recipientId, giftId, quantity) {
  try {
    const rankDoc = await getDoc(env, `giftRankings/${giftId}`) || {};
    const rankings = rankDoc.rankings || [];
    const totalSent = (rankDoc.totalSent || 0) + quantity;

    // Find or add recipient in rankings
    const existing = rankings.find(r => r.userId === recipientId);
    if (existing) {
      existing.count = (existing.count || 0) + quantity;
    } else {
      // Get recipient display info
      const user = await getDoc(env, `users/${recipientId}`);
      rankings.push({
        userId: recipientId,
        count: quantity,
        displayName: userField(user, 'displayName', 'display_name') || '',
        profilePhotoUrl: userField(user, 'profilePhotoUrl', 'profile_photo_url') || '',
      });
    }

    // Sort by count descending, keep top 100
    rankings.sort((a, b) => (b.count || 0) - (a.count || 0));
    const trimmed = rankings.slice(0, 100);

    // Re-assign ranks
    trimmed.forEach((r, i) => { r.rank = i + 1; });

    await setDoc(env, `giftRankings/${giftId}`, {
      rankings: trimmed,
      totalSent,
      lastUpdated: now(),
    });
  } catch (err) {
    console.error('updateGiftRankings error:', err.message);
  }
}

module.exports = { registerEconomyRoutes };

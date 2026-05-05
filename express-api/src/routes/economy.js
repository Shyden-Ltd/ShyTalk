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
 * GET  /api/users/:uniqueId/backpack      → Get user's backpack
 * GET  /api/users/:uniqueId/gift-wall     → Get user's gift wall
 * GET  /api/users/:uniqueId/gift-wall/:giftId/senders → Get gift wall senders
 */

const router = require('express').Router();
const { db, FieldValue } = require('../utils/firebase');
const { generateId, now, todayStr, yesterdayStr } = require('../utils/helpers');
const { requireAdmin } = require('../middleware/auth');
const log = require('../utils/log');
const { verifyProductPurchase, verifySubscription } = require('../utils/playStore');
const { verifyApplePurchase } = require('../utils/appleStore');
const { SUBSCRIPTION_TIERS } = require('../utils/subscriptionTiers');

// ─── Constants ────────────────────────────────────────────────────

const DEFAULT_ECONOMY_CONFIG = {
  beanConversionRate: 0.6,
  beanRedeemBonusThreshold: 2000,
  beanRedeemBonusMultiplier: 1.1,
  pullCosts: { 1: 10, 10: 100, 100: 1000 },
  broadcastSendThreshold: 0,
  broadcastWinThreshold: 5000,
  dropRateExponent: 1.5,
  pitySoftStart: 80,
  pityHardLimit: 120,
  pitySoftMaxShift: 0.15,
  pityHighValueThreshold: 5000,
  dailyBase: 50,
  milestoneRewards: { 7: 100, 14: 200, 30: 500, 60: 1000, 90: 2000 },
};

// ─── Helpers ──────────────────────────────────────────────────────

// In-memory cache for economy config (avoids re-reading Firestore on every request)
let cachedEconomyConfig = null;
let economyConfigCachedAt = 0;
const ECONOMY_CONFIG_TTL = 60_000; // 1 minute

async function loadEconomyConfig() {
  const currentTime = Date.now();
  if (cachedEconomyConfig && currentTime - economyConfigCachedAt < ECONOMY_CONFIG_TTL) {
    return cachedEconomyConfig;
  }

  const snap = await db.doc('config/economy').get();
  if (snap.exists) {
    cachedEconomyConfig = { ...DEFAULT_ECONOMY_CONFIG, ...snap.data() };
  } else {
    // Doc doesn't exist — write defaults so the Android SDK can read it
    await db.doc('config/economy').set(DEFAULT_ECONOMY_CONFIG);
    cachedEconomyConfig = { ...DEFAULT_ECONOMY_CONFIG };
  }
  economyConfigCachedAt = currentTime;
  return cachedEconomyConfig;
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
async function addBroadcast(data) {
  const broadcastId = generateId();
  await db.doc(`broadcasts/${broadcastId}`).set({
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
  const oldSnap = await db
    .collection('broadcasts')
    .orderBy('timestamp', 'desc')
    .offset(50)
    .limit(100)
    .get();
  if (!oldSnap.empty) {
    // Chunk deletes into batches of 500
    const docs = oldSnap.docs;
    for (let i = 0; i < docs.length; i += 500) {
      const batch = db.batch();
      const chunk = docs.slice(i, i + 500);
      for (const doc of chunk) {
        batch.delete(doc.ref);
      }
      await batch.commit();
    }
  }
}

/**
 * Write a gift to a user's gift wall (upsert receivedCount, update senders).
 */
async function updateGiftWall(recipientId, giftId, senderId, quantity) {
  const wallSnap = await db.doc(`users/${recipientId}/giftWall/${giftId}`).get();
  const wallDoc = wallSnap.exists ? wallSnap.data() : null;

  const currentCount = wallDoc?.receivedCount || 0;
  const senders = wallDoc?.senders || [];

  // Update or add sender
  const existingSender = senders.find((s) => s.senderId === senderId);
  if (existingSender) {
    existingSender.sendCount = (existingSender.sendCount || 0) + quantity;
    existingSender.lastSentAt = now();
  } else {
    senders.push({ senderId, sendCount: quantity, lastSentAt: now() });
  }

  // Sort senders by count descending, keep top 50
  senders.sort((a, b) => (b.sendCount || 0) - (a.sendCount || 0));
  const trimmedSenders = senders.slice(0, 50);

  await db.doc(`users/${recipientId}/giftWall/${giftId}`).set({
    giftId,
    receivedCount: currentCount + quantity,
    senders: trimmedSenders,
  });
}

/**
 * Write a transaction record.
 */
async function writeTransaction(userId, txId, data) {
  await db.doc(`users/${userId}/transactions/${txId}`).set({
    id: txId,
    ...data,
    timestamp: data.timestamp || now(),
  });
}

/**
 * Write a room gift message to Firestore.
 */
async function writeRoomGiftMessage(roomId, senderId, senderName, text, giftId, giftIconUrl) {
  const msgId = generateId();
  await db.doc(`rooms/${roomId}/messages/${msgId}`).set({
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

/**
 * Incrementally update gift rankings when a gift is sent.
 * Replaces the old hourly cron job with real-time updates.
 */
async function updateGiftRankings(recipientId, giftId, quantity) {
  try {
    const rankSnap = await db.doc(`giftRankings/${giftId}`).get();
    const rankDoc = rankSnap.exists ? rankSnap.data() : {};
    const rankings = rankDoc.rankings || [];
    const totalSent = (rankDoc.totalSent || 0) + quantity;

    // Find or add recipient in rankings
    const existing = rankings.find((r) => r.userId === recipientId);
    if (existing) {
      existing.count = (existing.count || 0) + quantity;
    } else {
      // Get recipient display info
      const userSnap = await db.doc(`users/${recipientId}`).get();
      const user = userSnap.exists ? userSnap.data() : {};
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
    trimmed.forEach((r, i) => {
      r.rank = i + 1;
    });

    await db.doc(`giftRankings/${giftId}`).set({
      rankings: trimmed,
      totalSent,
      lastUpdated: now(),
    });
  } catch (err) {
    log.error('economy', 'Failed to update gift rankings', { error: err.message });
  }
}

// ─── Shared gift helpers ─────────────────────────────────────────

/** Check block relationship between sender and recipient. Returns error string or null. */
function checkBlockRelationship(sender, recipient, senderId, recipientId) {
  const senderBlocked = (sender?.blockedUserIds || []).map(String);
  const recipientBlocked = (recipient?.blockedUserIds || []).map(String);
  if (senderBlocked.includes(String(recipientId)) || recipientBlocked.includes(String(senderId))) {
    return 'Cannot send gifts to or from blocked users';
  }
  return null;
}

/** Compute daily reward from config and streak. */
function computeDailyReward(config, newStreak, isSuperShy) {
  const milestoneRewards = config.milestoneRewards || {};
  const rawReward = milestoneRewards[String(newStreak)];
  const isMilestone = String(newStreak) in milestoneRewards;

  if (rawReward && typeof rawReward === 'object' && rawReward.type === 'gift') {
    return {
      coinReward: 0,
      giftReward: { giftId: rawReward.giftId, quantity: rawReward.quantity || 1 },
      isMilestone,
    };
  }

  let coinReward;
  if (typeof rawReward === 'number') {
    coinReward = rawReward;
  } else if (rawReward?.amount) {
    coinReward = rawReward.amount;
  } else {
    coinReward = config.dailyBase;
  }
  if (isSuperShy) coinReward = Math.ceil(coinReward * 1.1);

  return { coinReward, giftReward: null, isMilestone };
}

// ─── Routes ───────────────────────────────────────────────────────

// ── Daily reward ──
router.post('/economy/daily-reward', async (req, res) => {
  try {
    const uniqueId = req.auth.uniqueId;
    const config = await loadEconomyConfig();
    const today = todayStr();
    const yesterday = yesterdayStr();

    const userSnap = await db.doc(`users/${uniqueId}`).get();
    if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
    const user = userSnap.data();

    const shyCoins = userField(user, 'shyCoins', 'shy_coins') || 0;
    const isSuperShy = userField(user, 'isSuperShy', 'is_super_shy') || false;
    const loginStreak = userField(user, 'loginStreak', 'login_streak') || 0;
    const lastLoginDate = userField(user, 'lastLoginDate', 'last_login_date');
    const lastLoginRewardDate = userField(user, 'lastLoginRewardDate', 'last_login_reward_date');

    if (lastLoginRewardDate === today) {
      return res.status(409).json({ error: 'Already claimed today' });
    }

    const newStreak = lastLoginDate === yesterday ? loginStreak + 1 : 1;
    const { coinReward, giftReward, isMilestone } = computeDailyReward(
      config,
      newStreak,
      isSuperShy,
    );

    const newBalance = shyCoins + coinReward;

    // Update user doc
    const userUpdates = {
      loginStreak: newStreak,
      lastLoginDate: today,
      lastLoginRewardDate: today,
    };
    if (coinReward > 0) userUpdates.shyCoins = newBalance;
    await db.doc(`users/${uniqueId}`).update(userUpdates);

    // Add gift to backpack if gift reward
    if (giftReward) {
      const bpSnap = await db.doc(`users/${uniqueId}/backpack/${giftReward.giftId}`).get();
      const currentQty = bpSnap.exists ? bpSnap.data().quantity || 0 : 0;
      await db.doc(`users/${uniqueId}/backpack/${giftReward.giftId}`).set({
        giftId: giftReward.giftId,
        quantity: currentQty + giftReward.quantity,
        lastAcquired: now(),
      });
    }

    // Transaction record
    const txId = generateId();
    const milestoneSuffix = isMilestone ? ' (milestone)' : '';
    const details = giftReward
      ? `Day ${newStreak} (milestone) — ${giftReward.quantity}x ${giftReward.giftId}`
      : `Day ${newStreak}${milestoneSuffix}`;

    await writeTransaction(uniqueId, txId, {
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
    log.info('economy', 'Daily reward claimed', {
      userId: uniqueId,
      coinReward,
      streak: newStreak,
    });
    res.json(result);
  } catch (err) {
    log.error('economy', 'POST /economy/daily-reward failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Gacha helpers ───────────────────────────────────────────────

/** Apply hard or soft pity adjustments to weights. Returns true if hard pity was triggered. */
function applyPitySystem(weights, pity, config, winnableGifts, highValueThreshold) {
  if (pity >= config.pityHardLimit) {
    // Hard pity: zero out low-value gifts
    for (let j = 0; j < winnableGifts.length; j++) {
      if (winnableGifts[j].coinValue < highValueThreshold) weights[j] = 0;
    }
    if (weights.every((w) => w === 0)) {
      // Guarantee the most expensive gift
      let bestIdx = 0;
      for (let j = 1; j < winnableGifts.length; j++) {
        if (winnableGifts[j].coinValue > winnableGifts[bestIdx].coinValue) bestIdx = j;
      }
      for (let j = 0; j < weights.length; j++) weights[j] = j === bestIdx ? 1 : 0;
    }
    return true;
  }

  if (pity >= config.pitySoftStart) {
    const progress = (pity - config.pitySoftStart) / (config.pityHardLimit - config.pitySoftStart);
    const shift = config.pitySoftMaxShift * progress;
    let lowTotal = 0,
      highTotal = 0;
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

  return false;
}

/** Apply luck-based weight adjustments (shift weight from cheapest to others). */
function applyLuckBoost(weights, luck, winnableGifts) {
  const luckBoost = (luck / 100) * 0.05;
  if (luckBoost <= 0) return;

  const totalWeight = weights.reduce((s, w) => s + w, 0);
  const shiftAmount = luckBoost * totalWeight;
  const minValue = Math.min(...winnableGifts.map((g) => g.coinValue));
  let cheapTotal = 0,
    expensiveTotal = 0;
  for (let j = 0; j < winnableGifts.length; j++) {
    if (winnableGifts[j].coinValue === minValue) cheapTotal += weights[j];
    else expensiveTotal += weights[j];
  }
  if (cheapTotal <= shiftAmount || expensiveTotal <= 0) return;

  for (let j = 0; j < winnableGifts.length; j++) {
    if (winnableGifts[j].coinValue === minValue) {
      weights[j] -= shiftAmount * (weights[j] / cheapTotal);
    } else {
      weights[j] += shiftAmount * (weights[j] / expensiveTotal);
    }
  }
}

/** Roll a weighted random selection from the gift pool. Returns { gift, fallback }. */
function rollWeightedGift(weights, winnableGifts) {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return { gift: winnableGifts[0], fallback: true };

  const roll = (require('crypto').randomInt(1_000_000) / 1_000_000) * total;
  let cumulative = 0,
    selectedIndex = 0;
  for (let j = 0; j < weights.length; j++) {
    cumulative += weights[j];
    if (roll <= cumulative) {
      selectedIndex = j;
      break;
    }
  }
  return { gift: winnableGifts[selectedIndex], fallback: false };
}

// ── Gacha ──
router.post('/economy/gacha', async (req, res) => {
  try {
    const uniqueId = req.auth.uniqueId;
    const body = req.body;
    const pullCount = body?.pullCount;
    const expectedCost = body?.expectedCost;

    if (![1, 10, 100].includes(pullCount)) {
      return res.status(400).json({ error: 'pullCount must be 1, 10, or 100' });
    }

    const config = await loadEconomyConfig();
    const pullCosts = config.pullCosts || { 1: 10, 10: 100, 100: 1000 };
    const cost = pullCosts[String(pullCount)];
    if (!cost) return res.status(400).json({ error: 'Invalid pull count' });

    // Price validation
    if (expectedCost !== null && expectedCost !== undefined && expectedCost !== cost) {
      return res.json({
        priceChanged: true,
        currentPullCosts: pullCosts,
        gifts: [],
        coinsSpent: 0,
        newBalance: 0,
        newPityCounter: 0,
        newLuckScore: 0,
      });
    }

    const userSnap = await db.doc(`users/${uniqueId}`).get();
    if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
    const user = userSnap.data();

    const shyCoins = userField(user, 'shyCoins', 'shy_coins') || 0;
    if (shyCoins < cost) return res.status(402).json({ error: 'Insufficient coins' });

    // Load winnable gifts
    const giftsSnap = await db
      .collection('gifts')
      .where('showOnWheel', '==', true)
      .orderBy('order')
      .limit(16)
      .get();
    const allGifts = giftsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (allGifts.length === 0) return res.status(500).json({ error: 'No winnable gifts' });

    // Filter to gifts with coinValue > 0
    const winnableGifts = allGifts.filter((g) => (g.coinValue || 0) > 0);
    if (winnableGifts.length === 0) return res.status(500).json({ error: 'No winnable gifts' });

    // Compute base weights
    const exponent = config.dropRateExponent;
    const baseWeights = winnableGifts.map((g) => 1 / Math.pow(g.coinValue, exponent));

    let pity = userField(user, 'pityCounter', 'pity_counter') || 0;
    let luck = userField(user, 'luckScore', 'luck_score') || 0;
    const highValueThreshold = config.pityHighValueThreshold;
    const results = [];

    // Admin-guaranteed first pull
    let guaranteedFirstPull = false;
    const guaranteedGiftId = userField(
      user,
      'guaranteedNextPullGiftId',
      'guaranteed_next_pull_gift_id',
    );
    if (guaranteedGiftId) {
      const guaranteedGift = winnableGifts.find((g) => g.id === guaranteedGiftId);
      if (guaranteedGift) {
        results.push(guaranteedGift);
        guaranteedFirstPull = true;
        pity = guaranteedGift.coinValue >= highValueThreshold ? 0 : pity + 1;
      }
    }

    for (let i = guaranteedFirstPull ? 1 : 0; i < pullCount; i++) {
      const weights = [...baseWeights];
      const hardPityTriggered = applyPitySystem(
        weights,
        pity,
        config,
        winnableGifts,
        highValueThreshold,
      );
      applyLuckBoost(weights, luck, winnableGifts);

      const { gift, fallback } = rollWeightedGift(weights, winnableGifts);
      results.push(gift);

      if (fallback || hardPityTriggered || gift.coinValue >= highValueThreshold) {
        pity = hardPityTriggered || gift.coinValue >= highValueThreshold ? 0 : pity + 1;
      } else {
        pity = pity + 1;
      }
    }

    if (pullCount === 100) luck = Math.min(100, luck + 2);

    const newBalance = shyCoins - cost;
    const timestamp = now();

    // ── Aggregate duplicate gifts so each backpack doc is written once ──
    const giftCounts = {};
    for (const gift of results) {
      giftCounts[gift.id] = (giftCounts[gift.id] || 0) + 1;
    }
    const uniqueGiftIds = Object.keys(giftCounts);

    // Fetch existing backpack docs in parallel
    const existingDocs = await Promise.all(
      uniqueGiftIds.map(async (gid) => {
        const snap = await db.doc(`users/${uniqueId}/backpack/${gid}`).get();
        return snap.exists ? snap.data() : null;
      }),
    );

    // Build batch writes for backpack + user update in one atomic operation
    const batch = db.batch();
    for (let i = 0; i < uniqueGiftIds.length; i++) {
      const gid = uniqueGiftIds[i];
      const gift = results.find((g) => g.id === gid);
      const bpDoc = existingDocs[i];
      const currentQty = bpDoc?.quantity || 0;
      const expiresAt = gift.expiresAfterDays
        ? timestamp + gift.expiresAfterDays * 86400000
        : bpDoc?.expiresAt || null;
      batch.set(
        db.doc(`users/${uniqueId}/backpack/${gid}`),
        {
          giftId: gid,
          quantity: currentQty + giftCounts[gid],
          lastAcquired: timestamp,
          expiresAt,
          giftName: gift.name,
          coinValue: gift.coinValue,
          iconUrl: gift.iconUrl || gift.icon_url || '',
        },
        { merge: true },
      );
    }

    // Include coin deduction in the same batch
    batch.update(db.doc(`users/${uniqueId}`), {
      shyCoins: newBalance,
      pityCounter: pity,
      luckScore: luck,
      guaranteedNextPullGiftId: null,
    });

    // Execute atomically — all or nothing
    await batch.commit();

    // Transaction record (best-effort — coins already deducted)
    try {
      const gachaTxId = generateId();
      await writeTransaction(uniqueId, gachaTxId, {
        type: 'GACHA_PULL',
        amount: -cost,
        currency: 'COINS',
        balanceAfter: newBalance,
        pullCount,
        details: results.map((g) => g.name).join(', '),
        guaranteed: !!guaranteedFirstPull,
      });
    } catch (err) {
      log.error('economy', 'Failed to write gacha transaction', { uniqueId, error: err.message });
    }

    // Broadcast qualifying wins (best-effort)
    try {
      const winThreshold = config.broadcastWinThreshold;
      for (const gift of results) {
        if (gift.coinValue >= winThreshold) {
          await addBroadcast({
            type: 'GACHA_WIN',
            senderName: userField(user, 'displayName', 'display_name') || '',
            senderPhotoUrl: userField(user, 'profilePhotoUrl', 'profile_photo_url'),
            recipientName: '',
            giftName: gift.name,
            giftIconUrl: gift.iconUrl || gift.icon_url || '',
            giftCoinValue: gift.coinValue,
          });
          break; // one broadcast per pull session
        }
      }
    } catch (err) {
      log.error('economy', 'Failed to broadcast gacha win', { uniqueId, error: err.message });
    }

    res.json({
      gifts: results.map((g) => ({
        giftId: g.id,
        giftName: g.name,
        coinValue: g.coinValue,
        iconUrl: g.iconUrl || '',
      })),
      coinsSpent: cost,
      newBalance,
      newPityCounter: pity,
      newLuckScore: luck,
      currentPullCosts: pullCosts,
    });
    log.info('economy', `Gacha pull x${pullCount}`, { userId: uniqueId, cost, newBalance });
  } catch (err) {
    log.error('economy', 'POST /economy/gacha failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Send gift from backpack ──
router.post('/economy/gift', async (req, res) => {
  try {
    const uniqueId = req.auth.uniqueId;
    const body = req.body;
    const { recipientId, giftId } = body || {};
    const quantity = Math.max(1, Math.min(9999, Number.parseInt(body?.quantity, 10) || 1));

    if (!recipientId || !giftId)
      return res.status(400).json({ error: 'recipientId and giftId required' });
    if (giftId === 'super_shy_trial')
      return res.status(400).json({ error: 'Trial items cannot be transferred' });
    if (uniqueId === recipientId)
      return res.status(400).json({ error: 'Cannot send gift to yourself' });

    const [giftSnap, bpSnap, senderSnap, recipientSnap] = await Promise.all([
      db.doc(`gifts/${giftId}`).get(),
      db.doc(`users/${uniqueId}/backpack/${giftId}`).get(),
      db.doc(`users/${uniqueId}`).get(),
      db.doc(`users/${recipientId}`).get(),
    ]);

    const gift = giftSnap.exists ? { id: giftSnap.id, ...giftSnap.data() } : null;
    const bpItem = bpSnap.exists ? bpSnap.data() : null;
    const sender = senderSnap.exists ? senderSnap.data() : null;
    const recipient = recipientSnap.exists ? recipientSnap.data() : null;

    if (!gift) return res.status(404).json({ error: 'Gift not found' });
    if (!bpItem || (bpItem.quantity || 0) < quantity)
      return res.status(402).json({ error: 'Insufficient items in backpack' });
    if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

    const blockError = checkBlockRelationship(sender, recipient, uniqueId, recipientId);
    if (blockError) {
      log.warn('economy', 'Gift blocked: sender/recipient blocked', {
        senderUniqueId: uniqueId,
        recipientUniqueId: recipientId,
      });
      return res.status(403).json({ error: blockError });
    }

    const config = await loadEconomyConfig();
    const coinValue = gift.coinValue || gift.coin_value || 0;
    const beanReward = Math.floor(coinValue * config.beanConversionRate * quantity);
    const senderCoins = userField(sender, 'shyCoins', 'shy_coins') || 0;
    const recipientBeans = userField(recipient, 'shyBeans', 'shy_beans') || 0;
    const timestamp = now();

    // Decrement backpack atomically via transaction to prevent race conditions
    const bpRef = db.doc(`users/${uniqueId}/backpack/${giftId}`);
    await db.runTransaction(async (t) => {
      const snap = await t.get(bpRef);
      const qty = snap.exists ? snap.data().quantity || 0 : 0;
      if (qty < quantity) throw new Error('Insufficient items in backpack');
      const newQty = qty - quantity;
      if (newQty <= 0) {
        t.delete(bpRef);
      } else {
        t.update(bpRef, { quantity: newQty });
      }
    });

    // Update recipient gift wall
    await updateGiftWall(recipientId, giftId, uniqueId, quantity);

    // Credit beans (atomic increment to avoid race conditions)
    await db.doc(`users/${recipientId}`).update({ shyBeans: FieldValue.increment(beanReward) });

    // Room message if sender is in a room
    const currentRoomId = userField(sender, 'currentRoomId', 'current_room_id');
    if (currentRoomId) {
      const sName = userField(sender, 'displayName', 'display_name') || 'Someone';
      const rName = userField(recipient, 'displayName', 'display_name') || 'Someone';
      const qtyLabel = quantity > 1 ? `${quantity}x ` : '';
      await writeRoomGiftMessage(
        currentRoomId,
        uniqueId,
        sName,
        `${sName} sent ${qtyLabel}${gift.name} to ${rName}`,
        giftId,
        gift.iconUrl || gift.icon_url || '',
      );

      // Update last gift event on room doc
      await db.doc(`rooms/${currentRoomId}`).update({
        lastGiftEvent: {
          senderId: uniqueId,
          senderName: sName,
          recipientId,
          recipientName: rName,
          giftId,
          giftName: gift.name,
          coinValue,
          quantity,
          timestamp,
        },
      });
    }

    // Transaction records
    const giftSentTxId = generateId();
    const giftReceivedTxId = generateId();

    await Promise.all([
      writeTransaction(uniqueId, giftSentTxId, {
        type: 'GIFT_SENT',
        amount: -quantity,
        currency: 'COINS',
        balanceAfter: senderCoins,
        giftId,
        giftName: gift.name,
        recipientId,
        quantity,
        timestamp,
      }),
      writeTransaction(recipientId, giftReceivedTxId, {
        type: 'GIFT_RECEIVED',
        amount: beanReward,
        currency: 'BEANS',
        balanceAfter: recipientBeans + beanReward,
        giftId,
        giftName: gift.name,
        senderId: uniqueId,
        quantity,
        timestamp,
      }),
    ]);

    // Broadcast
    if (coinValue >= config.broadcastSendThreshold) {
      await addBroadcast({
        type: 'GIFT_SEND',
        senderName: userField(sender, 'displayName', 'display_name') || '',
        senderPhotoUrl: null,
        recipientName: userField(recipient, 'displayName', 'display_name') || '',
        giftName: gift.name,
        giftIconUrl: gift.iconUrl || gift.icon_url || '',
        giftCoinValue: coinValue,
        quantity,
      });
    }

    // Update gift rankings incrementally
    await updateGiftRankings(recipientId, giftId, quantity);

    res.json({ success: true, beanReward, giftName: gift.name, quantity });
  } catch (err) {
    log.error('economy', 'POST /economy/gift failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Send gift directly (buy + send) ──
router.post('/economy/gift-direct', async (req, res) => {
  try {
    const uniqueId = req.auth.uniqueId;
    const body = req.body;
    const { recipientId, giftId } = body || {};
    const quantity = Math.max(1, Math.min(9999, Number.parseInt(body?.quantity, 10) || 1));

    if (!recipientId || !giftId)
      return res.status(400).json({ error: 'recipientId and giftId required' });
    if (uniqueId === recipientId)
      return res.status(400).json({ error: 'Cannot send gift to yourself' });

    const [giftSnap, senderSnap, recipientSnap] = await Promise.all([
      db.doc(`gifts/${giftId}`).get(),
      db.doc(`users/${uniqueId}`).get(),
      db.doc(`users/${recipientId}`).get(),
    ]);

    const gift = giftSnap.exists ? { id: giftSnap.id, ...giftSnap.data() } : null;
    const sender = senderSnap.exists ? senderSnap.data() : null;
    const recipient = recipientSnap.exists ? recipientSnap.data() : null;

    if (!gift) return res.status(404).json({ error: 'Gift not found' });
    if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

    const blockError = checkBlockRelationship(sender, recipient, uniqueId, recipientId);
    if (blockError) {
      log.warn('economy', 'Gift blocked: sender/recipient blocked', {
        senderUniqueId: uniqueId,
        recipientUniqueId: recipientId,
      });
      return res.status(403).json({ error: blockError });
    }

    const coinValue = gift.coinValue || gift.coin_value || 0;
    const totalCost = coinValue * quantity;

    const config = await loadEconomyConfig();
    const beanReward = Math.floor(coinValue * config.beanConversionRate * quantity);
    const recipientBeans = userField(recipient, 'shyBeans', 'shy_beans') || 0;
    const timestamp = now();

    // Atomic coin deduction. Without the transaction, two concurrent
    // gift-direct requests at the sender's exact balance both pass the
    // pre-check and both call FieldValue.increment(-totalCost), pushing
    // the balance below 0. The transaction reads `shyCoins` fresh and
    // aborts on insufficient funds before decrementing — matches the
    // pattern at /economy/gift-batch (line 1006-1011).
    const senderRef = db.doc(`users/${uniqueId}`);
    let newSenderCoins;
    try {
      newSenderCoins = await db.runTransaction(async (t) => {
        const snap = await t.get(senderRef);
        const coins = snap.exists ? userField(snap.data(), 'shyCoins', 'shy_coins') || 0 : 0;
        if (coins < totalCost) throw new Error('Insufficient coins');
        t.update(senderRef, { shyCoins: FieldValue.increment(-totalCost) });
        return coins - totalCost;
      });
    } catch (txErr) {
      if (txErr.message === 'Insufficient coins') {
        return res.status(402).json({ error: 'Insufficient coins' });
      }
      throw txErr;
    }

    // Gift wall
    await updateGiftWall(recipientId, giftId, uniqueId, quantity);

    // Beans (atomic)
    await db.doc(`users/${recipientId}`).update({ shyBeans: FieldValue.increment(beanReward) });

    // Room message
    const currentRoomId = userField(sender, 'currentRoomId', 'current_room_id');
    if (currentRoomId) {
      const sName = userField(sender, 'displayName', 'display_name') || 'Someone';
      const rName = userField(recipient, 'displayName', 'display_name') || 'Someone';
      const qtyLabel = quantity > 1 ? `${quantity}x ` : '';
      await writeRoomGiftMessage(
        currentRoomId,
        uniqueId,
        sName,
        `${sName} sent ${qtyLabel}${gift.name} to ${rName}`,
        giftId,
        gift.iconUrl || gift.icon_url || '',
      );
    }

    // Transactions
    const directSentTxId = generateId();
    const directReceivedTxId = generateId();

    await Promise.all([
      writeTransaction(uniqueId, directSentTxId, {
        type: 'GIFT_SENT',
        amount: -totalCost,
        currency: 'COINS',
        balanceAfter: newSenderCoins,
        giftId,
        giftName: gift.name,
        recipientId,
        quantity,
        details: `Sent ${quantity > 1 ? quantity + 'x ' : ''}${gift.name} directly (${totalCost} coins)`,
        timestamp,
      }),
      writeTransaction(recipientId, directReceivedTxId, {
        type: 'GIFT_RECEIVED',
        amount: beanReward,
        currency: 'BEANS',
        balanceAfter: recipientBeans + beanReward,
        giftId,
        giftName: gift.name,
        senderId: uniqueId,
        quantity,
        timestamp,
      }),
    ]);

    if (coinValue >= config.broadcastSendThreshold) {
      await addBroadcast({
        type: 'GIFT_SEND',
        senderName: userField(sender, 'displayName', 'display_name') || '',
        recipientName: userField(recipient, 'displayName', 'display_name') || '',
        giftName: gift.name,
        giftIconUrl: gift.iconUrl || gift.icon_url || '',
        giftCoinValue: coinValue,
        quantity,
      });
    }

    // Update gift rankings incrementally
    await updateGiftRankings(recipientId, giftId, quantity);

    res.json({ success: true, beanReward, giftName: gift.name, coinsSpent: totalCost, quantity });
  } catch (err) {
    log.error('economy', 'POST /economy/gift-direct failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Send gifts to multiple recipients (batch) ──
router.post('/economy/gift-batch', async (req, res) => {
  try {
    const uniqueId = req.auth.uniqueId;
    const body = req.body;
    const { recipientIds, giftId, fromBackpack } = body || {};
    const quantity = Math.max(1, Math.min(9999, Number.parseInt(body?.quantity, 10) || 1));

    if (!recipientIds || !Array.isArray(recipientIds) || recipientIds.length === 0 || !giftId) {
      return res.status(400).json({ error: 'recipientIds array and giftId required' });
    }
    if (giftId === 'super_shy_trial')
      return res.status(400).json({ error: 'Trial items cannot be transferred' });
    if (recipientIds.includes(uniqueId))
      return res.status(400).json({ error: 'Cannot send gift to yourself' });
    if (recipientIds.length > 50) return res.status(400).json({ error: 'Max 50 recipients' });

    const giftSnap = await db.doc(`gifts/${giftId}`).get();
    if (!giftSnap.exists) return res.status(404).json({ error: 'Gift not found' });
    const gift = { id: giftSnap.id, ...giftSnap.data() };

    const senderSnap = await db.doc(`users/${uniqueId}`).get();
    if (!senderSnap.exists) return res.status(404).json({ error: 'Sender not found' });
    const sender = senderSnap.data();

    const coinValue = gift.coinValue || gift.coin_value || 0;
    const totalQty = quantity * recipientIds.length;
    const senderCoins = userField(sender, 'shyCoins', 'shy_coins') || 0;

    let bpItem = null;
    if (fromBackpack) {
      const bpSnap = await db.doc(`users/${uniqueId}/backpack/${giftId}`).get();
      bpItem = bpSnap.exists ? bpSnap.data() : null;
      if (!bpItem || (bpItem.quantity || 0) < totalQty)
        return res.status(402).json({ error: 'Insufficient items in backpack' });
    } else {
      const totalCost = coinValue * totalQty;
      if (senderCoins < totalCost) return res.status(402).json({ error: 'Insufficient coins' });
    }

    const config = await loadEconomyConfig();
    const timestamp = now();

    // Debit sender and credit all recipients in a single transaction
    // to prevent partial failure (sender debited but recipients not credited)
    const bpRef = fromBackpack ? db.doc(`users/${uniqueId}/backpack/${giftId}`) : null;
    const senderRef = db.doc(`users/${uniqueId}`);
    const totalCost = coinValue * totalQty;

    // Validate recipient docs exist before starting
    const recipientSnaps = await Promise.all(recipientIds.map((id) => db.doc(`users/${id}`).get()));
    const validRecipients = recipientIds.filter((_, i) => recipientSnaps[i].exists);
    if (validRecipients.length === 0) return res.status(404).json({ error: 'No valid recipients' });

    // Check block relationships — UK OSA requires blocking prevents ALL contact
    for (let i = 0; i < recipientIds.length; i++) {
      if (!recipientSnaps[i].exists) continue;
      const recipientData = recipientSnaps[i].data();
      const blockError = checkBlockRelationship(sender, recipientData, uniqueId, recipientIds[i]);
      if (blockError) {
        log.warn('economy', 'Gift blocked: sender/recipient blocked', {
          senderUniqueId: uniqueId,
          recipientUniqueId: recipientIds[i],
        });
        return res.status(403).json({ error: blockError });
      }
    }

    // Atomic debit via transaction
    await db.runTransaction(async (t) => {
      if (fromBackpack) {
        const snap = await t.get(bpRef);
        const qty = snap.exists ? snap.data().quantity || 0 : 0;
        if (qty < totalQty) throw new Error('Insufficient items in backpack');
        const newQty = qty - totalQty;
        if (newQty <= 0) {
          t.delete(bpRef);
        } else {
          t.update(bpRef, { quantity: newQty });
        }
      } else {
        const snap = await t.get(senderRef);
        const coins = snap.exists ? userField(snap.data(), 'shyCoins', 'shy_coins') || 0 : 0;
        if (coins < totalCost) throw new Error('Insufficient coins');
        t.update(senderRef, { shyCoins: FieldValue.increment(-totalCost) });
      }
    });

    // Credit recipients (idempotent operations — safe outside transaction)
    for (let i = 0; i < recipientIds.length; i++) {
      const recipientId = recipientIds[i];
      if (!recipientSnaps[i].exists) continue;
      const recipient = recipientSnaps[i].data();
      const recipientBeans = userField(recipient, 'shyBeans', 'shy_beans') || 0;

      const beanReward = Math.floor(coinValue * config.beanConversionRate * quantity);

      // Gift wall + beans (atomic) + transaction
      await updateGiftWall(recipientId, giftId, uniqueId, quantity);
      await updateGiftRankings(recipientId, giftId, quantity);
      await db.doc(`users/${recipientId}`).update({ shyBeans: FieldValue.increment(beanReward) });

      const recipientTxId = generateId();
      await writeTransaction(recipientId, recipientTxId, {
        type: 'GIFT_RECEIVED',
        amount: beanReward,
        currency: 'BEANS',
        balanceAfter: recipientBeans + beanReward,
        giftId,
        giftName: gift.name,
        senderId: uniqueId,
        quantity,
        timestamp,
      });
    }

    // Sender transaction
    const source = fromBackpack ? 'backpack' : 'direct';
    const batchSenderTxId = generateId();
    await writeTransaction(uniqueId, batchSenderTxId, {
      type: 'GIFT_SENT',
      amount: fromBackpack ? 0 : -(coinValue * totalQty),
      currency: 'COINS',
      balanceAfter: fromBackpack ? senderCoins : senderCoins - coinValue * totalQty,
      giftId,
      giftName: gift.name,
      quantity,
      details: `Batch ${source}: ${totalQty}x ${gift.name} to ${recipientIds.length} users`,
      timestamp,
    });

    // Room message
    const currentRoomId = userField(sender, 'currentRoomId', 'current_room_id');
    if (currentRoomId) {
      const sName = userField(sender, 'displayName', 'display_name') || 'Someone';
      await writeRoomGiftMessage(
        currentRoomId,
        uniqueId,
        sName,
        `${sName} sent ${totalQty}x ${gift.name} to ${recipientIds.length} people`,
        giftId,
        gift.iconUrl || gift.icon_url || '',
      );
    }

    // Broadcast
    if (coinValue >= config.broadcastSendThreshold) {
      await addBroadcast({
        type: 'GIFT_SEND',
        senderName: userField(sender, 'displayName', 'display_name') || '',
        recipientName: `${recipientIds.length} people`,
        giftName: gift.name,
        giftIconUrl: gift.iconUrl || gift.icon_url || '',
        giftCoinValue: coinValue,
        quantity: totalQty,
      });
    }

    res.json({
      success: true,
      giftName: gift.name,
      totalSent: totalQty,
      recipientCount: recipientIds.length,
    });
  } catch (err) {
    log.error('economy', 'POST /economy/gift-batch failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Send entire backpack ──
router.post('/economy/backpack-send', async (req, res) => {
  try {
    const uniqueId = req.auth.uniqueId;
    const body = req.body;
    const { recipientId } = body || {};

    if (!recipientId) return res.status(400).json({ error: 'recipientId required' });
    if (uniqueId === recipientId) return res.status(400).json({ error: 'Cannot send to yourself' });

    const [senderSnap, recipientSnap] = await Promise.all([
      db.doc(`users/${uniqueId}`).get(),
      db.doc(`users/${recipientId}`).get(),
    ]);
    const sender = senderSnap.exists ? senderSnap.data() : null;
    const recipient = recipientSnap.exists ? recipientSnap.data() : null;
    if (!sender) return res.status(404).json({ error: 'Sender not found' });
    if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

    const blockError = checkBlockRelationship(sender, recipient, uniqueId, recipientId);
    if (blockError) {
      log.warn('economy', 'Gift blocked: sender/recipient blocked', {
        senderUniqueId: uniqueId,
        recipientUniqueId: recipientId,
      });
      return res.status(403).json({ error: blockError });
    }

    // Get backpack items (excluding trial items)
    const backpackSnap = await db.collection(`users/${uniqueId}/backpack`).get();
    const backpackItems = backpackSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const sendableItems = backpackItems.filter(
      (item) => item.giftId !== 'super_shy_trial' && (item.quantity || 0) > 0,
    );

    if (sendableItems.length === 0) return res.status(400).json({ error: 'Backpack is empty' });

    // For each backpack item, we need gift metadata. If denormalized on the bp doc, use it.
    // Otherwise, look up the gift.
    const config = await loadEconomyConfig();
    const timestamp = now();
    let totalItemsSent = 0;
    let totalBeanReward = 0;

    for (const item of sendableItems) {
      const qty = item.quantity || 0;
      totalItemsSent += qty;

      // Get coin value from backpack doc or gift catalog
      let coinVal = item.coinValue;
      if (coinVal === null || coinVal === undefined) {
        const giftDocSnap = await db.doc(`gifts/${item.giftId}`).get();
        coinVal = giftDocSnap.exists ? giftDocSnap.data().coinValue || 0 : 0;
      }

      const beanReward = Math.floor(coinVal * config.beanConversionRate * qty);
      totalBeanReward += beanReward;

      // Gift wall + rankings
      await updateGiftWall(recipientId, item.giftId, uniqueId, qty);
      await updateGiftRankings(recipientId, item.giftId, qty);
    }

    // Credit beans (atomic)
    await db
      .doc(`users/${recipientId}`)
      .update({ shyBeans: FieldValue.increment(totalBeanReward) });

    // Clear sender's backpack (except trial items) — chunk into batches of 500
    for (let i = 0; i < sendableItems.length; i += 500) {
      const batch = db.batch();
      const chunk = sendableItems.slice(i, i + 500);
      for (const item of chunk) {
        batch.delete(db.doc(`users/${uniqueId}/backpack/${item.giftId}`));
      }
      await batch.commit();
    }

    // Transactions
    const senderCoins = userField(sender, 'shyCoins', 'shy_coins') || 0;
    const recipientBeans = userField(recipient, 'shyBeans', 'shy_beans') || 0;
    const bpSentTxId = generateId();
    const bpReceivedTxId = generateId();
    const senderName = userField(sender, 'displayName', 'display_name') || 'user';
    const recipientName = userField(recipient, 'displayName', 'display_name') || 'user';

    await Promise.all([
      writeTransaction(uniqueId, bpSentTxId, {
        type: 'BACKPACK_SENT',
        amount: 0,
        currency: 'ITEMS',
        balanceAfter: senderCoins,
        totalItemsSent,
        details: `Sent entire backpack (${totalItemsSent} items) to ${recipientName}`,
        timestamp,
      }),
      writeTransaction(recipientId, bpReceivedTxId, {
        type: 'BACKPACK_RECEIVED',
        amount: totalBeanReward,
        currency: 'BEANS',
        balanceAfter: recipientBeans + totalBeanReward,
        totalItemsReceived: totalItemsSent,
        details: `Received entire backpack (${totalItemsSent} items) from ${senderName}`,
        timestamp,
      }),
    ]);

    // Room message
    const currentRoomId = userField(sender, 'currentRoomId', 'current_room_id');
    if (currentRoomId) {
      await writeRoomGiftMessage(
        currentRoomId,
        uniqueId,
        senderName,
        `${senderName} sent their entire backpack (${totalItemsSent} items) to ${recipientName}`,
        null,
        '',
      );
    }

    res.json({ success: true, totalItemsSent, totalBeanReward });
  } catch (err) {
    log.error('economy', 'POST /economy/backpack-send failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Redeem beans ──
router.post('/economy/redeem-beans', async (req, res) => {
  try {
    const uniqueId = req.auth.uniqueId;
    const body = req.body;
    const amount = body?.amount;

    if (!amount || typeof amount !== 'number' || amount < 1) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }

    const userSnap = await db.doc(`users/${uniqueId}`).get();
    if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
    const user = userSnap.data();

    const shyBeans = userField(user, 'shyBeans', 'shy_beans') || 0;
    const shyCoins = userField(user, 'shyCoins', 'shy_coins') || 0;
    if (shyBeans < amount) return res.status(402).json({ error: 'Insufficient beans' });

    const config = await loadEconomyConfig();
    const hasBonus = amount >= config.beanRedeemBonusThreshold;
    const coins = hasBonus ? Math.floor(amount * config.beanRedeemBonusMultiplier) : amount;
    const newBeans = shyBeans - amount;
    const newCoins = shyCoins + coins;

    await db.doc(`users/${uniqueId}`).update({
      shyBeans: FieldValue.increment(-amount),
      shyCoins: FieldValue.increment(coins),
    });

    const bonusPct = Math.round((config.beanRedeemBonusMultiplier - 1) * 100);
    const redeemTxId = generateId();
    await writeTransaction(uniqueId, redeemTxId, {
      type: 'BEAN_REDEEM',
      amount: coins,
      currency: 'COINS',
      balanceAfter: newCoins,
      details: hasBonus
        ? `Redeemed ${amount} beans (${bonusPct}% bonus)`
        : `Redeemed ${amount} beans`,
    });

    res.json({ coinsReceived: coins, newCoinBalance: newCoins, newBeanBalance: newBeans });
  } catch (err) {
    log.error('economy', 'POST /economy/redeem-beans failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Validate purchase ──
router.post('/economy/purchase', async (req, res) => {
  try {
    const uniqueId = req.auth.uniqueId;
    const body = req.body;
    const { productId, purchaseToken, isSubscription, platform } = body || {};

    if (!productId || !purchaseToken)
      return res.status(400).json({ error: 'productId and purchaseToken required' });

    // Default to Google Play for backward-compat — every Android client
    // historically omitted the field. iOS clients MUST send `platform: 'apple'`.
    const purchasePlatform = platform === 'apple' ? 'apple' : 'google';

    // Check for duplicate purchase token to prevent replay attacks
    const existingSnap = await db
      .collection('purchaseReceipts')
      .where('purchaseToken', '==', purchaseToken)
      .limit(1)
      .get();
    if (!existingSnap.empty) {
      log.warn('economy', 'Duplicate purchase token rejected', { userId: uniqueId, productId });
      return res.status(409).json({ error: 'Purchase already processed' });
    }

    // Verify purchase with the appropriate store (Google Play or Apple App Store)
    const packageName = 'com.shyden.shytalk';
    let verification;
    if (process.env.NODE_ENV === 'production') {
      try {
        if (purchasePlatform === 'apple') {
          // iOS sends `Transaction.jwsRepresentation` as `purchaseToken`.
          // verifyApplePurchase enforces bundleId, productId, revocation,
          // and (for subs) expiry — see appleStore.js.
          verification = await verifyApplePurchase(productId, purchaseToken, !!isSubscription);
        } else if (isSubscription) {
          verification = await verifySubscription(packageName, productId, purchaseToken);
        } else {
          verification = await verifyProductPurchase(packageName, productId, purchaseToken);
        }
      } catch (verifyErr) {
        log.warn('economy', 'Purchase verification rejected', {
          userId: uniqueId,
          productId,
          platform: purchasePlatform,
          isSubscription: !!isSubscription,
          error: verifyErr.message,
        });
        return res.status(403).json({ error: 'Purchase verification failed' });
      }
    } else {
      log.warn('economy', 'Skipping purchase verification in non-production environment', {
        userId: uniqueId,
        productId,
        platform: purchasePlatform,
        isSubscription: !!isSubscription,
      });
      verification = { orderId: 'dev-unverified' };
    }

    const orderId = verification.orderId || verification.latestOrderId || null;
    const timestamp = now();
    const receiptId = generateId();

    if (isSubscription) {
      const sub = SUBSCRIPTION_TIERS[productId];
      if (!sub) return res.status(400).json({ error: 'Unknown subscription product' });

      const expiry = sub.days ? timestamp + sub.days * 86400000 : null;

      // Store receipt AFTER tier resolution so we can persist the granted
      // tier + days. The refund handler reads from the receipt instead of
      // re-deriving from the (mutable) SUBSCRIPTION_TIERS map, so a future
      // tier change cannot retroactively rewrite the refund's reversal.
      await db.doc(`purchaseReceipts/${receiptId}`).set({
        userId: uniqueId,
        productId,
        purchaseToken,
        platform: purchasePlatform,
        isSubscription: true,
        createdAt: timestamp,
        verified: true,
        orderId,
        tierGranted: sub.tier,
        daysGranted: sub.days,
      });

      await db.doc(`users/${uniqueId}`).update({
        isSuperShy: true,
        superShyExpiry: expiry,
        superShyTier: sub.tier,
      });

      const subTxId = generateId();
      await writeTransaction(uniqueId, subTxId, {
        type: 'SUBSCRIPTION',
        amount: 0,
        currency: 'COINS',
        balanceAfter: 0,
        details: `Super Shy ${sub.tier}`,
        timestamp,
      });

      return res.json({ success: true, tier: sub.tier });
    }

    // Coin package
    const pkgSnap = await db
      .collection('coinPackages')
      .where('productId', '==', productId)
      .limit(1)
      .get();
    const pkg = pkgSnap.empty ? null : { id: pkgSnap.docs[0].id, ...pkgSnap.docs[0].data() };
    if (!pkg) return res.status(404).json({ error: 'Unknown coin package' });

    const coinsGranted = pkg.coins || 0;
    const bonusCoinsGranted = pkg.bonusCoins || 0;
    const totalCoins = coinsGranted + bonusCoinsGranted;

    const userSnap = await db.doc(`users/${uniqueId}`).get();
    if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
    const user = userSnap.data();

    const shyCoins = userField(user, 'shyCoins', 'shy_coins') || 0;

    // Persist the actual granted amounts on the receipt so the refund
    // handler can reverse the original entitlement even if `coinPackages`
    // is later mutated (price changes, promotional bonus weekends,
    // deprecated SKUs). Without this the refund would reverse today's
    // package config, not what the user originally received.
    await db.doc(`purchaseReceipts/${receiptId}`).set({
      userId: uniqueId,
      productId,
      purchaseToken,
      platform: purchasePlatform,
      isSubscription: false,
      createdAt: timestamp,
      verified: true,
      orderId,
      coinsGranted,
      bonusCoinsGranted,
    });

    await db.doc(`users/${uniqueId}`).update({ shyCoins: FieldValue.increment(totalCoins) });

    const newBalance = shyCoins + totalCoins;
    const purchaseTxId = generateId();
    await writeTransaction(uniqueId, purchaseTxId, {
      type: 'PURCHASE',
      amount: totalCoins,
      currency: 'COINS',
      balanceAfter: newBalance,
      details: `${pkg.coins} + ${pkg.bonusCoins || 0} bonus coins`,
      timestamp,
    });

    res.json({ success: true, coinsAdded: totalCoins, newBalance });
  } catch (err) {
    log.error('economy', 'POST /economy/purchase failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Super Shy trial claim ──
router.post('/economy/trial-claim', async (req, res) => {
  try {
    const uniqueId = req.auth.uniqueId;

    const userSnap = await db.doc(`users/${uniqueId}`).get();
    if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
    const user = userSnap.data();

    const hasClaimed = userField(user, 'hasClaimedSuperShyTrial', 'has_claimed_super_shy_trial');
    if (hasClaimed) return res.status(409).json({ error: 'Trial already claimed' });

    const shyCoins = userField(user, 'shyCoins', 'shy_coins') || 0;

    await db.doc(`users/${uniqueId}`).update({ hasClaimedSuperShyTrial: true });

    // Add trial item to backpack
    await db.doc(`users/${uniqueId}/backpack/super_shy_trial`).set({
      giftId: 'super_shy_trial',
      quantity: 1,
      giftName: 'Super Shy Trial',
    });

    const trialClaimTxId = generateId();
    await writeTransaction(uniqueId, trialClaimTxId, {
      type: 'TRIAL_CLAIM',
      amount: 0,
      currency: 'COINS',
      balanceAfter: shyCoins,
      details: 'Claimed 30 days of Super Shy',
    });

    res.json({ success: true });
  } catch (err) {
    log.error('economy', 'POST /economy/trial-claim failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Super Shy trial activate ──
router.post('/economy/trial-activate', async (req, res) => {
  try {
    const uniqueId = req.auth.uniqueId;

    const [userSnap, bpSnap] = await Promise.all([
      db.doc(`users/${uniqueId}`).get(),
      db.doc(`users/${uniqueId}/backpack/super_shy_trial`).get(),
    ]);

    const user = userSnap.exists ? userSnap.data() : null;
    const bpItem = bpSnap.exists ? bpSnap.data() : null;

    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!bpItem || (bpItem.quantity || 0) < 1)
      return res.status(402).json({ error: 'No trial item in backpack' });

    const timestamp = now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const currentExpiry = userField(user, 'superShyExpiry', 'super_shy_expiry') || 0;
    const baseTime = Math.max(currentExpiry, timestamp);
    const newExpiry = baseTime + thirtyDays;
    const currentTier = userField(user, 'superShyTier', 'super_shy_tier');
    const newTier = currentTier && currentTier !== 'trial' ? currentTier : 'trial';

    // Remove trial from backpack and activate
    await db.doc(`users/${uniqueId}/backpack/super_shy_trial`).delete();
    await db.doc(`users/${uniqueId}`).update({
      isSuperShy: true,
      superShyExpiry: newExpiry,
      superShyTier: newTier,
    });

    const shyCoins = userField(user, 'shyCoins', 'shy_coins') || 0;
    const trialActivateTxId = generateId();
    await writeTransaction(uniqueId, trialActivateTxId, {
      type: 'TRIAL_ACTIVATE',
      amount: 0,
      currency: 'COINS',
      balanceAfter: shyCoins,
      details: 'Activated 30 days of Super Shy',
      timestamp,
    });

    res.json({ success: true, newTier, newExpiry });
  } catch (err) {
    log.error('economy', 'POST /economy/trial-activate failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Test coins (admin only) ──
router.post('/economy/test-coins', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const uniqueId = req.auth.uniqueId;
    const body = req.body;
    const amount = body?.amount;

    if (!amount || typeof amount !== 'number' || amount <= 0 || amount > 100000) {
      return res.status(400).json({ error: 'amount must be 1-100000' });
    }

    const userSnap = await db.doc(`users/${uniqueId}`).get();
    if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
    const user = userSnap.data();

    const shyCoins = userField(user, 'shyCoins', 'shy_coins') || 0;

    await db.doc(`users/${uniqueId}`).update({ shyCoins: FieldValue.increment(amount) });

    const newBalance = shyCoins + amount;
    const testTxId = generateId();
    await writeTransaction(uniqueId, testTxId, {
      type: 'PURCHASE',
      amount,
      currency: 'COINS',
      balanceAfter: newBalance,
      details: `Test purchase (+${amount} coins)`,
    });

    res.json({ success: true, coinsAdded: amount, newBalance });
  } catch (err) {
    log.error('economy', 'POST /economy/test-coins failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Balance ──
router.get('/economy/balance', async (req, res) => {
  try {
    const uniqueId = req.auth.uniqueId;
    const userSnap = await db.doc(`users/${uniqueId}`).get();
    if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
    const user = userSnap.data();
    res.json({
      coins: userField(user, 'shyCoins', 'shy_coins') || 0,
      beans: userField(user, 'shyBeans', 'shy_beans') || 0,
    });
  } catch (err) {
    log.error('economy', 'GET /economy/balance failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Transactions ──
router.get('/economy/transactions', async (req, res) => {
  try {
    const uniqueId = req.auth.uniqueId;
    const limit = Math.min(Number.parseInt(req.query.limit, 10) || 50, 200);
    const filterType = req.query.type;

    let query = db.collection(`users/${uniqueId}/transactions`);

    if (filterType) {
      query = query.where('type', '==', filterType);
    }

    query = query.orderBy('timestamp', 'desc').limit(limit);

    const snap = await query.get();
    const results = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json(results);
  } catch (err) {
    log.error('economy', 'GET /economy/transactions failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Backpack ──
router.get('/users/:uniqueId/backpack', async (req, res) => {
  try {
    const isAdmin = req.auth.token?.admin;
    if (String(req.auth.uniqueId) !== req.params.uniqueId && !isAdmin) {
      return res.status(403).json({ error: "Cannot access another user's backpack" });
    }
    const snap = await db.collection(`users/${req.params.uniqueId}/backpack`).get();
    const results = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json(results);
  } catch (err) {
    log.error('economy', 'GET /users/:uniqueId/backpack failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Gift wall ──
router.get('/users/:uniqueId/gift-wall', async (req, res) => {
  try {
    const snap = await db.collection(`users/${req.params.uniqueId}/giftWall`).get();
    const results = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json(results);
  } catch (err) {
    log.error('economy', 'GET /users/:uniqueId/gift-wall failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Gift wall senders ──
router.get('/users/:uniqueId/gift-wall/:giftId/senders', async (req, res) => {
  try {
    const docSnap = await db
      .doc(`users/${req.params.uniqueId}/giftWall/${req.params.giftId}`)
      .get();
    const senders = docSnap.exists ? docSnap.data().senders || [] : [];
    // Sort by sendCount descending
    senders.sort((a, b) => (b.sendCount || 0) - (a.sendCount || 0));
    res.json(senders);
  } catch (err) {
    log.error('economy', 'GET /users/:uniqueId/gift-wall/:giftId/senders failed', {
      error: err.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Test helper to reset in-memory config cache
router._resetConfigCache = () => {
  cachedEconomyConfig = null;
  economyConfigCachedAt = 0;
};

module.exports = router;

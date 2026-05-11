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

const crypto = require('node:crypto');
const router = require('express').Router();
const { db, FieldValue } = require('../utils/firebase');
const { generateId, now, todayStr, yesterdayStr } = require('../utils/helpers');
const { requireAdmin } = require('../middleware/auth');
const log = require('../utils/log');
const { verifyProductPurchase, verifySubscription } = require('../utils/playStore');
const { verifyApplePurchase } = require('../utils/appleStore');
const { SUBSCRIPTION_TIERS } = require('../utils/subscriptionTiers');
const { viewerIsBlocked, checkBlockRelationship } = require('../utils/block-check');

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

  // Trim old broadcasts (keep last 50). Pre-fix used
  // `offset(50).limit(100)` which charges Firestore reads for ALL
  // 50 SKIPPED documents on every call — at high gift volume this
  // burns the Spark free-tier 50K-reads/day quota fast (50 reads
  // per broadcast × 1000 broadcasts/day = 50K reads just from
  // trim alone).
  //
  // New strategy:
  //   1. count() aggregate → ~1 billable read regardless of size
  //   2. If count <= 50: skip the trim entirely (no extra cost)
  //   3. If count > 50: read+delete only the OVERFLOW docs (typically 1)
  //
  // Steady-state cost per broadcast: 1 set + 1 count + 1 read + 1
  // delete = 4 ops, down from 51+. Audit H5 (Phase 2A).
  const countSnap = await db.collection('broadcasts').count().get();
  const totalCount = countSnap.data().count;
  const KEEP_LAST = 50;
  if (totalCount <= KEEP_LAST) return;

  const overflow = totalCount - KEEP_LAST;
  const oldSnap = await db
    .collection('broadcasts')
    .orderBy('timestamp', 'asc')
    .limit(overflow)
    .get();
  if (oldSnap.empty) return;

  // Chunk deletes into batches of 500 (Firestore batch limit).
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

/**
 * Write a gift to a user's gift wall (upsert receivedCount, update senders).
 *
 * Audit M6 (Phase 2A): receivedCount updates use FieldValue.increment
 * for atomicity. Pre-fix used (read currentCount) → (write current+qty)
 * which lost concurrent updates: two simultaneous gifts to the same
 * recipient/giftId both read receivedCount=5, both wrote 6, true count
 * was 7. Under a room burst-gift scenario this lost gift counts visibly
 * (rankings, profile display).
 *
 * Sender list update is best-effort: it's NOT atomic against itself
 * because senders is an array that needs in-place mutation (find + sort
 * + trim). Two concurrent updates can each lose the OTHER's sender
 * entry. This is documented as known partial-failure for the senders
 * field — the receivedCount remains accurate, which is the
 * primary-display value.
 */
async function updateGiftWall(recipientId, giftId, senderId, quantity) {
  const wallRef = db.doc(`users/${recipientId}/giftWall/${giftId}`);
  const wallSnap = await wallRef.get();
  const wallDoc = wallSnap.exists ? wallSnap.data() : null;

  const senders = wallDoc?.senders || [];

  // Update or add sender (best-effort — see function header)
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

  if (wallSnap.exists) {
    // Atomic-increment for the count + overwrite for the senders.
    // The senders update is read-modify-write so it's NOT race-safe
    // against itself (documented above), but the count IS race-safe
    // because increment is server-side atomic.
    await wallRef.update({
      giftId,
      receivedCount: FieldValue.increment(quantity),
      senders: trimmedSenders,
    });
  } else {
    // Create path — set is fine here, count starts at quantity.
    await wallRef.set({
      giftId,
      receivedCount: quantity,
      senders: trimmedSenders,
    });
  }
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
 *
 * Audit M6 (Phase 2A): totalSent uses FieldValue.increment for atomic
 * server-side increment. The rankings array still has the same partial-
 * failure window as updateGiftWall.senders — read-modify-write under
 * concurrent updates can drop entries — but the totalSent counter
 * remains accurate.
 */
async function updateGiftRankings(recipientId, giftId, quantity) {
  try {
    const rankRef = db.doc(`giftRankings/${giftId}`);
    const rankSnap = await rankRef.get();
    const rankDoc = rankSnap.exists ? rankSnap.data() : {};
    const rankings = rankDoc.rankings || [];

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

    if (rankSnap.exists) {
      await rankRef.update({
        rankings: trimmed,
        totalSent: FieldValue.increment(quantity),
        lastUpdated: now(),
      });
    } else {
      await rankRef.set({
        rankings: trimmed,
        totalSent: quantity,
        lastUpdated: now(),
      });
    }
  } catch (err) {
    log.error('economy', 'Failed to update gift rankings', { error: err.message });
  }
}

// ─── Shared gift helpers ─────────────────────────────────────────
// (block-check helpers live in ../utils/block-check — imported above)

/**
 * Load the target user doc and refuse with 403 if they have blocked
 * the caller (C7). Returns false when 403 was sent — caller must
 * `return` immediately to avoid double-send. Returns true to continue.
 */
async function refuseIfTargetBlocksViewer(req, res) {
  const snap = await db.doc(`users/${req.params.uniqueId}`).get();
  const target = snap.exists ? snap.data() : null;
  if (viewerIsBlocked(req.auth.uniqueId, target)) {
    res.status(403).json({ error: 'Cannot view content of users who have blocked you' });
    return false;
  }
  return true;
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

    // Atomic claim per audit H6 — wraps user-read + already-claimed
    // check + user-update + backpack-merge in a Firestore transaction.
    // Pattern matches PRs #485-#488. Sentinel errors caught after.
    const userRef = db.doc(`users/${uniqueId}`);
    const ERR_USER_NOT_FOUND = 'User not found';
    const ERR_ALREADY_CLAIMED = 'Already claimed today';
    let txResult;
    try {
      txResult = await db.runTransaction(async (t) => {
        const userSnap = await t.get(userRef);
        if (!userSnap.exists) {
          throw new Error(ERR_USER_NOT_FOUND);
        }
        const user = userSnap.data();
        const shyCoins = userField(user, 'shyCoins', 'shy_coins') || 0;
        const isSuperShy = userField(user, 'isSuperShy', 'is_super_shy') || false;
        const loginStreak = userField(user, 'loginStreak', 'login_streak') || 0;
        const lastLoginDate = userField(user, 'lastLoginDate', 'last_login_date');
        const lastLoginRewardDate = userField(
          user,
          'lastLoginRewardDate',
          'last_login_reward_date',
        );

        if (lastLoginRewardDate === today) {
          throw new Error(ERR_ALREADY_CLAIMED);
        }

        const newStreak = lastLoginDate === yesterday ? loginStreak + 1 : 1;
        const reward = computeDailyReward(config, newStreak, isSuperShy);
        const newBalance = shyCoins + reward.coinReward;

        const userUpdates = {
          loginStreak: newStreak,
          lastLoginDate: today,
          lastLoginRewardDate: today,
        };
        if (reward.coinReward > 0) userUpdates.shyCoins = newBalance;
        t.update(userRef, userUpdates);

        if (reward.giftReward) {
          const bpRef = db.doc(`users/${uniqueId}/backpack/${reward.giftReward.giftId}`);
          const bpSnap = await t.get(bpRef);
          const currentQty = bpSnap.exists ? bpSnap.data().quantity || 0 : 0;
          t.set(bpRef, {
            giftId: reward.giftReward.giftId,
            quantity: currentQty + reward.giftReward.quantity,
            lastAcquired: now(),
          });
        }

        return {
          coinReward: reward.coinReward,
          giftReward: reward.giftReward,
          isMilestone: reward.isMilestone,
          newBalance,
          newStreak,
        };
      });
    } catch (txErr) {
      if (txErr.message === ERR_USER_NOT_FOUND) {
        return res.status(404).json({ error: ERR_USER_NOT_FOUND });
      }
      if (txErr.message === ERR_ALREADY_CLAIMED) {
        return res.status(409).json({ error: ERR_ALREADY_CLAIMED });
      }
      throw txErr;
    }

    const { coinReward, giftReward, isMilestone, newBalance, newStreak } = txResult;

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
    // Audit M3 (Phase 2A): drop the unnecessary `String(pullCount)`
    // coercion. JS object keys are always strings under the hood
    // (numeric literals like `{1: 10}` are stored as `{'1': 10}`),
    // so `pullCosts[pullCount]` resolves identically to
    // `pullCosts[String(pullCount)]`. The audit raised a theoretical
    // "Firestore numeric-key" concern, but Firestore Admin SDK
    // returns plain JS objects with string-only keys regardless of
    // how the doc was originally written. Simpler is better.
    const cost = pullCosts[pullCount];
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

    // Atomic: bean credit + ALL backpack deletes in the same batch.
    // Without this, a transient Firestore error between the bean
    // credit (recipient already credited) and the backpack delete
    // (sender's items still present) leaves a state where the
    // sender can re-send their backpack and DOUBLE-CREDIT the
    // recipient. Audit H8 (Phase 2A).
    //
    // Firestore batch limit is 500 ops. The bean update is 1 op;
    // we have N delete ops. If N+1 > 500 we must split — but in
    // that case we sacrifice atomicity and accept the original
    // partial-failure surface. We pick the bean-credit batch to
    // include the FIRST chunk of deletes so any single chunk
    // failure leaves no partial state for chunk #1. Subsequent
    // chunks remain best-effort.
    const FIRESTORE_BATCH_LIMIT = 500;
    const BATCH_FIRST_CHUNK_LIMIT = FIRESTORE_BATCH_LIMIT - 1; // reserve 1 for bean update

    if (sendableItems.length <= BATCH_FIRST_CHUNK_LIMIT) {
      // Common case: small backpack. Single atomic batch.
      const batch = db.batch();
      batch.update(db.doc(`users/${recipientId}`), {
        shyBeans: FieldValue.increment(totalBeanReward),
      });
      for (const item of sendableItems) {
        batch.delete(db.doc(`users/${uniqueId}/backpack/${item.giftId}`));
      }
      await batch.commit();
    } else {
      // Rare case: very large backpack > 499 distinct gift items.
      // First batch contains the bean credit + first 499 deletes (all
      // atomic — covers the credit-without-delete failure mode for
      // the bulk of items). Remaining deletes follow in 500-op batches.
      const firstChunk = sendableItems.slice(0, BATCH_FIRST_CHUNK_LIMIT);
      const firstBatch = db.batch();
      firstBatch.update(db.doc(`users/${recipientId}`), {
        shyBeans: FieldValue.increment(totalBeanReward),
      });
      for (const item of firstChunk) {
        firstBatch.delete(db.doc(`users/${uniqueId}/backpack/${item.giftId}`));
      }
      await firstBatch.commit();

      for (let i = BATCH_FIRST_CHUNK_LIMIT; i < sendableItems.length; i += FIRESTORE_BATCH_LIMIT) {
        const batch = db.batch();
        const chunk = sendableItems.slice(i, i + FIRESTORE_BATCH_LIMIT);
        for (const item of chunk) {
          batch.delete(db.doc(`users/${uniqueId}/backpack/${item.giftId}`));
        }
        await batch.commit();
      }
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

    const config = await loadEconomyConfig();
    const hasBonus = amount >= config.beanRedeemBonusThreshold;
    const coins = hasBonus ? Math.floor(amount * config.beanRedeemBonusMultiplier) : amount;

    // Atomic bean→coin conversion. Without the transaction, two
    // concurrent redeem requests at the user's exact bean balance
    // both pass the `shyBeans < amount` check and both decrement,
    // pushing balance below 0. Coins would also be over-credited.
    // The transaction reads beans fresh inside the tx; aborts on
    // insufficient; performs the swap atomically.
    //
    // Audit C2 (Phase 2A): /economy/redeem-beans race condition.
    const userRef = db.doc(`users/${uniqueId}`);
    let newBeans;
    let newCoins;
    try {
      ({ newBeans, newCoins } = await db.runTransaction(async (t) => {
        const snap = await t.get(userRef);
        if (!snap.exists) {
          throw new Error('User not found');
        }
        const data = snap.data();
        const beans = userField(data, 'shyBeans', 'shy_beans') || 0;
        const coinsNow = userField(data, 'shyCoins', 'shy_coins') || 0;
        if (beans < amount) {
          throw new Error('Insufficient beans');
        }
        t.update(userRef, {
          shyBeans: FieldValue.increment(-amount),
          shyCoins: FieldValue.increment(coins),
        });
        return { newBeans: beans - amount, newCoins: coinsNow + coins };
      }));
    } catch (txErr) {
      if (txErr.message === 'User not found') {
        return res.status(404).json({ error: 'User not found' });
      }
      if (txErr.message === 'Insufficient beans') {
        return res.status(402).json({ error: 'Insufficient beans' });
      }
      throw txErr;
    }

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

    // Deterministic receipt doc ID derived from purchaseToken.
    // SHA-256 collisions are infeasible; any two requests with the
    // SAME token write to the SAME doc, making the receipt set
    // idempotent at the storage layer. Combined with the inside-tx
    // existence check below, this closes the replay race window
    // that the previous where-query duplicate check could not.
    //
    // Audit C4 (Phase 2A): /economy/purchase replay race.
    const receiptId = crypto.createHash('sha256').update(String(purchaseToken)).digest('hex');
    const receiptRef = db.doc(`purchaseReceipts/${receiptId}`);

    // Pre-flight (cheap fast-path on already-processed tokens).
    // The authoritative duplicate check happens inside the
    // transaction below — this just avoids paying the verification
    // cost (network call to Google/Apple) for tokens we've already
    // seen. A race between this check and the tx is fine: the tx
    // will catch the duplicate and reject.
    const existingSnap = await receiptRef.get();
    if (existingSnap.exists) {
      log.warn('economy', 'Duplicate purchase token rejected (pre-flight)', {
        userId: uniqueId,
        productId,
      });
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
    const userRef = db.doc(`users/${uniqueId}`);

    // Sentinels for tx-internal aborts. Caught after the tx and
    // mapped to the appropriate HTTP status.
    const ERR_DUPLICATE = 'Purchase already processed';
    const ERR_UNKNOWN_SUB = 'Unknown subscription product';
    const ERR_USER_NOT_FOUND = 'User not found';
    const ERR_UNKNOWN_PKG = 'Unknown coin package';

    if (isSubscription) {
      const sub = SUBSCRIPTION_TIERS[productId];
      if (!sub) return res.status(400).json({ error: ERR_UNKNOWN_SUB });

      const expiry = sub.days ? timestamp + sub.days * 86400000 : null;

      // Atomic: re-check receipt + write receipt + grant subscription.
      // Firestore transactions retry on contention; a concurrent
      // request that wins the race will populate the receipt before
      // this tx's t.get() sees it, causing this attempt to abort
      // with ERR_DUPLICATE on retry.
      try {
        await db.runTransaction(async (t) => {
          const rcptSnap = await t.get(receiptRef);
          if (rcptSnap.exists) {
            throw new Error(ERR_DUPLICATE);
          }
          // Persist tier + days for refund-time reversal (see
          // pre-fix comment): refund reads from receipt rather
          // than re-deriving from mutable SUBSCRIPTION_TIERS map.
          t.set(receiptRef, {
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
          t.update(userRef, {
            isSuperShy: true,
            superShyExpiry: expiry,
            superShyTier: sub.tier,
          });
        });
      } catch (txErr) {
        if (txErr.message === ERR_DUPLICATE) {
          log.warn('economy', 'Duplicate purchase rejected (tx)', {
            userId: uniqueId,
            productId,
          });
          return res.status(409).json({ error: ERR_DUPLICATE });
        }
        throw txErr;
      }

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

    // Coin package — look up package OUTSIDE the tx (read-only,
    // stable). Fail fast on unknown package before opening the tx.
    const pkgSnap = await db
      .collection('coinPackages')
      .where('productId', '==', productId)
      .limit(1)
      .get();
    const pkg = pkgSnap.empty ? null : { id: pkgSnap.docs[0].id, ...pkgSnap.docs[0].data() };
    if (!pkg) return res.status(404).json({ error: ERR_UNKNOWN_PKG });

    const coinsGranted = pkg.coins || 0;
    const bonusCoinsGranted = pkg.bonusCoins || 0;
    const totalCoins = coinsGranted + bonusCoinsGranted;

    // Atomic: re-check receipt + read user + write receipt + grant
    // coins, all in one transaction. Reading the user inside the tx
    // ensures `newBalance` reflects post-grant state consistently
    // even under concurrent purchases.
    let newBalance;
    try {
      newBalance = await db.runTransaction(async (t) => {
        const rcptSnap = await t.get(receiptRef);
        if (rcptSnap.exists) {
          throw new Error(ERR_DUPLICATE);
        }
        const userSnap = await t.get(userRef);
        if (!userSnap.exists) {
          throw new Error(ERR_USER_NOT_FOUND);
        }
        const user = userSnap.data();
        const shyCoins = userField(user, 'shyCoins', 'shy_coins') || 0;
        // Persist actual granted amounts on the receipt so the refund
        // handler can reverse the original entitlement even if
        // `coinPackages` is later mutated (price changes, promotional
        // bonus weekends, deprecated SKUs).
        t.set(receiptRef, {
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
        t.update(userRef, { shyCoins: FieldValue.increment(totalCoins) });
        return shyCoins + totalCoins;
      });
    } catch (txErr) {
      if (txErr.message === ERR_DUPLICATE) {
        log.warn('economy', 'Duplicate purchase rejected (tx)', { userId: uniqueId, productId });
        return res.status(409).json({ error: ERR_DUPLICATE });
      }
      if (txErr.message === ERR_USER_NOT_FOUND) {
        return res.status(404).json({ error: ERR_USER_NOT_FOUND });
      }
      throw txErr;
    }

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

    // Atomic claim: read+set+backpack-write in a single transaction.
    // Without this, two concurrent trial-claim requests both read
    // hasClaimedSuperShyTrial=false, both pass the guard, both write
    // hasClaimedSuperShyTrial=true and add the trial item to backpack
    // (set with no merge → quantity:1 each time, so backpack ends up
    // with quantity:1 either way, but the user has effectively claimed
    // a paid feature unlock TWICE — duplicate audit log entries, double
    // analytics trigger, and potentially double-applied entitlement on
    // the client side which observes both writes).
    //
    // Audit C3 (Phase 2A): /economy/trial-claim TOCTOU race.
    const userRef = db.doc(`users/${uniqueId}`);
    const backpackRef = db.doc(`users/${uniqueId}/backpack/super_shy_trial`);
    let shyCoins;
    try {
      shyCoins = await db.runTransaction(async (t) => {
        const snap = await t.get(userRef);
        if (!snap.exists) {
          throw new Error('User not found');
        }
        const data = snap.data();
        const hasClaimed = userField(
          data,
          'hasClaimedSuperShyTrial',
          'has_claimed_super_shy_trial',
        );
        if (hasClaimed) {
          throw new Error('Trial already claimed');
        }
        t.update(userRef, { hasClaimedSuperShyTrial: true });
        t.set(backpackRef, {
          giftId: 'super_shy_trial',
          quantity: 1,
          giftName: 'Super Shy Trial',
        });
        return userField(data, 'shyCoins', 'shy_coins') || 0;
      });
    } catch (txErr) {
      if (txErr.message === 'User not found') {
        return res.status(404).json({ error: 'User not found' });
      }
      if (txErr.message === 'Trial already claimed') {
        return res.status(409).json({ error: 'Trial already claimed' });
      }
      throw txErr;
    }

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
    if (await requireAdmin(req, res)) return;

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
    // C7 (block-list integrity): a user who has been blocked by the
    // target must not be able to see the target's gift wall.
    if (!(await refuseIfTargetBlocksViewer(req, res))) return;

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
    // C7: same block check as the parent gift-wall list — the sender
    // list is a strict subset of gift-wall data.
    if (!(await refuseIfTargetBlocksViewer(req, res))) return;

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

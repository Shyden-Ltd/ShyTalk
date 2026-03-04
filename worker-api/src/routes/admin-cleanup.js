/**
 * Admin cleanup routes — data reset, storage audit, orphan cleanup.
 *
 * All endpoints require admin. They operate on Firestore collections and R2 directly.
 *
 * POST /api/cleanup/system-conversations       → Delete duplicate system conversations
 * POST /api/cleanup/all-system-conversations    → Delete ALL system conversations
 * POST /api/cleanup/all-reports                 → Delete all reports + locks
 * POST /api/cleanup/all-warnings               → Reset warnings on all users
 * POST /api/cleanup/all-backpacks              → Clear all backpack items
 * POST /api/cleanup/all-giftwalls              → Clear all gift walls
 * POST /api/cleanup/all-coins                  → Reset all coin balances
 * POST /api/cleanup/all-beans                  → Reset all bean balances
 * POST /api/cleanup/all-spin-history           → Delete gacha transactions + reset pity
 * POST /api/cleanup/all-supershy               → Clear Super Shy status
 * POST /api/cleanup/all-appeals                → Delete all suspension appeals
 * GET  /api/storage/audit                      → R2 folder audit
 * POST /api/cleanup/orphaned-storage           → Smart R2 cleanup
 */

const { json, jsonError, now } = require('../utils');
const { requireAdmin } = require('../middleware/auth');
const {
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  queryCollection,
  batchWrite,
  batchUpdateOp,
  batchDeleteOp,
  fieldFilter,
  andFilter,
  orderBy,
} = require('../utils/firestore');

function registerAdminCleanupRoutes(router) {

  // ── Delete duplicate system conversations ──
  router.post('/api/cleanup/system-conversations', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    // Find all conversations where SHYTALK_SYSTEM is a participant
    // participantIds array contains 'SHYTALK_SYSTEM'
    const systemConvs = await queryCollection(env, 'conversations', {
      where: fieldFilter('participantIds', 'ARRAY_CONTAINS', 'SHYTALK_SYSTEM'),
    });

    let deleted = 0;
    const seen = new Map(); // recipientUid → first conversation id

    for (const conv of systemConvs) {
      // Get the other participant (non-SHYTALK_SYSTEM uid)
      const participantIds = conv.participantIds || [];
      const otherUid = participantIds.find(id => id !== 'SHYTALK_SYSTEM');
      if (!otherUid) continue;

      const expectedId = [otherUid, 'SHYTALK_SYSTEM'].sort().join('_');

      if (conv.id === expectedId) {
        seen.set(otherUid, conv.id);
        continue;
      }

      // This is a duplicate — delete it
      if (seen.has(otherUid)) {
        await deleteConversation(env, conv.id);
        deleted++;
      } else {
        seen.set(otherUid, conv.id);
      }
    }

    return json({ success: true, deleted });
  });

  // ── Delete ALL system conversations ──
  router.post('/api/cleanup/all-system-conversations', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const systemConvs = await queryCollection(env, 'conversations', {
      where: fieldFilter('participantIds', 'ARRAY_CONTAINS', 'SHYTALK_SYSTEM'),
    });

    for (const conv of systemConvs) {
      await deleteConversation(env, conv.id);
    }

    return json({ success: true, deleted: systemConvs.length });
  });

  // ── Delete all reports ──
  router.post('/api/cleanup/all-reports', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    // Delete R2 evidence files first
    await deleteR2Prefix(env, 'report_evidence/');

    // Delete all docs from reports, reportsArchive, reportLocks collections
    const [reports, reportsArchive, reportLocks] = await Promise.all([
      queryCollection(env, 'reports', {}),
      queryCollection(env, 'reportsArchive', {}),
      queryCollection(env, 'reportLocks', {}),
    ]);

    const writes = [
      ...reports.map(d => batchDeleteOp(env, `reports/${d.id}`)),
      ...reportsArchive.map(d => batchDeleteOp(env, `reportsArchive/${d.id}`)),
      ...reportLocks.map(d => batchDeleteOp(env, `reportLocks/${d.id}`)),
    ];

    for (let i = 0; i < writes.length; i += 500) {
      await batchWrite(env, writes.slice(i, i + 500));
    }

    return json({ success: true });
  });

  // ── Reset all warnings ──
  router.post('/api/cleanup/all-warnings', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    // Query users who have any warning state set
    const users = await queryCollection(env, 'users', {
      where: fieldFilter('warningCount', 'GREATER_THAN', 0),
    });

    // Also catch users with hasActiveWarning=true but warningCount=0
    const usersWithActiveWarning = await queryCollection(env, 'users', {
      where: fieldFilter('hasActiveWarning', 'EQUAL', true),
    });

    // Deduplicate by id
    const allIds = new Set([
      ...users.map(u => u.id),
      ...usersWithActiveWarning.map(u => u.id),
    ]);

    const writes = Array.from(allIds).map(uid =>
      batchUpdateOp(env, `users/${uid}`, {
        gcsScore:           100,
        gcsLastDeductionAt: null,
        warningCount:       0,
        hasActiveWarning:   false,
        hasNewWarning:      false,
        warningReason:      null,
        warningIssuedAt:    null,
      })
    );

    for (let i = 0; i < writes.length; i += 500) {
      await batchWrite(env, writes.slice(i, i + 500));
    }

    return json({ success: true, affected: allIds.size });
  });

  // ── Clear all backpacks ──
  router.post('/api/cleanup/all-backpacks', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    // We cannot query subcollections in a collection group easily via REST,
    // so query all users and delete their backpack subcollection items.
    // For large datasets this is done by listing users and purging each backpack.
    const users = await queryCollection(env, 'users', {
      orderBy: [orderBy('uid', 'ASCENDING')],
    });

    let deleted = 0;
    for (const user of users) {
      const uid = user.uid ?? user.id;
      const items = await queryCollection(env, `users/${uid}/backpack`, {});
      if (items.length === 0) continue;

      const writes = items.map(item => batchDeleteOp(env, `users/${uid}/backpack/${item.id}`));
      for (let i = 0; i < writes.length; i += 500) {
        await batchWrite(env, writes.slice(i, i + 500));
      }
      deleted += items.length;
    }

    return json({ success: true, deleted });
  });

  // ── Clear all gift walls ──
  router.post('/api/cleanup/all-giftwalls', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const [giftWall, giftWallSenders] = await Promise.all([
      queryCollection(env, 'giftWall', {}),
      queryCollection(env, 'giftWallSenders', {}),
    ]);

    const writes = [
      ...giftWall.map(d => batchDeleteOp(env, `giftWall/${d.id}`)),
      ...giftWallSenders.map(d => batchDeleteOp(env, `giftWallSenders/${d.id}`)),
    ];

    for (let i = 0; i < writes.length; i += 500) {
      await batchWrite(env, writes.slice(i, i + 500));
    }

    return json({ success: true });
  });

  // ── Reset all coins ──
  router.post('/api/cleanup/all-coins', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const users = await queryCollection(env, 'users', {
      where: fieldFilter('shyCoins', 'GREATER_THAN', 0),
    });

    const writes = users.map(u =>
      batchUpdateOp(env, `users/${u.id}`, { shyCoins: 0 })
    );

    for (let i = 0; i < writes.length; i += 500) {
      await batchWrite(env, writes.slice(i, i + 500));
    }

    return json({ success: true });
  });

  // ── Reset all beans ──
  router.post('/api/cleanup/all-beans', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const users = await queryCollection(env, 'users', {
      where: fieldFilter('shyBeans', 'GREATER_THAN', 0),
    });

    const writes = users.map(u =>
      batchUpdateOp(env, `users/${u.id}`, { shyBeans: 0 })
    );

    for (let i = 0; i < writes.length; i += 500) {
      await batchWrite(env, writes.slice(i, i + 500));
    }

    return json({ success: true });
  });

  // ── Delete gacha spin history + reset pity ──
  router.post('/api/cleanup/all-spin-history', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    // Clear pity counters on all users who have one
    const usersWithPity = await queryCollection(env, 'users', {
      where: fieldFilter('pityCounter', 'GREATER_THAN', 0),
    });

    const userWrites = usersWithPity.map(u =>
      batchUpdateOp(env, `users/${u.id}`, { pityCounter: 0 })
    );
    for (let i = 0; i < userWrites.length; i += 500) {
      await batchWrite(env, userWrites.slice(i, i + 500));
    }

    // Delete GACHA_PULL transactions from every user's transactions subcollection
    // This requires iterating users (Firestore REST has no collection group delete)
    const users = await queryCollection(env, 'users', {
      orderBy: [orderBy('uid', 'ASCENDING')],
    });

    for (const user of users) {
      const uid = user.uid ?? user.id;
      const gachaTxs = await queryCollection(env, `users/${uid}/transactions`, {
        where: fieldFilter('type', 'EQUAL', 'GACHA_PULL'),
      });
      if (gachaTxs.length === 0) continue;

      const writes = gachaTxs.map(tx =>
        batchDeleteOp(env, `users/${uid}/transactions/${tx.id}`)
      );
      for (let i = 0; i < writes.length; i += 500) {
        await batchWrite(env, writes.slice(i, i + 500));
      }
    }

    return json({ success: true });
  });

  // ── Clear Super Shy status ──
  router.post('/api/cleanup/all-supershy', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const users = await queryCollection(env, 'users', {
      where: fieldFilter('isSuperShy', 'EQUAL', true),
    });

    const writes = users.map(u =>
      batchUpdateOp(env, `users/${u.id}`, {
        isSuperShy:               false,
        superShyExpiry:           null,
        superShyTier:             null,
        hasClaimedSuperShyTrial:  false,
      })
    );

    for (let i = 0; i < writes.length; i += 500) {
      await batchWrite(env, writes.slice(i, i + 500));
    }

    return json({ success: true });
  });

  // ── Delete all suspension appeals ──
  router.post('/api/cleanup/all-appeals', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const appeals = await queryCollection(env, 'suspensionAppeals', {});

    const writes = appeals.map(a => batchDeleteOp(env, `suspensionAppeals/${a.id}`));
    for (let i = 0; i < writes.length; i += 500) {
      await batchWrite(env, writes.slice(i, i + 500));
    }

    return json({ success: true, deleted: appeals.length });
  });

  // ══════════════════════════════════════════════════════════════
  // STORAGE AUDIT & ORPHAN CLEANUP
  // ══════════════════════════════════════════════════════════════

  // ── R2 folder audit ──
  router.get('/api/storage/audit', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const folders = [
      'pm_images/', 'stickers/', 'report_evidence/',
      'profile_photos/', 'cover_photos/', 'group_photos/', 'banners/',
    ];
    const results = {};
    let totalFiles = 0;
    let totalBytes = 0;

    for (const folder of folders) {
      let count = 0;
      let bytes = 0;
      let cursor;
      do {
        const listed = await env.R2_BUCKET.list({ prefix: folder, cursor, limit: 1000 });
        for (const obj of listed.objects) {
          count++;
          bytes += obj.size;
        }
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);

      const name = folder.replace('/', '');
      results[name] = { count, bytes };
      totalFiles += count;
      totalBytes += bytes;
    }

    return json({ folders: results, totalFiles, totalBytes });
  });

  // ── Smart R2 orphan cleanup ──
  router.post('/api/cleanup/orphaned-storage', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const CDN_PREFIX = 'https://images.shytalk.shyden.co.uk/';
    const extractKey = (url) => {
      if (!url || !url.startsWith(CDN_PREFIX)) return null;
      return url.slice(CDN_PREFIX.length);
    };

    const referencedKeys = new Set();
    referencedKeys.add('system/shytalk_icon.webp');

    // ── Users ──
    const users = await queryCollection(env, 'users', {
      orderBy: [orderBy('uid', 'ASCENDING')],
    });
    for (const u of users) {
      for (const field of [
        'profilePhotoUrl', 'coverPhotoUrl',
        'preSuspensionProfilePhotoUrl', 'preSuspensionCoverPhotoUrl',
        // Legacy snake_case fallbacks
        'profile_photo_url', 'cover_photo_url',
        'pre_suspension_profile_photo_url', 'pre_suspension_cover_photo_url',
      ]) {
        const k = extractKey(u[field]);
        if (k) referencedKeys.add(k);
      }
    }

    // ── Conversations (group photo) ──
    const convs = await queryCollection(env, 'conversations', {
      where: fieldFilter('isGroup', 'EQUAL', true),
    });
    for (const c of convs) {
      const k = extractKey(c.groupPhotoUrl ?? c.group_photo_url);
      if (k) referencedKeys.add(k);
    }

    // ── Private messages (IMAGE type) ──
    // Subcollection — iterate conversations and query messages
    for (const conv of convs) {
      const messages = await queryCollection(env, `conversations/${conv.id}/messages`, {
        where: fieldFilter('type', 'EQUAL', 'IMAGE'),
      });
      for (const msg of messages) {
        const urls = msg.imageUrls ?? msg.image_urls;
        if (Array.isArray(urls)) {
          for (const url of urls) {
            const k = extractKey(url);
            if (k) referencedKeys.add(k);
          }
        }
      }
    }

    // ── Room messages (IMAGE type) ──
    const rooms = await queryCollection(env, 'rooms', {});
    for (const room of rooms) {
      const messages = await queryCollection(env, `rooms/${room.id}/messages`, {
        where: fieldFilter('type', 'EQUAL', 'IMAGE'),
      });
      for (const msg of messages) {
        const urls = msg.imageUrls ?? msg.image_urls;
        if (Array.isArray(urls)) {
          for (const url of urls) {
            const k = extractKey(url);
            if (k) referencedKeys.add(k);
          }
        }
      }
    }

    // ── Reports + archive ──
    const [reports, reportsArchive] = await Promise.all([
      queryCollection(env, 'reports', {}),
      queryCollection(env, 'reportsArchive', {}),
    ]);
    for (const row of [...reports, ...reportsArchive]) {
      const urls = row.evidenceUrls ?? row.evidence_urls;
      if (Array.isArray(urls)) {
        for (const url of urls) {
          const k = extractKey(url);
          if (k) referencedKeys.add(k);
        }
      }
    }

    // ── Banners ──
    const banners = await queryCollection(env, 'banners', {});
    for (const b of banners) {
      const k = extractKey(b.imageUrl ?? b.image_url);
      if (k) referencedKeys.add(k);
    }

    // ── List and delete orphans ──
    const folders = [
      'pm_images/', 'stickers/', 'report_evidence/',
      'profile_photos/', 'cover_photos/', 'group_photos/', 'banners/',
    ];
    const summary = {};
    let totalDeleted = 0;

    for (const folder of folders) {
      const allKeys = [];
      let cursor;
      do {
        const listed = await env.R2_BUCKET.list({ prefix: folder, cursor, limit: 1000 });
        for (const obj of listed.objects) allKeys.push(obj.key);
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);

      const toDelete = allKeys.filter(k => !referencedKeys.has(k));
      for (const key of toDelete) {
        await env.R2_BUCKET.delete(key);
      }

      summary[folder.replace('/', '')] = { total: allKeys.length, deleted: toDelete.length };
      totalDeleted += toDelete.length;
    }

    return json({ success: true, summary, totalDeleted });
  });
}

/**
 * Delete a conversation and all its associated subcollection data from Firestore.
 *
 * Deletes:
 *  - conversations/{convId}/messages/* (all messages)
 *  - conversations/{convId}/userSettings/* (per-user settings)
 *  - conversations/{convId}/mutes/* (mute records)
 *  - conversations/{convId} (the conversation doc itself)
 */
async function deleteConversation(env, convId) {
  const [messages, userSettings, mutes] = await Promise.all([
    queryCollection(env, `conversations/${convId}/messages`, {}),
    queryCollection(env, `conversations/${convId}/userSettings`, {}),
    queryCollection(env, `conversations/${convId}/mutes`, {}),
  ]);

  const writes = [
    ...messages.map(m => batchDeleteOp(env, `conversations/${convId}/messages/${m.id}`)),
    ...userSettings.map(s => batchDeleteOp(env, `conversations/${convId}/userSettings/${s.id}`)),
    ...mutes.map(m => batchDeleteOp(env, `conversations/${convId}/mutes/${m.id}`)),
    batchDeleteOp(env, `conversations/${convId}`),
  ];

  for (let i = 0; i < writes.length; i += 500) {
    await batchWrite(env, writes.slice(i, i + 500));
  }
}

/**
 * Delete all R2 objects under a prefix.
 */
async function deleteR2Prefix(env, prefix) {
  let cursor;
  do {
    const listed = await env.R2_BUCKET.list({ prefix, cursor, limit: 1000 });
    for (const obj of listed.objects) {
      await env.R2_BUCKET.delete(obj.key);
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

module.exports = { registerAdminCleanupRoutes };

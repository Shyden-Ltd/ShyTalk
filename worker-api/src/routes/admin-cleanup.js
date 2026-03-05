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
 * POST /api/cleanup/backfill-user-type          → Set userType=MEMBER for users missing it
 * POST /api/cleanup/all-private-messages       → Delete all 1-on-1 PMs + R2 media
 * POST /api/cleanup/all-group-chats            → Delete all group chats + R2 media
 * POST /api/cleanup/all-rooms                  → Delete all closed rooms + subcollections
 * POST /api/cleanup/all-broadcasts             → Delete all broadcast records
 * POST /api/cleanup/all-audit-logs             → Delete all admin audit logs
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

    // Gift wall data is stored as subcollections: users/{uid}/giftWall/{giftId}
    const users = await queryCollection(env, 'users', {
      orderBy: [orderBy('uid', 'ASCENDING')],
    });

    let deleted = 0;
    for (const user of users) {
      const uid = user.uid ?? user.id;
      const gifts = await queryCollection(env, `users/${uid}/giftWall`, {});
      if (gifts.length === 0) continue;

      const writes = gifts.map(gift => batchDeleteOp(env, `users/${uid}/giftWall/${gift.id}`));
      for (let i = 0; i < writes.length; i += 500) {
        await batchWrite(env, writes.slice(i, i + 500));
      }
      deleted += gifts.length;
    }

    return json({ success: true, deleted });
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

    return json({ success: true, affected: users.length });
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

    return json({ success: true, affected: users.length });
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

    let txDeleted = 0;
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
      txDeleted += gachaTxs.length;
    }

    return json({ success: true, pityReset: usersWithPity.length, txDeleted });
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

    return json({ success: true, affected: users.length });
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
  // NOTE: This endpoint makes many Firestore queries (one per conversation and room)
  // and may hit Workers execution time limits with large datasets.
  router.post('/api/cleanup/orphaned-storage', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    try {
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

      // ── Private messages (IMAGE type) — batch to avoid timeout ──
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
    } catch (err) {
      console.error('orphaned-storage cleanup error:', err.message);
      return jsonError(`Cleanup failed: ${err.message}`, 500);
    }
  });

  // ── Clean up destroyed user profiles ──
  // Identifies user docs that were corrupted by the batchUpdateOp bug
  // (missing createdAt = never properly created) and deletes them.
  router.post('/api/cleanup/destroyed-users', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const users = await queryCollection(env, 'users', { limit: 5000 });

    // A user is "destroyed" if they're missing createdAt (always set on real creation)
    const destroyed = users.filter(u => !u.createdAt);
    const intact = users.length - destroyed.length;

    if (destroyed.length === 0) {
      return json({ success: true, destroyed: 0, intact, message: 'No destroyed users found' });
    }

    const writes = destroyed.map(u => batchDeleteOp(env, `users/${u.id}`));
    for (let i = 0; i < writes.length; i += 500) {
      await batchWrite(env, writes.slice(i, i + 500));
    }

    return json({
      success: true,
      destroyed: destroyed.length,
      intact,
      deletedUids: destroyed.map(u => u.id),
    });
  });

  // ── Delete all device bindings ──
  // Allows destroyed users to re-register on the same device.
  router.post('/api/cleanup/all-device-bindings', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const bindings = await queryCollection(env, 'deviceBindings', { limit: 5000 });

    if (bindings.length === 0) {
      return json({ success: true, deleted: 0, message: 'No device bindings found' });
    }

    const writes = bindings.map(b => batchDeleteOp(env, `deviceBindings/${b.id}`));
    for (let i = 0; i < writes.length; i += 500) {
      await batchWrite(env, writes.slice(i, i + 500));
    }

    return json({ success: true, deleted: bindings.length });
  });

  // ── Delete device binding for a specific user ──
  router.post('/api/cleanup/device-binding/:uid', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const uid = params.uid;
    // Find bindings where userId matches
    const bindings = await queryCollection(env, 'deviceBindings', {
      where: fieldFilter('userId', 'EQUAL', uid),
      limit: 50,
    });

    if (bindings.length === 0) {
      return json({ success: true, deleted: 0, message: 'No device bindings for this user' });
    }

    const writes = bindings.map(b => batchDeleteOp(env, `deviceBindings/${b.id}`));
    await batchWrite(env, writes);

    return json({ success: true, deleted: bindings.length });
  });

  // ── Backfill userType for users missing it ──
  router.post('/api/cleanup/backfill-user-type', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const users = await queryCollection(env, 'users', { limit: 5000 });
    const missing = users.filter(u => !u.userType && !u.user_type);

    if (missing.length === 0) {
      return json({ success: true, updated: 0, message: 'All users already have a userType' });
    }

    const writes = missing.map(u =>
      batchUpdateOp(env, `users/${u.uid ?? u.id}`, { userType: 'MEMBER' })
    );
    for (let i = 0; i < writes.length; i += 500) {
      await batchWrite(env, writes.slice(i, i + 500));
    }

    return json({ success: true, updated: missing.length });
  });

  // ── Delete all private messages (1-on-1 conversations) + R2 media ──
  router.post('/api/cleanup/all-private-messages', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    // Get all non-group conversations
    const allConvs = await queryCollection(env, 'conversations', { limit: 5000 });
    const pms = allConvs.filter(c => !c.isGroup);

    if (pms.length === 0) {
      return json({ success: true, deleted: 0, mediaDeleted: 0, message: 'No private messages found' });
    }

    // Collect image URLs from messages before deleting
    let mediaDeleted = 0;
    const CDN_PREFIX = 'https://images.shytalk.shyden.co.uk/';

    for (const conv of pms) {
      const messages = await queryCollection(env, `conversations/${conv.id}/messages`, {});
      for (const msg of messages) {
        const urls = msg.imageUrls || [];
        for (const url of urls) {
          if (url && url.startsWith(CDN_PREFIX)) {
            try { await env.R2_BUCKET.delete(url.slice(CDN_PREFIX.length)); mediaDeleted++; } catch (_) {}
          }
        }
      }
      await deleteConversation(env, conv.id);
    }

    return json({ success: true, deleted: pms.length, mediaDeleted });
  });

  // ── Delete all group chats + R2 media ──
  router.post('/api/cleanup/all-group-chats', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const allConvs = await queryCollection(env, 'conversations', {
      where: fieldFilter('isGroup', 'EQUAL', true),
      limit: 5000,
    });

    if (allConvs.length === 0) {
      return json({ success: true, deleted: 0, mediaDeleted: 0, message: 'No group chats found' });
    }

    const CDN_PREFIX = 'https://images.shytalk.shyden.co.uk/';
    let mediaDeleted = 0;

    for (const conv of allConvs) {
      // Delete group photo from R2
      const photoUrl = conv.groupPhotoUrl || conv.group_photo_url;
      if (photoUrl && photoUrl.startsWith(CDN_PREFIX)) {
        try { await env.R2_BUCKET.delete(photoUrl.slice(CDN_PREFIX.length)); mediaDeleted++; } catch (_) {}
      }
      // Delete message images
      const messages = await queryCollection(env, `conversations/${conv.id}/messages`, {});
      for (const msg of messages) {
        const urls = msg.imageUrls || [];
        for (const url of urls) {
          if (url && url.startsWith(CDN_PREFIX)) {
            try { await env.R2_BUCKET.delete(url.slice(CDN_PREFIX.length)); mediaDeleted++; } catch (_) {}
          }
        }
      }
      await deleteConversation(env, conv.id);
    }

    return json({ success: true, deleted: allConvs.length, mediaDeleted });
  });

  // ── Delete all closed rooms + subcollections ──
  router.post('/api/cleanup/all-rooms', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const closedRooms = await queryCollection(env, 'rooms', {
      where: fieldFilter('state', 'EQUAL', 'CLOSED'),
      limit: 5000,
    });

    if (closedRooms.length === 0) {
      return json({ success: true, deleted: 0, message: 'No closed rooms found' });
    }

    for (const room of closedRooms) {
      await deleteRoom(env, room.id);
    }

    return json({ success: true, deleted: closedRooms.length });
  });

  // ── Delete all broadcasts ──
  router.post('/api/cleanup/all-broadcasts', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const broadcasts = await queryCollection(env, 'broadcasts', { limit: 5000 });

    if (broadcasts.length === 0) {
      return json({ success: true, deleted: 0, message: 'No broadcasts found' });
    }

    const writes = broadcasts.map(b => batchDeleteOp(env, `broadcasts/${b.id}`));
    for (let i = 0; i < writes.length; i += 500) {
      await batchWrite(env, writes.slice(i, i + 500));
    }

    return json({ success: true, deleted: broadcasts.length });
  });

  // ── Delete all admin audit logs ──
  router.post('/api/cleanup/all-audit-logs', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const logs = await queryCollection(env, 'adminAuditLog', { limit: 5000 });

    if (logs.length === 0) {
      return json({ success: true, deleted: 0, message: 'No audit logs found' });
    }

    const writes = logs.map(l => batchDeleteOp(env, `adminAuditLog/${l.id}`));
    for (let i = 0; i < writes.length; i += 500) {
      await batchWrite(env, writes.slice(i, i + 500));
    }

    return json({ success: true, deleted: logs.length });
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
 * Delete a room and all its associated subcollection data from Firestore.
 */
async function deleteRoom(env, roomId) {
  const [messages, seatRequests] = await Promise.all([
    queryCollection(env, `rooms/${roomId}/messages`, {}),
    queryCollection(env, `rooms/${roomId}/seatRequests`, {}),
  ]);

  const writes = [
    ...messages.map(m => batchDeleteOp(env, `rooms/${roomId}/messages/${m.id}`)),
    ...seatRequests.map(s => batchDeleteOp(env, `rooms/${roomId}/seatRequests/${s.id}`)),
    batchDeleteOp(env, `rooms/${roomId}`),
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

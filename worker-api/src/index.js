/**
 * ShyTalk Worker API — main entry point.
 *
 * Routes all HTTP requests to the appropriate handler module.
 * Handles CORS, authentication, and cron triggers.
 *
 * Firestore is the sole database (no D1).
 */

const { authMiddleware, optionalAuth } = require('./middleware/auth');
const { Router, json, jsonError, corsResponse } = require('./utils');
const { registerConfigRoutes } = require('./routes/config');
const { registerUserRoutes } = require('./routes/users');
const { registerEconomyRoutes } = require('./routes/economy');
const { registerLiveKitRoutes } = require('./routes/livekit');
const { registerReportRoutes } = require('./routes/reports');
const { registerNotificationRoutes } = require('./routes/notifications');
const { registerRoomRoutes } = require('./routes/rooms');
const { registerConversationRoutes } = require('./routes/conversations');
const { registerBannerRoutes } = require('./routes/banners');
const { registerFunFactRoutes } = require('./routes/fun-facts');
const { registerAdminUserRoutes } = require('./routes/admin-users');
const { registerAdminEconomyRoutes } = require('./routes/admin-economy');
const { registerAdminGiftRoutes } = require('./routes/admin-gifts');
const { registerAdminCleanupRoutes } = require('./routes/admin-cleanup');
const {
  isCircuitOpen,
  getDoc, setDoc, updateDoc, deleteDoc,
  queryCollection, batchWrite, batchUpdateOp, batchDeleteOp,
  fieldFilter, andFilter, orderBy,
} = require('./utils/firestore');

const router = new Router();

// ── Register all route modules ──
registerConfigRoutes(router);
registerUserRoutes(router);
registerEconomyRoutes(router);
registerLiveKitRoutes(router);
registerReportRoutes(router);
registerNotificationRoutes(router);
registerRoomRoutes(router);
registerConversationRoutes(router);
registerBannerRoutes(router);
registerFunFactRoutes(router);
registerAdminUserRoutes(router);
registerAdminEconomyRoutes(router);
registerAdminGiftRoutes(router);
registerAdminCleanupRoutes(router);

// ── Health check (no auth) ──
router.get('/api/health', async (request, env) => {
  const circuitOpen = await isCircuitOpen(env);
  return json({
    status: circuitOpen ? 'degraded' : 'ok',
    firestoreAvailable: !circuitOpen,
    timestamp: Date.now(),
  });
});

// ── Admin search endpoints ──
router.get('/api/admin/search/unique-id/:id', async (request, env, params) => {
  const { requireAdmin } = require('./middleware/auth');
  const adminCheck = requireAdmin(request);
  if (adminCheck) return adminCheck;

  const results = await queryCollection(env, 'users', {
    where: fieldFilter('uniqueId', 'EQUAL', parseInt(params.id)),
    limit: 1,
  });

  if (results.length === 0) return jsonError('User not found', 404);
  return json(results[0]);
});

router.post('/api/admin/resolve/uids-to-unique-ids', async (request, env) => {
  const { requireAdmin } = require('./middleware/auth');
  const adminCheck = requireAdmin(request);
  if (adminCheck) return adminCheck;

  const body = await request.json();
  const uids = body?.uids || [];
  if (uids.length === 0) return json({});

  const docs = await Promise.all(uids.map(uid => getDoc(env, `users/${uid}`)));
  const map = {};
  for (let i = 0; i < uids.length; i++) {
    if (docs[i]) {
      map[uids[i]] = docs[i].uniqueId ?? docs[i].unique_id ?? null;
    }
  }
  return json(map);
});

router.post('/api/admin/resolve/unique-ids-to-uids', async (request, env) => {
  const { requireAdmin } = require('./middleware/auth');
  const adminCheck = requireAdmin(request);
  if (adminCheck) return adminCheck;

  const body = await request.json();
  const uniqueIds = body?.uniqueIds || [];
  if (uniqueIds.length === 0) return json({});

  // Query for each unique ID individually (Firestore IN filter max 30)
  const map = {};
  for (const uniqueId of uniqueIds) {
    const results = await queryCollection(env, 'users', {
      where: fieldFilter('uniqueId', 'EQUAL', uniqueId),
      limit: 1,
    });
    if (results.length > 0) {
      map[uniqueId] = results[0].id;
    }
  }
  return json(map);
});

// ── Routes that do NOT require authentication ──
const PUBLIC_ROUTES = ['/api/health'];

// ── Routes that use optional auth ──
const OPTIONAL_AUTH_ROUTES = [];

export default {
  async fetch(request, env, ctx) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse();
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    // Check if route is public
    const isPublic = PUBLIC_ROUTES.some(r => pathname === r);
    const isOptionalAuth = OPTIONAL_AUTH_ROUTES.some(r => pathname.startsWith(r));

    // Authenticate
    if (!isPublic) {
      const authResult = isOptionalAuth
        ? await optionalAuth(request, env)
        : await authMiddleware(request, env);

      if (authResult) return authResult; // auth failed, return error response
    }

    // Attach execution context so route handlers can use ctx.waitUntil()
    request.ctx = ctx;

    // Route matching
    const match = router.match(request.method, pathname);
    if (!match) {
      return jsonError('Not found', 404);
    }

    try {
      return await match.handler(request, env, match.params);
    } catch (err) {
      console.error(`Error handling ${request.method} ${pathname}:`, err);
      return jsonError('Internal server error', 500);
    }
  },

  /**
   * Cron trigger handler.
   * Dispatches based on the cron expression.
   * All handlers use Firestore (no D1).
   */
  async scheduled(event, env, ctx) {
    const cron = event.cron;

    switch (cron) {
      case '0 3 * * SUN': // Archive old reports (Sunday 03:00)
        await archiveOldReports(env);
        break;

      case '0 4 * * *': // Cleanup orphaned storage (daily 04:00)
        await cleanupOrphanedStorage(env);
        break;

      case '0 0 * * *': // Check subscription status + clean expired backpack (daily midnight)
        await checkSubscriptionStatus(env);
        await cleanExpiredBackpackItems(env);
        break;

      // Note: updateGiftRankings cron removed — rankings now updated incrementally
      // in economy.js when gifts are sent

      case '*/5 * * * *': // Close stale OWNER_AWAY rooms (every 5 minutes)
        await closeStaleOwnerAwayRooms(env);
        break;

      default:
        console.log(`Unknown cron: ${cron}`);
    }
  },
};

// ── Cron handlers — all use Firestore ──

async function archiveOldReports(env) {
  const sixMonthsAgo = Date.now() - (6 * 30 * 24 * 60 * 60 * 1000);

  const reports = await queryCollection(env, 'reports', {
    where: andFilter(
      fieldFilter('status', 'EQUAL', 'resolved'),
      fieldFilter('resolvedAt', 'LESS_THAN', sixMonthsAgo)
    ),
    limit: 500,
  });

  if (reports.length === 0) return;

  const writes = [];
  for (const report of reports) {
    // Copy to archive collection
    writes.push(batchUpdateOp(env, `reportsArchive/${report.id}`, report));
    // Delete from active reports
    writes.push(batchDeleteOp(env, `reports/${report.id}`));
  }

  // Batch in chunks of 500
  for (let i = 0; i < writes.length; i += 500) {
    await batchWrite(env, writes.slice(i, i + 500));
  }

  console.log(`Archived ${reports.length} old reports`);
}

async function checkSubscriptionStatus(env) {
  const timestamp = Date.now();

  // Query users with expired SuperShy subscriptions (excluding lifetime)
  const expired = await queryCollection(env, 'users', {
    where: andFilter(
      fieldFilter('isSuperShy', 'EQUAL', true),
      fieldFilter('superShyExpiry', 'LESS_THAN_OR_EQUAL', timestamp)
    ),
    limit: 500,
  });

  // Filter out lifetime subscribers client-side
  const toExpire = expired.filter(u => u.superShyTier !== 'lifetime');

  if (toExpire.length === 0) return;

  const writes = toExpire.map(u =>
    batchUpdateOp(env, `users/${u.id}`, {
      isSuperShy: false,
      superShyExpiry: null,
      superShyTier: null,
    })
  );

  for (let i = 0; i < writes.length; i += 500) {
    await batchWrite(env, writes.slice(i, i + 500));
  }

  console.log(`Expired ${toExpire.length} Super Shy subscriptions`);
}

async function closeStaleOwnerAwayRooms(env) {
  const tenMinutesAgo = Date.now() - (10 * 60 * 1000);

  const staleRooms = await queryCollection(env, 'rooms', {
    where: fieldFilter('state', 'EQUAL', 'OWNER_AWAY'),
    limit: 100,
  });

  // Filter by ownerLeftAt client-side (Firestore needs composite index for two inequality fields)
  const toClose = staleRooms.filter(r =>
    r.ownerLeftAt && r.ownerLeftAt < tenMinutesAgo
  );

  if (toClose.length === 0) return;

  const timestamp = Date.now();
  const emptySeat = { userId: null, state: 'EMPTY', isMuted: false };
  const emptySeats = {};
  for (let i = 0; i < 8; i++) emptySeats[String(i)] = { ...emptySeat };

  const writes = toClose.map(room =>
    batchUpdateOp(env, `rooms/${room.id}`, {
      state: 'CLOSED',
      closedAt: timestamp,
      ownerLeftAt: null,
      seats: emptySeats,
      participantIds: [],
    })
  );

  // Also clear currentRoomId for all participants
  for (const room of toClose) {
    const pids = room.participantIds || [];
    for (const pid of pids) {
      writes.push(batchUpdateOp(env, `users/${pid}`, { currentRoomId: null }));
    }
  }

  for (let i = 0; i < writes.length; i += 500) {
    await batchWrite(env, writes.slice(i, i + 500));
  }

  console.log(`Closed ${toClose.length} stale OWNER_AWAY rooms`);
}

async function cleanExpiredBackpackItems(env) {
  const timestamp = Date.now();
  let totalCleaned = 0;

  // Query all users, then check each user's backpack for expired items
  // This is expensive but runs once daily at midnight
  const users = await queryCollection(env, 'users', { limit: 1000 });

  for (const user of users) {
    const backpackItems = await queryCollection(env, `users/${user.id}/backpack`, {});
    const expired = backpackItems.filter(
      item => item.expiresAt && item.expiresAt <= timestamp
    );

    if (expired.length > 0) {
      const deletes = expired.map(item =>
        batchDeleteOp(env, `users/${user.id}/backpack/${item.giftId || item.id}`)
      );
      await batchWrite(env, deletes);
      totalCleaned += expired.length;
    }
  }

  console.log(`Cleaned ${totalCleaned} expired backpack items`);
}

async function cleanupOrphanedStorage(env) {
  const CDN_PREFIX = 'https://images.shytalk.shyden.co.uk/';
  const extractKey = (url) => {
    if (!url || !url.startsWith(CDN_PREFIX)) return null;
    return url.slice(CDN_PREFIX.length);
  };

  const referencedKeys = new Set();
  referencedKeys.add('system/shytalk_icon.webp');

  // Users → profilePhotoUrl, coverPhotoUrl, preSuspension*
  const users = await queryCollection(env, 'users', { limit: 2000 });
  for (const u of users) {
    for (const url of [
      u.profilePhotoUrl || u.profile_photo_url,
      u.coverPhotoUrl || u.cover_photo_url,
      u.preSuspensionProfilePhotoUrl || u.pre_suspension_profile_photo_url,
      u.preSuspensionCoverPhotoUrl || u.pre_suspension_cover_photo_url,
    ]) {
      const k = extractKey(url);
      if (k) referencedKeys.add(k);
    }
  }

  // Conversations → groupPhotoUrl
  const convs = await queryCollection(env, 'conversations', { limit: 2000 });
  for (const c of convs) {
    const k = extractKey(c.groupPhotoUrl || c.group_photo_url);
    if (k) referencedKeys.add(k);
  }

  // Conversation messages → imageUrls (array), stickerUrl
  // This is expensive — iterate conversations and query image/sticker messages
  for (const conv of convs) {
    const imageMessages = await queryCollection(env, `conversations/${conv.id}/messages`, {
      where: fieldFilter('type', 'EQUAL', 'IMAGE'),
      limit: 500,
    });
    for (const msg of imageMessages) {
      const urls = msg.imageUrls || msg.image_urls || [];
      const urlArray = Array.isArray(urls) ? urls : [];
      for (const url of urlArray) {
        const k = extractKey(url);
        if (k) referencedKeys.add(k);
      }
    }

    const stickerMessages = await queryCollection(env, `conversations/${conv.id}/messages`, {
      where: fieldFilter('type', 'EQUAL', 'STICKER'),
      limit: 500,
    });
    for (const msg of stickerMessages) {
      const k = extractKey(msg.stickerUrl || msg.sticker_url);
      if (k) referencedKeys.add(k);
    }
  }

  // Reports + archive → evidenceUrls (array)
  for (const collection of ['reports', 'reportsArchive']) {
    const rows = await queryCollection(env, collection, { limit: 1000 });
    for (const row of rows) {
      const urls = row.evidenceUrls || row.evidence_urls || [];
      const urlArray = Array.isArray(urls) ? urls : [];
      for (const url of urlArray) {
        const k = extractKey(url);
        if (k) referencedKeys.add(k);
      }
    }
  }

  // Banners → imageUrl
  const banners = await queryCollection(env, 'banners', { limit: 500 });
  for (const b of banners) {
    const k = extractKey(b.imageUrl || b.image_url);
    if (k) referencedKeys.add(k);
  }

  // List and delete orphaned R2 objects using native R2 API
  const folders = ['pm_images/', 'stickers/', 'report_evidence/', 'profile_photos/', 'cover_photos/', 'group_photos/', 'banners/'];
  const results = {};
  let totalDeleted = 0;

  for (const folder of folders) {
    const allKeys = [];
    let cursor;
    do {
      const listed = await env.R2_BUCKET.list({ prefix: folder, cursor, limit: 1000 });
      for (const obj of listed.objects) {
        allKeys.push(obj.key);
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);

    const toDelete = allKeys.filter((k) => !referencedKeys.has(k));

    for (const key of toDelete) {
      await env.R2_BUCKET.delete(key);
    }

    results[folder.replace('/', '')] = { total: allKeys.length, deleted: toDelete.length };
    totalDeleted += toDelete.length;
    console.log(`${folder}: ${toDelete.length}/${allKeys.length} files deleted`);
  }

  console.log(`Orphaned storage cleanup complete: ${totalDeleted} files deleted`);
}

/**
 * ShyTalk Worker API — main entry point.
 *
 * Routes all HTTP requests to the appropriate handler module.
 * Handles CORS, authentication, and cron triggers.
 */

import { RoomDurableObject } from './durable-objects/RoomDurableObject';
import { ConversationDurableObject } from './durable-objects/ConversationDurableObject';

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

// Re-export Durable Object classes
export { RoomDurableObject, ConversationDurableObject };

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

// ── Health check (no auth) ──
router.get('/api/health', async () => {
  return json({ status: 'ok', timestamp: Date.now() });
});

// ── Admin search endpoints (replaces admin.js Express API) ──
router.get('/api/admin/search/unique-id/:id', async (request, env, params) => {
  const { requireAdmin } = require('./middleware/auth');
  const adminCheck = requireAdmin(request);
  if (adminCheck) return adminCheck;

  const user = await env.DB.prepare(
    'SELECT * FROM users WHERE unique_id = ?'
  ).bind(parseInt(params.id)).first();

  if (!user) return jsonError('User not found', 404);
  return json(user);
});

router.post('/api/admin/resolve/uids-to-unique-ids', async (request, env) => {
  const { requireAdmin } = require('./middleware/auth');
  const adminCheck = requireAdmin(request);
  if (adminCheck) return adminCheck;

  const body = await request.json();
  const uids = body?.uids || [];
  if (uids.length === 0) return json({});

  const placeholders = uids.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT uid, unique_id FROM users WHERE uid IN (${placeholders})`
  ).bind(...uids).all();

  const map = {};
  for (const r of results) map[r.uid] = r.unique_id;
  return json(map);
});

router.post('/api/admin/resolve/unique-ids-to-uids', async (request, env) => {
  const { requireAdmin } = require('./middleware/auth');
  const adminCheck = requireAdmin(request);
  if (adminCheck) return adminCheck;

  const body = await request.json();
  const uniqueIds = body?.uniqueIds || [];
  if (uniqueIds.length === 0) return json({});

  const placeholders = uniqueIds.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT uid, unique_id FROM users WHERE unique_id IN (${placeholders})`
  ).bind(...uniqueIds).all();

  const map = {};
  for (const r of results) map[r.unique_id] = r.uid;
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
   * Cron trigger handler — replaces Cloud Scheduler.
   * Dispatches based on the cron expression.
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

      case '0 * * * *': // Update gift rankings (hourly)
        await updateGiftRankings(env);
        break;

      default:
        console.log(`Unknown cron: ${cron}`);
    }
  },
};

// ── Cron handlers (Phase 8 stubs — full implementation later) ──

async function archiveOldReports(env) {
  const sixMonthsAgo = Date.now() - (6 * 30 * 24 * 60 * 60 * 1000);

  const { results } = await env.DB.prepare(`
    SELECT * FROM reports WHERE status = 'resolved' AND resolved_at < ? LIMIT 500
  `).bind(sixMonthsAgo).all();

  if (results.length === 0) return;

  const stmts = [];
  for (const report of results) {
    stmts.push(env.DB.prepare(`
      INSERT INTO reports_archive (id, reporter_id, reporter_name, reporter_unique_id,
        reported_user_id, reported_user_name, reported_user_unique_id,
        conversation_id, message_id, message_text, reason, description,
        evidence_urls, status, action_taken, resolved_at, resolved_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      report.id, report.reporter_id, report.reporter_name, report.reporter_unique_id,
      report.reported_user_id, report.reported_user_name, report.reported_user_unique_id,
      report.conversation_id, report.message_id, report.message_text,
      report.reason, report.description, report.evidence_urls,
      report.status, report.action_taken, report.resolved_at, report.resolved_by, report.created_at
    ));
    stmts.push(env.DB.prepare('DELETE FROM reports WHERE id = ?').bind(report.id));
  }

  await env.DB.batch(stmts);
  console.log(`Archived ${results.length} old reports`);
}

async function checkSubscriptionStatus(env) {
  const timestamp = Date.now();

  const { results } = await env.DB.prepare(`
    SELECT uid FROM users
    WHERE is_super_shy = 1 AND super_shy_expiry IS NOT NULL AND super_shy_expiry <= ?
      AND (super_shy_tier IS NULL OR super_shy_tier != 'lifetime')
  `).bind(timestamp).all();

  if (results.length === 0) return;

  const stmts = results.map(r =>
    env.DB.prepare(`
      UPDATE users SET is_super_shy = 0, super_shy_expiry = NULL, super_shy_tier = NULL WHERE uid = ?
    `).bind(r.uid)
  );

  await env.DB.batch(stmts);
  console.log(`Expired ${results.length} Super Shy subscriptions`);
}

async function updateGiftRankings(env) {
  // Get all gifts
  const { results: gifts } = await env.DB.prepare('SELECT id FROM gifts').all();

  for (const gift of gifts) {
    // Aggregate gift wall data
    const { results: rankings } = await env.DB.prepare(`
      SELECT gw.user_id, gw.received_count, u.display_name, u.profile_photo_url
      FROM gift_wall gw
      JOIN users u ON u.uid = gw.user_id
      WHERE gw.gift_id = ?
      ORDER BY gw.received_count DESC
      LIMIT 100
    `).bind(gift.id).all();

    const totalResult = await env.DB.prepare(
      'SELECT COALESCE(SUM(received_count), 0) as total FROM gift_wall WHERE gift_id = ?'
    ).bind(gift.id).first();

    const timestamp = Date.now();

    // Clear old rankings and insert new ones
    const stmts = [
      env.DB.prepare('DELETE FROM gift_rankings WHERE gift_id = ?').bind(gift.id),
    ];

    rankings.forEach((r, i) => {
      stmts.push(env.DB.prepare(`
        INSERT INTO gift_rankings (gift_id, user_id, count, display_name, profile_photo_url, rank)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(gift.id, r.user_id, r.received_count, r.display_name, r.profile_photo_url, i + 1));
    });

    stmts.push(env.DB.prepare(`
      INSERT INTO gift_rankings_meta (gift_id, total_sent, last_updated)
      VALUES (?, ?, ?)
      ON CONFLICT(gift_id) DO UPDATE SET total_sent = ?, last_updated = ?
    `).bind(gift.id, totalResult.total, timestamp, totalResult.total, timestamp));

    await env.DB.batch(stmts);
  }

  console.log('Gift rankings updated');
}

async function cleanExpiredBackpackItems(env) {
  const result = await env.DB.prepare(`
    DELETE FROM backpack_items WHERE expires_at IS NOT NULL AND expires_at <= ?
  `).bind(Date.now()).run();

  console.log(`Cleaned ${result.changes || 0} expired backpack items`);
}

async function cleanupOrphanedStorage(env) {
  const CDN_PREFIX = 'https://images.shytalk.shyden.co.uk/';
  const extractKey = (url) => {
    if (!url || !url.startsWith(CDN_PREFIX)) return null;
    return url.slice(CDN_PREFIX.length);
  };

  const referencedKeys = new Set();
  referencedKeys.add('system/shytalk_icon.webp');

  // Users → profile_photo_url, cover_photo_url, pre_suspension_*
  const { results: users } = await env.DB.prepare(
    'SELECT profile_photo_url, cover_photo_url, pre_suspension_photo_url, pre_suspension_cover_url FROM users'
  ).all();
  for (const u of users) {
    for (const url of [u.profile_photo_url, u.cover_photo_url, u.pre_suspension_photo_url, u.pre_suspension_cover_url]) {
      const k = extractKey(url);
      if (k) referencedKeys.add(k);
    }
  }

  // Conversations → group_photo_url
  const { results: convs } = await env.DB.prepare(
    'SELECT group_photo_url FROM conversations WHERE group_photo_url IS NOT NULL'
  ).all();
  for (const c of convs) {
    const k = extractKey(c.group_photo_url);
    if (k) referencedKeys.add(k);
  }

  // Messages → image_urls (JSON array) for IMAGE type, sticker_url for STICKER type
  const { results: imageMessages } = await env.DB.prepare(
    "SELECT image_urls FROM messages WHERE type = 'IMAGE' AND image_urls IS NOT NULL"
  ).all();
  for (const msg of imageMessages) {
    try {
      const urls = JSON.parse(msg.image_urls);
      for (const url of urls) {
        const k = extractKey(url);
        if (k) referencedKeys.add(k);
      }
    } catch (_) { /* skip malformed JSON */ }
  }

  const { results: stickerMessages } = await env.DB.prepare(
    "SELECT sticker_url FROM messages WHERE type = 'STICKER' AND sticker_url IS NOT NULL"
  ).all();
  for (const msg of stickerMessages) {
    const k = extractKey(msg.sticker_url);
    if (k) referencedKeys.add(k);
  }

  // Reports + archive → evidence_urls (JSON array)
  for (const table of ['reports', 'reports_archive']) {
    const { results: rows } = await env.DB.prepare(
      `SELECT evidence_urls FROM ${table} WHERE evidence_urls IS NOT NULL`
    ).all();
    for (const row of rows) {
      try {
        const urls = JSON.parse(row.evidence_urls);
        for (const url of urls) {
          const k = extractKey(url);
          if (k) referencedKeys.add(k);
        }
      } catch (_) { /* skip malformed JSON */ }
    }
  }

  // List and delete orphaned R2 objects using native R2 API
  const folders = ['pm_images/', 'stickers/', 'report_evidence/', 'profile_photos/', 'cover_photos/', 'group_photos/'];
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

    // Delete orphans in batches (R2 delete is single-key, so batch sequentially)
    for (const key of toDelete) {
      await env.R2_BUCKET.delete(key);
    }

    results[folder.replace('/', '')] = { total: allKeys.length, deleted: toDelete.length };
    totalDeleted += toDelete.length;
    console.log(`${folder}: ${toDelete.length}/${allKeys.length} files deleted`);
  }

  console.log(`Orphaned storage cleanup complete: ${totalDeleted} files deleted`);
}

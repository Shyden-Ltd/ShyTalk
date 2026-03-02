/**
 * Admin cleanup routes — data reset, storage audit, orphan cleanup.
 *
 * All endpoints require admin. They operate on D1 tables and R2 directly.
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
 * POST /api/cleanup/all-appeals                → Delete all appeals
 * GET  /api/storage/audit                      → R2 folder audit
 * POST /api/cleanup/orphaned-storage           → Smart R2 cleanup
 */

const { json, jsonError, now } = require('../utils');
const { requireAdmin } = require('../middleware/auth');

function registerAdminCleanupRoutes(router) {

  // ── Delete duplicate system conversations ──
  router.post('/api/cleanup/system-conversations', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    // Find system conversations with non-deterministic IDs
    // Deterministic format: [uid, SHYTALK_SYSTEM].sort().join('_')
    const { results: systemConvs } = await env.DB.prepare(`
      SELECT c.id FROM conversations c
      JOIN conversation_participants cp ON cp.conversation_id = c.id
      WHERE cp.user_id = 'SHYTALK_SYSTEM' AND c.is_group = 0
    `).all();

    let deleted = 0;
    const seen = new Map(); // recipientUid → first conversation id

    for (const conv of systemConvs) {
      // Get the other participant
      const other = await env.DB.prepare(`
        SELECT user_id FROM conversation_participants
        WHERE conversation_id = ? AND user_id != 'SHYTALK_SYSTEM'
      `).bind(conv.id).first();

      if (!other) continue;
      const expectedId = [other.user_id, 'SHYTALK_SYSTEM'].sort().join('_');

      if (conv.id === expectedId) {
        seen.set(other.user_id, conv.id);
        continue;
      }

      // This is a duplicate — delete it
      if (seen.has(other.user_id)) {
        await deleteConversation(env, conv.id);
        deleted++;
      } else {
        seen.set(other.user_id, conv.id);
      }
    }

    return json({ success: true, deleted });
  });

  // ── Delete ALL system conversations ──
  router.post('/api/cleanup/all-system-conversations', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const { results: systemConvs } = await env.DB.prepare(`
      SELECT c.id FROM conversations c
      JOIN conversation_participants cp ON cp.conversation_id = c.id
      WHERE cp.user_id = 'SHYTALK_SYSTEM' AND c.is_group = 0
    `).all();

    for (const conv of systemConvs) {
      await deleteConversation(env, conv.id);
    }

    return json({ success: true, deleted: systemConvs.length });
  });

  // ── Delete all reports ──
  router.post('/api/cleanup/all-reports', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    // Delete R2 evidence files
    await deleteR2Prefix(env, 'report_evidence/');

    await env.DB.batch([
      env.DB.prepare('DELETE FROM reports'),
      env.DB.prepare('DELETE FROM reports_archive'),
      env.DB.prepare('DELETE FROM report_locks'),
    ]);

    return json({ success: true });
  });

  // ── Reset all warnings ──
  router.post('/api/cleanup/all-warnings', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const result = await env.DB.prepare(`
      UPDATE users SET
        gcs_score = 100,
        gcs_last_deduction_at = NULL,
        warning_count = 0,
        has_active_warning = 0,
        warning_reason = NULL,
        warning_issued_at = NULL
      WHERE warning_count > 0 OR has_active_warning = 1 OR gcs_score < 100
    `).run();

    return json({ success: true, affected: result.changes || 0 });
  });

  // ── Clear all backpacks ──
  router.post('/api/cleanup/all-backpacks', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const result = await env.DB.prepare('DELETE FROM backpack_items').run();
    return json({ success: true, deleted: result.changes || 0 });
  });

  // ── Clear all gift walls ──
  router.post('/api/cleanup/all-giftwalls', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    await env.DB.batch([
      env.DB.prepare('DELETE FROM gift_wall'),
      env.DB.prepare('DELETE FROM gift_wall_senders'),
    ]);

    return json({ success: true });
  });

  // ── Reset all coins ──
  router.post('/api/cleanup/all-coins', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    await env.DB.prepare('UPDATE users SET shy_coins = 0').run();
    return json({ success: true });
  });

  // ── Reset all beans ──
  router.post('/api/cleanup/all-beans', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    await env.DB.prepare('UPDATE users SET shy_beans = 0').run();
    return json({ success: true });
  });

  // ── Delete gacha spin history + reset pity ──
  router.post('/api/cleanup/all-spin-history', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    await env.DB.batch([
      env.DB.prepare("DELETE FROM transactions WHERE type = 'GACHA_PULL'"),
      env.DB.prepare('UPDATE users SET pity_counter = 0'),
    ]);

    return json({ success: true });
  });

  // ── Clear Super Shy status ──
  router.post('/api/cleanup/all-supershy', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    await env.DB.batch([
      env.DB.prepare(`
        UPDATE users SET
          is_super_shy = 0,
          super_shy_expiry = NULL,
          super_shy_tier = NULL,
          has_claimed_super_shy_trial = 0
      `),
    ]);

    return json({ success: true });
  });

  // ── Delete all appeals ──
  router.post('/api/cleanup/all-appeals', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const result = await env.DB.prepare('DELETE FROM suspension_appeals').run();
    return json({ success: true, deleted: result.changes || 0 });
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

    // Users
    const { results: users } = await env.DB.prepare(
      'SELECT profile_photo_url, cover_photo_url, pre_suspension_profile_photo_url, pre_suspension_cover_photo_url FROM users'
    ).all();
    for (const u of users) {
      for (const url of [u.profile_photo_url, u.cover_photo_url, u.pre_suspension_profile_photo_url, u.pre_suspension_cover_photo_url]) {
        const k = extractKey(url);
        if (k) referencedKeys.add(k);
      }
    }

    // Conversations
    const { results: convs } = await env.DB.prepare(
      'SELECT group_photo_url FROM conversations WHERE group_photo_url IS NOT NULL'
    ).all();
    for (const c of convs) {
      const k = extractKey(c.group_photo_url);
      if (k) referencedKeys.add(k);
    }

    // Messages
    const { results: imageMessages } = await env.DB.prepare(
      "SELECT image_urls FROM private_messages WHERE type = 'IMAGE' AND image_urls IS NOT NULL"
    ).all();
    for (const msg of imageMessages) {
      try {
        const urls = JSON.parse(msg.image_urls);
        for (const url of urls) {
          const k = extractKey(url);
          if (k) referencedKeys.add(k);
        }
      } catch (_) {}
    }

    // Room messages
    const { results: roomImageMsgs } = await env.DB.prepare(
      "SELECT image_urls FROM messages WHERE type = 'IMAGE' AND image_urls IS NOT NULL"
    ).all().catch(() => ({ results: [] }));
    for (const msg of roomImageMsgs) {
      try {
        const urls = JSON.parse(msg.image_urls);
        for (const url of urls) {
          const k = extractKey(url);
          if (k) referencedKeys.add(k);
        }
      } catch (_) {}
    }

    // Reports + archive
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
        } catch (_) {}
      }
    }

    // Banners
    const { results: bannerRows } = await env.DB.prepare(
      'SELECT image_url FROM banners WHERE image_url IS NOT NULL'
    ).all();
    for (const b of bannerRows) {
      const k = extractKey(b.image_url);
      if (k) referencedKeys.add(k);
    }

    // List and delete orphans
    const folders = ['pm_images/', 'stickers/', 'report_evidence/', 'profile_photos/', 'cover_photos/', 'group_photos/', 'banners/'];
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
 * Delete a conversation and all its associated data.
 */
async function deleteConversation(env, convId) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM private_messages WHERE conversation_id = ?').bind(convId),
    env.DB.prepare('DELETE FROM conversation_participants WHERE conversation_id = ?').bind(convId),
    env.DB.prepare('DELETE FROM conversation_settings WHERE conversation_id = ?').bind(convId),
    env.DB.prepare('DELETE FROM conversation_permissions WHERE conversation_id = ?').bind(convId),
    env.DB.prepare('DELETE FROM conversation_system_message_config WHERE conversation_id = ?').bind(convId),
    env.DB.prepare('DELETE FROM conversation_mutes WHERE conversation_id = ?').bind(convId),
    env.DB.prepare('DELETE FROM conversation_mod_log WHERE conversation_id = ?').bind(convId),
    env.DB.prepare('DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM private_messages WHERE conversation_id = ?)').bind(convId),
    env.DB.prepare('DELETE FROM message_read_by WHERE message_id IN (SELECT id FROM private_messages WHERE conversation_id = ?)').bind(convId),
    env.DB.prepare('DELETE FROM conversations WHERE id = ?').bind(convId),
  ]);
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

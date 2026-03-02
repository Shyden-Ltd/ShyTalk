/**
 * Conversation routes — private messaging, groups, settings, moderation.
 *
 * GET    /api/conversations                          → List user's conversations
 * POST   /api/conversations                          → Get or create 1-on-1
 * GET    /api/conversations/:id                      → Get conversation
 * POST   /api/conversations/group                    → Create group conversation
 * PATCH  /api/conversations/:id/close                → Close group
 * GET    /api/conversations/:id/messages              → Get messages
 * GET    /api/conversations/:id/messages/older        → Load older messages
 * POST   /api/conversations/:id/messages              → Send message
 * PATCH  /api/conversations/:id/messages/:msgId       → Edit message
 * POST   /api/conversations/:id/messages/:msgId/recall → Recall message
 * POST   /api/conversations/:id/messages/:msgId/hide   → Hide message
 * POST   /api/conversations/:id/messages/:msgId/react  → Toggle reaction
 * GET    /api/conversations/:id/messages/:msgId/edits  → Get edit history
 * POST   /api/conversations/:id/read                  → Mark as read
 * POST   /api/conversations/:id/reset-unread          → Reset unread count
 * GET    /api/conversations/:id/settings              → Get user settings
 * POST   /api/conversations/:id/settings              → Observe not possible via REST — GET suffices
 * PATCH  /api/conversations/:id/settings              → Update settings (mute/pin/hide)
 * POST   /api/conversations/:id/participants/add       → Add group participant
 * POST   /api/conversations/:id/participants/remove    → Remove group participant
 * PATCH  /api/conversations/:id/group                  → Update group info (name, description, photo)
 * PATCH  /api/conversations/:id/permissions            → Update group permissions
 * PATCH  /api/conversations/:id/system-messages        → Update system message config
 * PATCH  /api/conversations/:id/mod-notify             → Update mod notify mode
 * PATCH  /api/conversations/:id/roles                  → Update roles (admin/mod lists)
 * POST   /api/conversations/:id/transfer-ownership     → Transfer group ownership
 * POST   /api/conversations/:id/mutes/:userId          → Mute group member
 * DELETE /api/conversations/:id/mutes/:userId          → Unmute group member
 * GET    /api/conversations/:id/mutes                  → Get active mutes
 * POST   /api/conversations/:id/mod-log                → Add mod log entry
 * GET    /api/conversations/:id/ws                     → WebSocket upgrade (typing)
 * GET    /api/conversations/search-messages            → Search messages
 * GET    /api/conversations/search-users               → Search users
 * GET    /api/conversations/owned-group-count           → Get owned group count
 * GET    /api/config/moderation                         → Get moderation config
 */

const { json, jsonError, generateId, now, parseBody } = require('../utils');
const { sendFcmToTokens, cleanupInvalidTokens } = require('../utils/fcm');

const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 200;

/**
 * Assemble a full Conversation object from D1 tables.
 * Returns camelCase JSON matching Conversation.fromMap expectations.
 */
async function assembleConversation(env, conversationId) {
  const [conv, participantsResult] = await Promise.all([
    env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(conversationId).first(),
    env.DB.prepare(
      'SELECT user_id, role FROM conversation_participants WHERE conversation_id = ?'
    ).bind(conversationId).all(),
  ]);

  if (!conv) return null;

  const participants = participantsResult.results;
  const participantIds = participants.map(p => p.user_id);
  const adminIds = participants.filter(p => p.role === 'ADMIN' || p.role === 'OWNER').map(p => p.user_id);
  const modIds = participants.filter(p => p.role === 'MOD').map(p => p.user_id);

  return {
    id: conv.id,
    conversationId: conv.id,
    participantIds,
    lastMessage: conv.last_message_text != null ? {
      text: conv.last_message_text,
      senderId: conv.last_message_sender_id,
      senderName: conv.last_message_sender_name,
      createdAt: conv.last_message_at,
      type: conv.last_message_type || 'TEXT',
    } : null,
    lastMessageAt: conv.last_message_at || conv.created_at,
    createdAt: conv.created_at,
    isGroup: !!conv.is_group,
    groupName: conv.group_name,
    groupPhotoUrl: conv.group_photo_url,
    groupAdminIds: adminIds,
    groupModIds: modIds,
    groupDescription: conv.group_description,
    createdBy: conv.created_by,
    isClosed: !!conv.is_closed,
    permissions: {
      whoCanSend: conv.perm_who_can_send || 'EVERYONE',
      whoCanAddMembers: conv.perm_who_can_add_members || 'EVERYONE',
      whoCanEditInfo: conv.perm_who_can_edit_info || 'EVERYONE',
      whoCanDeleteMessages: conv.perm_who_can_delete_messages || 'MODS_AND_ABOVE',
      whoCanMuteMembers: conv.perm_who_can_mute_members || 'MODS_AND_ABOVE',
      whoCanRemoveMembers: conv.perm_who_can_remove_members || 'ADMINS_ONLY',
    },
    systemMessageConfig: {
      showJoins: conv.sys_show_joins !== 0,
      showLeaves: conv.sys_show_leaves !== 0,
      showRoleChanges: conv.sys_show_role_changes !== 0,
      showPermissionChanges: conv.sys_show_permission_changes !== 0,
    },
    modNotifyMode: conv.mod_notify_mode || 'ALL_ADMINS',
  };
}

/**
 * Build a message object from a D1 row.
 */
function buildMessage(row) {
  return {
    id: row.id,
    messageId: row.id,
    senderId: row.sender_id,
    senderName: row.sender_name || '',
    text: row.text || '',
    imageUrls: row.image_urls ? JSON.parse(row.image_urls) : [],
    type: row.type || 'TEXT',
    createdAt: row.created_at,
    editedAt: row.edited_at,
    editCount: row.edit_count || 0,
    readBy: row.read_by ? JSON.parse(row.read_by) : [],
    replyToMessageId: row.reply_to_message_id,
    replyToText: row.reply_to_text,
    replyToSenderName: row.reply_to_sender_name,
    stickerUrl: row.sticker_url,
    roomInviteId: row.room_invite_id,
    roomInviteName: row.room_invite_name,
    reactions: row.reactions ? JSON.parse(row.reactions) : {},
    isRecalled: !!row.is_recalled,
    isHidden: !!row.is_hidden,
    hiddenBy: row.hidden_by,
  };
}

/**
 * Generate deterministic conversation ID for 1-on-1 chats.
 */
function generateConversationId(uid1, uid2) {
  return [uid1, uid2].sort().join('_');
}

/**
 * Update the conversation's last message preview.
 */
function buildPreviewUpdate(env, conversationId, text, senderId, senderName, type) {
  const timestamp = now();
  return env.DB.prepare(`
    UPDATE conversations SET
      last_message_text = ?, last_message_sender_id = ?,
      last_message_sender_name = ?, last_message_at = ?,
      last_message_type = ?
    WHERE id = ?
  `).bind(text, senderId, senderName, timestamp, type, conversationId);
}


function registerConversationRoutes(router) {

  // ══════════════════════════════════════════════════════════════
  // CONVERSATIONS
  // ══════════════════════════════════════════════════════════════

  // ── List conversations ──
  router.get('/api/conversations', async (request, env) => {
    const uid = request.auth.uid;

    const { results: participations } = await env.DB.prepare(`
      SELECT cp.conversation_id FROM conversation_participants cp
      JOIN conversations c ON c.id = cp.conversation_id
      ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
      LIMIT 100
    `).bind().all();

    // Filter by user participation
    const { results: userConvs } = await env.DB.prepare(`
      SELECT cp.conversation_id FROM conversation_participants cp
      JOIN conversations c ON c.id = cp.conversation_id
      WHERE cp.user_id = ?
      ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
      LIMIT 100
    `).bind(uid).all();

    const conversations = await Promise.all(
      userConvs.map(r => assembleConversation(env, r.conversation_id))
    );

    // Inline settings for the authenticated user to avoid N+1 API calls
    const filtered = conversations.filter(Boolean);
    const convIds = filtered.map(c => c.conversationId);
    if (convIds.length > 0) {
      const placeholders = convIds.map(() => '?').join(',');
      const { results: allSettings } = await env.DB.prepare(
        `SELECT * FROM conversation_settings WHERE user_id = ? AND conversation_id IN (${placeholders})`
      ).bind(uid, ...convIds).all();
      const settingsMap = Object.fromEntries(allSettings.map(s => [s.conversation_id, s]));
      for (const conv of filtered) {
        const s = settingsMap[conv.conversationId];
        conv.settings = s ? {
          userId: s.user_id,
          isMuted: !!s.is_muted,
          isHidden: !!s.is_hidden,
          hiddenAt: s.hidden_at,
          isPinned: !!s.is_pinned,
          lastReadMessageId: s.last_read_message_id || '',
          lastReadAt: s.last_read_at || 0,
          unreadCount: s.unread_count || 0,
        } : {
          userId: uid, isMuted: false, isHidden: false, hiddenAt: null,
          isPinned: false, lastReadMessageId: '', lastReadAt: 0, unreadCount: 0,
        };
      }
    }

    return json(filtered);
  });

  // ── Get or create 1-on-1 conversation ──
  router.post('/api/conversations', async (request, env) => {
    const uid = request.auth.uid;
    const body = await parseBody(request);
    const otherUid = body?.otherUserId;
    if (!otherUid) return jsonError('otherUserId required', 400);

    const conversationId = generateConversationId(uid, otherUid);

    // Check if exists
    const existing = await env.DB.prepare(
      'SELECT id FROM conversations WHERE id = ?'
    ).bind(conversationId).first();

    if (existing) {
      const conv = await assembleConversation(env, conversationId);
      return json(conv);
    }

    // Create new conversation
    const timestamp = now();
    const stmts = [
      env.DB.prepare(`
        INSERT INTO conversations (id, is_group, created_at, last_message_at)
        VALUES (?, 0, ?, ?)
      `).bind(conversationId, timestamp, timestamp),
      env.DB.prepare(`
        INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES (?, ?, 'MEMBER')
      `).bind(conversationId, uid),
      env.DB.prepare(`
        INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES (?, ?, 'MEMBER')
      `).bind(conversationId, otherUid),
      env.DB.prepare(`
        INSERT INTO conversation_settings (conversation_id, user_id) VALUES (?, ?)
      `).bind(conversationId, uid),
      env.DB.prepare(`
        INSERT INTO conversation_settings (conversation_id, user_id) VALUES (?, ?)
      `).bind(conversationId, otherUid),
    ];
    await env.DB.batch(stmts);

    const conv = await assembleConversation(env, conversationId);
    return json(conv);
  });

  // ── Get conversation ──
  router.get('/api/conversations/:id', async (request, env, params) => {
    const conv = await assembleConversation(env, params.id);
    if (!conv) return jsonError('Conversation not found', 404);
    return json(conv);
  });

  // ── Create group conversation ──
  router.post('/api/conversations/group', async (request, env) => {
    const uid = request.auth.uid;
    const body = await parseBody(request);
    if (!body?.groupName) return jsonError('groupName required', 400);

    const conversationId = generateId();
    const timestamp = now();
    const participantIds = [...new Set([...(body.participantIds || []), uid])];
    const adminIds = [...new Set([...(body.adminIds || []), uid])];
    const modIds = body.modIds || [];
    const permissions = body.permissions || {};
    const sysConfig = body.systemMessageConfig || {};

    const stmts = [
      env.DB.prepare(`
        INSERT INTO conversations (id, is_group, group_name, group_photo_url, group_description,
          created_by, created_at, last_message_at,
          perm_who_can_send, perm_who_can_add_members, perm_who_can_edit_info,
          perm_who_can_delete_messages, perm_who_can_mute_members, perm_who_can_remove_members,
          sys_show_joins, sys_show_leaves, sys_show_role_changes, sys_show_permission_changes)
        VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        conversationId, body.groupName, body.groupPhotoUrl || null,
        body.groupDescription || null, uid, timestamp, timestamp,
        permissions.whoCanSend || 'EVERYONE',
        permissions.whoCanAddMembers || 'EVERYONE',
        permissions.whoCanEditInfo || 'EVERYONE',
        permissions.whoCanDeleteMessages || 'MODS_AND_ABOVE',
        permissions.whoCanMuteMembers || 'MODS_AND_ABOVE',
        permissions.whoCanRemoveMembers || 'ADMINS_ONLY',
        sysConfig.showJoins !== false ? 1 : 0,
        sysConfig.showLeaves !== false ? 1 : 0,
        sysConfig.showRoleChanges !== false ? 1 : 0,
        sysConfig.showPermissionChanges !== false ? 1 : 0,
      ),
    ];

    // Add participants with roles
    for (const pid of participantIds) {
      let role = 'MEMBER';
      if (pid === uid) role = 'OWNER';
      else if (adminIds.includes(pid)) role = 'ADMIN';
      else if (modIds.includes(pid)) role = 'MOD';

      stmts.push(env.DB.prepare(`
        INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES (?, ?, ?)
      `).bind(conversationId, pid, role));
      stmts.push(env.DB.prepare(`
        INSERT INTO conversation_settings (conversation_id, user_id) VALUES (?, ?)
      `).bind(conversationId, pid));
    }

    await env.DB.batch(stmts);

    const conv = await assembleConversation(env, conversationId);
    return json(conv);
  });

  // ── Close group conversation ──
  router.patch('/api/conversations/:id/close', async (request, env, params) => {
    await env.DB.prepare(
      'UPDATE conversations SET is_closed = 1 WHERE id = ?'
    ).bind(params.id).run();
    return json({ success: true });
  });

  // ══════════════════════════════════════════════════════════════
  // MESSAGES
  // ══════════════════════════════════════════════════════════════

  // ── Get messages ──
  router.get('/api/conversations/:id/messages', async (request, env, params) => {
    const url = new URL(request.url);
    const limit = Math.min(
      parseInt(url.searchParams.get('limit') || String(DEFAULT_MESSAGE_LIMIT)),
      MAX_MESSAGE_LIMIT
    );

    const { results } = await env.DB.prepare(`
      SELECT * FROM private_messages
      WHERE conversation_id = ?
      ORDER BY created_at DESC LIMIT ?
    `).bind(params.id, limit).all();

    // Return in chronological order (oldest first)
    return json(results.reverse().map(buildMessage));
  });

  // ── Load older messages ──
  router.get('/api/conversations/:id/messages/older', async (request, env, params) => {
    const url = new URL(request.url);
    const before = parseInt(url.searchParams.get('before') || '0');
    const limit = Math.min(
      parseInt(url.searchParams.get('limit') || '30'),
      MAX_MESSAGE_LIMIT
    );

    if (!before) return jsonError('before timestamp required', 400);

    const { results } = await env.DB.prepare(`
      SELECT * FROM private_messages
      WHERE conversation_id = ? AND created_at < ?
      ORDER BY created_at DESC LIMIT ?
    `).bind(params.id, before, limit).all();

    return json(results.reverse().map(buildMessage));
  });

  // ── Send message ──
  router.post('/api/conversations/:id/messages', async (request, env, params) => {
    const uid = request.auth.uid;
    const body = await parseBody(request);
    if (!body) return jsonError('Invalid body', 400);

    const conversationId = params.id;
    const messageId = generateId();
    const timestamp = now();
    const type = body.type || 'TEXT';
    const senderId = body.senderId || uid;
    const senderName = body.senderName || '';
    const text = body.text || '';

    const stmts = [
      env.DB.prepare(`
        INSERT INTO private_messages (id, conversation_id, sender_id, sender_name, text, type,
          image_urls, sticker_url, room_invite_id, room_invite_name,
          reply_to_message_id, reply_to_text, reply_to_sender_name, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        messageId, conversationId, senderId, senderName, text, type,
        body.imageUrls ? JSON.stringify(body.imageUrls) : null,
        body.stickerUrl || null,
        body.roomInviteId || null, body.roomInviteName || null,
        body.replyToMessageId || null, body.replyToText || null,
        body.replyToSenderName || null, timestamp
      ),
    ];

    // Build preview text
    let previewText = text;
    if (type === 'IMAGE') previewText = '[Image]';
    else if (type === 'STICKER') previewText = '[Sticker]';
    else if (type === 'ROOM_INVITE') previewText = '[Room Invite]';

    stmts.push(buildPreviewUpdate(env, conversationId, previewText, senderId, senderName, type));

    // Increment unread count for all participants except sender
    const { results: participants } = await env.DB.prepare(
      'SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND user_id != ?'
    ).bind(conversationId, senderId).all();

    for (const p of participants) {
      stmts.push(env.DB.prepare(`
        UPDATE conversation_settings SET unread_count = unread_count + 1, is_hidden = 0
        WHERE conversation_id = ? AND user_id = ?
      `).bind(conversationId, p.user_id));
    }

    await env.DB.batch(stmts);

    // Fire-and-forget: FCM notifications + ConversationDO broadcast
    const ctx = request.ctx;
    if (ctx) {
      const conv = await env.DB.prepare(
        'SELECT is_group, group_name FROM conversations WHERE id = ?'
      ).bind(conversationId).first();
      const isGroup = !!conv?.is_group;
      const groupName = conv?.group_name;

      ctx.waitUntil(sendMessageNotifications(
        env, conversationId, senderId, senderName, previewText, type, participants, isGroup, groupName
      ));
      ctx.waitUntil(broadcastToConversation(env, conversationId, { type: 'new_message' }));
    }

    return json(buildMessage({
      id: messageId,
      conversation_id: conversationId,
      sender_id: senderId,
      sender_name: senderName,
      text, type,
      image_urls: body.imageUrls ? JSON.stringify(body.imageUrls) : null,
      sticker_url: body.stickerUrl || null,
      room_invite_id: body.roomInviteId || null,
      room_invite_name: body.roomInviteName || null,
      reply_to_message_id: body.replyToMessageId || null,
      reply_to_text: body.replyToText || null,
      reply_to_sender_name: body.replyToSenderName || null,
      reactions: null, read_by: null,
      is_recalled: 0, is_hidden: 0, hidden_by: null,
      edit_count: 0, edited_at: null,
      created_at: timestamp,
    }));
  });

  // ── Edit message ──
  router.patch('/api/conversations/:id/messages/:msgId', async (request, env, params) => {
    const body = await parseBody(request);
    if (!body?.text) return jsonError('text required', 400);

    const conversationId = params.id;
    const messageId = params.msgId;
    const timestamp = now();

    // Get current message
    const msg = await env.DB.prepare(
      'SELECT text, edit_count FROM private_messages WHERE id = ? AND conversation_id = ?'
    ).bind(messageId, conversationId).first();

    if (!msg) return jsonError('Message not found', 404);

    const editId = generateId();
    const stmts = [
      // Save old text to edit history
      env.DB.prepare(`
        INSERT INTO message_edits (id, conversation_id, message_id, previous_text, edited_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(editId, conversationId, messageId, msg.text || '', timestamp),
      // Update message
      env.DB.prepare(`
        UPDATE private_messages SET text = ?, edited_at = ?, edit_count = ?
        WHERE id = ? AND conversation_id = ?
      `).bind(body.text, timestamp, (msg.edit_count || 0) + 1, messageId, conversationId),
    ];

    await env.DB.batch(stmts);
    return json({ success: true });
  });

  // ── Recall message ──
  router.post('/api/conversations/:id/messages/:msgId/recall', async (request, env, params) => {
    const stmts = [
      env.DB.prepare(
        'UPDATE private_messages SET is_recalled = 1 WHERE id = ? AND conversation_id = ?'
      ).bind(params.msgId, params.id),
      env.DB.prepare(`
        UPDATE conversations SET last_message_text = '[Message recalled]'
        WHERE id = ?
      `).bind(params.id),
    ];
    await env.DB.batch(stmts);
    return json({ success: true });
  });

  // ── Hide message ──
  router.post('/api/conversations/:id/messages/:msgId/hide', async (request, env, params) => {
    const body = await parseBody(request);
    const hiddenBy = body?.hiddenBy || request.auth.uid;

    await env.DB.prepare(
      'UPDATE private_messages SET is_hidden = 1, hidden_by = ? WHERE id = ? AND conversation_id = ?'
    ).bind(hiddenBy, params.msgId, params.id).run();

    return json({ success: true });
  });

  // ── Toggle reaction ──
  router.post('/api/conversations/:id/messages/:msgId/react', async (request, env, params) => {
    const body = await parseBody(request);
    if (!body?.emoji) return jsonError('emoji required', 400);
    const userId = body.userId || request.auth.uid;

    const msg = await env.DB.prepare(
      'SELECT reactions FROM private_messages WHERE id = ? AND conversation_id = ?'
    ).bind(params.msgId, params.id).first();

    if (!msg) return jsonError('Message not found', 404);

    const reactions = msg.reactions ? JSON.parse(msg.reactions) : {};
    const users = reactions[body.emoji] || [];
    const updatedUsers = users.includes(userId)
      ? users.filter(u => u !== userId)
      : [...users, userId];

    if (updatedUsers.length === 0) {
      delete reactions[body.emoji];
    } else {
      reactions[body.emoji] = updatedUsers;
    }

    await env.DB.prepare(
      'UPDATE private_messages SET reactions = ? WHERE id = ? AND conversation_id = ?'
    ).bind(JSON.stringify(reactions), params.msgId, params.id).run();

    return json({ success: true });
  });

  // ── Get edit history ──
  router.get('/api/conversations/:id/messages/:msgId/edits', async (request, env, params) => {
    const { results } = await env.DB.prepare(`
      SELECT id, id AS editId, previous_text AS previousText, edited_at AS editedAt
      FROM message_edits WHERE message_id = ? AND conversation_id = ?
      ORDER BY edited_at DESC
    `).bind(params.msgId, params.id).all();

    return json(results);
  });

  // ══════════════════════════════════════════════════════════════
  // SETTINGS
  // ══════════════════════════════════════════════════════════════

  // ── Get user settings for conversation ──
  router.get('/api/conversations/:id/settings', async (request, env, params) => {
    const uid = request.auth.uid;
    const settings = await env.DB.prepare(
      'SELECT * FROM conversation_settings WHERE conversation_id = ? AND user_id = ?'
    ).bind(params.id, uid).first();

    if (!settings) {
      return json({
        userId: uid, isMuted: false, isHidden: false, hiddenAt: null,
        isPinned: false, lastReadMessageId: '', lastReadAt: 0, unreadCount: 0,
      });
    }

    return json({
      userId: settings.user_id,
      isMuted: !!settings.is_muted,
      isHidden: !!settings.is_hidden,
      hiddenAt: settings.hidden_at,
      isPinned: !!settings.is_pinned,
      lastReadMessageId: settings.last_read_message_id || '',
      lastReadAt: settings.last_read_at || 0,
      unreadCount: settings.unread_count || 0,
    });
  });

  // ── Mark as read ──
  router.post('/api/conversations/:id/read', async (request, env, params) => {
    const uid = request.auth.uid;
    const body = await parseBody(request);
    const messageId = body?.messageId;
    if (!messageId) return jsonError('messageId required', 400);

    const timestamp = now();
    const stmts = [
      // Add userId to message's readBy
      env.DB.prepare(
        'SELECT read_by FROM private_messages WHERE id = ? AND conversation_id = ?'
      ).bind(messageId, params.id),
    ];

    const msg = await env.DB.prepare(
      'SELECT read_by FROM private_messages WHERE id = ? AND conversation_id = ?'
    ).bind(messageId, params.id).first();

    const readBy = msg?.read_by ? JSON.parse(msg.read_by) : [];
    if (!readBy.includes(uid)) readBy.push(uid);

    const updateStmts = [
      env.DB.prepare(
        'UPDATE private_messages SET read_by = ? WHERE id = ? AND conversation_id = ?'
      ).bind(JSON.stringify(readBy), messageId, params.id),
      env.DB.prepare(`
        UPDATE conversation_settings SET last_read_message_id = ?, last_read_at = ?, unread_count = 0
        WHERE conversation_id = ? AND user_id = ?
      `).bind(messageId, timestamp, params.id, uid),
    ];

    await env.DB.batch(updateStmts);
    return json({ success: true });
  });

  // ── Reset unread count ──
  router.post('/api/conversations/:id/reset-unread', async (request, env, params) => {
    const uid = request.auth.uid;
    await env.DB.prepare(
      'UPDATE conversation_settings SET unread_count = 0 WHERE conversation_id = ? AND user_id = ?'
    ).bind(params.id, uid).run();
    return json({ success: true });
  });

  // ── Update settings (mute/pin/hide) ──
  router.patch('/api/conversations/:id/settings', async (request, env, params) => {
    const uid = request.auth.uid;
    const body = await parseBody(request);
    if (!body) return jsonError('Invalid body', 400);

    const updates = [];
    const binds = [];

    if ('isMuted' in body) { updates.push('is_muted = ?'); binds.push(body.isMuted ? 1 : 0); }
    if ('isPinned' in body) { updates.push('is_pinned = ?'); binds.push(body.isPinned ? 1 : 0); }
    if ('isHidden' in body) {
      updates.push('is_hidden = ?');
      binds.push(body.isHidden ? 1 : 0);
      if (body.isHidden) {
        updates.push('hidden_at = ?');
        binds.push(now());
      }
    }

    if (updates.length === 0) return jsonError('No valid fields', 400);

    binds.push(params.id, uid);
    await env.DB.prepare(
      `UPDATE conversation_settings SET ${updates.join(', ')} WHERE conversation_id = ? AND user_id = ?`
    ).bind(...binds).run();

    return json({ success: true });
  });

  // ══════════════════════════════════════════════════════════════
  // GROUP MANAGEMENT
  // ══════════════════════════════════════════════════════════════

  // ── Add group participant ──
  router.post('/api/conversations/:id/participants/add', async (request, env, params) => {
    const body = await parseBody(request);
    if (!body?.userId) return jsonError('userId required', 400);

    const stmts = [
      env.DB.prepare(`
        INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id, role) VALUES (?, ?, 'MEMBER')
      `).bind(params.id, body.userId),
      env.DB.prepare(`
        INSERT OR IGNORE INTO conversation_settings (conversation_id, user_id) VALUES (?, ?)
      `).bind(params.id, body.userId),
    ];
    await env.DB.batch(stmts);

    return json({ success: true });
  });

  // ── Remove group participant ──
  router.post('/api/conversations/:id/participants/remove', async (request, env, params) => {
    const body = await parseBody(request);
    if (!body?.userId) return jsonError('userId required', 400);

    await env.DB.prepare(
      'DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
    ).bind(params.id, body.userId).run();

    return json({ success: true });
  });

  // ── Update group info (name, description, photo) ──
  router.patch('/api/conversations/:id/group', async (request, env, params) => {
    const body = await parseBody(request);
    if (!body) return jsonError('Invalid body', 400);

    const updates = [];
    const binds = [];

    if ('groupName' in body) { updates.push('group_name = ?'); binds.push(body.groupName); }
    if ('groupDescription' in body) { updates.push('group_description = ?'); binds.push(body.groupDescription); }
    if ('groupPhotoUrl' in body) { updates.push('group_photo_url = ?'); binds.push(body.groupPhotoUrl); }

    if (updates.length === 0) return jsonError('No valid fields', 400);

    binds.push(params.id);
    await env.DB.prepare(`UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...binds).run();

    return json({ success: true });
  });

  // ── Update permissions ──
  router.patch('/api/conversations/:id/permissions', async (request, env, params) => {
    const body = await parseBody(request);
    if (!body) return jsonError('Invalid body', 400);

    const fieldMap = {
      whoCanSend: 'perm_who_can_send',
      whoCanAddMembers: 'perm_who_can_add_members',
      whoCanEditInfo: 'perm_who_can_edit_info',
      whoCanDeleteMessages: 'perm_who_can_delete_messages',
      whoCanMuteMembers: 'perm_who_can_mute_members',
      whoCanRemoveMembers: 'perm_who_can_remove_members',
    };

    const updates = [];
    const binds = [];

    for (const [jsKey, sqlCol] of Object.entries(fieldMap)) {
      if (jsKey in body) { updates.push(`${sqlCol} = ?`); binds.push(body[jsKey]); }
    }

    if (updates.length === 0) return jsonError('No valid fields', 400);

    binds.push(params.id);
    await env.DB.prepare(`UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...binds).run();

    return json({ success: true });
  });

  // ── Update system message config ──
  router.patch('/api/conversations/:id/system-messages', async (request, env, params) => {
    const body = await parseBody(request);
    if (!body) return jsonError('Invalid body', 400);

    const fieldMap = {
      showJoins: 'sys_show_joins',
      showLeaves: 'sys_show_leaves',
      showRoleChanges: 'sys_show_role_changes',
      showPermissionChanges: 'sys_show_permission_changes',
    };

    const updates = [];
    const binds = [];

    for (const [jsKey, sqlCol] of Object.entries(fieldMap)) {
      if (jsKey in body) { updates.push(`${sqlCol} = ?`); binds.push(body[jsKey] ? 1 : 0); }
    }

    if (updates.length === 0) return jsonError('No valid fields', 400);

    binds.push(params.id);
    await env.DB.prepare(`UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...binds).run();

    return json({ success: true });
  });

  // ── Update mod notify mode ──
  router.patch('/api/conversations/:id/mod-notify', async (request, env, params) => {
    const body = await parseBody(request);
    if (!body?.mode) return jsonError('mode required', 400);

    await env.DB.prepare(
      'UPDATE conversations SET mod_notify_mode = ? WHERE id = ?'
    ).bind(body.mode, params.id).run();

    return json({ success: true });
  });

  // ── Update roles (admin/mod lists) ──
  router.patch('/api/conversations/:id/roles', async (request, env, params) => {
    const body = await parseBody(request);
    if (!body) return jsonError('Invalid body', 400);

    const adminIds = body.adminIds || [];
    const modIds = body.modIds || [];
    const conversationId = params.id;

    // Get current owner
    const owner = await env.DB.prepare(
      "SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND role = 'OWNER'"
    ).bind(conversationId).first();

    // Get all participants
    const { results: participants } = await env.DB.prepare(
      'SELECT user_id FROM conversation_participants WHERE conversation_id = ?'
    ).bind(conversationId).all();

    const stmts = [];
    for (const p of participants) {
      if (owner && p.user_id === owner.user_id) continue; // Don't change owner role
      let role = 'MEMBER';
      if (adminIds.includes(p.user_id)) role = 'ADMIN';
      else if (modIds.includes(p.user_id)) role = 'MOD';

      stmts.push(env.DB.prepare(
        'UPDATE conversation_participants SET role = ? WHERE conversation_id = ? AND user_id = ?'
      ).bind(role, conversationId, p.user_id));
    }

    if (stmts.length > 0) await env.DB.batch(stmts);
    return json({ success: true });
  });

  // ── Transfer ownership ──
  router.post('/api/conversations/:id/transfer-ownership', async (request, env, params) => {
    const body = await parseBody(request);
    if (!body?.newOwnerId) return jsonError('newOwnerId required', 400);

    const conversationId = params.id;
    const newOwnerId = body.newOwnerId;

    // Get current owner
    const currentOwner = await env.DB.prepare(
      "SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND role = 'OWNER'"
    ).bind(conversationId).first();

    const stmts = [
      // New owner gets OWNER role
      env.DB.prepare(
        "UPDATE conversation_participants SET role = 'OWNER' WHERE conversation_id = ? AND user_id = ?"
      ).bind(conversationId, newOwnerId),
      // Update createdBy
      env.DB.prepare(
        'UPDATE conversations SET created_by = ? WHERE id = ?'
      ).bind(newOwnerId, conversationId),
    ];

    // Old owner becomes ADMIN
    if (currentOwner) {
      stmts.push(env.DB.prepare(
        "UPDATE conversation_participants SET role = 'ADMIN' WHERE conversation_id = ? AND user_id = ?"
      ).bind(conversationId, currentOwner.user_id));
    }

    await env.DB.batch(stmts);
    return json({ success: true });
  });

  // ══════════════════════════════════════════════════════════════
  // MODERATION
  // ══════════════════════════════════════════════════════════════

  // ── Mute group member ──
  router.post('/api/conversations/:id/mutes/:userId', async (request, env, params) => {
    const body = await parseBody(request);
    const timestamp = now();

    await env.DB.prepare(`
      INSERT OR REPLACE INTO conversation_mutes
        (conversation_id, user_id, muted_by, muted_by_name, reason, muted_at, expires_at, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).bind(
      params.id, params.userId,
      body?.mutedBy || '', body?.mutedByName || '',
      body?.reason || null, timestamp,
      body?.duration ? timestamp + body.duration : null,
    ).run();

    return json({ success: true });
  });

  // ── Unmute group member ──
  router.delete('/api/conversations/:id/mutes/:userId', async (request, env, params) => {
    await env.DB.prepare(
      'DELETE FROM conversation_mutes WHERE conversation_id = ? AND user_id = ?'
    ).bind(params.id, params.userId).run();

    return json({ success: true });
  });

  // ── Get active mutes ──
  router.get('/api/conversations/:id/mutes', async (request, env, params) => {
    const { results } = await env.DB.prepare(`
      SELECT user_id AS odId, muted_by AS mutedBy, muted_by_name AS mutedByName,
        reason, muted_at AS mutedAt, expires_at AS expiresAt, is_active AS isActive
      FROM conversation_mutes WHERE conversation_id = ? AND is_active = 1
    `).bind(params.id).all();

    return json(results.map(r => ({
      ...r,
      isActive: !!r.isActive,
    })));
  });

  // ── Add mod log entry ──
  router.post('/api/conversations/:id/mod-log', async (request, env, params) => {
    const body = await parseBody(request);
    if (!body?.action) return jsonError('action required', 400);

    const logId = generateId();
    await env.DB.prepare(`
      INSERT INTO conversation_mod_log (id, conversation_id, action, actor_id, actor_name,
        target_id, target_name, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      logId, params.id, body.action,
      body.actorId || request.auth.uid, body.actorName || '',
      body.targetId || null, body.targetName || null,
      body.details ? JSON.stringify(body.details) : null, now(),
    ).run();

    // Fire-and-forget: FCM notification to group owner/admins
    const ctx = request.ctx;
    if (ctx) {
      ctx.waitUntil(sendModActionNotifications(
        env, params.id, body.actorId || request.auth.uid, body.actorName || '',
        body.action, body.targetName || ''
      ));
    }

    return json({ success: true, logId });
  });

  // ══════════════════════════════════════════════════════════════
  // WEBSOCKET (typing indicators)
  // ══════════════════════════════════════════════════════════════

  router.get('/api/conversations/:id/ws', async (request, env, params) => {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return jsonError('Expected WebSocket upgrade', 426);
    }

    const conversationId = params.id;
    const userId = request.auth.uid;

    const stub = getConversationDO(env, conversationId);

    const doUrl = new URL(request.url);
    doUrl.pathname = '/ws';
    doUrl.searchParams.set('userId', userId);

    return stub.fetch(new Request(doUrl.toString(), request));
  });

  // ══════════════════════════════════════════════════════════════
  // SEARCH & UTILITIES
  // ══════════════════════════════════════════════════════════════

  // ── Search messages within a conversation ──
  router.get('/api/conversations/search-messages', async (request, env) => {
    const url = new URL(request.url);
    const conversationId = url.searchParams.get('conversationId');
    const query = url.searchParams.get('q');
    if (!conversationId || !query) return jsonError('conversationId and q required', 400);

    const { results } = await env.DB.prepare(`
      SELECT * FROM private_messages
      WHERE conversation_id = ? AND text LIKE ? AND is_recalled = 0
      ORDER BY created_at DESC LIMIT 50
    `).bind(conversationId, `%${query}%`).all();

    return json(results.reverse().map(buildMessage));
  });

  // ── Search users ──
  router.get('/api/conversations/search-users', async (request, env) => {
    const uid = request.auth.uid;
    const url = new URL(request.url);
    const query = url.searchParams.get('q');
    if (!query) return jsonError('q required', 400);

    const results = [];

    // Search by displayName prefix
    const { results: nameResults } = await env.DB.prepare(`
      SELECT * FROM users WHERE display_name LIKE ? AND uid != ? LIMIT 20
    `).bind(`${query}%`, uid).all();
    results.push(...nameResults);

    // Also search by uniqueId if query is numeric
    const numericId = parseInt(query);
    if (!isNaN(numericId)) {
      const { results: idResults } = await env.DB.prepare(
        'SELECT * FROM users WHERE unique_id = ? AND uid != ? LIMIT 5'
      ).bind(numericId, uid).all();
      for (const r of idResults) {
        if (!results.some(existing => existing.uid === r.uid)) {
          results.push(r);
        }
      }
    }

    return json(results);
  });

  // ── Get owned group count ──
  router.get('/api/conversations/owned-group-count', async (request, env) => {
    const uid = request.auth.uid;
    const result = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM conversations
      WHERE created_by = ? AND is_group = 1 AND is_closed = 0
    `).bind(uid).first();

    return json({ count: result?.count || 0 });
  });
}

/** Get a Durable Object stub for a conversation. */
function getConversationDO(env, conversationId) {
  const id = env.CONVERSATION_DO.idFromName(conversationId);
  return env.CONVERSATION_DO.get(id);
}

/**
 * Send FCM push notifications to conversation participants (except sender).
 * Checks DND schedule, muted conversations, and notification preferences.
 */
async function sendMessageNotifications(
  env, conversationId, senderId, senderName, previewText, type, participants, isGroup, groupName
) {
  try {
    for (const p of participants) {
      const recipientId = p.user_id;

      // Fetch user notification settings
      const user = await env.DB.prepare(`
        SELECT pm_notifications_enabled, dnd_enabled, dnd_start_hour, dnd_start_minute,
               dnd_end_hour, dnd_end_minute, pm_notification_preview
        FROM users WHERE uid = ?
      `).bind(recipientId).first();

      if (!user || user.pm_notifications_enabled === 0) continue;

      // Check DND schedule
      if (user.dnd_enabled) {
        const utcNow = new Date();
        const currentMinutes = utcNow.getUTCHours() * 60 + utcNow.getUTCMinutes();
        const dndStart = (user.dnd_start_hour || 0) * 60 + (user.dnd_start_minute || 0);
        const dndEnd = (user.dnd_end_hour || 0) * 60 + (user.dnd_end_minute || 0);

        if (dndStart <= dndEnd) {
          if (currentMinutes >= dndStart && currentMinutes < dndEnd) continue;
        } else {
          // Wraps past midnight
          if (currentMinutes >= dndStart || currentMinutes < dndEnd) continue;
        }
      }

      // Check if conversation is muted
      const settings = await env.DB.prepare(
        'SELECT is_muted FROM conversation_settings WHERE conversation_id = ? AND user_id = ?'
      ).bind(conversationId, recipientId).first();

      if (settings?.is_muted) continue;

      // Get FCM tokens
      const { results: tokens } = await env.DB.prepare(
        'SELECT token FROM fcm_tokens WHERE user_id = ?'
      ).bind(recipientId).all();

      if (tokens.length === 0) continue;

      const showPreview = user.pm_notification_preview !== 0;
      const data = {
        type: 'PM',
        senderId,
        senderName: isGroup ? `${senderName} (${groupName || 'Group'})` : senderName,
        messageText: showPreview ? previewText : 'New message',
        conversationId,
        isGroup: String(isGroup),
        showPreview: String(showPreview),
      };

      const invalid = await sendFcmToTokens(env, tokens.map(t => t.token), data);
      await cleanupInvalidTokens(env, invalid, 'fcm_tokens');
    }
  } catch (err) {
    console.error('Failed to send message notifications:', err);
  }
}

/**
 * Send FCM notifications for mod actions to group owner/admins.
 * Respects the conversation's mod_notify_mode setting.
 */
async function sendModActionNotifications(env, conversationId, actorId, actorName, action, targetName) {
  try {
    const conv = await env.DB.prepare(
      'SELECT mod_notify_mode, created_by FROM conversations WHERE id = ?'
    ).bind(conversationId).first();

    if (!conv) return;

    const mode = conv.mod_notify_mode || 'ALL_ADMINS';
    let recipientIds = [];

    if (mode === 'OWNER_ONLY') {
      if (conv.created_by) recipientIds = [conv.created_by];
    } else {
      // ALL_ADMINS: owner + all admin-role participants
      const { results: admins } = await env.DB.prepare(
        "SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND role IN ('OWNER', 'ADMIN')"
      ).bind(conversationId).all();
      recipientIds = admins.map(a => a.user_id);
    }

    // Exclude the actor (the mod who performed the action)
    recipientIds = recipientIds.filter(id => id !== actorId);
    if (recipientIds.length === 0) return;

    for (const recipientId of recipientIds) {
      const { results: tokens } = await env.DB.prepare(
        'SELECT token FROM fcm_tokens WHERE user_id = ?'
      ).bind(recipientId).all();

      if (tokens.length === 0) continue;

      const data = {
        type: 'MOD_ACTION',
        action,
        actorName,
        targetName,
        conversationId,
      };

      const invalid = await sendFcmToTokens(env, tokens.map(t => t.token), data);
      await cleanupInvalidTokens(env, invalid, 'fcm_tokens');
    }
  } catch (err) {
    console.error('Failed to send mod action notifications:', err);
  }
}

/** Broadcast an event to all WebSocket clients connected to a conversation's DO. */
async function broadcastToConversation(env, conversationId, data) {
  try {
    const stub = getConversationDO(env, conversationId);
    await stub.fetch(new Request('https://do/broadcast', {
      method: 'POST',
      body: JSON.stringify(data),
    }));
  } catch (err) {
    console.error(`Failed to broadcast to conversation ${conversationId}:`, err);
  }
}

module.exports = { registerConversationRoutes };

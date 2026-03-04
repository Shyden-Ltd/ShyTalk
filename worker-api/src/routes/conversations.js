/**
 * Conversation routes — private messaging.
 *
 * POST   /api/conversations/:id/messages  → Send message (with FCM push + RTDB broadcast)
 * GET    /api/conversations/:id/messages  → Get conversation messages
 */

const { json, jsonError, generateId, now, parseBody } = require('../utils');
const { sendFcmToTokens } = require('../utils/fcm');
const { writeRtdb } = require('../utils/rtdb');
const {
  getDoc,
  updateDoc,
  queryCollection,
  batchWrite,
  batchUpdateOp,
  batchIncrementOp,
  orderBy,
} = require('../utils/firestore');

const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 200;

/**
 * Build a plain message object from a Firestore message doc.
 */
function buildMessage(doc) {
  return {
    id: doc.id,
    messageId: doc.id,
    senderId: doc.senderId || '',
    senderName: doc.senderName || '',
    text: doc.text || '',
    imageUrls: doc.imageUrls || [],
    type: doc.type || 'TEXT',
    createdAt: doc.createdAt || 0,
    editedAt: doc.editedAt || null,
    editCount: doc.editCount || 0,
    replyToMessageId: doc.replyToId || doc.replyToMessageId || null,
    replyToText: doc.replyToText || null,
    replyToSenderName: doc.replyToSenderName || null,
    stickerUrl: doc.stickerUrl || null,
    roomInviteId: doc.roomInviteId || null,
    roomInviteName: doc.roomInviteName || null,
    reactions: doc.reactions || {},
    isRecalled: !!doc.isRecalled,
    isHidden: !!doc.isHidden,
    hiddenBy: doc.hiddenBy || null,
  };
}

/**
 * Remove an invalid FCM token from the user's doc in Firestore.
 * Tokens are stored as `fcmTokens` array on users/{uid}.
 */
async function removeInvalidFcmTokensFromUser(env, userId, invalidTokens) {
  if (!invalidTokens || invalidTokens.length === 0) return;
  try {
    const userDoc = await getDoc(env, `users/${userId}`);
    if (!userDoc) return;
    const cleaned = (userDoc.fcmTokens || []).filter(t => !invalidTokens.includes(t));
    await updateDoc(env, `users/${userId}`, { fcmTokens: cleaned });
  } catch (err) {
    console.error(`Failed to clean invalid tokens for user ${userId}:`, err);
  }
}

function registerConversationRoutes(router) {

  // ── Get messages ──
  router.get('/api/conversations/:id/messages', async (request, env, params) => {
    const url = new URL(request.url);
    const limit = Math.min(
      parseInt(url.searchParams.get('limit') || String(DEFAULT_MESSAGE_LIMIT)),
      MAX_MESSAGE_LIMIT
    );

    const messages = await queryCollection(env, `conversations/${params.id}/messages`, {
      orderBy: [orderBy('createdAt', 'DESCENDING')],
      limit,
    });

    // Return in chronological order (oldest first)
    return json(messages.reverse().map(buildMessage));
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

    // Build preview text for lastMessage
    let previewText = text;
    if (type === 'IMAGE') previewText = '[Image]';
    else if (type === 'STICKER') previewText = '[Sticker]';
    else if (type === 'ROOM_INVITE') previewText = '[Room Invite]';

    // Read conversation to get participant list and group info
    const convDoc = await getDoc(env, `conversations/${conversationId}`);
    if (!convDoc) return jsonError('Conversation not found', 404);

    const participantIds = convDoc.participantIds || [];
    const recipientIds = participantIds.filter(pid => pid !== senderId);
    const isGroup = !!convDoc.isGroup;
    const groupName = convDoc.groupName || null;

    const msgData = {
      senderId,
      senderName,
      text,
      type,
      imageUrls: body.imageUrls || [],
      stickerUrl: body.stickerUrl || null,
      roomInviteId: body.roomInviteId || null,
      roomInviteName: body.roomInviteName || null,
      replyToId: body.replyToMessageId || null,
      replyToText: body.replyToText || null,
      replyToSenderName: body.replyToSenderName || null,
      reactions: {},
      isRecalled: false,
      isHidden: false,
      hiddenBy: null,
      editCount: 0,
      editedAt: null,
      createdAt: timestamp,
    };

    // Batch: write message + update conversation lastMessage
    const lastMessage = { text: previewText, senderId, senderName, type, timestamp };
    const writes = [
      batchUpdateOp(env, `conversations/${conversationId}/messages/${messageId}`, msgData),
      batchUpdateOp(env, `conversations/${conversationId}`, {
        lastMessage,
        lastMessageAt: timestamp,
      }),
      // Increment unread counts and un-hide the conversation for all recipients
      ...recipientIds.map(pid =>
        batchIncrementOp(env, `conversations/${conversationId}/userSettings/${pid}`, {
          unreadCount: 1,
        })
      ),
    ];

    await batchWrite(env, writes);

    // Un-hide conversation for all recipients (separate update — increment doesn't merge map fields)
    const ctx = request.ctx;
    if (ctx) {
      ctx.waitUntil((async () => {
        try {
          await Promise.all(
            recipientIds.map(pid =>
              updateDoc(env, `conversations/${conversationId}/userSettings/${pid}`, { isHidden: false })
            )
          );
        } catch (err) {
          console.error('Failed to un-hide conversations for recipients:', err);
        }
      })());

      // FCM notifications + RTDB broadcast
      const recipients = recipientIds.map(id => ({ userId: id }));
      ctx.waitUntil(sendMessageNotifications(
        env, conversationId, senderId, senderName, previewText, type, recipients, isGroup, groupName
      ));
      ctx.waitUntil(broadcastToConversation(env, conversationId, { type: 'new_message' }));
    }

    return json(buildMessage({ id: messageId, ...msgData, replyToMessageId: msgData.replyToId }));
  });
}


/**
 * Send FCM push notifications to conversation participants (except sender).
 * Checks DND schedule, muted conversations, and notification preferences.
 * FCM tokens are read from users/{uid}.fcmTokens in Firestore.
 */
async function sendMessageNotifications(
  env, conversationId, senderId, senderName, previewText, type, recipients, isGroup, groupName
) {
  try {
    for (const p of recipients) {
      const recipientId = p.userId;

      // Fetch user doc for notification settings and FCM tokens
      const user = await getDoc(env, `users/${recipientId}`);
      if (!user) continue;
      if (user.pmNotificationsEnabled === false) continue;

      // Check DND schedule
      if (user.dndEnabled) {
        const utcNow = new Date();
        const currentMinutes = utcNow.getUTCHours() * 60 + utcNow.getUTCMinutes();
        const dndStart = (user.dndStartHour || 0) * 60 + (user.dndStartMinute || 0);
        const dndEnd = (user.dndEndHour || 0) * 60 + (user.dndEndMinute || 0);

        if (dndStart <= dndEnd) {
          if (currentMinutes >= dndStart && currentMinutes < dndEnd) continue;
        } else {
          // Wraps past midnight
          if (currentMinutes >= dndStart || currentMinutes < dndEnd) continue;
        }
      }

      // Check if conversation is muted for this recipient
      const settings = await getDoc(env, `conversations/${conversationId}/userSettings/${recipientId}`);
      if (settings?.isMuted) continue;

      // Get FCM tokens from user doc
      const tokens = user.fcmTokens || [];
      if (tokens.length === 0) continue;

      const showPreview = user.pmNotificationPreview !== false;
      const data = {
        type: 'PM',
        senderId,
        senderName: isGroup ? `${senderName} (${groupName || 'Group'})` : senderName,
        messageText: showPreview ? previewText : 'New message',
        conversationId,
        isGroup: String(isGroup),
        showPreview: String(showPreview),
      };

      const invalidTokens = await sendFcmToTokens(env, tokens, data);
      if (invalidTokens.length > 0) {
        await removeInvalidFcmTokensFromUser(env, recipientId, invalidTokens);
      }
    }
  } catch (err) {
    console.error('Failed to send message notifications:', err);
  }
}

/** Broadcast a conversation event via RTDB. */
async function broadcastToConversation(env, conversationId, data) {
  try {
    await writeRtdb(env, `conversations/${conversationId}/events/lastEvent`, {
      type: data.type,
      ts: Date.now(),
    });
  } catch (err) {
    console.error(`Failed to write RTDB event for conversation ${conversationId}:`, err);
  }
}

module.exports = { registerConversationRoutes };

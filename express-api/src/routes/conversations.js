/**
 * Conversation routes - private messaging.
 *
 * GET  /api/conversations/:id/messages -> Get conversation messages
 * POST /api/conversations/:id/messages -> Send message (with FCM push + RTDB broadcast)
 */

const router = require('express').Router();
const { db, rtdb, FieldValue } = require('../utils/firebase');
const { generateId, now } = require('../utils/helpers');
const { sendFcmToTokens, cleanupInvalidTokens } = require('../utils/fcm');
const log = require('../utils/log');

const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 200;
const MAX_TEXT_LENGTH = 2000;
const MAX_IMAGES_PER_MESSAGE = 10;
const MAX_SENDER_NAME_LENGTH = 50;
const VALID_MESSAGE_TYPES = ['TEXT', 'IMAGE', 'STICKER', 'ROOM_INVITE', 'MOD_ACTION'];

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
 * Send FCM push notifications to conversation participants (except sender).
 * Uses batch Firestore reads to minimize read cost.
 */
async function sendMessageNotifications(
  conversationId,
  senderId,
  senderName,
  previewText,
  type,
  recipients,
  isGroup,
  groupName,
) {
  try {
    if (recipients.length === 0) return;

    // Batch-fetch all user docs and settings docs (2 reads instead of 2*N)
    const userRefs = recipients.map((p) => db.doc(`users/${p.userId}`));
    const settingsRefs = recipients.map((p) =>
      db.doc(`conversations/${conversationId}/userSettings/${p.userId}`),
    );

    const [userSnaps, settingsSnaps] = await Promise.all([
      db.getAll(...userRefs),
      db.getAll(...settingsRefs),
    ]);

    // Build lookup maps
    const usersById = {};
    for (const snap of userSnaps) {
      if (snap.exists) usersById[snap.id] = snap.data();
    }
    const settingsById = {};
    for (const snap of settingsSnaps) {
      if (snap.exists) settingsById[snap.id] = snap.data();
    }

    for (const p of recipients) {
      const recipientId = p.userId;
      const user = usersById[recipientId];
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
          if (currentMinutes >= dndStart || currentMinutes < dndEnd) continue;
        }
      }

      // Check if conversation is muted
      const settings = settingsById[recipientId];
      if (settings?.isMuted) continue;

      // Get FCM tokens
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

      const invalidTokens = await sendFcmToTokens(tokens, data);
      if (invalidTokens.length > 0) {
        await cleanupInvalidTokens(invalidTokens, recipientId);
      }
    }
  } catch (err) {
    log.error('conversations', 'Failed to send message notifications', {
      conversationId,
      error: err.message,
    });
  }
}

/** Broadcast a conversation event via RTDB. */
async function broadcastToConversation(conversationId, data) {
  try {
    await rtdb.ref(`conversations/${conversationId}/events/lastEvent`).set({
      type: data.type,
      ts: Date.now(),
    });
  } catch (err) {
    log.error('conversations', 'Failed to write RTDB event', {
      conversationId,
      error: err.message,
    });
  }
}

// -- Get messages --
router.get('/conversations/:id/messages', async (req, res) => {
  try {
    // Verify the requester is a participant
    const convSnap = await db.doc(`conversations/${req.params.id}`).get();
    if (!convSnap.exists) return res.status(404).json({ error: 'Conversation not found' });
    const participantIds = convSnap.data().participantIds || [];
    if (!participantIds.includes(req.auth.uniqueId)) {
      return res.status(403).json({ error: 'Not a participant of this conversation' });
    }

    const limit = Math.min(
      parseInt(req.query.limit, 10) || DEFAULT_MESSAGE_LIMIT,
      MAX_MESSAGE_LIMIT,
    );

    const snap = await db
      .collection(`conversations/${req.params.id}/messages`)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    const messages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Return in chronological order (oldest first)
    return res.json(messages.reverse().map(buildMessage));
  } catch (err) {
    log.error('conversations', 'Failed to fetch messages', {
      conversationId: req.params.id,
      error: err.message,
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Send message --
router.post('/conversations/:id/messages', async (req, res) => {
  try {
    const uniqueId = req.auth.uniqueId;
    const body = req.body;
    if (!body) return res.status(400).json({ error: 'Invalid body' });

    const conversationId = req.params.id;
    const messageId = generateId();
    const timestamp = now();
    const type = body.type || 'TEXT';
    const senderId = uniqueId;
    const senderName = (body.senderName || '').slice(0, MAX_SENDER_NAME_LENGTH);
    const text = (body.text || '').slice(0, MAX_TEXT_LENGTH);

    // Validate message type
    if (!VALID_MESSAGE_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Invalid message type' });
    }

    // Validate imageUrls count
    const imageUrls = Array.isArray(body.imageUrls)
      ? body.imageUrls.slice(0, MAX_IMAGES_PER_MESSAGE)
      : [];

    log.info('conversations', 'Sending message', { conversationId, senderId, type });

    // Build preview text for lastMessage
    let previewText = text;
    if (type === 'IMAGE') previewText = '[Image]';
    else if (type === 'STICKER') previewText = '[Sticker]';
    else if (type === 'ROOM_INVITE') previewText = '[Room Invite]';

    // Read conversation to get participant list and group info
    const convSnap = await db.doc(`conversations/${conversationId}`).get();
    if (!convSnap.exists) return res.status(404).json({ error: 'Conversation not found' });
    const convDoc = convSnap.data();
    if (!convDoc) return res.status(500).json({ error: 'Corrupted conversation data' });

    const participantIds = convDoc.participantIds || [];
    if (!participantIds.includes(senderId)) {
      return res.status(403).json({ error: 'Not a participant of this conversation' });
    }
    const recipientIds = participantIds.filter((pid) => pid !== senderId);
    const isGroup = !!convDoc.isGroup;
    const groupName = convDoc.groupName || null;

    const msgData = {
      senderId,
      senderName,
      text,
      type,
      imageUrls,
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

    // Batch: write message + update conversation lastMessage + increment unread counts
    const lastMessage = { text: previewText, senderId, senderName, type, createdAt: timestamp };
    const batch = db.batch();

    batch.set(db.doc(`conversations/${conversationId}/messages/${messageId}`), msgData);
    batch.set(
      db.doc(`conversations/${conversationId}`),
      {
        lastMessage,
        lastMessageAt: timestamp,
      },
      { merge: true },
    );

    // Increment unread counts for all recipients (set+merge in case doc doesn't exist yet)
    for (const pid of recipientIds) {
      batch.set(
        db.doc(`conversations/${conversationId}/userSettings/${pid}`),
        {
          unreadCount: FieldValue.increment(1),
        },
        { merge: true },
      );
    }

    await batch.commit();

    // Un-hide conversation for all recipients (fire-and-forget)
    Promise.all(
      recipientIds.map((pid) =>
        db
          .doc(`conversations/${conversationId}/userSettings/${pid}`)
          .set({ isHidden: false }, { merge: true }),
      ),
    ).catch((err) =>
      log.error('conversations', 'Failed to un-hide for recipients', {
        conversationId,
        error: err.message,
      }),
    );

    // FCM notifications + RTDB broadcast (fire-and-forget)
    const recipients = recipientIds.map((id) => ({ userId: id }));
    sendMessageNotifications(
      conversationId,
      senderId,
      senderName,
      previewText,
      type,
      recipients,
      isGroup,
      groupName,
    ).catch((err) =>
      log.error('conversations', 'Failed to send notifications', {
        conversationId,
        error: err.message,
      }),
    );

    broadcastToConversation(conversationId, { type: 'new_message' }).catch((err) =>
      log.error('conversations', 'Failed to broadcast event', {
        conversationId,
        error: err.message,
      }),
    );

    return res.json(
      buildMessage({ id: messageId, ...msgData, replyToMessageId: msgData.replyToId }),
    );
  } catch (err) {
    log.error('conversations', 'Failed to send message', {
      conversationId: req.params.id,
      senderId: req.auth?.uniqueId,
      error: err.message,
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

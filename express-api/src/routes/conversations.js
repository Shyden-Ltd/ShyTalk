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
const { requireSameCohort } = require('../middleware/sameCohort');
const { isLiveAdmin } = require('../middleware/auth');
const { auditAdminFlagBypass } = require('../utils/segregation-audit');
const log = require('../utils/log');

/**
 * UK OSA #17 PR 4 + PR 8 — combined gate for conversation reads.
 *
 * Two gate paths, in order:
 *
 *   1. (PR 8) `crossCohortAtMigration: true` → 404 regardless of
 *      current cohorts. Set by the migration script on 1:1 cross-
 *      cohort threads. The flag is the load-bearing rules-side hide
 *      (firestore.rules denies reads on the parent + every
 *      subcollection when set, per PR 3); Express mirrors the 404
 *      as defence in depth. Admin callers are exempt (live-admin
 *      re-check, same pattern as `requireSameCohort`) — moderators
 *      need cross-cohort visibility for forensics. No audit row is
 *      written here: the migration already wrote one per migrated
 *      thread, and a per-request audit on a known-blocked thread
 *      would be noise.
 *
 *   2. (PR 4) Runtime cohort gate — 1:1 only. Looks up the OTHER
 *      participant's current cohort and 404s if it mismatches the
 *      caller's. Group conversations skip both gates (the freeze
 *      semantics for groups are participant-list only — existing
 *      members keep read+write per design doc § "Migration").
 */
async function gateCrossCohortConversation(req, res, conv) {
  if (conv?.crossCohortAtMigration === true) {
    // Admin re-check matches requireSameCohort's pattern (60s
    // adminClaimCache, demoted-admin defence). Honoured here so a
    // mod can read a hidden thread for an appeal without bypassing
    // the rest of the gate machinery.
    if (req?.auth?.token?.admin === true) {
      const liveAdmin = req?.auth?.uid ? await isLiveAdmin(req.auth.uid) : false;
      if (liveAdmin) {
        auditAdminFlagBypass(req, String(req?.params?.id ?? ''));
        return false;
      }
    }
    res.status(404).json({ error: 'Not found' });
    return true;
  }
  if (conv?.isGroup) return false;
  const participantIds = (conv?.participantIds || []).map(String);
  if (participantIds.length !== 2) return false;
  const callerId = String(req.auth.uniqueId);
  const otherId = participantIds.find((p) => p !== callerId);
  if (!otherId) return false;
  return requireSameCohort(req, res, otherId, async () => {
    const snap = await db.doc(`users/${otherId}`).get();
    return snap.exists ? snap.data() : null;
  });
}

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

/** Check if the current time falls within a user's DND schedule. */
function isInDndPeriod(user) {
  if (!user.dndEnabled) return false;
  const utcNow = new Date();
  const currentMinutes = utcNow.getUTCHours() * 60 + utcNow.getUTCMinutes();
  const dndStart = (user.dndStartHour || 0) * 60 + (user.dndStartMinute || 0);
  const dndEnd = (user.dndEndHour || 0) * 60 + (user.dndEndMinute || 0);

  if (dndStart <= dndEnd) {
    return currentMinutes >= dndStart && currentMinutes < dndEnd;
  }
  return currentMinutes >= dndStart || currentMinutes < dndEnd;
}

/** Determine if a recipient should receive a notification. */
function shouldNotifyRecipient(user, settings) {
  if (!user) return false;
  if (user.pmNotificationsEnabled === false) return false;
  if (isInDndPeriod(user)) return false;
  if (settings?.isMuted) return false;
  if (!user.fcmTokens || user.fcmTokens.length === 0) return false;
  return true;
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

    const userRefs = recipients.map((p) => db.doc(`users/${p.userId}`));
    const settingsRefs = recipients.map((p) =>
      db.doc(`conversations/${conversationId}/userSettings/${p.userId}`),
    );

    const [userSnaps, settingsSnaps] = await Promise.all([
      db.getAll(...userRefs),
      db.getAll(...settingsRefs),
    ]);

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
      const settings = settingsById[recipientId];

      if (!shouldNotifyRecipient(user, settings)) continue;

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

      const invalidTokens = await sendFcmToTokens(user.fcmTokens, data);
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
    const conv = convSnap.data();
    const participantIds = conv.participantIds || [];
    if (!participantIds.map(String).includes(String(req.auth.uniqueId))) {
      return res.status(403).json({ error: 'Not a participant of this conversation' });
    }

    if (await gateCrossCohortConversation(req, res, conv)) return;

    const limit = Math.min(
      Number.parseInt(req.query.limit, 10) || DEFAULT_MESSAGE_LIMIT,
      MAX_MESSAGE_LIMIT,
    );

    const snap = await db
      .collection(`conversations/${req.params.id}/messages`)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    const messages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Return in chronological order (oldest first)
    return res.json(messages.toReversed().map(buildMessage));
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

    if (await gateCrossCohortConversation(req, res, convDoc)) return;

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

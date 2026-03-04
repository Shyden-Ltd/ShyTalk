/**
 * System PM helper — sends private messages from SHYTALK_SYSTEM.
 *
 * Firestore implementation. Creates the conversation if needed,
 * inserts the message, and updates last-message denorm + unread counts.
 */

const { generateId, now } = require('../utils');
const { getDoc, setDoc, updateDoc, incrementField } = require('./firestore');
const { writeRtdb } = require('./rtdb');

const SYSTEM_UID = 'SHYTALK_SYSTEM';
const SYSTEM_DISPLAY_NAME = 'ShyTalk System';

/**
 * Ensure the SHYTALK_SYSTEM user doc exists.
 */
async function ensureSystemUser(env) {
  const existing = await getDoc(env, `users/${SYSTEM_UID}`);
  if (!existing) {
    const timestamp = now();
    await setDoc(env, `users/${SYSTEM_UID}`, {
      id: SYSTEM_UID,
      displayName: SYSTEM_DISPLAY_NAME,
      userType: 'SYSTEM',
      createdAt: timestamp,
      lastSeenAt: timestamp,
    });
  }
}

/**
 * Compute deterministic conversation ID for a 1-on-1 with SYSTEM.
 */
function systemConversationId(recipientUid) {
  return [recipientUid, SYSTEM_UID].sort().join('_');
}

/**
 * Send a system PM to a user.
 *
 * @param {object} env - Worker env bindings
 * @param {string} recipientUid - Target user UID
 * @param {string} text - Message text
 */
async function sendSystemPm(env, recipientUid, text) {
  await ensureSystemUser(env);

  const convId = systemConversationId(recipientUid);
  const timestamp = now();
  const msgId = generateId();

  // Upsert conversation doc (setDoc overwrites / creates)
  const convDoc = await getDoc(env, `conversations/${convId}`);
  const convData = {
    id: convId,
    isGroup: false,
    participantIds: convDoc?.participantIds || [recipientUid, SYSTEM_UID],
    lastMessageText: text,
    lastMessageSenderId: SYSTEM_UID,
    lastMessageSenderName: SYSTEM_DISPLAY_NAME,
    lastMessageType: 'TEXT',
    lastMessageAt: timestamp,
  };
  if (!convDoc) {
    convData.createdAt = timestamp;
  }
  await setDoc(env, `conversations/${convId}`, convData);

  // Insert message in subcollection
  await setDoc(env, `conversations/${convId}/messages/${msgId}`, {
    id: msgId,
    conversationId: convId,
    senderId: SYSTEM_UID,
    senderName: SYSTEM_DISPLAY_NAME,
    text,
    type: 'SYSTEM',
    createdAt: timestamp,
  });

  // Increment unread count for recipient + unhide
  const settingsPath = `conversations/${convId}/userSettings/${recipientUid}`;
  const settings = await getDoc(env, settingsPath);
  if (settings) {
    await updateDoc(env, settingsPath, {
      unreadCount: (settings.unreadCount || 0) + 1,
      isHidden: false,
    });
  } else {
    await setDoc(env, settingsPath, {
      userId: recipientUid,
      conversationId: convId,
      unreadCount: 1,
      isHidden: false,
    });
  }

  // Broadcast via RTDB
  try {
    await writeRtdb(env, `conversations/${convId}/events/lastEvent`, {
      type: 'new_message',
      ts: Date.now(),
    });
  } catch (_) { /* RTDB broadcast is best-effort */ }
}

module.exports = { sendSystemPm, SYSTEM_UID, systemConversationId };

const { db, rtdb, FieldValue } = require('./firebase');
const { generateId, now } = require('./helpers');
const log = require('./log');

const SYSTEM_UID = 'SHYTALK_SYSTEM';
const SYSTEM_DISPLAY_NAME = 'ShyTalk System';

async function ensureSystemUser() {
  const snap = await db.doc(`users/${SYSTEM_UID}`).get();
  if (!snap.exists) {
    const timestamp = now();
    await db.doc(`users/${SYSTEM_UID}`).set({
      id: SYSTEM_UID,
      displayName: SYSTEM_DISPLAY_NAME,
      userType: 'SYSTEM',
      createdAt: timestamp,
      lastSeenAt: timestamp,
    });
  }
}

function systemConversationId(recipientUid) {
  return [recipientUid, SYSTEM_UID].sort().join('_');
}

async function sendSystemPm(recipientUid, text) {
  await ensureSystemUser();

  const convId = systemConversationId(recipientUid);
  const timestamp = now();
  const msgId = generateId();

  const convSnap = await db.doc(`conversations/${convId}`).get();
  const convData = {
    id: convId,
    isGroup: false,
    participantIds: convSnap.exists ? (convSnap.data().participantIds || [recipientUid, SYSTEM_UID]) : [recipientUid, SYSTEM_UID],
    lastMessage: {
      text,
      senderId: SYSTEM_UID,
      senderName: SYSTEM_DISPLAY_NAME,
      type: 'SYSTEM',
      createdAt: timestamp,
    },
    lastMessageAt: timestamp,
  };
  if (!convSnap.exists) convData.createdAt = timestamp;
  await db.doc(`conversations/${convId}`).set(convData, { merge: true });

  await db.doc(`conversations/${convId}/messages/${msgId}`).set({
    id: msgId,
    conversationId: convId,
    senderId: SYSTEM_UID,
    senderName: SYSTEM_DISPLAY_NAME,
    text,
    type: 'SYSTEM',
    createdAt: timestamp,
  });

  const settingsPath = `conversations/${convId}/userSettings/${recipientUid}`;
  await db.doc(settingsPath).set({
    userId: recipientUid,
    conversationId: convId,
    unreadCount: FieldValue.increment(1),
    isHidden: false,
  }, { merge: true });

  try {
    await rtdb.ref(`conversations/${convId}/events/lastEvent`).set({
      type: 'new_message',
      ts: Date.now(),
    });
  } catch (err) { log.warn('system-pm', 'Failed to write RTDB event', { convId, error: err.message }); }
}

module.exports = { sendSystemPm, SYSTEM_UID, systemConversationId };

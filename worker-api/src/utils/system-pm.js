/**
 * System PM helper — sends private messages from SHYTALK_SYSTEM.
 *
 * D1-only implementation (no Firestore). Creates the conversation if needed,
 * inserts the message, and updates last-message denorm + unread counts.
 */

const { generateId, now } = require('../utils');

const SYSTEM_UID = 'SHYTALK_SYSTEM';
const SYSTEM_DISPLAY_NAME = 'ShyTalk System';

/**
 * Ensure the SHYTALK_SYSTEM user row exists.
 */
async function ensureSystemUser(env) {
  const existing = await env.DB.prepare(
    'SELECT uid FROM users WHERE uid = ?'
  ).bind(SYSTEM_UID).first();

  if (!existing) {
    await env.DB.prepare(`
      INSERT INTO users (uid, display_name, user_type, created_at, last_seen_at)
      VALUES (?, ?, 'SYSTEM', ?, ?)
    `).bind(SYSTEM_UID, SYSTEM_DISPLAY_NAME, now(), now()).run();
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
 * @param {object} env - Worker env bindings (DB, etc.)
 * @param {string} recipientUid - Target user UID
 * @param {string} text - Message text
 */
async function sendSystemPm(env, recipientUid, text) {
  await ensureSystemUser(env);

  const convId = systemConversationId(recipientUid);
  const timestamp = now();
  const msgId = generateId();

  const stmts = [];

  // Upsert conversation
  stmts.push(env.DB.prepare(`
    INSERT INTO conversations (id, is_group, last_message_text, last_message_sender_id,
      last_message_sender_name, last_message_type, last_message_at, created_at)
    VALUES (?, 0, ?, ?, ?, 'TEXT', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      last_message_text = ?, last_message_sender_id = ?,
      last_message_sender_name = ?, last_message_type = 'TEXT', last_message_at = ?
  `).bind(
    convId, text, SYSTEM_UID, SYSTEM_DISPLAY_NAME, timestamp, timestamp,
    text, SYSTEM_UID, SYSTEM_DISPLAY_NAME, timestamp
  ));

  // Ensure both participants exist
  stmts.push(env.DB.prepare(`
    INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at)
    VALUES (?, ?, 'MEMBER', ?)
    ON CONFLICT(conversation_id, user_id) DO NOTHING
  `).bind(convId, recipientUid, timestamp));

  stmts.push(env.DB.prepare(`
    INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at)
    VALUES (?, ?, 'MEMBER', ?)
    ON CONFLICT(conversation_id, user_id) DO NOTHING
  `).bind(convId, SYSTEM_UID, timestamp));

  // Insert message
  stmts.push(env.DB.prepare(`
    INSERT INTO private_messages (id, conversation_id, sender_id, sender_name, text, type, created_at)
    VALUES (?, ?, ?, ?, ?, 'SYSTEM', ?)
  `).bind(msgId, convId, SYSTEM_UID, SYSTEM_DISPLAY_NAME, text, timestamp));

  // Upsert conversation_settings for recipient — increment unread
  stmts.push(env.DB.prepare(`
    INSERT INTO conversation_settings (conversation_id, user_id, unread_count)
    VALUES (?, ?, 1)
    ON CONFLICT(conversation_id, user_id) DO UPDATE SET
      unread_count = unread_count + 1, is_hidden = 0
  `).bind(convId, recipientUid));

  await env.DB.batch(stmts);

  // Try to broadcast via ConversationDO if available
  try {
    if (env.CONVERSATION_DO) {
      const doId = env.CONVERSATION_DO.idFromName(convId);
      const stub = env.CONVERSATION_DO.get(doId);
      await stub.fetch(new Request('https://do/broadcast', {
        method: 'POST',
        body: JSON.stringify({
          type: 'new_message',
          message: { id: msgId, conversationId: convId, senderId: SYSTEM_UID, text, type: 'SYSTEM', createdAt: timestamp },
        }),
      }));
    }
  } catch (_) { /* DO broadcast is best-effort */ }
}

module.exports = { sendSystemPm, SYSTEM_UID, systemConversationId };

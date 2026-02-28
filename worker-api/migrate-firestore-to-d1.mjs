#!/usr/bin/env node

/**
 * Firestore → D1 Migration Script
 *
 * Exports all data from Firestore and imports into Cloudflare D1.
 *
 * Usage:
 *   1. Set env vars (or use .env):
 *      GOOGLE_APPLICATION_CREDENTIALS=../shytalk-7ba69-firebase-adminsdk-fbsvc-da605a6ee9.json
 *   2. Run the D1 schema migration first:
 *      wrangler d1 execute shytalk-db --remote --file=migrations/0001_initial_schema.sql
 *   3. Run this script:
 *      node migrate-firestore-to-d1.mjs
 *
 * This script uses the Firebase Admin SDK to read Firestore and outputs
 * SQL INSERT statements that can be piped into D1 via wrangler.
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

// Initialize Firebase Admin
const serviceAccountPath = resolve(
  import.meta.dirname,
  '../shytalk-7ba69-firebase-adminsdk-fbsvc-da605a6ee9.json'
);
initializeApp({ credential: cert(serviceAccountPath) });

const db = getFirestore();
const statements = [];

function sql(str) {
  statements.push(str + ';');
}

function esc(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? '1' : '0';
  if (typeof val === 'number') return String(val);
  if (val instanceof Date) return String(val.getTime());
  if (val?.toMillis) return String(val.toMillis()); // Firestore Timestamp
  if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
  return `'${String(val).replace(/'/g, "''")}'`;
}

function toMs(val) {
  if (!val) return 'NULL';
  if (val.toMillis) return String(val.toMillis());
  if (val instanceof Date) return String(val.getTime());
  if (typeof val === 'number') return String(val);
  return 'NULL';
}

async function migrateUsers() {
  console.log('Migrating users...');
  const snap = await db.collection('users').get();

  for (const doc of snap.docs) {
    const d = doc.data();
    sql(`INSERT OR IGNORE INTO users (
      uid, unique_id, display_name, description, nationality, date_of_birth, gender, user_type,
      profile_photo_url, cover_photo_url,
      shy_coins, shy_beans, luck_score, pity_counter,
      is_super_shy, super_shy_expiry, super_shy_tier, has_claimed_super_shy_trial,
      login_streak, last_login_date, last_login_reward_date,
      is_suspended, suspension_reason, suspension_start_date, suspension_end_date,
      suspension_can_appeal, suspension_appeal_status, suspended_by,
      warning_count, warning_reason, has_active_warning, gcs_score,
      pre_suspension_display_name, pre_suspension_profile_photo_url, pre_suspension_cover_photo_url,
      pm_privacy, pm_notifications_enabled, pm_sound_enabled,
      pm_show_timestamps, pm_show_date_separators, pm_notification_preview,
      hide_following, hide_online_status, hide_age,
      self_destruct_alert_enabled, min_gift_animation_value,
      dnd_enabled, dnd_start_hour, dnd_start_minute, dnd_end_hour, dnd_end_minute,
      stalker_count, new_stalker_count, stalkers_last_viewed_at,
      accepted_legal_version, current_room_id, guaranteed_next_pull_gift_id,
      created_at, last_seen_at
    ) VALUES (
      ${esc(doc.id)}, ${esc(d.uniqueId)}, ${esc(d.displayName)}, ${esc(d.description)},
      ${esc(d.nationality)}, ${esc(d.dateOfBirth)}, ${esc(d.gender)}, ${esc(d.userType || 'MEMBER')},
      ${esc(d.profilePhotoUrl)}, ${esc(d.coverPhotoUrl)},
      ${esc(d.shyCoins || 0)}, ${esc(d.shyBeans || 0)}, ${esc(d.luckScore || 0)}, ${esc(d.pityCounter || 0)},
      ${d.isSuperShy ? 1 : 0}, ${toMs(d.superShyExpiry)}, ${esc(d.superShyTier)}, ${d.hasClaimedSuperShyTrial ? 1 : 0},
      ${esc(d.loginStreak || 0)}, ${esc(d.lastLoginDate)}, ${esc(d.lastLoginRewardDate)},
      ${d.isSuspended ? 1 : 0}, ${esc(d.suspensionReason)}, ${toMs(d.suspensionStartDate)}, ${toMs(d.suspensionEndDate)},
      ${d.suspensionCanAppeal === false ? 0 : 1}, ${esc(d.suspensionAppealStatus)}, ${esc(d.suspendedBy)},
      ${esc(d.warningCount || 0)}, ${esc(d.warningReason)}, ${d.hasActiveWarning ? 1 : 0}, ${esc(d.gcsScore || 100)},
      ${esc(d._preSuspension?.displayName)}, ${esc(d._preSuspension?.profilePhotoUrl)}, ${esc(d._preSuspension?.coverPhotoUrl)},
      ${esc(d.pmPrivacy || 'EVERYONE')}, ${d.pmNotificationsEnabled === false ? 0 : 1}, ${d.pmSoundEnabled === false ? 0 : 1},
      ${d.pmShowTimestamps === false ? 0 : 1}, ${d.pmShowDateSeparators === false ? 0 : 1}, ${d.pmNotificationPreview === false ? 0 : 1},
      ${d.hideFollowing ? 1 : 0}, ${d.hideOnlineStatus ? 1 : 0}, ${d.hideAge ? 1 : 0},
      ${d.selfDestructAlertEnabled ? 1 : 0}, ${esc(d.minGiftAnimationValue || 0)},
      ${d.dndEnabled ? 1 : 0}, ${esc(d.dndStartHour ?? 22)}, ${esc(d.dndStartMinute ?? 0)}, ${esc(d.dndEndHour ?? 8)}, ${esc(d.dndEndMinute ?? 0)},
      ${esc(d.stalkerCount || 0)}, ${esc(d.newStalkerCount || 0)}, ${toMs(d.stalkersLastViewedAt)},
      ${esc(d.acceptedLegalVersion || 0)}, ${esc(d.currentRoomId)}, ${esc(d.guaranteedNextPull?.giftId)},
      ${toMs(d.createdAt)}, ${toMs(d.lastSeenAt)}
    )`);

    // Blocked users
    const blocked = d.blockedUserIds || [];
    for (const bid of blocked) {
      sql(`INSERT OR IGNORE INTO user_blocks (user_id, blocked_user_id) VALUES (${esc(doc.id)}, ${esc(bid)})`);
    }

    // Following
    const following = d.followingIds || [];
    for (const fid of following) {
      sql(`INSERT OR IGNORE INTO user_follows (follower_id, following_id) VALUES (${esc(doc.id)}, ${esc(fid)})`);
    }

    // FCM tokens
    const tokens = d.fcmTokens || [];
    for (const token of tokens) {
      sql(`INSERT OR IGNORE INTO fcm_tokens (user_id, token) VALUES (${esc(doc.id)}, ${esc(token)})`);
    }

    // Aliases
    const aliases = d.aliases || {};
    for (const [targetId, alias] of Object.entries(aliases)) {
      sql(`INSERT OR IGNORE INTO user_aliases (user_id, target_user_id, alias) VALUES (${esc(doc.id)}, ${esc(targetId)}, ${esc(alias)})`);
    }

    // Stalkers subcollection
    const stalkersSnap = await doc.ref.collection('stalkers').get();
    for (const sDoc of stalkersSnap.docs) {
      const s = sDoc.data();
      sql(`INSERT OR IGNORE INTO stalkers (profile_user_id, visitor_id, visit_count, first_visited_at, last_visited_at)
        VALUES (${esc(doc.id)}, ${esc(sDoc.id)}, ${esc(s.visitCount || 1)}, ${toMs(s.firstVisitedAt)}, ${toMs(s.lastVisitedAt)})`);
    }

    // Backpack subcollection
    const bpSnap = await doc.ref.collection('backpack').get();
    for (const bpDoc of bpSnap.docs) {
      const bp = bpDoc.data();
      sql(`INSERT OR IGNORE INTO backpack_items (user_id, gift_id, quantity, last_acquired, expires_at)
        VALUES (${esc(doc.id)}, ${esc(bpDoc.id)}, ${esc(bp.quantity || 0)}, ${toMs(bp.lastAcquired)}, ${toMs(bp.expiresAt)})`);
    }

    // Gift wall subcollection
    const gwSnap = await doc.ref.collection('giftWall').get();
    for (const gwDoc of gwSnap.docs) {
      const gw = gwDoc.data();
      sql(`INSERT OR IGNORE INTO gift_wall (user_id, gift_id, received_count)
        VALUES (${esc(doc.id)}, ${esc(gwDoc.id)}, ${esc(gw.receivedCount || 0)})`);

      const senders = gw.senders || {};
      for (const [senderId, count] of Object.entries(senders)) {
        sql(`INSERT OR IGNORE INTO gift_wall_senders (user_id, gift_id, sender_id, send_count)
          VALUES (${esc(doc.id)}, ${esc(gwDoc.id)}, ${esc(senderId)}, ${esc(count)})`);
      }
    }

    // Transactions subcollection
    const txSnap = await doc.ref.collection('transactions').get();
    for (const txDoc of txSnap.docs) {
      const tx = txDoc.data();
      sql(`INSERT OR IGNORE INTO transactions (id, user_id, type, amount, currency, balance_after,
        gift_id, gift_name, recipient_id, sender_id, pull_count, quantity, details, timestamp)
        VALUES (${esc(txDoc.id)}, ${esc(doc.id)}, ${esc(tx.type)}, ${esc(tx.amount || 0)},
        ${esc(tx.currency || 'COINS')}, ${esc(tx.balanceAfter)},
        ${esc(tx.giftId)}, ${esc(tx.giftName)}, ${esc(tx.recipientId)}, ${esc(tx.senderId)},
        ${esc(tx.pullCount)}, ${esc(tx.quantity)}, ${esc(tx.details)}, ${toMs(tx.timestamp)})`);
    }
  }

  console.log(`  ${snap.size} users migrated`);
}

async function migrateConfig() {
  console.log('Migrating config...');
  const snap = await db.collection('config').get();
  for (const doc of snap.docs) {
    sql(`INSERT OR IGNORE INTO config (key, value) VALUES (${esc(doc.id)}, ${esc(JSON.stringify(doc.data()))})`);
  }
  console.log(`  ${snap.size} config docs migrated`);
}

async function migrateGifts() {
  console.log('Migrating gifts...');
  const snap = await db.collection('gifts').get();
  for (const doc of snap.docs) {
    const g = doc.data();
    sql(`INSERT OR IGNORE INTO gifts (id, name, coin_value, animation_url, sound_url, icon_url, "order",
      expires_after_days, show_in_store, show_on_wheel)
      VALUES (${esc(doc.id)}, ${esc(g.name)}, ${esc(g.coinValue)}, ${esc(g.animationUrl || '')},
      ${esc(g.soundUrl || '')}, ${esc(g.iconUrl || '')}, ${esc(g.order || 0)},
      ${esc(g.expiresAfterDays)}, ${g.showInStore === false ? 0 : 1}, ${g.showOnWheel === false ? 0 : 1})`);
  }
  console.log(`  ${snap.size} gifts migrated`);
}

async function migrateCoinPackages() {
  console.log('Migrating coin packages...');
  const snap = await db.collection('coinPackages').get();
  for (const doc of snap.docs) {
    const p = doc.data();
    sql(`INSERT OR IGNORE INTO coin_packages (id, product_id, coins, bonus_coins, display_price, "order", is_active)
      VALUES (${esc(doc.id)}, ${esc(p.productId)}, ${esc(p.coins)}, ${esc(p.bonusCoins || 0)},
      ${esc(p.displayPrice)}, ${esc(p.order || 0)}, ${p.isActive === false ? 0 : 1})`);
  }
  console.log(`  ${snap.size} coin packages migrated`);
}

async function migrateBroadcasts() {
  console.log('Migrating broadcasts...');
  const snap = await db.collection('broadcasts').orderBy('timestamp', 'desc').limit(50).get();
  for (const doc of snap.docs) {
    const b = doc.data();
    sql(`INSERT OR IGNORE INTO broadcasts (id, type, sender_name, sender_photo_url, recipient_name,
      gift_name, gift_icon_url, gift_coin_value, quantity, timestamp)
      VALUES (${esc(doc.id)}, ${esc(b.type)}, ${esc(b.senderName)}, ${esc(b.senderPhotoUrl)},
      ${esc(b.recipientName)}, ${esc(b.giftName)}, ${esc(b.giftIconUrl)},
      ${esc(b.giftCoinValue)}, ${esc(b.quantity || 1)}, ${toMs(b.timestamp)})`);
  }
  console.log(`  ${snap.size} broadcasts migrated`);
}

async function migrateConversations() {
  console.log('Migrating conversations...');
  const snap = await db.collection('conversations').get();

  for (const doc of snap.docs) {
    const c = doc.data();
    const lastMsg = c.lastMessage || {};

    sql(`INSERT OR IGNORE INTO conversations (id, is_group, group_name, group_photo_url, group_description,
      created_by, is_closed, mod_notify_mode,
      last_message_text, last_message_sender_id, last_message_sender_name, last_message_type, last_message_at,
      created_at)
      VALUES (${esc(doc.id)}, ${c.isGroup ? 1 : 0}, ${esc(c.groupName)}, ${esc(c.groupPhotoUrl)},
      ${esc(c.groupDescription)}, ${esc(c.createdBy)}, ${c.isClosed ? 1 : 0}, ${esc(c.modNotifyMode || 'ALL_ADMINS')},
      ${esc(lastMsg.text)}, ${esc(lastMsg.senderId)}, ${esc(lastMsg.senderName)}, ${esc(lastMsg.type)},
      ${toMs(c.lastMessageAt)}, ${toMs(c.createdAt)})`);

    // Participants
    const participants = c.participantIds || [];
    const adminIds = c.groupAdminIds || [];
    const modIds = c.groupModIds || [];

    for (const pid of participants) {
      let role = 'MEMBER';
      if (pid === c.createdBy) role = 'OWNER';
      else if (adminIds.includes(pid)) role = 'ADMIN';
      else if (modIds.includes(pid)) role = 'MOD';
      sql(`INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id, role)
        VALUES (${esc(doc.id)}, ${esc(pid)}, ${esc(role)})`);
    }

    // Permissions
    if (c.permissions) {
      const p = c.permissions;
      sql(`INSERT OR IGNORE INTO conversation_permissions (conversation_id, who_can_send, who_can_add_members,
        who_can_edit_info, who_can_delete_messages, who_can_mute_members, who_can_remove_members)
        VALUES (${esc(doc.id)}, ${esc(p.whoCanSend || 'EVERYONE')}, ${esc(p.whoCanAddMembers || 'EVERYONE')},
        ${esc(p.whoCanEditInfo || 'EVERYONE')}, ${esc(p.whoCanDeleteMessages || 'MODS_AND_ABOVE')},
        ${esc(p.whoCanMuteMembers || 'MODS_AND_ABOVE')}, ${esc(p.whoCanRemoveMembers || 'ADMINS_ONLY')})`);
    }

    // Settings subcollection
    const settingsSnap = await doc.ref.collection('settings').get();
    for (const sDoc of settingsSnap.docs) {
      const s = sDoc.data();
      sql(`INSERT OR IGNORE INTO conversation_settings (conversation_id, user_id, is_muted, is_hidden,
        hidden_at, is_pinned, last_read_message_id, last_read_at, unread_count)
        VALUES (${esc(doc.id)}, ${esc(sDoc.id)}, ${s.isMuted ? 1 : 0}, ${s.isHidden ? 1 : 0},
        ${toMs(s.hiddenAt)}, ${s.isPinned ? 1 : 0}, ${esc(s.lastReadMessageId)},
        ${toMs(s.lastReadAt)}, ${esc(s.unreadCount || 0)})`);
    }

    // Messages subcollection
    const msgsSnap = await doc.ref.collection('messages').orderBy('createdAt', 'desc').limit(1000).get();
    for (const mDoc of msgsSnap.docs) {
      const m = mDoc.data();
      sql(`INSERT OR IGNORE INTO private_messages (id, conversation_id, sender_id, sender_name, text, type,
        image_urls, sticker_url, room_invite_id, room_invite_name,
        reply_to_message_id, reply_to_text, reply_to_sender_name,
        is_recalled, is_hidden, hidden_by, edit_count, created_at, edited_at)
        VALUES (${esc(mDoc.id)}, ${esc(doc.id)}, ${esc(m.senderId)}, ${esc(m.senderName)}, ${esc(m.text)},
        ${esc(m.type || 'TEXT')}, ${esc(m.imageUrls ? JSON.stringify(m.imageUrls) : null)},
        ${esc(m.stickerUrl)}, ${esc(m.roomInviteId)}, ${esc(m.roomInviteName)},
        ${esc(m.replyToMessageId)}, ${esc(m.replyToText)}, ${esc(m.replyToSenderName)},
        ${m.isRecalled ? 1 : 0}, ${m.isHidden ? 1 : 0}, ${esc(m.hiddenBy)},
        ${esc(m.editCount || 0)}, ${toMs(m.createdAt)}, ${toMs(m.editedAt)})`);

      // Reactions
      const reactions = m.reactions || {};
      for (const [emoji, userIds] of Object.entries(reactions)) {
        for (const userId of (Array.isArray(userIds) ? userIds : [])) {
          sql(`INSERT OR IGNORE INTO message_reactions (message_id, emoji, user_id) VALUES (${esc(mDoc.id)}, ${esc(emoji)}, ${esc(userId)})`);
        }
      }

      // Read receipts
      const readBy = m.readBy || [];
      for (const userId of readBy) {
        sql(`INSERT OR IGNORE INTO message_read_by (message_id, user_id) VALUES (${esc(mDoc.id)}, ${esc(userId)})`);
      }

      // Edit history
      const editsSnap = await mDoc.ref.collection('edits').get();
      for (const eDoc of editsSnap.docs) {
        const e = eDoc.data();
        sql(`INSERT OR IGNORE INTO message_edits (id, message_id, conversation_id, previous_text, edited_at)
          VALUES (${esc(eDoc.id)}, ${esc(mDoc.id)}, ${esc(doc.id)}, ${esc(e.previousText)}, ${toMs(e.editedAt)})`);
      }
    }

    // Mutes subcollection
    const mutesSnap = await doc.ref.collection('mutes').get();
    for (const muteDoc of mutesSnap.docs) {
      const mu = muteDoc.data();
      sql(`INSERT OR IGNORE INTO conversation_mutes (conversation_id, user_id, muted_by, muted_by_name,
        reason, muted_at, expires_at, is_active)
        VALUES (${esc(doc.id)}, ${esc(muteDoc.id)}, ${esc(mu.mutedBy)}, ${esc(mu.mutedByName)},
        ${esc(mu.reason)}, ${toMs(mu.mutedAt)}, ${toMs(mu.expiresAt)}, ${mu.isActive !== false ? 1 : 0})`);
    }

    // Mod log subcollection
    const modLogSnap = await doc.ref.collection('mod_log').get();
    for (const logDoc of modLogSnap.docs) {
      const l = logDoc.data();
      sql(`INSERT OR IGNORE INTO conversation_mod_log (id, conversation_id, mod_id, mod_name, action,
        target_user_id, target_user_name, reason, created_at)
        VALUES (${esc(logDoc.id)}, ${esc(doc.id)}, ${esc(l.modId)}, ${esc(l.modName)}, ${esc(l.action)},
        ${esc(l.targetUserId)}, ${esc(l.targetUserName)}, ${esc(l.reason)}, ${toMs(l.createdAt)})`);
    }
  }

  console.log(`  ${snap.size} conversations migrated`);
}

async function migrateRooms() {
  console.log('Migrating rooms...');
  const snap = await db.collection('rooms').get();

  for (const doc of snap.docs) {
    const r = doc.data();
    sql(`INSERT OR IGNORE INTO rooms (id, name, owner_id, state, voice_room_name, require_approval,
      owner_left_at, created_at, closed_at)
      VALUES (${esc(doc.id)}, ${esc(r.name)}, ${esc(r.ownerId)}, ${esc(r.state || 'ACTIVE')},
      ${esc(r.voiceRoomName)}, ${r.requireApproval ? 1 : 0},
      ${toMs(r.ownerLeftAt)}, ${toMs(r.createdAt)}, ${toMs(r.closedAt)})`);

    // Seats
    const seats = r.seats || {};
    for (const [index, seat] of Object.entries(seats)) {
      sql(`INSERT OR IGNORE INTO room_seats (room_id, seat_index, user_id, state, is_muted)
        VALUES (${esc(doc.id)}, ${esc(parseInt(index))}, ${esc(seat.userId)},
        ${esc(seat.state || 'EMPTY')}, ${seat.isMuted ? 1 : 0})`);
    }

    // Participants
    for (const pid of (r.participantIds || [])) {
      const firstJoin = r.firstJoinTimestamps?.[pid];
      sql(`INSERT OR IGNORE INTO room_participants (room_id, user_id, first_join_at)
        VALUES (${esc(doc.id)}, ${esc(pid)}, ${toMs(firstJoin)})`);
    }

    // Hosts
    for (const hid of (r.hostIds || [])) {
      sql(`INSERT OR IGNORE INTO room_hosts (room_id, user_id) VALUES (${esc(doc.id)}, ${esc(hid)})`);
    }

    // Bans
    for (const bid of (r.bannedUserIds || [])) {
      const kickInfo = r.kickInfo?.[bid] || {};
      sql(`INSERT OR IGNORE INTO room_bans (room_id, user_id, reason, kicker_name)
        VALUES (${esc(doc.id)}, ${esc(bid)}, ${esc(kickInfo.reason)}, ${esc(kickInfo.kickerName)})`);
    }

    // Invites
    for (const [uid, invitedBy] of Object.entries(r.pendingInvites || {})) {
      sql(`INSERT OR IGNORE INTO room_invites (room_id, user_id, invited_by)
        VALUES (${esc(doc.id)}, ${esc(uid)}, ${esc(invitedBy)})`);
    }

    // Room messages
    const msgsSnap = await doc.ref.collection('messages').orderBy('createdAt', 'desc').limit(200).get();
    for (const mDoc of msgsSnap.docs) {
      const m = mDoc.data();
      sql(`INSERT OR IGNORE INTO room_messages (id, room_id, sender_id, sender_name, text, type,
        is_edited, gift_id, gift_icon_url, created_at)
        VALUES (${esc(mDoc.id)}, ${esc(doc.id)}, ${esc(m.senderId)}, ${esc(m.senderName)}, ${esc(m.text)},
        ${esc(m.type || 'TEXT')}, ${m.isEdited ? 1 : 0}, ${esc(m.giftId)}, ${esc(m.giftIconUrl)}, ${toMs(m.createdAt)})`);
    }

    // Seat requests
    const srSnap = await doc.ref.collection('seatRequests').get();
    for (const srDoc of srSnap.docs) {
      const sr = srDoc.data();
      sql(`INSERT OR IGNORE INTO seat_requests (id, room_id, user_id, user_name, seat_index, status,
        resolved_by, resolved_at, created_at)
        VALUES (${esc(srDoc.id)}, ${esc(doc.id)}, ${esc(sr.userId)}, ${esc(sr.userName)},
        ${esc(sr.seatIndex)}, ${esc(sr.status || 'PENDING')}, ${esc(sr.resolvedBy)},
        ${toMs(sr.resolvedAt)}, ${toMs(sr.createdAt)})`);
    }
  }

  console.log(`  ${snap.size} rooms migrated`);
}

async function migrateReports() {
  console.log('Migrating reports...');
  for (const collection of ['reports', 'reports_archive']) {
    const snap = await db.collection(collection).get();
    const table = collection === 'reports' ? 'reports' : 'reports_archive';

    for (const doc of snap.docs) {
      const r = doc.data();
      sql(`INSERT OR IGNORE INTO ${table} (id, reporter_id, reporter_name, reporter_unique_id,
        reported_user_id, reported_user_name, reported_user_unique_id,
        conversation_id, message_id, message_text, reason, description, evidence_urls,
        status, action_taken, resolved_at, resolved_by, created_at)
        VALUES (${esc(doc.id)}, ${esc(r.reporterId)}, ${esc(r.reporterName)}, ${esc(r.reporterUniqueId)},
        ${esc(r.reportedUserId)}, ${esc(r.reportedUserName)}, ${esc(r.reportedUserUniqueId)},
        ${esc(r.conversationId)}, ${esc(r.messageId)}, ${esc(r.messageText)},
        ${esc(r.reason)}, ${esc(r.description)},
        ${r.evidenceUrls ? esc(JSON.stringify(r.evidenceUrls)) : 'NULL'},
        ${esc(r.status || 'pending')}, ${esc(r.actionTaken)},
        ${toMs(r.resolvedAt)}, ${esc(r.resolvedBy)}, ${toMs(r.createdAt)})`);
    }
    console.log(`  ${snap.size} ${collection} migrated`);
  }
}

async function migrateDeviceBindings() {
  console.log('Migrating device bindings...');
  const snap = await db.collection('deviceBindings').get();
  for (const doc of snap.docs) {
    const d = doc.data();
    sql(`INSERT OR IGNORE INTO device_bindings (device_id, user_id, bound_at)
      VALUES (${esc(doc.id)}, ${esc(d.userId)}, ${toMs(d.boundAt)})`);
  }
  console.log(`  ${snap.size} device bindings migrated`);
}

async function migrateAdminTokens() {
  console.log('Migrating admin tokens...');
  const snap = await db.collection('admin_tokens').get();
  for (const doc of snap.docs) {
    const d = doc.data();
    sql(`INSERT OR IGNORE INTO admin_tokens (id, token, user_id)
      VALUES (${esc(doc.id)}, ${esc(d.token)}, ${esc(d.userId)})`);
  }
  console.log(`  ${snap.size} admin tokens migrated`);
}

async function migrateCounters() {
  console.log('Migrating counters...');
  const snap = await db.collection('counters').get();
  for (const doc of snap.docs) {
    const d = doc.data();
    sql(`INSERT OR REPLACE INTO counters (name, value) VALUES (${esc(doc.id)}, ${esc(d.value || 0)})`);
  }
  console.log(`  ${snap.size} counters migrated`);
}

async function migrateGiftRankings() {
  console.log('Migrating gift rankings...');
  const snap = await db.collection('giftRankings').get();
  for (const doc of snap.docs) {
    const d = doc.data();
    const rankings = d.rankings || [];

    sql(`INSERT OR IGNORE INTO gift_rankings_meta (gift_id, total_sent, last_updated)
      VALUES (${esc(doc.id)}, ${esc(d.totalSent || 0)}, ${toMs(d.lastUpdated)})`);

    rankings.forEach((r, i) => {
      sql(`INSERT OR IGNORE INTO gift_rankings (gift_id, user_id, count, display_name, profile_photo_url, rank)
        VALUES (${esc(doc.id)}, ${esc(r.userId)}, ${esc(r.count)}, ${esc(r.displayName)}, ${esc(r.profilePhotoUrl)}, ${esc(i + 1)})`);
    });
  }
  console.log(`  ${snap.size} gift ranking docs migrated`);
}

async function migrateSuspensionAppeals() {
  console.log('Migrating suspension appeals...');
  const snap = await db.collection('suspensionAppeals').get();
  for (const doc of snap.docs) {
    const d = doc.data();
    sql(`INSERT OR IGNORE INTO suspension_appeals (id, user_id, appeal_text, status, reviewed_by, reviewed_at, created_at)
      VALUES (${esc(doc.id)}, ${esc(d.userId)}, ${esc(d.appealText)}, ${esc(d.status || 'pending')},
      ${esc(d.reviewedBy)}, ${toMs(d.reviewedAt)}, ${toMs(d.createdAt)})`);
  }
  console.log(`  ${snap.size} suspension appeals migrated`);
}

// ── Main ──
async function main() {
  console.log('Starting Firestore → D1 migration...\n');

  sql('BEGIN TRANSACTION');

  await migrateConfig();
  await migrateGifts();
  await migrateCoinPackages();
  await migrateCounters();
  await migrateUsers();
  await migrateConversations();
  await migrateRooms();
  await migrateReports();
  await migrateDeviceBindings();
  await migrateAdminTokens();
  await migrateGiftRankings();
  await migrateSuspensionAppeals();
  await migrateBroadcasts();

  sql('COMMIT');

  const outputPath = resolve(import.meta.dirname, 'migration_output.sql');
  writeFileSync(outputPath, statements.join('\n'));
  console.log(`\nMigration SQL written to: ${outputPath}`);
  console.log(`Total statements: ${statements.length}`);
  console.log('\nTo apply:');
  console.log('  wrangler d1 execute shytalk-db --remote --file=migration_output.sql');
}

main().catch(console.error);

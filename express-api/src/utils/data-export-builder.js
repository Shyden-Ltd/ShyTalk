/**
 * Build a GDPR data export ZIP for a single user.
 *
 * Collects all personal data from Firestore, strips sensitive internal
 * fields, and assembles a ZIP buffer using archiver.
 *
 * @param {string} uniqueId - The user's uniqueId
 * @returns {Promise<{buffer: Buffer}>}
 */

const archiver = require('archiver');
const { db } = require('./firebase');
const { queryDocs } = require('./firestore-helpers');
const log = require('./log');

// Fields to strip from the profile (internal/sensitive)
const STRIP_FIELDS = [
  'pinHash',
  'pinSetAt',
  'pinAttempts',
  'pinLockedUntil',
  'pinLockoutCount',
  'firebaseUid',
  'fcmTokens',
  'dataExportR2Key',
  'dataExportStatus',
  'dataExportExpiresAt',
  'lastDataExportRequestedAt',
  '_testRun',
];

async function buildDataExport(uniqueId) {
  // Read user doc
  const userSnap = await db.doc(`users/${uniqueId}`).get();
  if (!userSnap.exists) {
    throw new Error('User not found');
  }
  const userData = { ...userSnap.data() };

  // Strip sensitive fields
  for (const field of STRIP_FIELDS) {
    delete userData[field];
  }

  // Collect all data
  const profile = { ...userData };
  delete profile.followerIds;
  delete profile.followingIds;
  delete profile.blockedUserIds;

  const settings = {
    pmPrivacy: userData.pmPrivacy,
    pmNotificationsEnabled: userData.pmNotificationsEnabled,
    pmSoundEnabled: userData.pmSoundEnabled,
    pmShowTimestamps: userData.pmShowTimestamps,
    pmShowDateSeparators: userData.pmShowDateSeparators,
    pmNotificationPreview: userData.pmNotificationPreview,
    dndEnabled: userData.dndEnabled,
    dndStartHour: userData.dndStartHour,
    dndStartMinute: userData.dndStartMinute,
    dndEndHour: userData.dndEndHour,
    dndEndMinute: userData.dndEndMinute,
    minGiftAnimationValue: userData.minGiftAnimationValue,
    selfDestructAlertEnabled: userData.selfDestructAlertEnabled,
    language: userData.language,
  };

  const followers = {
    followerIds: userData.followerIds || [],
    followingIds: userData.followingIds || [],
  };

  const blocked = { blockedUserIds: userData.blockedUserIds || [] };

  const balance = {
    shyCoins: userData.shyCoins || 0,
    shyBeans: userData.shyBeans || 0,
    luckScore: userData.luckScore || 0,
    pityCounter: userData.pityCounter || 0,
  };

  // Subcollections
  const backpack = await queryDocs(db.collection(`users/${uniqueId}/backpack`));
  const giftWall = await queryDocs(db.collection(`users/${uniqueId}/giftWall`));
  const transactions = await queryDocs(db.collection(`users/${uniqueId}/transactions`));
  const warnings = await queryDocs(db.collection(`users/${uniqueId}/warnings`));

  // Conversations (only user's own messages)
  let conversations = [];
  const userMessages = [];
  try {
    const convSnap = await db
      .collection('conversations')
      .where('participantIds', 'array-contains', Number.parseInt(uniqueId, 10))
      .get();
    conversations = convSnap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));

    // Collect user's own messages from each conversation (max 1000 total)
    for (const conv of convSnap.docs) {
      if (userMessages.length >= 1000) break;
      try {
        const remaining = 1000 - userMessages.length;
        const msgSnap = await db
          .collection(`conversations/${conv.id}/messages`)
          .where('senderId', '==', uniqueId)
          .orderBy('createdAt', 'desc')
          .limit(remaining)
          .get();
        for (const m of msgSnap.docs) {
          userMessages.push({ conversationId: conv.id, id: m.id, ...m.data() });
        }
      } catch (msgErr) {
        log.error('data-export', 'Failed to query messages for conversation', {
          uniqueId,
          conversationId: conv.id,
          error: msgErr.message,
        });
      }
    }
  } catch (err) {
    log.error('data-export', 'Failed to query conversations', {
      uniqueId,
      error: err.message,
    });
  }

  // Rooms owned by user
  let roomsOwned = [];
  try {
    const roomSnap = await db.collection('rooms').where('ownerId', '==', uniqueId).get();
    roomsOwned = roomSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    log.error('data-export', 'Failed to query rooms', {
      uniqueId,
      error: err.message,
    });
  }

  // Reports filed by user
  let reportsFiled = [];
  try {
    const reportSnap = await db.collection('reports').where('reporterId', '==', uniqueId).get();
    reportsFiled = reportSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    log.error('data-export', 'Failed to query reports', {
      uniqueId,
      error: err.message,
    });
  }

  // Appeals
  let appeals = [];
  try {
    const appealSnap = await db
      .collection('suspensionAppeals')
      .where('userId', '==', uniqueId)
      .get();
    appeals = appealSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    log.error('data-export', 'Failed to query appeals', {
      uniqueId,
      error: err.message,
    });
  }

  // Identity
  let identity = [];
  try {
    const idSnap = await db
      .collection('identityMap')
      .where('uniqueId', '==', Number.parseInt(uniqueId, 10))
      .get();
    identity = idSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    log.error('data-export', 'Failed to query identity', {
      uniqueId,
      error: err.message,
    });
  }

  // Device bindings
  let deviceBindings = [];
  try {
    const bindSnap = await db
      .collection('deviceBindings')
      .where('uniqueId', '==', Number.parseInt(uniqueId, 10))
      .get();
    deviceBindings = bindSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    log.error('data-export', 'Failed to query device bindings', {
      uniqueId,
      error: err.message,
    });
  }

  // Build ZIP
  const buffer = await new Promise((resolve, reject) => {
    const chunks = [];
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    const readme = [
      'ShyTalk Data Export',
      '===================',
      '',
      `User ID: ${uniqueId}`,
      `Export date: ${new Date().toISOString()}`,
      '',
      'This ZIP contains all personal data associated with your ShyTalk account.',
      '',
      'Files:',
      '  profile.json      — Your profile information',
      '  settings.json     — Your privacy and notification settings',
      '  identity.json     — Your linked sign-in providers',
      '  followers.json    — Your followers and following lists',
      '  blocked.json      — Your blocked users list',
      '  economy/          — Your coins, beans, transactions, and backpack',
      '  gifts/            — Your gift wall',
      '  conversations/    — Your conversation metadata and messages',
      '  rooms/            — Rooms you own',
      '  reports/          — Reports you filed and appeals',
      '  devices/          — Your device bindings',
      '  moderation/       — Your warning history',
    ].join('\n');

    archive.append(readme, { name: 'README.txt' });
    archive.append(JSON.stringify(profile, null, 2), { name: 'profile.json' });
    archive.append(JSON.stringify(settings, null, 2), {
      name: 'settings.json',
    });
    archive.append(JSON.stringify(identity, null, 2), {
      name: 'identity.json',
    });
    archive.append(JSON.stringify(followers, null, 2), {
      name: 'followers.json',
    });
    archive.append(JSON.stringify(blocked, null, 2), { name: 'blocked.json' });
    archive.append(JSON.stringify(balance, null, 2), {
      name: 'economy/balance.json',
    });
    archive.append(JSON.stringify(transactions.slice(0, 1000), null, 2), {
      name: 'economy/transactions.json',
    });
    archive.append(JSON.stringify(backpack, null, 2), {
      name: 'economy/backpack.json',
    });
    archive.append(JSON.stringify(giftWall, null, 2), {
      name: 'gifts/gift-wall.json',
    });
    archive.append(JSON.stringify(conversations, null, 2), {
      name: 'conversations/conversations.json',
    });
    archive.append(JSON.stringify(userMessages, null, 2), {
      name: 'conversations/messages.json',
    });
    archive.append(JSON.stringify(roomsOwned, null, 2), {
      name: 'rooms/rooms-owned.json',
    });
    archive.append(JSON.stringify(reportsFiled, null, 2), {
      name: 'reports/reports-filed.json',
    });
    archive.append(JSON.stringify(appeals, null, 2), {
      name: 'reports/appeals.json',
    });
    archive.append(JSON.stringify(deviceBindings, null, 2), {
      name: 'devices/device-bindings.json',
    });
    archive.append(JSON.stringify(warnings, null, 2), {
      name: 'moderation/warnings.json',
    });

    archive.finalize();
  });

  return { buffer };
}

module.exports = buildDataExport;
